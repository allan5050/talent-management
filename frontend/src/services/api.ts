import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Constants from environment variables
export const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || 'http://localhost:8000';
export const DEFAULT_TIMEOUT = parseInt(process.env.REACT_APP_API_TIMEOUT || '30000', 10);
export const AUTH_TOKEN_KEY = process.env.REACT_APP_AUTH_TOKEN_KEY || 'auth_token';
const RETRY_COUNT = parseInt(process.env.REACT_APP_API_RETRY_COUNT || '3', 10);
const RETRY_DELAY = parseInt(process.env.REACT_APP_API_RETRY_DELAY || '1000', 10);
const CACHE_TTL = parseInt(process.env.REACT_APP_API_CACHE_TTL || '300000', 10);
const ERROR_REPORTING_URL = process.env.REACT_APP_ERROR_REPORTING_URL;

// API Error class with extended properties
export class ApiError extends Error {
  public status?: number;
  public code?: string;
  public details?: any;
  public correlationId?: string;
  public timestamp: Date;

  constructor(message: string, status?: number, code?: string, details?: any, correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
    this.timestamp = new Date();
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// Cache implementation
interface CacheEntry {
  data: any;
  timestamp: number;
  etag?: string;
}

class ApiCache {
  private cache: Map<string, CacheEntry> = new Map();

  set(key: string, data: any, etag?: string): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      etag
    });
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const keys = Array.from(this.cache.keys());
    keys.forEach(key => {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    });
  }

  getEtag(key: string): string | undefined {
    const entry = this.cache.get(key);
    return entry?.etag;
  }
}

// Request queue for offline scenarios
interface QueuedRequest {
  id: string;
  config: AxiosRequestConfig;
  timestamp: number;
  retryCount: number;
}

class RequestQueue {
  private queue: QueuedRequest[] = [];
  private readonly STORAGE_KEY = 'api_request_queue';

  constructor() {
    this.loadFromStorage();
  }

  enqueue(config: AxiosRequestConfig): void {
    const request: QueuedRequest = {
      id: uuidv4(),
      config,
      timestamp: Date.now(),
      retryCount: 0
    };
    this.queue.push(request);
    this.saveToStorage();
  }

  dequeue(): QueuedRequest | undefined {
    const request = this.queue.shift();
    if (request) {
      this.saveToStorage();
    }
    return request;
  }

  getAll(): QueuedRequest[] {
    return [...this.queue];
  }

  remove(id: string): void {
    this.queue = this.queue.filter(req => req.id !== id);
    this.saveToStorage();
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save request queue to storage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load request queue from storage:', error);
      this.queue = [];
    }
  }
}

// API metrics collection
class ApiMetrics {
  private metrics = {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    totalResponseTime: 0,
    requestsByEndpoint: new Map<string, number>(),
    errorsByEndpoint: new Map<string, number>()
  };

  recordRequest(endpoint: string, responseTime: number, success: boolean): void {
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += responseTime;
    
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
      const errorCount = this.metrics.errorsByEndpoint.get(endpoint) || 0;
      this.metrics.errorsByEndpoint.set(endpoint, errorCount + 1);
    }

    const requestCount = this.metrics.requestsByEndpoint.get(endpoint) || 0;
    this.metrics.requestsByEndpoint.set(endpoint, requestCount + 1);
  }

  getMetrics() {
    const avgResponseTime = this.metrics.requestCount > 0 
      ? this.metrics.totalResponseTime / this.metrics.requestCount 
      : 0;

    return {
      ...this.metrics,
      avgResponseTime,
      successRate: this.metrics.requestCount > 0 
        ? (this.metrics.successCount / this.metrics.requestCount) * 100 
        : 0,
      errorRate: this.metrics.requestCount > 0 
        ? (this.metrics.errorCount / this.metrics.requestCount) * 100 
        : 0
    };
  }

  reset(): void {
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      totalResponseTime: 0,
      requestsByEndpoint: new Map(),
      errorsByEndpoint: new Map()
    };
  }
}

// Initialize utilities
const apiCache = new ApiCache();
const requestQueue = new RequestQueue();
const apiMetrics = new ApiMetrics();

// Active requests tracking for loading states
const activeRequests = new Set<string>();

// Create axios instance with base configuration
export const ApiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// JWT token utilities
export function parseJwt(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to parse JWT token:', error);
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return true;
    
    const expirationTime = payload.exp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    const bufferTime = 60000; // 1 minute buffer
    
    return currentTime >= (expirationTime - bufferTime);
  } catch (error) {
    console.error('Failed to check token expiration:', error);
    return true;
  }
}

// Authentication token management
export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    ApiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    // Invalidate cache on new authentication
    apiCache.invalidate();
  } catch (error) {
    console.error('Failed to set auth token:', error);
    throw new ApiError('Failed to store authentication token', undefined, 'AUTH_STORAGE_ERROR', error);
  }
}

export function removeAuthToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    delete ApiClient.defaults.headers.common['Authorization'];
    
    // Clear cache on logout
    apiCache.invalidate();
  } catch (error) {
    console.error('Failed to remove auth token:', error);
  }
}

export function getAuthToken(): string | null {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return null;
    
    if (isTokenExpired(token)) {
      removeAuthToken();
      return null;
    }
    
    return token;
  } catch (error) {
    console.error('Failed to get auth token:', error);
    return null;
  }
}

export async function refreshAuthToken(): Promise<string | null> {
  try {
    // TODO: Implement token refresh endpoint call
    // This would typically call a refresh endpoint with the current token
    // For now, return null to indicate refresh is not implemented
    console.warn('Token refresh not implemented');
    return null;
  } catch (error) {
    console.error('Failed to refresh auth token:', error);
    removeAuthToken();
    return null;
  }
}

// Network connectivity utilities
export function isOnline(): boolean {
  return navigator.onLine;
}

export function waitForOnline(): Promise<void> {
  return new Promise((resolve) => {
    if (isOnline()) {
      resolve();
      return;
    }

    const handleOnline = () => {
      window.removeEventListener('online', handleOnline);
      resolve();
    };

    window.addEventListener('online', handleOnline);
  });
}

// Request retry logic with exponential backoff
async function retryRequest(
  config: AxiosRequestConfig,
  retryCount: number = 0
): Promise<AxiosResponse> {
  const maxRetries = RETRY_COUNT;
  const delay = RETRY_DELAY * Math.pow(2, retryCount); // Exponential backoff

  if (retryCount >= maxRetries) {
    throw new ApiError(
      'Maximum retry attempts exceeded',
      undefined,
      'MAX_RETRIES_EXCEEDED',
      { config, retryCount }
    );
  }

  await new Promise(resolve => setTimeout(resolve, delay));
  
  try {
    return await ApiClient.request(config);
  } catch (error) {
    if (shouldRetry(error as AxiosError)) {
      return retryRequest(config, retryCount + 1);
    }
    throw error;
  }
}

function shouldRetry(error: AxiosError): boolean {
  if (!error.response) return true; // Network error
  
  const retryableStatuses = [408, 429, 500, 502, 503, 504];
  return retryableStatuses.includes(error.response.status);
}

// Request deduplication
const pendingRequests = new Map<string, Promise<AxiosResponse>>();

function getRequestKey(config: AxiosRequestConfig): string {
  const method = config.method || 'get';
  const url = config.url || '';
  const params = JSON.stringify(config.params || {});
  return `${method}:${url}:${params}`;
}

// Error handling utilities
export function handleApiError(error: any): ApiError {
  const correlationId = error.config?.headers?.['X-Correlation-ID'];

  if (error.response) {
    // Server responded with error status
    const { status, data } = error.response;
    const message = data?.message || data?.error || getErrorMessageByStatus(status);
    const code = data?.code || `HTTP_${status}`;
    
    return new ApiError(message, status, code, data, correlationId);
  } else if (error.request) {
    // Request made but no response received
    if (!isOnline()) {
      return new ApiError(
        'No internet connection. Please check your network.',
        undefined,
        'NETWORK_OFFLINE',
        undefined,
        correlationId
      );
    }
    
    if (error.code === 'ECONNABORTED') {
      return new ApiError(
        'Request timeout. Please try again.',
        undefined,
        'REQUEST_TIMEOUT',
        undefined,
        correlationId
      );
    }
    
    return new ApiError(
      'Network error. Please check your connection.',
      undefined,
      'NETWORK_ERROR',
      undefined,
      correlationId
    );
  } else {
    // Something else happened
    return new ApiError(
      error.message || 'An unexpected error occurred',
      undefined,
      'UNKNOWN_ERROR',
      error,
      correlationId
    );
  }
}

function getErrorMessageByStatus(status: number): string {
  const errorMessages: Record<number, string> = {
    400: 'Invalid request. Please check your input.',
    401: 'Authentication required. Please log in.',
    403: 'You do not have permission to perform this action.',
    404: 'The requested resource was not found.',
    429: 'Too many requests. Please try again later.',
    500: 'Internal server error. Please try again later.',
    502: 'Bad gateway. The server is temporarily unavailable.',
    503: 'Service unavailable. Please try again later.',
    504: 'Gateway timeout. The server took too long to respond.'
  };
  
  return errorMessages[status] || `Request failed with status ${status}`;
}

// Request interceptor
ApiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    
    // Add correlation ID
    config.headers['X-Correlation-ID'] = requestId;
    config.headers['X-Request-ID'] = requestId;
    
    // Add timestamp
    config.headers['X-Request-Timestamp'] = new Date().toISOString();
    
    // Add user agent info
    config.headers['X-Client-Version'] = process.env.REACT_APP_VERSION || '1.0.0';
    config.headers['X-Client-Platform'] = 'web';
    
    // Add auth token
    const token = getAuthToken();
    if (token && !config.headers['Authorization']) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Store request metadata
    (config as any).metadata = {
      requestId,
      startTime,
      endpoint: config.url || ''
    };
    
    // Track active request
    activeRequests.add(requestId);
    
    // Handle offline scenario
    if (!isOnline() && config.method !== 'get') {
      requestQueue.enqueue(config);
      throw new ApiError(
        'Request queued for offline processing',
        undefined,
        'OFFLINE_QUEUED',
        { requestId }
      );
    }
    
    // Check cache for GET requests
    if (config.method === 'get' && config.url) {
      const cacheKey = getRequestKey(config);
      const cachedEntry = apiCache.get(cacheKey);
      
      if (cachedEntry) {
        // Add If-None-Match header for conditional requests
        if (cachedEntry.etag) {
          config.headers['If-None-Match'] = cachedEntry.etag;
        }
      }
    }
    
    // Request deduplication for GET requests
    if (config.method === 'get' && config.url) {
      const requestKey = getRequestKey(config);
      const pendingRequest = pendingRequests.get(requestKey);
      
      if (pendingRequest) {
        (config as any).deduplicated = true;
        return config;
      }
    }
    
    // Log request in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
        headers: config.headers,
        params: config.params,
        data: config.data,
        correlationId: requestId
      });
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(handleApiError(error));
  }
);

// Response interceptor
ApiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    const config = response.config as any;
    const metadata = config.metadata;
    
    if (metadata) {
      const endTime = Date.now();
      const responseTime = endTime - metadata.startTime;
      
      // Record metrics
      apiMetrics.recordRequest(metadata.endpoint, responseTime, true);
      
      // Remove from active requests
      activeRequests.delete(metadata.requestId);
      
      // Log response in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[API Response] ${config.method?.toUpperCase()} ${config.url}`, {
          status: response.status,
          responseTime: `${responseTime}ms`,
          data: response.data,
          correlationId: metadata.requestId
        });
      }
    }
    
    // Handle 304 Not Modified
    if (response.status === 304 && config.method === 'get') {
      const cacheKey = getRequestKey(config);
      const cachedEntry = apiCache.get(cacheKey);
      if (cachedEntry) {
        response.data = cachedEntry.data;
      }
    }
    
    // Cache successful GET responses
    if (config.method === 'get' && response.status === 200 && response.data) {
      const cacheKey = getRequestKey(config);
      const etag = response.headers['etag'];
      apiCache.set(cacheKey, response.data, etag);
    }
    
    // Clear deduplication entry
    if (config.method === 'get' && !config.deduplicated) {
      const requestKey = getRequestKey(config);
      pendingRequests.delete(requestKey);
    }
    
    // Extract pagination metadata if present
    if (response.data && typeof response.data === 'object') {
      const { data, ...metadata } = response.data;
      if (metadata.total !== undefined || metadata.page !== undefined) {
        response.data = {
          items: data || [],
          metadata
        };
      }
    }
    
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as any;
    const metadata = config?.metadata;
    
    if (metadata) {
      const endTime = Date.now();
      const responseTime = endTime - metadata.startTime;
      
      // Record metrics
      apiMetrics.recordRequest(metadata.endpoint, responseTime, false);
      
      // Remove from active requests
      activeRequests.delete(metadata.requestId);
    }
    
    // Clear deduplication entry on error
    if (config?.method === 'get' && !config.deduplicated) {
      const requestKey = getRequestKey(config);
      pendingRequests.delete(requestKey);
    }
    
    // Log error in development
    if (process.env.NODE_ENV === 'development') {
      console.error(`[API Error] ${config?.method?.toUpperCase()} ${config?.url}`, {
        status: error.response?.status,
        error: error.response?.data || error.message,
        correlationId: metadata?.requestId
      });
    }
    
    // Handle authentication errors
    if (error.response?.status === 401) {
      const currentToken = getAuthToken();
      if (currentToken && !config?.retry) {
        // Try to refresh token
        const newToken = await refreshAuthToken();
        if (newToken) {
          config.retry = true;
          config.headers['Authorization'] = `Bearer ${newToken}`;
          return ApiClient.request(config);
        }
      }
      
      // Clear auth and redirect to login
      removeAuthToken();
      // TODO: Trigger navigation to login page
      window.dispatchEvent(new CustomEvent('auth:required'));
    }
    
    // Handle rate limiting
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'];
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      
      if (!config?.retryCount || config.retryCount < RETRY_COUNT) {
        config.retryCount = (config.retryCount || 0) + 1;
        await new Promise(resolve => setTimeout(resolve, delay));
        return ApiClient.request(config);
      }
    }
    
    // Retry logic for transient errors
    if (shouldRetry(error) && (!config?.retryCount || config.retryCount < RETRY_COUNT)) {
      config.retryCount = (config.retryCount || 0) + 1;
      return retryRequest(config, config.retryCount);
    }
    
    // Report errors to monitoring service
    if (ERROR_REPORTING_URL && error.response?.status >= 500) {
      try {
        await fetch(ERROR_REPORTING_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: handleApiError(error),
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
          })
        });
      } catch (reportError) {
        console.error('Failed to report error:', reportError);
      }
    }
    
    throw handleApiError(error);
  }
);

// Request cancellation utilities
export function createCancelToken(): AbortController {
  return new AbortController();
}

export function cancelRequest(controller: AbortController): void {
  controller.abort();
}

// File upload utilities
export async function uploadFile(
  url: string,
  file: File,
  onProgress?: (progress: number) => void,
  additionalData?: Record<string, any>
): Promise<AxiosResponse> {
  const formData = new FormData();
  formData.append('file', file);
  
  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      formData.append(key, value);
    });
  }
  
  return ApiClient.post(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(progress);
      }
    }
  });
}

// File download utilities
export async function downloadFile(
  url: string,
  filename?: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  const response = await ApiClient.get(url, {
    responseType: 'blob',
    onDownloadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(progress);
      }
    }
  });
  
  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

// WebSocket utilities
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const token = getAuthToken();
        const wsUrl = `${this.url}?token=${token}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            const handler = this.messageHandlers.get(message.type);
            if (handler) {
              handler(message.data);
            }
          } catch (error) {
            console.error('Failed to process WebSocket message:', error);
          }
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
        
        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.handleReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      
      setTimeout(() => {
        console.log(`Attempting WebSocket reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect().catch(console.error);
      }, delay);
    }
  }

  on(type: string, handler: (data: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  off(type: string): void {
    this.messageHandlers.delete(type);
  }

  send(type: string, data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// API health check
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await ApiClient.get('/health', {
      timeout: 5000
    });
    return response.status === 200;
  } catch (error) {
    console.error('API health check failed:', error);
    return false;
  }
}

// Periodic health check
let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthCheck(interval: number = 30000): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(async () => {
    const isHealthy = await checkApiHealth();
    if (!isHealthy) {
      console.warn('API health check failed');
      window.dispatchEvent(new CustomEvent('api:unhealthy'));
    }
  }, interval);
}

export function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// Process queued requests when coming back online
window.addEventListener('online', async () => {
  console.log('Network connection restored, processing queued requests');
  
  const queued = requestQueue.getAll();
  for (const request of queued) {
    try {
      await ApiClient.request(request.config);
      requestQueue.remove(request.id);
    } catch (error) {
      console.error('Failed to process queued request:', error);
      if (request.retryCount < RETRY_COUNT) {
        request.retryCount++;
      } else {
        requestQueue.remove(request.id);
      }
    }
  }
});

// Global loading state
export function isLoading(): boolean {
  return activeRequests.size > 0;
}

export function getActiveRequestCount(): number {
  return activeRequests.size;
}

// API versioning support
export function setApiVersion(version: string): void {
  ApiClient.defaults.headers.common['X-API-Version'] = version;
}

// Mock API responses for development
if (process.env.NODE_ENV === 'development' && process.env.REACT_APP_USE_MOCK_API === 'true') {
  // TODO: Implement mock interceptor for development testing
  console.log('Mock API mode enabled');
}

// Export utilities
export {
  apiCache,
  requestQueue,
  apiMetrics,
  activeRequests
};

// Type exports for use in other modules
export type { ApiError, AxiosInstance, AxiosRequestConfig, AxiosResponse };
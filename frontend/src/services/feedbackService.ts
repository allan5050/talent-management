import axios, { AxiosResponse, AxiosError, AxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';
import { debounce, throttle, cloneDeep, isEqual } from 'lodash';
import { ApiClient, setAuthToken, handleApiError, ApiError } from './api';
import {
  Feedback,
  FeedbackCreate,
  FeedbackUpdate,
  FeedbackFilter,
  FeedbackStats,
  FeedbackListResponse,
  FeedbackBulkCreate,
  FeedbackBulkResponse,
  FeedbackExportFormat,
  FeedbackSearchParams,
  FeedbackSearchResponse,
  FeedbackSortField,
  FeedbackSortDirection,
  FeedbackValidationError,
  FeedbackCacheEntry,
  FeedbackOfflineQueue
} from '../types/feedback';

// Environment configuration with defaults
const API_GATEWAY_URL = process.env.REACT_APP_API_GATEWAY_URL || 'http://localhost:8000';
const FEEDBACK_TIMEOUT = parseInt(process.env.REACT_APP_FEEDBACK_TIMEOUT || '30000', 10);
const FEEDBACK_CACHE_TTL = parseInt(process.env.REACT_APP_FEEDBACK_CACHE_TTL || '300000', 10);
const FEEDBACK_RETRY_COUNT = parseInt(process.env.REACT_APP_FEEDBACK_RETRY_COUNT || '3', 10);
const FEEDBACK_BULK_SIZE = parseInt(process.env.REACT_APP_FEEDBACK_BULK_SIZE || '100', 10);
const FEEDBACK_EXPORT_LIMIT = parseInt(process.env.REACT_APP_FEEDBACK_EXPORT_LIMIT || '10000', 10);
const FEEDBACK_FILE_SIZE_LIMIT = parseInt(process.env.REACT_APP_FEEDBACK_FILE_SIZE_LIMIT || '10485760', 10); // 10MB

// Cache management
const feedbackCache = new Map<string, FeedbackCacheEntry>();
const requestCache = new Map<string, Promise<any>>();
const offlineQueue: FeedbackOfflineQueue[] = [];

// Active request tracking
const activeRequests = new Map<string, AbortController>();
let isOnline = navigator.onLine;

// WebSocket connection for real-time updates
let wsConnection: WebSocket | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;

// Utility functions
const generateCorrelationId = (): string => uuidv4();

const getCacheKey = (endpoint: string, params?: any): string => {
  return `${endpoint}:${JSON.stringify(params || {})}`;
};

const isValidCacheEntry = (entry: FeedbackCacheEntry): boolean => {
  return Date.now() - entry.timestamp < FEEDBACK_CACHE_TTL;
};

const sanitizeInput = (input: string): string => {
  return input.replace(/[<>]/g, '').trim();
};

const validateFileSize = (file: File): boolean => {
  return file.size <= FEEDBACK_FILE_SIZE_LIMIT;
};

const validateFileType = (file: File): boolean => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
  return allowedTypes.includes(file.type);
};

// Transform functions
export const transformFeedbackForApi = (feedback: FeedbackCreate | FeedbackUpdate): any => {
  const transformed: any = {
    ...feedback,
    content: feedback.content ? sanitizeInput(feedback.content) : undefined,
    created_at: feedback.created_at ? format(feedback.created_at, "yyyy-MM-dd'T'HH:mm:ss'Z'") : undefined,
    updated_at: feedback.updated_at ? format(feedback.updated_at, "yyyy-MM-dd'T'HH:mm:ss'Z'") : undefined,
  };

  // Remove undefined fields
  Object.keys(transformed).forEach(key => {
    if (transformed[key] === undefined) {
      delete transformed[key];
    }
  });

  return transformed;
};

export const transformApiResponseToFeedback = (response: any): Feedback => {
  return {
    ...response,
    created_at: response.created_at ? parseISO(response.created_at) : new Date(),
    updated_at: response.updated_at ? parseISO(response.updated_at) : new Date(),
    // Add computed fields
    isRecent: response.created_at ? Date.now() - parseISO(response.created_at).getTime() < 86400000 : false,
    formattedRating: response.rating ? `${response.rating}/5` : 'N/A',
  };
};

// Error handling utilities
export const isFeedbackError = (error: any): error is ApiError => {
  return error && error.code && error.message;
};

export const getFeedbackErrorMessage = (error: any): string => {
  if (isFeedbackError(error)) {
    return error.message;
  }
  if (error.response?.data?.detail) {
    return error.response.data.detail;
  }
  if (error.message) {
    return error.message;
  }
  return 'An unexpected error occurred while processing feedback';
};

// Validation utilities
export const validateFeedbackData = (data: FeedbackCreate): FeedbackValidationError[] => {
  const errors: FeedbackValidationError[] = [];

  if (!data.member_id) {
    errors.push({ field: 'member_id', message: 'Member is required' });
  }

  if (!data.feedback_type) {
    errors.push({ field: 'feedback_type', message: 'Feedback type is required' });
  }

  if (!data.content || data.content.trim().length < 10) {
    errors.push({ field: 'content', message: 'Content must be at least 10 characters long' });
  }

  if (data.rating !== undefined && (data.rating < 1 || data.rating > 5)) {
    errors.push({ field: 'rating', message: 'Rating must be between 1 and 5' });
  }

  return errors;
};

// Cache management utilities
export const clearFeedbackCache = (): void => {
  feedbackCache.clear();
  requestCache.clear();
};

export const invalidateFeedbackCache = (pattern?: string): void => {
  if (pattern) {
    Array.from(feedbackCache.keys())
      .filter(key => key.includes(pattern))
      .forEach(key => feedbackCache.delete(key));
  } else {
    clearFeedbackCache();
  }
};

// Network monitoring
window.addEventListener('online', () => {
  isOnline = true;
  processOfflineQueue();
});

window.addEventListener('offline', () => {
  isOnline = false;
});

// Process offline queue
const processOfflineQueue = async (): Promise<void> => {
  while (offlineQueue.length > 0 && isOnline) {
    const request = offlineQueue.shift();
    if (request) {
      try {
        await request.execute();
      } catch (error) {
        console.error('Failed to process offline request:', error);
        // Re-queue if still relevant
        if (Date.now() - request.timestamp < 86400000) { // 24 hours
          offlineQueue.push(request);
        }
      }
    }
  }
};

// WebSocket management
const initializeWebSocket = (): void => {
  if (wsConnection?.readyState === WebSocket.OPEN) return;

  try {
    const wsUrl = API_GATEWAY_URL.replace(/^http/, 'ws') + '/ws/feedback';
    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      console.log('WebSocket connected for feedback updates');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealtimeUpdate(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    wsConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsConnection.onclose = () => {
      console.log('WebSocket disconnected');
      // Attempt reconnection after delay
      wsReconnectTimer = setTimeout(() => {
        initializeWebSocket();
      }, 5000);
    };
  } catch (error) {
    console.error('Failed to initialize WebSocket:', error);
  }
};

const handleRealtimeUpdate = (data: any): void => {
  // Invalidate relevant cache entries
  if (data.type === 'feedback_created' || data.type === 'feedback_updated') {
    invalidateFeedbackCache(`/feedback/${data.id}`);
    invalidateFeedbackCache('/feedback?');
    invalidateFeedbackCache('/feedback/stats');
  }
  
  // Emit custom event for components to handle
  window.dispatchEvent(new CustomEvent('feedbackUpdate', { detail: data }));
};

// Main FeedbackService class
class FeedbackService {
  private apiClient: typeof ApiClient;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.apiClient = ApiClient;
    this.baseUrl = `${API_GATEWAY_URL}/api/v1/feedback`;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': generateCorrelationId(),
    };

    // Initialize WebSocket connection
    initializeWebSocket();
  }

  // Create new feedback
  async createFeedback(feedbackData: FeedbackCreate): Promise<Feedback> {
    const correlationId = generateCorrelationId();
    const controller = new AbortController();
    const requestKey = `create-${correlationId}`;

    try {
      // Validate input data
      const validationErrors = validateFeedbackData(feedbackData);
      if (validationErrors.length > 0) {
        throw new ApiError('Validation failed', 'VALIDATION_ERROR', 400, validationErrors);
      }

      activeRequests.set(requestKey, controller);

      const transformedData = transformFeedbackForApi(feedbackData);

      const config: AxiosRequestConfig = {
        headers: {
          ...this.defaultHeaders,
          'X-Correlation-ID': correlationId,
        },
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.post(
        this.baseUrl,
        transformedData,
        config
      );

      const feedback = transformApiResponseToFeedback(response.data);

      // Invalidate relevant caches
      invalidateFeedbackCache('/feedback?');
      invalidateFeedbackCache('/feedback/stats');
      invalidateFeedbackCache(`/feedback/member/${feedbackData.member_id}`);

      // Track analytics
      this.trackAnalytics('feedback_created', {
        feedback_type: feedback.feedback_type,
        rating: feedback.rating,
        organization_id: feedback.organization_id,
      });

      return feedback;
    } catch (error) {
      if (!isOnline && error instanceof Error && !error.message.includes('abort')) {
        // Queue for offline processing
        offlineQueue.push({
          id: correlationId,
          type: 'create',
          data: feedbackData,
          timestamp: Date.now(),
          execute: () => this.createFeedback(feedbackData),
        });
        throw new ApiError('Request queued for offline processing', 'OFFLINE', 0);
      }
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Get feedback by ID
  async getFeedbackById(id: string): Promise<Feedback> {
    const cacheKey = getCacheKey(`/feedback/${id}`);
    const cachedEntry = feedbackCache.get(cacheKey);

    if (cachedEntry && isValidCacheEntry(cachedEntry)) {
      return cachedEntry.data;
    }

    const controller = new AbortController();
    const requestKey = `get-${id}`;

    try {
      activeRequests.set(requestKey, controller);

      const config: AxiosRequestConfig = {
        headers: this.defaultHeaders,
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.get(
        `${this.baseUrl}/${id}`,
        config
      );

      const feedback = transformApiResponseToFeedback(response.data);

      // Cache the result
      feedbackCache.set(cacheKey, {
        data: feedback,
        timestamp: Date.now(),
      });

      return feedback;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new ApiError('Feedback not found', 'NOT_FOUND', 404);
      }
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Get paginated feedback list
  async getFeedbacks(filter?: FeedbackFilter): Promise<FeedbackListResponse> {
    const params = this.buildQueryParams(filter);
    const cacheKey = getCacheKey('/feedback', params);
    const cachedEntry = feedbackCache.get(cacheKey);

    if (cachedEntry && isValidCacheEntry(cachedEntry)) {
      return cachedEntry.data;
    }

    // Check for existing request
    const requestKey = `list-${cacheKey}`;
    const existingRequest = requestCache.get(requestKey);
    if (existingRequest) {
      return existingRequest;
    }

    const controller = new AbortController();

    const request = (async () => {
      try {
        activeRequests.set(requestKey, controller);

        const config: AxiosRequestConfig = {
          headers: this.defaultHeaders,
          params,
          timeout: FEEDBACK_TIMEOUT,
          signal: controller.signal,
        };

        const response: AxiosResponse = await this.apiClient.get(
          this.baseUrl,
          config
        );

        const feedbacks = response.data.items.map(transformApiResponseToFeedback);
        const result: FeedbackListResponse = {
          items: feedbacks,
          total: response.data.total,
          page: response.data.page,
          limit: response.data.limit,
          pages: response.data.pages,
        };

        // Cache the result
        feedbackCache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
        });

        return result;
      } finally {
        activeRequests.delete(requestKey);
        requestCache.delete(requestKey);
      }
    })();

    requestCache.set(requestKey, request);
    return request;
  }

  // Update feedback
  async updateFeedback(id: string, updateData: FeedbackUpdate): Promise<Feedback> {
    const controller = new AbortController();
    const requestKey = `update-${id}`;

    try {
      activeRequests.set(requestKey, controller);

      const transformedData = transformFeedbackForApi(updateData);

      const config: AxiosRequestConfig = {
        headers: {
          ...this.defaultHeaders,
          'If-Match': updateData.version?.toString() || '',
        },
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.patch(
        `${this.baseUrl}/${id}`,
        transformedData,
        config
      );

      const feedback = transformApiResponseToFeedback(response.data);

      // Invalidate caches
      invalidateFeedbackCache(`/feedback/${id}`);
      invalidateFeedbackCache('/feedback?');
      invalidateFeedbackCache('/feedback/stats');
      invalidateFeedbackCache(`/feedback/member/${feedback.member_id}`);

      // Track analytics
      this.trackAnalytics('feedback_updated', {
        feedback_id: id,
        fields_updated: Object.keys(updateData),
      });

      return feedback;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        throw new ApiError(
          'Feedback has been modified by another user. Please refresh and try again.',
          'CONFLICT',
          409
        );
      }
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Delete feedback (soft delete)
  async deleteFeedback(id: string): Promise<void> {
    const controller = new AbortController();
    const requestKey = `delete-${id}`;

    try {
      activeRequests.set(requestKey, controller);

      const config: AxiosRequestConfig = {
        headers: this.defaultHeaders,
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      await this.apiClient.delete(`${this.baseUrl}/${id}`, config);

      // Invalidate caches
      invalidateFeedbackCache(`/feedback/${id}`);
      invalidateFeedbackCache('/feedback?');
      invalidateFeedbackCache('/feedback/stats');

      // Track analytics
      this.trackAnalytics('feedback_deleted', { feedback_id: id });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        throw new ApiError(
          'Cannot delete feedback due to existing relationships',
          'CONSTRAINT_VIOLATION',
          409
        );
      }
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Get feedback statistics
  async getFeedbackStatistics(filter?: Partial<FeedbackFilter>): Promise<FeedbackStats> {
    const params = this.buildQueryParams(filter);
    const cacheKey = getCacheKey('/feedback/stats', params);
    const cachedEntry = feedbackCache.get(cacheKey);

    if (cachedEntry && isValidCacheEntry(cachedEntry)) {
      return cachedEntry.data;
    }

    const controller = new AbortController();
    const requestKey = `stats-${cacheKey}`;

    try {
      activeRequests.set(requestKey, controller);

      const config: AxiosRequestConfig = {
        headers: this.defaultHeaders,
        params,
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.get(
        `${this.baseUrl}/stats`,
        config
      );

      const stats: FeedbackStats = {
        ...response.data,
        lastUpdated: new Date(),
      };

      // Cache the result
      feedbackCache.set(cacheKey, {
        data: stats,
        timestamp: Date.now(),
      });

      return stats;
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Get feedback by member
  async getFeedbacksByMember(
    memberId: string,
    filter?: Partial<FeedbackFilter>
  ): Promise<FeedbackListResponse> {
    const params = this.buildQueryParams({ ...filter, member_id: memberId });
    const cacheKey = getCacheKey(`/feedback/member/${memberId}`, params);
    const cachedEntry = feedbackCache.get(cacheKey);

    if (cachedEntry && isValidCacheEntry(cachedEntry)) {
      return cachedEntry.data;
    }

    const controller = new AbortController();
    const requestKey = `member-${memberId}-${cacheKey}`;

    try {
      activeRequests.set(requestKey, controller);

      const config: AxiosRequestConfig = {
        headers: this.defaultHeaders,
        params,
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.get(
        `${this.baseUrl}/member/${memberId}`,
        config
      );

      const feedbacks = response.data.items.map(transformApiResponseToFeedback);
      const result: FeedbackListResponse = {
        items: feedbacks,
        total: response.data.total,
        page: response.data.page,
        limit: response.data.limit,
        pages: response.data.pages,
        memberSummary: response.data.member_summary,
      };

      // Cache the result
      feedbackCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Bulk create feedbacks
  async bulkCreateFeedbacks(
    feedbacks: FeedbackBulkCreate[],
    onProgress?: (progress: number) => void
  ): Promise<FeedbackBulkResponse> {
    const controller = new AbortController();
    const requestKey = `bulk-create-${generateCorrelationId()}`;

    try {
      activeRequests.set(requestKey, controller);

      // Process in batches
      const batches = [];
      for (let i = 0; i < feedbacks.length; i += FEEDBACK_BULK_SIZE) {
        batches.push(feedbacks.slice(i, i + FEEDBACK_BULK_SIZE));
      }

      const results: FeedbackBulkResponse = {
        successful: [],
        failed: [],
        total: feedbacks.length,
      };

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const transformedBatch = batch.map(transformFeedbackForApi);

        try {
          const config: AxiosRequestConfig = {
            headers: {
              ...this.defaultHeaders,
              'X-Bulk-Operation': 'true',
            },
            timeout: FEEDBACK_TIMEOUT * 2, // Double timeout for bulk operations
            signal: controller.signal,
          };

          const response: AxiosResponse = await this.apiClient.post(
            `${this.baseUrl}/bulk`,
            { feedbacks: transformedBatch },
            config
          );

          results.successful.push(
            ...response.data.successful.map(transformApiResponseToFeedback)
          );
          results.failed.push(...response.data.failed);

          // Report progress
          if (onProgress) {
            const progress = ((i + 1) / batches.length) * 100;
            onProgress(progress);
          }
        } catch (error) {
          // Add all remaining items as failed
          const remainingItems = batch.map((item, index) => ({
            index: i * FEEDBACK_BULK_SIZE + index,
            data: item,
            error: getFeedbackErrorMessage(error),
          }));
          results.failed.push(...remainingItems);
        }
      }

      // Invalidate caches
      invalidateFeedbackCache('/feedback?');
      invalidateFeedbackCache('/feedback/stats');

      // Track analytics
      this.trackAnalytics('feedback_bulk_created', {
        total: results.total,
        successful: results.successful.length,
        failed: results.failed.length,
      });

      return results;
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Export feedbacks
  async exportFeedbacks(
    filter?: FeedbackFilter,
    format: FeedbackExportFormat = 'json',
    fields?: string[]
  ): Promise<void> {
    const controller = new AbortController();
    const requestKey = `export-${generateCorrelationId()}`;

    try {
      activeRequests.set(requestKey, controller);

      const params = {
        ...this.buildQueryParams(filter),
        format,
        fields: fields?.join(','),
        limit: FEEDBACK_EXPORT_LIMIT,
      };

      const config: AxiosRequestConfig = {
        headers: {
          ...this.defaultHeaders,
          'Accept': format === 'csv' ? 'text/csv' : 'application/json',
        },
        params,
        timeout: FEEDBACK_TIMEOUT * 3, // Triple timeout for exports
        signal: controller.signal,
        responseType: 'blob',
      };

      const response: AxiosResponse = await this.apiClient.get(
        `${this.baseUrl}/export`,
        config
      );

      // Create download link
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feedback-export-${format}-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Track analytics
      this.trackAnalytics('feedback_exported', {
        format,
        fields_count: fields?.length || 0,
      });
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Search feedbacks
  async searchFeedbacks(searchParams: FeedbackSearchParams): Promise<FeedbackSearchResponse> {
    const controller = new AbortController();
    const requestKey = `search-${generateCorrelationId()}`;

    try {
      activeRequests.set(requestKey, controller);

      const params = {
        q: sanitizeInput(searchParams.query),
        tags: searchParams.tags?.join(','),
        content_only: searchParams.contentOnly,
        highlight: searchParams.highlight,
        page: searchParams.page || 1,
        limit: searchParams.limit || 20,
      };

      const config: AxiosRequestConfig = {
        headers: this.defaultHeaders,
        params,
        timeout: FEEDBACK_TIMEOUT,
        signal: controller.signal,
      };

      const response: AxiosResponse = await this.apiClient.get(
        `${this.baseUrl}/search`,
        config
      );

      const results: FeedbackSearchResponse = {
        items: response.data.items.map(transformApiResponseToFeedback),
        total: response.data.total,
        page: response.data.page,
        limit: response.data.limit,
        pages: response.data.pages,
        highlights: response.data.highlights,
        facets: response.data.facets,
      };

      // Track analytics
      this.trackAnalytics('feedback_searched', {
        query: searchParams.query,
        results_count: results.total,
      });

      return results;
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // File upload for feedback attachments
  async uploadFeedbackAttachment(
    feedbackId: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const controller = new AbortController();
    const requestKey = `upload-${feedbackId}-${generateCorrelationId()}`;

    try {
      // Validate file
      if (!validateFileSize(file)) {
        throw new ApiError(
          `File size exceeds limit of ${FEEDBACK_FILE_SIZE_LIMIT / 1048576}MB`,
          'FILE_TOO_LARGE',
          400
        );
      }

      if (!validateFileType(file)) {
        throw new ApiError(
          'Invalid file type. Allowed types: JPEG, PNG, GIF, PDF, TXT',
          'INVALID_FILE_TYPE',
          400
        );
      }

      activeRequests.set(requestKey, controller);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('feedback_id', feedbackId);

      const config: AxiosRequestConfig = {
        headers: {
          ...this.defaultHeaders,
          'Content-Type': 'multipart/form-data',
        },
        timeout: FEEDBACK_TIMEOUT * 2,
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100;
            onProgress(progress);
          }
        },
      };

      const response: AxiosResponse = await this.apiClient.post(
        `${this.baseUrl}/${feedbackId}/attachments`,
        formData,
        config
      );

      // Invalidate feedback cache to reflect new attachment
      invalidateFeedbackCache(`/feedback/${feedbackId}`);

      return response.data.url;
    } catch (error) {
      throw handleApiError(error);
    } finally {
      activeRequests.delete(requestKey);
    }
  }

  // Cancel active request
  cancelRequest(requestKey: string): void {
    const controller = activeRequests.get(requestKey);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestKey);
    }
  }

  // Cancel all active requests
  cancelAllRequests(): void {
    activeRequests.forEach((controller) => controller.abort());
    activeRequests.clear();
  }

  // Private helper methods
  private buildQueryParams(filter?: Partial<FeedbackFilter>): any {
    if (!filter) return {};

    const params: any = {};

    if (filter.page) params.page = filter.page;
    if (filter.limit) params.limit = filter.limit;
    if (filter.member_id) params.member_id = filter.member_id;
    if (filter.organization_id) params.organization_id = filter.organization_id;
    if (filter.feedback_type) params.feedback_type = filter.feedback_type;
    if (filter.category) params.category = filter.category;
    if (filter.priority) params.priority = filter.priority;
    if (filter.status) params.status = filter.status;
    if (filter.min_rating !== undefined) params.min_rating = filter.min_rating;
    if (filter.max_rating !== undefined) params.max_rating = filter.max_rating;
    if (filter.start_date) params.start_date = format(filter.start_date, 'yyyy-MM-dd');
    if (filter.end_date) params.end_date = format(filter.end_date, 'yyyy-MM-dd');
    if (filter.search) params.search = sanitizeInput(filter.search);
    if (filter.sort_by) params.sort_by = filter.sort_by;
    if (filter.sort_direction) params.sort_direction = filter.sort_direction;
    if (filter.tags?.length) params.tags = filter.tags.join(',');
    if (filter.exclude_deleted !== undefined) params.exclude_deleted = filter.exclude_deleted;

    return params;
  }

  private trackAnalytics(event: string, data: any): void {
    // TODO: Integrate with analytics service
    if (window.gtag) {
      window.gtag('event', event, data);
    }
  }
}

// Create singleton instance
const feedbackService = new FeedbackService();

// Export service instance and utilities
export default feedbackService;

// Named exports for granular usage
export const {
  createFeedback,
  getFeedbackById,
  getFeedbacks,
  updateFeedback,
  deleteFeedback,
  getFeedbackStatistics,
  getFeedbacksByMember,
  bulkCreateFeedbacks,
  exportFeedbacks,
  searchFeedbacks,
  uploadFeedbackAttachment,
  cancelRequest,
  cancelAllRequests,
} = feedbackService;

// Cleanup on module unload
if (module.hot) {
  module.hot.dispose(() => {
    feedbackService.cancelAllRequests();
    if (wsConnection) {
      wsConnection.close();
    }
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
    }
  });
}
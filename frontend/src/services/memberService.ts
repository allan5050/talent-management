import axios, { AxiosResponse, AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO, differenceInYears } from 'date-fns';
import {
  debounce,
  throttle,
  cloneDeep,
  isEqual,
  groupBy,
  orderBy,
  pick,
  omit,
  merge
} from 'lodash';
import { ApiClient, setAuthToken, handleApiError, ApiError } from './api';
import {
  Member,
  MemberCreate,
  MemberUpdate,
  MemberFilter,
  MemberStats,
  MemberProfile,
  MemberListResponse,
  MemberBulkCreate,
  MemberBulkResponse,
  MemberSkillAssignment,
  MemberStatusChange,
  MemberHierarchy,
  MemberExportOptions,
  MemberSearchOptions,
  EmploymentStatus,
  EmploymentType,
  SkillProficiency,
  MemberSort,
  MemberCacheEntry,
  MemberOperationResult
} from '../types/member';

// Environment configuration with defaults
const API_GATEWAY_URL = process.env.REACT_APP_API_GATEWAY_URL || 'http://localhost:8000';
const MEMBER_TIMEOUT = parseInt(process.env.REACT_APP_MEMBER_TIMEOUT || '30000', 10);
const MEMBER_CACHE_TTL = parseInt(process.env.REACT_APP_MEMBER_CACHE_TTL || '300000', 10);
const MEMBER_RETRY_COUNT = parseInt(process.env.REACT_APP_MEMBER_RETRY_COUNT || '3', 10);
const MEMBER_BULK_SIZE = parseInt(process.env.REACT_APP_MEMBER_BULK_SIZE || '100', 10);
const MEMBER_EXPORT_LIMIT = parseInt(process.env.REACT_APP_MEMBER_EXPORT_LIMIT || '10000', 10);
const MEMBER_FILE_SIZE_LIMIT = parseInt(process.env.REACT_APP_MEMBER_FILE_SIZE_LIMIT || '5242880', 10); // 5MB
const MAX_HIERARCHY_DEPTH = parseInt(process.env.REACT_APP_MAX_HIERARCHY_DEPTH || '10', 10);

// Cache management
const memberCache = new Map<string, MemberCacheEntry>();
const hierarchyCache = new Map<string, { data: MemberHierarchy; timestamp: number }>();
const statsCache = new Map<string, { data: MemberStats; timestamp: number }>();

// Active request tracking
const activeRequests = new Map<string, AbortController>();
const requestQueue: Array<() => Promise<any>> = [];
let isOnline = navigator.onLine;

// WebSocket connection for real-time updates
let wsConnection: WebSocket | null = null;
let wsReconnectTimer: NodeJS.Timeout | null = null;

// Offline queue management
const offlineQueue: Array<{
  id: string;
  operation: () => Promise<any>;
  timestamp: number;
}> = [];

// Performance monitoring
const performanceMetrics = {
  apiCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  averageResponseTime: 0
};

class MemberService {
  private apiClient: typeof ApiClient;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.apiClient = ApiClient;
    this.baseUrl = `${API_GATEWAY_URL}/api/v1/members`;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': uuidv4()
    };

    // Initialize event listeners
    this.initializeEventListeners();
    // Initialize WebSocket connection
    this.initializeWebSocket();
  }

  private initializeEventListeners(): void {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  private initializeWebSocket(): void {
    if (process.env.REACT_APP_ENABLE_REALTIME === 'true') {
      this.connectWebSocket();
    }
  }

  private connectWebSocket(): void {
    const wsUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:8000/ws';
    wsConnection = new WebSocket(`${wsUrl}/members`);

    wsConnection.onopen = () => {
      console.log('WebSocket connected for member updates');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    wsConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleRealtimeUpdate(data);
    };

    wsConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsConnection.onclose = () => {
      console.log('WebSocket disconnected, attempting reconnect...');
      wsReconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
    };
  }

  private handleRealtimeUpdate(data: any): void {
    const { type, payload } = data;
    
    switch (type) {
      case 'member.created':
      case 'member.updated':
        this.invalidateMemberCache(payload.id);
        this.invalidateStatsCache();
        break;
      case 'member.deleted':
        this.removeMemberFromCache(payload.id);
        this.invalidateStatsCache();
        break;
      case 'hierarchy.changed':
        this.invalidateHierarchyCache(payload.organization_id);
        break;
    }

    // Emit custom event for components to handle
    window.dispatchEvent(new CustomEvent('memberUpdate', { detail: data }));
  }

  private handleOnline = (): void => {
    isOnline = true;
    this.processOfflineQueue();
  };

  private handleOffline = (): void => {
    isOnline = false;
  };

  private async processOfflineQueue(): Promise<void> {
    while (offlineQueue.length > 0 && isOnline) {
      const item = offlineQueue.shift();
      if (item) {
        try {
          await item.operation();
        } catch (error) {
          console.error('Failed to process offline queue item:', error);
          // Re-queue if still relevant
          if (Date.now() - item.timestamp < 86400000) { // 24 hours
            offlineQueue.push(item);
          }
        }
      }
    }
  }

  private queueOfflineOperation(operation: () => Promise<any>): void {
    offlineQueue.push({
      id: uuidv4(),
      operation,
      timestamp: Date.now()
    });
  }

  private trackPerformance(startTime: number, success: boolean): void {
    const duration = Date.now() - startTime;
    performanceMetrics.apiCalls++;
    if (!success) performanceMetrics.errors++;
    
    performanceMetrics.averageResponseTime = 
      (performanceMetrics.averageResponseTime * (performanceMetrics.apiCalls - 1) + duration) / 
      performanceMetrics.apiCalls;
  }

  private getCacheKey(endpoint: string, params?: any): string {
    return `${endpoint}:${JSON.stringify(params || {})}`;
  }

  private getFromCache(key: string): Member | null {
    const cached = memberCache.get(key);
    if (cached && Date.now() - cached.timestamp < MEMBER_CACHE_TTL) {
      performanceMetrics.cacheHits++;
      return cached.data;
    }
    performanceMetrics.cacheMisses++;
    return null;
  }

  private setCache(key: string, data: Member): void {
    memberCache.set(key, {
      data: cloneDeep(data),
      timestamp: Date.now()
    });
  }

  private invalidateMemberCache(memberId?: string): void {
    if (memberId) {
      memberCache.delete(`member:${memberId}`);
    } else {
      memberCache.clear();
    }
  }

  private invalidateStatsCache(): void {
    statsCache.clear();
  }

  private invalidateHierarchyCache(organizationId?: string): void {
    if (organizationId) {
      hierarchyCache.delete(`hierarchy:${organizationId}`);
    } else {
      hierarchyCache.clear();
    }
  }

  private removeMemberFromCache(memberId: string): void {
    memberCache.delete(`member:${memberId}`);
  }

  private transformMemberForApi(member: MemberCreate | MemberUpdate): any {
    const transformed: any = {
      ...member,
      hire_date: member.hire_date ? format(new Date(member.hire_date), 'yyyy-MM-dd') : undefined,
      birth_date: member.birth_date ? format(new Date(member.birth_date), 'yyyy-MM-dd') : undefined,
      skills: member.skills?.map(skill => ({
        skill_name: skill.skill_name,
        proficiency: skill.proficiency,
        years_experience: skill.years_experience,
        last_used_date: skill.last_used_date ? format(new Date(skill.last_used_date), 'yyyy-MM-dd') : undefined
      })),
      address: member.address ? {
        street: member.address.street,
        city: member.address.city,
        state: member.address.state,
        postal_code: member.address.postal_code,
        country: member.address.country
      } : undefined
    };

    // Remove undefined values
    Object.keys(transformed).forEach(key => {
      if (transformed[key] === undefined) {
        delete transformed[key];
      }
    });

    return transformed;
  }

  private transformApiResponseToMember(response: any): Member {
    const member: Member = {
      ...response,
      hire_date: response.hire_date ? parseISO(response.hire_date) : undefined,
      birth_date: response.birth_date ? parseISO(response.birth_date) : undefined,
      created_at: parseISO(response.created_at),
      updated_at: parseISO(response.updated_at),
      full_name: `${response.first_name} ${response.last_name}`,
      tenure_years: response.hire_date ? differenceInYears(new Date(), parseISO(response.hire_date)) : 0,
      skills: response.skills?.map((skill: any) => ({
        ...skill,
        last_used_date: skill.last_used_date ? parseISO(skill.last_used_date) : undefined
      }))
    };

    return member;
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    retries: number = MEMBER_RETRY_COUNT
  ): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, i), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  private createAbortController(key: string): AbortController {
    const existing = activeRequests.get(key);
    if (existing) {
      existing.abort();
    }
    
    const controller = new AbortController();
    activeRequests.set(key, controller);
    return controller;
  }

  private cleanupAbortController(key: string): void {
    activeRequests.delete(key);
  }

  async createMember(memberData: MemberCreate): Promise<Member> {
    const startTime = Date.now();
    const correlationId = uuidv4();
    const abortKey = `create-member-${correlationId}`;
    const controller = this.createAbortController(abortKey);

    try {
      // Validate email uniqueness first
      const emailCheck = await this.checkEmailUniqueness(memberData.email);
      if (!emailCheck.isUnique) {
        throw new ApiError('Email already exists', 409, { email: ['Email is already in use'] });
      }

      // Validate organization exists
      if (memberData.organization_id) {
        await this.validateOrganization(memberData.organization_id);
      }

      const transformedData = this.transformMemberForApi(memberData);
      
      const response = await this.retryWithBackoff(() =>
        this.apiClient.post<Member>(
          this.baseUrl,
          transformedData,
          {
            headers: {
              ...this.defaultHeaders,
              'X-Correlation-ID': correlationId
            },
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const member = this.transformApiResponseToMember(response.data);
      this.setCache(`member:${member.id}`, member);
      this.invalidateStatsCache();
      
      this.trackPerformance(startTime, true);
      return member;
    } catch (error) {
      this.trackPerformance(startTime, false);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          throw new ApiError('Email already exists', 409, { email: ['This email is already registered'] });
        }
        if (error.response?.status === 422) {
          throw new ApiError('Validation failed', 422, error.response.data.detail);
        }
      }
      
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getMemberById(id: string): Promise<Member> {
    const startTime = Date.now();
    const cacheKey = `member:${id}`;
    const abortKey = `get-member-${id}`;
    
    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    const controller = this.createAbortController(abortKey);

    try {
      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<Member>(
          `${this.baseUrl}/${id}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const member = this.transformApiResponseToMember(response.data);
      this.setCache(cacheKey, member);
      
      this.trackPerformance(startTime, true);
      return member;
    } catch (error) {
      this.trackPerformance(startTime, false);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new ApiError('Member not found', 404, { id: [`Member with ID ${id} not found`] });
        }
        if (error.response?.status === 403) {
          throw new ApiError('Permission denied', 403, { id: ['You do not have permission to view this member'] });
        }
      }
      
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getMembers(filter?: MemberFilter): Promise<MemberListResponse> {
    const startTime = Date.now();
    const abortKey = `get-members-${JSON.stringify(filter)}`;
    const controller = this.createAbortController(abortKey);

    try {
      const params = new URLSearchParams();
      
      if (filter) {
        if (filter.page) params.append('page', filter.page.toString());
        if (filter.limit) params.append('limit', filter.limit.toString());
        if (filter.organization_id) params.append('organization_id', filter.organization_id);
        if (filter.department) params.append('department', filter.department);
        if (filter.job_title) params.append('job_title', filter.job_title);
        if (filter.employment_status) params.append('employment_status', filter.employment_status);
        if (filter.employment_type) params.append('employment_type', filter.employment_type);
        if (filter.manager_id) params.append('manager_id', filter.manager_id);
        if (filter.location) params.append('location', filter.location);
        if (filter.hire_date_from) params.append('hire_date_from', format(filter.hire_date_from, 'yyyy-MM-dd'));
        if (filter.hire_date_to) params.append('hire_date_to', format(filter.hire_date_to, 'yyyy-MM-dd'));
        if (filter.salary_min) params.append('salary_min', filter.salary_min.toString());
        if (filter.salary_max) params.append('salary_max', filter.salary_max.toString());
        if (filter.skills) filter.skills.forEach(skill => params.append('skills', skill));
        if (filter.search) params.append('search', filter.search);
        if (filter.sort_by) params.append('sort_by', filter.sort_by);
        if (filter.sort_order) params.append('sort_order', filter.sort_order);
      }

      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<MemberListResponse>(
          `${this.baseUrl}?${params.toString()}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const transformedResponse: MemberListResponse = {
        ...response.data,
        items: response.data.items.map(item => this.transformApiResponseToMember(item))
      };

      // Cache individual members
      transformedResponse.items.forEach(member => {
        this.setCache(`member:${member.id}`, member);
      });

      this.trackPerformance(startTime, true);
      return transformedResponse;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async updateMember(id: string, updates: MemberUpdate): Promise<Member> {
    const startTime = Date.now();
    const correlationId = uuidv4();
    const abortKey = `update-member-${id}`;
    const controller = this.createAbortController(abortKey);

    try {
      // Handle optimistic locking
      if (updates.version !== undefined) {
        const currentMember = await this.getMemberById(id);
        if (currentMember.version !== updates.version) {
          throw new ApiError('Concurrent update conflict', 409, {
            version: ['Member has been updated by another user. Please refresh and try again.']
          });
        }
      }

      // Validate employment status transitions
      if (updates.employment_status) {
        await this.validateStatusTransition(id, updates.employment_status);
      }

      const transformedData = this.transformMemberForApi(updates);
      
      const response = await this.retryWithBackoff(() =>
        this.apiClient.patch<Member>(
          `${this.baseUrl}/${id}`,
          transformedData,
          {
            headers: {
              ...this.defaultHeaders,
              'X-Correlation-ID': correlationId
            },
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const member = this.transformApiResponseToMember(response.data);
      this.setCache(`member:${member.id}`, member);
      this.invalidateStatsCache();
      
      this.trackPerformance(startTime, true);
      return member;
    } catch (error) {
      this.trackPerformance(startTime, false);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          throw new ApiError('Update conflict', 409, error.response.data.detail);
        }
        if (error.response?.status === 422) {
          throw new ApiError('Validation failed', 422, error.response.data.detail);
        }
      }
      
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async deleteMember(id: string, confirmDeletion: boolean = false): Promise<void> {
    const startTime = Date.now();
    const abortKey = `delete-member-${id}`;
    const controller = this.createAbortController(abortKey);

    try {
      if (!confirmDeletion) {
        throw new ApiError('Deletion not confirmed', 400, {
          confirmation: ['Please confirm member deletion']
        });
      }

      // Check for subordinates
      const subordinates = await this.getSubordinates(id);
      if (subordinates.length > 0) {
        throw new ApiError('Cannot delete member with subordinates', 409, {
          subordinates: [`Member has ${subordinates.length} subordinates. Please reassign them first.`]
        });
      }

      await this.retryWithBackoff(() =>
        this.apiClient.delete(
          `${this.baseUrl}/${id}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      this.removeMemberFromCache(id);
      this.invalidateStatsCache();
      this.invalidateHierarchyCache();
      
      this.trackPerformance(startTime, true);
    } catch (error) {
      this.trackPerformance(startTime, false);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          throw new ApiError('Referential integrity violation', 409, error.response.data.detail);
        }
      }
      
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getMemberStatistics(organizationId?: string): Promise<MemberStats> {
    const startTime = Date.now();
    const cacheKey = `stats:${organizationId || 'all'}`;
    const abortKey = `get-stats-${organizationId || 'all'}`;
    
    // Check cache
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MEMBER_CACHE_TTL) {
      return cached.data;
    }

    const controller = this.createAbortController(abortKey);

    try {
      const params = organizationId ? `?organization_id=${organizationId}` : '';
      
      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<MemberStats>(
          `${this.baseUrl}/stats${params}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const stats = response.data;
      
      // Transform dates in recent hires
      if (stats.recent_hires) {
        stats.recent_hires = stats.recent_hires.map(hire => ({
          ...hire,
          hire_date: parseISO(hire.hire_date as any)
        }));
      }

      statsCache.set(cacheKey, { data: stats, timestamp: Date.now() });
      
      this.trackPerformance(startTime, true);
      return stats;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getMembersByOrganization(
    organizationId: string,
    filter?: MemberFilter
  ): Promise<MemberListResponse> {
    return this.getMembers({
      ...filter,
      organization_id: organizationId
    });
  }

  async bulkCreateMembers(members: MemberBulkCreate): Promise<MemberBulkResponse> {
    const startTime = Date.now();
    const correlationId = uuidv4();
    const abortKey = `bulk-create-${correlationId}`;
    const controller = this.createAbortController(abortKey);

    try {
      // Validate batch size
      if (members.members.length > MEMBER_BULK_SIZE) {
        throw new ApiError('Batch size exceeded', 400, {
          batch_size: [`Maximum batch size is ${MEMBER_BULK_SIZE}`]
        });
      }

      // Check email uniqueness within batch
      const emails = members.members.map(m => m.email);
      const uniqueEmails = new Set(emails);
      if (emails.length !== uniqueEmails.size) {
        throw new ApiError('Duplicate emails in batch', 400, {
          emails: ['Batch contains duplicate email addresses']
        });
      }

      // Transform all members
      const transformedMembers = members.members.map(m => this.transformMemberForApi(m));

      const response = await this.retryWithBackoff(() =>
        this.apiClient.post<MemberBulkResponse>(
          `${this.baseUrl}/bulk`,
          { members: transformedMembers },
          {
            headers: {
              ...this.defaultHeaders,
              'X-Correlation-ID': correlationId
            },
            timeout: MEMBER_TIMEOUT * 2, // Double timeout for bulk operations
            signal: controller.signal,
            onUploadProgress: (progressEvent) => {
              const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total!);
              window.dispatchEvent(new CustomEvent('bulkProgress', { detail: { progress } }));
            }
          }
        )
      );

      // Cache successful members
      response.data.successful.forEach(member => {
        const transformed = this.transformApiResponseToMember(member);
        this.setCache(`member:${transformed.id}`, transformed);
      });

      this.invalidateStatsCache();
      
      this.trackPerformance(startTime, true);
      return response.data;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async exportMembers(options: MemberExportOptions): Promise<Blob> {
    const startTime = Date.now();
    const abortKey = `export-members-${JSON.stringify(options)}`;
    const controller = this.createAbortController(abortKey);

    try {
      const params = new URLSearchParams();
      params.append('format', options.format);
      
      if (options.fields) {
        options.fields.forEach(field => params.append('fields', field));
      }
      
      if (options.filter) {
        Object.entries(options.filter).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, value.toString());
          }
        });
      }

      if (options.anonymize) {
        params.append('anonymize', 'true');
      }

      const response = await this.retryWithBackoff(() =>
        this.apiClient.get(
          `${this.baseUrl}/export?${params.toString()}`,
          {
            headers: this.defaultHeaders,
            responseType: 'blob',
            timeout: MEMBER_TIMEOUT * 3, // Triple timeout for exports
            signal: controller.signal,
            onDownloadProgress: (progressEvent) => {
              const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total!);
              window.dispatchEvent(new CustomEvent('exportProgress', { detail: { progress } }));
            }
          }
        )
      );

      const blob = new Blob([response.data], {
        type: options.format === 'csv' ? 'text/csv' : 
              options.format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
              'application/json'
      });

      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `members_export_${format(new Date(), 'yyyyMMdd_HHmmss')}.${options.format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      this.trackPerformance(startTime, true);
      return blob;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async searchMembers(options: MemberSearchOptions): Promise<MemberListResponse> {
    const startTime = Date.now();
    const abortKey = `search-members-${JSON.stringify(options)}`;
    const controller = this.createAbortController(abortKey);

    try {
      const params = new URLSearchParams();
      params.append('q', options.query);
      
      if (options.searchFields) {
        options.searchFields.forEach(field => params.append('search_fields', field));
      }
      
      if (options.filters) {
        Object.entries(options.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(key, value.toString());
          }
        });
      }

      if (options.highlight) {
        params.append('highlight', 'true');
      }

      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<MemberListResponse>(
          `${this.baseUrl}/search?${params.toString()}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const transformedResponse: MemberListResponse = {
        ...response.data,
        items: response.data.items.map(item => this.transformApiResponseToMember(item))
      };

      this.trackPerformance(startTime, true);
      return transformedResponse;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getOrganizationalHierarchy(organizationId: string): Promise<MemberHierarchy> {
    const startTime = Date.now();
    const cacheKey = `hierarchy:${organizationId}`;
    const abortKey = `get-hierarchy-${organizationId}`;
    
    // Check cache
    const cached = hierarchyCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MEMBER_CACHE_TTL) {
      return cached.data;
    }

    const controller = this.createAbortController(abortKey);

    try {
      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<MemberHierarchy>(
          `${this.baseUrl}/hierarchy?organization_id=${organizationId}`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT * 2, // Double timeout for hierarchy
            signal: controller.signal
          }
        )
      );

      const hierarchy = this.buildOrganizationalHierarchy(response.data);
      hierarchyCache.set(cacheKey, { data: hierarchy, timestamp: Date.now() });
      
      this.trackPerformance(startTime, true);
      return hierarchy;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async manageMemberSkills(
    memberId: string,
    skills: MemberSkillAssignment[]
  ): Promise<Member> {
    const startTime = Date.now();
    const abortKey = `manage-skills-${memberId}`;
    const controller = this.createAbortController(abortKey);

    try {
      // Validate skill taxonomy
      for (const skill of skills) {
        await this.validateSkillTaxonomy(skill.skill_name);
      }

      const response = await this.retryWithBackoff(() =>
        this.apiClient.post<Member>(
          `${this.baseUrl}/${memberId}/skills`,
          { skills },
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const member = this.transformApiResponseToMember(response.data);
      this.setCache(`member:${member.id}`, member);
      
      this.trackPerformance(startTime, true);
      return member;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async updateMemberStatus(
    memberId: string,
    statusChange: MemberStatusChange
  ): Promise<Member> {
    const startTime = Date.now();
    const abortKey = `update-status-${memberId}`;
    const controller = this.createAbortController(abortKey);

    try {
      // Validate status transition
      await this.validateStatusTransition(memberId, statusChange.new_status);

      const response = await this.retryWithBackoff(() =>
        this.apiClient.put<Member>(
          `${this.baseUrl}/${memberId}/status`,
          {
            ...statusChange,
            effective_date: statusChange.effective_date ? 
              format(statusChange.effective_date, 'yyyy-MM-dd') : undefined
          },
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const member = this.transformApiResponseToMember(response.data);
      this.setCache(`member:${member.id}`, member);
      this.invalidateStatsCache();
      
      // Trigger notification
      if (statusChange.notify) {
        this.triggerStatusChangeNotification(member, statusChange);
      }
      
      this.trackPerformance(startTime, true);
      return member;
    } catch (error) {
      this.trackPerformance(startTime, false);
      
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 422) {
          throw new ApiError('Invalid status transition', 422, error.response.data.detail);
        }
      }
      
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  async getMemberProfile(memberId: string): Promise<MemberProfile> {
    const startTime = Date.now();
    const abortKey = `get-profile-${memberId}`;
    const controller = this.createAbortController(abortKey);

    try {
      const response = await this.retryWithBackoff(() =>
        this.apiClient.get<MemberProfile>(
          `${this.baseUrl}/${memberId}/profile`,
          {
            headers: this.defaultHeaders,
            timeout: MEMBER_TIMEOUT,
            signal: controller.signal
          }
        )
      );

      const profile = {
        ...response.data,
        member: this.transformApiResponseToMember(response.data.member),
        work_experience: response.data.work_experience?.map((exp: any) => ({
          ...exp,
          start_date: exp.start_date ? parseISO(exp.start_date) : undefined,
          end_date: exp.end_date ? parseISO(exp.end_date) : undefined
        })),
        education: response.data.education?.map((edu: any) => ({
          ...edu,
          start_date: edu.start_date ? parseISO(edu.start_date) : undefined,
          end_date: edu.end_date ? parseISO(edu.end_date) : undefined
        }))
      };

      this.trackPerformance(startTime, true);
      return profile;
    } catch (error) {
      this.trackPerformance(startTime, false);
      throw handleApiError(error);
    } finally {
      this.cleanupAbortController(abortKey);
    }
  }

  // Utility methods
  private async checkEmailUniqueness(email: string): Promise<{ isUnique: boolean }> {
    try {
      const response = await this.apiClient.get(
        `${this.baseUrl}/check-email?email=${encodeURIComponent(email)}`,
        { headers: this.defaultHeaders }
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        return { isUnique: false };
      }
      throw error;
    }
  }

  private async validateOrganization(organizationId: string): Promise<void> {
    try {
      await this.apiClient.get(
        `/api/v1/organizations/${organizationId}`,
        { headers: this.defaultHeaders }
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new ApiError('Invalid organization', 422, {
          organization_id: ['Organization does not exist']
        });
      }
      throw error;
    }
  }

  private async validateStatusTransition(
    memberId: string,
    newStatus: EmploymentStatus
  ): Promise<void> {
    const member = await this.getMemberById(memberId);
    const currentStatus = member.employment_status;

    // Define valid transitions
    const validTransitions: Record<EmploymentStatus, EmploymentStatus[]> = {
      [EmploymentStatus.ACTIVE]: [EmploymentStatus.ON_LEAVE, EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED],
      [EmploymentStatus.ON_LEAVE]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED],
      [EmploymentStatus.TERMINATED]: [],
      [EmploymentStatus.RESIGNED]: [],
      [EmploymentStatus.PENDING]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED]
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new ApiError('Invalid status transition', 422, {
        status: [`Cannot transition from ${currentStatus} to ${newStatus}`]
      });
    }
  }

  private async getSubordinates(managerId: string): Promise<Member[]> {
    const response = await this.getMembers({ manager_id: managerId });
    return response.items;
  }

  private async validateSkillTaxonomy(skillName: string): Promise<void> {
    // TODO: Implement skill taxonomy validation
    // This would check against a predefined skill taxonomy
    return Promise.resolve();
  }

  private triggerStatusChangeNotification(
    member: Member,
    statusChange: MemberStatusChange
  ): void {
    // TODO: Implement notification system integration
    window.dispatchEvent(new CustomEvent('memberStatusChanged', {
      detail: { member, statusChange }
    }));
  }

  private buildOrganizationalHierarchy(data: any): MemberHierarchy {
    // TODO: Implement hierarchy building logic
    // This would construct the tree structure from flat data
    return data;
  }

  // Public utility methods
  clearMemberCache(): void {
    memberCache.clear();
    hierarchyCache.clear();
    statsCache.clear();
  }

  getPerformanceMetrics(): typeof performanceMetrics {
    return { ...performanceMetrics };
  }

  cleanup(): void {
    // Clean up event listeners
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);

    // Close WebSocket
    if (wsConnection) {
      wsConnection.close();
    }

    // Clear reconnect timer
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
    }

    // Abort all active requests
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();

    // Clear caches
    this.clearMemberCache();
  }
}

// Create singleton instance
const memberService = new MemberService();

// Export service instance and utilities
export default memberService;

export {
  memberService,
  MemberService
};

// Export utility functions
export const transformMemberForApi = (member: MemberCreate | MemberUpdate): any => {
  return memberService['transformMemberForApi'](member);
};

export const transformApiResponseToMember = (response: any): Member => {
  return memberService['transformApiResponseToMember'](response);
};

export const validateMemberData = (data: Partial<Member>): { isValid: boolean; errors: Record<string, string[]> } => {
  const errors: Record<string, string[]> = {};

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.email = ['Invalid email format'];
  }

  if (!data.first_name || data.first_name.trim().length < 2) {
    errors.first_name = ['First name must be at least 2 characters'];
  }

  if (!data.last_name || data.last_name.trim().length < 2) {
    errors.last_name = ['Last name must be at least 2 characters'];
  }

  if (data.phone && !/^\+?[\d\s-()]+$/.test(data.phone)) {
    errors.phone = ['Invalid phone number format'];
  }

  if (data.salary && data.salary < 0) {
    errors.salary = ['Salary cannot be negative'];
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

export const buildOrganizationalHierarchy = (members: Member[]): MemberHierarchy => {
  const memberMap = new Map(members.map(m => [m.id, m]));
  const roots: Member[] = [];
  const hierarchy: MemberHierarchy = {
    roots: [],
    levels: {},
    total_members: members.length,
    max_depth: 0
  };

  // Build hierarchy
  members.forEach(member => {
    if (!member.manager_id || !memberMap.has(member.manager_id)) {
      roots.push(member);
    }
  });

  // TODO: Complete hierarchy building implementation
  hierarchy.roots = roots;
  
  return hierarchy;
};

export const isMemberError = (error: any): error is ApiError => {
  return error instanceof ApiError || (error?.response?.data?.detail !== undefined);
};

export const getMemberErrorMessage = (error: any): string => {
  if (isMemberError(error)) {
    if (typeof error.details === 'string') {
      return error.details;
    }
    if (typeof error.details === 'object') {
      return Object.values(error.details).flat().join(', ');
    }
  }
  return error?.message || 'An unexpected error occurred';
};

export const clearMemberCache = (): void => {
  memberService.clearMemberCache();
};

export const invalidateMemberCache = (memberId?: string): void => {
  if (memberId) {
    memberCache.delete(`member:${memberId}`);
  } else {
    memberCache.clear();
  }
};
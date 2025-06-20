import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { debounce, isEqual, cloneDeep } from 'lodash';
import { format, isAfter, isBefore } from 'date-fns';
import feedbackService from '../services/feedbackService';
import {
  Feedback,
  FeedbackCreate,
  FeedbackUpdate,
  FeedbackFilter,
  FeedbackStats,
  FeedbackListResponse
} from '../types/feedback';
import useDebounce from './useDebounce';
import useNotification from './useNotification';
import useAuth from './useAuth';
import useWebSocket from './useWebSocket';
import useLocalStorage from './useLocalStorage';

// Configuration interfaces
export interface FeedbackHookConfig {
  organizationId?: string;
  memberId?: string;
  autoRefresh?: boolean;
  cacheEnabled?: boolean;
  initialFilters?: Partial<FeedbackFilter>;
}

export interface FeedbackHookReturn {
  feedbacks: Feedback[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filters: FeedbackFilter;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  selectedFeedbacks: string[];
  statistics: FeedbackStats | null;
  lastUpdated: Date | null;
  fetchFeedbacks: () => Promise<void>;
  createFeedback: (data: FeedbackCreate) => Promise<Feedback | null>;
  updateFeedback: (id: string, data: FeedbackUpdate) => Promise<Feedback | null>;
  deleteFeedback: (id: string) => Promise<boolean>;
  getFeedbackById: (id: string) => Promise<Feedback | null>;
  bulkDeleteFeedbacks: (ids: string[]) => Promise<{ success: string[]; failed: string[] }>;
  exportFeedbacks: (format: 'csv' | 'json' | 'pdf') => Promise<void>;
  searchFeedbacks: (query: string) => Promise<void>;
  getFeedbackStatistics: () => Promise<void>;
  setFilters: (filters: Partial<FeedbackFilter>) => void;
  setSorting: (field: string) => void;
  setPagination: (page: number, size?: number) => void;
  toggleFeedbackSelection: (id: string) => void;
  clearSelection: () => void;
  refreshData: () => Promise<void>;
  invalidateCache: () => void;
}

// Environment configuration
const CACHE_TTL = parseInt(process.env.REACT_APP_FEEDBACK_CACHE_TTL || '300000');
const AUTO_REFRESH_INTERVAL = parseInt(process.env.REACT_APP_FEEDBACK_REFRESH_INTERVAL || '30000');
const MAX_RETRIES = parseInt(process.env.REACT_APP_FEEDBACK_MAX_RETRIES || '3');
const SEARCH_DEBOUNCE = parseInt(process.env.REACT_APP_FEEDBACK_SEARCH_DEBOUNCE || '300');
const MAX_BULK_SIZE = parseInt(process.env.REACT_APP_FEEDBACK_MAX_BULK_SIZE || '100');
const WEBSOCKET_RECONNECT_TIMEOUT = parseInt(process.env.REACT_APP_WEBSOCKET_RECONNECT_TIMEOUT || '5000');
const CACHE_QUOTA = parseInt(process.env.REACT_APP_FEEDBACK_CACHE_QUOTA || '10485760'); // 10MB

// Utility functions
export const createFeedbackFilter = (params: Partial<FeedbackFilter>): FeedbackFilter => ({
  search: params.search || '',
  memberId: params.memberId,
  organizationId: params.organizationId,
  feedbackType: params.feedbackType,
  minRating: params.minRating,
  maxRating: params.maxRating,
  startDate: params.startDate,
  endDate: params.endDate,
  skills: params.skills || [],
  isAnonymous: params.isAnonymous,
  hasAttachments: params.hasAttachments,
  page: params.page || 1,
  pageSize: params.pageSize || 20,
  sortBy: params.sortBy || 'createdAt',
  sortOrder: params.sortOrder || 'desc'
});

export const validateFeedbackData = (data: FeedbackCreate | FeedbackUpdate): string[] => {
  const errors: string[] = [];
  
  if ('content' in data && (!data.content || data.content.trim().length < 10)) {
    errors.push('Feedback content must be at least 10 characters long');
  }
  
  if ('rating' in data && (data.rating < 1 || data.rating > 5)) {
    errors.push('Rating must be between 1 and 5');
  }
  
  if ('feedbackType' in data && !['performance', 'behavioral', 'technical', 'general'].includes(data.feedbackType)) {
    errors.push('Invalid feedback type');
  }
  
  return errors;
};

export const formatFeedbackForDisplay = (feedback: Feedback): any => ({
  ...feedback,
  createdAtFormatted: format(new Date(feedback.createdAt), 'MMM dd, yyyy HH:mm'),
  updatedAtFormatted: feedback.updatedAt ? format(new Date(feedback.updatedAt), 'MMM dd, yyyy HH:mm') : null,
  ratingDisplay: '★'.repeat(feedback.rating) + '☆'.repeat(5 - feedback.rating)
});

const useFeedback = (config: FeedbackHookConfig = {}): FeedbackHookReturn => {
  // State management
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFiltersState] = useState<FeedbackFilter>(createFeedbackFilter({
    ...config.initialFilters,
    organizationId: config.organizationId,
    memberId: config.memberId
  }));
  const [sortBy, setSortBy] = useState(config.initialFilters?.sortBy || 'createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(config.initialFilters?.sortOrder || 'desc');
  const [selectedFeedbacks, setSelectedFeedbacks] = useState<string[]>([]);
  const [statistics, setStatistics] = useState<FeedbackStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Refs
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<{ [key: string]: number }>({});
  const cacheRef = useRef<Map<string, { data: any; timestamp: number }>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Hooks
  const { showNotification } = useNotification();
  const { user, hasPermission } = useAuth();
  const { subscribe, unsubscribe, send } = useWebSocket();
  const [cachedData, setCachedData] = useLocalStorage('feedback-cache', {});
  
  // Debounced search
  const debouncedSearchRef = useRef<ReturnType<typeof debounce> | null>(null);

  // Error handling utilities
  const handleApiError = useCallback((error: any, operation: string) => {
    console.error(`Feedback hook error during ${operation}:`, error);
    
    let errorMessage = 'An unexpected error occurred';
    
    if (error.response) {
      switch (error.response.status) {
        case 400:
          errorMessage = error.response.data?.detail || 'Invalid request data';
          break;
        case 401:
          errorMessage = 'Authentication required';
          // TODO: Trigger authentication refresh
          break;
        case 403:
          errorMessage = 'You do not have permission to perform this action';
          break;
        case 404:
          errorMessage = 'Feedback not found';
          break;
        case 409:
          errorMessage = 'Conflict: The feedback has been modified by another user';
          break;
        case 429:
          errorMessage = 'Too many requests. Please try again later';
          break;
        case 500:
          errorMessage = 'Server error. Please try again later';
          break;
        default:
          errorMessage = error.response.data?.detail || errorMessage;
      }
    } else if (error.request) {
      errorMessage = 'Network error. Please check your connection';
    }
    
    setError(errorMessage);
    showNotification({
      type: 'error',
      message: errorMessage,
      duration: 5000
    });
    
    return errorMessage;
  }, [showNotification]);

  // Cache management utilities
  const getCachedData = useCallback((key: string): any | null => {
    if (!config.cacheEnabled) return null;
    
    const cached = cacheRef.current.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
      cacheRef.current.delete(key);
      return null;
    }
    
    return cached.data;
  }, [config.cacheEnabled]);

  const setCachedDataInternal = useCallback((key: string, data: any) => {
    if (!config.cacheEnabled) return;
    
    // Check cache quota
    if (cacheRef.current.size * 1024 > CACHE_QUOTA) {
      // Remove oldest entries
      const entries = Array.from(cacheRef.current.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      while (cacheRef.current.size * 1024 > CACHE_QUOTA * 0.8 && entries.length > 0) {
        const [oldestKey] = entries.shift()!;
        cacheRef.current.delete(oldestKey);
      }
    }
    
    cacheRef.current.set(key, {
      data,
      timestamp: Date.now()
    });
  }, [config.cacheEnabled]);

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
    setCachedData({});
  }, [setCachedData]);

  // Real-time update handlers
  const handleFeedbackCreated = useCallback((feedback: Feedback) => {
    setFeedbacks(prev => {
      const exists = prev.some(f => f.id === feedback.id);
      if (exists) return prev;
      
      // Add to beginning if sorting by created date desc
      if (sortBy === 'createdAt' && sortOrder === 'desc') {
        return [feedback, ...prev.slice(0, pageSize - 1)];
      }
      
      return [...prev, feedback];
    });
    
    setTotalCount(prev => prev + 1);
    showNotification({
      type: 'info',
      message: 'New feedback received',
      duration: 3000
    });
  }, [sortBy, sortOrder, pageSize, showNotification]);

  const handleFeedbackUpdated = useCallback((feedback: Feedback) => {
    setFeedbacks(prev => prev.map(f => f.id === feedback.id ? feedback : f));
    
    showNotification({
      type: 'info',
      message: 'Feedback updated',
      duration: 3000
    });
  }, [showNotification]);

  const handleFeedbackDeleted = useCallback((feedbackId: string) => {
    setFeedbacks(prev => prev.filter(f => f.id !== feedbackId));
    setTotalCount(prev => Math.max(0, prev - 1));
    setSelectedFeedbacks(prev => prev.filter(id => id !== feedbackId));
    
    showNotification({
      type: 'info',
      message: 'Feedback deleted',
      duration: 3000
    });
  }, [showNotification]);

  const handleBulkOperationCompleted = useCallback((result: any) => {
    if (result.operation === 'delete') {
      setFeedbacks(prev => prev.filter(f => !result.successIds.includes(f.id)));
      setTotalCount(prev => Math.max(0, prev - result.successIds.length));
      setSelectedFeedbacks([]);
      
      showNotification({
        type: 'success',
        message: `${result.successIds.length} feedbacks deleted successfully`,
        duration: 4000
      });
    }
  }, [showNotification]);

  // Performance optimization utilities
  const optimisticUpdate = useCallback((
    updateFn: (prev: Feedback[]) => Feedback[],
    rollbackFn?: (error: any) => void
  ) => {
    const previousState = cloneDeep(feedbacks);
    setFeedbacks(updateFn);
    
    return {
      rollback: () => {
        setFeedbacks(previousState);
        if (rollbackFn) rollbackFn(previousState);
      }
    };
  }, [feedbacks]);

  // Retry operation with exponential backoff
  const retryOperation = useCallback(async (
    operation: () => Promise<any>,
    operationKey: string,
    maxRetries: number = MAX_RETRIES
  ): Promise<any> => {
    const retryCount = retryCountRef.current[operationKey] || 0;
    
    try {
      const result = await operation();
      retryCountRef.current[operationKey] = 0;
      return result;
    } catch (error) {
      if (retryCount < maxRetries) {
        retryCountRef.current[operationKey] = retryCount + 1;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryOperation(operation, operationKey, maxRetries);
      }
      
      retryCountRef.current[operationKey] = 0;
      throw error;
    }
  }, []);

  // Main operations
  const fetchFeedbacks = useCallback(async () => {
    // Check cache first
    const cacheKey = JSON.stringify({ filters, currentPage, pageSize, sortBy, sortOrder });
    const cachedResult = getCachedData(cacheKey);
    
    if (cachedResult) {
      setFeedbacks(cachedResult.feedbacks);
      setTotalCount(cachedResult.totalCount);
      setLastUpdated(new Date(cachedResult.timestamp));
      return;
    }
    
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await retryOperation(
        () => feedbackService.getFeedbacks({
          ...filters,
          page: currentPage,
          pageSize,
          sortBy,
          sortOrder
        }, abortControllerRef.current?.signal),
        'fetchFeedbacks'
      );
      
      setFeedbacks(response.data);
      setTotalCount(response.total);
      setLastUpdated(new Date());
      
      // Cache the result
      setCachedDataInternal(cacheKey, {
        feedbacks: response.data,
        totalCount: response.total,
        timestamp: Date.now()
      });
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        handleApiError(error, 'fetchFeedbacks');
      }
    } finally {
      setLoading(false);
    }
  }, [filters, currentPage, pageSize, sortBy, sortOrder, getCachedData, setCachedDataInternal, retryOperation, handleApiError]);

  const createFeedback = useCallback(async (data: FeedbackCreate): Promise<Feedback | null> => {
    // Validate input
    const validationErrors = validateFeedbackData(data);
    if (validationErrors.length > 0) {
      handleApiError({ response: { status: 400, data: { detail: validationErrors.join(', ') } } }, 'createFeedback');
      return null;
    }
    
    // Check permissions
    if (!hasPermission('feedback:create')) {
      handleApiError({ response: { status: 403 } }, 'createFeedback');
      return null;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const newFeedback = await retryOperation(
        () => feedbackService.createFeedback(data),
        'createFeedback'
      );
      
      // Optimistic update
      const { rollback } = optimisticUpdate(prev => [newFeedback, ...prev]);
      
      setTotalCount(prev => prev + 1);
      invalidateCache();
      
      showNotification({
        type: 'success',
        message: 'Feedback created successfully',
        duration: 4000
      });
      
      // Broadcast to other users
      send('feedback:created', newFeedback);
      
      return newFeedback;
    } catch (error) {
      handleApiError(error, 'createFeedback');
      return null;
    } finally {
      setLoading(false);
    }
  }, [hasPermission, retryOperation, optimisticUpdate, invalidateCache, showNotification, send, handleApiError]);

  const updateFeedback = useCallback(async (id: string, data: FeedbackUpdate): Promise<Feedback | null> => {
    // Validate input
    const validationErrors = validateFeedbackData(data);
    if (validationErrors.length > 0) {
      handleApiError({ response: { status: 400, data: { detail: validationErrors.join(', ') } } }, 'updateFeedback');
      return null;
    }
    
    // Check permissions
    if (!hasPermission('feedback:update')) {
      handleApiError({ response: { status: 403 } }, 'updateFeedback');
      return null;
    }
    
    const originalFeedback = feedbacks.find(f => f.id === id);
    if (!originalFeedback) {
      handleApiError({ response: { status: 404 } }, 'updateFeedback');
      return null;
    }
    
    setLoading(true);
    setError(null);
    
    // Optimistic update
    const { rollback } = optimisticUpdate(prev => 
      prev.map(f => f.id === id ? { ...f, ...data, updatedAt: new Date().toISOString() } : f)
    );
    
    try {
      const updatedFeedback = await retryOperation(
        () => feedbackService.updateFeedback(id, data),
        `updateFeedback-${id}`
      );
      
      setFeedbacks(prev => prev.map(f => f.id === id ? updatedFeedback : f));
      invalidateCache();
      
      showNotification({
        type: 'success',
        message: 'Feedback updated successfully',
        duration: 4000
      });
      
      // Broadcast to other users
      send('feedback:updated', updatedFeedback);
      
      return updatedFeedback;
    } catch (error: any) {
      rollback();
      
      // Handle version conflicts
      if (error.response?.status === 409) {
        const shouldRetry = window.confirm(
          'This feedback has been modified by another user. Do you want to reload and try again?'
        );
        
        if (shouldRetry) {
          await fetchFeedbacks();
        }
      }
      
      handleApiError(error, 'updateFeedback');
      return null;
    } finally {
      setLoading(false);
    }
  }, [feedbacks, hasPermission, retryOperation, optimisticUpdate, invalidateCache, showNotification, send, fetchFeedbacks, handleApiError]);

  const deleteFeedback = useCallback(async (id: string): Promise<boolean> => {
    // Check permissions
    if (!hasPermission('feedback:delete')) {
      handleApiError({ response: { status: 403 } }, 'deleteFeedback');
      return false;
    }
    
    // Confirmation dialog
    const confirmed = window.confirm('Are you sure you want to delete this feedback? This action cannot be undone.');
    if (!confirmed) return false;
    
    const feedbackToDelete = feedbacks.find(f => f.id === id);
    if (!feedbackToDelete) {
      handleApiError({ response: { status: 404 } }, 'deleteFeedback');
      return false;
    }
    
    setLoading(true);
    setError(null);
    
    // Optimistic update
    const { rollback } = optimisticUpdate(prev => prev.filter(f => f.id !== id));
    setTotalCount(prev => Math.max(0, prev - 1));
    
    try {
      await retryOperation(
        () => feedbackService.deleteFeedback(id),
        `deleteFeedback-${id}`
      );
      
      invalidateCache();
      
      showNotification({
        type: 'success',
        message: 'Feedback deleted successfully',
        duration: 4000,
        action: {
          label: 'Undo',
          onClick: async () => {
            // TODO: Implement undo functionality
            showNotification({
              type: 'info',
              message: 'Undo functionality not yet implemented',
              duration: 3000
            });
          }
        }
      });
      
      // Broadcast to other users
      send('feedback:deleted', { id });
      
      return true;
    } catch (error) {
      rollback();
      setTotalCount(prev => prev + 1);
      handleApiError(error, 'deleteFeedback');
      return false;
    } finally {
      setLoading(false);
    }
  }, [feedbacks, hasPermission, retryOperation, optimisticUpdate, invalidateCache, showNotification, send, handleApiError]);

  const getFeedbackById = useCallback(async (id: string): Promise<Feedback | null> => {
    // Check local cache first
    const cachedFeedback = feedbacks.find(f => f.id === id);
    if (cachedFeedback) return cachedFeedback;
    
    // Check persistent cache
    const cacheKey = `feedback-${id}`;
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
    
    setLoading(true);
    setError(null);
    
    try {
      const feedback = await retryOperation(
        () => feedbackService.getFeedbackById(id),
        `getFeedbackById-${id}`
      );
      
      // Cache the result
      setCachedDataInternal(cacheKey, feedback);
      
      return feedback;
    } catch (error: any) {
      if (error.response?.status === 404) {
        showNotification({
          type: 'warning',
          message: 'Feedback not found',
          duration: 3000
        });
      } else {
        handleApiError(error, 'getFeedbackById');
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [feedbacks, getCachedData, retryOperation, setCachedDataInternal, showNotification, handleApiError]);

  const bulkDeleteFeedbacks = useCallback(async (ids: string[]): Promise<{ success: string[]; failed: string[] }> => {
    // Validate bulk operation size
    if (ids.length > MAX_BULK_SIZE) {
      handleApiError(
        { response: { status: 400, data: { detail: `Maximum bulk size is ${MAX_BULK_SIZE}` } } },
        'bulkDeleteFeedbacks'
      );
      return { success: [], failed: ids };
    }
    
    // Check permissions
    if (!hasPermission('feedback:bulk-delete')) {
      handleApiError({ response: { status: 403 } }, 'bulkDeleteFeedbacks');
      return { success: [], failed: ids };
    }
    
    // Confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to delete ${ids.length} feedback(s)? This action cannot be undone.`
    );
    if (!confirmed) return { success: [], failed: [] };
    
    setLoading(true);
    setError(null);
    
    // Show progress notification
    const progressNotification = showNotification({
      type: 'info',
      message: `Deleting ${ids.length} feedback(s)...`,
      duration: 0, // Keep open
      progress: true
    });
    
    try {
      const result = await retryOperation(
        () => feedbackService.bulkDeleteFeedbacks(ids),
        'bulkDeleteFeedbacks'
      );
      
      // Update local state
      setFeedbacks(prev => prev.filter(f => !result.success.includes(f.id)));
      setTotalCount(prev => Math.max(0, prev - result.success.length));
      setSelectedFeedbacks([]);
      invalidateCache();
      
      // Update progress notification
      progressNotification.update({
        type: result.failed.length > 0 ? 'warning' : 'success',
        message: `Deleted ${result.success.length} feedback(s)${
          result.failed.length > 0 ? `, ${result.failed.length} failed` : ''
        }`,
        duration: 5000,
        progress: false
      });
      
      // Broadcast to other users
      send('feedback:bulk-deleted', { successIds: result.success });
      
      return result;
    } catch (error) {
      progressNotification.close();
      handleApiError(error, 'bulkDeleteFeedbacks');
      return { success: [], failed: ids };
    } finally {
      setLoading(false);
    }
  }, [hasPermission, retryOperation, invalidateCache, showNotification, send, handleApiError]);

  const exportFeedbacks = useCallback(async (format: 'csv' | 'json' | 'pdf') => {
    // Check permissions
    if (!hasPermission('feedback:export')) {
      handleApiError({ response: { status: 403 } }, 'exportFeedbacks');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    // Show progress notification for large exports
    const isLargeExport = totalCount > 1000;
    const progressNotification = isLargeExport ? showNotification({
      type: 'info',
      message: `Exporting ${totalCount} feedback records...`,
      duration: 0,
      progress: true
    }) : null;
    
    try {
      const blob = await retryOperation(
        () => feedbackService.exportFeedbacks(filters, format),
        'exportFeedbacks'
      );
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feedback-export-${format}-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      if (progressNotification) {
        progressNotification.update({
          type: 'success',
          message: 'Export completed successfully',
          duration: 4000,
          progress: false
        });
      } else {
        showNotification({
          type: 'success',
          message: 'Export completed successfully',
          duration: 4000
        });
      }
    } catch (error) {
      if (progressNotification) progressNotification.close();
      handleApiError(error, 'exportFeedbacks');
    } finally {
      setLoading(false);
    }
  }, [hasPermission, totalCount, filters, retryOperation, showNotification, handleApiError]);

  const searchFeedbacks = useCallback(async (query: string) => {
    setFilters(prev => ({ ...prev, search: query }));
    setCurrentPage(1); // Reset to first page on search
  }, []);

  const getFeedbackStatistics = useCallback(async () => {
    // Check cache first
    const cacheKey = `statistics-${JSON.stringify(filters)}`;
    const cached = getCachedData(cacheKey);
    
    if (cached) {
      setStatistics(cached);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const stats = await retryOperation(
        () => feedbackService.getFeedbackStatistics(filters),
        'getFeedbackStatistics'
      );
      
      setStatistics(stats);
      setCachedDataInternal(cacheKey, stats);
      
    } catch (error) {
      handleApiError(error, 'getFeedbackStatistics');
      // Use cached statistics if available
      if (statistics) {
        showNotification({
          type: 'warning',
          message: 'Using cached statistics',
          duration: 3000
        });
      }
    } finally {
      setLoading(false);
    }
  }, [filters, statistics, getCachedData, retryOperation, setCachedDataInternal, handleApiError, showNotification]);

  const setFilters = useCallback((newFilters: Partial<FeedbackFilter>) => {
    setFiltersState(prev => {
      const updated = { ...prev, ...newFilters };
      
      // Validate filter combinations
      if (updated.minRating && updated.maxRating && updated.minRating > updated.maxRating) {
        showNotification({
          type: 'warning',
          message: 'Minimum rating cannot be greater than maximum rating',
          duration: 3000
        });
        return prev;
      }
      
      if (updated.startDate && updated.endDate && isAfter(new Date(updated.startDate), new Date(updated.endDate))) {
        showNotification({
          type: 'warning',
          message: 'Start date cannot be after end date',
          duration: 3000
        });
        return prev;
      }
      
      return updated;
    });
    
    // Reset pagination when filters change
    setCurrentPage(1);
    invalidateCache();
  }, [showNotification, invalidateCache]);

  const setSorting = useCallback((field: string) => {
    if (field === sortBy) {
      // Toggle sort order if clicking same field
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    
    invalidateCache();
  }, [sortBy, invalidateCache]);

  const setPagination = useCallback((page: number, size?: number) => {
    // Validate page boundaries
    const maxPage = Math.ceil(totalCount / (size || pageSize));
    const validPage = Math.max(1, Math.min(page, maxPage || 1));
    
    setCurrentPage(validPage);
    
    if (size && size !== pageSize) {
      // Validate page size
      const validSize = Math.max(1, Math.min(size, 100));
      setPageSize(validSize);
    }
    
    invalidateCache();
  }, [totalCount, pageSize, invalidateCache]);

  const toggleFeedbackSelection = useCallback((id: string) => {
    setSelectedFeedbacks(prev => {
      const isSelected = prev.includes(id);
      
      if (isSelected) {
        return prev.filter(fId => fId !== id);
      } else {
        // Check selection limit
        if (prev.length >= MAX_BULK_SIZE) {
          showNotification({
            type: 'warning',
            message: `Maximum selection limit is ${MAX_BULK_SIZE}`,
            duration: 3000
          });
          return prev;
        }
        
        return [...prev, id];
      }
    });
  }, [showNotification]);

  const clearSelection = useCallback(() => {
    if (selectedFeedbacks.length > 10) {
      const confirmed = window.confirm(`Clear selection of ${selectedFeedbacks.length} items?`);
      if (!confirmed) return;
    }
    
    setSelectedFeedbacks([]);
  }, [selectedFeedbacks.length]);

  const refreshData = useCallback(async () => {
    invalidateCache();
    await fetchFeedbacks();
    
    showNotification({
      type: 'info',
      message: 'Data refreshed',
      duration: 2000
    });
  }, [invalidateCache, fetchFeedbacks, showNotification]);

  const invalidateCache = useCallback(() => {
    clearCache();
    setLastUpdated(null);
  }, [clearCache]);

  // Initialize debounced search
  useEffect(() => {
    debouncedSearchRef.current = debounce((query: string) => {
      searchFeedbacks(query);
    }, SEARCH_DEBOUNCE);
    
    return () => {
      debouncedSearchRef.current?.cancel();
    };
  }, [searchFeedbacks]);

  // Initialize hook with configuration
  useEffect(() => {
    // Load cached data if available
    if (config.cacheEnabled && cachedData.feedbacks) {
      setFeedbacks(cachedData.feedbacks);
      setTotalCount(cachedData.totalCount || 0);
      setStatistics(cachedData.statistics || null);
      setLastUpdated(cachedData.lastUpdated ? new Date(cachedData.lastUpdated) : null);
    }
    
    // Initial data fetch
    fetchFeedbacks();
    
    // Fetch statistics if needed
    if (config.organizationId || config.memberId) {
      getFeedbackStatistics();
    }
  }, []);

  // Set up real-time updates
  useEffect(() => {
    if (!config.autoRefresh) return;
    
    // Subscribe to WebSocket events
    const subscriptions = [
      subscribe('feedback:created', handleFeedbackCreated),
      subscribe('feedback:updated', handleFeedbackUpdated),
      subscribe('feedback:deleted', handleFeedbackDeleted),
      subscribe('feedback:bulk-operation', handleBulkOperationCompleted)
    ];
    
    return () => {
      subscriptions.forEach(unsubscribe);
    };
  }, [config.autoRefresh, subscribe, unsubscribe, handleFeedbackCreated, handleFeedbackUpdated, handleFeedbackDeleted, handleBulkOperationCompleted]);

  // Set up auto-refresh
  useEffect(() => {
    if (!config.autoRefresh) return;
    
    refreshIntervalRef.current = setInterval(() => {
      if (!loading) {
        fetchFeedbacks();
      }
    }, AUTO_REFRESH_INTERVAL);
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [config.autoRefresh, loading, fetchFeedbacks]);

  // Persist state to cache
  useEffect(() => {
    if (config.cacheEnabled) {
      setCachedData({
        feedbacks: feedbacks.slice(0, 50), // Cache first 50 items
        totalCount,
        statistics,
        lastUpdated: lastUpdated?.toISOString(),
        filters,
        currentPage,
        pageSize
      });
    }
  }, [feedbacks, totalCount, statistics, lastUpdated, filters, currentPage, pageSize, config.cacheEnabled, setCachedData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      debouncedSearchRef.current?.cancel();
    };
  }, []);

  // Accessibility announcements
  useEffect(() => {
    if (loading) {
      // TODO: Announce loading state to screen readers
    } else if (error) {
      // TODO: Announce error to screen readers
    } else if (feedbacks.length > 0) {
      // TODO: Announce results count to screen readers
    }
  }, [loading, error, feedbacks.length]);

  return {
    feedbacks,
    loading,
    error,
    totalCount,
    currentPage,
    pageSize,
    filters,
    sortBy,
    sortOrder,
    selectedFeedbacks,
    statistics,
    lastUpdated,
    fetchFeedbacks,
    createFeedback,
    updateFeedback,
    deleteFeedback,
    getFeedbackById,
    bulkDeleteFeedbacks,
    exportFeedbacks,
    searchFeedbacks: (query: string) => {
      debouncedSearchRef.current?.(query);
      return Promise.resolve();
    },
    getFeedbackStatistics,
    setFilters,
    setSorting,
    setPagination,
    toggleFeedbackSelection,
    clearSelection,
    refreshData,
    invalidateCache
  };
};

export default useFeedback;
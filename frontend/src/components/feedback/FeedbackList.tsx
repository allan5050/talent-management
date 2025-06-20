import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import debounce from 'lodash/debounce';
import { 
  Feedback, 
  FeedbackFilter, 
  FeedbackListResponse,
  FeedbackType,
  FeedbackStatus,
  FeedbackCategory
} from '../../types/feedback';
import feedbackService from '../../services/feedbackService';
import LoadingSpinner from '../common/LoadingSpinner';
import FeedbackCard from './FeedbackCard';
import Pagination from '../common/Pagination';
import SearchBar from '../common/SearchBar';
import FilterPanel from '../common/FilterPanel';
import { Button, Select, DatePicker, Slider } from '../common/ui';
import { useDebounce } from '../../hooks/useDebounce';
import { useNotification } from '../../hooks/useNotification';
import { useFeedback } from '../../hooks/useFeedback';

export interface FeedbackListProps {
  organizationId?: string;
  memberId?: string;
  showFilters?: boolean;
  onFeedbackSelect?: (feedback: Feedback) => void;
  maxItems?: number;
}

const FeedbackList: React.FC<FeedbackListProps> = ({
  organizationId,
  memberId,
  showFilters = true,
  onFeedbackSelect,
  maxItems
}) => {
  // State management
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [filters, setFilters] = useState<FeedbackFilter>({
    organizationId,
    memberId,
    page: 1,
    limit: parseInt(process.env.REACT_APP_FEEDBACK_PAGE_SIZE || '20')
  });
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedFeedbacks, setSelectedFeedbacks] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean>(false);
  const [bulkOperationLoading, setBulkOperationLoading] = useState<boolean>(false);
  const [exportLoading, setExportLoading] = useState<boolean>(false);

  const { showNotification } = useNotification();
  const { subscribeToUpdates, unsubscribeFromUpdates } = useFeedback();
  const debouncedSearchTerm = useDebounce(searchTerm, parseInt(process.env.REACT_APP_SEARCH_DEBOUNCE_MS || '300'));

  const maxBulkSelect = parseInt(process.env.REACT_APP_MAX_BULK_SELECT || '100');
  const exportLimit = parseInt(process.env.REACT_APP_FEEDBACK_EXPORT_LIMIT || '1000');
  const refreshInterval = parseInt(process.env.REACT_APP_FEEDBACK_REFRESH_INTERVAL || '30000');

  // Fetch feedbacks with current filters
  const fetchFeedbacks = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const response: FeedbackListResponse = await feedbackService.getFeedbacks({
        ...filters,
        search: debouncedSearchTerm,
        sortBy,
        sortOrder,
        page: currentPage,
        limit: maxItems || filters.limit
      });

      setFeedbacks(response.items);
      setTotalPages(response.totalPages);
      setTotalItems(response.totalItems);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch feedback data';
      setError(errorMessage);
      showNotification({
        type: 'error',
        message: errorMessage,
        duration: 5000
      });
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedSearchTerm, sortBy, sortOrder, currentPage, maxItems, showNotification]);

  // Initial data fetch and real-time updates setup
  useEffect(() => {
    fetchFeedbacks();

    // Set up real-time updates
    const unsubscribe = subscribeToUpdates((updatedFeedback) => {
      setFeedbacks(prev => {
        const index = prev.findIndex(f => f.id === updatedFeedback.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = updatedFeedback;
          return updated;
        }
        return prev;
      });
    });

    // Set up auto-refresh
    const refreshTimer = setInterval(fetchFeedbacks, refreshInterval);

    return () => {
      unsubscribe();
      clearInterval(refreshTimer);
    };
  }, []);

  // Refetch when filters or search changes
  useEffect(() => {
    setCurrentPage(1);
    fetchFeedbacks();
  }, [debouncedSearchTerm, filters]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<FeedbackFilter>) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters
    }));
    setCurrentPage(1);
    setSelectedFeedbacks([]);

    // Persist filter preferences
    localStorage.setItem('feedbackListFilters', JSON.stringify({
      ...filters,
      ...newFilters
    }));
  }, [filters]);

  // Handle sort changes
  const handleSortChange = useCallback((field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);

    // Persist sort preferences
    localStorage.setItem('feedbackListSort', JSON.stringify({
      sortBy: field,
      sortOrder: sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc'
    }));
  }, [sortBy, sortOrder]);

  // Handle search changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
    setSelectedFeedbacks([]);
  }, []);

  // Handle page changes
  const handlePageChange = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setSelectedFeedbacks([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [totalPages]);

  // Handle feedback selection
  const handleFeedbackSelect = useCallback((feedback: Feedback) => {
    if (onFeedbackSelect) {
      onFeedbackSelect(feedback);
    }
    // TODO: Navigate to feedback detail view
  }, [onFeedbackSelect]);

  // Handle bulk selection
  const handleBulkSelect = useCallback((feedbackId: string) => {
    setSelectedFeedbacks(prev => {
      if (prev.includes(feedbackId)) {
        return prev.filter(id => id !== feedbackId);
      }
      if (prev.length >= maxBulkSelect) {
        showNotification({
          type: 'warning',
          message: `Maximum ${maxBulkSelect} items can be selected for bulk operations`,
          duration: 3000
        });
        return prev;
      }
      return [...prev, feedbackId];
    });
  }, [maxBulkSelect, showNotification]);

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (selectedFeedbacks.length === feedbacks.length) {
      setSelectedFeedbacks([]);
    } else {
      const allIds = feedbacks.slice(0, maxBulkSelect).map(f => f.id);
      setSelectedFeedbacks(allIds);
      if (feedbacks.length > maxBulkSelect) {
        showNotification({
          type: 'info',
          message: `Selected first ${maxBulkSelect} items`,
          duration: 3000
        });
      }
    }
  }, [feedbacks, selectedFeedbacks, maxBulkSelect, showNotification]);

  // Handle bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (selectedFeedbacks.length === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedFeedbacks.length} feedback item(s)?`
    );

    if (!confirmed) return;

    try {
      setBulkOperationLoading(true);
      const results = await feedbackService.bulkDelete(selectedFeedbacks);
      
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      if (successCount > 0) {
        showNotification({
          type: 'success',
          message: `Successfully deleted ${successCount} feedback item(s)`,
          duration: 3000
        });
      }

      if (failureCount > 0) {
        showNotification({
          type: 'error',
          message: `Failed to delete ${failureCount} feedback item(s)`,
          duration: 5000
        });
      }

      setSelectedFeedbacks([]);
      fetchFeedbacks();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Bulk delete operation failed';
      showNotification({
        type: 'error',
        message: errorMessage,
        duration: 5000
      });
    } finally {
      setBulkOperationLoading(false);
    }
  }, [selectedFeedbacks, showNotification, fetchFeedbacks]);

  // Handle export
  const handleExport = useCallback(async (format: 'csv' | 'json' | 'pdf' = 'csv') => {
    try {
      setExportLoading(true);
      
      const exportFilters = {
        ...filters,
        search: debouncedSearchTerm,
        sortBy,
        sortOrder,
        limit: Math.min(totalItems, exportLimit)
      };

      const blob = await feedbackService.exportFeedbacks(exportFilters, format);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feedback-export-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showNotification({
        type: 'success',
        message: `Export completed successfully`,
        duration: 3000
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Export operation failed';
      showNotification({
        type: 'error',
        message: errorMessage,
        duration: 5000
      });
    } finally {
      setExportLoading(false);
    }
  }, [filters, debouncedSearchTerm, sortBy, sortOrder, totalItems, exportLimit, showNotification]);

  // Load saved preferences
  useEffect(() => {
    const savedFilters = localStorage.getItem('feedbackListFilters');
    const savedSort = localStorage.getItem('feedbackListSort');

    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setFilters(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to load saved filters:', e);
      }
    }

    if (savedSort) {
      try {
        const parsed = JSON.parse(savedSort);
        setSortBy(parsed.sortBy);
        setSortOrder(parsed.sortOrder);
      } catch (e) {
        console.error('Failed to load saved sort preferences:', e);
      }
    }
  }, []);

  // Render loading state
  if (loading && feedbacks.length === 0) {
    return (
      <div className="feedback-list-loading" role="status" aria-live="polite">
        <LoadingSpinner size="large" />
        <p className="loading-text">Loading feedback data...</p>
      </div>
    );
  }

  // Render error state
  if (error && feedbacks.length === 0) {
    return (
      <div className="feedback-list-error" role="alert">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Feedback</h3>
        <p>{error}</p>
        <Button onClick={fetchFeedbacks} variant="primary">
          Retry
        </Button>
      </div>
    );
  }

  // Render empty state
  if (!loading && feedbacks.length === 0) {
    return (
      <div className="feedback-list-empty">
        <div className="empty-icon">📝</div>
        <h3>No Feedback Found</h3>
        <p>
          {searchTerm || Object.keys(filters).length > 2
            ? 'No feedback matches your current filters. Try adjusting your search criteria.'
            : 'No feedback has been submitted yet.'}
        </p>
        {(searchTerm || Object.keys(filters).length > 2) && (
          <Button
            onClick={() => {
              setSearchTerm('');
              setFilters({ page: 1, limit: filters.limit });
            }}
            variant="secondary"
          >
            Clear Filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="feedback-list-container">
      {/* Search and Filter Bar */}
      <div className="feedback-list-header">
        <div className="search-section">
          <SearchBar
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search feedback by content, member name, or organization..."
            aria-label="Search feedback"
          />
        </div>
        
        {showFilters && (
          <Button
            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
            variant="secondary"
            aria-expanded={isFilterPanelOpen}
            aria-controls="filter-panel"
          >
            <span className="filter-icon">🔽</span>
            Filters
            {Object.keys(filters).length > 2 && (
              <span className="filter-count">{Object.keys(filters).length - 2}</span>
            )}
          </Button>
        )}

        <div className="export-section">
          <Button
            onClick={() => handleExport('csv')}
            variant="secondary"
            disabled={exportLoading || feedbacks.length === 0}
            aria-label="Export feedback data"
          >
            {exportLoading ? <LoadingSpinner size="small" /> : '📥'} Export
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && isFilterPanelOpen && (
        <FilterPanel
          id="filter-panel"
          filters={filters}
          onChange={handleFilterChange}
          onClose={() => setIsFilterPanelOpen(false)}
        />
      )}

      {/* Bulk Operations Toolbar */}
      {selectedFeedbacks.length > 0 && (
        <div className="bulk-operations-toolbar" role="toolbar" aria-label="Bulk operations">
          <div className="selection-info">
            <span>{selectedFeedbacks.length} item(s) selected</span>
            <Button
              onClick={() => setSelectedFeedbacks([])}
              variant="link"
              size="small"
            >
              Clear selection
            </Button>
          </div>
          <div className="bulk-actions">
            <Button
              onClick={handleBulkDelete}
              variant="danger"
              disabled={bulkOperationLoading}
              aria-label={`Delete ${selectedFeedbacks.length} selected items`}
            >
              {bulkOperationLoading ? <LoadingSpinner size="small" /> : '🗑️'} Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="feedback-table-container" role="region" aria-label="Feedback list">
        <table className="feedback-table" role="table">
          <thead>
            <tr role="row">
              <th role="columnheader" className="select-column">
                <input
                  type="checkbox"
                  checked={selectedFeedbacks.length === feedbacks.length && feedbacks.length > 0}
                  onChange={handleSelectAll}
                  aria-label="Select all feedback items"
                />
              </th>
              <th 
                role="columnheader" 
                className="sortable"
                onClick={() => handleSortChange('createdAt')}
                aria-sort={sortBy === 'createdAt' ? sortOrder : 'none'}
              >
                Date
                {sortBy === 'createdAt' && (
                  <span className="sort-indicator">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th 
                role="columnheader"
                className="sortable"
                onClick={() => handleSortChange('memberName')}
                aria-sort={sortBy === 'memberName' ? sortOrder : 'none'}
              >
                Member
                {sortBy === 'memberName' && (
                  <span className="sort-indicator">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th 
                role="columnheader"
                className="sortable"
                onClick={() => handleSortChange('type')}
                aria-sort={sortBy === 'type' ? sortOrder : 'none'}
              >
                Type
                {sortBy === 'type' && (
                  <span className="sort-indicator">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th 
                role="columnheader"
                className="sortable"
                onClick={() => handleSortChange('rating')}
                aria-sort={sortBy === 'rating' ? sortOrder : 'none'}
              >
                Rating
                {sortBy === 'rating' && (
                  <span className="sort-indicator">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
              <th role="columnheader">Content</th>
              <th role="columnheader">Status</th>
              <th role="columnheader" className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {feedbacks.map((feedback) => (
              <tr 
                key={feedback.id} 
                role="row"
                className={selectedFeedbacks.includes(feedback.id) ? 'selected' : ''}
                onClick={() => handleFeedbackSelect(feedback)}
              >
                <td role="cell" className="select-column">
                  <input
                    type="checkbox"
                    checked={selectedFeedbacks.includes(feedback.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleBulkSelect(feedback.id);
                    }}
                    aria-label={`Select feedback from ${feedback.memberName}`}
                  />
                </td>
                <td role="cell" className="date-column">
                  <time dateTime={feedback.createdAt}>
                    {formatDistanceToNow(parseISO(feedback.createdAt), { addSuffix: true })}
                  </time>
                </td>
                <td role="cell" className="member-column">
                  <div className="member-info">
                    {feedback.memberAvatar && (
                      <img 
                        src={feedback.memberAvatar} 
                        alt=""
                        className="member-avatar"
                        loading="lazy"
                      />
                    )}
                    <span>{feedback.memberName}</span>
                  </div>
                </td>
                <td role="cell" className="type-column">
                  <span className={`type-badge type-${feedback.type.toLowerCase()}`}>
                    {feedback.type}
                  </span>
                </td>
                <td role="cell" className="rating-column">
                  <div className="rating-display" aria-label={`Rating: ${feedback.rating} out of 5`}>
                    {[...Array(5)].map((_, i) => (
                      <span 
                        key={i} 
                        className={i < feedback.rating ? 'star filled' : 'star'}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                </td>
                <td role="cell" className="content-column">
                  <div className="content-preview">
                    {feedback.content.length > 100
                      ? `${feedback.content.substring(0, 100)}...`
                      : feedback.content}
                  </div>
                </td>
                <td role="cell" className="status-column">
                  <span className={`status-badge status-${feedback.status.toLowerCase()}`}>
                    {feedback.status}
                  </span>
                </td>
                <td role="cell" className="actions-column">
                  <div className="action-buttons">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFeedbackSelect(feedback);
                      }}
                      variant="link"
                      size="small"
                      aria-label={`View feedback from ${feedback.memberName}`}
                    >
                      👁️
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Implement edit functionality
                      }}
                      variant="link"
                      size="small"
                      aria-label={`Edit feedback from ${feedback.memberName}`}
                    >
                      ✏️
                    </Button>
                    <Button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete this feedback?')) {
                          try {
                            await feedbackService.deleteFeedback(feedback.id);
                            showNotification({
                              type: 'success',
                              message: 'Feedback deleted successfully',
                              duration: 3000
                            });
                            fetchFeedbacks();
                          } catch (err) {
                            showNotification({
                              type: 'error',
                              message: 'Failed to delete feedback',
                              duration: 5000
                            });
                          }
                        }
                      }}
                      variant="link"
                      size="small"
                      aria-label={`Delete feedback from ${feedback.memberName}`}
                    >
                      🗑️
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={filters.limit}
          onPageChange={handlePageChange}
          onItemsPerPageChange={(limit) => handleFilterChange({ limit })}
        />
      )}

      {/* Loading overlay for operations */}
      {(bulkOperationLoading || exportLoading) && (
        <div className="operation-overlay" aria-live="polite">
          <LoadingSpinner size="medium" />
          <p>{bulkOperationLoading ? 'Processing bulk operation...' : 'Exporting data...'}</p>
        </div>
      )}
    </div>
  );
};

export default FeedbackList;
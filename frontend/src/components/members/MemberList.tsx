import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format, formatDistanceToNow, differenceInYears, isWithinInterval, parseISO } from 'date-fns';
import { debounce, orderBy, groupBy, isEmpty, uniqBy } from 'lodash';
import { FixedSizeList as List } from 'react-window';
import {
  Member,
  MemberFilter,
  MemberListResponse,
  MemberStats,
  MemberHierarchy,
  EmploymentStatus,
  EmploymentType,
  ViewMode
} from '../../types/member';
import memberService from '../../services/memberService';
import LoadingSpinner from '../common/LoadingSpinner';
import MemberCard from './MemberCard';
import Pagination from '../common/Pagination';
import SearchBar from '../common/SearchBar';
import FilterPanel from '../common/FilterPanel';
import OrganizationalChart from '../common/OrganizationalChart';
import {
  Button,
  Select,
  DatePicker,
  Slider,
  Checkbox,
  Avatar,
  Modal,
  Tooltip,
  Badge,
  Menu,
  MenuItem,
  IconButton,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Card,
  CardContent,
  Typography,
  Chip,
  Box,
  Paper,
  Skeleton,
  Divider,
  FormControl,
  InputLabel,
  TextField,
  Switch,
  FormControlLabel,
  LinearProgress
} from '@mui/material';
import {
  ViewList,
  ViewModule,
  AccountTree,
  Download,
  Email,
  Edit,
  Delete,
  MoreVert,
  FilterList,
  Sort,
  Search,
  Clear,
  Refresh,
  Print,
  PersonAdd,
  CheckBox,
  CheckBoxOutlineBlank,
  IndeterminateCheckBox,
  Warning,
  Error as ErrorIcon,
  Info,
  CheckCircle,
  Cancel,
  ArrowUpward,
  ArrowDownward,
  ExpandMore,
  ExpandLess,
  Business,
  LocationOn,
  CalendarToday,
  AttachMoney,
  School,
  Person,
  Group,
  Visibility,
  VisibilityOff
} from '@mui/icons-material';
import useDebounce from '../../hooks/useDebounce';
import useNotification from '../../hooks/useNotification';
import useMembers from '../../hooks/useMembers';
import useAuth from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useHotkeys } from 'react-hotkeys-hook';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useReactToPrint } from 'react-to-print';
import { useInView } from 'react-intersection-observer';
import { ErrorBoundary } from 'react-error-boundary';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAnalytics } from '../../hooks/useAnalytics';

export interface MemberListProps {
  organizationId?: string;
  departmentFilter?: string;
  showHierarchy?: boolean;
  onMemberSelect?: (member: Member) => void;
  showBulkActions?: boolean;
  viewMode?: ViewMode;
  maxItems?: number;
}

interface FilterState {
  department?: string;
  employment_status?: EmploymentStatus[];
  employment_type?: EmploymentType[];
  job_title?: string;
  location?: string;
  hire_date_range?: { start: Date; end: Date };
  salary_range?: { min: number; max: number };
  skills?: string[];
  manager_id?: string;
}

interface SortState {
  field: string;
  order: 'asc' | 'desc';
}

const MemberList: React.FC<MemberListProps> = ({
  organizationId,
  departmentFilter,
  showHierarchy = false,
  onMemberSelect,
  showBulkActions = true,
  viewMode: initialViewMode = ViewMode.LIST,
  maxItems
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));
  const { user, hasPermission } = useAuth();
  const { showNotification } = useNotification();
  const { trackEvent } = useAnalytics();
  const printRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<List>(null);
  const { ref: infiniteScrollRef, inView } = useInView({ threshold: 0 });

  // State management
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    department: departmentFilter
  });
  const [sortBy, setSortBy] = useState<SortState>({ field: 'created_at', order: 'desc' });
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [showInactiveMembers, setShowInactiveMembers] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(!isMobile);
  const [showMemberPreview, setShowMemberPreview] = useState<Member | null>(null);
  const [bulkOperationDialog, setBulkOperationDialog] = useState<{
    open: boolean;
    operation: 'status' | 'export' | 'email' | null;
  }>({ open: false, operation: null });
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'pdf'>('csv');
  const [bulkOperationProgress, setBulkOperationProgress] = useState(0);
  const [hierarchyData, setHierarchyData] = useState<MemberHierarchy | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    member: Member | null;
  } | null>(null);

  // Environment variables
  const pageSize = parseInt(process.env.REACT_APP_MEMBER_PAGE_SIZE || '25');
  const maxBulkSelect = parseInt(process.env.REACT_APP_MAX_BULK_SELECT_MEMBERS || '100');
  const searchDebounceMs = parseInt(process.env.REACT_APP_MEMBER_SEARCH_DEBOUNCE_MS || '300');
  const refreshInterval = parseInt(process.env.REACT_APP_MEMBER_REFRESH_INTERVAL || '60000');
  const exportLimit = parseInt(process.env.REACT_APP_MEMBER_EXPORT_LIMIT || '5000');
  const maxHierarchyDepth = parseInt(process.env.REACT_APP_MAX_HIERARCHY_DEPTH || '10');
  const virtualizationThreshold = parseInt(process.env.REACT_APP_MEMBER_VIRTUALIZATION_THRESHOLD || '100');
  const avatarCacheTTL = parseInt(process.env.REACT_APP_MEMBER_AVATAR_CACHE_TTL || '3600000');

  // Local storage for preferences
  const [savedPreferences, setSavedPreferences] = useLocalStorage('memberListPreferences', {
    viewMode,
    sortBy,
    filters,
    showInactiveMembers,
    pageSize,
    expandedNodes: Array.from(expandedNodes)
  });

  // Debounced search
  const debouncedSearchTerm = useDebounce(searchTerm, searchDebounceMs);

  // WebSocket for real-time updates
  const { subscribe, unsubscribe } = useWebSocket();

  // Custom hooks
  const {
    members: hookMembers,
    loading: hookLoading,
    error: hookError,
    fetchMembers: hookFetchMembers,
    updateMemberStatus,
    exportMembers,
    getOrganizationalHierarchy
  } = useMembers();

  // Fetch members function
  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const filterParams: MemberFilter = {
        ...filters,
        organization_id: organizationId,
        search: debouncedSearchTerm,
        include_inactive: showInactiveMembers,
        page: currentPage,
        page_size: pageSize,
        sort_by: sortBy.field,
        sort_order: sortBy.order
      };

      if (maxItems) {
        filterParams.page_size = Math.min(pageSize, maxItems);
      }

      const response = await memberService.getMembers(filterParams);
      
      if (response.data) {
        setMembers(response.data.items);
        setTotalPages(response.data.total_pages);
        setTotalCount(response.data.total);
        
        // Track search and filter usage
        if (debouncedSearchTerm) {
          trackEvent('member_search', { term: debouncedSearchTerm });
        }
        if (!isEmpty(filters)) {
          trackEvent('member_filter', { filters });
        }
      }
    } catch (err: any) {
      console.error('Error fetching members:', err);
      setError(err.message || t('errors.fetchMembers'));
      showNotification({
        message: t('errors.fetchMembers'),
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [
    filters,
    organizationId,
    debouncedSearchTerm,
    showInactiveMembers,
    currentPage,
    pageSize,
    sortBy,
    maxItems,
    memberService,
    showNotification,
    t,
    trackEvent
  ]);

  // Fetch organizational hierarchy
  const fetchHierarchy = useCallback(async () => {
    if (!showHierarchy || viewMode !== ViewMode.HIERARCHY) return;

    try {
      const hierarchy = await getOrganizationalHierarchy(organizationId);
      setHierarchyData(hierarchy);
    } catch (err: any) {
      console.error('Error fetching hierarchy:', err);
      showNotification({
        message: t('errors.fetchHierarchy'),
        severity: 'error'
      });
    }
  }, [showHierarchy, viewMode, organizationId, getOrganizationalHierarchy, showNotification, t]);

  // Initial data fetch
  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Fetch hierarchy when needed
  useEffect(() => {
    fetchHierarchy();
  }, [fetchHierarchy]);

  // Real-time updates subscription
  useEffect(() => {
    const handleMemberUpdate = (data: any) => {
      if (data.organization_id === organizationId) {
        fetchMembers();
        if (showHierarchy && viewMode === ViewMode.HIERARCHY) {
          fetchHierarchy();
        }
      }
    };

    const unsubscribeFn = subscribe('member.updated', handleMemberUpdate);
    return () => {
      unsubscribeFn();
    };
  }, [organizationId, fetchMembers, fetchHierarchy, subscribe]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading && !error) {
        fetchMembers();
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchMembers, loading, error, refreshInterval]);

  // Save preferences
  useEffect(() => {
    setSavedPreferences({
      viewMode,
      sortBy,
      filters,
      showInactiveMembers,
      pageSize,
      expandedNodes: Array.from(expandedNodes)
    });
  }, [viewMode, sortBy, filters, showInactiveMembers, pageSize, expandedNodes, setSavedPreferences]);

  // Restore preferences
  useEffect(() => {
    if (savedPreferences) {
      setViewMode(savedPreferences.viewMode || ViewMode.LIST);
      setSortBy(savedPreferences.sortBy || { field: 'created_at', order: 'desc' });
      setFilters(savedPreferences.filters || {});
      setShowInactiveMembers(savedPreferences.showInactiveMembers || false);
      if (savedPreferences.expandedNodes) {
        setExpandedNodes(new Set(savedPreferences.expandedNodes));
      }
    }
  }, []);

  // Infinite scroll
  useEffect(() => {
    if (inView && !loading && currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  }, [inView, loading, currentPage, totalPages]);

  // Keyboard shortcuts
  useHotkeys('ctrl+f, cmd+f', (e) => {
    e.preventDefault();
    document.getElementById('member-search')?.focus();
  });

  useHotkeys('ctrl+a, cmd+a', (e) => {
    if (showBulkActions) {
      e.preventDefault();
      handleSelectAll();
    }
  });

  useHotkeys('escape', () => {
    setSelectedMembers([]);
    setShowMemberPreview(null);
    setContextMenu(null);
  });

  // Handler functions
  const handleFilterChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    setCurrentPage(1);
    trackEvent('member_filter_change', { filters: newFilters });
  }, [trackEvent]);

  const handleSortChange = useCallback((field: string) => {
    setSortBy(prev => ({
      field,
      order: prev.field === field && prev.order === 'asc' ? 'desc' : 'asc'
    }));
    trackEvent('member_sort_change', { field, order: sortBy.order });
  }, [sortBy.order, trackEvent]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    listRef.current?.scrollToItem(0);
  }, []);

  const handleMemberSelect = useCallback((member: Member) => {
    if (onMemberSelect) {
      onMemberSelect(member);
      trackEvent('member_select', { memberId: member.id });
    }
  }, [onMemberSelect, trackEvent]);

  const handleBulkSelect = useCallback((memberId: string) => {
    setSelectedMembers(prev => {
      if (prev.includes(memberId)) {
        return prev.filter(id => id !== memberId);
      }
      if (prev.length >= maxBulkSelect) {
        showNotification({
          message: t('errors.maxBulkSelectReached', { max: maxBulkSelect }),
          severity: 'warning'
        });
        return prev;
      }
      return [...prev, memberId];
    });
  }, [maxBulkSelect, showNotification, t]);

  const handleSelectAll = useCallback(() => {
    if (selectedMembers.length === members.length) {
      setSelectedMembers([]);
    } else {
      const newSelection = members.slice(0, maxBulkSelect).map(m => m.id);
      setSelectedMembers(newSelection);
      if (members.length > maxBulkSelect) {
        showNotification({
          message: t('info.partialSelection', { selected: maxBulkSelect, total: members.length }),
          severity: 'info'
        });
      }
    }
  }, [members, selectedMembers.length, maxBulkSelect, showNotification, t]);

  const handleBulkStatusUpdate = useCallback(async (status: EmploymentStatus) => {
    try {
      setBulkOperationProgress(0);
      const total = selectedMembers.length;
      let completed = 0;
      const errors: string[] = [];

      for (const memberId of selectedMembers) {
        try {
          await updateMemberStatus(memberId, status);
          completed++;
          setBulkOperationProgress((completed / total) * 100);
        } catch (err: any) {
          errors.push(`${memberId}: ${err.message}`);
        }
      }

      if (errors.length > 0) {
        showNotification({
          message: t('errors.bulkUpdatePartial', { success: completed, failed: errors.length }),
          severity: 'warning'
        });
      } else {
        showNotification({
          message: t('success.bulkStatusUpdate', { count: completed }),
          severity: 'success'
        });
      }

      setSelectedMembers([]);
      setBulkOperationDialog({ open: false, operation: null });
      fetchMembers();
      trackEvent('bulk_status_update', { status, count: completed });
    } catch (err: any) {
      console.error('Bulk status update error:', err);
      showNotification({
        message: t('errors.bulkStatusUpdate'),
        severity: 'error'
      });
    } finally {
      setBulkOperationProgress(0);
    }
  }, [selectedMembers, updateMemberStatus, showNotification, t, fetchMembers, trackEvent]);

  const handleBulkExport = useCallback(async () => {
    try {
      setBulkOperationProgress(0);
      
      const exportParams: MemberFilter = {
        ...filters,
        organization_id: organizationId,
        member_ids: selectedMembers.length > 0 ? selectedMembers : undefined,
        page_size: exportLimit,
        format: exportFormat
      };

      const blob = await exportMembers(exportParams);
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `members_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.${exportFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      showNotification({
        message: t('success.exportComplete'),
        severity: 'success'
      });
      
      setBulkOperationDialog({ open: false, operation: null });
      trackEvent('bulk_export', { format: exportFormat, count: selectedMembers.length || totalCount });
    } catch (err: any) {
      console.error('Export error:', err);
      showNotification({
        message: t('errors.exportFailed'),
        severity: 'error'
      });
    } finally {
      setBulkOperationProgress(0);
    }
  }, [filters, organizationId, selectedMembers, exportLimit, exportFormat, exportMembers, showNotification, t, totalCount, trackEvent]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    trackEvent('view_mode_change', { mode });
  }, [trackEvent]);

  const handleContextMenu = useCallback((event: React.MouseEvent, member: Member) => {
    event.preventDefault();
    setContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 4,
      member
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `Members_${format(new Date(), 'yyyy-MM-dd')}`,
    onAfterPrint: () => {
      showNotification({
        message: t('success.printComplete'),
        severity: 'success'
      });
    }
  });

  // Render functions
  const renderMemberRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const member = members[index];
    if (!member) return null;

    const isSelected = selectedMembers.includes(member.id);
    const tenure = member.hire_date ? differenceInYears(new Date(), parseISO(member.hire_date)) : 0;

    return (
      <div style={style}>
        <Paper
          elevation={1}
          sx={{
            p: 2,
            m: 1,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
            bgcolor: isSelected ? 'action.selected' : 'background.paper'
          }}
          onClick={() => handleMemberSelect(member)}
          onContextMenu={(e) => handleContextMenu(e, member)}
        >
          <Grid container alignItems="center" spacing={2}>
            {showBulkActions && (
              <Grid item>
                <Checkbox
                  checked={isSelected}
                  onChange={() => handleBulkSelect(member.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </Grid>
            )}
            <Grid item>
              <Avatar
                src={member.profile_picture}
                alt={member.full_name}
                sx={{ width: 48, height: 48 }}
              >
                {member.full_name.charAt(0)}
              </Avatar>
            </Grid>
            <Grid item xs>
              <Typography variant="subtitle1" fontWeight="medium">
                {member.full_name}
                {member.preferred_name && ` (${member.preferred_name})`}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {member.job_title} • {member.department}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  size="small"
                  label={member.employment_status}
                  color={member.employment_status === EmploymentStatus.ACTIVE ? 'success' : 'default'}
                  sx={{ mr: 1 }}
                />
                <Chip
                  size="small"
                  label={member.employment_type}
                  variant="outlined"
                  sx={{ mr: 1 }}
                />
                {tenure > 0 && (
                  <Chip
                    size="small"
                    label={t('member.tenure', { years: tenure })}
                    variant="outlined"
                  />
                )}
              </Box>
            </Grid>
            <Grid item>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Typography variant="body2" color="text.secondary">
                  {member.email}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {member.phone}
                </Typography>
                {member.location && (
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                    <LocationOn fontSize="small" color="action" />
                    <Typography variant="caption" color="text.secondary">
                      {member.location}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Grid>
            <Grid item>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, member);
                }}
              >
                <MoreVert />
              </IconButton>
            </Grid>
          </Grid>
          {member.skills && member.skills.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {member.skills.slice(0, 5).map((skill, idx) => (
                <Chip
                  key={idx}
                  size="small"
                  label={skill}
                  sx={{ mr: 0.5, mb: 0.5 }}
                />
              ))}
              {member.skills.length > 5 && (
                <Chip
                  size="small"
                  label={`+${member.skills.length - 5}`}
                  variant="outlined"
                />
              )}
            </Box>
          )}
        </Paper>
      </div>
    );
  }, [members, selectedMembers, showBulkActions, handleMemberSelect, handleBulkSelect, handleContextMenu, t]);

  const renderGridView = useCallback(() => {
    return (
      <Grid container spacing={2}>
        {members.map((member) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={member.id}>
            <MemberCard
              member={member}
              selected={selectedMembers.includes(member.id)}
              onSelect={() => handleMemberSelect(member)}
              onToggleSelect={() => handleBulkSelect(member.id)}
              showSelectCheckbox={showBulkActions}
              onContextMenu={(e) => handleContextMenu(e, member)}
            />
          </Grid>
        ))}
      </Grid>
    );
  }, [members, selectedMembers, showBulkActions, handleMemberSelect, handleBulkSelect, handleContextMenu]);

  const renderHierarchyView = useCallback(() => {
    if (!hierarchyData) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      );
    }

    return (
      <DndProvider backend={isMobile ? TouchBackend : HTML5Backend}>
        <OrganizationalChart
          data={hierarchyData}
          expandedNodes={expandedNodes}
          onNodeExpand={(nodeId) => {
            setExpandedNodes(prev => {
              const newSet = new Set(prev);
              if (newSet.has(nodeId)) {
                newSet.delete(nodeId);
              } else {
                newSet.add(nodeId);
              }
              return newSet;
            });
          }}
          onNodeSelect={(member) => handleMemberSelect(member)}
          maxDepth={maxHierarchyDepth}
        />
      </DndProvider>
    );
  }, [hierarchyData, expandedNodes, isMobile, handleMemberSelect, maxHierarchyDepth]);

  const renderEmptyState = useCallback(() => {
    const hasFilters = !isEmpty(filters) || searchTerm || showInactiveMembers;

    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Group sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          {hasFilters ? t('member.noResultsFound') : t('member.noMembers')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {hasFilters
            ? t('member.tryAdjustingFilters')
            : t('member.getStartedByAdding')}
        </Typography>
        {hasFilters ? (
          <Button
            variant="outlined"
            onClick={() => {
              setFilters({});
              setSearchTerm('');
              setShowInactiveMembers(false);
            }}
          >
            {t('common.clearFilters')}
          </Button>
        ) : (
          hasPermission('member.create') && (
            <Button
              variant="contained"
              startIcon={<PersonAdd />}
              onClick={() => {
                // TODO: Navigate to member creation
              }}
            >
              {t('member.addMember')}
            </Button>
          )
        )}
      </Box>
    );
  }, [filters, searchTerm, showInactiveMembers, hasPermission, t]);

  const renderErrorState = useCallback(() => {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <ErrorIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          {t('errors.somethingWentWrong')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {error || t('errors.genericError')}
        </Typography>
        <Button
          variant="outlined"
          onClick={() => {
            setError(null);
            fetchMembers();
          }}
        >
          {t('common.retry')}
        </Button>
      </Box>
    );
  }, [error, t, fetchMembers]);

  const renderLoadingState = useCallback(() => {
    return (
      <Box>
        {viewMode === ViewMode.LIST && (
          <Box>
            {[...Array(5)].map((_, index) => (
              <Paper key={index} sx={{ p: 2, m: 1 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item>
                    <Skeleton variant="circular" width={48} height={48} />
                  </Grid>
                  <Grid item xs>
                    <Skeleton variant="text" width="60%" />
                    <Skeleton variant="text" width="40%" />
                    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                      <Skeleton variant="rectangular" width={80} height={24} />
                      <Skeleton variant="rectangular" width={80} height={24} />
                    </Box>
                  </Grid>
                  <Grid item>
                    <Skeleton variant="text" width={150} />
                    <Skeleton variant="text" width={120} />
                  </Grid>
                </Grid>
              </Paper>
            ))}
          </Box>
        )}
        {viewMode === ViewMode.GRID && (
          <Grid container spacing={2}>
            {[...Array(8)].map((_, index) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={index}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Skeleton variant="circular" width={80} height={80} />
                      <Skeleton variant="text" width="80%" sx={{ mt: 2 }} />
                      <Skeleton variant="text" width="60%" />
                      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                        <Skeleton variant="rectangular" width={60} height={24} />
                        <Skeleton variant="rectangular" width={60} height={24} />
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    );
  }, [viewMode]);

  // Main render
  return (
    <ErrorBoundary
      FallbackComponent={({ error, resetErrorBoundary }) => (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={resetErrorBoundary}>
              {t('common.retry')}
            </Button>
          }
        >
          {error.message}
        </Alert>
      )}
      onReset={() => {
        setError(null);
        fetchMembers();
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <SearchBar
                id="member-search"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder={t('member.searchPlaceholder')}
                showSuggestions
                suggestionType="member"
              />
            </Grid>
            <Grid item xs={12} md={8}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Button
                  variant={showFilterPanel ? 'contained' : 'outlined'}
                  startIcon={<FilterList />}
                  onClick={() => setShowFilterPanel(!showFilterPanel)}
                  size="small"
                >
                  {t('common.filters')}
                  {!isEmpty(filters) && (
                    <Badge
                      badgeContent={Object.keys(filters).length}
                      color="error"
                      sx={{ ml: 1 }}
                    />
                  )}
                </Button>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showInactiveMembers}
                      onChange={(e) => setShowInactiveMembers(e.target.checked)}
                      size="small"
                    />
                  }
                  label={t('member.showInactive')}
                />
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={() => handleViewModeChange(ViewMode.LIST)}
                    color={viewMode === ViewMode.LIST ? 'primary' : 'default'}
                  >
                    <ViewList />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleViewModeChange(ViewMode.GRID)}
                    color={viewMode === ViewMode.GRID ? 'primary' : 'default'}
                  >
                    <ViewModule />
                  </IconButton>
                  {showHierarchy && (
                    <IconButton
                      size="small"
                      onClick={() => handleViewModeChange(ViewMode.HIERARCHY)}
                      color={viewMode === ViewMode.HIERARCHY ? 'primary' : 'default'}
                    >
                      <AccountTree />
                    </IconButton>
                  )}
                </Box>
                <IconButton size="small" onClick={fetchMembers} disabled={loading}>
                  <Refresh />
                </IconButton>
                <IconButton size="small" onClick={handlePrint}>
                  <Print />
                </IconButton>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Filter Panel */}
        {showFilterPanel && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <FilterPanel
              filters={filters}
              onChange={handleFilterChange}
              filterType="member"
              organizationId={organizationId}
            />
          </Paper>
        )}

        {/* Bulk Actions Toolbar */}
        {showBulkActions && selectedMembers.length > 0 && (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item>
                <Typography variant="body2">
                  {t('common.selected', { count: selectedMembers.length })}
                </Typography>
              </Grid>
              <Grid item xs>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    startIcon={<Edit />}
                    onClick={() => setBulkOperationDialog({ open: true, operation: 'status' })}
                  >
                    {t('member.updateStatus')}
                  </Button>
                  <Button
                    size="small"
                    startIcon={<Download />}
                    onClick={() => setBulkOperationDialog({ open: true, operation: 'export' })}
                  >
                    {t('common.export')}
                  </Button>
                  <Button
                    size="small"
                    startIcon={<Email />}
                    onClick={() => setBulkOperationDialog({ open: true, operation: 'email' })}
                  >
                    {t('common.email')}
                  </Button>
                </Box>
              </Grid>
              <Grid item>
                <Button
                  size="small"
                  onClick={() => setSelectedMembers([])}
                >
                  {t('common.clearSelection')}
                </Button>
              </Grid>
            </Grid>
            {bulkOperationProgress > 0 && (
              <LinearProgress
                variant="determinate"
                value={bulkOperationProgress}
                sx={{ mt: 1 }}
              />
            )}
          </Paper>
        )}

        {/* Content Area */}
        <Box sx={{ flex: 1, overflow: 'auto' }} ref={printRef}>
          {loading && renderLoadingState()}
          {!loading && error && renderErrorState()}
          {!loading && !error && members.length === 0 && renderEmptyState()}
          {!loading && !error && members.length > 0 && (
            <>
              {viewMode === ViewMode.LIST && (
                <>
                  {members.length > virtualizationThreshold ? (
                    <List
                      ref={listRef}
                      height={600}
                      itemCount={members.length}
                      itemSize={120}
                      width="100%"
                    >
                      {renderMemberRow}
                    </List>
                  ) : (
                    members.map((member, index) => renderMemberRow({ index, style: {} }))
                  )}
                </>
              )}
              {viewMode === ViewMode.GRID && renderGridView()}
              {viewMode === ViewMode.HIERARCHY && renderHierarchyView()}
            </>
          )}
          {!loading && !error && members.length > 0 && currentPage < totalPages && (
            <Box ref={infiniteScrollRef} sx={{ p: 2, textAlign: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Box>

        {/* Pagination */}
        {!loading && !error && members.length > 0 && viewMode !== ViewMode.HIERARCHY && (
          <Paper sx={{ p: 2, mt: 2 }}>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setCurrentPage(1);
                // TODO: Update page size
              }}
            />
          </Paper>
        )}

        {/* Member Preview Modal */}
        <Modal
          open={!!showMemberPreview}
          onClose={() => setShowMemberPreview(null)}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Paper sx={{ p: 3, maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }}>
            {showMemberPreview && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Avatar
                    src={showMemberPreview.profile_picture}
                    sx={{ width: 80, height: 80, mr: 2 }}
                  >
                    {showMemberPreview.full_name.charAt(0)}
                  </Avatar>
                  <Box>
                    <Typography variant="h5">{showMemberPreview.full_name}</Typography>
                    <Typography variant="subtitle1" color="text.secondary">
                      {showMemberPreview.job_title}
                    </Typography>
                  </Box>
                </Box>
                <Divider sx={{ my: 2 }} />
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('member.department')}
                    </Typography>
                    <Typography>{showMemberPreview.department}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('member.employmentStatus')}
                    </Typography>
                    <Typography>{showMemberPreview.employment_status}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('member.email')}
                    </Typography>
                    <Typography>{showMemberPreview.email}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">
                      {t('member.phone')}
                    </Typography>
                    <Typography>{showMemberPreview.phone || '-'}</Typography>
                  </Grid>
                </Grid>
                <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
                  <Button
                    variant="contained"
                    onClick={() => {
                      handleMemberSelect(showMemberPreview);
                      setShowMemberPreview(null);
                    }}
                  >
                    {t('member.viewDetails')}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => setShowMemberPreview(null)}
                  >
                    {t('common.close')}
                  </Button>
                </Box>
              </Box>
            )}
          </Paper>
        </Modal>

        {/* Context Menu */}
        <Menu
          open={contextMenu !== null}
          onClose={handleCloseContextMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu !== null
              ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
              : undefined
          }
        >
          {contextMenu?.member && (
            <>
              <MenuItem onClick={() => {
                handleMemberSelect(contextMenu.member!);
                handleCloseContextMenu();
              }}>
                <Visibility sx={{ mr: 1 }} />
                {t('common.view')}
              </MenuItem>
              {hasPermission('member.update') && (
                <MenuItem onClick={() => {
                  // TODO: Navigate to edit
                  handleCloseContextMenu();
                }}>
                  <Edit sx={{ mr: 1 }} />
                  {t('common.edit')}
                </MenuItem>
              )}
              <MenuItem onClick={() => {
                navigator.clipboard.writeText(contextMenu.member!.email);
                showNotification({
                  message: t('common.copiedToClipboard'),
                  severity: 'success'
                });
                handleCloseContextMenu();
              }}>
                <Email sx={{ mr: 1 }} />
                {t('member.copyEmail')}
              </MenuItem>
              <Divider />
              {hasPermission('member.delete') && (
                <MenuItem onClick={() => {
                  // TODO: Handle deactivation
                  handleCloseContextMenu();
                }}>
                  <Delete sx={{ mr: 1 }} color="error" />
                  <Typography color="error">{t('member.deactivate')}</Typography>
                </MenuItem>
              )}
            </>
          )}
        </Menu>

        {/* Bulk Operation Dialogs */}
        <Dialog
          open={bulkOperationDialog.open}
          onClose={() => setBulkOperationDialog({ open: false, operation: null })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            {bulkOperationDialog.operation === 'status' && t('member.bulkStatusUpdate')}
            {bulkOperationDialog.operation === 'export' && t('member.exportMembers')}
            {bulkOperationDialog.operation === 'email' && t('member.sendBulkEmail')}
          </DialogTitle>
          <DialogContent>
            {bulkOperationDialog.operation === 'status' && (
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>{t('member.newStatus')}</InputLabel>
                <Select
                  label={t('member.newStatus')}
                  onChange={(e) => handleBulkStatusUpdate(e.target.value as EmploymentStatus)}
                >
                  {Object.values(EmploymentStatus).map(status => (
                    <MenuItem key={status} value={status}>
                      {t(`member.status.${status}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {bulkOperationDialog.operation === 'export' && (
              <FormControl fullWidth sx={{ mt: 2 }}>
                <InputLabel>{t('common.format')}</InputLabel>
                <Select
                  label={t('common.format')}
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as any)}
                >
                  <MenuItem value="csv">CSV</MenuItem>
                  <MenuItem value="excel">Excel</MenuItem>
                  <MenuItem value="pdf">PDF</MenuItem>
                </Select>
              </FormControl>
            )}
            {bulkOperationDialog.operation === 'email' && (
              <Typography sx={{ mt: 2 }}>
                {/* TODO: Implement bulk email UI */}
                {t('member.bulkEmailComingSoon')}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBulkOperationDialog({ open: false, operation: null })}>
              {t('common.cancel')}
            </Button>
            {bulkOperationDialog.operation === 'export' && (
              <Button variant="contained" onClick={handleBulkExport}>
                {t('common.export')}
              </Button>
            )}
          </DialogActions>
        </Dialog>
      </Box>
    </ErrorBoundary>
  );
};

export default MemberList;
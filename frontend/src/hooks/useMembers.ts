import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { debounce, isEqual, cloneDeep, groupBy, sortBy } from 'lodash';
import { differenceInDays, format, parseISO, isAfter, isBefore } from 'date-fns';
import {
  Member,
  MemberCreate,
  MemberUpdate,
  MemberFilter,
  MemberStats,
  MemberProfile,
  MemberListResponse,
  MemberHierarchy,
  MemberSkillAssignment,
  MemberStatusChange
} from '../types/member';
import { Organization } from '../types/organization';
import memberService from '../services/memberService';
import useDebounce from './useDebounce';
import useNotification from './useNotification';
import useAuth from './useAuth';
import useWebSocket from './useWebSocket';
import useLocalStorage from './useLocalStorage';
import useOrganization from './useOrganization';

// Configuration interfaces
export interface MemberHookConfig {
  organizationId?: string;
  departmentFilter?: string;
  managerId?: string;
  autoRefresh?: boolean;
  cacheEnabled?: boolean;
  includeInactive?: boolean;
  hierarchyMode?: boolean;
  initialFilters?: Partial<MemberFilter>;
}

export interface MemberHookReturn {
  members: Member[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filters: MemberFilter;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  selectedMembers: string[];
  statistics: MemberStats | null;
  organizationalHierarchy: MemberHierarchy | null;
  memberProfiles: Map<string, MemberProfile>;
  lastUpdated: Date | null;
  fetchMembers: () => Promise<void>;
  createMember: (data: MemberCreate) => Promise<Member>;
  updateMember: (id: string, data: MemberUpdate) => Promise<Member>;
  deleteMember: (id: string) => Promise<void>;
  getMemberById: (id: string) => Promise<MemberProfile>;
  bulkUpdateMemberStatus: (ids: string[], status: string) => Promise<void>;
  exportMembers: (format: string) => Promise<void>;
  searchMembers: (query: string) => Promise<void>;
  getMemberStatistics: () => Promise<void>;
  getOrganizationalHierarchy: () => Promise<void>;
  manageMemberSkills: (memberId: string, skills: MemberSkillAssignment[]) => Promise<void>;
  updateMemberStatus: (id: string, statusChange: MemberStatusChange) => Promise<void>;
  setFilters: (filters: Partial<MemberFilter>) => void;
  setSorting: (field: string, order?: 'asc' | 'desc') => void;
  setPagination: (page: number, size?: number) => void;
  toggleMemberSelection: (id: string) => void;
  clearSelection: () => void;
  refreshData: () => Promise<void>;
  invalidateCache: () => void;
  assignManager: (memberId: string, managerId: string) => Promise<void>;
  reassignSubordinates: (fromManagerId: string, toManagerId: string) => Promise<void>;
  calculateMemberTenure: (member: Member) => number;
  validateOrganizationalHierarchy: () => Promise<boolean>;
}

// Environment configuration
const CACHE_TTL = parseInt(process.env.REACT_APP_MEMBER_CACHE_TTL || '600000');
const AUTO_REFRESH_INTERVAL = parseInt(process.env.REACT_APP_MEMBER_REFRESH_INTERVAL || '60000');
const MAX_RETRIES = parseInt(process.env.REACT_APP_MEMBER_MAX_RETRIES || '3');
const SEARCH_DEBOUNCE = parseInt(process.env.REACT_APP_MEMBER_SEARCH_DEBOUNCE || '300');
const MAX_BULK_SIZE = parseInt(process.env.REACT_APP_MEMBER_MAX_BULK_SIZE || '100');
const WEBSOCKET_RECONNECT_TIMEOUT = parseInt(process.env.REACT_APP_WEBSOCKET_RECONNECT_TIMEOUT || '5000');
const CACHE_QUOTA = parseInt(process.env.REACT_APP_MEMBER_CACHE_QUOTA || '20971520'); // 20MB
const MAX_HIERARCHY_DEPTH = parseInt(process.env.REACT_APP_MAX_HIERARCHY_DEPTH || '10');
const MAX_SPAN_OF_CONTROL = parseInt(process.env.REACT_APP_MAX_SPAN_OF_CONTROL || '15');
const AVATAR_CACHE_TTL = parseInt(process.env.REACT_APP_MEMBER_AVATAR_CACHE_TTL || '3600000');

export default function useMembers(config: MemberHookConfig = {}): MemberHookReturn {
  // State management
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFiltersState] = useState<MemberFilter>({
    ...config.initialFilters,
    organization_id: config.organizationId,
    department: config.departmentFilter,
    manager_id: config.managerId,
    include_inactive: config.includeInactive || false
  } as MemberFilter);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [statistics, setStatistics] = useState<MemberStats | null>(null);
  const [organizationalHierarchy, setOrganizationalHierarchy] = useState<MemberHierarchy | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, MemberProfile>>(new Map());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Refs for cleanup and optimization
  const refreshIntervalRef = useRef<NodeJS.Timeout>();
  const retryTimeoutRef = useRef<NodeJS.Timeout>();
  const searchDebounceRef = useRef<ReturnType<typeof debounce>>();
  const cacheRef = useRef<Map<string, { data: any; timestamp: number }>>(new Map());

  // Hooks
  const { showNotification } = useNotification();
  const { user, hasPermission } = useAuth();
  const { subscribe, unsubscribe } = useWebSocket();
  const [cachedData, setCachedData] = useLocalStorage('memberCache', null);
  const { currentOrganization, organizationPolicies } = useOrganization();
  const debouncedSearchQuery = useDebounce('', SEARCH_DEBOUNCE);

  // Initialize hook
  useEffect(() => {
    if (!hasPermission('members.read')) {
      setError('Insufficient permissions to access member data');
      return;
    }

    // Load cached data if enabled
    if (config.cacheEnabled && cachedData) {
      const cacheAge = Date.now() - cachedData.timestamp;
      if (cacheAge < CACHE_TTL) {
        setMembers(cachedData.members || []);
        setTotalCount(cachedData.totalCount || 0);
        setStatistics(cachedData.statistics || null);
        setLastUpdated(new Date(cachedData.timestamp));
      }
    }

    // Initial data fetch
    fetchMembers();

    // Set up real-time updates
    if (config.autoRefresh) {
      const subscriptionId = subscribe('member.*', handleRealTimeUpdate);
      
      refreshIntervalRef.current = setInterval(() => {
        refreshData();
      }, AUTO_REFRESH_INTERVAL);

      return () => {
        unsubscribe(subscriptionId);
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
      };
    }

    // Cleanup
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (searchDebounceRef.current) {
        searchDebounceRef.current.cancel();
      }
    };
  }, [config.organizationId, config.departmentFilter, config.managerId]);

  // Real-time update handler
  const handleRealTimeUpdate = useCallback((event: any) => {
    const { type, payload } = event;

    switch (type) {
      case 'member.created':
        if (shouldIncludeMember(payload, filters)) {
          setMembers(prev => [payload, ...prev]);
          setTotalCount(prev => prev + 1);
        }
        break;

      case 'member.updated':
        setMembers(prev => prev.map(m => m.id === payload.id ? payload : m));
        setMemberProfiles(prev => {
          const updated = new Map(prev);
          if (updated.has(payload.id)) {
            updated.set(payload.id, { ...updated.get(payload.id)!, ...payload });
          }
          return updated;
        });
        break;

      case 'member.deleted':
        setMembers(prev => prev.filter(m => m.id !== payload.id));
        setTotalCount(prev => Math.max(0, prev - 1));
        setMemberProfiles(prev => {
          const updated = new Map(prev);
          updated.delete(payload.id);
          return updated;
        });
        break;

      case 'member.status_changed':
        handleMemberStatusChanged(payload);
        break;

      case 'organization.hierarchy_changed':
        if (config.hierarchyMode) {
          getOrganizationalHierarchy();
        }
        break;

      case 'member.skills_updated':
        handleSkillsUpdated(payload);
        break;
    }
  }, [filters, config.hierarchyMode]);

  // Fetch members with retry logic
  const fetchMembers = useCallback(async (retryCount = 0): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const response = await memberService.getMembers({
        ...filters,
        page: currentPage,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder
      });

      setMembers(response.items);
      setTotalCount(response.total);
      setLastUpdated(new Date());

      // Cache data if enabled
      if (config.cacheEnabled) {
        const cacheData = {
          members: response.items,
          totalCount: response.total,
          statistics,
          timestamp: Date.now()
        };
        setCachedData(cacheData);
        updateCache('memberList', cacheData);
      }

      // Fetch hierarchy if in hierarchy mode
      if (config.hierarchyMode) {
        await getOrganizationalHierarchy();
      }

    } catch (err) {
      const errorMessage = handleApiError(err);
      setError(errorMessage);

      if (retryCount < MAX_RETRIES) {
        retryTimeoutRef.current = setTimeout(() => {
          fetchMembers(retryCount + 1);
        }, Math.pow(2, retryCount) * 1000);
      } else {
        showNotification({
          type: 'error',
          message: `Failed to fetch members: ${errorMessage}`
        });
      }
    } finally {
      setLoading(false);
    }
  }, [filters, currentPage, pageSize, sortBy, sortOrder, config.cacheEnabled, config.hierarchyMode]);

  // Create member
  const createMember = useCallback(async (data: MemberCreate): Promise<Member> => {
    try {
      // Validate permissions
      if (!hasPermission('members.create')) {
        throw new Error('Insufficient permissions to create members');
      }

      // Validate organizational constraints
      await validateOrganizationalConstraints(data);

      // Optimistic update
      const tempId = `temp-${Date.now()}`;
      const optimisticMember: Member = {
        id: tempId,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as Member;

      setMembers(prev => [optimisticMember, ...prev]);
      setTotalCount(prev => prev + 1);

      const createdMember = await memberService.createMember(data);

      // Replace optimistic update with real data
      setMembers(prev => prev.map(m => m.id === tempId ? createdMember : m));

      // Update hierarchy if needed
      if (data.manager_id && config.hierarchyMode) {
        await getOrganizationalHierarchy();
      }

      showNotification({
        type: 'success',
        message: `Member ${createdMember.first_name} ${createdMember.last_name} created successfully`
      });

      invalidateCache();
      return createdMember;

    } catch (err) {
      // Rollback optimistic update
      setMembers(prev => prev.filter(m => !m.id.startsWith('temp-')));
      setTotalCount(prev => Math.max(0, prev - 1));

      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to create member: ${errorMessage}`
      });
      throw err;
    }
  }, [config.hierarchyMode]);

  // Update member
  const updateMember = useCallback(async (id: string, data: MemberUpdate): Promise<Member> => {
    try {
      // Validate permissions
      if (!hasPermission('members.update')) {
        throw new Error('Insufficient permissions to update members');
      }

      // Store original for rollback
      const original = members.find(m => m.id === id);
      if (!original) {
        throw new Error('Member not found');
      }

      // Optimistic update
      const optimisticMember = { ...original, ...data, updated_at: new Date().toISOString() };
      setMembers(prev => prev.map(m => m.id === id ? optimisticMember : m));

      const updatedMember = await memberService.updateMember(id, data);

      // Update with real data
      setMembers(prev => prev.map(m => m.id === id ? updatedMember : m));
      setMemberProfiles(prev => {
        const updated = new Map(prev);
        if (updated.has(id)) {
          updated.set(id, { ...updated.get(id)!, ...updatedMember });
        }
        return updated;
      });

      // Update hierarchy if manager changed
      if (data.manager_id !== undefined && data.manager_id !== original.manager_id) {
        await getOrganizationalHierarchy();
      }

      showNotification({
        type: 'success',
        message: 'Member updated successfully'
      });

      invalidateCache();
      return updatedMember;

    } catch (err) {
      // Rollback optimistic update
      const original = members.find(m => m.id === id);
      if (original) {
        setMembers(prev => prev.map(m => m.id === id ? original : m));
      }

      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to update member: ${errorMessage}`
      });
      throw err;
    }
  }, [members, config.hierarchyMode]);

  // Delete member
  const deleteMember = useCallback(async (id: string): Promise<void> => {
    try {
      // Validate permissions
      if (!hasPermission('members.delete')) {
        throw new Error('Insufficient permissions to delete members');
      }

      // Confirm deletion
      const confirmed = await showConfirmDialog('Are you sure you want to delete this member?');
      if (!confirmed) return;

      // Check for subordinates
      const subordinates = members.filter(m => m.manager_id === id);
      if (subordinates.length > 0) {
        const reassign = await showConfirmDialog(
          `This member has ${subordinates.length} direct reports. Would you like to reassign them?`
        );
        if (reassign) {
          // TODO: Implement subordinate reassignment UI
          throw new Error('Please reassign subordinates before deleting this manager');
        }
      }

      // Store for undo
      const deletedMember = members.find(m => m.id === id);

      // Optimistic removal
      setMembers(prev => prev.filter(m => m.id !== id));
      setTotalCount(prev => Math.max(0, prev - 1));

      await memberService.deleteMember(id);

      // Update hierarchy if needed
      if (config.hierarchyMode) {
        await getOrganizationalHierarchy();
      }

      showNotification({
        type: 'success',
        message: 'Member deleted successfully',
        action: {
          label: 'Undo',
          onClick: async () => {
            if (deletedMember) {
              await createMember(deletedMember as MemberCreate);
            }
          }
        }
      });

      invalidateCache();

    } catch (err) {
      // Rollback
      await fetchMembers();

      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to delete member: ${errorMessage}`
      });
      throw err;
    }
  }, [members, config.hierarchyMode]);

  // Get member by ID with caching
  const getMemberById = useCallback(async (id: string): Promise<MemberProfile> => {
    try {
      // Check cache first
      if (memberProfiles.has(id)) {
        const cached = memberProfiles.get(id)!;
        const cacheAge = Date.now() - (cached.cached_at || 0);
        if (cacheAge < CACHE_TTL) {
          return cached;
        }
      }

      setLoading(true);
      const profile = await memberService.getMemberById(id);

      // Update cache
      setMemberProfiles(prev => {
        const updated = new Map(prev);
        updated.set(id, { ...profile, cached_at: Date.now() });
        return updated;
      });

      return profile;

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to fetch member profile: ${errorMessage}`
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [memberProfiles]);

  // Bulk update member status
  const bulkUpdateMemberStatus = useCallback(async (ids: string[], status: string): Promise<void> => {
    try {
      // Validate permissions
      if (!hasPermission('members.bulk_update')) {
        throw new Error('Insufficient permissions for bulk operations');
      }

      // Validate bulk size
      if (ids.length > MAX_BULK_SIZE) {
        throw new Error(`Cannot update more than ${MAX_BULK_SIZE} members at once`);
      }

      // Validate status transitions
      const affectedMembers = members.filter(m => ids.includes(m.id));
      for (const member of affectedMembers) {
        await validateStatusTransition(member, status);
      }

      setLoading(true);
      showNotification({
        type: 'info',
        message: `Updating ${ids.length} members...`
      });

      const result = await memberService.bulkUpdateMemberStatus(ids, status);

      // Handle partial success
      if (result.failed && result.failed.length > 0) {
        showNotification({
          type: 'warning',
          message: `Updated ${result.succeeded.length} members. ${result.failed.length} failed.`
        });
      } else {
        showNotification({
          type: 'success',
          message: `Successfully updated ${ids.length} members`
        });
      }

      // Refresh data
      await fetchMembers();
      clearSelection();

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Bulk update failed: ${errorMessage}`
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [members]);

  // Export members
  const exportMembers = useCallback(async (format: string): Promise<void> => {
    try {
      setLoading(true);
      showNotification({
        type: 'info',
        message: 'Preparing export...'
      });

      const exportData = await memberService.exportMembers({
        ...filters,
        format,
        include_profiles: true,
        anonymize: !hasPermission('members.export_sensitive')
      });

      // Trigger download
      const blob = new Blob([exportData.data], { type: exportData.contentType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `members_export_${format}_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showNotification({
        type: 'success',
        message: 'Export completed successfully'
      });

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Export failed: ${errorMessage}`
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Search members
  const searchMembers = useCallback(async (query: string): Promise<void> => {
    if (!searchDebounceRef.current) {
      searchDebounceRef.current = debounce(async (searchQuery: string) => {
        try {
          setLoading(true);
          const results = await memberService.searchMembers({
            query: searchQuery,
            ...filters,
            page: 1,
            page_size: pageSize
          });

          setMembers(results.items);
          setTotalCount(results.total);
          setCurrentPage(1);

          // Store search in history
          addToSearchHistory(searchQuery);

        } catch (err) {
          const errorMessage = handleApiError(err);
          showNotification({
            type: 'error',
            message: `Search failed: ${errorMessage}`
          });
        } finally {
          setLoading(false);
        }
      }, SEARCH_DEBOUNCE);
    }

    searchDebounceRef.current(query);
  }, [filters, pageSize]);

  // Get member statistics
  const getMemberStatistics = useCallback(async (): Promise<void> => {
    try {
      // Check cache
      const cached = getCachedData('statistics');
      if (cached) {
        setStatistics(cached);
        return;
      }

      const stats = await memberService.getMemberStatistics(filters);
      setStatistics(stats);

      // Cache statistics
      updateCache('statistics', stats);

    } catch (err) {
      const errorMessage = handleApiError(err);
      console.error('Failed to fetch statistics:', errorMessage);
    }
  }, [filters]);

  // Get organizational hierarchy
  const getOrganizationalHierarchy = useCallback(async (): Promise<void> => {
    try {
      const hierarchy = await memberService.getOrganizationalHierarchy({
        organization_id: config.organizationId,
        max_depth: MAX_HIERARCHY_DEPTH
      });

      // Validate hierarchy
      const isValid = await validateHierarchyIntegrity(hierarchy);
      if (!isValid) {
        showNotification({
          type: 'warning',
          message: 'Organizational hierarchy contains inconsistencies'
        });
      }

      setOrganizationalHierarchy(hierarchy);

      // Cache hierarchy
      updateCache('hierarchy', hierarchy);

    } catch (err) {
      const errorMessage = handleApiError(err);
      console.error('Failed to fetch hierarchy:', errorMessage);
    }
  }, [config.organizationId]);

  // Manage member skills
  const manageMemberSkills = useCallback(async (
    memberId: string,
    skills: MemberSkillAssignment[]
  ): Promise<void> => {
    try {
      // Validate skill taxonomy
      await validateSkillTaxonomy(skills);

      await memberService.manageMemberSkills(memberId, skills);

      // Update local state
      const updatedMember = await getMemberById(memberId);
      setMembers(prev => prev.map(m => m.id === memberId ? updatedMember : m));

      showNotification({
        type: 'success',
        message: 'Skills updated successfully'
      });

      invalidateCache();

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to update skills: ${errorMessage}`
      });
      throw err;
    }
  }, []);

  // Update member status
  const updateMemberStatus = useCallback(async (
    id: string,
    statusChange: MemberStatusChange
  ): Promise<void> => {
    try {
      // Validate status transition
      const member = members.find(m => m.id === id);
      if (!member) throw new Error('Member not found');

      await validateStatusTransition(member, statusChange.new_status);

      // Check for approval requirements
      if (requiresApproval(statusChange)) {
        showNotification({
          type: 'info',
          message: 'Status change requires approval. Workflow initiated.'
        });
      }

      await memberService.updateMemberStatus(id, statusChange);

      // Refresh member data
      await fetchMembers();

      showNotification({
        type: 'success',
        message: 'Member status updated successfully'
      });

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to update status: ${errorMessage}`
      });
      throw err;
    }
  }, [members]);

  // Set filters
  const setFilters = useCallback((newFilters: Partial<MemberFilter>): void => {
    setFiltersState(prev => {
      const updated = { ...prev, ...newFilters };
      
      // Validate filter combinations
      validateFilterCombinations(updated);

      // Reset pagination when filters change
      setCurrentPage(1);

      // Persist filters
      if (config.cacheEnabled) {
        localStorage.setItem('memberFilters', JSON.stringify(updated));
      }

      return updated;
    });
  }, [config.cacheEnabled]);

  // Set sorting
  const setSorting = useCallback((field: string, order?: 'asc' | 'desc'): void => {
    setSortBy(field);
    setSortOrder(order || (sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc'));

    // Persist sort preferences
    if (config.cacheEnabled) {
      localStorage.setItem('memberSort', JSON.stringify({ field, order }));
    }
  }, [sortBy, sortOrder, config.cacheEnabled]);

  // Set pagination
  const setPagination = useCallback((page: number, size?: number): void => {
    // Validate boundaries
    const maxPage = Math.ceil(totalCount / (size || pageSize));
    const validPage = Math.max(1, Math.min(page, maxPage || 1));

    setCurrentPage(validPage);
    if (size && size > 0 && size <= 100) {
      setPageSize(size);
    }

    // Persist pagination preferences
    if (config.cacheEnabled) {
      localStorage.setItem('memberPagination', JSON.stringify({ page: validPage, size }));
    }
  }, [totalCount, pageSize, config.cacheEnabled]);

  // Toggle member selection
  const toggleMemberSelection = useCallback((id: string): void => {
    setSelectedMembers(prev => {
      if (prev.includes(id)) {
        return prev.filter(memberId => memberId !== id);
      }
      
      // Check selection limit
      if (prev.length >= MAX_BULK_SIZE) {
        showNotification({
          type: 'warning',
          message: `Cannot select more than ${MAX_BULK_SIZE} members`
        });
        return prev;
      }

      return [...prev, id];
    });
  }, []);

  // Clear selection
  const clearSelection = useCallback((): void => {
    if (selectedMembers.length > 10) {
      showConfirmDialog('Clear all selected members?').then(confirmed => {
        if (confirmed) {
          setSelectedMembers([]);
        }
      });
    } else {
      setSelectedMembers([]);
    }
  }, [selectedMembers]);

  // Refresh data
  const refreshData = useCallback(async (): Promise<void> => {
    try {
      // Bypass cache for fresh data
      cacheRef.current.clear();
      
      showNotification({
        type: 'info',
        message: 'Refreshing data...'
      });

      await Promise.all([
        fetchMembers(),
        getMemberStatistics(),
        config.hierarchyMode ? getOrganizationalHierarchy() : Promise.resolve()
      ]);

      showNotification({
        type: 'success',
        message: 'Data refreshed successfully'
      });

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Refresh failed: ${errorMessage}`
      });
    }
  }, [config.hierarchyMode]);

  // Invalidate cache
  const invalidateCache = useCallback((): void => {
    cacheRef.current.clear();
    localStorage.removeItem('memberCache');
    setLastUpdated(null);
  }, []);

  // Assign manager
  const assignManager = useCallback(async (memberId: string, managerId: string): Promise<void> => {
    try {
      // Prevent circular references
      await validateReportingRelationship(memberId, managerId);

      // Check span of control
      const managerSubordinates = members.filter(m => m.manager_id === managerId);
      if (managerSubordinates.length >= MAX_SPAN_OF_CONTROL) {
        throw new Error(`Manager already has maximum number of direct reports (${MAX_SPAN_OF_CONTROL})`);
      }

      await updateMember(memberId, { manager_id: managerId });

      // Update hierarchy
      if (config.hierarchyMode) {
        await getOrganizationalHierarchy();
      }

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to assign manager: ${errorMessage}`
      });
      throw err;
    }
  }, [members, config.hierarchyMode]);

  // Reassign subordinates
  const reassignSubordinates = useCallback(async (
    fromManagerId: string,
    toManagerId: string
  ): Promise<void> => {
    try {
      setLoading(true);

      const subordinates = members.filter(m => m.manager_id === fromManagerId);
      if (subordinates.length === 0) {
        showNotification({
          type: 'info',
          message: 'No subordinates to reassign'
        });
        return;
      }

      // Validate new manager capacity
      const toManagerSubordinates = members.filter(m => m.manager_id === toManagerId);
      if (toManagerSubordinates.length + subordinates.length > MAX_SPAN_OF_CONTROL) {
        throw new Error('New manager would exceed maximum span of control');
      }

      // Batch update
      const updatePromises = subordinates.map(sub =>
        updateMember(sub.id, { manager_id: toManagerId })
      );

      await Promise.all(updatePromises);

      showNotification({
        type: 'success',
        message: `Successfully reassigned ${subordinates.length} subordinates`
      });

      // Update hierarchy
      if (config.hierarchyMode) {
        await getOrganizationalHierarchy();
      }

    } catch (err) {
      const errorMessage = handleApiError(err);
      showNotification({
        type: 'error',
        message: `Failed to reassign subordinates: ${errorMessage}`
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [members, config.hierarchyMode]);

  // Calculate member tenure
  const calculateMemberTenure = useCallback((member: Member): number => {
    if (!member.hire_date) return 0;
    
    const hireDate = parseISO(member.hire_date);
    const endDate = member.termination_date ? parseISO(member.termination_date) : new Date();
    
    return differenceInDays(endDate, hireDate);
  }, []);

  // Validate organizational hierarchy
  const validateOrganizationalHierarchy = useCallback(async (): Promise<boolean> => {
    try {
      // Check for circular references
      const circularRefs = detectCircularReferences(members);
      if (circularRefs.length > 0) {
        showNotification({
          type: 'error',
          message: `Circular reporting relationships detected: ${circularRefs.join(', ')}`
        });
        return false;
      }

      // Check span of control
      const spanViolations = checkSpanOfControl(members, MAX_SPAN_OF_CONTROL);
      if (spanViolations.length > 0) {
        showNotification({
          type: 'warning',
          message: `Managers exceeding span of control: ${spanViolations.join(', ')}`
        });
      }

      // Check hierarchy depth
      const depthViolations = checkHierarchyDepth(members, MAX_HIERARCHY_DEPTH);
      if (depthViolations.length > 0) {
        showNotification({
          type: 'warning',
          message: `Hierarchy depth exceeded in some areas`
        });
      }

      return circularRefs.length === 0;

    } catch (err) {
      console.error('Hierarchy validation failed:', err);
      return false;
    }
  }, [members]);

  // Utility functions
  const shouldIncludeMember = (member: Member, filters: MemberFilter): boolean => {
    if (filters.organization_id && member.organization_id !== filters.organization_id) return false;
    if (filters.department && member.department !== filters.department) return false;
    if (filters.manager_id && member.manager_id !== filters.manager_id) return false;
    if (!filters.include_inactive && member.employment_status === 'inactive') return false;
    return true;
  };

  const handleApiError = (error: any): string => {
    if (error.response?.data?.detail) {
      return error.response.data.detail;
    }
    if (error.message) {
      return error.message;
    }
    return 'An unexpected error occurred';
  };

  const validateOrganizationalConstraints = async (data: MemberCreate): Promise<void> => {
    // Validate email uniqueness
    const existingMember = members.find(m => m.email === data.email);
    if (existingMember) {
      throw new Error('A member with this email already exists');
    }

    // Validate organizational policies
    if (organizationPolicies?.requireManagerApproval && !data.manager_id) {
      throw new Error('Manager assignment is required by organizational policy');
    }
  };

  const validateStatusTransition = async (member: Member, newStatus: string): Promise<void> => {
    const validTransitions: Record<string, string[]> = {
      'active': ['on_leave', 'terminated', 'suspended'],
      'on_leave': ['active', 'terminated'],
      'suspended': ['active', 'terminated'],
      'terminated': []
    };

    const currentStatus = member.employment_status;
    const allowed = validTransitions[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
  };

  const requiresApproval = (statusChange: MemberStatusChange): boolean => {
    return statusChange.new_status === 'terminated' || 
           statusChange.new_status === 'suspended';
  };

  const validateFilterCombinations = (filters: MemberFilter): void => {
    // Validate date ranges
    if (filters.hire_date_start && filters.hire_date_end) {
      const start = parseISO(filters.hire_date_start);
      const end = parseISO(filters.hire_date_end);
      if (isAfter(start, end)) {
        throw new Error('Invalid date range: start date must be before end date');
      }
    }
  };

  const validateSkillTaxonomy = async (skills: MemberSkillAssignment[]): Promise<void> => {
    // TODO: Integrate with skill taxonomy service
    for (const skill of skills) {
      if (skill.proficiency_level < 1 || skill.proficiency_level > 5) {
        throw new Error('Proficiency level must be between 1 and 5');
      }
    }
  };

  const validateReportingRelationship = async (memberId: string, managerId: string): Promise<void> => {
    if (memberId === managerId) {
      throw new Error('A member cannot report to themselves');
    }

    // Check for circular reference
    let currentManager = managerId;
    const visited = new Set<string>();

    while (currentManager) {
      if (visited.has(currentManager)) {
        throw new Error('This would create a circular reporting relationship');
      }
      visited.add(currentManager);

      const manager = members.find(m => m.id === currentManager);
      if (!manager) break;

      if (manager.manager_id === memberId) {
        throw new Error('This would create a circular reporting relationship');
      }

      currentManager = manager.manager_id || '';
    }
  };

  const validateHierarchyIntegrity = async (hierarchy: MemberHierarchy): Promise<boolean> => {
    // TODO: Implement comprehensive hierarchy validation
    return true;
  };

  const detectCircularReferences = (members: Member[]): string[] => {
    const circular: string[] = [];
    
    for (const member of members) {
      const visited = new Set<string>();
      let current = member;
      
      while (current.manager_id) {
        if (visited.has(current.id)) {
          circular.push(member.id);
          break;
        }
        visited.add(current.id);
        
        const manager = members.find(m => m.id === current.manager_id);
        if (!manager) break;
        current = manager;
      }
    }
    
    return circular;
  };

  const checkSpanOfControl = (members: Member[], limit: number): string[] => {
    const managerCounts = new Map<string, number>();
    
    for (const member of members) {
      if (member.manager_id) {
        managerCounts.set(
          member.manager_id,
          (managerCounts.get(member.manager_id) || 0) + 1
        );
      }
    }
    
    return Array.from(managerCounts.entries())
      .filter(([_, count]) => count > limit)
      .map(([managerId]) => managerId);
  };

  const checkHierarchyDepth = (members: Member[], maxDepth: number): string[] => {
    const violations: string[] = [];
    
    const getDepth = (memberId: string, depth = 0): number => {
      if (depth > maxDepth) {
        violations.push(memberId);
        return depth;
      }
      
      const member = members.find(m => m.id === memberId);
      if (!member || !member.manager_id) return depth;
      
      return getDepth(member.manager_id, depth + 1);
    };
    
    for (const member of members) {
      getDepth(member.id);
    }
    
    return violations;
  };

  const getCachedData = (key: string): any => {
    const cached = cacheRef.current.get(key);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL) {
      cacheRef.current.delete(key);
      return null;
    }
    
    return cached.data;
  };

  const updateCache = (key: string, data: any): void => {
    cacheRef.current.set(key, {
      data,
      timestamp: Date.now()
    });
  };

  const showConfirmDialog = async (message: string): Promise<boolean> => {
    // TODO: Implement proper confirmation dialog
    return window.confirm(message);
  };

  const addToSearchHistory = (query: string): void => {
    const history = JSON.parse(localStorage.getItem('memberSearchHistory') || '[]');
    const updated = [query, ...history.filter((q: string) => q !== query)].slice(0, 10);
    localStorage.setItem('memberSearchHistory', JSON.stringify(updated));
  };

  const handleMemberStatusChanged = (payload: any): void => {
    setMembers(prev => prev.map(m => 
      m.id === payload.member_id 
        ? { ...m, employment_status: payload.new_status }
        : m
    ));
  };

  const handleSkillsUpdated = (payload: any): void => {
    setMembers(prev => prev.map(m => 
      m.id === payload.member_id 
        ? { ...m, skills: payload.skills }
        : m
    ));
  };

  // Return hook interface
  return {
    members,
    loading,
    error,
    totalCount,
    currentPage,
    pageSize,
    filters,
    sortBy,
    sortOrder,
    selectedMembers,
    statistics,
    organizationalHierarchy,
    memberProfiles,
    lastUpdated,
    fetchMembers,
    createMember,
    updateMember,
    deleteMember,
    getMemberById,
    bulkUpdateMemberStatus,
    exportMembers,
    searchMembers,
    getMemberStatistics,
    getOrganizationalHierarchy,
    manageMemberSkills,
    updateMemberStatus,
    setFilters,
    setSorting,
    setPagination,
    toggleMemberSelection,
    clearSelection,
    refreshData,
    invalidateCache,
    assignManager,
    reassignSubordinates,
    calculateMemberTenure,
    validateOrganizationalHierarchy
  };
}

// Export utility functions
export function createMemberFilter(params: Partial<MemberFilter>): MemberFilter {
  return {
    include_inactive: false,
    ...params
  } as MemberFilter;
}

export function validateMemberData(data: MemberCreate): string[] {
  const errors: string[] = [];
  
  if (!data.email || !data.email.includes('@')) {
    errors.push('Valid email is required');
  }
  
  if (!data.first_name || data.first_name.length < 2) {
    errors.push('First name must be at least 2 characters');
  }
  
  if (!data.last_name || data.last_name.length < 2) {
    errors.push('Last name must be at least 2 characters');
  }
  
  if (data.hire_date) {
    const hireDate = parseISO(data.hire_date);
    if (isAfter(hireDate, new Date())) {
      errors.push('Hire date cannot be in the future');
    }
  }
  
  return errors;
}

export function formatMemberForDisplay(member: Member): string {
  return `${member.first_name} ${member.last_name} (${member.email})`;
}

export function buildOrganizationalChart(members: Member[]): any {
  const memberMap = new Map(members.map(m => [m.id, m]));
  const roots: Member[] = [];
  const tree: any = {};
  
  // Build tree structure
  for (const member of members) {
    if (!member.manager_id) {
      roots.push(member);
    } else {
      if (!tree[member.manager_id]) {
        tree[member.manager_id] = [];
      }
      tree[member.manager_id].push(member);
    }
  }
  
  // Build hierarchical structure
  const buildNode = (member: Member): any => ({
    id: member.id,
    name: formatMemberForDisplay(member),
    title: member.job_title,
    department: member.department,
    children: (tree[member.id] || []).map(buildNode)
  });
  
  return roots.map(buildNode);
}

export function calculateTenure(hireDate: string, terminationDate?: string): {
  years: number;
  months: number;
  days: number;
  totalDays: number;
} {
  const start = parseISO(hireDate);
  const end = terminationDate ? parseISO(terminationDate) : new Date();
  const totalDays = differenceInDays(end, start);
  
  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays % 30;
  
  return { years, months, days, totalDays };
}
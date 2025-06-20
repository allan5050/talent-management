// Enum definitions for feedback management
export enum FeedbackType {
  PERFORMANCE = 'performance',
  BEHAVIORAL = 'behavioral',
  TECHNICAL = 'technical',
  CULTURAL_FIT = 'cultural_fit',
  INTERVIEW = 'interview',
  PEER_REVIEW = 'peer_review',
  MANAGER_REVIEW = 'manager_review',
  SELF_ASSESSMENT = 'self_assessment',
  EXIT_INTERVIEW = 'exit_interview',
  ONBOARDING = 'onboarding',
  PROJECT_REVIEW = 'project_review',
  SKILL_ASSESSMENT = 'skill_assessment'
}

export enum FeedbackStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  REVIEWED = 'reviewed',
  ACKNOWLEDGED = 'acknowledged',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
  PENDING_APPROVAL = 'pending_approval',
  REJECTED = 'rejected'
}

export enum FeedbackPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
  URGENT = 'urgent'
}

export enum FeedbackVisibility {
  PRIVATE = 'private',
  MANAGER_ONLY = 'manager_only',
  TEAM_VISIBLE = 'team_visible',
  DEPARTMENT_VISIBLE = 'department_visible',
  ORGANIZATION_WIDE = 'organization_wide',
  PUBLIC = 'public'
}

export enum FeedbackCategory {
  POSITIVE = 'positive',
  CONSTRUCTIVE = 'constructive',
  DEVELOPMENTAL = 'developmental',
  RECOGNITION = 'recognition',
  IMPROVEMENT_NEEDED = 'improvement_needed',
  GOAL_SETTING = 'goal_setting',
  PERFORMANCE_ISSUE = 'performance_issue',
  ACHIEVEMENT = 'achievement'
}

// Core interfaces
export interface BaseFeedback {
  id: string;
  member_id: string;
  organization_id: string;
  provider_id?: string;
  content: string;
  feedback_type: FeedbackType;
  rating: number;
  rating_scale: number;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  visibility: FeedbackVisibility;
  status: FeedbackStatus;
  tags: string[];
  metadata: Record<string, any>;
}

export interface Feedback extends BaseFeedback {
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  version: number;
  is_deleted: boolean;
  provider_name?: string;
  member_name: string;
  organization_name: string;
}

export interface FeedbackCreate {
  member_id: string;
  organization_id: string;
  content: string;
  feedback_type: FeedbackType;
  rating: number;
  provider_id?: string;
  rating_scale?: number;
  category?: FeedbackCategory;
  priority?: FeedbackPriority;
  visibility?: FeedbackVisibility;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface FeedbackUpdate {
  id?: string;
  member_id?: string;
  organization_id?: string;
  provider_id?: string;
  content?: string;
  feedback_type?: FeedbackType;
  rating?: number;
  rating_scale?: number;
  category?: FeedbackCategory;
  priority?: FeedbackPriority;
  visibility?: FeedbackVisibility;
  status?: FeedbackStatus;
  tags?: string[];
  metadata?: Record<string, any>;
  version?: number;
}

export interface FeedbackResponse extends Feedback {
  provider_info?: {
    id: string;
    name: string;
    email: string;
    department?: string;
    job_title?: string;
  };
  member_info: {
    id: string;
    name: string;
    email: string;
    department?: string;
    job_title?: string;
    employment_status?: string;
  };
  organization_context: {
    id: string;
    name: string;
    department?: string;
    team?: string;
  };
  rating_display: {
    rating: number;
    scale: number;
    percentage: number;
    display_text: string;
  };
  status_info: {
    status: FeedbackStatus;
    status_label: string;
    status_color: string;
    can_transition_to: FeedbackStatus[];
  };
  response_metadata: {
    request_id: string;
    timestamp: Date;
    version: string;
  };
}

// Filter and query interfaces
export interface FeedbackFilter {
  member_id?: string;
  organization_id?: string;
  provider_id?: string;
  feedback_type?: FeedbackType[];
  category?: FeedbackCategory[];
  priority?: FeedbackPriority[];
  status?: FeedbackStatus[];
  visibility?: FeedbackVisibility[];
  rating_range?: {
    min_rating: number;
    max_rating: number;
  };
  date_range?: {
    start_date: Date;
    end_date: Date;
  };
  tags?: string[];
  search_term?: string;
  has_attachments?: boolean;
  sort_options?: {
    field: string;
    direction: 'asc' | 'desc';
  };
}

export interface FeedbackListResponse {
  items: Feedback[];
  total_count: number;
  page_number: number;
  page_size: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
  filters_applied: Record<string, any>;
  sort_applied: {
    field: string;
    direction: string;
  };
  response_metadata: {
    query_time_ms: number;
    cached: boolean;
    cache_key?: string;
  };
}

// Statistics and analytics interfaces
export interface FeedbackStats {
  total_count: number;
  average_rating: number;
  rating_distribution: Record<number, number>;
  feedback_type_counts: Record<FeedbackType, number>;
  category_breakdown: Record<FeedbackCategory, number>;
  priority_distribution: Record<FeedbackPriority, number>;
  status_summary: Record<FeedbackStatus, number>;
  recent_feedback_count: number;
  trend_data: Array<{
    date: Date;
    count: number;
    average_rating: number;
  }>;
  member_participation_rate: number;
  provider_activity_stats: {
    total_providers: number;
    active_providers: number;
    average_feedbacks_per_provider: number;
  };
  organizational_insights: {
    department_stats: Record<string, any>;
    team_stats: Record<string, any>;
  };
}

// Bulk operation interfaces
export interface FeedbackBulkCreate {
  feedbacks: FeedbackCreate[];
  validation_options: {
    validate_all_before_create: boolean;
    stop_on_first_error: boolean;
    skip_duplicates: boolean;
  };
  processing_options: {
    batch_size: number;
    parallel_processing: boolean;
    timeout_seconds: number;
  };
  notification_settings: {
    notify_recipients: boolean;
    notify_providers: boolean;
    notification_template?: string;
  };
  metadata: Record<string, any>;
}

export interface FeedbackBulkResponse {
  successful_count: number;
  failed_count: number;
  errors: Array<{
    record_index: number;
    error_code: string;
    error_message: string;
    field_errors?: Record<string, string>;
  }>;
  created_feedback_ids: string[];
  skipped_count: number;
  processing_time: number;
  operation_summary: {
    total_processed: number;
    success_rate: number;
    average_processing_time_per_record: number;
  };
}

// Export and attachment interfaces
export interface FeedbackExport {
  export_format: 'json' | 'csv' | 'excel' | 'pdf';
  field_selection: string[];
  filter_criteria: FeedbackFilter;
  privacy_options: {
    anonymize_providers: boolean;
    exclude_sensitive_data: boolean;
    redact_personal_info: boolean;
  };
  date_range?: {
    start_date: Date;
    end_date: Date;
  };
  include_metadata: boolean;
  compression_options?: {
    compress: boolean;
    compression_type: 'zip' | 'gzip';
  };
  export_metadata: {
    requested_by: string;
    requested_at: Date;
    export_reason?: string;
  };
}

export interface FeedbackAttachment {
  id: string;
  feedback_id: string;
  filename: string;
  file_size: number;
  file_type: string;
  file_url: string;
  uploaded_at: Date;
  uploaded_by: string;
  is_public: boolean;
  thumbnail_url?: string;
  attachment_metadata: Record<string, any>;
}

export interface FeedbackComment {
  id: string;
  feedback_id: string;
  commenter_id: string;
  comment_text: string;
  created_at: Date;
  updated_at: Date;
  is_internal: boolean;
  parent_comment_id?: string;
  attachments: FeedbackAttachment[];
  comment_metadata: Record<string, any>;
}

// Template and workflow interfaces
export interface FeedbackTemplate {
  id: string;
  template_name: string;
  template_description: string;
  feedback_type: FeedbackType;
  default_content: string;
  rating_scale: number;
  suggested_tags: string[];
  visibility_default: FeedbackVisibility;
  is_organization_template: boolean;
  created_by: string;
  created_at: Date;
  template_metadata: Record<string, any>;
}

export interface FeedbackWorkflow {
  id: string;
  feedback_id: string;
  workflow_type: string;
  current_step: string;
  required_approvers: Array<{
    approver_id: string;
    approver_name: string;
    approval_order: number;
  }>;
  completed_approvals: Array<{
    approver_id: string;
    approved_at: Date;
    comments?: string;
  }>;
  pending_approvals: Array<{
    approver_id: string;
    requested_at: Date;
    due_date?: Date;
  }>;
  workflow_deadline?: Date;
  escalation_rules: Record<string, any>;
  workflow_metadata: Record<string, any>;
  status_history: Array<{
    status: FeedbackStatus;
    changed_at: Date;
    changed_by: string;
  }>;
}

// Notification and analytics interfaces
export interface FeedbackNotification {
  id: string;
  feedback_id: string;
  recipient_id: string;
  notification_type: string;
  notification_title: string;
  notification_message: string;
  is_read: boolean;
  created_at: Date;
  read_at?: Date;
  delivery_method: string;
  priority: FeedbackPriority;
  notification_metadata: Record<string, any>;
}

export interface FeedbackAnalytics {
  feedback_id: string;
  view_count: number;
  interaction_count: number;
  rating_changes: Array<{
    old_rating: number;
    new_rating: number;
    changed_at: Date;
    changed_by: string;
  }>;
  status_transitions: Array<{
    from_status: FeedbackStatus;
    to_status: FeedbackStatus;
    transitioned_at: Date;
    transitioned_by: string;
  }>;
  time_to_completion: number;
  engagement_score: number;
  impact_score: number;
  analytics_period: {
    start_date: Date;
    end_date: Date;
  };
  comparative_metrics: Record<string, any>;
  analytics_metadata: Record<string, any>;
}

// Validation and permissions interfaces
export interface FeedbackValidation {
  field_errors: Record<string, string>;
  business_rule_violations: Array<{
    rule_name: string;
    violation_message: string;
    severity: 'error' | 'warning';
  }>;
  warning_messages: string[];
  validation_context: Record<string, any>;
  is_valid: boolean;
  validation_timestamp: Date;
  validation_rules_applied: string[];
  validation_metadata: Record<string, any>;
}

export interface FeedbackPermissions {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_comment: boolean;
  can_approve: boolean;
  can_export: boolean;
  visibility_level: FeedbackVisibility;
  access_restrictions: string[];
  permission_context: Record<string, any>;
  permissions_metadata: Record<string, any>;
}

// Search and audit interfaces
export interface FeedbackSearchResult {
  feedback: Feedback;
  relevance_score: number;
  highlighted_fields: Record<string, string>;
  match_context: Record<string, any>;
  search_metadata: Record<string, any>;
  related_feedbacks: Array<{
    feedback_id: string;
    similarity_score: number;
  }>;
}

export interface FeedbackAuditLog {
  id: string;
  feedback_id: string;
  action_type: string;
  performed_by: string;
  performed_at: Date;
  old_values: Record<string, any>;
  new_values: Record<string, any>;
  change_summary: string;
  ip_address: string;
  user_agent: string;
  audit_metadata: Record<string, any>;
}

// Type utility definitions
export type FeedbackSortField = 'created_at' | 'updated_at' | 'rating' | 'priority' | 'member_name' | 'provider_name';
export type FeedbackFilterKey = keyof FeedbackFilter;
export type FeedbackOperationType = 'create' | 'update' | 'delete' | 'view' | 'export' | 'approve' | 'reject';
export type FeedbackEventType = 'feedback_created' | 'feedback_updated' | 'feedback_deleted' | 'feedback_approved' | 'feedback_rejected' | 'feedback_commented';
export type FeedbackDisplayMode = 'card' | 'list' | 'table' | 'timeline' | 'analytics';

// Generic type definitions
export interface PaginatedResponse<T> {
  items: T[];
  total_count: number;
  page_number: number;
  page_size: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export interface FilterOptions<T> {
  filters: Partial<T>;
  operator: 'and' | 'or';
  case_sensitive: boolean;
}

export interface SortOptions<T> {
  field: keyof T;
  direction: 'asc' | 'desc';
  null_handling: 'first' | 'last';
}

export interface BulkOperationResult<T> {
  successful: T[];
  failed: Array<{
    item: T;
    error: string;
  }>;
  total_processed: number;
  success_rate: number;
}

export interface ValidationResult<T> {
  is_valid: boolean;
  validated_data?: T;
  errors: Record<string, string>;
  warnings: string[];
}

// Constants
export const DEFAULT_RATING_SCALE = 5;
export const MAX_CONTENT_LENGTH = 5000;
export const MAX_TAGS_PER_FEEDBACK = 10;
export const FEEDBACK_EXPORT_FORMATS = ['json', 'csv', 'excel', 'pdf'] as const;
export const FEEDBACK_NOTIFICATION_TYPES = [
  'feedback_received',
  'feedback_approved',
  'feedback_rejected',
  'feedback_commented',
  'feedback_updated',
  'feedback_reminder'
] as const;

// Utility functions
export function getFeedbackTypeLabel(type: FeedbackType): string {
  const labels: Record<FeedbackType, string> = {
    [FeedbackType.PERFORMANCE]: 'Performance Review',
    [FeedbackType.BEHAVIORAL]: 'Behavioral Assessment',
    [FeedbackType.TECHNICAL]: 'Technical Evaluation',
    [FeedbackType.CULTURAL_FIT]: 'Cultural Fit Assessment',
    [FeedbackType.INTERVIEW]: 'Interview Feedback',
    [FeedbackType.PEER_REVIEW]: 'Peer Review',
    [FeedbackType.MANAGER_REVIEW]: 'Manager Review',
    [FeedbackType.SELF_ASSESSMENT]: 'Self Assessment',
    [FeedbackType.EXIT_INTERVIEW]: 'Exit Interview',
    [FeedbackType.ONBOARDING]: 'Onboarding Feedback',
    [FeedbackType.PROJECT_REVIEW]: 'Project Review',
    [FeedbackType.SKILL_ASSESSMENT]: 'Skill Assessment'
  };
  return labels[type] || type;
}

export function getFeedbackStatusColor(status: FeedbackStatus): string {
  const colors: Record<FeedbackStatus, string> = {
    [FeedbackStatus.DRAFT]: '#6B7280',
    [FeedbackStatus.SUBMITTED]: '#3B82F6',
    [FeedbackStatus.UNDER_REVIEW]: '#F59E0B',
    [FeedbackStatus.REVIEWED]: '#8B5CF6',
    [FeedbackStatus.ACKNOWLEDGED]: '#10B981',
    [FeedbackStatus.PUBLISHED]: '#059669',
    [FeedbackStatus.ARCHIVED]: '#9CA3AF',
    [FeedbackStatus.DELETED]: '#EF4444',
    [FeedbackStatus.PENDING_APPROVAL]: '#F97316',
    [FeedbackStatus.REJECTED]: '#DC2626'
  };
  return colors[status] || '#6B7280';
}

export function getFeedbackPriorityOrder(priority: FeedbackPriority): number {
  const order: Record<FeedbackPriority, number> = {
    [FeedbackPriority.LOW]: 1,
    [FeedbackPriority.MEDIUM]: 2,
    [FeedbackPriority.HIGH]: 3,
    [FeedbackPriority.CRITICAL]: 4,
    [FeedbackPriority.URGENT]: 5
  };
  return order[priority] || 0;
}

export function isValidFeedbackTransition(currentStatus: FeedbackStatus, newStatus: FeedbackStatus): boolean {
  const validTransitions: Record<FeedbackStatus, FeedbackStatus[]> = {
    [FeedbackStatus.DRAFT]: [FeedbackStatus.SUBMITTED, FeedbackStatus.DELETED],
    [FeedbackStatus.SUBMITTED]: [FeedbackStatus.UNDER_REVIEW, FeedbackStatus.REJECTED, FeedbackStatus.DELETED],
    [FeedbackStatus.UNDER_REVIEW]: [FeedbackStatus.REVIEWED, FeedbackStatus.PENDING_APPROVAL, FeedbackStatus.REJECTED],
    [FeedbackStatus.REVIEWED]: [FeedbackStatus.ACKNOWLEDGED, FeedbackStatus.PUBLISHED, FeedbackStatus.REJECTED],
    [FeedbackStatus.ACKNOWLEDGED]: [FeedbackStatus.PUBLISHED, FeedbackStatus.ARCHIVED],
    [FeedbackStatus.PUBLISHED]: [FeedbackStatus.ARCHIVED],
    [FeedbackStatus.ARCHIVED]: [FeedbackStatus.PUBLISHED],
    [FeedbackStatus.DELETED]: [],
    [FeedbackStatus.PENDING_APPROVAL]: [FeedbackStatus.REVIEWED, FeedbackStatus.REJECTED],
    [FeedbackStatus.REJECTED]: [FeedbackStatus.DRAFT, FeedbackStatus.DELETED]
  };
  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

export function getFeedbackVisibilityLevel(visibility: FeedbackVisibility): number {
  const levels: Record<FeedbackVisibility, number> = {
    [FeedbackVisibility.PRIVATE]: 1,
    [FeedbackVisibility.MANAGER_ONLY]: 2,
    [FeedbackVisibility.TEAM_VISIBLE]: 3,
    [FeedbackVisibility.DEPARTMENT_VISIBLE]: 4,
    [FeedbackVisibility.ORGANIZATION_WIDE]: 5,
    [FeedbackVisibility.PUBLIC]: 6
  };
  return levels[visibility] || 0;
}

// Type guard functions
export function isFeedback(obj: any): obj is Feedback {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.member_id === 'string' &&
    typeof obj.organization_id === 'string' &&
    typeof obj.content === 'string' &&
    Object.values(FeedbackType).includes(obj.feedback_type) &&
    typeof obj.rating === 'number' &&
    obj.created_at instanceof Date &&
    obj.updated_at instanceof Date
  );
}

export function isFeedbackCreate(obj: any): obj is FeedbackCreate {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.member_id === 'string' &&
    typeof obj.organization_id === 'string' &&
    typeof obj.content === 'string' &&
    Object.values(FeedbackType).includes(obj.feedback_type) &&
    typeof obj.rating === 'number'
  );
}

export function isFeedbackFilter(obj: any): obj is FeedbackFilter {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj.member_id === undefined || typeof obj.member_id === 'string') &&
    (obj.organization_id === undefined || typeof obj.organization_id === 'string') &&
    (obj.search_term === undefined || typeof obj.search_term === 'string')
  );
}

export function isFeedbackStats(obj: any): obj is FeedbackStats {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.total_count === 'number' &&
    typeof obj.average_rating === 'number' &&
    typeof obj.rating_distribution === 'object' &&
    typeof obj.feedback_type_counts === 'object'
  );
}

export function isValidFeedbackId(id: any): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

// Interface extensions
export interface FeedbackWithMember extends Feedback {
  member: {
    id: string;
    name: string;
    email: string;
    department?: string;
    job_title?: string;
    profile_picture?: string;
  };
}

export interface FeedbackWithProvider extends Feedback {
  provider?: {
    id: string;
    name: string;
    email: string;
    department?: string;
    job_title?: string;
    profile_picture?: string;
  };
}

export interface FeedbackWithComments extends Feedback {
  comments: FeedbackComment[];
  comment_count: number;
  last_comment_at?: Date;
}

export interface FeedbackWithAttachments extends Feedback {
  attachments: FeedbackAttachment[];
  attachment_count: number;
  total_attachment_size: number;
}

export interface FeedbackWithAnalytics extends Feedback {
  analytics: FeedbackAnalytics;
  engagement_metrics: {
    views: number;
    interactions: number;
    shares: number;
  };
}

// API response wrappers
export interface FeedbackApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: Date;
  request_id: string;
}

export interface FeedbackErrorResponse {
  error: string;
  error_code: string;
  error_details?: Record<string, any>;
  timestamp: Date;
  request_id: string;
}

export interface FeedbackSuccessResponse<T> {
  data: T;
  message: string;
  timestamp: Date;
  request_id: string;
}

export interface FeedbackPaginatedApiResponse<T> extends PaginatedResponse<T> {
  success: boolean;
  message?: string;
  timestamp: Date;
  request_id: string;
}

// Form state interfaces
export interface FeedbackFormData {
  member_id: string;
  organization_id: string;
  provider_id?: string;
  content: string;
  feedback_type: FeedbackType;
  rating: number;
  rating_scale: number;
  category: FeedbackCategory;
  priority: FeedbackPriority;
  visibility: FeedbackVisibility;
  tags: string[];
  attachments: File[];
  metadata: Record<string, any>;
}

export interface FeedbackFormErrors {
  member_id?: string;
  organization_id?: string;
  content?: string;
  feedback_type?: string;
  rating?: string;
  category?: string;
  tags?: string;
  attachments?: string;
  general?: string;
}

export interface FeedbackFormState {
  data: FeedbackFormData;
  errors: FeedbackFormErrors;
  is_submitting: boolean;
  is_dirty: boolean;
  is_valid: boolean;
  touched_fields: Set<string>;
}

export interface FeedbackFormConfig {
  mode: 'create' | 'edit';
  initial_data?: Partial<FeedbackFormData>;
  validation_rules: Record<string, any>;
  auto_save: boolean;
  auto_save_interval: number;
}

// UI state interfaces
export interface FeedbackListState {
  feedbacks: Feedback[];
  selected_feedbacks: Set<string>;
  filters: FeedbackFilter;
  sort_options: SortOptions<Feedback>;
  pagination: {
    current_page: number;
    page_size: number;
    total_items: number;
  };
  view_mode: FeedbackDisplayMode;
  is_loading: boolean;
  error?: string;
}

export interface FeedbackFilterState {
  active_filters: FeedbackFilter;
  filter_presets: Array<{
    name: string;
    filters: FeedbackFilter;
  }>;
  is_filter_panel_open: boolean;
  has_unsaved_changes: boolean;
}

export interface FeedbackSelectionState {
  selected_ids: Set<string>;
  select_all: boolean;
  bulk_action_mode: boolean;
  available_bulk_actions: FeedbackOperationType[];
}

export interface FeedbackViewState {
  display_mode: FeedbackDisplayMode;
  columns_visible: Set<string>;
  row_height: 'compact' | 'normal' | 'comfortable';
  show_preview: boolean;
  preview_feedback_id?: string;
}
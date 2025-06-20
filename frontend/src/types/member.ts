// Enums for member-related constants
export enum EmploymentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  TERMINATED = 'terminated',
  ON_LEAVE = 'on_leave',
  PROBATION = 'probation',
  SUSPENDED = 'suspended',
  PENDING_START = 'pending_start',
  RETIRED = 'retired',
  CONTRACT_ENDED = 'contract_ended',
  TRANSFERRED = 'transferred'
}

export enum EmploymentType {
  FULL_TIME = 'full_time',
  PART_TIME = 'part_time',
  CONTRACT = 'contract',
  INTERN = 'intern',
  CONSULTANT = 'consultant',
  TEMPORARY = 'temporary',
  SEASONAL = 'seasonal',
  VOLUNTEER = 'volunteer',
  FREELANCE = 'freelance',
  APPRENTICE = 'apprentice'
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  NON_BINARY = 'non_binary',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
  OTHER = 'other',
  NOT_SPECIFIED = 'not_specified'
}

export enum Department {
  ENGINEERING = 'engineering',
  SALES = 'sales',
  MARKETING = 'marketing',
  HR = 'hr',
  FINANCE = 'finance',
  OPERATIONS = 'operations',
  LEGAL = 'legal',
  EXECUTIVE = 'executive',
  CUSTOMER_SUPPORT = 'customer_support',
  PRODUCT = 'product',
  DESIGN = 'design',
  RESEARCH = 'research',
  QUALITY_ASSURANCE = 'quality_assurance',
  SECURITY = 'security',
  FACILITIES = 'facilities'
}

export enum SkillProficiencyLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert',
  MASTER = 'master'
}

export enum JobLevel {
  ENTRY = 'entry',
  JUNIOR = 'junior',
  MID = 'mid',
  SENIOR = 'senior',
  LEAD = 'lead',
  PRINCIPAL = 'principal',
  MANAGER = 'manager',
  SENIOR_MANAGER = 'senior_manager',
  DIRECTOR = 'director',
  SENIOR_DIRECTOR = 'senior_director',
  VP = 'vp',
  SVP = 'svp',
  C_LEVEL = 'c_level'
}

export enum WorkLocation {
  OFFICE = 'office',
  REMOTE = 'remote',
  HYBRID = 'hybrid',
  FIELD = 'field',
  CLIENT_SITE = 'client_site',
  CO_WORKING = 'co_working',
  HOME_OFFICE = 'home_office',
  TRAVELING = 'traveling'
}

// Core interfaces
export interface BaseMember {
  id: string;
  organization_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  date_of_birth?: Date;
  gender: Gender;
  job_title: string;
  department: Department;
  manager_id?: string;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  hire_date: Date;
  termination_date?: Date;
  salary?: number;
  salary_currency: string;
  location: WorkLocation;
  timezone: string;
  is_deleted: boolean;
}

export interface AddressInfo {
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  address_type: string;
  is_primary: boolean;
  address_metadata: Record<string, any>;
}

export interface ContactInfo {
  name: string;
  phone: string;
  email?: string;
  relationship: string;
  is_primary: boolean;
  contact_type: string;
  contact_metadata: Record<string, any>;
}

export interface EducationInfo {
  institution: string;
  degree: string;
  field_of_study: string;
  graduation_date: Date;
  gpa?: number;
  honors?: string;
  is_current: boolean;
  education_level: string;
  education_metadata: Record<string, any>;
}

export interface WorkExperience {
  company: string;
  position: string;
  start_date: Date;
  end_date?: Date;
  description: string;
  achievements: string[];
  is_current: boolean;
  industry: string;
  company_size: string;
  experience_metadata: Record<string, any>;
}

export interface Certification {
  name: string;
  issuing_organization: string;
  issue_date: Date;
  expiration_date?: Date;
  credential_id?: string;
  verification_url?: string;
  is_active: boolean;
  certification_type: string;
  certification_metadata: Record<string, any>;
}

export interface SkillAssignment {
  skill_id: string;
  skill_name: string;
  proficiency_level: SkillProficiencyLevel;
  years_of_experience?: number;
  last_assessed_date?: Date;
  certified: boolean;
  endorsements_count: number;
  skill_category: string;
  skill_metadata: Record<string, any>;
}

export interface PerformanceMetrics {
  review_period: string;
  overall_rating: number;
  goals_achieved: number;
  goals_total: number;
  performance_score: number;
  review_date: Date;
  reviewer_id: string;
  performance_notes: string;
  improvement_areas: string[];
  strengths: string[];
  development_goals: string[];
  performance_metadata: Record<string, any>;
}

export interface Member extends BaseMember {
  street_address: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  profile_picture_url?: string;
  bio?: string;
  skills: SkillAssignment[];
  certifications: Certification[];
  education: EducationInfo[];
  work_experience: WorkExperience[];
  performance_metrics: PerformanceMetrics[];
  social_links: Record<string, string>;
  languages: string[];
  accessibility_needs?: string;
  preferences: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string;
  version: number;
  last_login_at?: Date;
  // Computed properties
  full_name: string;
  age?: number;
  tenure_years: number;
  direct_reports_count: number;
}

export interface MemberCreate {
  first_name: string;
  last_name: string;
  email: string;
  organization_id: string;
  job_title: string;
  department: Department;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType;
  hire_date: Date;
  phone?: string;
  date_of_birth?: Date;
  gender?: Gender;
  street_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  manager_id?: string;
  salary?: number;
  salary_currency?: string;
  skills?: SkillAssignment[];
  certifications?: Certification[];
  education?: EducationInfo[];
  work_experience?: WorkExperience[];
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  profile_picture_url?: string;
  bio?: string;
  social_links?: Record<string, string>;
  location?: WorkLocation;
  timezone?: string;
  languages?: string[];
  accessibility_needs?: string;
  preferences?: Record<string, any>;
}

export interface MemberUpdate {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  date_of_birth?: Date;
  gender?: Gender;
  job_title?: string;
  department?: Department;
  manager_id?: string;
  employment_status?: EmploymentStatus;
  employment_type?: EmploymentType;
  hire_date?: Date;
  termination_date?: Date;
  salary?: number;
  salary_currency?: string;
  location?: WorkLocation;
  timezone?: string;
  street_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  profile_picture_url?: string;
  bio?: string;
  skills?: SkillAssignment[];
  certifications?: Certification[];
  education?: EducationInfo[];
  work_experience?: WorkExperience[];
  performance_metrics?: PerformanceMetrics[];
  social_links?: Record<string, string>;
  languages?: string[];
  accessibility_needs?: string;
  preferences?: Record<string, any>;
  version: number;
}

export interface MemberResponse extends Member {
  manager_info?: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title: string;
  };
  subordinates_info?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title: string;
  }>;
  department_info?: {
    name: string;
    head_id: string;
    member_count: number;
  };
  organization_context?: {
    id: string;
    name: string;
    industry: string;
    size: string;
  };
  employment_summary?: {
    status: string;
    type: string;
    tenure_days: number;
    next_review_date?: Date;
  };
  skills_summary?: {
    total_skills: number;
    primary_skills: string[];
    skill_categories: Record<string, number>;
  };
  performance_summary?: {
    average_rating: number;
    last_review_date?: Date;
    improvement_trend: string;
  };
  response_metadata?: Record<string, any>;
}

export interface MemberProfile extends Member {
  full_employment_history: WorkExperience[];
  complete_education_background: EducationInfo[];
  comprehensive_skills_profile: {
    current_skills: SkillAssignment[];
    skill_gaps: string[];
    recommended_skills: string[];
    skill_development_plan: Record<string, any>;
  };
  performance_history: PerformanceMetrics[];
  career_progression: Array<{
    position: string;
    department: string;
    start_date: Date;
    end_date?: Date;
    promotion: boolean;
  }>;
  recognition_awards: Array<{
    title: string;
    date: Date;
    description: string;
    issuer: string;
  }>;
  training_history: Array<{
    course_name: string;
    provider: string;
    completion_date: Date;
    certificate_url?: string;
  }>;
  project_assignments: Array<{
    project_name: string;
    role: string;
    start_date: Date;
    end_date?: Date;
    outcomes: string[];
  }>;
  team_memberships: Array<{
    team_name: string;
    role: string;
    join_date: Date;
    leave_date?: Date;
  }>;
  profile_completeness_score: number;
}

export interface MemberFilter {
  organization_id?: string;
  department?: Department[];
  job_title?: string;
  employment_status?: EmploymentStatus[];
  employment_type?: EmploymentType[];
  manager_id?: string;
  location?: WorkLocation[];
  hire_date_range?: {
    start_date: Date;
    end_date: Date;
  };
  salary_range?: {
    min_salary: number;
    max_salary: number;
  };
  skills?: string[];
  certifications?: string[];
  education_level?: string[];
  years_of_experience_range?: {
    min: number;
    max: number;
  };
  age_range?: {
    min: number;
    max: number;
  };
  search_term?: string;
  has_profile_picture?: boolean;
  is_manager?: boolean;
  sort_options?: {
    field: string;
    direction: 'asc' | 'desc';
  };
}

export interface MemberListResponse {
  items: Member[];
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
  organizational_context?: Record<string, any>;
  response_metadata?: Record<string, any>;
}

export interface MemberStats {
  total_count: number;
  active_count: number;
  department_distribution: Record<string, number>;
  employment_type_breakdown: Record<string, number>;
  employment_status_summary: Record<string, number>;
  average_tenure: number;
  recent_hires_count: number;
  upcoming_anniversaries: Array<{
    member_id: string;
    member_name: string;
    anniversary_date: Date;
    years: number;
  }>;
  salary_statistics: {
    average: number;
    median: number;
    min: number;
    max: number;
    currency: string;
  };
  skills_distribution: Record<string, number>;
  performance_metrics_summary: {
    average_rating: number;
    top_performers_count: number;
    improvement_needed_count: number;
  };
  diversity_metrics: {
    gender_distribution: Record<string, number>;
    age_distribution: Record<string, number>;
    location_distribution: Record<string, number>;
  };
  turnover_rate: number;
  promotion_rate: number;
  organizational_insights: Record<string, any>;
}

export interface MemberBulkCreate {
  members: MemberCreate[];
  validation_options: {
    skip_duplicates: boolean;
    validate_emails: boolean;
    validate_organization: boolean;
  };
  processing_options: {
    batch_size: number;
    continue_on_error: boolean;
  };
  notification_settings: {
    notify_on_completion: boolean;
    notify_on_error: boolean;
    notification_emails: string[];
  };
  organizational_context: Record<string, any>;
  metadata: Record<string, any>;
}

export interface MemberBulkResponse {
  successful_count: number;
  failed_count: number;
  errors: Array<{
    record_index: number;
    error_code: string;
    error_message: string;
    field_errors: Record<string, string>;
  }>;
  created_member_ids: string[];
  skipped_count: number;
  processing_time: number;
  validation_summary: Record<string, any>;
  operation_summary: Record<string, any>;
}

export interface MemberExport {
  export_format: 'json' | 'csv' | 'excel' | 'pdf';
  field_selection: string[];
  filter_criteria: MemberFilter;
  privacy_options: {
    anonymize_personal_data: boolean;
    exclude_salary_information: boolean;
    mask_contact_details: boolean;
  };
  organizational_scope: {
    include_subordinates: boolean;
    include_peers: boolean;
    department_only: boolean;
  };
  include_sensitive_data: boolean;
  include_performance_data: boolean;
  date_range?: {
    start_date: Date;
    end_date: Date;
  };
  compression_options: {
    compress: boolean;
    compression_type: string;
  };
  export_metadata: Record<string, any>;
}

export interface MemberHierarchy {
  member_id: string;
  member_info: {
    first_name: string;
    last_name: string;
    job_title: string;
    department: string;
    profile_picture_url?: string;
  };
  manager_id?: string;
  subordinates: MemberHierarchy[];
  department_context: {
    name: string;
    head_id: string;
  };
  hierarchy_level: number;
  span_of_control: number;
  reporting_chain: string[];
  is_manager: boolean;
  team_size: number;
  hierarchy_metadata: Record<string, any>;
}

export interface MemberSkillAssignment {
  member_id: string;
  skill_assignments: SkillAssignment[];
  skill_gaps: string[];
  recommended_training: Array<{
    skill_name: string;
    training_type: string;
    priority: string;
  }>;
  skill_development_plan: Record<string, any>;
  competency_matrix: Record<string, any>;
  skill_endorsements: Array<{
    skill_id: string;
    endorser_id: string;
    endorsement_date: Date;
  }>;
  skill_assessments: Array<{
    skill_id: string;
    assessment_date: Date;
    score: number;
    assessor_id: string;
  }>;
  skill_metadata: Record<string, any>;
}

export interface MemberStatusChange {
  member_id: string;
  current_status: EmploymentStatus;
  new_status: EmploymentStatus;
  effective_date: Date;
  reason: string;
  notes?: string;
  approved_by?: string;
  approval_date?: Date;
  workflow_id?: string;
  notification_settings: {
    notify_member: boolean;
    notify_manager: boolean;
    notify_hr: boolean;
  };
  status_metadata: Record<string, any>;
}

export interface MemberSearch {
  search_term: string;
  search_fields: string[];
  filters: MemberFilter;
  sort_options: {
    field: string;
    direction: 'asc' | 'desc';
  };
  highlight_options: {
    enable: boolean;
    fields: string[];
  };
  facet_options: {
    enable: boolean;
    facets: string[];
  };
  search_suggestions: string[];
  search_metadata: Record<string, any>;
}

export interface MemberSearchResult {
  member: Member;
  relevance_score: number;
  highlighted_fields: Record<string, string>;
  match_context: {
    matched_fields: string[];
    match_type: string;
  };
  search_metadata: Record<string, any>;
  related_members: Array<{
    id: string;
    name: string;
    similarity_score: number;
  }>;
  organizational_context: Record<string, any>;
}

export interface MemberOnboarding {
  member_id: string;
  onboarding_status: string;
  assigned_buddy_id?: string;
  onboarding_checklist: Array<{
    task_id: string;
    task_name: string;
    completed: boolean;
    due_date: Date;
  }>;
  completion_percentage: number;
  start_date: Date;
  expected_completion_date: Date;
  actual_completion_date?: Date;
  onboarding_feedback: {
    rating: number;
    comments: string;
    suggestions: string[];
  };
  training_assignments: Array<{
    training_id: string;
    training_name: string;
    status: string;
  }>;
  equipment_assignments: Array<{
    equipment_type: string;
    assigned_date: Date;
    serial_number?: string;
  }>;
  onboarding_metadata: Record<string, any>;
}

export interface MemberOffboarding {
  member_id: string;
  offboarding_status: string;
  last_working_day: Date;
  exit_interview_scheduled: boolean;
  knowledge_transfer_status: string;
  equipment_return_status: string;
  access_revocation_status: string;
  final_payroll_processed: boolean;
  offboarding_checklist: Array<{
    task_id: string;
    task_name: string;
    completed: boolean;
    completed_date?: Date;
  }>;
  exit_feedback: {
    reason_for_leaving: string;
    feedback_rating: number;
    improvement_suggestions: string[];
  };
  offboarding_metadata: Record<string, any>;
}

export interface MemberAuditLog {
  id: string;
  member_id: string;
  action_type: string;
  performed_by: string;
  performed_at: Date;
  old_values: Record<string, any>;
  new_values: Record<string, any>;
  change_summary: string;
  ip_address: string;
  user_agent: string;
  organizational_context: Record<string, any>;
  audit_metadata: Record<string, any>;
}

export interface MemberPermissions {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_view_salary: boolean;
  can_view_performance: boolean;
  can_manage_subordinates: boolean;
  can_approve_status_changes: boolean;
  can_export_data: boolean;
  can_view_audit_log: boolean;
  access_level: string;
  organizational_scope: string[];
  permissions_metadata: Record<string, any>;
}

export interface MemberNotification {
  id: string;
  member_id: string;
  recipient_id: string;
  notification_type: string;
  notification_title: string;
  notification_message: string;
  is_read: boolean;
  created_at: Date;
  read_at?: Date;
  delivery_method: string;
  priority: string;
  organizational_context: Record<string, any>;
  notification_metadata: Record<string, any>;
}

export interface MemberAnalytics {
  member_id: string;
  profile_views_count: number;
  profile_completeness_score: number;
  skill_endorsements_received: number;
  performance_trend_data: Array<{
    period: string;
    rating: number;
    trend: string;
  }>;
  career_progression_rate: number;
  training_completion_rate: number;
  team_collaboration_score: number;
  leadership_potential_score: number;
  retention_risk_score: number;
  analytics_period: {
    start_date: Date;
    end_date: Date;
  };
  comparative_metrics: Record<string, any>;
  analytics_metadata: Record<string, any>;
}

// Type utilities
export type MemberSortField = 'first_name' | 'last_name' | 'email' | 'hire_date' | 'job_title' | 'department' | 'salary' | 'created_at' | 'updated_at';
export type MemberFilterKey = keyof MemberFilter;
export type MemberOperationType = 'create' | 'update' | 'delete' | 'status_change' | 'bulk_operation';
export type MemberEventType = 'member_created' | 'member_updated' | 'member_deleted' | 'status_changed' | 'manager_changed' | 'department_changed';
export type MemberDisplayMode = 'card' | 'table' | 'hierarchy' | 'grid' | 'compact';
export type OrganizationalRole = 'employee' | 'manager' | 'director' | 'executive' | 'admin';

// Generic type definitions
export interface PaginatedMemberResponse<T> {
  items: T[];
  total_count: number;
  page_number: number;
  page_size: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

export interface MemberFilterOptions<T> {
  filters: Partial<T>;
  sort_by?: string;
  sort_direction?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

export interface MemberSortOptions<T> {
  field: keyof T;
  direction: 'asc' | 'desc';
  null_handling?: 'first' | 'last';
}

export interface MemberBulkOperationResult<T> {
  successful: T[];
  failed: Array<{
    item: T;
    error: string;
  }>;
  total_processed: number;
  processing_time: number;
}

export interface MemberValidationResult<T> {
  is_valid: boolean;
  errors: Partial<Record<keyof T, string>>;
  warnings: Partial<Record<keyof T, string>>;
}

// Constants
export const DEFAULT_SALARY_CURRENCY = 'USD';
export const MAX_BIO_LENGTH = 1000;
export const MAX_SKILLS_PER_MEMBER = 20;
export const MEMBER_EXPORT_FORMATS = ['json', 'csv', 'excel', 'pdf'] as const;
export const MAX_HIERARCHY_DEPTH = 10;
export const MAX_SPAN_OF_CONTROL = 15;
export const MIN_SALARY = 0;
export const MAX_SALARY = 10000000;
export const PROFILE_PICTURE_MAX_SIZE = 5 * 1024 * 1024; // 5MB

export const EMPLOYMENT_STATUS_TRANSITIONS: Record<EmploymentStatus, EmploymentStatus[]> = {
  [EmploymentStatus.ACTIVE]: [EmploymentStatus.ON_LEAVE, EmploymentStatus.SUSPENDED, EmploymentStatus.TERMINATED, EmploymentStatus.TRANSFERRED],
  [EmploymentStatus.INACTIVE]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED],
  [EmploymentStatus.TERMINATED]: [],
  [EmploymentStatus.ON_LEAVE]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED],
  [EmploymentStatus.PROBATION]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED],
  [EmploymentStatus.SUSPENDED]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED],
  [EmploymentStatus.PENDING_START]: [EmploymentStatus.ACTIVE, EmploymentStatus.TERMINATED],
  [EmploymentStatus.RETIRED]: [],
  [EmploymentStatus.CONTRACT_ENDED]: [],
  [EmploymentStatus.TRANSFERRED]: []
};

export const DEPARTMENT_HIERARCHY: Record<string, string[]> = {
  executive: ['engineering', 'sales', 'marketing', 'hr', 'finance', 'operations', 'legal'],
  engineering: ['product', 'design', 'quality_assurance', 'security'],
  operations: ['customer_support', 'facilities'],
  hr: [],
  finance: [],
  sales: [],
  marketing: [],
  legal: [],
  product: [],
  design: [],
  research: [],
  quality_assurance: [],
  security: [],
  customer_support: [],
  facilities: []
};

// Utility functions
export function getEmploymentStatusLabel(status: EmploymentStatus): string {
  const labels: Record<EmploymentStatus, string> = {
    [EmploymentStatus.ACTIVE]: 'Active',
    [EmploymentStatus.INACTIVE]: 'Inactive',
    [EmploymentStatus.TERMINATED]: 'Terminated',
    [EmploymentStatus.ON_LEAVE]: 'On Leave',
    [EmploymentStatus.PROBATION]: 'Probation',
    [EmploymentStatus.SUSPENDED]: 'Suspended',
    [EmploymentStatus.PENDING_START]: 'Pending Start',
    [EmploymentStatus.RETIRED]: 'Retired',
    [EmploymentStatus.CONTRACT_ENDED]: 'Contract Ended',
    [EmploymentStatus.TRANSFERRED]: 'Transferred'
  };
  return labels[status] || status;
}

export function getEmploymentStatusColor(status: EmploymentStatus): string {
  const colors: Record<EmploymentStatus, string> = {
    [EmploymentStatus.ACTIVE]: '#10b981',
    [EmploymentStatus.INACTIVE]: '#6b7280',
    [EmploymentStatus.TERMINATED]: '#ef4444',
    [EmploymentStatus.ON_LEAVE]: '#f59e0b',
    [EmploymentStatus.PROBATION]: '#3b82f6',
    [EmploymentStatus.SUSPENDED]: '#dc2626',
    [EmploymentStatus.PENDING_START]: '#8b5cf6',
    [EmploymentStatus.RETIRED]: '#9ca3af',
    [EmploymentStatus.CONTRACT_ENDED]: '#d1d5db',
    [EmploymentStatus.TRANSFERRED]: '#06b6d4'
  };
  return colors[status] || '#6b7280';
}

export function getDepartmentHierarchy(department: Department): string[] {
  const hierarchy: string[] = [];
  let current = department as string;
  
  while (current) {
    hierarchy.unshift(current);
    const parent = Object.entries(DEPARTMENT_HIERARCHY).find(([_, children]) => 
      children.includes(current)
    );
    current = parent ? parent[0] : '';
  }
  
  return hierarchy;
}

export function isValidStatusTransition(currentStatus: EmploymentStatus, newStatus: EmploymentStatus): boolean {
  return EMPLOYMENT_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) || false;
}

export function getSkillProficiencyOrder(level: SkillProficiencyLevel): number {
  const order: Record<SkillProficiencyLevel, number> = {
    [SkillProficiencyLevel.BEGINNER]: 1,
    [SkillProficiencyLevel.INTERMEDIATE]: 2,
    [SkillProficiencyLevel.ADVANCED]: 3,
    [SkillProficiencyLevel.EXPERT]: 4,
    [SkillProficiencyLevel.MASTER]: 5
  };
  return order[level] || 0;
}

export function getJobLevelHierarchy(level: JobLevel): number {
  const hierarchy: Record<JobLevel, number> = {
    [JobLevel.ENTRY]: 1,
    [JobLevel.JUNIOR]: 2,
    [JobLevel.MID]: 3,
    [JobLevel.SENIOR]: 4,
    [JobLevel.LEAD]: 5,
    [JobLevel.PRINCIPAL]: 6,
    [JobLevel.MANAGER]: 7,
    [JobLevel.SENIOR_MANAGER]: 8,
    [JobLevel.DIRECTOR]: 9,
    [JobLevel.SENIOR_DIRECTOR]: 10,
    [JobLevel.VP]: 11,
    [JobLevel.SVP]: 12,
    [JobLevel.C_LEVEL]: 13
  };
  return hierarchy[level] || 0;
}

// Type guards
export function isMember(obj: any): obj is Member {
  return obj &&
    typeof obj.id === 'string' &&
    typeof obj.organization_id === 'string' &&
    typeof obj.first_name === 'string' &&
    typeof obj.last_name === 'string' &&
    typeof obj.email === 'string' &&
    Object.values(EmploymentStatus).includes(obj.employment_status) &&
    Object.values(EmploymentType).includes(obj.employment_type);
}

export function isMemberCreate(obj: any): obj is MemberCreate {
  return obj &&
    typeof obj.first_name === 'string' &&
    typeof obj.last_name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.organization_id === 'string' &&
    typeof obj.job_title === 'string' &&
    Object.values(Department).includes(obj.department) &&
    Object.values(EmploymentStatus).includes(obj.employment_status) &&
    Object.values(EmploymentType).includes(obj.employment_type);
}

export function isMemberFilter(obj: any): obj is MemberFilter {
  return obj &&
    (obj.organization_id === undefined || typeof obj.organization_id === 'string') &&
    (obj.department === undefined || Array.isArray(obj.department)) &&
    (obj.employment_status === undefined || Array.isArray(obj.employment_status));
}

export function isMemberStats(obj: any): obj is MemberStats {
  return obj &&
    typeof obj.total_count === 'number' &&
    typeof obj.active_count === 'number' &&
    typeof obj.average_tenure === 'number';
}

export function isValidMemberId(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export function isManagerRole(jobLevel: JobLevel): boolean {
  const managerRoles: JobLevel[] = [
    JobLevel.MANAGER,
    JobLevel.SENIOR_MANAGER,
    JobLevel.DIRECTOR,
    JobLevel.SENIOR_DIRECTOR,
    JobLevel.VP,
    JobLevel.SVP,
    JobLevel.C_LEVEL
  ];
  return managerRoles.includes(jobLevel);
}

// Interface extensions
export interface MemberWithManager extends Member {
  manager: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title: string;
  } | null;
}

export interface MemberWithSubordinates extends Member {
  subordinates: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    job_title: string;
    department: Department;
  }>;
}

export interface MemberWithSkills extends Member {
  skill_details: Array<{
    skill: SkillAssignment;
    endorsements: Array<{
      endorser_id: string;
      endorser_name: string;
      endorsement_date: Date;
    }>;
    assessments: Array<{
      assessment_date: Date;
      score: number;
      assessor_name: string;
    }>;
  }>;
}

export interface MemberWithPerformance extends Member {
  performance_details: {
    current_rating: number;
    rating_trend: 'improving' | 'stable' | 'declining';
    last_review: PerformanceMetrics | null;
    upcoming_review_date: Date | null;
  };
}

export interface MemberWithAnalytics extends Member {
  analytics: MemberAnalytics;
}

// API response wrappers
export interface MemberApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp: Date;
}

export interface MemberErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: Date;
}

export interface MemberSuccessResponse<T = any> {
  success: true;
  data: T;
  message?: string;
  timestamp: Date;
}

export interface MemberPaginatedApiResponse<T> extends PaginatedMemberResponse<T> {
  success: boolean;
  message?: string;
  timestamp: Date;
}

// Form state interfaces
export interface MemberFormData extends Partial<MemberCreate> {
  [key: string]: any;
}

export interface MemberFormErrors {
  [key: string]: string | undefined;
}

export interface MemberFormState {
  data: MemberFormData;
  errors: MemberFormErrors;
  isDirty: boolean;
  isSubmitting: boolean;
  isValid: boolean;
}

export interface MemberFormConfig {
  mode: 'create' | 'edit';
  initialData?: Partial<Member>;
  validationRules?: Record<string, any>;
  onSubmit: (data: MemberFormData) => Promise<void>;
  onCancel: () => void;
}

// UI state interfaces
export interface MemberListState {
  members: Member[];
  loading: boolean;
  error: string | null;
  filters: MemberFilter;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
  };
  selection: string[];
  viewMode: MemberDisplayMode;
}

export interface MemberFilterState {
  activeFilters: MemberFilter;
  filterOptions: {
    departments: Department[];
    statuses: EmploymentStatus[];
    types: EmploymentType[];
    locations: WorkLocation[];
  };
  isExpanded: boolean;
}

export interface MemberSelectionState {
  selectedIds: string[];
  selectAll: boolean;
  bulkActions: Array<{
    action: string;
    label: string;
    icon?: string;
  }>;
}

export interface MemberViewState {
  displayMode: MemberDisplayMode;
  columnsVisible: string[];
  sortField: MemberSortField;
  sortDirection: 'asc' | 'desc';
  density: 'compact' | 'normal' | 'comfortable';
}

export interface MemberHierarchyState {
  rootMemberId?: string;
  expandedNodes: string[];
  selectedNode?: string;
  hierarchyDepth: number;
  showInactive: boolean;
}

// Organizational hierarchy interfaces
export interface OrganizationalChart {
  organization_id: string;
  organization_name: string;
  departments: DepartmentStructure[];
  total_members: number;
  hierarchy_levels: number;
  last_updated: Date;
}

export interface DepartmentStructure {
  department: Department;
  head: Member | null;
  teams: TeamComposition[];
  member_count: number;
  sub_departments: DepartmentStructure[];
}

export interface TeamComposition {
  team_id: string;
  team_name: string;
  team_lead: Member | null;
  members: Member[];
  team_size: number;
  average_tenure: number;
}

export interface ReportingRelationship {
  manager: Member;
  subordinate: Member;
  relationship_type: 'direct' | 'dotted_line';
  effective_date: Date;
}

export interface SpanOfControl {
  manager_id: string;
  direct_reports: number;
  indirect_reports: number;
  total_span: number;
  recommended_span: number;
  is_optimal: boolean;
}

// Employment lifecycle interfaces
export interface EmploymentContract {
  member_id: string;
  contract_type: EmploymentType;
  start_date: Date;
  end_date?: Date;
  terms: Record<string, any>;
  renewal_date?: Date;
  is_active: boolean;
}

export interface CompensationPackage {
  member_id: string;
  base_salary: number;
  currency: string;
  bonus_structure?: Record<string, any>;
  benefits: string[];
  stock_options?: Record<string, any>;
  effective_date: Date;
}

export interface PerformanceReview {
  member_id: string;
  review_cycle: string;
  reviewer_id: string;
  review_date: Date;
  metrics: PerformanceMetrics;
  goals: Array<{
    goal_id: string;
    description: string;
    status: string;
    progress: number;
  }>;
  feedback: string;
  next_review_date: Date;
}

export interface CareerDevelopment {
  member_id: string;
  current_role: string;
  career_aspirations: string[];
  development_plan: Array<{
    objective: string;
    timeline: string;
    resources: string[];
  }>;
  mentors: string[];
  succession_readiness: string;
}

export interface SuccessionPlan {
  position: string;
  incumbent_id: string;
  successors: Array<{
    member_id: string;
    readiness_level: string;
    development_needs: string[];
    estimated_ready_date: Date;
  }>;
  critical_position: boolean;
  risk_level: string;
}

// Skill and competency interfaces
export interface SkillTaxonomy {
  skill_categories: Array<{
    category_id: string;
    category_name: string;
    skills: Array<{
      skill_id: string;
      skill_name: string;
      skill_level_definitions: Record<SkillProficiencyLevel, string>;
    }>;
  }>;
  last_updated: Date;
}

export interface CompetencyFramework {
  framework_id: string;
  framework_name: string;
  competencies: Array<{
    competency_id: string;
    competency_name: string;
    description: string;
    behavioral_indicators: string[];
    proficiency_levels: Record<string, string>;
  }>;
  applicable_roles: string[];
}

export interface SkillGapAnalysis {
  member_id: string;
  current_skills: SkillAssignment[];
  required_skills: Array<{
    skill_name: string;
    required_level: SkillProficiencyLevel;
    priority: string;
  }>;
  skill_gaps: Array<{
    skill_name: string;
    current_level: SkillProficiencyLevel | null;
    required_level: SkillProficiencyLevel;
    gap_size: number;
  }>;
  recommendations: string[];
}

export interface LearningPath {
  path_id: string;
  path_name: string;
  target_skills: string[];
  courses: Array<{
    course_id: string;
    course_name: string;
    provider: string;
    duration: string;
    format: string;
  }>;
  estimated_completion_time: string;
  prerequisites: string[];
}

export interface SkillEndorsement {
  endorsement_id: string;
  skill_id: string;
  member_id: string;
  endorser_id: string;
  endorsement_date: Date;
  endorsement_text?: string;
  credibility_score: number;
}

// Integration interfaces
export interface HRSystemIntegration {
  system_name: string;
  integration_type: 'api' | 'file' | 'database';
  sync_frequency: string;
  last_sync_date: Date;
  field_mappings: Record<string, string>;
  sync_status: 'active' | 'paused' | 'error';
}

export interface PayrollIntegration {
  system_name: string;
  member_id_mapping: string;
  salary_sync_enabled: boolean;
  benefits_sync_enabled: boolean;
  last_sync_date: Date;
  sync_errors: string[];
}

export interface LearningManagementIntegration {
  lms_name: string;
  member_id_mapping: string;
  course_completion_sync: boolean;
  skill_assessment_sync: boolean;
  certification_sync: boolean;
  sync_configuration: Record<string, any>;
}

export interface IdentityProviderIntegration {
  provider_name: string;
  sso_enabled: boolean;
  attribute_mappings: Record<string, string>;
  provisioning_enabled: boolean;
  deprovisioning_enabled: boolean;
  last_sync_date: Date;
}
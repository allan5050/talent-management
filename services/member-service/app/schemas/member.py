from pydantic import BaseModel, Field, validator, root_validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, date
from uuid import UUID
from enum import Enum
from decimal import Decimal
import re
import json
import os
from app.models.member import EmploymentStatus as DBEmploymentStatus, EmploymentType as DBEmploymentType
from pydantic import EmailStr


# Enums
class EmploymentStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    TERMINATED = "terminated"
    ON_LEAVE = "on_leave"
    PROBATION = "probation"
    SUSPENDED = "suspended"


class EmploymentType(str, Enum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACT = "contract"
    INTERN = "intern"
    CONSULTANT = "consultant"
    TEMPORARY = "temporary"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    NON_BINARY = "non_binary"
    PREFER_NOT_TO_SAY = "prefer_not_to_say"
    OTHER = "other"


class Department(str, Enum):
    ENGINEERING = "engineering"
    SALES = "sales"
    MARKETING = "marketing"
    HR = "hr"
    FINANCE = "finance"
    OPERATIONS = "operations"
    LEGAL = "legal"
    EXECUTIVE = "executive"


class SkillProficiencyLevel(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    EXPERT = "expert"
    MASTER = "master"


# Supporting schemas
class AddressInfo(BaseModel):
    street_address: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    postal_code: Optional[str] = Field(None, max_length=20)
    country: Optional[str] = Field(None, max_length=2)

    @validator('postal_code')
    def validate_postal_code(cls, v, values):
        if v and 'country' in values:
            country = values['country']
            if country == 'US' and not re.match(r'^\d{5}(-\d{4})?$', v):
                raise ValueError('Invalid US postal code format')
            elif country == 'CA' and not re.match(r'^[A-Z]\d[A-Z]\s?\d[A-Z]\d$', v, re.IGNORECASE):
                raise ValueError('Invalid Canadian postal code format')
        return v

    @validator('country')
    def validate_country(cls, v):
        if v and len(v) != 2:
            raise ValueError('Country must be a 2-letter ISO code')
        return v.upper() if v else v


class ContactInfo(BaseModel):
    name: str = Field(..., max_length=100)
    phone: str = Field(..., max_length=20)
    email: Optional[str] = Field(None, max_length=255)
    relationship: str = Field(..., max_length=50)
    priority: int = Field(1, ge=1, le=5)

    @validator('phone')
    def validate_phone(cls, v):
        phone_pattern = re.compile(r'^\+?1?\d{9,15}$')
        if not phone_pattern.match(v.replace(' ', '').replace('-', '')):
            raise ValueError('Invalid phone number format')
        return v

    @validator('email')
    def validate_email(cls, v):
        if v:
            email_pattern = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
            if not email_pattern.match(v):
                raise ValueError('Invalid email format')
        return v


class EducationInfo(BaseModel):
    institution: str = Field(..., max_length=200)
    degree: str = Field(..., max_length=100)
    field_of_study: str = Field(..., max_length=100)
    graduation_date: Optional[date] = None
    gpa: Optional[Decimal] = Field(None, ge=0, le=4.0, decimal_places=2)
    honors: Optional[str] = Field(None, max_length=200)


class WorkExperience(BaseModel):
    company: str = Field(..., max_length=200)
    position: str = Field(..., max_length=100)
    start_date: date
    end_date: Optional[date] = None
    description: Optional[str] = Field(None, max_length=1000)
    achievements: Optional[List[str]] = None

    @root_validator
    def validate_dates(cls, values):
        start_date = values.get('start_date')
        end_date = values.get('end_date')
        if start_date and end_date and end_date < start_date:
            raise ValueError('End date must be after start date')
        return values


class Certification(BaseModel):
    name: str = Field(..., max_length=200)
    issuing_organization: str = Field(..., max_length=200)
    issue_date: date
    expiration_date: Optional[date] = None
    credential_id: Optional[str] = Field(None, max_length=100)
    verification_url: Optional[str] = Field(None, max_length=500)

    @validator('verification_url')
    def validate_url(cls, v):
        if v:
            url_pattern = re.compile(
                r'^https?://'
                r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'
                r'localhost|'
                r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'
                r'(?::\d+)?'
                r'(?:/?|[/?]\S+)$', re.IGNORECASE
            )
            if not url_pattern.match(v):
                raise ValueError('Invalid URL format')
        return v


class PerformanceMetrics(BaseModel):
    rating: Decimal = Field(..., ge=1, le=5, decimal_places=1)
    review_period: str = Field(..., max_length=50)
    goals: Optional[List[str]] = None
    achievements: Optional[List[str]] = None
    development_areas: Optional[List[str]] = None


class MemberSkillAssignment(BaseModel):
    skill_id: UUID
    skill_name: str = Field(..., max_length=100)
    proficiency_level: SkillProficiencyLevel
    certification_date: Optional[date] = None
    expiration_date: Optional[date] = None
    validation_source: Optional[str] = Field(None, max_length=100)


# Base schema
class MemberBase(BaseModel):
    first_name: str
    last_name: str
    login: str
    avatar_url: str
    followers: int
    following: int
    title: str
    email: EmailStr


# Create schema
class MemberCreate(MemberBase):
    organization_id: UUID


# Update schema
class MemberUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    followers: Optional[int] = None
    following: Optional[int] = None
    title: Optional[str] = None
    email: Optional[EmailStr] = None


# Response schemas
class MemberResponse(MemberBase):
    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    class Config:
        orm_mode = True


class MemberProfile(MemberResponse):
    work_experience: List[WorkExperience] = Field(default_factory=list)
    performance_metrics: Optional[PerformanceMetrics] = None
    total_skills: int = 0
    total_certifications: int = 0
    reporting_chain: List[Dict[str, Any]] = Field(default_factory=list)
    subordinates: List[Dict[str, Any]] = Field(default_factory=list)

    @validator('total_skills', always=True)
    def compute_total_skills(cls, v, values):
        skills = values.get('skills', [])
        return len(skills)

    @validator('total_certifications', always=True)
    def compute_total_certifications(cls, v, values):
        certifications = values.get('certifications', [])
        return len(certifications)


class MemberListResponse(BaseModel):
    items: List[MemberResponse]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_previous: bool
    total_pages: int
    filters_applied: Dict[str, Any] = Field(default_factory=dict)


class MemberFilter(BaseModel):
    organization_id: Optional[UUID] = None
    department: Optional[List[Department]] = None
    job_title: Optional[str] = None
    employment_status: Optional[List[EmploymentStatus]] = None
    employment_type: Optional[List[EmploymentType]] = None
    manager_id: Optional[UUID] = None
    location: Optional[str] = None
    hire_date_from: Optional[date] = None
    hire_date_to: Optional[date] = None
    salary_min: Optional[Decimal] = None
    salary_max: Optional[Decimal] = None
    skills: Optional[List[str]] = None
    certifications: Optional[List[str]] = None
    search: Optional[str] = Field(None, max_length=100)

    @root_validator
    def validate_date_range(cls, values):
        hire_date_from = values.get('hire_date_from')
        hire_date_to = values.get('hire_date_to')
        
        if hire_date_from and hire_date_to and hire_date_from > hire_date_to:
            raise ValueError('hire_date_from must be before hire_date_to')
        
        return values

    @root_validator
    def validate_salary_range(cls, values):
        salary_min = values.get('salary_min')
        salary_max = values.get('salary_max')
        
        if salary_min and salary_max and salary_min > salary_max:
            raise ValueError('salary_min must be less than salary_max')
        
        return values


class MemberStats(BaseModel):
    total_count: int
    active_count: int
    department_distribution: Dict[str, int]
    employment_type_breakdown: Dict[str, int]
    average_tenure: float
    recent_hires_count: int
    terminations_last_30_days: int
    average_age: Optional[float] = None
    gender_distribution: Dict[str, int]
    location_distribution: Dict[str, int]
    skills_distribution: Dict[str, int]


class MemberBulkCreate(BaseModel):
    members: List[MemberCreate]

    @validator('members')
    def validate_bulk_size(cls, v):
        max_bulk_size = int(os.getenv('MAX_BULK_CREATE_SIZE', '100'))
        if len(v) > max_bulk_size:
            raise ValueError(f'Maximum {max_bulk_size} members allowed in bulk create')
        
        # Check for duplicate emails
        emails = [member.email for member in v]
        if len(emails) != len(set(emails)):
            raise ValueError('Duplicate emails found in bulk create request')
        
        # Check organizational consistency
        org_ids = set(member.organization_id for member in v)
        if len(org_ids) > 1:
            raise ValueError('All members in bulk create must belong to the same organization')
        
        return v


class MemberBulkResponse(BaseModel):
    successful_count: int
    failed_count: int
    errors: List[Dict[str, Any]] = Field(default_factory=list)
    created_member_ids: List[UUID] = Field(default_factory=list)
    validation_summary: Dict[str, Any] = Field(default_factory=dict)


class MemberExport(BaseModel):
    format: str = Field(..., regex='^(json|csv|excel)$')
    fields: Optional[List[str]] = None
    filters: Optional[MemberFilter] = None
    include_personal_data: bool = False
    anonymize: bool = False
    anonymization_level: Optional[str] = Field(None, regex='^(basic|medium|high)$')

    @validator('fields')
    def validate_fields(cls, v):
        if v:
            allowed_fields = [
                'id', 'first_name', 'last_name', 'email', 'phone', 'job_title',
                'department', 'employment_status', 'employment_type', 'hire_date',
                'location', 'timezone', 'manager_id', 'organization_id'
            ]
            invalid_fields = [field for field in v if field not in allowed_fields]
            if invalid_fields:
                raise ValueError(f'Invalid fields: {", ".join(invalid_fields)}')
        return v

    @root_validator
    def validate_export_limits(cls, values):
        # TODO: Check export record limits based on filters
        max_export_records = int(os.getenv('MAX_EXPORT_RECORDS', '10000'))
        # This would require database query to validate
        return values


class MemberSkillUpdate(BaseModel):
    skill_assignments: List[MemberSkillAssignment]

    @validator('skill_assignments')
    def validate_skill_update(cls, v):
        max_skills = int(os.getenv('MAX_SKILLS_PER_MEMBER', '50'))
        if len(v) > max_skills:
            raise ValueError(f'Maximum {max_skills} skills allowed per member')
        
        # Check for duplicates
        skill_ids = [skill.skill_id for skill in v]
        if len(skill_ids) != len(set(skill_ids)):
            raise ValueError('Duplicate skills not allowed')
        
        return v


class MemberStatusChange(BaseModel):
    new_status: EmploymentStatus
    effective_date: date
    reason: str = Field(..., max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)
    approval_required: bool = False
    approved_by: Optional[UUID] = None

    @validator('effective_date')
    def validate_effective_date(cls, v):
        if v > date.today() + timedelta(days=90):
            raise ValueError('Effective date cannot be more than 90 days in the future')
        return v

    @root_validator
    def validate_approval(cls, values):
        approval_required = values.get('approval_required')
        approved_by = values.get('approved_by')
        
        if approval_required and not approved_by:
            raise ValueError('Approval required but no approver specified')
        
        return values


class MemberHierarchy(BaseModel):
    member_id: UUID
    member_name: str
    job_title: str
    department: Department
    subordinates: List['MemberHierarchy'] = Field(default_factory=list)
    reporting_chain: List[Dict[str, Any]] = Field(default_factory=list)
    organizational_depth: int = 0


class MemberSearch(BaseModel):
    search_term: str = Field(..., min_length=2, max_length=100)
    search_fields: List[str] = Field(
        default=['first_name', 'last_name', 'email', 'job_title']
    )
    filters: Optional[MemberFilter] = None
    sort_by: Optional[str] = Field(None, regex='^(relevance|name|hire_date|department)$')
    sort_order: Optional[str] = Field('asc', regex='^(asc|desc)$')
    highlight_matches: bool = True
    fuzzy_search: bool = False
    relevance_threshold: float = Field(0.5, ge=0, le=1)

    @validator('search_fields')
    def validate_search_fields(cls, v):
        allowed_fields = [
            'first_name', 'last_name', 'email', 'job_title', 'department',
            'location', 'skills', 'certifications'
        ]
        invalid_fields = [field for field in v if field not in allowed_fields]
        if invalid_fields:
            raise ValueError(f'Invalid search fields: {", ".join(invalid_fields)}')
        return v


# Enable forward references
MemberHierarchy.model_rebuild()
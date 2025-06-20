from pydantic import BaseModel, Field, validator, root_validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from uuid import UUID
from enum import Enum
import re
import json
import os

# Configuration from environment variables
MIN_RATING_SCALE = int(os.getenv('MIN_RATING_SCALE', '1'))
MAX_RATING_SCALE = int(os.getenv('MAX_RATING_SCALE', '10'))
MIN_CONTENT_LENGTH = int(os.getenv('MIN_CONTENT_LENGTH', '10'))
MAX_CONTENT_LENGTH = int(os.getenv('MAX_CONTENT_LENGTH', '5000'))
MAX_TAGS_PER_FEEDBACK = int(os.getenv('MAX_TAGS_PER_FEEDBACK', '10'))
MAX_TAG_LENGTH = int(os.getenv('MAX_TAG_LENGTH', '50'))
MAX_BULK_CREATE_SIZE = int(os.getenv('MAX_BULK_CREATE_SIZE', '100'))
MAX_EXPORT_RECORDS = int(os.getenv('MAX_EXPORT_RECORDS', '10000'))


class FeedbackType(str, Enum):
    PERFORMANCE = 'performance'
    BEHAVIORAL = 'behavioral'
    TECHNICAL = 'technical'
    CULTURAL_FIT = 'cultural_fit'
    INTERVIEW = 'interview'
    PEER_REVIEW = 'peer_review'
    MANAGER_REVIEW = 'manager_review'
    SELF_ASSESSMENT = 'self_assessment'

    @classmethod
    def _missing_(cls, value):
        # Case-insensitive matching
        for member in cls:
            if member.value.lower() == value.lower():
                return member
        return None


class FeedbackStatus(str, Enum):
    DRAFT = 'draft'
    SUBMITTED = 'submitted'
    UNDER_REVIEW = 'under_review'
    REVIEWED = 'reviewed'
    ACKNOWLEDGED = 'acknowledged'
    ARCHIVED = 'archived'
    DELETED = 'deleted'

    @classmethod
    def _missing_(cls, value):
        # Case-insensitive matching
        for member in cls:
            if member.value.lower() == value.lower():
                return member
        return None


class FeedbackPriority(str, Enum):
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'
    URGENT = 'urgent'

    @classmethod
    def _missing_(cls, value):
        # Case-insensitive matching
        for member in cls:
            if member.value.lower() == value.lower():
                return member
        return None


class FeedbackVisibility(str, Enum):
    PRIVATE = 'private'
    MANAGER_ONLY = 'manager_only'
    TEAM_VISIBLE = 'team_visible'
    ORGANIZATION_WIDE = 'organization_wide'
    PUBLIC = 'public'

    @classmethod
    def _missing_(cls, value):
        # Case-insensitive matching
        for member in cls:
            if member.value.lower() == value.lower():
                return member
        return None


class FeedbackCategory(str, Enum):
    POSITIVE = 'positive'
    CONSTRUCTIVE = 'constructive'
    DEVELOPMENTAL = 'developmental'
    RECOGNITION = 'recognition'
    IMPROVEMENT_NEEDED = 'improvement_needed'
    GOAL_SETTING = 'goal_setting'

    @classmethod
    def _missing_(cls, value):
        # Case-insensitive matching
        for member in cls:
            if member.value.lower() == value.lower():
                return member
        return None


class FeedbackBase(BaseModel):
    feedback: str
    organization_id: UUID


class FeedbackCreate(FeedbackBase):
    pass


class FeedbackUpdate(BaseModel):
    feedback: Optional[str] = None


class FeedbackResponse(FeedbackBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    class Config:
        orm_mode = True


class FeedbackListResponse(BaseModel):
    items: List[FeedbackResponse] = Field(..., description="List of feedback items")
    total: int = Field(..., description="Total number of items matching the query")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Number of items per page")
    has_next: bool = Field(..., description="Whether there is a next page")
    has_previous: bool = Field(..., description="Whether there is a previous page")
    total_pages: int = Field(..., description="Total number of pages")

    class Config:
        schema_extra = {
            "example": {
                "items": [],
                "total": 100,
                "page": 1,
                "page_size": 20,
                "has_next": True,
                "has_previous": False,
                "total_pages": 5
            }
        }


class FeedbackFilter(BaseModel):
    member_id: Optional[UUID] = Field(None, description="Filter by member ID")
    organization_id: Optional[UUID] = Field(None, description="Filter by organization ID")
    provider_id: Optional[Union[UUID, str]] = Field(None, description="Filter by provider ID or email")
    feedback_type: Optional[FeedbackType] = Field(None, description="Filter by feedback type")
    category: Optional[FeedbackCategory] = Field(None, description="Filter by category")
    priority: Optional[FeedbackPriority] = Field(None, description="Filter by priority")
    status: Optional[FeedbackStatus] = Field(None, description="Filter by status")
    visibility: Optional[FeedbackVisibility] = Field(None, description="Filter by visibility")
    min_rating: Optional[int] = Field(None, ge=1, le=10, description="Minimum rating filter")
    max_rating: Optional[int] = Field(None, ge=1, le=10, description="Maximum rating filter")
    start_date: Optional[datetime] = Field(None, description="Filter by start date")
    end_date: Optional[datetime] = Field(None, description="Filter by end date")
    tags: Optional[List[str]] = Field(None, description="Filter by tags")
    search: Optional[str] = Field(None, max_length=200, description="Search in content")
    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")
    sort_by: Optional[str] = Field('created_at', description="Field to sort by")
    sort_order: Optional[str] = Field('desc', regex='^(asc|desc)$', description="Sort order")

    @root_validator
    def validate_rating_range(cls, values):
        min_rating = values.get('min_rating')
        max_rating = values.get('max_rating')
        
        if min_rating is not None and max_rating is not None:
            if min_rating > max_rating:
                raise ValueError("min_rating cannot be greater than max_rating")
        
        return values

    @root_validator
    def validate_date_range(cls, values):
        start_date = values.get('start_date')
        end_date = values.get('end_date')
        
        if start_date and end_date:
            if start_date > end_date:
                raise ValueError("start_date cannot be after end_date")
            
            # Check for unreasonable date ranges (more than 5 years)
            date_diff = end_date - start_date
            if date_diff.days > 1825:  # 5 years
                raise ValueError("Date range cannot exceed 5 years")
        
        return values

    @validator('search')
    def validate_search(cls, v):
        if not v:
            return v
        
        # Check for SQL injection patterns
        sql_patterns = [r'\b(DROP|DELETE|INSERT|UPDATE|SELECT)\b', r'--', r'/\*', r'\*/']
        for pattern in sql_patterns:
            if re.search(pattern, v, re.IGNORECASE):
                raise ValueError("Search term contains potentially malicious patterns")
        
        # Check for special characters that might cause issues
        if re.search(r'[<>\"\'\\]', v):
            raise ValueError("Search term contains invalid characters")
        
        return v.strip()

    @validator('tags')
    def validate_tags(cls, v):
        if not v:
            return v
        return FeedbackBase.validate_tags(v)

    class Config:
        use_enum_values = True


class FeedbackStats(BaseModel):
    average_rating: float = Field(..., description="Average rating across all feedback")
    total_count: int = Field(..., description="Total number of feedback records")
    rating_distribution: Dict[int, int] = Field(..., 
                                               description="Distribution of ratings")
    feedback_type_counts: Dict[str, int] = Field(..., 
                                                description="Count by feedback type")
    category_breakdown: Dict[str, int] = Field(..., 
                                              description="Count by category")
    trend_data: List[Dict[str, Any]] = Field(default_factory=list, 
                                            description="Trend data over time")

    class Config:
        schema_extra = {
            "example": {
                "average_rating": 8.5,
                "total_count": 1250,
                "rating_distribution": {
                    "1": 10, "2": 15, "3": 25, "4": 50, "5": 100,
                    "6": 150, "7": 200, "8": 300, "9": 250, "10": 150
                },
                "feedback_type_counts": {
                    "performance": 400,
                    "behavioral": 300,
                    "technical": 250,
                    "cultural_fit": 300
                },
                "category_breakdown": {
                    "positive": 600,
                    "constructive": 400,
                    "developmental": 250
                },
                "trend_data": [
                    {"month": "2024-01", "average_rating": 8.2, "count": 100},
                    {"month": "2024-02", "average_rating": 8.5, "count": 120}
                ]
            }
        }


class FeedbackBulkCreate(BaseModel):
    feedbacks: List[FeedbackCreate] = Field(..., 
                                          description="List of feedback records to create")

    @validator('feedbacks')
    def validate_bulk_size(cls, v):
        if not v:
            raise ValueError("At least one feedback record is required")
        
        if len(v) > MAX_BULK_CREATE_SIZE:
            raise ValueError(f"Maximum {MAX_BULK_CREATE_SIZE} feedback records allowed in bulk operation")
        
        # Check for duplicates based on member_id and provider_id combination
        seen = set()
        for idx, feedback in enumerate(v):
            key = (feedback.member_id, feedback.provider_id, feedback.feedback_type)
            if key in seen:
                raise ValueError(f"Duplicate feedback found at index {idx}")
            seen.add(key)
        
        return v


class FeedbackBulkResponse(BaseModel):
    successful_count: int = Field(..., description="Number of successfully created records")
    failed_count: int = Field(..., description="Number of failed records")
    errors: List[Dict[str, Any]] = Field(default_factory=list, 
                                        description="List of errors with details")
    created_feedback_ids: List[UUID] = Field(default_factory=list, 
                                           description="IDs of successfully created feedback")

    class Config:
        json_encoders = {
            UUID: lambda v: str(v) if v else None
        }
        schema_extra = {
            "example": {
                "successful_count": 8,
                "failed_count": 2,
                "errors": [
                    {
                        "index": 3,
                        "error": "Rating 11 exceeds the rating scale of 10",
                        "feedback": {"member_id": "123e4567-e89b-12d3-a456-426614174001"}
                    }
                ],
                "created_feedback_ids": [
                    "123e4567-e89b-12d3-a456-426614174000",
                    "123e4567-e89b-12d3-a456-426614174001"
                ]
            }
        }


class FeedbackExport(BaseModel):
    format: str = Field(..., regex='^(json|csv)$', description="Export format")
    filters: Optional[FeedbackFilter] = Field(None, description="Filters to apply")
    fields: Optional[List[str]] = Field(None, description="Fields to include in export")
    include_metadata: bool = Field(True, description="Whether to include metadata")
    include_deleted: bool = Field(False, description="Whether to include deleted records")

    @validator('fields')
    def validate_fields(cls, v):
        if not v:
            return None
        
        allowed_fields = {
            'id', 'member_id', 'organization_id', 'provider_id', 'content',
            'feedback_type', 'rating', 'rating_scale', 'category', 'priority',
            'visibility', 'status', 'tags', 'metadata', 'created_at', 'updated_at',
            'created_by', 'updated_by', 'version', 'is_deleted'
        }
        
        invalid_fields = set(v) - allowed_fields
        if invalid_fields:
            raise ValueError(f"Invalid fields: {', '.join(invalid_fields)}")
        
        return v

    @validator('filters')
    def validate_export_size(cls, v):
        if v and hasattr(v, 'page_size'):
            # Override page_size for exports
            v.page_size = min(v.page_size, MAX_EXPORT_RECORDS)
        return v

    class Config:
        schema_extra = {
            "example": {
                "format": "csv",
                "filters": {
                    "organization_id": "123e4567-e89b-12d3-a456-426614174002",
                    "start_date": "2024-01-01T00:00:00Z",
                    "end_date": "2024-12-31T23:59:59Z"
                },
                "fields": ["id", "member_id", "content", "rating", "created_at"],
                "include_metadata": False,
                "include_deleted": False
            }
        }
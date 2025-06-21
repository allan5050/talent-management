from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from uuid import UUID


class FeedbackBase(BaseModel):
    feedback: str
    # In a real app, this would likely be validated against an Organization service
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
        from_attributes = True


class FeedbackListResponse(BaseModel):
    items: List[FeedbackResponse]
    total: int
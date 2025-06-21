from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from uuid import UUID


class FeedbackBase(BaseModel):
    feedback: str


class FeedbackCreate(FeedbackBase):
    pass


class FeedbackUpdate(BaseModel):
    feedback: Optional[str] = None


class FeedbackResponse(FeedbackBase):
    id: UUID
    organization_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FeedbackListResponse(BaseModel):
    items: List[FeedbackResponse]
    total: int
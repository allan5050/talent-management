from pydantic import BaseModel, EmailStr, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID

# Schemas for the Feedback Service

class FeedbackResponse(BaseModel):
    id: UUID
    organization_id: UUID
    feedback: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# Schemas for the Member Service

class MemberResponse(BaseModel):
    id: UUID
    organization_id: UUID
    first_name: str
    last_name: str
    login: str
    avatar_url: Optional[str] = None
    followers: int
    following: int
    title: Optional[str] = None
    email: EmailStr
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True) 
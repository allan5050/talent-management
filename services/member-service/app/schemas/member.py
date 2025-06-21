from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime
from uuid import UUID


class MemberBase(BaseModel):
    first_name: str
    last_name: str
    login: str
    avatar_url: Optional[str] = None
    followers: int
    following: int
    title: Optional[str] = None
    email: EmailStr
    organization_id: UUID


class MemberCreate(MemberBase):
    pass


class MemberUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    followers: Optional[int] = None
    following: Optional[int] = None
    title: Optional[str] = None
    email: Optional[EmailStr] = None


class MemberResponse(MemberBase):
    id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MemberListResponse(BaseModel):
    items: List[MemberResponse]
    total: int
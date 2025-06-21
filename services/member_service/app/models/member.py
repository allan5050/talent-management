import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    Integer,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from ..models.database import Base


class Member(Base):
    """SQLAlchemy ORM model for member records"""

    __tablename__ = 'members'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    login = Column(String(100), nullable=False, unique=True)
    avatar_url = Column(String(500))
    followers = Column(Integer, default=0)
    following = Column(Integer, default=0)
    title = Column(String(200))
    email = Column(String(255), nullable=False, unique=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    def __repr__(self):
        return f"<Member(id={self.id}, login='{self.login}', org='{self.organization_id}')>"
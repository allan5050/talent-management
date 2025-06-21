import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    Text,
    DateTime,
    func
)
from sqlalchemy.dialects.postgresql import UUID
from .database import Base


class Feedback(Base):
    """SQLAlchemy ORM model for feedback records"""

    __tablename__ = 'feedbacks'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    feedback = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    def __repr__(self):
        return f"<Feedback(id={self.id}, organization_id={self.organization_id})>"
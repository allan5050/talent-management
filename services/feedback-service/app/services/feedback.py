from uuid import UUID
from typing import List
from sqlalchemy.orm import Session
from app.models.feedback import Feedback
from app.schemas.feedback import FeedbackCreate
from fastapi import HTTPException

class FeedbackService:
    def __init__(self, db: Session):
        self.db = db

    def get_all_by_organization(self, organization_id: UUID) -> List[Feedback]:
        return self.db.query(Feedback).filter(
            Feedback.organization_id == organization_id,
            Feedback.deleted_at.is_(None)
        ).all()

    def create_feedback(self, feedback_data: FeedbackCreate) -> Feedback:
        db_feedback = Feedback(
            organization_id=feedback_data.organization_id,
            feedback=feedback_data.feedback
        )
        self.db.add(db_feedback)
        self.db.commit()
        self.db.refresh(db_feedback)
        return db_feedback

    def soft_delete_by_organization(self, organization_id: UUID) -> int:
        num_deleted = self.db.query(Feedback).filter(
            Feedback.organization_id == organization_id
        ).update({"deleted_at": "now()"})
        self.db.commit()
        return num_deleted
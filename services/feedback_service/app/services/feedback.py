from uuid import UUID
from typing import List
from sqlalchemy.orm import Session
from ..models.feedback import Feedback
from ..schemas.feedback import FeedbackCreate
from fastapi import HTTPException
from datetime import datetime

class FeedbackService:
    def __init__(self, db: Session):
        self.db = db

    def get_all_by_organization(self, organization_id: UUID) -> List[Feedback]:
        """
        Retrieves all non-deleted feedback for a specific organization.

        Args:
            organization_id: The UUID of the organization.

        Returns:
            A list of active Feedback ORM objects.
        """
        return self.db.query(Feedback).filter(
            Feedback.organization_id == organization_id,
            Feedback.deleted_at.is_(None)
        ).all()

    def create_feedback(self, feedback_data: FeedbackCreate, organization_id: UUID) -> Feedback:
        """
        Creates a new feedback record for an organization.

        Args:
            feedback_data: The Pydantic schema containing the feedback text.
            organization_id: The UUID of the organization to associate with.

        Returns:
            The newly created Feedback ORM object.
        """
        db_feedback = Feedback(
            organization_id=organization_id,
            feedback=feedback_data.feedback
        )
        self.db.add(db_feedback)
        self.db.commit()
        self.db.refresh(db_feedback)
        return db_feedback

    def soft_delete_by_organization(self, organization_id: UUID) -> int:
        """
        Soft-deletes all feedback for a specific organization.

        This is a non-destructive operation that sets the `deleted_at` timestamp
        on the relevant records.

        Args:
            organization_id: The UUID of the organization whose feedback will be deleted.

        Returns:
            The number of feedback records that were soft-deleted.
        """
        num_deleted = self.db.query(Feedback).filter(
            Feedback.organization_id == organization_id,
            Feedback.deleted_at.is_(None)  # Ensure we only "delete" active records
        ).update({"deleted_at": datetime.utcnow()})
        self.db.commit()
        return num_deleted
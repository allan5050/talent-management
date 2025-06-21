from fastapi import APIRouter, Depends, status, Response
from typing import List

from ..schemas.feedback import FeedbackCreate, FeedbackResponse
from ..services.feedback import FeedbackService
from .dependencies import get_feedback_service
from ..config.settings import settings

router = APIRouter()

@router.post("/{org_id}/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def create_feedback(
    org_id: str,
    feedback_data: FeedbackCreate,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Create new feedback for a given organization.
    """
    return service.create_feedback(
        feedback_data=feedback_data, organization_id=org_id
    )

@router.get("/{org_id}/feedback", response_model=List[FeedbackResponse])
def get_all_feedback(
    org_id: str,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Get all non-deleted feedbacks for a given organization.
    """
    return service.get_all_by_organization(
        organization_id=org_id
    )

@router.delete("/{org_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_all_feedback(
    org_id: str,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Soft delete all feedbacks for a given organization.
    """
    service.soft_delete_by_organization(
        organization_id=org_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
from fastapi import APIRouter, Depends, status, Response
from typing import List

from app.schemas.feedback import FeedbackCreate, FeedbackResponse
from app.services.feedback import FeedbackService
from app.api.dependencies import get_feedback_service
from app.config.settings import settings

router = APIRouter()

@router.post("", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def create_feedback(
    feedback_data: FeedbackCreate,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Create new feedback for the default organization.
    """
    return service.create_feedback(
        feedback_data=feedback_data, organization_id=settings.DEFAULT_ORGANIZATION_ID
    )

@router.get("", response_model=List[FeedbackResponse])
def get_all_feedback(
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Get all non-deleted feedbacks for the default organization.
    """
    return service.get_all_by_organization(
        organization_id=settings.DEFAULT_ORGANIZATION_ID
    )

@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_all_feedback(
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Soft delete all feedbacks for the default organization.
    """
    service.soft_delete_by_organization(
        organization_id=settings.DEFAULT_ORGANIZATION_ID
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
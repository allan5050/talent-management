from fastapi import APIRouter, Depends, status
from uuid import UUID
from typing import List

from app.schemas.feedback import FeedbackCreate, FeedbackResponse
from app.services.feedback import FeedbackService
from app.api.dependencies import get_feedback_service

router = APIRouter()

@router.post("/", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    feedback_data: FeedbackCreate,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Create new feedback for an organization.
    """
    return await service.create_feedback(feedback_data=feedback_data)

@router.get("/organization/{organization_id}", response_model=List[FeedbackResponse])
async def get_feedbacks_by_organization(
    organization_id: UUID,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Get all non-deleted feedbacks for an organization.
    """
    return await service.get_feedbacks_by_organization(organization_id=organization_id)

@router.delete("/organization/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_feedbacks_by_organization(
    organization_id: UUID,
    service: FeedbackService = Depends(get_feedback_service),
):
    """
    Soft delete all feedbacks for an organization.
    """
    await service.soft_delete_feedbacks_for_organization(organization_id=organization_id)
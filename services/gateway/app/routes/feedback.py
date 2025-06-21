from fastapi import APIRouter, Request, Response, status
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import FeedbackResponse, ErrorResponse
from ..config.settings import settings

router = APIRouter()

@router.post(
    "/organizations/{org_id}/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Feedback for an Organization",
    description="Creates a new feedback entry for a specific organization and returns the created feedback.",
    responses={
        404: {"model": ErrorResponse, "description": "Organization not found"},
        201: {"description": "Feedback created successfully"},
    },
)
async def create_feedback_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/organizations/{org_id}/feedback"
    )

@router.get(
    "/organizations/{org_id}/feedback",
    response_model=List[FeedbackResponse],
    summary="Get All Feedback for an Organization",
    description="Retrieves a list of all non-deleted feedback entries for a specific organization.",
    responses={404: {"model": ErrorResponse, "description": "Organization not found"}},
)
async def get_feedback_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/organizations/{org_id}/feedback"
    )

@router.delete(
    "/organizations/{org_id}/feedback",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-Delete All Feedback for an Organization",
    description="Performs a soft delete on all feedback entries for a specific organization by setting the `deleted_at` timestamp.",
    responses={404: {"model": ErrorResponse, "description": "Organization not found"}},
)
async def delete_feedback_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/organizations/{org_id}/feedback"
    )

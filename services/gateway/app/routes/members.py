from fastapi import APIRouter, Request, Response, status
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import MemberResponse, ErrorResponse
from ..config.settings import settings

router = APIRouter()

@router.post(
    "/organizations/{org_id}/members",
    response_model=MemberResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Member for an Organization",
    description="Creates a new member for a specific organization and returns the created member record.",
    responses={404: {"model": ErrorResponse, "description": "Organization not found"}},
)
async def create_member_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )


@router.get(
    "/organizations/{org_id}/members",
    response_model=List[MemberResponse],
    summary="Get All Members for an Organization",
    description="Retrieves a list of all non-deleted members for a specific organization, sorted by follower count in descending order.",
    responses={404: {"model": ErrorResponse, "description": "Organization not found"}},
)
async def get_members_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )


@router.delete(
    "/organizations/{org_id}/members",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-Delete All Members for an Organization",
    description="Performs a soft delete on all members of a specific organization by setting their `deleted_at` timestamp.",
    responses={404: {"model": ErrorResponse, "description": "Organization not found"}},
)
async def delete_members_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )

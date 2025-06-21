from fastapi import APIRouter, Request, Response
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import MemberResponse
from ..config.settings import settings

router = APIRouter()

@router.post("/organizations/{org_id}/members", response_model=MemberResponse)
async def create_member_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )


@router.get("/organizations/{org_id}/members", response_model=List[MemberResponse])
async def get_members_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )


@router.delete("/organizations/{org_id}/members", status_code=204)
async def delete_members_proxy(org_id: str, request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/organizations/{org_id}/members"
    )

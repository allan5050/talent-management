from fastapi import APIRouter, Request, Response
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import MemberResponse
from ..config.settings import settings

router = APIRouter()

@router.post("/members", response_model=MemberResponse)
async def create_member_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/members"
    )


@router.get("/members", response_model=List[MemberResponse])
async def get_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/members"
    )


@router.delete("/members", status_code=204)
async def delete_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.MEMBER_SERVICE_URL}/members"
    )

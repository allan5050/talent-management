from fastapi import APIRouter, Request, Response
import os
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import MemberResponse

router = APIRouter()

MEMBER_SERVICE_URL = os.getenv("MEMBER_SERVICE_URL", "http://member-service:8002")


@router.post("/members", response_model=MemberResponse)
async def create_member_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )


@router.get("/members", response_model=List[MemberResponse])
async def get_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )


@router.delete("/members", status_code=204)
async def delete_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )

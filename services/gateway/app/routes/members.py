from fastapi import APIRouter, Request, Response
import os

from app.utils.http_client import gateway_http_client

router = APIRouter()

MEMBER_SERVICE_URL = os.getenv("MEMBER_SERVICE_URL", "http://member-service:8002")


@router.post("/members")
async def create_member_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )


@router.get("/members")
async def get_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )


@router.delete("/members")
async def delete_members_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{MEMBER_SERVICE_URL}/members"
    )

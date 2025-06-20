from fastapi import APIRouter, Request, Response
import os

from app.utils.http_client import gateway_http_client

router = APIRouter()

MEMBER_SERVICE_URL = os.getenv("MEMBER_SERVICE_URL", "http://member-service:8002")

@router.api_route("/members/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_members(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request,
        target_url=MEMBER_SERVICE_URL
    )

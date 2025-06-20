from fastapi import APIRouter, Request, Response
import os

from app.utils.http_client import gateway_http_client

router = APIRouter()

FEEDBACK_SERVICE_URL = os.getenv("FEEDBACK_SERVICE_URL", "http://feedback-service:8001")

@router.api_route("/feedback/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_feedback(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request,
        target_url=FEEDBACK_SERVICE_URL
    )

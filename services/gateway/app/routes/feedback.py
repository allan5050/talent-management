from fastapi import APIRouter, Request, Response
import os

from app.utils.http_client import gateway_http_client

router = APIRouter()

FEEDBACK_SERVICE_URL = os.getenv("FEEDBACK_SERVICE_URL", "http://feedback-service:8001")


@router.post("/feedback")
async def create_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )


@router.get("/feedback")
async def get_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )


@router.delete("/feedback")
async def delete_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )

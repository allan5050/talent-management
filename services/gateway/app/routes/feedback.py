from fastapi import APIRouter, Request, Response
import os
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import FeedbackResponse

router = APIRouter()

FEEDBACK_SERVICE_URL = os.getenv("FEEDBACK_SERVICE_URL", "http://feedback-service:8001")


@router.post("/feedback", response_model=FeedbackResponse)
async def create_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )


@router.get("/feedback", response_model=List[FeedbackResponse])
async def get_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )


@router.delete("/feedback", status_code=204)
async def delete_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{FEEDBACK_SERVICE_URL}/feedback"
    )

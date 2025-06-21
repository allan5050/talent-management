from fastapi import APIRouter, Request, Response
from typing import List

from ..utils.http_client import gateway_http_client
from ..schemas import FeedbackResponse
from ..config.settings import settings

router = APIRouter()

@router.post("/feedback", response_model=FeedbackResponse)
async def create_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/feedback"
    )


@router.get("/feedback", response_model=List[FeedbackResponse])
async def get_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/feedback"
    )


@router.delete("/feedback", status_code=204)
async def delete_feedback_proxy(request: Request) -> Response:
    return await gateway_http_client.forward_request(
        request=request, target_url=f"{settings.FEEDBACK_SERVICE_URL}/feedback"
    )

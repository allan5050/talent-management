from fastapi import APIRouter, Depends, status, Response
from uuid import UUID
from typing import List

from app.schemas.member import MemberCreate, MemberResponse
from app.services.member import MemberService
from app.api.dependencies import get_member_service

router = APIRouter()

@router.post("/", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
def create_member(
    member_data: MemberCreate,
    service: MemberService = Depends(get_member_service),
):
    """
    Create a new member for an organization.
    """
    return service.create_member(member_data=member_data)

@router.get("/organization/{organization_id}", response_model=List[MemberResponse])
def get_members_by_organization(
    organization_id: UUID,
    service: MemberService = Depends(get_member_service),
):
    """
    Get all non-deleted members for an organization, sorted by followers descending.
    """
    return service.get_members_by_organization(organization_id=organization_id)

@router.delete("/organization/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_members_by_organization(
    organization_id: UUID,
    service: MemberService = Depends(get_member_service),
):
    """
    Soft delete all members for an organization.
    """
    service.soft_delete_by_organization(organization_id=organization_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
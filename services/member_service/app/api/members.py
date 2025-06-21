from fastapi import APIRouter, Depends, status, Response
from typing import List

from ..schemas.member import MemberCreate, MemberResponse
from ..services.member import MemberService
from .dependencies import get_member_service
from ..config.settings import settings

router = APIRouter()

@router.post("/{org_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
def create_member(
    org_id: str,
    member_data: MemberCreate,
    service: MemberService = Depends(get_member_service),
):
    """
    Create a new member for a given organization.
    """
    return service.create_member(
        member_data=member_data, organization_id=org_id
    )

@router.get("/{org_id}/members", response_model=List[MemberResponse])
def get_all_members(
    org_id: str,
    service: MemberService = Depends(get_member_service),
):
    """
    Get all non-deleted members for a given organization, sorted by followers descending.
    """
    return service.get_members_by_organization(
        organization_id=org_id
    )

@router.delete("/{org_id}/members", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_all_members(
    org_id: str,
    service: MemberService = Depends(get_member_service),
):
    """
    Soft delete all members for a given organization.
    """
    service.soft_delete_by_organization(
        organization_id=org_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
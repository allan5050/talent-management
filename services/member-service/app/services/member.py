from uuid import UUID
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import func, update, asc, desc

from app.models.member import Member
from app.schemas.member import MemberCreate

class MemberService:
    def __init__(self, db: Session):
        self.db = db

    def create_member(self, member_data: MemberCreate) -> Member:
        db_member = Member(**member_data.dict())
        self.db.add(db_member)
        self.db.commit()
        self.db.refresh(db_member)
        return db_member

    def get_members_by_organization(self, organization_id: UUID) -> List[Member]:
        return self.db.query(Member).filter(
            Member.organization_id == organization_id,
            Member.deleted_at == None
        ).order_by(desc(Member.followers)).all()

    def soft_delete_by_organization(self, organization_id: UUID) -> int:
        num_deleted = self.db.query(Member).filter(
            Member.organization_id == organization_id
        ).update({"deleted_at": func.now()})
        self.db.commit()
        return num_deleted
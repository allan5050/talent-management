from sqlalchemy.orm import Session
from fastapi import Depends

from ..services.member import MemberService
from ..models.database import get_db

def get_member_service(db: Session = Depends(get_db)):
    return MemberService(db) 
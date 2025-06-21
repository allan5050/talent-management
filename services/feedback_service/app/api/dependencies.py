from sqlalchemy.orm import Session
from fastapi import Depends

from ..services.feedback import FeedbackService
from ..models.database import get_db

def get_feedback_service(db: Session = Depends(get_db)):
    return FeedbackService(db) 
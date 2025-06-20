from sqlalchemy.orm import Session
from fastapi import Depends

from app.services.feedback import FeedbackService
from app.models.database import get_db

def get_feedback_service(db: Session = Depends(get_db)):
    return FeedbackService(db) 
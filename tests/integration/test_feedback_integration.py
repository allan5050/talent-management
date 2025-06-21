import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from uuid import uuid4

from services.feedback_service.app.models.database import Base
from services.feedback_service.app.models.feedback import Feedback
from services.feedback_service.app.config.settings import settings

# Use a separate test database
TEST_DATABASE_URL = os.environ.get(
    "FEEDBACK_DATABASE_URL", 
    "postgresql://user:password@db:5432/feedback_db_test"
)

engine = create_engine(TEST_DATABASE_URL)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables for testing
Base.metadata.create_all(bind=engine)

@pytest.fixture(scope="function")
def db_session():
    """
    Pytest fixture to provide a database session for each test function.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()

def test_create_and_get_feedback(db_session):
    """
    Test creating a feedback record and retrieving it.
    """
    org_id = settings.DEFAULT_ORGANIZATION_ID
    feedback_text = "This is a test feedback."

    # Create a new feedback object
    new_feedback = Feedback(
        id=uuid4(),
        organization_id=org_id,
        feedback=feedback_text
    )

    db_session.add(new_feedback)
    db_session.commit()
    db_session.refresh(new_feedback)

    # Retrieve the feedback from the database
    retrieved_feedback = db_session.query(Feedback).filter(Feedback.id == new_feedback.id).first()

    assert retrieved_feedback is not None
    assert retrieved_feedback.feedback == feedback_text
    assert retrieved_feedback.organization_id == org_id
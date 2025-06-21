import os
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from uuid import uuid4
from faker import Faker

from services.member_service.app.models.database import Base
from services.member_service.app.models.member import Member
from services.member_service.app.config.settings import settings

fake = Faker()

# Use a separate test database
TEST_DATABASE_URL = os.environ.get(
    "MEMBER_DATABASE_URL", 
    "postgresql://user:password@db:5432/member_db_test"
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

def test_create_and_get_member(db_session):
    """
    Test creating a member record and retrieving it.
    """
    org_id = settings.DEFAULT_ORGANIZATION_ID
    member_data = {
        "id": uuid4(),
        "organization_id": org_id,
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "login": fake.user_name(),
        "avatar_url": fake.image_url(),
        "followers": fake.random_int(min=0, max=1000),
        "following": fake.random_int(min=0, max=1000),
        "title": fake.job(),
        "email": fake.email(),
    }

    new_member = Member(**member_data)

    db_session.add(new_member)
    db_session.commit()
    db_session.refresh(new_member)

    retrieved_member = db_session.query(Member).filter(Member.id == new_member.id).first()

    assert retrieved_member is not None
    assert retrieved_member.login == member_data["login"]
    assert retrieved_member.organization_id == org_id
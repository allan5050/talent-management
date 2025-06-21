import os
import httpx
import pytest
from faker import Faker

BASE_URL = os.environ.get("GATEWAY_URL", "http://localhost:8000")
ORG_ID = "8a1a7ac2-e528-4e63-8e2c-3a37d1472e35"  # From seed data
fake = Faker()

@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE_URL) as client:
        yield client

def test_health_check(client: httpx.Client):
    """
    Tests if the gateway's documentation page is available.
    A simple check to ensure the service is running.
    """
    response = client.get("/docs")
    assert response.status_code == 200

def test_feedback_workflow(client: httpx.Client):
    """
    Tests the full lifecycle of feedback: create, get, and delete.
    """
    # 1. Create feedback
    feedback_text = fake.sentence()
    response = client.post(f"/organizations/{ORG_ID}/feedback", json={"feedback": feedback_text})
    assert response.status_code == 201
    created_feedback = response.json()
    assert created_feedback["feedback"] == feedback_text
    assert "id" in created_feedback

    # 2. Get feedback and verify creation
    response = client.get(f"/organizations/{ORG_ID}/feedback")
    assert response.status_code == 200
    feedback_list = response.json()
    assert isinstance(feedback_list, list)
    assert any(item["id"] == created_feedback["id"] for item in feedback_list)
    
    # 3. Delete all feedback
    response = client.delete(f"/organizations/{ORG_ID}/feedback")
    assert response.status_code == 204

    # 4. Verify deletion
    response = client.get(f"/organizations/{ORG_ID}/feedback")
    assert response.status_code == 200
    assert response.json() == []

def test_member_workflow(client: httpx.Client):
    """
    Tests the full lifecycle of members: create, get, and delete.
    """
    # 1. Create a member
    member_data = {
        "first_name": fake.first_name(),
        "last_name": fake.last_name(),
        "login": fake.user_name(),
        "avatar_url": fake.image_url(),
        "followers": fake.random_int(min=0, max=1000),
        "following": fake.random_int(min=0, max=1000),
        "title": fake.job(),
        "email": fake.email(),
    }
    response = client.post(f"/organizations/{ORG_ID}/members", json=member_data)
    assert response.status_code == 201
    created_member = response.json()
    assert created_member["login"] == member_data["login"]
    assert "id" in created_member

    # 2. Get members and verify creation and sorting
    response = client.get(f"/organizations/{ORG_ID}/members")
    assert response.status_code == 200
    member_list = response.json()
    assert isinstance(member_list, list)
    assert any(item["id"] == created_member["id"] for item in member_list)
    # Verify that the list is sorted by followers descending
    assert member_list == sorted(member_list, key=lambda x: x["followers"], reverse=True)

    # 3. Delete all members
    response = client.delete(f"/organizations/{ORG_ID}/members")
    assert response.status_code == 204

    # 4. Verify deletion
    response = client.get(f"/organizations/{ORG_ID}/members")
    assert response.status_code == 200
    assert response.json() == [] 
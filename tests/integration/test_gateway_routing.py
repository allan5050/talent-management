import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import Response

# The app is imported here, before any patching
from services.gateway.app.main import app

client = TestClient(app)

@pytest.fixture
def mock_http_client():
    """
    Fixture to mock the GatewayHTTPClient in all the places it is used.
    """
    with patch('services.gateway.app.routes.feedback.gateway_http_client', new_callable=MagicMock) as mock_feedback_client, \
         patch('services.gateway.app.routes.members.gateway_http_client', new_callable=MagicMock) as mock_member_client:
        
        mocks = {'feedback': mock_feedback_client, 'member': mock_member_client}
        yield mocks

def test_create_feedback_routing(mock_http_client: dict):
    """
    Test that POST /feedback is routed to the feedback service.
    """
    async def mock_async_forward(*args, **kwargs):
        return Response(
            content=b'{"id": "123", "feedback": "great"}',
            status_code=201,
            headers={'content-type': 'application/json'}
        )
    mock_http_client['feedback'].forward_request.side_effect = mock_async_forward

    response = client.post("/feedback", json={"feedback": "great"})

    assert response.status_code == 201
    mock_http_client['feedback'].forward_request.assert_called_once()
    call_kwargs = mock_http_client['feedback'].forward_request.call_args.kwargs
    assert "feedback-service" in call_kwargs['target_url']

def test_get_feedback_routing(mock_http_client: dict):
    """
    Test that GET /feedback is routed to the feedback service.
    """
    async def mock_async_forward(*args, **kwargs):
        return Response(
            content=b'[]',
            status_code=200,
            headers={'content-type': 'application/json'}
        )
    mock_http_client['feedback'].forward_request.side_effect = mock_async_forward

    response = client.get("/feedback")

    assert response.status_code == 200
    mock_http_client['feedback'].forward_request.assert_called_once()
    call_kwargs = mock_http_client['feedback'].forward_request.call_args.kwargs
    assert "feedback-service" in call_kwargs['target_url']

def test_create_member_routing(mock_http_client: dict):
    """
    Test that POST /members is routed to the member service.
    """
    async def mock_async_forward(*args, **kwargs):
        return Response(
            content=b'{"id": "456", "first_name": "Test"}',
            status_code=201,
            headers={'content-type': 'application/json'}
        )
    mock_http_client['member'].forward_request.side_effect = mock_async_forward

    response = client.post("/members", json={"first_name": "Test"})

    assert response.status_code == 201
    mock_http_client['member'].forward_request.assert_called_once()
    call_kwargs = mock_http_client['member'].forward_request.call_args.kwargs
    assert "member-service" in call_kwargs['target_url']

def test_get_members_routing(mock_http_client: dict):
    """
    Test that GET /members is routed to the member service.
    """
    async def mock_async_forward(*args, **kwargs):
        return Response(
            content=b'[]',
            status_code=200,
            headers={'content-type': 'application/json'}
        )
    mock_http_client['member'].forward_request.side_effect = mock_async_forward

    response = client.get("/members")

    assert response.status_code == 200
    mock_http_client['member'].forward_request.assert_called_once()
    call_kwargs = mock_http_client['member'].forward_request.call_args.kwargs
    assert "member-service" in call_kwargs['target_url']
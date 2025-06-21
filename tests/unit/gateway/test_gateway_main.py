from fastapi.testclient import TestClient
from services.gateway.app.main import app

client = TestClient(app)

def test_read_root():
    """
    Test the root endpoint of the gateway.
    """
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "API Gateway is running"} 
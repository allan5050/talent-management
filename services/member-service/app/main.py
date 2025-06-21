from fastapi import FastAPI
from app.api import members
from app.models.database import engine, Base

app = FastAPI(
    title="Member Service",
    description="Microservice for managing member records",
    version="1.0.0",
)

@app.get("/health")
def health_check():
    return {"status": "ok"}

app.include_router(
    members.router,
    prefix="/members",
    tags=["Members"],
)
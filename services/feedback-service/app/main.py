from fastapi import FastAPI
from app.api import feedback
from app.models.database import engine, Base

app = FastAPI(
    title="Feedback Service",
    description="Microservice for managing feedback records",
    version="1.0.0",
)

@app.get("/health")
def health_check():
    return {"status": "ok"}

app.include_router(
    feedback.router,
    prefix="/feedback",
    tags=["Feedback"],
)
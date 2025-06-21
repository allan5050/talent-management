from fastapi import FastAPI
from .api import feedback
from .models.database import engine, Base

app = FastAPI(
    title="Feedback Service",
    description="Microservice for managing feedback records",
    version="1.0.0",
)

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health_check():
    return {"status": "ok"}

app.include_router(
    feedback.router,
    prefix="/organizations",
    tags=["Feedback"],
)
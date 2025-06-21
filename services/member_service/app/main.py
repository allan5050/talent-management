from fastapi import FastAPI
from .api import members
from .models.database import engine, Base

app = FastAPI(
    title="Member Service",
    description="Microservice for managing member records",
    version="1.0.0",
)

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)

@app.get("/health")
def health_check():
    return {"status": "ok"}

app.include_router(
    members.router,
    prefix="/organizations",
    tags=["Members"],
)
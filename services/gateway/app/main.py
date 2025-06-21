from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import feedback
from .routes import members

app = FastAPI(
    title="Talent Management API Gateway",
    description="API Gateway for Talent Management Microservices Platform",
    version="1.0.0",
)

# Add CORS middleware to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for simplicity
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the proxy routers
# The routes already include the service names in their paths
app.include_router(feedback.router, tags=["Feedback"])
app.include_router(members.router, tags=["Members"])

@app.get("/")
def read_root():
    return {"message": "API Gateway is running"}
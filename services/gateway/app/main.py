from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import feedback
from app.routes import members

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
# Note: The paths here are now prefixes for the routes in the included routers.
# e.g., a route "/organization/{id}" in feedback.router becomes "/feedback/organization/{id}"
app.include_router(feedback.router, prefix="/feedback", tags=["Feedback"])
app.include_router(members.router, prefix="/members", tags=["Members"])

@app.get("/")
def read_root():
    return {"message": "API Gateway is running"}
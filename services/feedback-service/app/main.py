import os
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, HTTPException, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError, IntegrityError, OperationalError
from sqlalchemy.orm import Session
import uvicorn

from app.api import feedback
from app.models.database import engine, SessionLocal, Base
from app.models.feedback import Feedback
from app.config.settings import Settings

# Configure structured logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "feedback-service", "message": "%(message)s", "module": "%(module)s", "function": "%(funcName)s", "line": %(lineno)d}',
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# Load settings
settings = Settings()

# Track active requests for graceful shutdown
active_requests = set()
shutdown_event = asyncio.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    # Startup
    logger.info("Starting Feedback Service...")
    
    try:
        # Validate configuration
        if not settings.DATABASE_URL:
            raise ValueError("DATABASE_URL environment variable is required")
        
        # Create database tables
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        
        # Test database connection
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            logger.info("Database connection established successfully")
        
        # Perform additional startup tasks
        logger.info(f"Feedback Service started successfully on port {settings.PORT}")
        
    except Exception as e:
        logger.error(f"Failed to start Feedback Service: {str(e)}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down Feedback Service...")
    
    # Wait for active requests to complete
    shutdown_event.set()
    if active_requests:
        logger.info(f"Waiting for {len(active_requests)} active requests to complete...")
        await asyncio.gather(*active_requests, return_exceptions=True)
    
    # Close database connections
    engine.dispose()
    logger.info("Database connections closed")
    
    logger.info("Feedback Service shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="Feedback Service",
    description="Microservice for managing feedback records in the AI-powered recruitment platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan
)

# Configure CORS
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Correlation-ID"]
)


# Dependency to get database session
def get_db():
    """Provide database session with automatic cleanup."""
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.error(f"Database error occurred: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


# Middleware for request tracking and logging
@app.middleware("http")
async def track_requests(request: Request, call_next):
    """Track active requests and add correlation ID."""
    request_id = request.headers.get("X-Correlation-ID", f"feedback-{os.urandom(8).hex()}")
    
    # Add to active requests
    task = asyncio.current_task()
    active_requests.add(task)
    
    # Log request
    logger.info(f"Request started: {request.method} {request.url.path} [ID: {request_id}]")
    
    try:
        # Process request
        response = await call_next(request)
        
        # Add correlation ID to response
        response.headers["X-Correlation-ID"] = request_id
        
        # Log response
        logger.info(f"Request completed: {request.method} {request.url.path} [ID: {request_id}] Status: {response.status_code}")
        
        return response
        
    except Exception as e:
        logger.error(f"Request failed: {request.method} {request.url.path} [ID: {request_id}] Error: {str(e)}")
        raise
    finally:
        # Remove from active requests
        active_requests.discard(task)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unhandled exceptions with standardized error response."""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    logger.error(f"Unhandled exception [ID: {correlation_id}]: {str(exc)}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred",
            "correlation_id": correlation_id,
            "service": "feedback-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


# HTTP exception handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle FastAPI HTTP exceptions with consistent formatting."""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "message": f"HTTP {exc.status_code}: {exc.detail}",
            "correlation_id": correlation_id,
            "service": "feedback-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


# Database exception handler
@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError):
    """Handle database exceptions with appropriate error responses."""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    if isinstance(exc, IntegrityError):
        logger.error(f"Database integrity error [ID: {correlation_id}]: {str(exc)}")
        return JSONResponse(
            status_code=400,
            content={
                "error": "Data Integrity Error",
                "message": "The operation violates database constraints",
                "correlation_id": correlation_id,
                "service": "feedback-service"
            },
            headers={"X-Correlation-ID": correlation_id}
        )
    
    elif isinstance(exc, OperationalError):
        logger.error(f"Database operational error [ID: {correlation_id}]: {str(exc)}")
        return JSONResponse(
            status_code=503,
            content={
                "error": "Service Unavailable",
                "message": "Database connection error. Please try again later",
                "correlation_id": correlation_id,
                "service": "feedback-service"
            },
            headers={"X-Correlation-ID": correlation_id}
        )
    
    else:
        logger.error(f"Database error [ID: {correlation_id}]: {str(exc)}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "Database Error",
                "message": "A database error occurred",
                "correlation_id": correlation_id,
                "service": "feedback-service"
            },
            headers={"X-Correlation-ID": correlation_id}
        )


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check(db: Session = Depends(get_db)):
    """Check service health and database connectivity."""
    health_status = {
        "status": "healthy",
        "service": "feedback-service",
        "version": "1.0.0",
        "checks": {}
    }
    
    # Check database connectivity
    try:
        result = db.execute(text("SELECT 1"))
        result.scalar()
        health_status["checks"]["database"] = {
            "status": "healthy",
            "message": "Database connection successful"
        }
        
        # Check feedback table accessibility
        feedback_count = db.query(Feedback).count()
        health_status["checks"]["feedback_table"] = {
            "status": "healthy",
            "message": f"Feedback table accessible, {feedback_count} records"
        }
        
    except Exception as e:
        health_status["status"] = "unhealthy"
        health_status["checks"]["database"] = {
            "status": "unhealthy",
            "message": f"Database error: {str(e)}"
        }
        logger.error(f"Health check failed: {str(e)}")
        return JSONResponse(status_code=503, content=health_status)
    
    return health_status


# Service info endpoint
@app.get("/info", tags=["Service Info"])
async def service_info():
    """Get service metadata and available endpoints."""
    return {
        "service": "feedback-service",
        "version": "1.0.0",
        "description": "Microservice for managing feedback records",
        "endpoints": {
            "health": "/health",
            "info": "/info",
            "docs": "/docs",
            "openapi": "/openapi.json",
            "feedback": "/api/v1/feedback"
        },
        "configuration": {
            "database_pool_size": settings.DB_POOL_SIZE,
            "database_max_overflow": settings.DB_MAX_OVERFLOW,
            "request_timeout": settings.REQUEST_TIMEOUT,
            "cors_origins": cors_origins,
            "log_level": os.getenv("LOG_LEVEL", "INFO")
        }
    }


# Include feedback API routes
app.include_router(
    feedback.router,
    prefix="/api/v1/feedback",
    tags=["Feedback"]
)


# Response formatting middleware
@app.middleware("http")
async def format_response(request: Request, call_next):
    """Standardize API response format."""
    response = await call_next(request)
    
    # Only format JSON responses for API endpoints
    if request.url.path.startswith("/api/") and response.headers.get("content-type", "").startswith("application/json"):
        # Response formatting is handled by individual endpoints
        pass
    
    return response


# Request validation middleware
@app.middleware("http")
async def validate_request(request: Request, call_next):
    """Validate request format and content type."""
    # Check content type for POST/PUT requests
    if request.method in ["POST", "PUT"] and request.url.path.startswith("/api/"):
        content_type = request.headers.get("content-type", "")
        if not content_type.startswith("application/json"):
            return JSONResponse(
                status_code=415,
                content={
                    "error": "Unsupported Media Type",
                    "message": "Content-Type must be application/json",
                    "service": "feedback-service"
                }
            )
    
    # Apply request timeout
    try:
        response = await asyncio.wait_for(
            call_next(request),
            timeout=settings.REQUEST_TIMEOUT
        )
        return response
    except asyncio.TimeoutError:
        correlation_id = request.headers.get("X-Correlation-ID", "unknown")
        logger.error(f"Request timeout [ID: {correlation_id}]: {request.method} {request.url.path}")
        return JSONResponse(
            status_code=504,
            content={
                "error": "Gateway Timeout",
                "message": f"Request exceeded timeout of {settings.REQUEST_TIMEOUT} seconds",
                "correlation_id": correlation_id,
                "service": "feedback-service"
            }
        )


# Metrics collection middleware
@app.middleware("http")
async def collect_metrics(request: Request, call_next):
    """Collect request metrics for monitoring."""
    import time
    start_time = time.time()
    
    # Process request
    response = await call_next(request)
    
    # Calculate request duration
    duration = time.time() - start_time
    
    # Log metrics
    logger.info(f"Metrics: method={request.method} path={request.url.path} status={response.status_code} duration={duration:.3f}s")
    
    # Add timing header
    response.headers["X-Response-Time"] = f"{duration:.3f}"
    
    return response


if __name__ == "__main__":
    # Run the application
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=os.getenv("ENV", "production") == "development",
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )
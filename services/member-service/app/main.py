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

from app.api import members
from app.models.database import engine, SessionLocal, Base
from app.models.member import Member
from app.config.settings import Settings

# Configure structured logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "member-service", "message": "%(message)s", "module": "%(module)s", "function": "%(funcName)s", "line": %(lineno)d}',
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
    """Manage application lifecycle events"""
    # Startup
    logger.info("Starting Member Service...")
    
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
        logger.info(f"Member Service started successfully on port {settings.PORT}")
        
    except Exception as e:
        logger.error(f"Failed to start Member Service: {str(e)}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down Member Service...")
    
    # Set shutdown event
    shutdown_event.set()
    
    # Wait for active requests to complete
    if active_requests:
        logger.info(f"Waiting for {len(active_requests)} active requests to complete...")
        await asyncio.gather(*active_requests, return_exceptions=True)
    
    # Close database connections
    engine.dispose()
    logger.info("Database connections closed")
    
    logger.info("Member Service shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="Member Service",
    description="Microservice for managing member records in the AI-powered recruitment platform",
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
    expose_headers=["X-Total-Count", "X-Page", "X-Per-Page", "X-Correlation-ID"]
)


# Middleware for request tracking and logging
@app.middleware("http")
async def track_requests(request: Request, call_next):
    """Track active requests and add correlation ID"""
    # Generate or extract correlation ID
    correlation_id = request.headers.get("X-Correlation-ID", f"member-{os.urandom(8).hex()}")
    
    # Create request task
    request_task = asyncio.create_task(call_next(request))
    active_requests.add(request_task)
    
    # Log request
    logger.info(f"Request started: {request.method} {request.url.path}", extra={
        "correlation_id": correlation_id,
        "method": request.method,
        "path": request.url.path,
        "client": request.client.host if request.client else "unknown"
    })
    
    try:
        # Check for shutdown
        if shutdown_event.is_set():
            return JSONResponse(
                status_code=503,
                content={"detail": "Service is shutting down"},
                headers={"X-Correlation-ID": correlation_id}
            )
        
        # Process request with timeout
        timeout = float(os.getenv("REQUEST_TIMEOUT", "30"))
        response = await asyncio.wait_for(request_task, timeout=timeout)
        
        # Add correlation ID to response
        response.headers["X-Correlation-ID"] = correlation_id
        
        # Log response
        logger.info(f"Request completed: {request.method} {request.url.path} - {response.status_code}", extra={
            "correlation_id": correlation_id,
            "status_code": response.status_code,
            "duration": getattr(response, "duration", 0)
        })
        
        return response
        
    except asyncio.TimeoutError:
        logger.error(f"Request timeout: {request.method} {request.url.path}", extra={
            "correlation_id": correlation_id,
            "timeout": timeout
        })
        return JSONResponse(
            status_code=504,
            content={"detail": "Request timeout"},
            headers={"X-Correlation-ID": correlation_id}
        )
    finally:
        active_requests.discard(request_task)


# Middleware for response formatting
@app.middleware("http")
async def format_response(request: Request, call_next):
    """Standardize response format"""
    import time
    start_time = time.time()
    
    response = await call_next(request)
    
    # Add response time header
    duration = time.time() - start_time
    response.headers["X-Response-Time"] = f"{duration:.3f}"
    
    # Store duration for logging
    if hasattr(response, "__dict__"):
        response.duration = duration
    
    return response


# Database dependency
def get_db():
    """Provide database session with automatic cleanup"""
    db = SessionLocal()
    try:
        yield db
    except SQLAlchemyError as e:
        logger.error(f"Database error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


# Global exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle FastAPI HTTP exceptions"""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    logger.warning(f"HTTP exception: {exc.status_code} - {exc.detail}", extra={
        "correlation_id": correlation_id,
        "status_code": exc.status_code,
        "path": request.url.path
    })
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "status_code": exc.status_code,
            "correlation_id": correlation_id,
            "service": "member-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Handle database integrity constraint violations"""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    # Parse error message for user-friendly response
    error_msg = str(exc.orig)
    if "unique constraint" in error_msg.lower():
        detail = "A member with this information already exists"
    elif "foreign key constraint" in error_msg.lower():
        detail = "Referenced resource does not exist"
    elif "not null constraint" in error_msg.lower():
        detail = "Required field is missing"
    else:
        detail = "Data integrity violation"
    
    logger.error(f"Database integrity error: {error_msg}", extra={
        "correlation_id": correlation_id,
        "error_type": "IntegrityError",
        "path": request.url.path
    })
    
    return JSONResponse(
        status_code=400,
        content={
            "detail": detail,
            "error_type": "integrity_error",
            "correlation_id": correlation_id,
            "service": "member-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


@app.exception_handler(OperationalError)
async def operational_error_handler(request: Request, exc: OperationalError):
    """Handle database operational errors"""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    logger.error(f"Database operational error: {str(exc)}", extra={
        "correlation_id": correlation_id,
        "error_type": "OperationalError",
        "path": request.url.path
    })
    
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database service temporarily unavailable",
            "error_type": "operational_error",
            "correlation_id": correlation_id,
            "service": "member-service",
            "retry_after": 30
        },
        headers={
            "X-Correlation-ID": correlation_id,
            "Retry-After": "30"
        }
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError):
    """Handle general SQLAlchemy errors"""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    logger.error(f"Database error: {str(exc)}", extra={
        "correlation_id": correlation_id,
        "error_type": type(exc).__name__,
        "path": request.url.path
    })
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Database operation failed",
            "error_type": "database_error",
            "correlation_id": correlation_id,
            "service": "member-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unhandled exceptions"""
    correlation_id = request.headers.get("X-Correlation-ID", "unknown")
    
    logger.error(f"Unhandled exception: {str(exc)}", extra={
        "correlation_id": correlation_id,
        "error_type": type(exc).__name__,
        "path": request.url.path
    }, exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error_type": "internal_error",
            "correlation_id": correlation_id,
            "service": "member-service"
        },
        headers={"X-Correlation-ID": correlation_id}
    )


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check(db: Session = Depends(get_db)):
    """Check service health and database connectivity"""
    health_status = {
        "status": "healthy",
        "service": "member-service",
        "version": "1.0.0",
        "checks": {}
    }
    
    # Check database connectivity
    try:
        # Execute simple query
        result = db.execute(text("SELECT 1"))
        result.scalar()
        
        # Check member table
        member_count = db.query(Member).count()
        
        health_status["checks"]["database"] = {
            "status": "healthy",
            "connected": True,
            "member_count": member_count
        }
        
    except Exception as e:
        logger.error(f"Database health check failed: {str(e)}")
        health_status["status"] = "unhealthy"
        health_status["checks"]["database"] = {
            "status": "unhealthy",
            "connected": False,
            "error": str(e)
        }
        
        return JSONResponse(
            status_code=503,
            content=health_status
        )
    
    # Check memory usage
    import psutil
    process = psutil.Process()
    memory_info = process.memory_info()
    health_status["checks"]["memory"] = {
        "status": "healthy",
        "rss_mb": memory_info.rss / 1024 / 1024,
        "vms_mb": memory_info.vms / 1024 / 1024
    }
    
    # Check active requests
    health_status["checks"]["requests"] = {
        "status": "healthy",
        "active_count": len(active_requests),
        "shutting_down": shutdown_event.is_set()
    }
    
    return health_status


# Service info endpoint
@app.get("/info", tags=["Info"])
async def service_info():
    """Get service metadata and available endpoints"""
    return {
        "service": "member-service",
        "version": "1.0.0",
        "description": "Microservice for managing member records",
        "endpoints": {
            "health": "/health",
            "info": "/info",
            "docs": "/docs",
            "openapi": "/openapi.json",
            "members": "/api/v1/members"
        },
        "features": [
            "Member CRUD operations",
            "Organizational hierarchy management",
            "Skill tracking",
            "Bulk operations",
            "Advanced search and filtering",
            "Employment lifecycle management"
        ],
        "database": {
            "type": "PostgreSQL/MariaDB",
            "pool_size": settings.DB_POOL_SIZE,
            "max_overflow": settings.DB_MAX_OVERFLOW
        },
        "configuration": {
            "cors_origins": cors_origins,
            "request_timeout": os.getenv("REQUEST_TIMEOUT", "30"),
            "rate_limiting": os.getenv("RATE_LIMIT_ENABLED", "false") == "true"
        }
    }


# Include member API routes
app.include_router(
    members.router,
    prefix="/api/v1/members",
    tags=["Members"]
)


# Custom OpenAPI documentation
def custom_openapi():
    """Customize OpenAPI schema"""
    if app.openapi_schema:
        return app.openapi_schema
    
    from fastapi.openapi.utils import get_openapi
    
    openapi_schema = get_openapi(
        title="Member Service API",
        version="1.0.0",
        description="""
        ## Member Service API
        
        This microservice provides comprehensive member management capabilities for the AI-powered recruitment platform.
        
        ### Features:
        - **CRUD Operations**: Create, read, update, and delete member records
        - **Organizational Management**: Handle organizational hierarchy and department structures
        - **Skill Tracking**: Manage member skills and competencies
        - **Bulk Operations**: Support for bulk imports and updates
        - **Advanced Search**: Powerful filtering and search capabilities
        - **Employment Lifecycle**: Track employment history and status changes
        
        ### Authentication:
        Authentication is handled by the API Gateway. Include the authorization token in the request headers.
        
        ### Rate Limiting:
        API requests may be rate limited. Check response headers for rate limit information.
        """,
        routes=app.routes,
        tags=[
            {
                "name": "Members",
                "description": "Operations related to member management"
            },
            {
                "name": "Health",
                "description": "Service health monitoring"
            },
            {
                "name": "Info",
                "description": "Service information and metadata"
            }
        ]
    )
    
    # Add custom components
    openapi_schema["components"]["schemas"]["ErrorResponse"] = {
        "type": "object",
        "properties": {
            "detail": {"type": "string"},
            "status_code": {"type": "integer"},
            "correlation_id": {"type": "string"},
            "service": {"type": "string", "default": "member-service"}
        }
    }
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


if __name__ == "__main__":
    # Run with uvicorn when executed directly
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=os.getenv("RELOAD", "false").lower() == "true",
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
        access_log=os.getenv("ACCESS_LOG", "true").lower() == "true"
    )
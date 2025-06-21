import asyncio
import json
import logging
import time
import uuid
from typing import Dict, Optional, Tuple, Any, List
from urllib.parse import urlparse, urljoin
import os
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import Request, Response, HTTPException
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.datastructures import Headers, MutableHeaders
import httpx
import aiohttp

from ..utils.http_client import get_http_client
from ..config.settings import get_settings

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """Circuit breaker implementation for service health tracking"""
    
    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures: Dict[str, int] = defaultdict(int)
        self.last_failure_time: Dict[str, datetime] = {}
        self.circuit_open: Dict[str, bool] = defaultdict(bool)
    
    def record_success(self, service: str):
        """Record successful request"""
        self.failures[service] = 0
        self.circuit_open[service] = False
        if service in self.last_failure_time:
            del self.last_failure_time[service]
    
    def record_failure(self, service: str):
        """Record failed request"""
        self.failures[service] += 1
        self.last_failure_time[service] = datetime.utcnow()
        
        if self.failures[service] >= self.failure_threshold:
            self.circuit_open[service] = True
            logger.warning(f"Circuit breaker opened for service: {service}")
    
    def is_open(self, service: str) -> bool:
        """Check if circuit is open for service"""
        if not self.circuit_open[service]:
            return False
        
        # Check if recovery timeout has passed
        if service in self.last_failure_time:
            time_since_failure = datetime.utcnow() - self.last_failure_time[service]
            if time_since_failure.total_seconds() > self.recovery_timeout:
                logger.info(f"Circuit breaker recovery timeout reached for service: {service}")
                self.circuit_open[service] = False
                self.failures[service] = 0
                return False
        
        return True


class LoadBalancer:
    """Simple round-robin load balancer for multiple service instances"""
    
    def __init__(self):
        self.current_index: Dict[str, int] = defaultdict(int)
        self.healthy_instances: Dict[str, List[str]] = defaultdict(list)
    
    def get_next_instance(self, service: str, instances: List[str]) -> Optional[str]:
        """Get next healthy instance using round-robin"""
        healthy = [inst for inst in instances if inst in self.healthy_instances.get(service, instances)]
        if not healthy:
            healthy = instances  # Fallback to all instances if none marked healthy
        
        if not healthy:
            return None
        
        index = self.current_index[service] % len(healthy)
        self.current_index[service] = (index + 1) % len(healthy)
        return healthy[index]
    
    def mark_healthy(self, service: str, instance: str):
        """Mark instance as healthy"""
        if service not in self.healthy_instances:
            self.healthy_instances[service] = []
        if instance not in self.healthy_instances[service]:
            self.healthy_instances[service].append(instance)
    
    def mark_unhealthy(self, service: str, instance: str):
        """Mark instance as unhealthy"""
        if service in self.healthy_instances and instance in self.healthy_instances[service]:
            self.healthy_instances[service].remove(instance)


class RateLimiter:
    """Simple rate limiter implementation"""
    
    def __init__(self, requests_per_minute: int = 60):
        self.requests_per_minute = requests_per_minute
        self.requests: Dict[str, List[datetime]] = defaultdict(list)
    
    def is_allowed(self, client_id: str) -> Tuple[bool, Optional[int]]:
        """Check if request is allowed for client"""
        now = datetime.utcnow()
        minute_ago = now - timedelta(minutes=1)
        
        # Clean old requests
        self.requests[client_id] = [
            req_time for req_time in self.requests[client_id]
            if req_time > minute_ago
        ]
        
        if len(self.requests[client_id]) >= self.requests_per_minute:
            # Calculate retry after in seconds
            oldest_request = min(self.requests[client_id])
            retry_after = int((oldest_request + timedelta(minutes=1) - now).total_seconds())
            return False, max(1, retry_after)
        
        self.requests[client_id].append(now)
        return True, None


class ProxyMiddleware(BaseHTTPMiddleware):
    """HTTP proxy middleware for routing requests to backend microservices"""
    
    def __init__(self, app, **kwargs):
        super().__init__(app)
        self.settings = get_settings()
        self.circuit_breaker = CircuitBreaker(
            failure_threshold=int(os.getenv("CIRCUIT_BREAKER_FAILURE_THRESHOLD", "5")),
            recovery_timeout=int(os.getenv("CIRCUIT_BREAKER_RECOVERY_TIMEOUT", "60"))
        )
        self.load_balancer = LoadBalancer()
        self.rate_limiter = RateLimiter(
            requests_per_minute=int(os.getenv("RATE_LIMIT_REQUESTS_PER_MINUTE", "60"))
        )
        self.http_client = get_http_client()
        
        # Service routing configuration
        self.service_routes = {
            "/api/v1/feedback": os.getenv("FEEDBACK_SERVICE_URL", "http://feedback-service:8001"),
            "/api/v1/members": os.getenv("MEMBER_SERVICE_URL", "http://member-service:8002")
        }
        
        # Configuration
        self.proxy_timeout = float(os.getenv("PROXY_TIMEOUT", "30"))
        self.retry_count = int(os.getenv("PROXY_RETRY_COUNT", "3"))
        self.retry_delay = float(os.getenv("PROXY_RETRY_DELAY", "1"))
        self.max_request_size = int(os.getenv("MAX_REQUEST_SIZE", "10485760"))  # 10MB default
        
        # Headers to strip from client requests
        self.strip_headers = {
            "host", "connection", "keep-alive", "transfer-encoding",
            "upgrade", "proxy-authenticate", "proxy-authorization",
            "te", "trailer"
        }
    
    async def dispatch(self, request: Request, call_next):
        """Main middleware dispatch method"""
        start_time = time.time()
        correlation_id = str(uuid.uuid4())
        
        # Add correlation ID to request state
        request.state.correlation_id = correlation_id
        
        # Check if this is a health check request
        if request.url.path in ["/health", "/healthz", "/api/health"]:
            return await call_next(request)
        
        # Rate limiting
        client_id = self._get_client_id(request)
        allowed, retry_after = self.rate_limiter.is_allowed(client_id)
        if not allowed:
            logger.warning(f"Rate limit exceeded for client: {client_id}")
            return Response(
                content=json.dumps({
                    "error": "Rate limit exceeded",
                    "message": "Too many requests",
                    "retry_after": retry_after
                }),
                status_code=429,
                headers={"Retry-After": str(retry_after), "X-Correlation-ID": correlation_id},
                media_type="application/json"
            )
        
        # Determine target service
        service_name, service_url = self._get_target_service(request.url.path)
        if not service_url:
            # Not a proxy route, pass to next middleware
            return await call_next(request)
        
        # Check circuit breaker
        if self.circuit_breaker.is_open(service_name):
            logger.error(f"Circuit breaker open for service: {service_name}")
            return Response(
                content=json.dumps({
                    "error": "Service temporarily unavailable",
                    "message": f"The {service_name} is currently unavailable. Please try again later.",
                    "correlation_id": correlation_id
                }),
                status_code=503,
                headers={"X-Correlation-ID": correlation_id, "Retry-After": "60"},
                media_type="application/json"
            )
        
        # Check request size
        if request.headers.get("content-length"):
            content_length = int(request.headers.get("content-length", 0))
            if content_length > self.max_request_size:
                return Response(
                    content=json.dumps({
                        "error": "Request too large",
                        "message": f"Request size {content_length} exceeds maximum allowed size {self.max_request_size}",
                        "correlation_id": correlation_id
                    }),
                    status_code=413,
                    headers={"X-Correlation-ID": correlation_id},
                    media_type="application/json"
                )
        
        # Forward request with retries
        for attempt in range(self.retry_count):
            try:
                response = await self._forward_request(
                    request, service_name, service_url, correlation_id
                )
                
                # Record success
                self.circuit_breaker.record_success(service_name)
                
                # Log request completion
                duration = time.time() - start_time
                logger.info(
                    f"Proxy request completed: {request.method} {request.url.path} -> "
                    f"{service_name} - Status: {response.status_code} - "
                    f"Duration: {duration:.3f}s - Correlation ID: {correlation_id}"
                )
                
                return response
                
            except asyncio.TimeoutError:
                logger.error(
                    f"Timeout forwarding request to {service_name} "
                    f"(attempt {attempt + 1}/{self.retry_count}) - "
                    f"Correlation ID: {correlation_id}"
                )
                if attempt < self.retry_count - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    self.circuit_breaker.record_failure(service_name)
                    return Response(
                        content=json.dumps({
                            "error": "Gateway timeout",
                            "message": f"Request to {service_name} timed out after {self.proxy_timeout} seconds",
                            "correlation_id": correlation_id
                        }),
                        status_code=504,
                        headers={"X-Correlation-ID": correlation_id},
                        media_type="application/json"
                    )
            
            except Exception as e:
                logger.error(
                    f"Error forwarding request to {service_name} "
                    f"(attempt {attempt + 1}/{self.retry_count}): {str(e)} - "
                    f"Correlation ID: {correlation_id}"
                )
                if attempt < self.retry_count - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    self.circuit_breaker.record_failure(service_name)
                    return Response(
                        content=json.dumps({
                            "error": "Bad gateway",
                            "message": f"Error communicating with {service_name}",
                            "details": str(e),
                            "correlation_id": correlation_id
                        }),
                        status_code=502,
                        headers={"X-Correlation-ID": correlation_id},
                        media_type="application/json"
                    )
    
    async def _forward_request(
        self, request: Request, service_name: str, service_url: str, correlation_id: str
    ) -> Response:
        """Forward request to backend service"""
        # Build target URL
        target_url = urljoin(service_url, request.url.path)
        if request.url.query:
            target_url += f"?{request.url.query}"
        
        # Prepare headers
        headers = await self._prepare_headers(request, correlation_id)
        
        # Read request body
        body = await request.body()
        
        # Make request to backend service
        async with self.http_client as client:
            backend_response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body if body else None,
                timeout=self.proxy_timeout,
                follow_redirects=False
            )
        
        # Handle streaming responses
        if self._is_streaming_response(backend_response):
            return await self._create_streaming_response(backend_response, correlation_id)
        
        # Handle regular responses
        response_body = await backend_response.aread()
        
        # Prepare response headers
        response_headers = self._prepare_response_headers(backend_response.headers, correlation_id)
        
        return Response(
            content=response_body,
            status_code=backend_response.status_code,
            headers=response_headers,
            media_type=backend_response.headers.get("content-type", "application/json")
        )
    
    async def _prepare_headers(self, request: Request, correlation_id: str) -> Dict[str, str]:
        """Prepare headers for backend request"""
        headers = {}
        
        for key, value in request.headers.items():
            if key.lower() not in self.strip_headers:
                headers[key] = value
        
        # Add/update special headers
        headers["X-Correlation-ID"] = correlation_id
        headers["X-Forwarded-For"] = self._get_client_ip(request)
        headers["X-Forwarded-Proto"] = request.url.scheme
        headers["X-Forwarded-Host"] = request.headers.get("host", "")
        headers["X-Real-IP"] = self._get_client_ip(request)
        
        return headers
    
    def _prepare_response_headers(self, backend_headers: Headers, correlation_id: str) -> Dict[str, str]:
        """Prepare headers for client response"""
        headers = {}
        
        for key, value in backend_headers.items():
            if key.lower() not in self.strip_headers:
                headers[key] = value
        
        # Ensure correlation ID is in response
        headers["X-Correlation-ID"] = correlation_id
        
        return headers
    
    def _get_target_service(self, path: str) -> Tuple[Optional[str], Optional[str]]:
        """Determine target service based on request path"""
        for route_prefix, service_url in self.service_routes.items():
            if path.startswith(route_prefix):
                service_name = route_prefix.split("/")[-1]  # Extract service name
                return service_name, service_url
        return None, None
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier for rate limiting"""
        # Try to get from API key header
        api_key = request.headers.get("X-API-Key")
        if api_key:
            return f"api_key:{api_key}"
        
        # Try to get from authorization header
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            # TODO: Extract user ID from JWT token
            return f"bearer:{auth_header[7:20]}"  # Use first part of token
        
        # Fall back to IP address
        return f"ip:{self._get_client_ip(request)}"
    
    def _get_client_ip(self, request: Request) -> str:
        """Get client IP address"""
        # Check X-Forwarded-For header
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Get first IP in the chain
            return forwarded_for.split(",")[0].strip()
        
        # Check X-Real-IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip
        
        # Fall back to request client
        if request.client:
            return request.client.host
        
        return "unknown"
    
    def _is_streaming_response(self, response: httpx.Response) -> bool:
        """Check if response should be streamed"""
        # Check for streaming content types
        content_type = response.headers.get("content-type", "").lower()
        streaming_types = [
            "text/event-stream",
            "application/octet-stream",
            "multipart/x-mixed-replace"
        ]
        
        for stream_type in streaming_types:
            if stream_type in content_type:
                return True
        
        # Check for large content
        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > 1048576:  # 1MB
            return True
        
        # Check for chunked transfer encoding
        transfer_encoding = response.headers.get("transfer-encoding", "").lower()
        if "chunked" in transfer_encoding:
            return True
        
        return False
    
    async def _create_streaming_response(
        self, backend_response: httpx.Response, correlation_id: str
    ) -> StreamingResponse:
        """Create streaming response from backend response"""
        async def stream_generator():
            async for chunk in backend_response.aiter_bytes(chunk_size=8192):
                yield chunk
        
        headers = self._prepare_response_headers(backend_response.headers, correlation_id)
        
        return StreamingResponse(
            stream_generator(),
            status_code=backend_response.status_code,
            headers=headers,
            media_type=backend_response.headers.get("content-type", "application/octet-stream")
        )
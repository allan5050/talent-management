import asyncio
import json
import logging
import ssl
import time
import uuid
from typing import Any, Dict, Optional, Union, Tuple, List
from urllib.parse import urljoin, urlparse
from enum import Enum
from dataclasses import dataclass
from datetime import datetime, timedelta

import aiohttp
import httpx
import certifi
from aiohttp import ClientSession, ClientTimeout, ClientError, ServerTimeoutError
from aiohttp.client_exceptions import ClientConnectorError, ClientResponseError
from fastapi import Request, Response

from app.config.settings import settings

# Configure logging
logger = logging.getLogger(__name__)


class HTTPMethod(Enum):
    """HTTP method enumeration"""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"


class ErrorCategory(Enum):
    """Error category for retry logic"""
    RETRYABLE = "retryable"
    NON_RETRYABLE = "non_retryable"


@dataclass
class ServiceEndpoint:
    """Service endpoint configuration"""
    url: str
    weight: int = 1
    healthy: bool = True
    last_check: Optional[datetime] = None
    failure_count: int = 0


@dataclass
class CircuitBreakerState:
    """Circuit breaker state tracking"""
    is_open: bool = False
    failure_count: int = 0
    last_failure_time: Optional[datetime] = None
    last_success_time: Optional[datetime] = None


class HTTPClientError(Exception):
    """Base exception for HTTP client errors"""
    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class ServiceUnavailableError(HTTPClientError):
    """Exception raised when service is unavailable"""
    pass


class TimeoutError(HTTPClientError):
    """Exception raised when request times out"""
    pass


class HTTPClient:
    """Comprehensive HTTP client for service-to-service communication"""
    
    def __init__(self):
        self.session: Optional[ClientSession] = None
        self.httpx_client: Optional[httpx.AsyncClient] = None
        self.connection_pool_size = int(settings.get("HTTP_CLIENT_POOL_SIZE", 100))
        self.timeout = float(settings.get("HTTP_CLIENT_TIMEOUT", 30))
        self.retry_count = int(settings.get("HTTP_CLIENT_RETRY_COUNT", 3))
        self.retry_delay = float(settings.get("HTTP_CLIENT_RETRY_DELAY", 1))
        self.max_request_size = int(settings.get("MAX_REQUEST_SIZE", 10 * 1024 * 1024))  # 10MB default
        self.keep_alive_timeout = int(settings.get("KEEP_ALIVE_TIMEOUT", 30))
        
        # Circuit breaker configuration
        self.circuit_breaker_threshold = int(settings.get("CIRCUIT_BREAKER_THRESHOLD", 5))
        self.circuit_breaker_timeout = int(settings.get("CIRCUIT_BREAKER_TIMEOUT", 60))
        self.circuit_breakers: Dict[str, CircuitBreakerState] = {}
        
        # Service endpoints for load balancing
        self.service_endpoints: Dict[str, List[ServiceEndpoint]] = {}
        self.endpoint_index: Dict[str, int] = {}
        
        # Request/response middleware hooks
        self.request_hooks: List[callable] = []
        self.response_hooks: List[callable] = []
        
        # Cache for GET requests
        self.cache: Dict[str, Tuple[Any, datetime]] = {}
        self.cache_ttl = int(settings.get("HTTP_CACHE_TTL", 300))  # 5 minutes default
        
        # Metrics tracking
        self.metrics = {
            "request_count": 0,
            "error_count": 0,
            "total_response_time": 0,
            "connection_pool_stats": {}
        }
        
        # SSL configuration
        self.ssl_context = self._create_ssl_context()
        
    def _create_ssl_context(self) -> ssl.SSLContext:
        """Create SSL context with proper certificate validation"""
        context = ssl.create_default_context(cafile=certifi.where())
        
        # Allow disabling SSL verification in development
        if settings.get("DISABLE_SSL_VERIFICATION", "false").lower() == "true":
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            logger.warning("SSL verification disabled - use only in development!")
        
        return context
    
    async def initialize(self):
        """Initialize HTTP client sessions"""
        if not self.session:
            connector = aiohttp.TCPConnector(
                limit=self.connection_pool_size,
                limit_per_host=30,
                ttl_dns_cache=300,
                ssl=self.ssl_context,
                keepalive_timeout=self.keep_alive_timeout
            )
            
            timeout = ClientTimeout(
                total=self.timeout,
                connect=5,
                sock_read=self.timeout
            )
            
            self.session = ClientSession(
                connector=connector,
                timeout=timeout,
                headers={
                    "User-Agent": "TalentManagement-Gateway/1.0"
                }
            )
            
        if not self.httpx_client:
            self.httpx_client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(
                    max_connections=self.connection_pool_size,
                    max_keepalive_connections=30
                ),
                verify=self.ssl_context,
                headers={
                    "User-Agent": "TalentManagement-Gateway/1.0"
                }
            )
            
        logger.info("HTTP client initialized with pool size: %d", self.connection_pool_size)
    
    async def close(self):
        """Close HTTP client sessions and cleanup resources"""
        if self.session:
            await self.session.close()
            self.session = None
            
        if self.httpx_client:
            await self.httpx_client.aclose()
            self.httpx_client = None
            
        logger.info("HTTP client closed")
    
    def add_request_hook(self, hook: callable):
        """Add request middleware hook"""
        self.request_hooks.append(hook)
    
    def add_response_hook(self, hook: callable):
        """Add response middleware hook"""
        self.response_hooks.append(hook)
    
    def register_service_endpoints(self, service_name: str, endpoints: List[str], weights: Optional[List[int]] = None):
        """Register multiple endpoints for a service for load balancing"""
        if weights and len(weights) != len(endpoints):
            raise ValueError("Number of weights must match number of endpoints")
            
        self.service_endpoints[service_name] = [
            ServiceEndpoint(url=endpoint, weight=weights[i] if weights else 1)
            for i, endpoint in enumerate(endpoints)
        ]
        self.endpoint_index[service_name] = 0
        
        logger.info("Registered %d endpoints for service: %s", len(endpoints), service_name)
    
    def _get_next_endpoint(self, service_name: str) -> Optional[str]:
        """Get next available endpoint using weighted round-robin"""
        if service_name not in self.service_endpoints:
            return None
            
        endpoints = self.service_endpoints[service_name]
        healthy_endpoints = [ep for ep in endpoints if ep.healthy]
        
        if not healthy_endpoints:
            logger.error("No healthy endpoints available for service: %s", service_name)
            return None
            
        # Weighted round-robin selection
        total_weight = sum(ep.weight for ep in healthy_endpoints)
        if service_name not in self.endpoint_index:
            self.endpoint_index[service_name] = 0
            
        current_index = self.endpoint_index[service_name]
        selected_endpoint = healthy_endpoints[current_index % len(healthy_endpoints)]
        
        self.endpoint_index[service_name] = (current_index + 1) % len(healthy_endpoints)
        
        return selected_endpoint.url
    
    def _check_circuit_breaker(self, service_url: str) -> bool:
        """Check if circuit breaker is open for a service"""
        parsed_url = urlparse(service_url)
        service_key = f"{parsed_url.scheme}://{parsed_url.netloc}"
        
        if service_key not in self.circuit_breakers:
            self.circuit_breakers[service_key] = CircuitBreakerState()
            
        breaker = self.circuit_breakers[service_key]
        
        if breaker.is_open:
            if breaker.last_failure_time:
                time_since_failure = (datetime.now() - breaker.last_failure_time).total_seconds()
                if time_since_failure > self.circuit_breaker_timeout:
                    # Try to close the circuit breaker
                    breaker.is_open = False
                    breaker.failure_count = 0
                    logger.info("Circuit breaker closed for service: %s", service_key)
                else:
                    return False
                    
        return True
    
    def _record_failure(self, service_url: str):
        """Record a failure for circuit breaker tracking"""
        parsed_url = urlparse(service_url)
        service_key = f"{parsed_url.scheme}://{parsed_url.netloc}"
        
        if service_key not in self.circuit_breakers:
            self.circuit_breakers[service_key] = CircuitBreakerState()
            
        breaker = self.circuit_breakers[service_key]
        breaker.failure_count += 1
        breaker.last_failure_time = datetime.now()
        
        if breaker.failure_count >= self.circuit_breaker_threshold:
            breaker.is_open = True
            logger.warning("Circuit breaker opened for service: %s (failures: %d)", 
                         service_key, breaker.failure_count)
    
    def _record_success(self, service_url: str):
        """Record a successful request"""
        parsed_url = urlparse(service_url)
        service_key = f"{parsed_url.scheme}://{parsed_url.netloc}"
        
        if service_key in self.circuit_breakers:
            breaker = self.circuit_breakers[service_key]
            breaker.last_success_time = datetime.now()
            if breaker.failure_count > 0:
                breaker.failure_count = max(0, breaker.failure_count - 1)
    
    def _classify_error(self, error: Exception, status_code: Optional[int] = None) -> ErrorCategory:
        """Classify error as retryable or non-retryable"""
        # Network and connection errors are retryable
        if isinstance(error, (ClientConnectorError, ServerTimeoutError, asyncio.TimeoutError)):
            return ErrorCategory.RETRYABLE
            
        # HTTP status code based classification
        if status_code:
            if status_code >= 500:  # Server errors
                return ErrorCategory.RETRYABLE
            elif status_code == 429:  # Rate limiting
                return ErrorCategory.RETRYABLE
            elif status_code == 408:  # Request timeout
                return ErrorCategory.RETRYABLE
            elif 400 <= status_code < 500:  # Client errors
                return ErrorCategory.NON_RETRYABLE
                
        return ErrorCategory.NON_RETRYABLE
    
    def _get_cache_key(self, method: str, url: str, params: Optional[Dict] = None) -> str:
        """Generate cache key for request"""
        param_str = json.dumps(sorted(params.items())) if params else ""
        return f"{method}:{url}:{param_str}"
    
    def _get_from_cache(self, cache_key: str) -> Optional[Any]:
        """Get response from cache if valid"""
        if cache_key in self.cache:
            response, timestamp = self.cache[cache_key]
            if (datetime.now() - timestamp).total_seconds() < self.cache_ttl:
                return response
            else:
                del self.cache[cache_key]
        return None
    
    def _add_to_cache(self, cache_key: str, response: Any):
        """Add response to cache"""
        self.cache[cache_key] = (response, datetime.now())
        
        # Cleanup old cache entries
        current_time = datetime.now()
        expired_keys = [
            key for key, (_, timestamp) in self.cache.items()
            if (current_time - timestamp).total_seconds() > self.cache_ttl
        ]
        for key in expired_keys:
            del self.cache[key]
    
    async def _execute_request_hooks(self, method: str, url: str, headers: Dict, **kwargs):
        """Execute request middleware hooks"""
        for hook in self.request_hooks:
            try:
                await hook(method, url, headers, **kwargs)
            except Exception as e:
                logger.error("Request hook error: %s", str(e))
    
    async def _execute_response_hooks(self, response: Any, elapsed_time: float):
        """Execute response middleware hooks"""
        for hook in self.response_hooks:
            try:
                await hook(response, elapsed_time)
            except Exception as e:
                logger.error("Response hook error: %s", str(e))
    
    async def request(
        self,
        method: Union[str, HTTPMethod],
        url: str,
        headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
        json_data: Optional[Dict[str, Any]] = None,
        data: Optional[Union[str, bytes, Dict]] = None,
        timeout: Optional[float] = None,
        allow_redirects: bool = True,
        stream: bool = False,
        correlation_id: Optional[str] = None,
        use_cache: bool = True,
        **kwargs
    ) -> Dict[str, Any]:
        """Execute HTTP request with retry logic and error handling"""
        if not self.session:
            await self.initialize()
            
        # Generate correlation ID if not provided
        if not correlation_id:
            correlation_id = str(uuid.uuid4())
            
        # Prepare headers
        request_headers = {
            "X-Correlation-ID": correlation_id,
            "X-Request-ID": str(uuid.uuid4()),
            **(headers or {})
        }
        
        # Check circuit breaker
        if not self._check_circuit_breaker(url):
            raise ServiceUnavailableError(f"Circuit breaker open for service: {url}")
        
        # Check cache for GET requests
        if method == HTTPMethod.GET.value and use_cache:
            cache_key = self._get_cache_key(method, url, params)
            cached_response = self._get_from_cache(cache_key)
            if cached_response:
                logger.debug("Cache hit for: %s", url)
                return cached_response
        
        # Execute request hooks
        await self._execute_request_hooks(method, url, request_headers, **kwargs)
        
        # Retry logic
        last_error = None
        for attempt in range(self.retry_count):
            try:
                start_time = time.time()
                
                # Log request
                logger.info("HTTP %s %s (attempt %d/%d, correlation_id: %s)",
                          method, url, attempt + 1, self.retry_count, correlation_id)
                
                # Execute request
                async with self.session.request(
                    method=method,
                    url=url,
                    headers=request_headers,
                    params=params,
                    json=json_data,
                    data=data,
                    timeout=ClientTimeout(total=timeout or self.timeout),
                    allow_redirects=allow_redirects,
                    **kwargs
                ) as response:
                    elapsed_time = time.time() - start_time
                    
                    # Update metrics
                    self.metrics["request_count"] += 1
                    self.metrics["total_response_time"] += elapsed_time
                    
                    # Log response
                    logger.info("HTTP %s %s - Status: %d, Time: %.3fs",
                              method, url, response.status, elapsed_time)
                    
                    # Handle rate limiting
                    if response.status == 429:
                        retry_after = response.headers.get("Retry-After", self.retry_delay)
                        logger.warning("Rate limited, retry after %s seconds", retry_after)
                        await asyncio.sleep(float(retry_after))
                        continue
                    
                    # Check for errors
                    if response.status >= 400:
                        error_body = await response.text()
                        error_category = self._classify_error(None, response.status)
                        
                        if error_category == ErrorCategory.RETRYABLE and attempt < self.retry_count - 1:
                            logger.warning("Retryable error %d, retrying...", response.status)
                            await asyncio.sleep(self.retry_delay * (2 ** attempt))  # Exponential backoff
                            continue
                        else:
                            self._record_failure(url)
                            raise HTTPClientError(
                                f"HTTP {response.status} error",
                                status_code=response.status,
                                response_body=error_body
                            )
                    
                    # Parse response
                    response_data = {
                        "status_code": response.status,
                        "headers": dict(response.headers),
                        "correlation_id": correlation_id
                    }
                    
                    if stream:
                        response_data["content"] = response.content
                    else:
                        content_type = response.headers.get("Content-Type", "")
                        if "application/json" in content_type:
                            try:
                                response_data["json"] = await response.json()
                            except json.JSONDecodeError:
                                response_data["text"] = await response.text()
                        elif "text/" in content_type:
                            response_data["text"] = await response.text()
                        else:
                            response_data["content"] = await response.read()
                    
                    # Execute response hooks
                    await self._execute_response_hooks(response_data, elapsed_time)
                    
                    # Record success
                    self._record_success(url)
                    
                    # Cache successful GET responses
                    if method == HTTPMethod.GET.value and use_cache and response.status == 200:
                        cache_key = self._get_cache_key(method, url, params)
                        self._add_to_cache(cache_key, response_data)
                    
                    return response_data
                    
            except (ClientError, asyncio.TimeoutError) as e:
                last_error = e
                elapsed_time = time.time() - start_time
                self.metrics["error_count"] += 1
                
                error_category = self._classify_error(e)
                
                if isinstance(e, (ServerTimeoutError, asyncio.TimeoutError)):
                    logger.error("Request timeout after %.3fs: %s", elapsed_time, url)
                    if attempt < self.retry_count - 1 and error_category == ErrorCategory.RETRYABLE:
                        await asyncio.sleep(self.retry_delay * (2 ** attempt))
                        continue
                    else:
                        self._record_failure(url)
                        raise TimeoutError(f"Request timeout after {elapsed_time:.3f}s")
                
                logger.error("HTTP request error: %s", str(e))
                
                if attempt < self.retry_count - 1 and error_category == ErrorCategory.RETRYABLE:
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    continue
                else:
                    self._record_failure(url)
                    raise HTTPClientError(f"HTTP request failed: {str(e)}")
        
        # All retries exhausted
        self._record_failure(url)
        if last_error:
            raise HTTPClientError(f"All retry attempts failed: {str(last_error)}")
        else:
            raise HTTPClientError("All retry attempts failed")
    
    async def get(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute GET request"""
        return await self.request(HTTPMethod.GET.value, url, **kwargs)
    
    async def post(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute POST request"""
        return await self.request(HTTPMethod.POST.value, url, **kwargs)
    
    async def put(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute PUT request"""
        return await self.request(HTTPMethod.PUT.value, url, **kwargs)
    
    async def patch(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute PATCH request"""
        return await self.request(HTTPMethod.PATCH.value, url, **kwargs)
    
    async def delete(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute DELETE request"""
        return await self.request(HTTPMethod.DELETE.value, url, **kwargs)
    
    async def head(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute HEAD request"""
        return await self.request(HTTPMethod.HEAD.value, url, **kwargs)
    
    async def options(self, url: str, **kwargs) -> Dict[str, Any]:
        """Execute OPTIONS request"""
        return await self.request(HTTPMethod.OPTIONS.value, url, **kwargs)
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get client metrics"""
        avg_response_time = (
            self.metrics["total_response_time"] / self.metrics["request_count"]
            if self.metrics["request_count"] > 0 else 0
        )
        
        # Get connection pool stats if available
        if self.session and self.session.connector:
            connector_stats = {
                "limit": self.session.connector.limit,
                "limit_per_host": self.session.connector.limit_per_host,
                "connections": len(self.session.connector._conns) if hasattr(self.session.connector, '_conns') else 0
            }
        else:
            connector_stats = {}
        
        return {
            "request_count": self.metrics["request_count"],
            "error_count": self.metrics["error_count"],
            "error_rate": (
                self.metrics["error_count"] / self.metrics["request_count"]
                if self.metrics["request_count"] > 0 else 0
            ),
            "average_response_time": avg_response_time,
            "connection_pool": connector_stats,
            "circuit_breakers": {
                service: {
                    "is_open": state.is_open,
                    "failure_count": state.failure_count,
                    "last_failure": state.last_failure_time.isoformat() if state.last_failure_time else None,
                    "last_success": state.last_success_time.isoformat() if state.last_success_time else None
                }
                for service, state in self.circuit_breakers.items()
            },
            "cache_size": len(self.cache)
        }
    
    async def health_check(self, service_url: str, endpoint: str = "/health") -> bool:
        """Perform health check on a service"""
        try:
            full_url = urljoin(service_url, endpoint)
            response = await self.get(full_url, timeout=5, use_cache=False)
            return response["status_code"] == 200
        except Exception as e:
            logger.error("Health check failed for %s: %s", service_url, str(e))
            return False


# Singleton instance
_http_client: Optional[HTTPClient] = None


async def create_http_client() -> HTTPClient:
    """Create and initialize HTTP client singleton"""
    global _http_client
    if _http_client is None:
        _http_client = HTTPClient()
        await _http_client.initialize()
    return _http_client


async def close_http_client():
    """Close HTTP client singleton"""
    global _http_client
    if _http_client:
        await _http_client.close()
        _http_client = None


def get_http_client() -> HTTPClient:
    """Get HTTP client singleton (must be initialized first)"""
    if _http_client is None:
        raise RuntimeError("HTTP client not initialized. Call create_http_client() first.")
    return _http_client


# Export main components
__all__ = [
    "HTTPClient",
    "HTTPClientError",
    "ServiceUnavailableError",
    "TimeoutError",
    "create_http_client",
    "close_http_client",
    "get_http_client",
    "HTTPMethod",
    "ErrorCategory"
]


class-gateway_http_client:
    async def forward_request(self, request: Request, target_url: str) -> Response:
        async with httpx.AsyncClient() as client:
            # Build the full target URL
            url = f"{target_url}{request.url.path}"
            
            # Copy headers, but update the host to the target service's host
            headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
            headers['host'] = httpx.URL(target_url).host
            
            # Await the body of the incoming request
            body = await request.body()
            
            # Make the request to the target service
            rp = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                params=request.query_params,
                content=body,
                timeout=30.0  # Add a timeout
            )
            
            # Create a new response from the target service's response
            return Response(
                content=rp.content,
                status_code=rp.status_code,
                headers=dict(rp.headers)
            )

# Instantiate the client for use in the gateway
gateway_http_client = GatewayHttpClient()
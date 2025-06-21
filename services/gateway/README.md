# Gateway Service

This service acts as the single entry point for all incoming API requests. It is responsible for routing requests to the appropriate downstream microservice (`feedback_service` or `member_service`).

## Responsibilities

-   Expose the unified API to the public.
-   Proxy requests to the correct internal service.
-   Handle top-level concerns like rate limiting or authentication in the future. 
import httpx
from fastapi import Request, Response

class GatewayHTTPClient:
    async def forward_request(self, request: Request, target_url: str) -> Response:
        async with httpx.AsyncClient() as client:
            # Construct the target URL
            url = f"{target_url}{request.url.path}"
            
            # Prepare the request data
            headers = dict(request.headers)
            # Host header should be for the target service
            headers['host'] = httpx.URL(target_url).host.decode('utf-8')
            
            req = client.build_request(
                method=request.method,
                url=url,
                headers=headers,
                params=request.query_params,
                content=await request.body(),
            )
            
            # Send the request and get the response
            resp = await client.send(req, stream=True)
            
            # Create a FastAPI response from the downstream service's response
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=dict(resp.headers),
            )

# Create a single instance to be used by the application
gateway_http_client = GatewayHTTPClient()
import httpx
from fastapi import Request, Response
import logging

class GatewayHTTPClient:
    async def forward_request(self, request: Request, target_url: str) -> Response:
        try:
            async with httpx.AsyncClient() as client:
                # The target_url is now the complete URL for the downstream service
                url = target_url
                
                # Prepare the request data
                headers = dict(request.headers)
                # Host header should be for the target service
                headers['host'] = httpx.URL(target_url).host
                
                req = client.build_request(
                    method=request.method,
                    url=url,
                    headers=headers,
                    params=request.query_params,
                    content=await request.body(),
                )
                
                # Send the request and get the response
                resp = await client.send(req, stream=False)
                
                # Create a FastAPI response from the downstream service's response
                return Response(
                    content=resp.content,
                    status_code=resp.status_code,
                    headers=dict(resp.headers),
                )
        except Exception as e:
            logging.exception(f"Error proxying request to {target_url}: {e}")
            return Response(
                content=f"Bad Gateway: {str(e)}",
                status_code=502,
                media_type="text/plain"
            )

# Create a single instance to be used by the application
gateway_http_client = GatewayHTTPClient()
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette import status


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": {
                "message": "Something went wrong. Please try again or check the server logs.",
                "request_id": request_id,
            }
        },
    )

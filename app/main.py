import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import (
    auth,
    backups,
    clients,
    dashboard,
    dropdowns,
    health,
    invoices,
    labor,
    ledger,
    projects,
    quotes,
    receipts,
    reports,
    settings,
    setup,
    terms,
)
from app.core.config import get_settings
from app.core.errors import generic_exception_handler
from app.db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("forged_systems_tracking")
settings_obj = get_settings()

app = FastAPI(title=settings_obj.app_name, version="0.8.12")


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("Forged Systems Tracking started")


app.add_exception_handler(Exception, generic_exception_handler)
app.include_router(health.router)
app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(dropdowns.router)
app.include_router(dropdowns.admin_router)
app.include_router(clients.router)
app.include_router(projects.router)
app.include_router(ledger.router)
app.include_router(quotes.router)
app.include_router(invoices.router)
app.include_router(labor.router)
app.include_router(receipts.router)
app.include_router(reports.router)
app.include_router(backups.router)
app.include_router(settings.router)
app.include_router(terms.router)

static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
def root() -> FileResponse:
    return FileResponse(static_dir / "index.html")




@app.get("/service-worker.js", include_in_schema=False)
def service_worker() -> FileResponse:
    return FileResponse(static_dir / "service-worker.js", media_type="application/javascript")


@app.get("/app")
def app_shell() -> FileResponse:
    return FileResponse(static_dir / "index.html")

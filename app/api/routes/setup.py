import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from sqlmodel import Session, func, select

from app.core.config import get_settings
from app.core.security import hash_password, new_token, utc_expires, utc_now
from app.db import engine, get_session
from app.models import SessionToken, User
from app.schemas.common import SetupAccountRequest
from app.services.backups import restore_backup

router = APIRouter(prefix="/api/setup", tags=["setup"])
settings = get_settings()


def _user_count() -> int:
    with Session(engine) as session:
        return int(session.exec(select(func.count(User.id))).one() or 0)


def _ensure_initial_setup_allowed() -> None:
    if _user_count() > 0:
        raise HTTPException(status_code=409, detail="Initial setup is already complete")


@router.get("/status", response_model=dict)
def setup_status() -> dict[str, bool | int]:
    count = _user_count()
    return {"needs_setup": count == 0, "user_count": count}


@router.post("/account", response_model=dict)
def create_first_account(payload: SetupAccountRequest, response: Response) -> dict[str, str]:
    _ensure_initial_setup_allowed()
    email = payload.email.lower().strip()
    with Session(engine) as session:
        user = User(
            email=email,
            password_hash=hash_password(payload.password),
            full_name=payload.full_name.strip() or "Administrator",
            is_admin=True,
            created_at=utc_now(),
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        token = new_token()
        days = settings.session_days
        session.add(SessionToken(token=token, user_id=user.id or 0, created_at=utc_now(), expires_at=utc_expires(days)))
        session.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        max_age=days * 24 * 60 * 60,
    )
    return {"message": "Admin account created"}


@router.post("/restore", response_model=dict)
async def restore_initial_backup(file: UploadFile = File(...)) -> dict:
    _ensure_initial_setup_allowed()
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a Forged Systems Tracking .zip backup file")
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = settings.temp_dir / f"initial-restore-{Path(file.filename).name}"
    with temp_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    try:
        manifest, pre_restore, restored_counts = restore_backup(temp_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)
    return {
        "message": "Restore completed",
        "manifest": manifest,
        "pre_restore_backup": pre_restore.name,
        "restored_counts": restored_counts,
        "needs_setup": _user_count() == 0,
    }

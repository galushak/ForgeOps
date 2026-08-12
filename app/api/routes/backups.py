import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.api.deps import SessionDep, require_admin
from app.core.config import get_settings
from app.core.security import utc_now
from app.db import engine
from app.models import BackupRecord, RestoreRecord, User
from app.services.backups import create_backup, restore_backup, validate_backup_zip

router = APIRouter(prefix="/api/admin/backups", tags=["backups"], dependencies=[Depends(require_admin)])
settings = get_settings()


@router.get("", response_model=dict)
def list_backups(session: SessionDep) -> dict:
    records = session.exec(select(BackupRecord).order_by(BackupRecord.created_at.desc())).all()
    return {"items": [r.model_dump(mode="json") for r in records]}


@router.get("/download")
def download_backup(session: SessionDep, user: User = Depends(require_admin)) -> FileResponse:
    path = create_backup(user_id=user.id)
    record = BackupRecord(
        filename=path.name,
        file_size_bytes=path.stat().st_size,
        created_at=utc_now(),
        created_by_user_id=user.id,
    )
    session.add(record)
    session.commit()
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.post("/validate", response_model=dict)
async def validate_backup(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a Forged Systems Tracking .zip backup file")
    temp_path = settings.temp_dir / f"validate-{Path(file.filename).name}"
    temp_path.write_bytes(await file.read())
    try:
        manifest = validate_backup_zip(temp_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)
    return {"message": "Backup is valid", "manifest": manifest, "record_counts": manifest.get("record_counts", {})}


@router.post("/restore", response_model=dict)
async def restore(session: SessionDep, file: UploadFile = File(...), user: User = Depends(require_admin)) -> dict:
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Upload a Forged Systems Tracking .zip backup file")
    temp_path = settings.temp_dir / f"restore-{Path(file.filename).name}"
    with temp_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    user_email = user.email
    session.close()
    try:
        manifest, pre_restore, restored_counts = restore_backup(temp_path)
        record = RestoreRecord(
            uploaded_filename=Path(file.filename).name,
            restored_at=utc_now(),
            restored_by_user_id=None,
            pre_restore_backup_filename=pre_restore.name,
            status="completed",
            notes=f"Restore completed from uploaded backup by {user_email}.",
        )
        with Session(engine) as restored_session:
            restored_session.add(record)
            restored_session.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temp_path.unlink(missing_ok=True)
    return {"message": "Restore completed", "manifest": manifest, "pre_restore_backup": pre_restore.name, "restored_counts": restored_counts}

from fastapi import APIRouter, Depends
from sqlmodel import select

from app.api.deps import SessionDep, require_admin
from app.core.security import utc_now
from app.models import AppSetting

router = APIRouter(prefix="/api/admin/settings", tags=["settings"], dependencies=[Depends(require_admin)])


@router.get("", response_model=dict)
def list_settings(session: SessionDep) -> dict[str, dict[str, str]]:
    rows = session.exec(select(AppSetting).order_by(AppSetting.key)).all()
    return {"settings": {row.key: row.value for row in rows}}


@router.put("", response_model=dict)
def save_settings(payload: dict[str, str], session: SessionDep) -> dict[str, str]:
    for key, value in payload.items():
        row = session.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key, value=value, updated_at=utc_now())
        else:
            row.value = value
            row.updated_at = utc_now()
        session.add(row)
    session.commit()
    return {"message": "Settings saved"}

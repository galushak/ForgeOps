from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.core.security import utc_now
from app.models import DropdownKind, DropdownOption
from app.schemas import DropdownOptionCreate, DropdownOptionRead, DropdownOptionUpdate

router = APIRouter(prefix="/api/dropdowns", tags=["dropdowns"], dependencies=[Depends(get_current_user)])
admin_router = APIRouter(prefix="/api/admin/dropdowns", tags=["admin-dropdowns"], dependencies=[Depends(require_admin)])


def _serialize(items: list[DropdownOption]) -> list[dict]:
    return [DropdownOptionRead.model_validate(item).model_dump(mode="json") for item in items]


@router.get("", response_model=dict)
def list_dropdown_options(
    session: SessionDep,
    kind: DropdownKind | None = None,
    include_inactive: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
) -> dict:
    stmt = select(DropdownOption)
    count_stmt = select(func.count(DropdownOption.id))
    if kind is not None:
        stmt = stmt.where(DropdownOption.kind == kind)
        count_stmt = count_stmt.where(DropdownOption.kind == kind)
    if not include_inactive:
        stmt = stmt.where(DropdownOption.is_active == True)  # noqa: E712
        count_stmt = count_stmt.where(DropdownOption.is_active == True)  # noqa: E712
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(DropdownOption.kind, DropdownOption.sort_order, DropdownOption.label)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {"items": _serialize(items), "meta": {"page": page, "page_size": page_size, "total": total}}


@admin_router.get("", response_model=dict)
def admin_list_dropdown_options(
    session: SessionDep,
    kind: DropdownKind | None = None,
    include_inactive: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
) -> dict:
    return list_dropdown_options(session, kind, include_inactive, page, page_size)


@admin_router.post("", response_model=DropdownOptionRead, status_code=status.HTTP_201_CREATED)
def create_dropdown_option(payload: DropdownOptionCreate, session: SessionDep) -> DropdownOption:
    duplicate = session.exec(
        select(DropdownOption).where(DropdownOption.kind == payload.kind, DropdownOption.label == payload.label)
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Dropdown option already exists")
    now = utc_now()
    option = DropdownOption(**payload.model_dump(), created_at=now, updated_at=now)
    session.add(option)
    session.commit()
    session.refresh(option)
    return option


@admin_router.patch("/{option_id}", response_model=DropdownOptionRead)
def update_dropdown_option(option_id: int, payload: DropdownOptionUpdate, session: SessionDep) -> DropdownOption:
    option = session.get(DropdownOption, option_id)
    if option is None:
        raise HTTPException(status_code=404, detail="Dropdown option not found")
    data = payload.model_dump(exclude_unset=True)
    if "label" in data:
        duplicate = session.exec(
            select(DropdownOption).where(DropdownOption.kind == option.kind, DropdownOption.label == data["label"])
        ).first()
        if duplicate is not None and duplicate.id != option_id:
            raise HTTPException(status_code=400, detail="Dropdown option already exists")
    for key, value in data.items():
        setattr(option, key, value)
    option.updated_at = utc_now()
    session.add(option)
    session.commit()
    session.refresh(option)
    return option


@admin_router.delete("/{option_id}", response_model=dict)
def delete_dropdown_option(option_id: int, session: SessionDep) -> dict[str, str]:
    option = session.get(DropdownOption, option_id)
    if option is None:
        raise HTTPException(status_code=404, detail="Dropdown option not found")
    session.delete(option)
    session.commit()
    return {"message": "Dropdown option deleted"}

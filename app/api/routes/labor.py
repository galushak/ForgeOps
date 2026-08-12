from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.api.deps import SessionDep, get_current_user
from app.core.security import utc_now
from app.models import Client, Invoice, LaborEntry, LaborStatus, Project
from app.schemas import LaborCreate, LaborRead, LaborUpdate

router = APIRouter(prefix="/api/labor", tags=["labor"], dependencies=[Depends(get_current_user)])


def _validate_links(
    session: Session, client_id: int | None, project_id: int | None, invoice_id: int | None = None
) -> None:
    if client_id is not None and session.get(Client, client_id) is None:
        raise HTTPException(status_code=400, detail="Client does not exist")
    if project_id is not None:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=400, detail="Project does not exist")
        if client_id is not None and project.client_id != client_id:
            raise HTTPException(status_code=400, detail="Project does not belong to selected client")
    if invoice_id is not None:
        invoice = session.get(Invoice, invoice_id)
        if invoice is None:
            raise HTTPException(status_code=400, detail="Invoice does not exist")
        if client_id is not None and invoice.client_id != client_id:
            raise HTTPException(status_code=400, detail="Invoice does not belong to selected client")
        if project_id is not None and invoice.project_id is not None and invoice.project_id != project_id:
            raise HTTPException(status_code=400, detail="Invoice does not belong to selected project")


@router.get("", response_model=dict)
def list_labor_entries(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    client_id: int | None = None,
    project_id: int | None = None,
    status_filter: LaborStatus | None = Query(default=None, alias="status"),
    uninvoiced: bool | None = None,
) -> dict:
    stmt = select(LaborEntry)
    count_stmt = select(func.count(LaborEntry.id))
    filters = [
        (LaborEntry.client_id, client_id),
        (LaborEntry.project_id, project_id),
        (LaborEntry.status, status_filter),
        (LaborEntry.is_invoiced, False if uninvoiced else None),
    ]
    for field, value in filters:
        if value is not None:
            stmt = stmt.where(field == value)
            count_stmt = count_stmt.where(field == value)
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(LaborEntry.work_date.desc(), LaborEntry.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    total_hours = sum((item.hours for item in items), Decimal("0"))
    total_amount = sum((item.hours * item.hourly_rate for item in items), Decimal("0")).quantize(Decimal("0.01"))
    return {
        "items": [LaborRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "page_total_hours": str(total_hours),
            "page_total_amount": str(total_amount),
        },
    }


@router.post("", response_model=LaborRead, status_code=status.HTTP_201_CREATED)
def create_labor_entry(payload: LaborCreate, session: SessionDep) -> LaborEntry:
    _validate_links(session, payload.client_id, payload.project_id, payload.invoice_id)
    now = utc_now()
    entry = LaborEntry(**payload.model_dump(), created_at=now, updated_at=now)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=LaborRead)
def update_labor_entry(entry_id: int, payload: LaborUpdate, session: SessionDep) -> LaborEntry:
    entry = session.get(LaborEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Labor entry not found")
    data = payload.model_dump(exclude_unset=True)
    client_id = data.get("client_id", entry.client_id)
    project_id = data.get("project_id", entry.project_id)
    invoice_id = data.get("invoice_id", entry.invoice_id)
    _validate_links(session, client_id, project_id, invoice_id)
    for key, value in data.items():
        setattr(entry, key, value)
    entry.updated_at = utc_now()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{entry_id}", response_model=dict)
def delete_labor_entry(entry_id: int, session: SessionDep) -> dict[str, str]:
    entry = session.get(LaborEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Labor entry not found")
    session.delete(entry)
    session.commit()
    return {"message": "Labor entry deleted"}

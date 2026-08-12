from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, func, select

from app.api.deps import SessionDep, get_current_user
from app.core.security import utc_now
from app.models import Client, Invoice, LedgerBusinessType, LedgerEntry, LedgerKind, Project, Quote, Receipt
from app.schemas import LedgerCreate, LedgerRead, LedgerUpdate

TAX_PAYMENT_CATEGORIES = {"Sales Tax Paid", "Sales Tax", "Income Tax Paid", "Income Tax"}

LEDGER_CATEGORIES_BY_KIND = {
    LedgerKind.income: {
        "Services",
        "Installation",
        "Sales of Product",
        "Computer Parts & Accessories",
        "Networking Parts & Accessories",
        "Security Parts & Accessories",
    },
    LedgerKind.cogs: {
        "Cost of Goods Sold",
        "CGS Computer Parts & Accessories",
        "CGS Networking Parts & Accessories",
        "CGS Security Parts & Accessories",
        "CGS Software & Apps",
    },
    LedgerKind.expense: {
        "General Business Expense",
        "Tools and Equipment",
        "Office Supplies",
        "Sales Tax",
        "Income Tax",
        "Sales Tax Paid",
        "Income Tax Paid",
    },
}

router = APIRouter(prefix="/api/ledger", tags=["ledger"], dependencies=[Depends(get_current_user)])


def _validate_category(kind: LedgerKind, category: str) -> None:
    if kind == LedgerKind.revenue:
        kind = LedgerKind.income
    allowed = LEDGER_CATEGORIES_BY_KIND.get(kind, set())
    if category not in allowed:
        raise HTTPException(status_code=400, detail="Category does not match the selected account type")


def _validate_links(
    session: Session,
    client_id: int | None,
    project_id: int | None,
    receipt_id: int | None,
    quote_id: int | None,
    invoice_id: int | None,
) -> None:
    client = session.get(Client, client_id) if client_id is not None else None
    if client_id is not None and client is None:
        raise HTTPException(status_code=400, detail="Client does not exist")

    project = session.get(Project, project_id) if project_id is not None else None
    if project_id is not None and project is None:
        raise HTTPException(status_code=400, detail="Project does not exist")
    if project is not None and client_id is not None and project.client_id != client_id:
        raise HTTPException(status_code=400, detail="Project does not belong to selected client")

    quote = session.get(Quote, quote_id) if quote_id is not None else None
    if quote_id is not None and quote is None:
        raise HTTPException(status_code=400, detail="Quote does not exist")
    if quote is not None and client_id is not None and quote.client_id != client_id:
        raise HTTPException(status_code=400, detail="Quote does not belong to selected client")
    if quote is not None and project_id is not None and quote.project_id not in {None, project_id}:
        raise HTTPException(status_code=400, detail="Quote does not match selected project")

    invoice = session.get(Invoice, invoice_id) if invoice_id is not None else None
    if invoice_id is not None and invoice is None:
        raise HTTPException(status_code=400, detail="Invoice does not exist")
    if invoice is not None and client_id is not None and invoice.client_id != client_id:
        raise HTTPException(status_code=400, detail="Invoice does not belong to selected client")
    if invoice is not None and project_id is not None and invoice.project_id not in {None, project_id}:
        raise HTTPException(status_code=400, detail="Invoice does not match selected project")

    if receipt_id is not None and session.get(Receipt, receipt_id) is None:
        raise HTTPException(status_code=400, detail="Receipt does not exist")


@router.get("", response_model=dict)
def list_ledger(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    kind: LedgerKind | None = None,
    business_type: LedgerBusinessType | None = None,
    project_id: int | None = None,
) -> dict:
    stmt = select(LedgerEntry)
    count_stmt = select(func.count(LedgerEntry.id))
    filters = [
        (LedgerEntry.kind, kind),
        (LedgerEntry.business_type, business_type),
        (LedgerEntry.project_id, project_id),
    ]
    for field, value in filters:
        if value is not None:
            stmt = stmt.where(field == value)
            count_stmt = count_stmt.where(field == value)
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(LedgerEntry.entry_date.desc(), LedgerEntry.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "items": [LedgerRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=LedgerRead, status_code=status.HTTP_201_CREATED)
def create_ledger_entry(payload: LedgerCreate, session: SessionDep) -> LedgerEntry:
    _validate_category(payload.kind, payload.category)
    data = payload.model_dump()
    if payload.business_type == LedgerBusinessType.admin:
        data["client_id"] = None
        data["project_id"] = None
        data["quote_id"] = None
        data["invoice_id"] = None
    elif payload.client_id is None:
        raise HTTPException(status_code=400, detail="Client is required when Business Type is Client")
    _validate_links(
        session,
        data.get("client_id"),
        data.get("project_id"),
        data.get("receipt_id"),
        data.get("quote_id"),
        data.get("invoice_id"),
    )
    now = utc_now()
    entry = LedgerEntry(**data, created_at=now, updated_at=now)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=LedgerRead)
def update_ledger_entry(entry_id: int, payload: LedgerUpdate, session: SessionDep) -> LedgerEntry:
    entry = session.get(LedgerEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    data = payload.model_dump(exclude_unset=True)
    next_kind = data.get("kind", entry.kind)
    next_category = data.get("category", entry.category)
    next_business_type = data.get("business_type", entry.business_type)
    _validate_category(next_kind, next_category)
    if next_business_type == LedgerBusinessType.admin:
        data["client_id"] = None
        data["project_id"] = None
        data["quote_id"] = None
        data["invoice_id"] = None
    elif data.get("client_id", entry.client_id) is None:
        raise HTTPException(status_code=400, detail="Client is required when Business Type is Client")
    _validate_links(
        session,
        data.get("client_id", entry.client_id),
        data.get("project_id", entry.project_id),
        data.get("receipt_id", entry.receipt_id),
        data.get("quote_id", entry.quote_id),
        data.get("invoice_id", entry.invoice_id),
    )
    for key, value in data.items():
        setattr(entry, key, value)
    entry.updated_at = utc_now()
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@router.delete("/{entry_id}", response_model=dict)
def delete_ledger_entry(entry_id: int, session: SessionDep) -> dict[str, str]:
    entry = session.get(LedgerEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    session.delete(entry)
    session.commit()
    return {"message": "Ledger entry deleted"}


@router.get("/summary", response_model=dict)
def ledger_summary(session: SessionDep) -> dict[str, str]:
    entries = session.exec(select(LedgerEntry)).all()
    revenue = sum((abs(e.amount) for e in entries if e.kind in {LedgerKind.income, LedgerKind.revenue}), Decimal("0"))
    expenses = sum(
        (
            abs(e.amount)
            for e in entries
            if e.kind in {LedgerKind.cogs, LedgerKind.expense} and not (e.kind == LedgerKind.expense and (e.category or "") in TAX_PAYMENT_CATEGORIES)
        ),
        Decimal("0"),
    )
    return {
        "revenue": str(revenue),
        "expenses": str(expenses),
        "net_profit": str(revenue - expenses),
        "entry_count": str(len(entries)),
    }

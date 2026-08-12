from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user
from app.models import (
    Client,
    Invoice,
    InvoiceStatus,
    LaborEntry,
    LedgerEntry,
    LedgerKind,
    Project,
    ProjectStatus,
    Quote,
    QuoteStatus,
    Receipt,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])

TAX_PAYMENT_CATEGORIES = {"Sales Tax Paid", "Sales Tax", "Income Tax Paid", "Income Tax"}


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


@router.get("", response_model=dict)
def dashboard(session: SessionDep) -> dict:
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

    clients = session.exec(select(Client)).all()
    projects = session.exec(select(Project)).all()
    quotes = session.exec(select(Quote)).all()
    invoices = session.exec(select(Invoice)).all()
    labor_entries = session.exec(select(LaborEntry)).all()
    client_names = {c.id: c.name for c in clients}
    project_names = {p.id: p.name for p in projects}

    open_projects = [p for p in projects if p.status not in {ProjectStatus.completed, ProjectStatus.canceled}]
    open_quotes = [q for q in quotes if q.status in {QuoteStatus.draft, QuoteStatus.sent}]
    open_invoices = [i for i in invoices if i.status not in {InvoiceStatus.paid, InvoiceStatus.void}]
    uninvoiced_labor = [l for l in labor_entries if not l.is_invoiced]

    open_invoice_balance = sum((i.total_amount - i.amount_paid for i in open_invoices), Decimal("0"))
    uninvoiced_labor_value = sum((l.hours * l.hourly_rate for l in uninvoiced_labor), Decimal("0"))

    return {
        "cards": {
            "revenue": _money(revenue),
            "expenses": _money(expenses),
            "net_profit": _money(revenue - expenses),
            "clients": session.exec(select(func.count(Client.id))).one(),
            "projects": session.exec(select(func.count(Project.id))).one(),
            "receipts": session.exec(select(func.count(Receipt.id))).one(),
            "labor_entries": session.exec(select(func.count(LaborEntry.id))).one(),
            "quotes": session.exec(select(func.count(Quote.id))).one(),
            "invoices": session.exec(select(func.count(Invoice.id))).one(),
            "open_projects": len(open_projects),
            "open_quotes": len(open_quotes),
            "open_invoices": len(open_invoices),
            "open_invoice_balance": _money(open_invoice_balance),
            "uninvoiced_labor": len(uninvoiced_labor),
            "uninvoiced_labor_value": _money(uninvoiced_labor_value),
        },
        "open_projects": [
            {
                "id": p.id,
                "name": p.name,
                "client": client_names.get(p.client_id, ""),
                "status": p.status.value,
                "start_date": p.start_date.isoformat() if p.start_date else None,
            }
            for p in sorted(open_projects, key=lambda p: (p.start_date is None, p.start_date or p.created_at.date()))[:10]
        ],
        "open_quotes": [
            {
                "id": q.id,
                "quote_number": q.quote_number,
                "title": q.title,
                "client": client_names.get(q.client_id, ""),
                "project": project_names.get(q.project_id, "") if q.project_id else "",
                "status": q.status.value,
                "total_amount": _money(q.total_amount),
                "quote_date": q.quote_date.isoformat(),
                "valid_until": q.valid_until.isoformat() if q.valid_until else None,
            }
            for q in sorted(open_quotes, key=lambda q: (q.valid_until is None, q.valid_until or q.quote_date))[:10]
        ],
        "open_invoices": [
            {
                "id": i.id,
                "invoice_number": i.invoice_number,
                "title": i.title,
                "client": client_names.get(i.client_id, ""),
                "project": project_names.get(i.project_id, "") if i.project_id else "",
                "status": i.status.value,
                "balance_due": _money(i.total_amount - i.amount_paid),
                "due_date": i.due_date.isoformat() if i.due_date else None,
            }
            for i in sorted(open_invoices, key=lambda i: (i.due_date is None, i.due_date or i.invoice_date))[:10]
        ],
        "uninvoiced_labor_items": [
            {
                "id": l.id,
                "work_date": l.work_date.isoformat(),
                "client": client_names.get(l.client_id, ""),
                "project": project_names.get(l.project_id, "") if l.project_id else "",
                "service_type": l.service_type,
                "line_total": _money(l.hours * l.hourly_rate),
            }
            for l in sorted(uninvoiced_labor, key=lambda l: l.work_date)[:10]
        ],
    }

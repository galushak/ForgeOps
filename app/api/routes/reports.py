from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user
from app.models import (
    Client,
    Invoice,
    InvoiceStatus,
    LaborEntry,
    LedgerEntry,
    LedgerKind,
    Project,
    Quote,
)

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(get_current_user)])

SALES_TAX_PAYMENT_CATEGORIES = {"Sales Tax Paid", "Sales Tax"}
INCOME_TAX_PAYMENT_CATEGORIES = {"Income Tax Paid", "Income Tax"}
TAX_PAYMENT_CATEGORIES = SALES_TAX_PAYMENT_CATEGORIES | INCOME_TAX_PAYMENT_CATEGORIES


def _money(value: Decimal | int | float) -> str:
    return str(Decimal(value).quantize(Decimal("0.01")))


def _date_filter(field_value: date | None, start_date: date, end_date: date) -> bool:
    return field_value is not None and start_date <= field_value <= end_date


def _name_map(items: list[Client] | list[Project]) -> dict[int, str]:
    return {int(item.id): item.name for item in items if item.id is not None}


def _is_tax_payment(entry: LedgerEntry) -> bool:
    return entry.kind == LedgerKind.expense and (entry.category or "") in TAX_PAYMENT_CATEGORIES


@router.get("/money-flow", response_model=dict)
def money_flow_report(
    session: SessionDep,
    start_date: date = Query(...),
    end_date: date = Query(...),
) -> dict:
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after start date")

    clients = session.exec(select(Client)).all()
    projects = session.exec(select(Project)).all()
    client_names = _name_map(clients)
    project_names = _name_map(projects)
    project_clients = {int(p.id): int(p.client_id) for p in projects if p.id is not None}

    ledger_entries = [
        e for e in session.exec(select(LedgerEntry)).all() if _date_filter(e.entry_date, start_date, end_date)
    ]
    quotes = [q for q in session.exec(select(Quote)).all() if _date_filter(q.quote_date, start_date, end_date)]
    invoices = [i for i in session.exec(select(Invoice)).all() if _date_filter(i.invoice_date, start_date, end_date)]
    labor_entries = [
        l for l in session.exec(select(LaborEntry)).all() if _date_filter(l.work_date, start_date, end_date)
    ]

    # Income increases revenue; Cost of Goods Sold and normal expenses reduce net
    # income. Tax paid categories are tracked separately from normal expenses.
    revenue = sum(
        (abs(e.amount) for e in ledger_entries if e.kind in {LedgerKind.income, LedgerKind.revenue}),
        Decimal("0.00"),
    )
    def business_type_value(entry: LedgerEntry) -> str:
        return str(getattr(entry.business_type, "value", entry.business_type)).lower()

    normal_expense_entries = [
        e for e in ledger_entries if e.kind in {LedgerKind.cogs, LedgerKind.expense} and not _is_tax_payment(e)
    ]
    job_expenses = sum(
        (abs(e.amount) for e in normal_expense_entries if e.kind == LedgerKind.cogs or business_type_value(e) == "client"),
        Decimal("0.00"),
    )
    business_expenses = sum(
        (abs(e.amount) for e in normal_expense_entries if business_type_value(e) == "admin" and e.kind == LedgerKind.expense),
        Decimal("0.00"),
    )
    expenses = job_expenses + business_expenses
    net_income = (revenue - expenses).quantize(Decimal("0.01"))
    sales_tax_paid = sum((abs(e.amount) for e in ledger_entries if e.kind == LedgerKind.expense and (e.category or "") in SALES_TAX_PAYMENT_CATEGORIES), Decimal("0.00"))
    income_tax_paid = sum((abs(e.amount) for e in ledger_entries if e.kind == LedgerKind.expense and (e.category or "") in INCOME_TAX_PAYMENT_CATEGORIES), Decimal("0.00"))
    total_tax_paid = sales_tax_paid + income_tax_paid
    gross_sales_tax_estimate = (revenue * Decimal("0.07")).quantize(Decimal("0.01"))
    gross_income_tax_estimate = (max(net_income, Decimal("0.00")) * Decimal("0.30")).quantize(Decimal("0.01"))
    sales_tax_reserve_remaining = max(gross_sales_tax_estimate - sales_tax_paid, Decimal("0.00"))
    income_tax_reserve_remaining = max(gross_income_tax_estimate - income_tax_paid, Decimal("0.00"))
    estimated_tax_owed = sales_tax_reserve_remaining + income_tax_reserve_remaining
    net_profit = (
        net_income
        - max(gross_sales_tax_estimate, sales_tax_paid)
        - max(gross_income_tax_estimate, income_tax_paid)
    ).quantize(Decimal("0.01"))
    owner_pay = net_profit

    invoice_total = sum((i.total_amount for i in invoices if i.status != InvoiceStatus.void), Decimal("0.00"))
    invoice_paid = sum((i.amount_paid for i in invoices if i.status != InvoiceStatus.void), Decimal("0.00"))
    invoice_tax = sum((i.tax_amount for i in invoices if i.status != InvoiceStatus.void), Decimal("0.00"))
    invoice_outstanding = sum(
        ((i.total_amount - i.amount_paid) for i in invoices if i.status not in {InvoiceStatus.paid, InvoiceStatus.void}),
        Decimal("0.00"),
    )
    uninvoiced_labor = sum(
        (l.hours * l.hourly_rate for l in labor_entries if not l.is_invoiced and l.status != "canceled"), Decimal("0.00")
    )

    category_map: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"revenue": Decimal("0.00"), "expenses": Decimal("0.00")})
    client_map: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"revenue": Decimal("0.00"), "expenses": Decimal("0.00")})
    project_map: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"revenue": Decimal("0.00"), "expenses": Decimal("0.00")})
    account_type_category_totals: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: Decimal("0.00")))

    def account_type_label(kind: LedgerKind) -> str:
        if kind in {LedgerKind.income, LedgerKind.revenue}:
            return "Income"
        if kind == LedgerKind.cogs:
            return "Cost of Goods Sold"
        return "Expenses"

    for entry in ledger_entries:
        amount = abs(entry.amount)
        category_name = entry.category or "Uncategorized"
        if _is_tax_payment(entry):
            account_type_category_totals["Tax Payments"][category_name] += amount
            continue
        bucket = "revenue" if entry.kind in {LedgerKind.income, LedgerKind.revenue} else "expenses"
        category_map[category_name][bucket] += amount
        account_type_category_totals[account_type_label(entry.kind)][category_name] += amount
        client_label = client_names.get(int(entry.client_id), "Admin / Unassigned") if entry.client_id else "Admin / Unassigned"
        client_map[client_label][bucket] += amount
        project_label = project_names.get(int(entry.project_id), "No Project") if entry.project_id else "No Project"
        project_map[project_label][bucket] += amount

    def rows(source: dict[str, dict[str, Decimal]]) -> list[dict[str, str]]:
        result = []
        for name, totals in source.items():
            result.append(
                {
                    "name": name,
                    "revenue": _money(totals["revenue"]),
                    "expenses": _money(totals["expenses"]),
                    "net": _money(totals["revenue"] - totals["expenses"]),
                }
            )
        return sorted(result, key=lambda row: Decimal(row["net"]), reverse=True)

    def account_type_rows() -> list[dict[str, str]]:
        ordered_types = ["Income", "Cost of Goods Sold", "Expenses", "Tax Payments"]
        result: list[dict[str, str]] = []
        for account_type in ordered_types:
            categories = account_type_category_totals.get(account_type, {})
            for category_name, total in sorted(categories.items(), key=lambda item: item[0].lower()):
                result.append(
                    {
                        "account_type": account_type,
                        "category": category_name,
                        "total": _money(total),
                    }
                )
        return result

    quote_statuses: dict[str, int] = defaultdict(int)
    for quote in quotes:
        quote_statuses[str(quote.status.value if hasattr(quote.status, "value") else quote.status)] += 1

    invoice_statuses: dict[str, int] = defaultdict(int)
    for invoice in invoices:
        invoice_statuses[str(invoice.status.value if hasattr(invoice.status, "value") else invoice.status)] += 1

    project_statuses: dict[str, int] = defaultdict(int)
    for project in projects:
        if project.created_at.date() <= end_date and (project.completed_date is None or project.completed_date >= start_date):
            project_statuses[str(project.status.value if hasattr(project.status, "value") else project.status)] += 1

    client_report = []
    for client in clients:
        client_projects = [p for p in projects if p.client_id == client.id]
        client_project_ids = {p.id for p in client_projects}
        client_invoices = [i for i in invoices if i.client_id == client.id]
        client_quotes = [q for q in quotes if q.client_id == client.id]
        client_labor = [l for l in labor_entries if l.client_id == client.id]
        client_ledger = [
            e for e in ledger_entries if e.client_id == client.id or (e.project_id in client_project_ids)
        ]
        client_revenue = sum((abs(e.amount) for e in client_ledger if e.kind in {LedgerKind.income, LedgerKind.revenue}), Decimal("0.00"))
        client_expenses = sum((abs(e.amount) for e in client_ledger if e.kind in {LedgerKind.cogs, LedgerKind.expense} and not _is_tax_payment(e)), Decimal("0.00"))
        if client_projects or client_invoices or client_quotes or client_labor or client_ledger:
            client_report.append(
                {
                    "client_id": client.id,
                    "client": client.name,
                    "projects": len(client_projects),
                    "quotes": len(client_quotes),
                    "invoices": len(client_invoices),
                    "labor_entries": len(client_labor),
                    "ledger_revenue": _money(client_revenue),
                    "ledger_expenses": _money(client_expenses),
                    "ledger_net": _money(client_revenue - client_expenses),
                    "invoice_total": _money(sum((i.total_amount for i in client_invoices), Decimal("0.00"))),
                    "outstanding": _money(
                        sum(
                            ((i.total_amount - i.amount_paid) for i in client_invoices if i.status != InvoiceStatus.void),
                            Decimal("0.00"),
                        )
                    ),
                }
            )

    project_report = []
    for project in projects:
        project_invoices = [i for i in invoices if i.project_id == project.id]
        project_quotes = [q for q in quotes if q.project_id == project.id]
        project_labor = [l for l in labor_entries if l.project_id == project.id]
        project_ledger = [e for e in ledger_entries if e.project_id == project.id]
        if project_invoices or project_quotes or project_labor or project_ledger:
            p_revenue = sum((abs(e.amount) for e in project_ledger if e.kind in {LedgerKind.income, LedgerKind.revenue}), Decimal("0.00"))
            p_expenses = sum((abs(e.amount) for e in project_ledger if e.kind in {LedgerKind.cogs, LedgerKind.expense} and not _is_tax_payment(e)), Decimal("0.00"))
            project_report.append(
                {
                    "project_id": project.id,
                    "project": project.name,
                    "client": client_names.get(project_clients.get(int(project.id or 0), 0), ""),
                    "status": str(project.status.value if hasattr(project.status, "value") else project.status),
                    "quotes": len(project_quotes),
                    "invoices": len(project_invoices),
                    "labor_entries": len(project_labor),
                    "ledger_revenue": _money(p_revenue),
                    "ledger_expenses": _money(p_expenses),
                    "ledger_net": _money(p_revenue - p_expenses),
                    "invoice_total": _money(sum((i.total_amount for i in project_invoices), Decimal("0.00"))),
                }
            )

    return {
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        "cards": {
            "ledger_revenue": _money(revenue),
            "ledger_expenses": _money(expenses),
            "ledger_net_profit": _money(net_profit),
            "job_expenses": _money(job_expenses),
            "business_expenses": _money(business_expenses),
            "estimated_sales_tax": _money(sales_tax_reserve_remaining),
            "estimated_income_tax": _money(income_tax_reserve_remaining),
            "estimated_tax_owed": _money(estimated_tax_owed),
            "gross_sales_tax_estimate": _money(gross_sales_tax_estimate),
            "gross_income_tax_estimate": _money(gross_income_tax_estimate),
            "sales_tax_paid": _money(sales_tax_paid),
            "income_tax_paid": _money(income_tax_paid),
            "total_tax_paid": _money(total_tax_paid),
            "net_income": _money(net_income),
            "owner_pay": _money(owner_pay),
            "invoice_total": _money(invoice_total),
            "invoice_paid": _money(invoice_paid),
            "invoice_outstanding": _money(invoice_outstanding),
            "invoice_sales_tax": _money(invoice_tax),
            "uninvoiced_labor": _money(uninvoiced_labor),
        },
        "account_type_breakdown": account_type_rows(),
        "by_category": rows(category_map),
        "by_client": rows(client_map),
        "by_project": rows(project_map),
        "quote_statuses": dict(sorted(quote_statuses.items())),
        "invoice_statuses": dict(sorted(invoice_statuses.items())),
        "project_statuses": dict(sorted(project_statuses.items())),
        "client_report": sorted(client_report, key=lambda r: Decimal(r["ledger_net"]), reverse=True),
        "project_report": sorted(project_report, key=lambda r: Decimal(r["ledger_net"]), reverse=True),
    }

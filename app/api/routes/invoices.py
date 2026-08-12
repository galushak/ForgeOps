from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from app.api.deps import SessionDep, get_current_user
from app.core.rates import normalize_percentage_rate
from app.core.security import utc_now
from app.models import AppSetting, Client, Invoice, InvoiceLineItem, InvoiceLineItemKind, InvoiceStatus, LaborEntry, Project, Quote
from app.schemas import InvoiceCreate, InvoiceLineItemRead, InvoiceRead, InvoiceUpdate

router = APIRouter(prefix="/api/invoices", tags=["invoices"], dependencies=[Depends(get_current_user)])


def _validate_links(session: Session, client_id: int | None, project_id: int | None, quote_id: int | None) -> None:
    if client_id is not None and session.get(Client, client_id) is None:
        raise HTTPException(status_code=400, detail="Client does not exist")
    if project_id is not None:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=400, detail="Project does not exist")
        if client_id is not None and project.client_id != client_id:
            raise HTTPException(status_code=400, detail="Project does not belong to selected client")
    if quote_id is not None:
        quote = session.get(Quote, quote_id)
        if quote is None:
            raise HTTPException(status_code=400, detail="Quote does not exist")
        if client_id is not None and quote.client_id != client_id:
            raise HTTPException(status_code=400, detail="Quote does not belong to selected client")
        if project_id is not None and quote.project_id is not None and quote.project_id != project_id:
            raise HTTPException(status_code=400, detail="Quote does not belong to selected project")


def _sync_labor_links(session: Session, invoice: Invoice, labor_entry_ids: list[int] | None) -> None:
    if labor_entry_ids is None:
        return
    existing = session.exec(select(LaborEntry).where(LaborEntry.invoice_id == invoice.id)).all()
    for entry in existing:
        if entry.id not in labor_entry_ids:
            entry.invoice_id = None
            entry.invoice_number = None
            entry.is_invoiced = False
            session.add(entry)
    for labor_id in labor_entry_ids:
        entry = session.get(LaborEntry, labor_id)
        if entry is None:
            raise HTTPException(status_code=400, detail=f"Labor entry {labor_id} does not exist")
        if entry.client_id != invoice.client_id:
            raise HTTPException(status_code=400, detail=f"Labor entry {labor_id} does not belong to invoice client")
        if invoice.project_id is not None and entry.project_id != invoice.project_id:
            raise HTTPException(status_code=400, detail=f"Labor entry {labor_id} does not belong to invoice project")
        entry.invoice_id = invoice.id
        entry.invoice_number = invoice.invoice_number
        entry.is_invoiced = True
        session.add(entry)


def _money(value: Decimal | int | float | str | None) -> Decimal:
    try:
        decimal_value = Decimal(str(value if value is not None else "0"))
    except (InvalidOperation, ValueError):
        decimal_value = Decimal("0")
    return decimal_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _sales_tax_rate(session: Session) -> Decimal:
    setting = session.get(AppSetting, "sales_tax_rate")
    raw = setting.value if setting is not None else "0.07"
    try:
        return normalize_percentage_rate(raw)
    except ValueError:
        return Decimal("0.07")


def _recalculate_invoice_totals(session: Session, invoice: Invoice) -> None:
    # Single source of truth: invoice tax is ALWAYS calculated on
    # labor + additional parts/materials. Payments/credits are separate
    # deductions after the invoice total.
    labor_entries = session.exec(select(LaborEntry).where(LaborEntry.invoice_id == invoice.id)).all()
    labor_total = sum((_money(entry.hours * entry.hourly_rate) for entry in labor_entries), Decimal("0.00"))

    line_items = session.exec(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id)).all()
    materials_total = sum(
        (_money(item.line_total) for item in line_items if item.kind == InvoiceLineItemKind.material),
        Decimal("0.00"),
    )
    credits_total = sum(
        (
            _money(item.line_total)
            for item in line_items
            if item.kind in {InvoiceLineItemKind.credit, InvoiceLineItemKind.payment, InvoiceLineItemKind.adjustment}
        ),
        Decimal("0.00"),
    )

    subtotal = _money(labor_total + materials_total)
    tax = _money(subtotal * _sales_tax_rate(session))
    total = _money(subtotal + tax)

    invoice.subtotal = subtotal
    invoice.tax_amount = tax
    invoice.total_amount = total
    invoice.amount_paid = _money(credits_total)
    invoice.updated_at = utc_now()
    session.add(invoice)


def _next_invoice_number(session: Session) -> str:
    today = utc_now().strftime("%Y%m%d")
    prefix = f"FS-INV-{today}-"
    numbers = session.exec(select(Invoice.invoice_number).where(Invoice.invoice_number.like(f"{prefix}%"))).all()
    max_suffix = 0
    for number in numbers:
        suffix = str(number).removeprefix(prefix)
        if suffix.isdigit():
            max_suffix = max(max_suffix, int(suffix))
    return f"{prefix}{max_suffix + 1:03d}"


@router.get("/next-number", response_model=dict)
def get_next_invoice_number(session: SessionDep) -> dict[str, str]:
    return {"invoice_number": _next_invoice_number(session)}


def _invoice_read(session: Session, invoice: Invoice) -> dict:
    data = InvoiceRead.model_validate(invoice).model_dump(mode="json")
    line_items = session.exec(
        select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id).order_by(InvoiceLineItem.sort_order, InvoiceLineItem.id)
    ).all()
    data["line_items"] = [InvoiceLineItemRead.model_validate(item).model_dump(mode="json") for item in line_items]
    return data


def _replace_invoice_line_items(session: Session, invoice: Invoice, line_items: list | None) -> None:
    if line_items is None:
        return
    for existing in session.exec(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice.id)).all():
        session.delete(existing)
    now = utc_now()
    for index, item in enumerate(line_items, start=1):
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        session.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                kind=data["kind"],
                description=data["description"],
                quantity=data.get("quantity"),
                unit_price=data.get("unit_price"),
                line_total=data.get("line_total"),
                taxable=data.get("taxable", False),
                sort_order=data.get("sort_order") or index * 10,
                created_at=now,
                updated_at=now,
            )
        )


@router.get("", response_model=dict)
def list_invoices(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    client_id: int | None = None,
    project_id: int | None = None,
    status_filter: InvoiceStatus | None = Query(default=None, alias="status"),
) -> dict:
    stmt = select(Invoice)
    count_stmt = select(func.count(Invoice.id))
    filters = [(Invoice.client_id, client_id), (Invoice.project_id, project_id), (Invoice.status, status_filter)]
    for field, value in filters:
        if value is not None:
            stmt = stmt.where(field == value)
            count_stmt = count_stmt.where(field == value)
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(Invoice.invoice_date.desc(), Invoice.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [_invoice_read(session, i) for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_invoice(payload: InvoiceCreate, session: SessionDep) -> dict:
    data = payload.model_dump(exclude={"labor_entry_ids", "line_items"})
    _validate_links(session, data["client_id"], data.get("project_id"), data.get("quote_id"))
    now = utc_now()
    invoice = Invoice(**data, created_at=now, updated_at=now)
    session.add(invoice)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail="Invoice number already exists") from exc
    session.refresh(invoice)
    _sync_labor_links(session, invoice, payload.labor_entry_ids)
    _replace_invoice_line_items(session, invoice, payload.line_items)
    _recalculate_invoice_totals(session, invoice)
    session.commit()
    session.refresh(invoice)
    return _invoice_read(session, invoice)


@router.patch("/{invoice_id}", response_model=InvoiceRead)
def update_invoice(invoice_id: int, payload: InvoiceUpdate, session: SessionDep) -> dict:
    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    data = payload.model_dump(exclude_unset=True)
    labor_ids = data.pop("labor_entry_ids", None)
    line_items = data.pop("line_items", None)
    client_id = data.get("client_id", invoice.client_id)
    project_id = data.get("project_id", invoice.project_id)
    quote_id = data.get("quote_id", invoice.quote_id)
    _validate_links(session, client_id, project_id, quote_id)
    for key, value in data.items():
        setattr(invoice, key, value)
    invoice.updated_at = utc_now()
    session.add(invoice)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail="Invoice number already exists") from exc
    session.refresh(invoice)
    _sync_labor_links(session, invoice, labor_ids)
    _replace_invoice_line_items(session, invoice, line_items)
    _recalculate_invoice_totals(session, invoice)
    session.commit()
    session.refresh(invoice)
    return _invoice_read(session, invoice)


@router.delete("/{invoice_id}", response_model=dict)
def delete_invoice(invoice_id: int, session: SessionDep) -> dict[str, str]:
    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    for entry in session.exec(select(LaborEntry).where(LaborEntry.invoice_id == invoice_id)).all():
        entry.invoice_id = None
        entry.invoice_number = None
        entry.is_invoiced = False
        session.add(entry)
    for item in session.exec(select(InvoiceLineItem).where(InvoiceLineItem.invoice_id == invoice_id)).all():
        session.delete(item)
    session.delete(invoice)
    session.commit()
    return {"message": "Invoice deleted"}

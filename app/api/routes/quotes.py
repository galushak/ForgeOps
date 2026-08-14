from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from app.api.deps import SessionDep, get_current_user
from app.core.rates import normalize_percentage_rate
from app.core.security import utc_now
from app.models import AppSetting, Client, Invoice, Project, Quote, QuoteLineItem, QuoteLineItemKind, QuoteStatus
from app.schemas import QuoteCreate, QuoteLineItemRead, QuoteLineItemsReplace, QuoteRead, QuoteUpdate

router = APIRouter(prefix="/api/quotes", tags=["quotes"], dependencies=[Depends(get_current_user)])
QUOTE_MARKUP_NAME = "Project Coordination & Logistics"


def _validate_links(session: Session, client_id: int | None, project_id: int | None) -> None:
    if client_id is not None and session.get(Client, client_id) is None:
        raise HTTPException(status_code=400, detail="Client does not exist")
    if project_id is not None:
        project = session.get(Project, project_id)
        if project is None:
            raise HTTPException(status_code=400, detail="Project does not exist")
        if client_id is not None and project.client_id != client_id:
            raise HTTPException(status_code=400, detail="Project does not belong to selected client")


def _next_quote_number(session: Session) -> str:
    today = utc_now().strftime("%Y%m%d")
    prefix = f"FS-QUOTE-{today}-"
    numbers = session.exec(select(Quote.quote_number).where(Quote.quote_number.like(f"{prefix}%"))).all()
    max_suffix = 0
    for number in numbers:
        suffix = str(number).removeprefix(prefix)
        if suffix.isdigit():
            max_suffix = max(max_suffix, int(suffix))
    return f"{prefix}{max_suffix + 1:03d}"


def _line_total(item: QuoteLineItem) -> Decimal:
    if item.line_total and item.line_total > 0:
        return item.line_total.quantize(Decimal("0.01"))
    return (item.quantity * item.unit_price).quantize(Decimal("0.01"))


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


def _is_markup(item: QuoteLineItem) -> bool:
    return item.kind == QuoteLineItemKind.fee and item.name.strip().casefold() == QUOTE_MARKUP_NAME.casefold()


def _recalculate_quote_totals(session: Session, quote: Quote) -> Quote:
    items = session.exec(select(QuoteLineItem).where(QuoteLineItem.quote_id == quote.id)).all()
    equipment = [item for item in items if item.kind == QuoteLineItemKind.equipment]
    labor = [item for item in items if item.kind == QuoteLineItemKind.labor]
    vendor_fees = [item for item in items if item.kind == QuoteLineItemKind.fee and not _is_markup(item)]
    markup = [item for item in items if _is_markup(item)]
    equipment_total = sum((_line_total(item) for item in equipment), Decimal("0.00"))
    taxable_equipment_total = sum((_line_total(item) for item in equipment if item.taxable), Decimal("0.00"))
    vendor_fee_total = sum((_line_total(item) for item in vendor_fees), Decimal("0.00"))
    labor_total = sum((_line_total(item) for item in labor), Decimal("0.00"))
    markup_total = sum((_line_total(item) for item in markup), Decimal("0.00"))
    quote.subtotal = _money(equipment_total + vendor_fee_total + markup_total + labor_total)
    quote.tax_amount = _money((taxable_equipment_total + vendor_fee_total) * _sales_tax_rate(session))
    quote.total_amount = _money(quote.subtotal + quote.tax_amount)
    quote.updated_at = utc_now()
    session.add(quote)
    session.commit()
    session.refresh(quote)
    return quote


@router.get("/next-number", response_model=dict)
def get_next_quote_number(session: SessionDep) -> dict[str, str]:
    return {"quote_number": _next_quote_number(session)}


@router.get("", response_model=dict)
def list_quotes(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    client_id: int | None = None,
    project_id: int | None = None,
    status_filter: QuoteStatus | None = Query(default=None, alias="status"),
) -> dict:
    stmt = select(Quote)
    count_stmt = select(func.count(Quote.id))
    filters = [(Quote.client_id, client_id), (Quote.project_id, project_id), (Quote.status, status_filter)]
    for field, value in filters:
        if value is not None:
            stmt = stmt.where(field == value)
            count_stmt = count_stmt.where(field == value)
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(Quote.quote_date.desc(), Quote.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [QuoteRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=QuoteRead, status_code=status.HTTP_201_CREATED)
def create_quote(payload: QuoteCreate, session: SessionDep) -> Quote:
    _validate_links(session, payload.client_id, payload.project_id)
    now = utc_now()
    quote = Quote(**payload.model_dump(), created_at=now, updated_at=now)
    session.add(quote)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail="Quote number already exists") from exc
    session.refresh(quote)
    return quote


@router.patch("/{quote_id}", response_model=QuoteRead)
def update_quote(quote_id: int, payload: QuoteUpdate, session: SessionDep) -> Quote:
    quote = session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found")
    data = payload.model_dump(exclude_unset=True)
    client_id = data.get("client_id", quote.client_id)
    project_id = data.get("project_id", quote.project_id)
    _validate_links(session, client_id, project_id)
    for key, value in data.items():
        setattr(quote, key, value)
    quote.updated_at = utc_now()
    session.add(quote)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail="Quote number already exists") from exc
    session.refresh(quote)
    return quote


@router.delete("/{quote_id}", response_model=dict)
def delete_quote(quote_id: int, session: SessionDep) -> dict[str, str]:
    quote = session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found")
    has_invoice = session.exec(select(func.count(Invoice.id)).where(Invoice.quote_id == quote_id)).one()
    if has_invoice:
        raise HTTPException(status_code=400, detail="Quote is attached to an invoice. Void/close it instead.")
    session.delete(quote)
    session.commit()
    return {"message": "Quote deleted"}


@router.get("/{quote_id}/line-items", response_model=dict)
def list_quote_line_items(quote_id: int, session: SessionDep) -> dict:
    quote = session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found")
    items = session.exec(
        select(QuoteLineItem)
        .where(QuoteLineItem.quote_id == quote_id)
        .order_by(QuoteLineItem.sort_order, QuoteLineItem.id)
    ).all()
    return {"items": [QuoteLineItemRead.model_validate(i).model_dump(mode="json") for i in items]}


@router.put("/{quote_id}/line-items", response_model=dict)
def replace_quote_line_items(quote_id: int, payload: QuoteLineItemsReplace, session: SessionDep) -> dict:
    quote = session.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status_code=404, detail="Quote not found")
    existing = session.exec(select(QuoteLineItem).where(QuoteLineItem.quote_id == quote_id)).all()
    for item in existing:
        session.delete(item)
    session.flush()
    now = utc_now()
    saved: list[QuoteLineItem] = []
    for index, item_payload in enumerate(payload.items, start=1):
        data = item_payload.model_dump()
        data["quote_id"] = quote_id
        if data["kind"] == QuoteLineItemKind.fee:
            data["taxable"] = data["name"].strip().casefold() != QUOTE_MARKUP_NAME.casefold()
        quantity = Decimal(str(data.get("quantity") or "0"))
        unit_price = Decimal(str(data.get("unit_price") or "0"))
        line_total = Decimal(str(data.get("line_total") or "0"))
        if line_total <= 0:
            line_total = (quantity * unit_price).quantize(Decimal("0.01"))
        data["line_total"] = line_total
        data["sort_order"] = data.get("sort_order") or index * 10
        item = QuoteLineItem(**data, created_at=now, updated_at=now)
        session.add(item)
        saved.append(item)
    session.commit()
    for item in saved:
        session.refresh(item)
    quote = session.get(Quote, quote_id)
    if quote is not None:
        _recalculate_quote_totals(session, quote)
    return {"items": [QuoteLineItemRead.model_validate(i).model_dump(mode="json") for i in saved]}

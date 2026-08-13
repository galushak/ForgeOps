from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.models import (
    DropdownKind,
    InvoiceStatus,
    InvoiceLineItemKind,
    LaborStatus,
    LedgerBusinessType,
    LedgerKind,
    ProjectStatus,
    QuoteLineItemKind,
    QuoteStatus,
    ReceiptStatus,
)


class ClientBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    contact_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    billing_address: str | None = Field(default=None, max_length=500)
    site_address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool = True


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    contact_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    billing_address: str | None = Field(default=None, max_length=500)
    site_address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


class ClientRead(ClientBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class ClientAddressBase(BaseModel):
    client_id: int
    label: str = Field(default="Site", min_length=1, max_length=80)
    address: str = Field(min_length=1, max_length=500)
    is_default: bool = False


class ClientAddressCreate(ClientAddressBase):
    pass


class ClientAddressUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    address: str | None = Field(default=None, min_length=1, max_length=500)
    is_default: bool | None = None


class ClientAddressRead(ClientAddressBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class ProjectBase(BaseModel):
    client_id: int
    name: str = Field(min_length=1, max_length=180)
    status: ProjectStatus = ProjectStatus.lead
    site_address: str | None = Field(default=None, max_length=500)
    start_date: date | None = None
    completed_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    client_id: int | None = None
    name: str | None = Field(default=None, min_length=1, max_length=180)
    status: ProjectStatus | None = None
    site_address: str | None = Field(default=None, max_length=500)
    start_date: date | None = None
    completed_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class LedgerBase(BaseModel):
    entry_date: date
    kind: LedgerKind
    business_type: LedgerBusinessType
    category: str = Field(min_length=1, max_length=80)
    amount: Decimal = Field(max_digits=12, decimal_places=2)
    client_id: int | None = None
    project_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    receipt_id: int | None = None
    quote_id: int | None = None
    invoice_id: int | None = None
    sales_tax_period: str | None = Field(default=None, min_length=7, max_length=7, pattern=r"^\d{4}-Q[1-4]$")


class LedgerCreate(LedgerBase):
    pass


class LedgerUpdate(BaseModel):
    entry_date: date | None = None
    kind: LedgerKind | None = None
    business_type: LedgerBusinessType | None = None
    category: str | None = Field(default=None, min_length=1, max_length=80)
    amount: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)
    client_id: int | None = None
    project_id: int | None = None
    description: str | None = Field(default=None, max_length=500)
    receipt_id: int | None = None
    quote_id: int | None = None
    invoice_id: int | None = None
    sales_tax_period: str | None = Field(default=None, min_length=7, max_length=7, pattern=r"^\d{4}-Q[1-4]$")


class LedgerRead(LedgerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class QuoteBase(BaseModel):
    quote_number: str = Field(min_length=1, max_length=80)
    client_id: int
    project_id: int | None = None
    status: QuoteStatus = QuoteStatus.draft
    title: str = Field(min_length=1, max_length=180)
    quote_date: date
    valid_until: date | None = None
    subtotal: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    tax_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    total_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)


class QuoteCreate(QuoteBase):
    pass


class QuoteUpdate(BaseModel):
    quote_number: str | None = Field(default=None, min_length=1, max_length=80)
    client_id: int | None = None
    project_id: int | None = None
    status: QuoteStatus | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    quote_date: date | None = None
    valid_until: date | None = None
    subtotal: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    total_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)


class QuoteRead(QuoteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class QuoteLineItemBase(BaseModel):
    quote_id: int
    kind: QuoteLineItemKind = QuoteLineItemKind.equipment
    name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    quantity: Decimal = Field(default=Decimal("1.00"), ge=0, max_digits=10, decimal_places=2)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    line_total: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    taxable: bool = True
    sort_order: int = 0


class QuoteLineItemCreate(QuoteLineItemBase):
    pass


class QuoteLineItemUpdate(BaseModel):
    kind: QuoteLineItemKind | None = None
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    quantity: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    unit_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    line_total: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    taxable: bool | None = None
    sort_order: int | None = None


class QuoteLineItemRead(QuoteLineItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime


class QuoteLineItemsReplace(BaseModel):
    items: list[QuoteLineItemCreate] = Field(default_factory=list)


class InvoiceLineItemBase(BaseModel):
    kind: InvoiceLineItemKind = InvoiceLineItemKind.material
    description: str = Field(min_length=1, max_length=500)
    quantity: Decimal = Field(default=Decimal("1.00"), ge=0, max_digits=10, decimal_places=2)
    unit_price: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    line_total: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    taxable: bool = False
    sort_order: int = 0


class InvoiceLineItemCreate(InvoiceLineItemBase):
    pass


class InvoiceLineItemRead(InvoiceLineItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    invoice_id: int
    created_at: datetime
    updated_at: datetime


class InvoiceBase(BaseModel):
    invoice_number: str = Field(min_length=1, max_length=80)
    client_id: int
    project_id: int | None = None
    quote_id: int | None = None
    status: InvoiceStatus = InvoiceStatus.draft
    title: str = Field(min_length=1, max_length=180)
    invoice_date: date
    due_date: date | None = None
    subtotal: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    tax_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    total_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    amount_paid: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)


class InvoiceCreate(InvoiceBase):
    labor_entry_ids: list[int] = Field(default_factory=list)
    line_items: list[InvoiceLineItemCreate] = Field(default_factory=list)


class InvoiceUpdate(BaseModel):
    invoice_number: str | None = Field(default=None, min_length=1, max_length=80)
    client_id: int | None = None
    project_id: int | None = None
    quote_id: int | None = None
    status: InvoiceStatus | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    invoice_date: date | None = None
    due_date: date | None = None
    subtotal: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    total_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    amount_paid: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)
    labor_entry_ids: list[int] | None = None
    line_items: list[InvoiceLineItemCreate] | None = None


class InvoiceRead(InvoiceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
    line_items: list[InvoiceLineItemRead] = Field(default_factory=list)

    @computed_field
    @property
    def balance_due(self) -> Decimal:
        return (self.total_amount - self.amount_paid).quantize(Decimal("0.01"))


class LaborBase(BaseModel):
    work_date: date
    client_id: int
    project_id: int | None = None
    status: LaborStatus = LaborStatus.completed
    service_type: str = Field(min_length=1, max_length=120)
    hours: Decimal = Field(ge=0, max_digits=8, decimal_places=2)
    hourly_rate: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    invoice_id: int | None = None
    invoice_number: str | None = Field(default=None, max_length=80)
    is_invoiced: bool = False
    notes: str | None = Field(default=None, max_length=1000)


class LaborCreate(LaborBase):
    pass


class LaborUpdate(BaseModel):
    work_date: date | None = None
    client_id: int | None = None
    project_id: int | None = None
    status: LaborStatus | None = None
    service_type: str | None = Field(default=None, min_length=1, max_length=120)
    hours: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    hourly_rate: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    invoice_id: int | None = None
    invoice_number: str | None = Field(default=None, max_length=80)
    is_invoiced: bool | None = None
    notes: str | None = Field(default=None, max_length=1000)


class LaborRead(LaborBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def line_total(self) -> Decimal:
        return (self.hours * self.hourly_rate).quantize(Decimal("0.01"))


class ReceiptUpdate(BaseModel):
    vendor_name: str | None = Field(default=None, max_length=160)
    receipt_date: date | None = None
    total_amount: Decimal | None = Field(default=None, max_digits=12, decimal_places=2)
    tax_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    category: str | None = Field(default=None, max_length=80)
    status: ReceiptStatus | None = None
    linked_type: str | None = Field(default=None, max_length=40)
    linked_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    original_filename: str
    stored_filename: str
    file_path: str
    content_type: str
    file_size_bytes: int
    uploaded_at: datetime
    vendor_name: str | None
    receipt_date: date | None
    total_amount: Decimal | None
    tax_amount: Decimal | None
    category: str | None
    status: ReceiptStatus
    linked_type: str | None
    linked_id: int | None
    notes: str | None


class DropdownOptionBase(BaseModel):
    kind: DropdownKind
    label: str = Field(min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=40)
    sort_order: int = 0
    is_active: bool = True


class DropdownOptionCreate(DropdownOptionBase):
    pass


class DropdownOptionUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    color: str | None = Field(default=None, max_length=40)
    sort_order: int | None = None
    is_active: bool | None = None


class DropdownOptionRead(DropdownOptionBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime

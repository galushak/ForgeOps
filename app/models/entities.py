from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from sqlmodel import Field, SQLModel


class ProjectStatus(str, Enum):
    lead = "lead"
    quoted = "quoted"
    approved = "approved"
    in_progress = "in_progress"
    completed = "completed"
    canceled = "canceled"


class LedgerKind(str, Enum):
    income = "income"
    cogs = "cogs"
    expense = "expense"
    # Legacy value kept so older backups can be read before migration.
    revenue = "revenue"


class LedgerBusinessType(str, Enum):
    client = "client"
    admin = "admin"


class QuoteLineItemKind(str, Enum):
    equipment = "equipment"
    labor = "labor"
    fee = "fee"


class QuoteStatus(str, Enum):
    draft = "draft"
    sent = "sent"
    approved = "approved"
    rejected = "rejected"
    expired = "expired"


class InvoiceStatus(str, Enum):
    draft = "draft"
    sent = "sent"
    partially_paid = "partially_paid"
    paid = "paid"
    void = "void"
    overdue = "overdue"


class InvoiceLineItemKind(str, Enum):
    material = "material"
    credit = "credit"
    payment = "payment"
    adjustment = "adjustment"


class DropdownKind(str, Enum):
    ledger_category = "ledger_category"
    service_type = "service_type"


class LaborStatus(str, Enum):
    planned = "planned"
    completed = "completed"
    invoiced = "invoiced"
    paid = "paid"
    canceled = "canceled"


class ReceiptStatus(str, Enum):
    uploaded = "uploaded"
    needs_review = "needs_review"
    reviewed = "reviewed"
    attached = "attached"
    archived = "archived"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True, max_length=255)
    password_hash: str
    full_name: str = Field(default="Administrator", max_length=120)
    is_admin: bool = True
    created_at: datetime


class SessionToken(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    expires_at: datetime = Field(index=True)
    created_at: datetime


class Client(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, max_length=160)
    contact_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    billing_address: str | None = Field(default=None, max_length=500)
    site_address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class ClientAddress(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    client_id: int = Field(foreign_key="client.id", index=True)
    label: str = Field(default="Site", max_length=80)
    address: str = Field(max_length=500)
    is_default: bool = False
    created_at: datetime
    updated_at: datetime


class Project(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    client_id: int = Field(foreign_key="client.id", index=True)
    name: str = Field(index=True, max_length=180)
    status: ProjectStatus = Field(default=ProjectStatus.lead, index=True)
    site_address: str | None = Field(default=None, max_length=500)
    start_date: date | None = None
    completed_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    created_at: datetime
    updated_at: datetime


class LedgerEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    entry_date: date = Field(index=True)
    kind: LedgerKind = Field(index=True)
    business_type: LedgerBusinessType = Field(index=True)
    category: str = Field(index=True, max_length=80)
    amount: Decimal = Field(decimal_places=2, max_digits=12)
    client_id: int | None = Field(default=None, foreign_key="client.id", index=True)
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    description: str | None = Field(default=None, max_length=500)
    receipt_id: int | None = Field(default=None, foreign_key="receipt.id", index=True)
    quote_id: int | None = Field(default=None, foreign_key="quote.id", index=True)
    invoice_id: int | None = Field(default=None, foreign_key="invoice.id", index=True)
    created_at: datetime
    updated_at: datetime


class Quote(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    quote_number: str = Field(index=True, unique=True, max_length=80)
    client_id: int = Field(foreign_key="client.id", index=True)
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    status: QuoteStatus = Field(default=QuoteStatus.draft, index=True)
    title: str = Field(max_length=180)
    quote_date: date = Field(index=True)
    valid_until: date | None = Field(default=None, index=True)
    subtotal: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    tax_amount: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    total_amount: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)
    created_at: datetime
    updated_at: datetime


class QuoteLineItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    quote_id: int = Field(foreign_key="quote.id", index=True)
    kind: QuoteLineItemKind = Field(default=QuoteLineItemKind.equipment, index=True)
    name: str = Field(max_length=180)
    description: str | None = Field(default=None, max_length=1000)
    quantity: Decimal = Field(default=Decimal("1.00"), decimal_places=2, max_digits=10)
    unit_price: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    line_total: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    taxable: bool = Field(default=True, index=True)
    sort_order: int = Field(default=0, index=True)
    created_at: datetime
    updated_at: datetime


class Invoice(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    invoice_number: str = Field(index=True, unique=True, max_length=80)
    client_id: int = Field(foreign_key="client.id", index=True)
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    quote_id: int | None = Field(default=None, foreign_key="quote.id", index=True)
    status: InvoiceStatus = Field(default=InvoiceStatus.draft, index=True)
    title: str = Field(max_length=180)
    invoice_date: date = Field(index=True)
    due_date: date | None = Field(default=None, index=True)
    subtotal: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    tax_amount: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    total_amount: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    amount_paid: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=2000)
    created_at: datetime
    updated_at: datetime


class InvoiceLineItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    invoice_id: int = Field(foreign_key="invoice.id", index=True)
    kind: InvoiceLineItemKind = Field(default=InvoiceLineItemKind.material, index=True)
    description: str = Field(max_length=500)
    quantity: Decimal = Field(default=Decimal("1.00"), decimal_places=2, max_digits=10)
    unit_price: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    line_total: Decimal = Field(default=Decimal("0.00"), decimal_places=2, max_digits=12)
    taxable: bool = Field(default=False, index=True)
    sort_order: int = Field(default=0, index=True)
    created_at: datetime
    updated_at: datetime


class LaborEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    work_date: date = Field(index=True)
    client_id: int = Field(foreign_key="client.id", index=True)
    project_id: int | None = Field(default=None, foreign_key="project.id", index=True)
    status: LaborStatus = Field(default=LaborStatus.completed, index=True)
    service_type: str = Field(index=True, max_length=120)
    hours: Decimal = Field(decimal_places=2, max_digits=8)
    hourly_rate: Decimal = Field(decimal_places=2, max_digits=10)
    invoice_id: int | None = Field(default=None, foreign_key="invoice.id", index=True)
    invoice_number: str | None = Field(default=None, index=True, max_length=80)
    is_invoiced: bool = Field(default=False, index=True)
    notes: str | None = Field(default=None, max_length=1000)
    created_at: datetime
    updated_at: datetime


class Receipt(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    original_filename: str = Field(max_length=255)
    stored_filename: str = Field(unique=True, max_length=255)
    file_path: str = Field(max_length=600)
    content_type: str = Field(max_length=120)
    file_size_bytes: int
    uploaded_at: datetime = Field(index=True)
    vendor_name: str | None = Field(default=None, index=True, max_length=160)
    receipt_date: date | None = Field(default=None, index=True)
    total_amount: Decimal | None = Field(default=None, decimal_places=2, max_digits=12)
    tax_amount: Decimal | None = Field(default=None, decimal_places=2, max_digits=12)
    category: str | None = Field(default=None, index=True, max_length=80)
    status: ReceiptStatus = Field(default=ReceiptStatus.needs_review, index=True)
    linked_type: str | None = Field(default=None, index=True, max_length=40)
    linked_id: int | None = Field(default=None, index=True)
    notes: str | None = Field(default=None, max_length=2000)


class AppSetting(SQLModel, table=True):
    key: str = Field(primary_key=True, max_length=120)
    value: str = Field(default="", max_length=4000)
    updated_at: datetime


class DropdownOption(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kind: DropdownKind = Field(index=True)
    label: str = Field(index=True, max_length=120)
    color: str | None = Field(default=None, max_length=40)
    sort_order: int = Field(default=0, index=True)
    is_active: bool = Field(default=True, index=True)
    created_at: datetime
    updated_at: datetime


class BackupRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    filename: str = Field(max_length=255)
    file_size_bytes: int
    created_at: datetime
    created_by_user_id: int | None = Field(default=None, foreign_key="user.id")
    backup_version: int = 1
    included_database: bool = True
    included_uploads: bool = True
    notes: str | None = Field(default=None, max_length=1000)


class RestoreRecord(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    uploaded_filename: str = Field(max_length=255)
    restored_at: datetime
    restored_by_user_id: int | None = Field(default=None, foreign_key="user.id")
    source_backup_created_at: datetime | None = None
    pre_restore_backup_filename: str | None = Field(default=None, max_length=255)
    status: str = Field(default="completed", max_length=40)
    notes: str | None = Field(default=None, max_length=1000)

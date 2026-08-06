import re
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP

from django.contrib.contenttypes.fields import GenericForeignKey, GenericRelation
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q, Sum
from django.utils import timezone

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value):
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def upload_path(instance, filename):
    stamp = timezone.localdate().strftime("%Y/%m")
    return f"uploads/{stamp}/{filename}"


def current_year():
    """Retained because the initial database migration imports this callable."""
    return timezone.localdate().year


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BusinessProfile(TimestampedModel):
    business_name = models.CharField(max_length=160, default="ForgedSystems")
    abbreviation = models.CharField(max_length=12, default="FS")
    email = models.EmailField(blank=True)
    website = models.URLField(blank=True)
    logo = models.ImageField(upload_to="branding/", blank=True, null=True)
    sales_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("7.00"))
    admin_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"))
    default_hourly_rate = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("100.00"))
    default_labor_minimum = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("2.00"))
    quote_valid_days = models.PositiveSmallIntegerField(default=30)
    income_tax_reserve_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("30.00"))
    conservative_sales_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("7.00"))
    quote_acceptance_text = models.TextField(
        default="By signing below, the client acknowledges the scope, pricing, and payment terms shown above and authorizes the work to proceed."
    )
    invoice_acknowledgement_text = models.TextField(
        default="By signing below, the client acknowledges the scope, pricing, payment terms, and completed work shown above."
    )

    def save(self, *args, **kwargs):
        self.pk = 1
        self.abbreviation = re.sub(r"[^A-Za-z0-9]", "", self.abbreviation).upper()[:12] or "FS"
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        return cls.objects.first() or cls.objects.create()

    def __str__(self):
        return self.business_name


class AccountingCategory(TimestampedModel):
    class Group(models.TextChoices):
        INCOME = "income", "Income"
        COGS = "cogs", "Cost of Goods Sold"
        EXPENSE = "expense", "Business Expenses"

    group = models.CharField(max_length=16, choices=Group.choices)
    name = models.CharField(max_length=120)
    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["group", "sort_order", "name"]
        constraints = [models.UniqueConstraint(fields=["group", "name"], name="uniq_category_group_name")]

    def __str__(self):
        return self.name


class TermClause(TimestampedModel):
    class AppliesTo(models.TextChoices):
        QUOTE = "quote", "Quote"
        INVOICE = "invoice", "Invoice"
        BOTH = "both", "Quote and invoice"

    name = models.CharField(max_length=120)
    body = models.TextField()
    applies_to = models.CharField(max_length=12, choices=AppliesTo.choices, default=AppliesTo.BOTH)
    selected_by_default = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class DiscountProgram(TimestampedModel):
    name = models.CharField(max_length=120, unique=True)
    percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"))
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.percentage}%)"


class Vendor(TimestampedModel):
    name = models.CharField(max_length=160, unique=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CatalogItem(TimestampedModel):
    class Kind(models.TextChoices):
        MATERIAL = "material", "Material or service"
        LABOR = "labor", "Labor"

    class Unit(models.TextChoices):
        EACH = "ea", "Each"
        PIECE = "pc", "Piece"
        FOOT = "ft", "Foot"
        HOUR = "hr", "Hour"
        DAY = "day", "Day"
        LOT = "lot", "Lot"
        BOX = "box", "Box"
        PACK = "pack", "Pack"
        GALLON = "gal", "Gallon"
        POUND = "lb", "Pound"

    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.MATERIAL)
    name = models.CharField(max_length=160)
    description = models.CharField(max_length=300, blank=True)
    unit = models.CharField(max_length=12, choices=Unit.choices, default=Unit.EACH)
    default_rate = models.DecimalField(max_digits=11, decimal_places=2, default=ZERO)
    taxable = models.BooleanField(default=True)
    income_category = models.ForeignKey(AccountingCategory, blank=True, null=True, on_delete=models.SET_NULL)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "name"]
        constraints = [models.UniqueConstraint(fields=["kind", "name"], name="uniq_catalog_kind_name")]

    def __str__(self):
        return self.name


class DocumentSequence(models.Model):
    class Kind(models.TextChoices):
        PROJECT = "PROJECT", "Project"
        QUOTE = "QUOTE", "Quote"
        INVOICE = "INVOICE", "Invoice"

    kind = models.CharField(max_length=12, choices=Kind.choices)
    sequence_date = models.DateField()
    last_value = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "sequence_date"], name="uniq_document_sequence")]


def next_document_number(kind, document_date=None):
    document_date = document_date or timezone.localdate()
    with transaction.atomic():
        sequence, _ = DocumentSequence.objects.select_for_update().get_or_create(
            kind=kind, sequence_date=document_date
        )
        sequence.last_value += 1
        sequence.save(update_fields=["last_value"])
    profile = BusinessProfile.get_solo()
    return f"{profile.abbreviation}-{kind}-{document_date:%Y%m%d}-{sequence.last_value:03d}"


class Client(TimestampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    name = models.CharField(max_length=160, help_text="Client or company name")
    primary_contact = models.CharField(max_length=160, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    email = models.EmailField(blank=True)
    billing_address = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def primary_service_address(self):
        return self.addresses.filter(is_primary=True).first()


class ClientAddress(TimestampedModel):
    client = models.ForeignKey(Client, related_name="addresses", on_delete=models.CASCADE)
    label = models.CharField(max_length=80, default="Primary service address")
    address_line_1 = models.CharField(max_length=160)
    address_line_2 = models.CharField(max_length=160, blank=True)
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=40, default="NY")
    postal_code = models.CharField(max_length=20)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ["client", "-is_primary", "label"]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_primary:
            ClientAddress.objects.filter(client=self.client).exclude(pk=self.pk).update(is_primary=False)

    def __str__(self):
        return f"{self.label}: {self.address_line_1}, {self.city}, {self.state} {self.postal_code}"


class Project(TimestampedModel):
    class Status(models.TextChoices):
        SUPPORT_ACTIVE = "support_active", "Active"
        LEAD = "lead", "Lead"
        PENDING_SITE_VISIT = "pending_site_visit", "Pending Site Visit"
        PENDING_QUOTE = "pending_quote", "Pending Quote"
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        IN_PROGRESS = "in_progress", "In Progress"
        PENDING_INVOICE = "pending_invoice", "Pending Invoice"
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting Payment"
        WAITING_PARTS = "waiting_parts", "Waiting for Parts"
        ON_HOLD = "on_hold", "On-Hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        ARCHIVED = "archived", "Archived"

    project_number = models.CharField(max_length=64, unique=True, editable=False, blank=True)
    client = models.ForeignKey(Client, related_name="projects", on_delete=models.PROTECT)
    name = models.CharField(max_length=180)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.LEAD)
    service_address = models.ForeignKey(ClientAddress, blank=True, null=True, on_delete=models.SET_NULL)
    internal_notes = models.TextField(blank=True)
    client_notes = models.TextField(blank=True)
    is_support_project = models.BooleanField(default=False)
    hourly_rate = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("100.00"))
    labor_minimum_hours = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("2.00"))
    archived_at = models.DateTimeField(blank=True, null=True)
    attachments = GenericRelation("Attachment", related_query_name="projects")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["client", "status"], name="idx_project_client_status"),
            models.Index(fields=["status", "updated_at"], name="idx_project_status_updated"),
        ]

    def save(self, *args, **kwargs):
        if not self.project_number:
            self.project_number = next_document_number(DocumentSequence.Kind.PROJECT)
        if self.is_support_project:
            self.status = self.Status.SUPPORT_ACTIVE if self.client.status == Client.Status.ACTIVE else self.Status.ARCHIVED
        if self.status in {self.Status.COMPLETED, self.Status.ARCHIVED} and not self.archived_at:
            self.archived_at = timezone.now()
        elif self.status not in {self.Status.COMPLETED, self.Status.ARCHIVED} and self.archived_at:
            self.archived_at = None
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.project_number} · {self.name}"

    @property
    def labor_minutes(self):
        return self.labor_entries.filter(billable=True).aggregate(total=Sum("actual_minutes"))["total"] or 0

    @property
    def payments_total(self):
        return money(self.payments.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"])

    @property
    def expenses_total(self):
        return money(self.expenses.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"])

    @property
    def revenue_total(self):
        return money(
            PaymentAllocation.objects.filter(payment__project=self, payment__voided_at__isnull=True, kind=PaymentAllocation.Kind.REVENUE).aggregate(total=Sum("amount"))["total"]
        )

    @property
    def cash_profit(self):
        return money(self.payments_total - self.expenses_total)


class QuoteGroup(TimestampedModel):
    project = models.ForeignKey(Project, related_name="quote_groups", on_delete=models.CASCADE)
    name = models.CharField(max_length=180)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [models.UniqueConstraint(fields=["project", "name"], name="uniq_quote_group_project_name")]

    def __str__(self):
        return self.name


class Quote(TimestampedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        AWAITING_APPROVAL = "awaiting_approval", "Awaiting Approval"
        NOT_APPROVED = "not_approved", "Not Approved"
        APPROVED_PENDING = "approved_pending", "Approved — Payment Pending"
        APPROVED_PAID = "approved_paid", "Approved — Paid"
        EXPIRED = "expired", "Expired"
        VOID = "void", "Void"
        SUPERSEDED = "superseded", "Superseded"

    project = models.ForeignKey(Project, related_name="quotes", on_delete=models.PROTECT)
    group = models.ForeignKey(QuoteGroup, related_name="quotes", blank=True, null=True, on_delete=models.SET_NULL)
    name = models.CharField(max_length=180)
    quote_number = models.CharField(max_length=64, unique=True, blank=True, null=True, editable=False)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.DRAFT)
    issue_date = models.DateField(blank=True, null=True)
    expires_on = models.DateField(blank=True, null=True)
    estimated_labor_hours = models.DecimalField(max_digits=7, decimal_places=2, default=ZERO)
    labor_rate = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("100.00"))
    labor_minimum_hours = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("2.00"))
    labor_taxable = models.BooleanField(default=True)
    sales_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("7.00"))
    admin_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"))
    labor_category = models.ForeignKey(
        AccountingCategory, blank=True, null=True, related_name="quotes_labor", on_delete=models.SET_NULL
    )
    labor_catalog_item = models.ForeignKey(
        CatalogItem, blank=True, null=True, related_name="quotes", on_delete=models.SET_NULL
    )
    discount_label = models.CharField(max_length=120, blank=True)
    labor_discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=ZERO)
    internal_notes = models.TextField(blank=True)
    client_notes = models.TextField(blank=True)
    replaced_by = models.OneToOneField("self", blank=True, null=True, related_name="replaces", on_delete=models.SET_NULL)
    selected_terms = models.ManyToManyField(TermClause, blank=True, related_name="draft_quotes")
    attachments = GenericRelation("Attachment", related_query_name="quotes")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"], name="idx_quote_project_status"),
            models.Index(fields=["issue_date", "status"], name="idx_quote_issue_status"),
        ]

    def __str__(self):
        return self.quote_number or f"Draft quote · {self.name}"

    @property
    def items_subtotal(self):
        return money(sum((item.line_total for item in self.items.all()), ZERO))

    @property
    def taxable_items_subtotal(self):
        return money(sum((item.line_total for item in self.items.all() if item.taxable), ZERO))

    @property
    def surcharges_total(self):
        return money(self.surcharges.aggregate(total=Sum("amount"))["total"])

    @property
    def materials_tax(self):
        taxable_base = self.taxable_items_subtotal + self.surcharges_total
        return money(taxable_base * self.sales_tax_rate / 100)

    @property
    def administrative_fee(self):
        base = self.items_subtotal + self.surcharges_total + self.materials_tax
        return money(base * self.admin_fee_rate / 100)

    @property
    def parts_total(self):
        return money(self.items_subtotal + self.surcharges_total + self.materials_tax + self.administrative_fee)

    @property
    def estimated_billable_hours(self):
        return max(money(self.estimated_labor_hours), money(self.labor_minimum_hours))

    @property
    def labor_subtotal(self):
        return money(self.estimated_billable_hours * self.labor_rate)

    @property
    def labor_tax(self):
        if not self.labor_taxable:
            return ZERO
        return money(self.labor_subtotal * self.sales_tax_rate / 100)

    @property
    def labor_discount_credit(self):
        return money(self.labor_subtotal * self.labor_discount_percent / 100)

    @property
    def estimated_total(self):
        return money(self.parts_total + self.labor_subtotal + self.labor_tax - self.labor_discount_credit)

    @property
    def payments_total(self):
        return money(self.payments.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"])

    @property
    def balance(self):
        return max(ZERO, money(self.parts_total - self.payments_total))

    @property
    def is_issued(self):
        return bool(self.quote_number)


class QuoteItem(TimestampedModel):
    quote = models.ForeignKey(Quote, related_name="items", on_delete=models.CASCADE)
    catalog_item = models.ForeignKey(CatalogItem, blank=True, null=True, related_name="quote_items", on_delete=models.SET_NULL)
    description = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("1.00"))
    unit = models.CharField(max_length=12, choices=CatalogItem.Unit.choices, default=CatalogItem.Unit.EACH)
    unit_price = models.DecimalField(max_digits=11, decimal_places=2)
    taxable = models.BooleanField(default=True)
    income_category = models.ForeignKey(AccountingCategory, blank=True, null=True, on_delete=models.SET_NULL)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    @property
    def line_total(self):
        return money(self.quantity * self.unit_price)


class QuoteSurcharge(TimestampedModel):
    quote = models.ForeignKey(Quote, related_name="surcharges", on_delete=models.CASCADE)
    label = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=11, decimal_places=2)

    class Meta:
        ordering = ["id"]


class Invoice(TimestampedModel):
    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "In Progress"
        SENT_PENDING = "sent_pending", "Sent — Payment Pending"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    class PaymentTerms(models.TextChoices):
        RECEIPT = "receipt", "Due on Receipt"
        NET7 = "net7", "Net-7"
        NET14 = "net14", "Net-14"
        NET30 = "net30", "Net-30"
        CUSTOM = "custom", "Custom Due Date"

    project = models.ForeignKey(Project, related_name="invoices", on_delete=models.PROTECT)
    name = models.CharField(max_length=180, default="Final Invoice")
    invoice_number = models.CharField(max_length=64, unique=True, blank=True, null=True, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.IN_PROGRESS)
    issue_date = models.DateField(blank=True, null=True)
    due_date = models.DateField(blank=True, null=True)
    payment_terms = models.CharField(max_length=12, choices=PaymentTerms.choices, default=PaymentTerms.RECEIPT)
    labor_taxable = models.BooleanField(default=True)
    sales_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("7.00"))
    admin_fee_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("10.00"))
    minimum_adjustment_hours = models.DecimalField(max_digits=6, decimal_places=2, default=ZERO)
    internal_notes = models.TextField(blank=True)
    client_notes = models.TextField(blank=True)
    selected_terms = models.ManyToManyField(TermClause, blank=True, related_name="draft_invoices")
    attachments = GenericRelation("Attachment", related_query_name="invoices")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"], name="idx_invoice_project_status"),
            models.Index(fields=["due_date", "status"], name="idx_invoice_due_status"),
        ]

    def __str__(self):
        return self.invoice_number or f"Draft invoice · {self.name}"

    @property
    def labor_subtotal(self):
        total = sum((entry.billable_amount for entry in self.labor_entries.all()), ZERO)
        if self.minimum_adjustment_hours:
            total += self.minimum_adjustment_hours * self.project.hourly_rate
        return money(total)

    @property
    def materials_subtotal(self):
        return money(sum((item.line_total for item in self.items.all()), ZERO))

    @property
    def taxable_materials_subtotal(self):
        return money(sum((item.line_total for item in self.items.all() if item.taxable), ZERO))

    @property
    def surcharges_total(self):
        return money(self.surcharges.aggregate(total=Sum("amount"))["total"])

    @property
    def materials_tax(self):
        taxable_base = self.taxable_materials_subtotal + self.surcharges_total
        return money(taxable_base * self.sales_tax_rate / 100)

    @property
    def labor_tax(self):
        if not self.labor_taxable:
            return ZERO
        return money(self.labor_subtotal * self.sales_tax_rate / 100)

    @property
    def administrative_fee(self):
        base = self.materials_subtotal + self.surcharges_total + self.materials_tax
        return money(base * self.admin_fee_rate / 100)

    @property
    def credits_total(self):
        return money(self.credits.aggregate(total=Sum("amount"))["total"])

    @property
    def total(self):
        return max(
            ZERO,
            money(
                self.labor_subtotal
                + self.labor_tax
                + self.materials_subtotal
                + self.surcharges_total
                + self.materials_tax
                + self.administrative_fee
                - self.credits_total
            ),
        )

    @property
    def payments_total(self):
        return money(self.payments.filter(voided_at__isnull=True).aggregate(total=Sum("amount"))["total"])

    @property
    def balance(self):
        return max(ZERO, money(self.total - self.payments_total))

    @property
    def is_overdue(self):
        return bool(self.due_date and self.balance > 0 and timezone.localdate() > self.due_date)

    @property
    def is_issued(self):
        return bool(self.invoice_number)


class InvoiceItem(TimestampedModel):
    invoice = models.ForeignKey(Invoice, related_name="items", on_delete=models.CASCADE)
    catalog_item = models.ForeignKey(CatalogItem, blank=True, null=True, related_name="invoice_items", on_delete=models.SET_NULL)
    description = models.CharField(max_length=300)
    quantity = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("1.00"))
    unit = models.CharField(max_length=12, choices=CatalogItem.Unit.choices, default=CatalogItem.Unit.EACH)
    unit_price = models.DecimalField(max_digits=11, decimal_places=2)
    taxable = models.BooleanField(default=True)
    income_category = models.ForeignKey(AccountingCategory, blank=True, null=True, on_delete=models.SET_NULL)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]

    @property
    def line_total(self):
        return money(self.quantity * self.unit_price)


class InvoiceSurcharge(TimestampedModel):
    invoice = models.ForeignKey(Invoice, related_name="surcharges", on_delete=models.CASCADE)
    label = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=11, decimal_places=2)

    class Meta:
        ordering = ["id"]


class LaborEntry(TimestampedModel):
    project = models.ForeignKey(Project, related_name="labor_entries", on_delete=models.PROTECT)
    invoice = models.ForeignKey(Invoice, related_name="labor_entries", blank=True, null=True, on_delete=models.SET_NULL)
    catalog_item = models.ForeignKey(CatalogItem, related_name="labor_entries", blank=True, null=True, on_delete=models.SET_NULL)
    work_date = models.DateField(default=timezone.localdate)
    description = models.TextField()
    actual_minutes = models.PositiveIntegerField(help_text="Actual time worked in minutes")
    billable_hours_override = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)
    hourly_rate = models.DecimalField(max_digits=9, decimal_places=2, default=Decimal("100.00"))
    category = models.ForeignKey(AccountingCategory, blank=True, null=True, on_delete=models.SET_NULL)
    billable = models.BooleanField(default=True)

    class Meta:
        ordering = ["-work_date", "-created_at"]
        indexes = [models.Index(fields=["project", "invoice", "work_date"], name="idx_labor_project_invoice")]

    @property
    def actual_hours(self):
        return Decimal(self.actual_minutes) / Decimal(60)

    @property
    def effective_billable_hours(self):
        if not self.billable:
            return ZERO
        if self.billable_hours_override is not None:
            return money(self.billable_hours_override)
        quarter_hours = (Decimal(self.actual_minutes) / Decimal(15)).to_integral_value(rounding=ROUND_CEILING)
        return money(quarter_hours / Decimal(4))

    @property
    def billable_amount(self):
        return money(self.effective_billable_hours * self.hourly_rate)


class ProjectCredit(TimestampedModel):
    project = models.ForeignKey(Project, related_name="credits", on_delete=models.PROTECT)
    label = models.CharField(max_length=160, default="Client overpayment credit")
    original_amount = models.DecimalField(max_digits=11, decimal_places=2)
    remaining_amount = models.DecimalField(max_digits=11, decimal_places=2)
    source_payment = models.OneToOneField("Payment", related_name="generated_credit", on_delete=models.PROTECT)

    def __str__(self):
        return f"{self.project}: {self.remaining_amount} available"


class InvoiceCredit(TimestampedModel):
    invoice = models.ForeignKey(Invoice, related_name="credits", on_delete=models.CASCADE)
    label = models.CharField(max_length=160)
    amount = models.DecimalField(max_digits=11, decimal_places=2)
    reason = models.TextField()
    project_credit = models.ForeignKey(ProjectCredit, blank=True, null=True, related_name="applications", on_delete=models.PROTECT)


class Payment(TimestampedModel):
    payment_date = models.DateField(default=timezone.localdate)
    amount = models.DecimalField(max_digits=11, decimal_places=2)
    client = models.ForeignKey(Client, related_name="payments", on_delete=models.PROTECT)
    project = models.ForeignKey(Project, related_name="payments", on_delete=models.PROTECT)
    quote = models.ForeignKey(Quote, related_name="payments", blank=True, null=True, on_delete=models.PROTECT)
    invoice = models.ForeignKey(Invoice, related_name="payments", blank=True, null=True, on_delete=models.PROTECT)
    notes = models.TextField(blank=True)
    voided_at = models.DateTimeField(blank=True, null=True)
    void_reason = models.TextField(blank=True)
    attachments = GenericRelation("Attachment", related_query_name="payments")

    class Meta:
        ordering = ["-payment_date", "-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(quote__isnull=False, invoice__isnull=True) | Q(quote__isnull=True, invoice__isnull=False)),
                name="payment_exactly_one_document",
            )
        ]
        indexes = [models.Index(fields=["payment_date", "project"], name="idx_payment_date_project")]

    def clean(self):
        if bool(self.quote_id) == bool(self.invoice_id):
            raise ValidationError("Choose exactly one quote or invoice.")
        document = self.quote or self.invoice
        if document and document.project_id != self.project_id:
            raise ValidationError("The payment document must belong to the selected project.")
        if self.project_id and self.project.client_id != self.client_id:
            raise ValidationError("The selected project must belong to the selected client.")

    @property
    def document(self):
        return self.quote or self.invoice

    @property
    def is_voided(self):
        return self.voided_at is not None


class PaymentAllocation(TimestampedModel):
    class Kind(models.TextChoices):
        REVENUE = "revenue", "Revenue"
        SALES_TAX = "sales_tax", "Sales Tax Collected"
        CREDIT = "credit", "Unapplied Client Credit"

    payment = models.ForeignKey(Payment, related_name="allocations", on_delete=models.CASCADE)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    category = models.ForeignKey(AccountingCategory, blank=True, null=True, on_delete=models.SET_NULL)
    label = models.CharField(max_length=160)
    amount = models.DecimalField(max_digits=11, decimal_places=2)


class Expense(TimestampedModel):
    class Type(models.TextChoices):
        PROJECT = "project", "Project Expense"
        BUSINESS = "business", "Business Expense"

    expense_type = models.CharField(max_length=12, choices=Type.choices)
    expense_date = models.DateField(default=timezone.localdate)
    amount = models.DecimalField(max_digits=11, decimal_places=2)
    client = models.ForeignKey(Client, related_name="expenses", blank=True, null=True, on_delete=models.PROTECT)
    project = models.ForeignKey(Project, related_name="expenses", blank=True, null=True, on_delete=models.PROTECT)
    quote = models.ForeignKey(Quote, related_name="expenses", blank=True, null=True, on_delete=models.SET_NULL)
    invoice = models.ForeignKey(Invoice, related_name="expenses", blank=True, null=True, on_delete=models.SET_NULL)
    vendor = models.ForeignKey(Vendor, related_name="expenses", blank=True, null=True, on_delete=models.SET_NULL)
    category = models.ForeignKey(AccountingCategory, related_name="expenses", on_delete=models.PROTECT)
    description = models.TextField()
    voided_at = models.DateTimeField(blank=True, null=True)
    void_reason = models.TextField(blank=True)
    attachments = GenericRelation("Attachment", related_query_name="expenses")

    class Meta:
        ordering = ["-expense_date", "-created_at"]
        indexes = [models.Index(fields=["expense_type", "expense_date"], name="idx_expense_type_date")]

    def clean(self):
        if self.expense_type == self.Type.PROJECT and not self.project_id:
            raise ValidationError("Project expenses require a project.")
        if self.project_id and self.client_id != self.project.client_id:
            raise ValidationError("The selected client must own the project.")
        if self.expense_type == self.Type.BUSINESS and (self.client_id or self.project_id):
            raise ValidationError("Business expenses cannot be linked to a client or project.")
        if self.quote_id and self.project_id and self.quote.project_id != self.project_id:
            raise ValidationError("The selected quote belongs to a different project.")
        if self.invoice_id and self.project_id and self.invoice.project_id != self.project_id:
            raise ValidationError("The selected invoice belongs to a different project.")

    @property
    def is_voided(self):
        return self.voided_at is not None


class LedgerCorrection(TimestampedModel):
    class Action(models.TextChoices):
        EDIT = "edit", "Edited"
        VOID = "void", "Voided"
        REINSTATE = "reinstate", "Reinstated"

    payment = models.ForeignKey(Payment, blank=True, null=True, related_name="corrections", on_delete=models.CASCADE)
    expense = models.ForeignKey(Expense, blank=True, null=True, related_name="corrections", on_delete=models.CASCADE)
    action = models.CharField(max_length=12, choices=Action.choices)
    reason = models.TextField()
    before_data = models.JSONField(default=dict, blank=True)
    after_data = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(payment__isnull=False, expense__isnull=True) | Q(payment__isnull=True, expense__isnull=False)),
                name="ledger_correction_exactly_one_entry",
            )
        ]

    @property
    def entry(self):
        return self.payment or self.expense


class Note(TimestampedModel):
    class Visibility(models.TextChoices):
        INTERNAL = "internal", "Internal"
        CLIENT = "client", "Client-Facing"

    client = models.ForeignKey(Client, related_name="record_notes", blank=True, null=True, on_delete=models.CASCADE)
    project = models.ForeignKey(Project, related_name="record_notes", blank=True, null=True, on_delete=models.CASCADE)
    visibility = models.CharField(max_length=12, choices=Visibility.choices, default=Visibility.INTERNAL)
    body = models.TextField()

    class Meta:
        ordering = ["-created_at"]


class ProjectActivity(models.Model):
    project = models.ForeignKey(Project, related_name="activity", on_delete=models.CASCADE)
    occurred_at = models.DateTimeField(default=timezone.now)
    event_type = models.CharField(max_length=40)
    title = models.CharField(max_length=180)
    details = models.TextField(blank=True)

    class Meta:
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["project", "-occurred_at"], name="idx_activity_project_time")]


class Attachment(TimestampedModel):
    class Visibility(models.TextChoices):
        INTERNAL = "internal", "Internal"
        CLIENT = "client", "Client-Facing"

    class Kind(models.TextChoices):
        GENERAL = "general", "General"
        RECEIPT = "receipt", "Receipt"
        SIGNED = "signed", "Signed Copy"
        PHOTO = "photo", "Project Photo"

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveBigIntegerField()
    content_object = GenericForeignKey("content_type", "object_id")
    file = models.FileField(upload_to=upload_path)
    label = models.CharField(max_length=160, blank=True)
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.GENERAL)
    visibility = models.CharField(max_length=12, choices=Visibility.choices, default=Visibility.INTERNAL)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["content_type", "object_id"], name="idx_attachment_object")]


class DocumentTermSnapshot(models.Model):
    quote = models.ForeignKey(Quote, related_name="term_snapshots", blank=True, null=True, on_delete=models.CASCADE)
    invoice = models.ForeignKey(Invoice, related_name="term_snapshots", blank=True, null=True, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    body = models.TextField()
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(quote__isnull=False, invoice__isnull=True) | Q(quote__isnull=True, invoice__isnull=False)),
                name="term_snapshot_exactly_one_document",
            )
        ]

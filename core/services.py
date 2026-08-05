import io
import json
import shutil
import tempfile
import zipfile
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone

from .models import (
    AccountingCategory,
    Attachment,
    BusinessProfile,
    DiscountProgram,
    DocumentSequence,
    DocumentTermSnapshot,
    Invoice,
    InvoiceCredit,
    Payment,
    PaymentAllocation,
    Project,
    ProjectActivity,
    ProjectCredit,
    Quote,
    TermClause,
    money,
    next_document_number,
)


DEFAULT_CATEGORIES = {
    AccountingCategory.Group.INCOME: [
        "Client Labor",
        "Client Materials",
        "Installation",
        "Service",
        "Sale of Product (SoP) — Computer Parts & Accessories",
        "Sale of Product (SoP) — Networking Parts & Accessories",
        "Sale of Product (SoP) — Security Parts & Accessories",
        "Administrative/Coordination Fees",
    ],
    AccountingCategory.Group.COGS: [
        "COGS — Computer Parts & Accessories",
        "COGS — Networking Parts & Accessories",
        "COGS — Security Parts & Accessories",
        "COGS — Software & Applications",
    ],
    AccountingCategory.Group.EXPENSE: [
        "Tools & Equipment",
        "Office Supplies",
        "Renewals",
        "Gas & Mileage",
        "General Business Expenses",
        "Sales Tax Paid",
        "Income Tax Paid",
    ],
}

DEFAULT_TERMS = [
    (
        "Equipment payment required upfront",
        "Full payment for equipment, materials, applicable sales tax, vendor surcharges, and administrative/coordination fees is due before equipment is ordered.",
        TermClause.AppliesTo.QUOTE,
    ),
    (
        "Labor billed after completion",
        "Labor shown is an estimate only and will be billed after work is completed based on actual billable time.",
        TermClause.AppliesTo.BOTH,
    ),
    (
        "Two-hour labor minimum",
        "Unless otherwise stated, a two-hour minimum labor charge applies.",
        TermClause.AppliesTo.BOTH,
    ),
    (
        "Additional labor",
        "Labor exceeding the estimate will be billed at the current standard hourly rate.",
        TermClause.AppliesTo.QUOTE,
    ),
    (
        "Quote validity",
        "This quote is valid for 30 days from its issue date. Equipment pricing and availability are subject to change after the quote expires.",
        TermClause.AppliesTo.QUOTE,
    ),
    (
        "Payment due on receipt",
        "The invoice balance is due upon receipt unless another due date is shown.",
        TermClause.AppliesTo.INVOICE,
    ),
]


def seed_defaults():
    BusinessProfile.get_solo()
    for group, names in DEFAULT_CATEGORIES.items():
        for order, name in enumerate(names):
            category, _ = AccountingCategory.objects.get_or_create(
                group=group,
                name=name,
                defaults={"sort_order": order},
            )
            if category.sort_order != order:
                category.sort_order = order
                category.save(update_fields=["sort_order", "updated_at"])
    for order, (name, body, applies_to) in enumerate(DEFAULT_TERMS):
        TermClause.objects.get_or_create(
            name=name,
            defaults={"body": body, "applies_to": applies_to, "sort_order": order},
        )
    for name in ["Military", "First Responder", "Teacher"]:
        DiscountProgram.objects.get_or_create(name=name, defaults={"percentage": Decimal("10.00")})


def category(name):
    return AccountingCategory.objects.filter(name=name, active=True).first()


def record_activity(project, event_type, title, details=""):
    return ProjectActivity.objects.create(
        project=project,
        event_type=event_type,
        title=title,
        details=details,
    )


def snapshot_terms(document):
    selected = document.selected_terms.filter(active=True).order_by("sort_order", "name")
    if isinstance(document, Quote):
        DocumentTermSnapshot.objects.filter(quote=document).delete()
        DocumentTermSnapshot.objects.bulk_create(
            [
                DocumentTermSnapshot(quote=document, name=term.name, body=term.body, sort_order=index)
                for index, term in enumerate(selected)
            ]
        )
    else:
        DocumentTermSnapshot.objects.filter(invoice=document).delete()
        DocumentTermSnapshot.objects.bulk_create(
            [
                DocumentTermSnapshot(invoice=document, name=term.name, body=term.body, sort_order=index)
                for index, term in enumerate(selected)
            ]
        )


@transaction.atomic
def issue_quote(quote):
    if quote.quote_number:
        return quote
    profile = BusinessProfile.get_solo()
    today = timezone.localdate()
    quote.quote_number = next_document_number(DocumentSequence.Kind.QUOTE, today)
    quote.issue_date = today
    quote.expires_on = today + timedelta(days=profile.quote_valid_days)
    quote.status = Quote.Status.AWAITING_APPROVAL
    quote.save()
    snapshot_terms(quote)
    record_activity(quote.project, "quote_issued", f"Quote issued: {quote.quote_number}", quote.name)
    return quote


@transaction.atomic
def approve_quote(quote):
    quote.status = Quote.Status.APPROVED_PAID if quote.balance <= 0 else Quote.Status.APPROVED_PENDING
    quote.save(update_fields=["status", "updated_at"])
    if quote.group_id:
        quote.group.quotes.exclude(pk=quote.pk).filter(
            status=Quote.Status.AWAITING_APPROVAL
        ).update(status=Quote.Status.NOT_APPROVED)
    record_activity(quote.project, "quote_approved", f"Quote approved: {quote}")


@transaction.atomic
def _copy_quote(original, *, name, group):
    copy = Quote.objects.create(
        project=original.project,
        group=group,
        name=name,
        estimated_labor_hours=original.estimated_labor_hours,
        labor_rate=original.labor_rate,
        labor_minimum_hours=original.labor_minimum_hours,
        labor_taxable=original.labor_taxable,
        sales_tax_rate=original.sales_tax_rate,
        admin_fee_rate=original.admin_fee_rate,
        labor_category=original.labor_category,
        discount_label=original.discount_label,
        labor_discount_percent=original.labor_discount_percent,
        internal_notes=original.internal_notes,
        client_notes=original.client_notes,
    )
    for item in original.items.all():
        copy.items.create(
            description=item.description,
            quantity=item.quantity,
            unit_price=item.unit_price,
            taxable=item.taxable,
            income_category=item.income_category,
            sort_order=item.sort_order,
        )
    for surcharge in original.surcharges.all():
        copy.surcharges.create(label=surcharge.label, amount=surcharge.amount)
    copy.selected_terms.set(original.selected_terms.all())
    return copy


@transaction.atomic
def replace_quote(original):
    replacement = _copy_quote(
        original,
        name=f"{original.name} — Revision",
        group=original.group,
    )
    original.replaced_by = replacement
    original.status = Quote.Status.SUPERSEDED
    original.save(update_fields=["replaced_by", "status", "updated_at"])
    record_activity(original.project, "quote_replaced", f"Quote replaced: {original}", f"New draft: {replacement.name}")
    return replacement


@transaction.atomic
def duplicate_quote_option(original):
    group = original.group
    if not group:
        group_name = f"{original.project.name} Options"
        group, _ = original.project.quote_groups.get_or_create(name=group_name)
        original.group = group
        original.save(update_fields=["group", "updated_at"])
    option_number = group.quotes.count() + 1
    duplicate = _copy_quote(
        original,
        name=f"{original.name} — Option {option_number}",
        group=group,
    )
    record_activity(
        original.project,
        "quote_option_created",
        f"Related quote option created: {duplicate.name}",
        f"Copied from {original}",
    )
    return duplicate


@transaction.atomic
def issue_invoice(invoice):
    if invoice.invoice_number:
        return invoice
    today = timezone.localdate()
    invoice.invoice_number = next_document_number(DocumentSequence.Kind.INVOICE, today)
    invoice.issue_date = today
    days = {
        Invoice.PaymentTerms.RECEIPT: 0,
        Invoice.PaymentTerms.NET7: 7,
        Invoice.PaymentTerms.NET14: 14,
        Invoice.PaymentTerms.NET30: 30,
    }.get(invoice.payment_terms)
    if days is not None:
        invoice.due_date = today + timedelta(days=days)
    raw_hours = sum((entry.effective_billable_hours for entry in invoice.labor_entries.all()), Decimal("0"))
    prior_hours = sum(
        (
            entry.effective_billable_hours
            for entry in invoice.project.labor_entries.exclude(invoice=invoice).filter(invoice__invoice_number__isnull=False)
        ),
        Decimal("0"),
    )
    prior_adjustments = (
        Invoice.objects.filter(project=invoice.project, invoice_number__isnull=False)
        .exclude(pk=invoice.pk)
        .aggregate(total=Sum("minimum_adjustment_hours"))["total"]
        or Decimal("0")
    )
    minimum = invoice.project.labor_minimum_hours
    invoice.minimum_adjustment_hours = (
        max(Decimal("0"), minimum - prior_hours - prior_adjustments - raw_hours)
        if raw_hours > 0
        else Decimal("0")
    )
    invoice.status = Invoice.Status.PAID if invoice.total <= 0 else Invoice.Status.SENT_PENDING
    invoice.save()
    snapshot_terms(invoice)
    record_activity(invoice.project, "invoice_issued", f"Invoice issued: {invoice.invoice_number}", invoice.name)
    return invoice


def _document_components(document):
    components = defaultdict(Decimal)
    sales_tax = Decimal("0")
    default_labor_category = category("Client Labor")
    default_material_category = category("Client Materials")
    if isinstance(document, Quote):
        for item in document.items.all():
            cat = item.income_category or default_material_category
            components[("revenue", cat, cat.name if cat else "Materials")] += item.line_total
        material_cat = default_material_category
        if document.surcharges_total:
            components[("revenue", material_cat, material_cat.name if material_cat else "Materials")] += document.surcharges_total
        admin_cat = category("Administrative/Coordination Fees")
        components[("revenue", admin_cat, "Administrative/Coordination Fees")] += document.administrative_fee
        sales_tax = document.materials_tax
        target_total = document.parts_total
    else:
        for entry in document.labor_entries.all():
            cat = entry.category or default_labor_category
            components[("revenue", cat, cat.name if cat else "Client Labor")] += entry.billable_amount
        if document.minimum_adjustment_hours:
            cat = default_labor_category
            components[("revenue", cat, cat.name if cat else "Client Labor")] += money(
                document.minimum_adjustment_hours * document.project.hourly_rate
            )
        for item in document.items.all():
            cat = item.income_category or default_material_category
            components[("revenue", cat, cat.name if cat else "Materials")] += item.line_total
        material_cat = default_material_category
        if document.surcharges_total:
            components[("revenue", material_cat, material_cat.name if material_cat else "Materials")] += document.surcharges_total
        admin_cat = category("Administrative/Coordination Fees")
        components[("revenue", admin_cat, "Administrative/Coordination Fees")] += document.administrative_fee
        if document.credits_total:
            components[("credit", None, "Credits and discounts")] -= document.credits_total
        sales_tax = document.materials_tax + document.labor_tax
        target_total = document.total
    components[("sales_tax", None, "Sales Tax Collected")] += sales_tax
    return components, money(target_total)


@transaction.atomic
def finalize_payment(payment, balance_before):
    payment.allocations.all().delete()
    components, document_total = _document_components(payment.document)
    applied = min(money(payment.amount), money(balance_before))
    scale = Decimal("0") if document_total <= 0 else applied / document_total
    allocated = Decimal("0")
    entries = list(components.items())
    for index, ((kind, cat, label), amount) in enumerate(entries):
        allocation_amount = money(amount * scale)
        if index == len(entries) - 1:
            allocation_amount = money(applied - allocated)
        allocated += allocation_amount
        PaymentAllocation.objects.create(
            payment=payment,
            kind=kind,
            category=cat,
            label=label,
            amount=allocation_amount,
        )
    excess = money(payment.amount - applied)
    if excess > 0:
        PaymentAllocation.objects.create(
            payment=payment,
            kind=PaymentAllocation.Kind.CREDIT,
            label="Unapplied Client Credit",
            amount=excess,
        )
        ProjectCredit.objects.create(
            project=payment.project,
            label=f"Credit from {payment.document}",
            original_amount=excess,
            remaining_amount=excess,
            source_payment=payment,
        )
    if payment.quote:
        payment.quote.status = Quote.Status.APPROVED_PAID if payment.quote.balance <= 0 else Quote.Status.APPROVED_PENDING
        payment.quote.save(update_fields=["status", "updated_at"])
    else:
        payment.invoice.status = Invoice.Status.PAID if payment.invoice.balance <= 0 else Invoice.Status.SENT_PENDING
        payment.invoice.save(update_fields=["status", "updated_at"])
    record_activity(payment.project, "payment", f"Client payment recorded: ${payment.amount}", str(payment.document))


@transaction.atomic
def apply_project_credit(invoice, project_credit, amount, reason):
    amount = money(amount)
    if amount <= 0 or amount > project_credit.remaining_amount:
        raise ValueError("Credit amount exceeds the available project credit.")
    if project_credit.project_id != invoice.project_id:
        raise ValueError("The credit belongs to a different project.")
    InvoiceCredit.objects.create(
        invoice=invoice,
        label=project_credit.label,
        amount=amount,
        reason=reason,
        project_credit=project_credit,
    )
    project_credit.remaining_amount = money(project_credit.remaining_amount - amount)
    project_credit.save(update_fields=["remaining_amount", "updated_at"])
    record_activity(invoice.project, "credit", f"Project credit applied: ${amount}", invoice.name)


def save_attachments(target, files, label="", kind=Attachment.Kind.GENERAL, visibility=Attachment.Visibility.INTERNAL):
    content_type = ContentType.objects.get_for_model(target, for_concrete_model=False)
    created = []
    for uploaded in files:
        created.append(
            Attachment.objects.create(
                content_type=content_type,
                object_id=target.pk,
                file=uploaded,
                label=label or uploaded.name,
                kind=kind,
                visibility=visibility,
            )
        )
    return created


def expire_quotes():
    today = timezone.localdate()
    return Quote.objects.filter(
        expires_on__lt=today,
        status=Quote.Status.AWAITING_APPROVAL,
    ).update(status=Quote.Status.EXPIRED)


def create_backup_zip():
    settings.BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    timestamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    output_path = settings.BACKUP_ROOT / f"forgeops-backup-{timestamp}.zip"
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        db_copy = temp_path / "forgeops.sqlite3"
        connection.ensure_connection()
        source = connection.connection
        import sqlite3

        destination = sqlite3.connect(db_copy)
        source.backup(destination)
        destination.close()
        manifest = {
            "app": "ForgeOps",
            "created_at": timezone.now().isoformat(),
            "format_version": 1,
            "includes": ["database", "media"],
        }
        (temp_path / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(db_copy, "data/forgeops.sqlite3")
            archive.write(temp_path / "manifest.json", "manifest.json")
            if settings.MEDIA_ROOT.exists():
                for file_path in settings.MEDIA_ROOT.rglob("*"):
                    if file_path.is_file():
                        archive.write(file_path, f"media/{file_path.relative_to(settings.MEDIA_ROOT)}")
    return output_path

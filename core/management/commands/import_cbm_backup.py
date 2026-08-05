import base64
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from core.models import (
    AccountingCategory,
    Attachment,
    BusinessProfile,
    Client,
    ClientAddress,
    DocumentSequence,
    DocumentTermSnapshot,
    Expense,
    Invoice,
    InvoiceCredit,
    InvoiceItem,
    InvoiceSurcharge,
    LaborEntry,
    Note,
    Payment,
    PaymentAllocation,
    Project,
    ProjectActivity,
    ProjectCredit,
    Quote,
    QuoteGroup,
    QuoteItem,
    QuoteSurcharge,
    Vendor,
    money,
)
from core.services import record_activity, seed_defaults


CENT = Decimal("0.01")


def decimal_value(value):
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def normalized(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


class Command(BaseCommand):
    help = "Import a Contractor Business Manager JSON backup into ForgeOps."

    def add_arguments(self, parser):
        parser.add_argument("backup_file", type=Path)
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Replace all current ForgeOps business records while preserving login accounts and app configuration.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Validate and reconcile the import, then roll back without writing data or receipt files.",
        )

    def handle(self, *args, **options):
        if not options["replace"]:
            raise CommandError("This importer requires --replace so the destructive scope is explicit.")
        backup_file = options["backup_file"].resolve()
        if not backup_file.is_file():
            raise CommandError(f"Backup file not found: {backup_file}")
        try:
            payload = json.loads(backup_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise CommandError(f"Could not read the CBM backup: {error}") from error
        if payload.get("format") != "contractor-business-manager-backup" or payload.get("version") != 1:
            raise CommandError("Unsupported backup format or version.")
        if not isinstance(payload.get("records"), list) or not isinstance(payload.get("attachments", []), list):
            raise CommandError("Backup records or attachments are malformed.")

        self.payload = payload
        self.records = payload["records"]
        self.by_type = defaultdict(list)
        for record in self.records:
            if not record.get("id") or not record.get("type") or not isinstance(record.get("data"), dict):
                raise CommandError("Every backup record must have an id, type, and data object.")
            self.by_type[record["type"]].append(record)
        self.dry_run = options["dry_run"]
        self.new_files = []
        self.old_files = list(Attachment.objects.exclude(file="").values_list("file", flat=True))
        self.imported = Counter()
        self.warnings = []
        self.clients = {}
        self.addresses = {}
        self.projects = {}
        self.quotes = {}
        self.invoices = {}
        self.vendors = {}
        self.ledger_targets = {}

        try:
            with transaction.atomic():
                self._reset_business_data()
                seed_defaults()
                self._import_profile_and_categories()
                self._import_vendors()
                self._import_clients_and_addresses()
                self._import_projects()
                self._import_quotes()
                self._import_invoices()
                self._import_labor()
                self._import_invoice_credits()
                self._import_ledger()
                self._import_attachments()
                self._record_import_activity()
                self._verify_reconciliation()
                if self.dry_run:
                    transaction.set_rollback(True)
        except Exception:
            for name in self.new_files:
                if default_storage.exists(name):
                    default_storage.delete(name)
            raise

        if not self.dry_run:
            for name in self.old_files:
                if name and not Attachment.objects.filter(file=name).exists() and default_storage.exists(name):
                    default_storage.delete(name)
        self._write_summary()

    def _reset_business_data(self):
        Attachment.objects.all().delete()
        DocumentTermSnapshot.objects.all().delete()
        ProjectActivity.objects.all().delete()
        Note.objects.all().delete()
        InvoiceCredit.objects.all().delete()
        ProjectCredit.objects.all().delete()
        PaymentAllocation.objects.all().delete()
        Payment.objects.all().delete()
        Expense.objects.all().delete()
        LaborEntry.objects.all().delete()
        InvoiceSurcharge.objects.all().delete()
        InvoiceItem.objects.all().delete()
        Invoice.objects.all().delete()
        QuoteSurcharge.objects.all().delete()
        QuoteItem.objects.all().delete()
        Quote.objects.all().delete()
        QuoteGroup.objects.all().delete()
        Project.objects.all().delete()
        ClientAddress.objects.all().delete()
        Client.objects.all().delete()
        Vendor.objects.all().delete()
        DocumentSequence.objects.all().delete()

    def _import_profile_and_categories(self):
        profile_record = self.by_type.get("profile", [None])[0]
        if not profile_record:
            raise CommandError("The backup does not contain a business profile.")
        data = profile_record["data"]
        profile = BusinessProfile.get_solo()
        profile.business_name = data.get("businessName") or profile.business_name
        profile.email = data.get("email") or ""
        profile.abbreviation = self._profile_abbreviation(data)
        profile.default_hourly_rate = decimal_value(data.get("defaultLaborRate") or 100)
        profile.admin_fee_rate = decimal_value(data.get("quoteMarkupPercent") or 10)
        profile.income_tax_reserve_rate = decimal_value(data.get("incomeTaxReserveRate") or 30)
        profile.sales_tax_rate = Decimal("7.00")
        profile.conservative_sales_tax_rate = Decimal("7.00")
        profile.quote_valid_days = 30
        profile.save()
        self.imported["profiles"] += 1

        groups = {
            "Income": AccountingCategory.Group.INCOME,
            "Cost of Goods Sold": AccountingCategory.Group.COGS,
            "Expenses": AccountingCategory.Group.EXPENSE,
        }
        for source_group, names in (data.get("categories") or {}).items():
            group = groups.get(source_group)
            if not group:
                continue
            for name in names or []:
                self._category(group, name)

    def _profile_abbreviation(self, data):
        prefix = data.get("quotePrefix") or "FS-QUOTE"
        abbreviation = str(prefix).split("-")[0]
        return abbreviation or "FS"

    def _category(self, group, source_name):
        source_name = str(source_name or "").strip()
        aliases = {
            (AccountingCategory.Group.INCOME, "services"): "Service",
            (AccountingCategory.Group.INCOME, "materials"): "Client Materials",
            (AccountingCategory.Group.INCOME, "sales of product"): "Client Materials",
            (AccountingCategory.Group.INCOME, "computer parts accessories"): "Sale of Product (SoP) — Computer Parts & Accessories",
            (AccountingCategory.Group.INCOME, "networking parts accessories"): "Sale of Product (SoP) — Networking Parts & Accessories",
            (AccountingCategory.Group.INCOME, "security parts accessories"): "Sale of Product (SoP) — Security Parts & Accessories",
            (AccountingCategory.Group.COGS, "cgs computer parts accessories"): "COGS — Computer Parts & Accessories",
            (AccountingCategory.Group.COGS, "cgs networking parts accessories"): "COGS — Networking Parts & Accessories",
            (AccountingCategory.Group.COGS, "cgs security parts accessories"): "COGS — Security Parts & Accessories",
            (AccountingCategory.Group.COGS, "cgs software apps"): "COGS — Software & Applications",
            (AccountingCategory.Group.EXPENSE, "tools"): "Tools & Equipment",
            (AccountingCategory.Group.EXPENSE, "tools and equipment"): "Tools & Equipment",
            (AccountingCategory.Group.EXPENSE, "supplies"): "Office Supplies",
            (AccountingCategory.Group.EXPENSE, "renewal"): "Renewals",
            (AccountingCategory.Group.EXPENSE, "gas mileage"): "Gas & Mileage",
            (AccountingCategory.Group.EXPENSE, "general business expense"): "General Business Expenses",
        }
        target_name = aliases.get((group, normalized(source_name)), source_name)
        if not target_name:
            target_name = {
                AccountingCategory.Group.INCOME: "Client Materials",
                AccountingCategory.Group.COGS: "Cost of Goods Sold",
                AccountingCategory.Group.EXPENSE: "General Business Expenses",
            }[group]
        category, _ = AccountingCategory.objects.get_or_create(group=group, name=target_name)
        return category

    def _import_vendors(self):
        for record in self.by_type.get("vendor", []):
            name = str(record["data"].get("name") or "").strip()
            if not name:
                continue
            vendor = Vendor.objects.create(name=name)
            self.vendors[normalized(name)] = vendor
            self._stamp(vendor, record)
            self.imported["vendors"] += 1

    def _vendor(self, payee):
        name = str(payee or "").strip()
        if not name:
            return None
        key = normalized(name)
        if "harbor freight" in key:
            key = normalized("Harbor Freight Tools")
        vendor = self.vendors.get(key)
        if vendor:
            return vendor
        vendor, _ = Vendor.objects.get_or_create(name=name)
        self.vendors[key] = vendor
        return vendor

    def _import_clients_and_addresses(self):
        for record in self.by_type.get("client", []):
            data = record["data"]
            status = Client.Status.ARCHIVED if normalized(data.get("status")) == "archived" else Client.Status.ACTIVE
            client = Client.objects.create(
                name=data.get("name") or "Imported client",
                primary_contact=data.get("contact") or "",
                phone=data.get("phone") or "",
                email=data.get("email") or "",
                billing_address=data.get("billingAddress") or "",
                notes=data.get("notes") or "",
                status=status,
            )
            self.clients[record["id"]] = client
            self._stamp(client, record)
            self.imported["clients"] += 1

        for record in self.by_type.get("location", []):
            data = record["data"]
            client = self.clients.get(data.get("clientId"))
            if not client:
                raise CommandError(f"Location {record['id']} references a missing client.")
            address = self._address_fields(data.get("address") or client.billing_address)
            location = ClientAddress.objects.create(
                client=client,
                label=data.get("name") or "Primary Site",
                is_primary=not client.addresses.exists(),
                **address,
            )
            self.addresses[record["id"]] = location
            self._stamp(location, record)
            self.imported["addresses"] += 1

    def _address_fields(self, value):
        parts = [part.strip() for part in str(value or "").split(",") if part.strip()]
        line = parts[0] if parts else "Address unavailable"
        city = parts[-2] if len(parts) >= 2 else "Unknown"
        state_postal = parts[-1].split(maxsplit=1) if len(parts) >= 3 else ["NY", ""]
        return {
            "address_line_1": line,
            "address_line_2": "",
            "city": city,
            "state": state_postal[0] if state_postal else "NY",
            "postal_code": state_postal[1] if len(state_postal) > 1 else "",
        }

    def _import_projects(self):
        statuses = {
            "completed": Project.Status.COMPLETED,
            "in progress": Project.Status.IN_PROGRESS,
            "lead": Project.Status.LEAD,
            "on hold": Project.Status.ON_HOLD,
            "cancelled": Project.Status.CANCELLED,
        }
        for record in self.by_type.get("project", []):
            data = record["data"]
            client = self.clients.get(data.get("clientId"))
            if not client:
                raise CommandError(f"Project {record['id']} references a missing client.")
            location = self.addresses.get(data.get("locationId")) or client.primary_service_address
            notes = "\n\n".join(filter(None, [data.get("description"), f"Imported next step: {data.get('nextStep')}" if data.get("nextStep") else ""]))
            project = Project.objects.create(
                client=client,
                name=data.get("title") or "Imported project",
                status=statuses.get(normalized(data.get("status")), Project.Status.LEAD),
                service_address=location,
                internal_notes=notes,
                hourly_rate=BusinessProfile.get_solo().default_hourly_rate,
                labor_minimum_hours=Decimal("2.00"),
            )
            self.projects[record["id"]] = project
            self._stamp(project, record)
            self.imported["projects"] += 1

    def _import_quotes(self):
        records_by_project = defaultdict(list)
        for record in self.by_type.get("quote", []):
            records_by_project[record["data"].get("projectId")].append(record)
        groups = {}
        for project_id, records in records_by_project.items():
            if len(records) > 1 and project_id in self.projects:
                project = self.projects[project_id]
                groups[project_id] = QuoteGroup.objects.create(project=project, name=f"{project.name} Options")

        income_rows = self.by_type.get("ledger", [])
        paid_quote_ids = {
            row["data"].get("quoteId")
            for row in income_rows
            if normalized(row["data"].get("accountType")) == "income" and row["data"].get("quoteId")
        }
        status_map = {
            "approved": Quote.Status.APPROVED_PAID,
            "sent": Quote.Status.AWAITING_APPROVAL,
            "expired": Quote.Status.EXPIRED,
            "not approved": Quote.Status.NOT_APPROVED,
            "void": Quote.Status.VOID,
            "draft": Quote.Status.DRAFT,
        }
        for record in self.by_type.get("quote", []):
            data = record["data"]
            project = self.projects.get(data.get("projectId"))
            if not project:
                raise CommandError(f"Quote {record['id']} references a missing project.")
            labor_lines = [line for line in data.get("lineItems") or [] if normalized(line.get("kind")) == "labor"]
            labor_hours = sum((decimal_value(line.get("quantity")) for line in labor_lines), Decimal("0"))
            labor_total = sum((decimal_value(line.get("quantity")) * decimal_value(line.get("price")) for line in labor_lines), Decimal("0"))
            source_labor_total = decimal_value(data.get("laborSubtotal")) if data.get("laborSubtotal") is not None else labor_total
            labor_rate = source_labor_total / labor_hours if labor_hours else BusinessProfile.get_solo().default_hourly_rate
            status = status_map.get(normalized(data.get("status")), Quote.Status.DRAFT)
            if normalized(data.get("status")) == "approved" and record["id"] not in paid_quote_ids:
                status = Quote.Status.APPROVED_PENDING
            labor_descriptions = [self._line_description(line) for line in labor_lines]
            internal_notes = "\n\n".join(filter(None, [data.get("notes"), f"Imported labor scope: {'; '.join(labor_descriptions)}" if labor_descriptions else ""]))
            quote = Quote.objects.create(
                project=project,
                group=groups.get(data.get("projectId")),
                name=data.get("title") or data.get("number") or "Imported quote",
                quote_number=data.get("number") or None,
                status=status,
                issue_date=parse_date(data.get("issuedDate") or ""),
                expires_on=parse_date(data.get("validUntil") or ""),
                estimated_labor_hours=labor_hours,
                labor_rate=labor_rate,
                labor_minimum_hours=Decimal("0.00"),
                labor_taxable=False,
                sales_tax_rate=decimal_value(data.get("taxRate") or 7),
                admin_fee_rate=decimal_value(data.get("markupRate") or 0),
                labor_category=self._labor_category(" ".join(labor_descriptions)),
                internal_notes=internal_notes,
            )
            self.quotes[record["id"]] = quote
            self._stamp(quote, record)
            for order, line in enumerate(data.get("lineItems") or []):
                if normalized(line.get("kind")) == "labor":
                    continue
                QuoteItem.objects.create(
                    quote=quote,
                    description=self._line_description(line),
                    quantity=decimal_value(line.get("quantity")),
                    unit_price=decimal_value(line.get("price")),
                    taxable=bool(line.get("taxable", True)),
                    income_category=self._material_category(project.name),
                    sort_order=order,
                )
                self.imported["quote_items"] += 1
            for label, value in [("Shipping", data.get("shipping")), ("Tariff", data.get("tariff"))]:
                if decimal_value(value) > 0:
                    QuoteSurcharge.objects.create(quote=quote, label=label, amount=decimal_value(value))
                    self.imported["quote_surcharges"] += 1
            self._snapshot_imported_terms(quote, data.get("terms"))
            self.imported["quotes"] += 1

    def _import_invoices(self):
        status_map = {
            "paid": Invoice.Status.PAID,
            "sent": Invoice.Status.SENT_PENDING,
            "in progress": Invoice.Status.IN_PROGRESS,
            "void": Invoice.Status.VOID,
        }
        for record in self.by_type.get("invoice", []):
            data = record["data"]
            project = self.projects.get(data.get("projectId"))
            if not project:
                raise CommandError(f"Invoice {record['id']} references a missing project.")
            taxable_materials = sum(
                (
                    decimal_value(line.get("quantity")) * decimal_value(line.get("price"))
                    for line in data.get("lineItems") or []
                    if line.get("taxable")
                ),
                Decimal("0"),
            )
            labor_taxable = decimal_value(data.get("taxableSubtotal")) > taxable_materials
            invoice = Invoice.objects.create(
                project=project,
                name=data.get("title") or data.get("number") or "Imported invoice",
                invoice_number=data.get("number") or None,
                status=status_map.get(normalized(data.get("status")), Invoice.Status.IN_PROGRESS),
                issue_date=parse_date(data.get("issuedDate") or ""),
                due_date=parse_date(data.get("dueDate") or ""),
                payment_terms=Invoice.PaymentTerms.RECEIPT,
                labor_taxable=labor_taxable,
                sales_tax_rate=decimal_value(data.get("taxRate") or 7),
                admin_fee_rate=Decimal("0.00"),
                internal_notes="\n\n".join(filter(None, [data.get("notes"), f"Imported source gross total: ${decimal_value(data.get('total'))}"])),
            )
            self.invoices[record["id"]] = invoice
            self._stamp(invoice, record)
            for order, line in enumerate(data.get("lineItems") or []):
                InvoiceItem.objects.create(
                    invoice=invoice,
                    description=self._line_description(line),
                    quantity=decimal_value(line.get("quantity")),
                    unit_price=decimal_value(line.get("price")),
                    taxable=bool(line.get("taxable", True)),
                    income_category=self._material_category(project.name, line.get("name")),
                    sort_order=order,
                )
                self.imported["invoice_items"] += 1
            self._snapshot_imported_terms(invoice, data.get("terms"))
            self.imported["invoices"] += 1

    def _import_labor(self):
        for record in self.by_type.get("labor", []):
            data = record["data"]
            project = self.projects.get(data.get("projectId"))
            if not project:
                raise CommandError(f"Labor {record['id']} references a missing project.")
            invoice = self.invoices.get(data.get("invoiceId"))
            hours = decimal_value(data.get("hours"))
            billable = hours > 0
            entry = LaborEntry.objects.create(
                project=project,
                invoice=invoice,
                work_date=parse_date(data.get("date") or "") or timezone.localdate(),
                description=" — ".join(filter(None, [data.get("serviceType"), data.get("notes")])),
                actual_minutes=max(0, int(hours * 60)),
                billable_hours_override=hours if billable else None,
                hourly_rate=decimal_value(data.get("rate") or 100),
                category=self._labor_category(data.get("serviceType")),
                billable=billable,
            )
            self._stamp(entry, record)
            if invoice and invoice.project_id != project.pk:
                self.warnings.append(
                    f"Source labor {record['id']} belongs to {project.name} but is attached to invoice {invoice.invoice_number} on {invoice.project.name}. The source relationship was preserved."
                )
            self.imported["labor_entries"] += 1

    def _import_invoice_credits(self):
        income_rows = [row for row in self.by_type.get("ledger", []) if normalized(row["data"].get("accountType")) == "income"]
        for record in self.by_type.get("invoice", []):
            data = record["data"]
            invoice = self.invoices[record["id"]]
            source_credits = Decimal("0")
            for payment in data.get("payments") or []:
                if normalized(payment.get("type")) not in {"credit", "adjustment"}:
                    continue
                amount = decimal_value(payment.get("amount"))
                InvoiceCredit.objects.create(
                    invoice=invoice,
                    label=payment.get("description") or "Imported invoice credit",
                    amount=amount,
                    reason="Imported from the source invoice payment/adjustment history.",
                )
                source_credits += amount
                self.imported["invoice_credits"] += 1
            linked_cash = sum(
                (
                    decimal_value(row["data"].get("amount"))
                    for row in income_rows
                    if row["data"].get("invoiceId") == record["id"]
                ),
                Decimal("0"),
            )
            if invoice.status == Invoice.Status.PAID:
                reconciliation = max(Decimal("0"), decimal_value(data.get("total")) - source_credits - linked_cash)
                if reconciliation > 0:
                    InvoiceCredit.objects.create(
                        invoice=invoice,
                        label="Imported paid-balance reconciliation",
                        amount=reconciliation,
                        reason="The source invoice was marked paid, but its ledger cash entry was lower than the source invoice payment total.",
                    )
                    self.imported["invoice_credits"] += 1
                    self.warnings.append(
                        f"Added a ${reconciliation} reconciliation credit to {invoice.invoice_number}; source ledger cash was ${linked_cash} against a ${decimal_value(data.get('total'))} gross invoice."
                    )

    def _import_ledger(self):
        for record in self.by_type.get("ledger", []):
            data = record["data"]
            account = normalized(data.get("accountType"))
            amount = decimal_value(data.get("amount"))
            if account == "income":
                project = self.projects.get(data.get("projectId"))
                quote = self.quotes.get(data.get("quoteId"))
                invoice = self.invoices.get(data.get("invoiceId"))
                if not project or bool(quote) == bool(invoice):
                    raise CommandError(f"Income ledger entry {record['id']} does not resolve to exactly one document.")
                payment = Payment.objects.create(
                    payment_date=parse_date(data.get("date") or "") or timezone.localdate(),
                    amount=amount,
                    client=project.client,
                    project=project,
                    quote=quote,
                    invoice=invoice,
                    notes=data.get("description") or "Imported client payment",
                )
                PaymentAllocation.objects.create(
                    payment=payment,
                    kind=PaymentAllocation.Kind.REVENUE,
                    category=self._category(AccountingCategory.Group.INCOME, data.get("category")),
                    label=f"Imported ledger income — {data.get('category') or 'Uncategorized'}",
                    amount=amount,
                )
                self.ledger_targets[record["id"]] = payment
                self._stamp(payment, record)
                self.imported["payments"] += 1
            else:
                is_project = account == "cost of goods sold" or normalized(data.get("businessType")) == "client"
                project = self.projects.get(data.get("projectId")) if is_project else None
                if is_project and not project:
                    raise CommandError(f"Project expense {record['id']} references a missing project.")
                group = AccountingCategory.Group.COGS if is_project else AccountingCategory.Group.EXPENSE
                expense = Expense.objects.create(
                    expense_type=Expense.Type.PROJECT if is_project else Expense.Type.BUSINESS,
                    expense_date=parse_date(data.get("date") or "") or timezone.localdate(),
                    amount=amount,
                    client=project.client if project else None,
                    project=project,
                    quote=self.quotes.get(data.get("quoteId")) if project else None,
                    invoice=self.invoices.get(data.get("invoiceId")) if project else None,
                    vendor=self._vendor(data.get("payee")),
                    category=self._category(group, data.get("category")),
                    description=data.get("description") or "Imported ledger expense",
                )
                self.ledger_targets[record["id"]] = expense
                self._stamp(expense, record)
                self.imported["expenses"] += 1

    def _import_attachments(self):
        attachments = {
            (item.get("workspaceId"), item.get("path")): item
            for item in self.payload.get("attachments", [])
            if item.get("workspaceId") and item.get("path") and item.get("data")
        }
        used = set()
        for record in self.by_type.get("ledger", []):
            data = record["data"]
            receipt_key = str(data.get("receiptKey") or "")
            if not receipt_key:
                continue
            workspace_id, separator, path = receipt_key.partition("/")
            source = attachments.get((workspace_id, path if separator else receipt_key))
            target = self.ledger_targets.get(record["id"])
            if not source or not target:
                self.warnings.append(f"Receipt for ledger entry {record['id']} could not be matched and was not imported.")
                continue
            try:
                content = base64.b64decode(source["data"], validate=True)
            except (ValueError, TypeError) as error:
                raise CommandError(f"Receipt {source['path']} contains invalid base64 data.") from error
            filename = Path(data.get("receiptName") or source["path"]).name
            attachment = Attachment(
                content_type=ContentType.objects.get_for_model(target, for_concrete_model=False),
                object_id=target.pk,
                label=data.get("receiptName") or filename,
                kind=Attachment.Kind.RECEIPT,
                visibility=Attachment.Visibility.INTERNAL,
            )
            if not self.dry_run:
                attachment.file.save(filename, ContentFile(content), save=False)
                self.new_files.append(attachment.file.name)
                attachment.save()
            used.add((workspace_id, path))
            self.imported["attachments"] += 1
        unused = set(attachments) - used
        for workspace_id, path in sorted(unused):
            self.warnings.append(f"Backup attachment {workspace_id}/{path} was not referenced by a ledger record.")

    def _record_import_activity(self):
        for project in self.projects.values():
            record_activity(
                project,
                "cbm_import",
                "Imported from Small Business Manager backup",
                f"Source backup created {self.payload.get('createdAt', 'at an unknown time')}.",
            )

    def _verify_reconciliation(self):
        tolerance = Decimal("0.01")
        for record in self.by_type.get("quote", []):
            source_total = decimal_value(record["data"].get("total"))
            imported_total = self.quotes[record["id"]].estimated_total
            if abs(source_total - imported_total) > tolerance:
                raise CommandError(
                    f"Quote reconciliation failed for {record['data'].get('number')}: source ${source_total}, ForgeOps ${imported_total}."
                )
        for record in self.by_type.get("invoice", []):
            source_total = decimal_value(record["data"].get("total"))
            invoice = self.invoices[record["id"]]
            imported_gross = money(invoice.total + invoice.credits_total)
            if abs(source_total - imported_gross) > tolerance:
                raise CommandError(
                    f"Invoice reconciliation failed for {record['data'].get('number')}: source gross ${source_total}, ForgeOps gross ${imported_gross}."
                )
            if invoice.status == Invoice.Status.PAID and invoice.balance > tolerance:
                raise CommandError(f"Paid invoice {invoice.invoice_number} still has a ${invoice.balance} balance after import.")
        source_income = sum(
            (
                decimal_value(record["data"].get("amount"))
                for record in self.by_type.get("ledger", [])
                if normalized(record["data"].get("accountType")) == "income"
            ),
            Decimal("0"),
        )
        imported_income = money(Payment.objects.aggregate(total_sum=Sum("amount"))["total_sum"])
        if abs(source_income - imported_income) > tolerance:
            raise CommandError(f"Income reconciliation failed: source ${source_income}, ForgeOps ${imported_income}.")

    def _line_description(self, line):
        name = str(line.get("name") or "Imported line").strip()
        description = str(line.get("description") or "").strip()
        if not description or normalized(description) == normalized(name):
            return name[:300]
        return f"{name}: {description}"[:300]

    def _material_category(self, project_name, item_name=""):
        context = normalized(f"{project_name} {item_name}")
        if any(word in context for word in ["camera", "security", "barn"]):
            return self._category(AccountingCategory.Group.INCOME, "Security Parts & Accessories")
        if any(word in context for word in ["network", "wifi", "wi fi", "access point", "unifi"]):
            return self._category(AccountingCategory.Group.INCOME, "Networking Parts & Accessories")
        return self._category(AccountingCategory.Group.INCOME, "Client Materials")

    def _labor_category(self, service_type):
        value = normalized(service_type)
        if "install" in value:
            return self._category(AccountingCategory.Group.INCOME, "Installation")
        if "troubleshoot" in value or "service" in value:
            return self._category(AccountingCategory.Group.INCOME, "Service")
        return self._category(AccountingCategory.Group.INCOME, "Client Labor")

    def _snapshot_imported_terms(self, document, terms):
        body = str(terms or "").strip()
        if not body:
            return
        kwargs = {"name": "Imported terms", "body": body, "sort_order": 0}
        if isinstance(document, Quote):
            kwargs["quote"] = document
        else:
            kwargs["invoice"] = document
        DocumentTermSnapshot.objects.create(**kwargs)

    def _stamp(self, instance, record):
        created = parse_datetime(str(record.get("createdAt") or ""))
        updated = parse_datetime(str(record.get("updatedAt") or ""))
        if created and timezone.is_naive(created):
            created = timezone.make_aware(created)
        if updated and timezone.is_naive(updated):
            updated = timezone.make_aware(updated)
        changes = {}
        if created:
            changes["created_at"] = created
        if updated:
            changes["updated_at"] = updated
        if changes:
            instance.__class__.objects.filter(pk=instance.pk).update(**changes)

    def _write_summary(self):
        mode = "DRY RUN — rolled back" if self.dry_run else "IMPORT COMPLETE"
        self.stdout.write(self.style.SUCCESS(mode))
        for label in sorted(self.imported):
            self.stdout.write(f"  {label}: {self.imported[label]}")
        self.stdout.write(f"  catalog records retained in source only: {len(self.by_type.get('catalog', []))}")
        if self.warnings:
            self.stdout.write(self.style.WARNING("Reconciliation notes:"))
            for warning in self.warnings:
                self.stdout.write(f"  - {warning}")

import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import call_command
from django.template.loader import get_template
from django.test import Client as TestClient, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import (
    AccountingCategory,
    BusinessProfile,
    Client,
    Expense,
    Invoice,
    InvoiceItem,
    InvoiceSurcharge,
    LaborEntry,
    Payment,
    Project,
    ProjectCredit,
    Quote,
    QuoteGroup,
    QuoteItem,
    QuoteSurcharge,
    TermClause,
    Vendor,
)
from .pdfs import invoice_pdf_bytes, project_packet_bytes, quote_pdf_bytes
from .services import finalize_payment, issue_invoice, issue_quote, seed_defaults
from .forms import InvoiceForm, LaborEntryForm, QuoteForm, SetupForm


class ForgeOpsCoreTests(TestCase):
    def setUp(self):
        seed_defaults()
        self.user = User.objects.create_user("owner", password="a-very-long-test-password")
        self.client_record = Client.objects.create(name="Northstar Family")
        self.project = self.client_record.projects.get(is_support_project=True)
        self.project.name = "Custom PC Build"
        self.project.is_support_project = False
        self.project.labor_minimum_hours = Decimal("2.00")
        self.project.save()
        self.labor_category = AccountingCategory.objects.get(name="Client Labor")
        self.material_category = AccountingCategory.objects.get(name="Client Materials")

    def test_client_signal_creates_support_project(self):
        client = Client.objects.create(name="Second Client")
        support = client.projects.get(is_support_project=True)
        self.assertEqual(support.name, "Support Calls")
        self.assertEqual(support.labor_minimum_hours, Decimal("0.00"))
        self.assertEqual(support.status, "support_active")

    def test_project_can_be_completed_and_reopened(self):
        web = TestClient()
        web.force_login(self.user)

        response = web.post(reverse("project_complete", args=[self.project.pk]))

        self.assertRedirects(response, reverse("project_detail", args=[self.project.pk]))
        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.COMPLETED)
        self.assertIsNotNone(self.project.archived_at)
        self.assertTrue(self.project.activity.filter(title="Project marked completed").exists())
        self.assertNotContains(web.get(reverse("project_list")), self.project.name)

        response = web.post(reverse("project_reopen", args=[self.project.pk]))

        self.assertRedirects(response, reverse("project_detail", args=[self.project.pk]))
        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.IN_PROGRESS)
        self.assertIsNone(self.project.archived_at)
        self.assertContains(web.get(reverse("project_list")), self.project.name)

    def test_support_calls_project_cannot_be_completed(self):
        client = Client.objects.create(name="Support Client")
        support = client.projects.get(is_support_project=True)
        web = TestClient()
        web.force_login(self.user)

        response = web.post(reverse("project_complete", args=[support.pk]))

        self.assertRedirects(response, reverse("project_detail", args=[support.pk]))
        support.refresh_from_db()
        self.assertEqual(support.status, Project.Status.SUPPORT_ACTIVE)

    def test_quote_math_issue_and_credit(self):
        profile = BusinessProfile.get_solo()
        quote = Quote.objects.create(
            project=self.project,
            name="Performance PC",
            estimated_labor_hours=Decimal("1.00"),
            labor_rate=Decimal("100.00"),
            labor_minimum_hours=Decimal("2.00"),
            sales_tax_rate=profile.sales_tax_rate,
            admin_fee_rate=profile.admin_fee_rate,
        )
        QuoteItem.objects.create(quote=quote, description="Parts", quantity=1, unit_price=Decimal("1000.00"), income_category=self.material_category)
        QuoteSurcharge.objects.create(quote=quote, label="Shipping", amount=Decimal("50.00"))
        QuoteSurcharge.objects.create(quote=quote, label="Memory surcharge", amount=Decimal("100.00"))
        self.assertEqual(quote.materials_tax, Decimal("80.50"))
        self.assertEqual(quote.administrative_fee, Decimal("123.05"))
        self.assertEqual(quote.parts_total, Decimal("1353.55"))
        self.assertEqual(quote.labor_subtotal, Decimal("200.00"))
        self.assertEqual(quote.estimated_total, Decimal("1567.55"))
        issue_quote(quote)
        self.assertTrue(quote.quote_number.startswith("FS-QUOTE-"))
        payment = Payment.objects.create(
            payment_date=timezone.localdate(),
            amount=Decimal("1553.55"),
            client=self.client_record,
            project=self.project,
            quote=quote,
        )
        finalize_payment(payment, quote.parts_total)
        credit = ProjectCredit.objects.get(source_payment=payment)
        self.assertEqual(credit.remaining_amount, Decimal("200.00"))
        self.assertEqual(sum(a.amount for a in payment.allocations.all()), payment.amount)

    def test_invoice_pdf_and_packet(self):
        invoice = Invoice.objects.create(project=self.project, name="Final labor")
        LaborEntry.objects.create(
            project=self.project,
            invoice=invoice,
            description="Traveled to client site, performed setup, returned to office",
            actual_minutes=90,
            hourly_rate=Decimal("100.00"),
            category=self.labor_category,
        )
        issue_invoice(invoice)
        self.assertEqual(invoice.labor_subtotal, Decimal("200.00"))
        self.assertEqual(invoice.labor_tax, Decimal("14.00"))
        self.assertTrue(invoice_pdf_bytes(invoice).startswith(b"%PDF"))
        self.assertTrue(project_packet_bytes(self.project).startswith(b"%PDF"))

    def test_zero_dollar_invoice_is_paid_when_issued(self):
        invoice = Invoice.objects.create(project=self.project, name="Included planning services")
        InvoiceItem.objects.create(
            invoice=invoice,
            description="Planning services included with project",
            quantity=Decimal("1.00"),
            unit_price=Decimal("0.00"),
            taxable=False,
        )

        issue_invoice(invoice)

        self.assertEqual(invoice.total, Decimal("0.00"))
        self.assertEqual(invoice.status, Invoice.Status.PAID)

    def test_project_cash_profit_is_collected_cash_minus_project_expenses(self):
        quote = Quote.objects.create(project=self.project, name="Cash profit test")
        QuoteItem.objects.create(
            quote=quote,
            description="Equipment",
            quantity=1,
            unit_price=Decimal("100.00"),
            income_category=self.material_category,
        )
        issue_quote(quote)
        Payment.objects.create(
            payment_date=timezone.localdate(),
            amount=Decimal("100.00"),
            client=self.client_record,
            project=self.project,
            quote=quote,
        )
        Expense.objects.create(
            expense_type=Expense.Type.PROJECT,
            expense_date=timezone.localdate(),
            amount=Decimal("40.00"),
            client=self.client_record,
            project=self.project,
            category=AccountingCategory.objects.filter(group=AccountingCategory.Group.COGS).first(),
            description="Project equipment",
        )

        self.assertEqual(self.project.cash_profit, Decimal("60.00"))

    def test_authenticated_pages_render(self):
        web = TestClient()
        web.force_login(self.user)
        quote = Quote.objects.create(project=self.project, name="Review quote")
        invoice = Invoice.objects.create(project=self.project, name="Review invoice")
        urls = [
            reverse("dashboard"),
            reverse("client_list"),
            reverse("client_detail", args=[self.client_record.pk]),
            reverse("project_list"),
            reverse("project_detail", args=[self.project.pk]),
            reverse("quote_detail", args=[quote.pk]),
            reverse("invoice_detail", args=[invoice.pk]),
            reverse("quick_labor"),
            reverse("expense_list"),
            reverse("reports"),
            reverse("settings_profile"),
        ]
        for url in urls:
            response = web.get(url)
            self.assertEqual(response.status_code, 200, url)

    def test_all_templates_compile(self):
        template_root = Path(settings.BASE_DIR) / "templates"
        for template_path in template_root.rglob("*.html"):
            get_template(template_path.relative_to(template_root).as_posix())

    def test_report_filters_match_selected_report_type(self):
        web = TestClient()
        web.force_login(self.user)
        month = web.get(reverse("reports"), {"range": "month", "year": 2026, "month": 8})
        self.assertContains(month, 'data-report-field="month"')
        self.assertContains(month, 'data-report-field="quarter" hidden')
        quarter = web.get(reverse("reports"), {"range": "quarter", "year": 2026, "quarter": 2})
        self.assertContains(quarter, 'data-report-field="month" hidden')
        self.assertContains(quarter, 'data-report-field="quarter"')
        year = web.get(reverse("reports"), {"range": "year", "year": 2026})
        self.assertContains(year, 'data-report-field="month" hidden')
        self.assertContains(year, 'data-report-field="quarter" hidden')

    def test_dashboard_excludes_support_projects_and_tax_payments_from_operations(self):
        support_client = Client.objects.create(name="Support Only Client")
        support_project = support_client.projects.get(is_support_project=True)
        for index in range(9):
            Project.objects.create(client=self.client_record, name=f"Active Project {index + 1}", status=Project.Status.IN_PROGRESS)
        Expense.objects.create(
            expense_type=Expense.Type.BUSINESS,
            amount=Decimal("100.00"),
            category=AccountingCategory.objects.get(name="Sales Tax Paid"),
            description="Quarterly tax payment",
        )
        Expense.objects.create(
            expense_type=Expense.Type.BUSINESS,
            amount=Decimal("25.00"),
            category=AccountingCategory.objects.get(name="General Business Expenses"),
            description="Operating expense",
        )

        web = TestClient()
        web.force_login(self.user)
        response = web.get(reverse("dashboard"))

        self.assertNotIn(support_project, list(response.context["attention_projects"]))
        self.assertEqual(response.context["attention_project_count"], 10)
        self.assertEqual(len(response.context["attention_projects"]), 8)
        self.assertEqual(response.context["business_expenses"], Decimal("25.00"))

    def test_document_terms_widgets_do_not_collapse_the_checkbox_container(self):
        quote = Quote.objects.create(project=self.project, name="Terms quote", labor_category=self.labor_category)
        invoice = Invoice.objects.create(project=self.project, name="Terms invoice")
        quote_form = QuoteForm(instance=quote, project=self.project)
        invoice_form = InvoiceForm(instance=invoice, project=self.project)
        self.assertNotIn("class", quote_form.fields["selected_terms"].widget.attrs)
        self.assertNotIn("class", invoice_form.fields["selected_terms"].widget.attrs)

    def test_payment_form_validates_with_selected_quote(self):
        quote = Quote.objects.create(project=self.project, name="Payment form quote")
        QuoteItem.objects.create(
            quote=quote,
            description="Equipment",
            quantity=1,
            unit_price=Decimal("100.00"),
            income_category=self.material_category,
        )
        issue_quote(quote)
        quote.status = Quote.Status.APPROVED_PENDING
        quote.save(update_fields=["status"])
        web = TestClient()
        web.force_login(self.user)
        response = web.post(
            reverse("payment_create", args=["quote", quote.pk]),
            {"payment_date": "2026-05-02", "amount": "100.00", "notes": "Test check"},
        )
        self.assertRedirects(response, reverse("quote_detail", args=[quote.pk]))
        self.assertEqual(Payment.objects.filter(quote=quote).count(), 1)

    def test_zero_hour_labor_is_only_allowed_when_nonbillable(self):
        data = {
            "work_date": "2026-04-03",
            "description": "Included project support",
            "hours": "0.00",
            "billable_hours_override": "",
            "hourly_rate": "100.00",
            "category": self.labor_category.pk,
        }
        nonbillable = LaborEntryForm(data, project=self.project)
        self.assertTrue(nonbillable.is_valid(), nonbillable.errors)
        billable = LaborEntryForm({**data, "billable": "on"}, project=self.project)
        self.assertFalse(billable.is_valid())
        self.assertIn("hours", billable.errors)

    def test_projects_page_uses_filter_menu_and_global_new_project_button(self):
        web = TestClient()
        web.force_login(self.user)
        response = web.get(reverse("project_list"))
        self.assertContains(response, "Filter: All active")
        self.assertContains(response, reverse("project_create_global"))
        self.assertNotContains(response, 'class="tabs"')

    def test_global_project_form_creates_address_inline_without_removed_fields(self):
        web = TestClient()
        web.force_login(self.user)
        form_page = web.get(reverse("project_create_global"))
        self.assertNotContains(form_page, "default_labor_category")
        self.assertNotContains(form_page, "default_material_category")
        self.assertNotContains(form_page, "site_visit_at")
        self.assertNotContains(form_page, "target_completion_date")
        self.assertContains(form_page, "+ Add a new service address")

        response = web.post(
            reverse("project_create_global"),
            {
                "client": self.client_record.pk,
                "name": "Network Refresh",
                "status": "lead",
                "service_address_choice": "__new__",
                "new_address_label": "Office",
                "new_address_line_1": "100 Main Street",
                "new_address_line_2": "",
                "new_address_city": "Albany",
                "new_address_state": "NY",
                "new_address_postal_code": "12207",
                "hourly_rate": "100.00",
                "labor_minimum_hours": "2.00",
                "internal_notes": "",
                "client_notes": "",
                "status_note": "",
            },
        )
        project = self.client_record.projects.get(name="Network Refresh")
        self.assertRedirects(response, reverse("project_detail", args=[project.pk]))
        self.assertEqual(project.service_address.label, "Office")

    def test_quote_and_invoice_creation_open_complete_workspaces(self):
        web = TestClient()
        web.force_login(self.user)

        quote_response = web.post(reverse("quote_create", args=[self.project.pk]))
        quote = self.project.quotes.get()
        self.assertRedirects(quote_response, reverse("quote_detail", args=[quote.pk]))
        quote_page = web.get(reverse("quote_detail", args=[quote.pk]))
        self.assertContains(quote_page, "Quote setup")
        self.assertContains(quote_page, "Equipment and materials")
        self.assertContains(quote_page, "Estimated labor")
        self.assertContains(quote_page, "Related quote set")
        self.assertNotContains(quote_page, "Shipping cost")
        self.assertNotContains(quote_page, "Discount label")
        self.assertNotContains(quote_page, "Labor discount percent")
        self.assertLess(quote_page.content.index(b"Equipment and materials"), quote_page.content.index(b"Estimated labor"))
        self.assertLess(quote_page.content.index(b"Estimated labor"), quote_page.content.index(b"Items subtotal"))

        invoice_response = web.post(reverse("invoice_create", args=[self.project.pk]))
        invoice = self.project.invoices.get()
        self.assertRedirects(invoice_response, reverse("invoice_detail", args=[invoice.pk]))
        invoice_page = web.get(reverse("invoice_detail", args=[invoice.pk]))
        self.assertContains(invoice_page, "Invoice setup")
        self.assertContains(invoice_page, reverse("invoice_labor_create", args=[invoice.pk]))
        self.assertNotContains(invoice_page, "Shipping cost")

        labor_response = web.post(
            reverse("invoice_labor_create", args=[invoice.pk]),
            {
                "work_date": "2026-08-05",
                "description": "Configured client network",
                "hours": "1.50",
                "billable_hours_override": "",
                "hourly_rate": "100.00",
                "category": self.labor_category.pk,
                "billable": "on",
            },
        )
        self.assertRedirects(labor_response, reverse("invoice_detail", args=[invoice.pk]))
        self.assertEqual(invoice.labor_entries.count(), 1)

    def test_related_quote_set_groups_options_and_rejects_unselected_issued_sibling(self):
        group = QuoteGroup.objects.create(project=self.project, name="PC Build Options")
        chosen = Quote.objects.create(project=self.project, group=group, name="Performance")
        sibling = Quote.objects.create(project=self.project, group=group, name="Balanced")
        QuoteItem.objects.create(quote=chosen, description="Parts", unit_price=Decimal("100.00"), income_category=self.material_category)
        QuoteItem.objects.create(quote=sibling, description="Parts", unit_price=Decimal("90.00"), income_category=self.material_category)
        issue_quote(chosen)
        issue_quote(sibling)

        from .services import approve_quote

        approve_quote(chosen)
        sibling.refresh_from_db()
        self.assertEqual(sibling.status, Quote.Status.NOT_APPROVED)

    def test_quote_editor_creates_related_set_inline(self):
        quote = Quote.objects.create(project=self.project, name="Option A", labor_category=self.labor_category)
        web = TestClient()
        web.force_login(self.user)
        response = web.post(
            reverse("quote_detail", args=[quote.pk]),
            {
                "name": "Option A",
                "group": "",
                "new_group_name": "PC Build Options",
                "estimated_labor_hours": "2.00",
                "labor_rate": "100.00",
                "labor_minimum_hours": "2.00",
                "labor_category": self.labor_category.pk,
                "discount_program": "",
                "client_notes": "",
                "internal_notes": "",
            },
        )
        self.assertRedirects(response, reverse("quote_detail", args=[quote.pk]))
        quote.refresh_from_db()
        self.assertEqual(quote.group.name, "PC Build Options")

    def test_invoice_due_date_is_automatic_for_standard_terms(self):
        invoice = Invoice.objects.create(project=self.project, name="Net invoice", payment_terms=Invoice.PaymentTerms.NET14)
        InvoiceItem.objects.create(invoice=invoice, description="Service", unit_price=Decimal("100.00"), income_category=self.material_category)
        issue_invoice(invoice)
        self.assertEqual(invoice.due_date, invoice.issue_date + timedelta(days=14))

    def test_project_expense_form_filters_projects_documents_and_creates_vendor_inline(self):
        other_client = Client.objects.create(name="Other Client")
        other_project = other_client.projects.get(is_support_project=True)
        archived = self.client_record.projects.create(name="Old Work", status=Project.Status.ARCHIVED)
        quote = Quote.objects.create(project=self.project, name="Expense quote")
        other_quote = Quote.objects.create(project=other_project, name="Other quote")
        category = AccountingCategory.objects.filter(group=AccountingCategory.Group.COGS).first()
        web = TestClient()
        web.force_login(self.user)

        page = web.get(reverse("expense_create", args=[Expense.Type.PROJECT]), {"client": self.client_record.pk, "project": self.project.pk})
        self.assertContains(page, self.project.name)
        self.assertContains(page, quote.name)
        self.assertContains(page, "+ Add a new vendor")
        self.assertQuerySetEqual(page.context["form"].fields["project"].queryset, [self.project])
        self.assertQuerySetEqual(page.context["form"].fields["quote"].queryset, [quote])

        response = web.post(
            reverse("expense_create", args=[Expense.Type.PROJECT]),
            {
                "expense_date": "2026-08-05",
                "amount": "125.00",
                "client": self.client_record.pk,
                "project": self.project.pk,
                "quote": quote.pk,
                "invoice": "",
                "vendor_choice": "__new__",
                "new_vendor_name": "Inline Vendor",
                "category": category.pk,
                "description": "Project parts",
            },
        )
        self.assertRedirects(response, reverse("expense_list"))
        self.assertTrue(Vendor.objects.filter(name="Inline Vendor").exists())

    def test_tax_payments_are_business_expense_categories(self):
        sales_tax = AccountingCategory.objects.get(name="Sales Tax Paid")
        income_tax = AccountingCategory.objects.get(name="Income Tax Paid")
        self.assertEqual(sales_tax.group, AccountingCategory.Group.EXPENSE)
        self.assertEqual(income_tax.group, AccountingCategory.Group.EXPENSE)
        web = TestClient()
        web.force_login(self.user)
        ledger = web.get(reverse("expense_list"))
        self.assertContains(ledger, "Ledger")
        self.assertNotContains(ledger, "Add payment")

    def test_client_detail_lists_quotes_and_invoices_across_projects(self):
        quote = Quote.objects.create(project=self.project, name="Client page quote")
        invoice = Invoice.objects.create(project=self.project, name="Client page invoice")
        web = TestClient()
        web.force_login(self.user)
        response = web.get(reverse("client_detail", args=[self.client_record.pk]))
        self.assertContains(response, quote.name)
        self.assertContains(response, invoice.name)

    def test_client_detail_shows_recent_records_with_independent_view_all_controls(self):
        projects = [
            self.client_record.projects.create(name=f"History project {index}")
            for index in range(6)
        ]
        quotes = [
            Quote.objects.create(project=self.project, name=f"History quote {index}")
            for index in range(6)
        ]
        invoices = [
            Invoice.objects.create(project=self.project, name=f"History invoice {index}")
            for index in range(6)
        ]
        web = TestClient()
        web.force_login(self.user)

        recent = web.get(reverse("client_detail", args=[self.client_record.pk]))

        self.assertEqual(len(recent.context["projects"]), 5)
        self.assertEqual(len(recent.context["quotes"]), 5)
        self.assertEqual(len(recent.context["invoices"]), 5)
        self.assertNotContains(recent, projects[0].name)
        self.assertNotContains(recent, quotes[0].name)
        self.assertNotContains(recent, invoices[0].name)
        self.assertContains(recent, "View all", count=3)

        expanded = web.get(
            reverse("client_detail", args=[self.client_record.pk]),
            {"quotes": "all"},
        )

        self.assertFalse(expanded.context["show_all_projects"])
        self.assertTrue(expanded.context["show_all_quotes"])
        self.assertFalse(expanded.context["show_all_invoices"])
        self.assertEqual(len(expanded.context["projects"]), 5)
        self.assertEqual(len(expanded.context["quotes"]), 6)
        self.assertEqual(len(expanded.context["invoices"]), 5)
        self.assertContains(expanded, quotes[0].name)

    def test_confirmations_use_the_forgeops_dialog(self):
        web = TestClient()
        web.force_login(self.user)
        response = web.get(reverse("quote_detail", args=[Quote.objects.create(project=self.project, name="Dialog test").pk]))
        self.assertContains(response, 'data-app-confirm')
        javascript = (settings.BASE_DIR / "static" / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("showAppConfirm", javascript)
        self.assertNotIn("window.confirm", javascript)

    def test_attachment_manager_lists_existing_files(self):
        payment = Payment.objects.create(
            payment_date=timezone.localdate(),
            amount=Decimal("25.00"),
            client=self.client_record,
            project=self.project,
            quote=Quote.objects.create(project=self.project, name="Receipt quote"),
        )
        from django.contrib.contenttypes.models import ContentType
        from django.core.files.base import ContentFile
        from .models import Attachment

        with tempfile.TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=Path(temp_dir)):
            attachment = Attachment.objects.create(
                content_type=ContentType.objects.get_for_model(payment),
                object_id=payment.pk,
                label="Imported check.jpg",
                kind=Attachment.Kind.RECEIPT,
                file=ContentFile(b"receipt", name="check.jpg"),
            )
            web = TestClient()
            web.force_login(self.user)
            response = web.get(reverse("attachment_add", args=["payment", payment.pk]))
            self.assertContains(response, "Imported check.jpg")
            self.assertContains(response, attachment.file.url)
            self.assertContains(response, reverse("attachment_delete", args=[attachment.pk]))

    def test_cbm_import_replaces_business_data_and_reconciles_historical_documents(self):
        payload = {
            "format": "contractor-business-manager-backup",
            "version": 1,
            "createdAt": "2026-08-05T18:06:07Z",
            "records": [
                {
                    "id": "profile-1",
                    "type": "profile",
                    "data": {
                        "businessName": "Forged Systems LLC",
                        "email": "owner@example.com",
                        "defaultLaborRate": 100,
                        "quoteMarkupPercent": 10,
                        "incomeTaxReserveRate": 30,
                        "quotePrefix": "FS-QUOTE",
                        "categories": {"Income": ["Client Labor", "Client Materials"], "Cost of Goods Sold": [], "Expenses": []},
                    },
                },
                {"id": "client-1", "type": "client", "data": {"name": "Imported Client", "status": "Active", "billingAddress": "1 Main St, Albany, NY 12207"}},
                {"id": "location-1", "type": "location", "data": {"clientId": "client-1", "name": "Primary Site", "address": "1 Main St, Albany, NY 12207"}},
                {"id": "project-1", "type": "project", "data": {"clientId": "client-1", "locationId": "location-1", "title": "Imported Project", "status": "In progress"}},
                {
                    "id": "quote-1",
                    "type": "quote",
                    "data": {
                        "projectId": "project-1",
                        "number": "FS-QUOTE-20260805-001",
                        "title": "Imported Quote",
                        "status": "Sent",
                        "issuedDate": "2026-08-05",
                        "validUntil": "2026-09-04",
                        "taxRate": 7,
                        "markupRate": 10,
                        "shipping": 10,
                        "tariff": 5,
                        "total": 335.36,
                        "lineItems": [
                            {"name": "Hardware", "quantity": 1, "price": 100, "taxable": True, "kind": "material"},
                            {"name": "Installation", "quantity": 2, "price": 100, "taxable": False, "kind": "labor"},
                        ],
                    },
                },
                {
                    "id": "invoice-1",
                    "type": "invoice",
                    "data": {
                        "projectId": "project-1",
                        "number": "FS-INV-20260805-001",
                        "title": "Imported Invoice",
                        "status": "Paid",
                        "issuedDate": "2026-08-05",
                        "dueDate": "2026-08-05",
                        "taxRate": 7,
                        "taxableSubtotal": 100,
                        "total": 107,
                        "payments": [],
                        "lineItems": [],
                    },
                },
                {"id": "labor-1", "type": "labor", "data": {"projectId": "project-1", "invoiceId": "invoice-1", "date": "2026-08-05", "serviceType": "Installation", "hours": 1, "rate": 100, "notes": "Installed hardware"}},
                {"id": "ledger-1", "type": "ledger", "data": {"date": "2026-08-05", "amount": 107, "accountType": "Income", "businessType": "Client", "category": "Client Labor", "projectId": "project-1", "invoiceId": "invoice-1", "description": "Client payment"}},
            ],
            "attachments": [],
        }
        with tempfile.TemporaryDirectory() as temp_dir, override_settings(MEDIA_ROOT=Path(temp_dir) / "media"):
            backup_path = Path(temp_dir) / "source.json"
            backup_path.write_text(json.dumps(payload), encoding="utf-8")
            call_command("import_cbm_backup", backup_path, replace=True, stdout=io.StringIO())

        self.assertEqual(Client.objects.get().name, "Imported Client")
        self.assertEqual(Project.objects.filter(is_support_project=False).get().name, "Imported Project")
        quote = Quote.objects.get()
        self.assertFalse(quote.labor_taxable)
        self.assertEqual(quote.estimated_total, Decimal("335.36"))
        invoice = Invoice.objects.get()
        self.assertTrue(invoice.labor_taxable)
        self.assertEqual(invoice.total, Decimal("107.00"))
        self.assertEqual(invoice.balance, Decimal("0.00"))
        self.assertEqual(Payment.objects.get().amount, Decimal("107.00"))

    def test_draft_document_lines_can_be_deleted_but_issued_lines_are_protected(self):
        web = TestClient()
        web.force_login(self.user)

        quote = Quote.objects.create(project=self.project, name="Draft quote")
        quote_item = QuoteItem.objects.create(
            quote=quote,
            description="Incorrect part",
            unit_price=Decimal("25.00"),
            income_category=self.material_category,
        )
        quote_surcharge = QuoteSurcharge.objects.create(quote=quote, label="Incorrect surcharge", amount=Decimal("5.00"))
        self.assertRedirects(web.post(reverse("quote_item_delete", args=[quote.pk, quote_item.pk])), reverse("quote_detail", args=[quote.pk]))
        self.assertRedirects(web.post(reverse("quote_surcharge_delete", args=[quote.pk, quote_surcharge.pk])), reverse("quote_detail", args=[quote.pk]))
        self.assertFalse(QuoteItem.objects.filter(pk=quote_item.pk).exists())
        self.assertFalse(QuoteSurcharge.objects.filter(pk=quote_surcharge.pk).exists())

        protected_item = QuoteItem.objects.create(
            quote=quote,
            description="Issued part",
            unit_price=Decimal("50.00"),
            income_category=self.material_category,
        )
        issue_quote(quote)
        web.post(reverse("quote_item_delete", args=[quote.pk, protected_item.pk]))
        self.assertTrue(QuoteItem.objects.filter(pk=protected_item.pk).exists())

        invoice = Invoice.objects.create(project=self.project, name="Draft invoice")
        invoice_item = InvoiceItem.objects.create(
            invoice=invoice,
            description="Incorrect invoice item",
            unit_price=Decimal("40.00"),
            income_category=self.material_category,
        )
        invoice_surcharge = InvoiceSurcharge.objects.create(invoice=invoice, label="Incorrect surcharge", amount=Decimal("3.00"))
        self.assertRedirects(web.post(reverse("invoice_item_delete", args=[invoice.pk, invoice_item.pk])), reverse("invoice_detail", args=[invoice.pk]))
        self.assertRedirects(web.post(reverse("invoice_surcharge_delete", args=[invoice.pk, invoice_surcharge.pk])), reverse("invoice_detail", args=[invoice.pk]))
        self.assertFalse(InvoiceItem.objects.filter(pk=invoice_item.pk).exists())
        self.assertFalse(InvoiceSurcharge.objects.filter(pk=invoice_surcharge.pk).exists())

        protected_invoice_item = InvoiceItem.objects.create(
            invoice=invoice,
            description="Issued invoice item",
            unit_price=Decimal("45.00"),
            income_category=self.material_category,
        )
        issue_invoice(invoice)
        web.post(reverse("invoice_item_delete", args=[invoice.pk, protected_invoice_item.pk]))
        self.assertTrue(InvoiceItem.objects.filter(pk=protected_invoice_item.pk).exists())

    def test_draft_invoice_labor_can_be_removed_or_deleted(self):
        web = TestClient()
        web.force_login(self.user)
        invoice = Invoice.objects.create(project=self.project, name="Labor invoice")
        labor = LaborEntry.objects.create(
            project=self.project,
            invoice=invoice,
            work_date=timezone.localdate(),
            description="Temporary labor entry",
            actual_minutes=60,
            hourly_rate=Decimal("100.00"),
            category=self.labor_category,
        )

        self.assertRedirects(web.post(reverse("invoice_remove_labor", args=[invoice.pk, labor.pk])), reverse("invoice_detail", args=[invoice.pk]))
        labor.refresh_from_db()
        self.assertIsNone(labor.invoice_id)

        labor.invoice = invoice
        labor.save(update_fields=["invoice", "updated_at"])
        self.assertRedirects(web.post(reverse("labor_delete", args=[self.project.pk, labor.pk])), reverse("invoice_detail", args=[invoice.pk]))
        self.assertFalse(LaborEntry.objects.filter(pk=labor.pk).exists())

        protected_labor = LaborEntry.objects.create(
            project=self.project,
            invoice=invoice,
            work_date=timezone.localdate(),
            description="Issued labor",
            actual_minutes=60,
            hourly_rate=Decimal("100.00"),
            category=self.labor_category,
        )
        issue_invoice(invoice)
        web.post(reverse("labor_delete", args=[self.project.pk, protected_labor.pk]))
        self.assertTrue(LaborEntry.objects.filter(pk=protected_labor.pk).exists())

    def test_duplicate_quote_option_creates_related_copy_without_superseding_original(self):
        term = TermClause.objects.create(
            name="Approval",
            body="Approval wording",
            applies_to=TermClause.AppliesTo.QUOTE,
        )
        original = Quote.objects.create(
            project=self.project,
            name="Performance PC",
            estimated_labor_hours=Decimal("2.00"),
            labor_rate=Decimal("100.00"),
            labor_category=self.labor_category,
        )
        original.selected_terms.add(term)
        QuoteItem.objects.create(
            quote=original,
            description="Computer parts",
            unit_price=Decimal("1000.00"),
            income_category=self.material_category,
        )
        QuoteSurcharge.objects.create(quote=original, label="Memory surcharge", amount=Decimal("50.00"))

        web = TestClient()
        web.force_login(self.user)
        response = web.post(reverse("quote_duplicate_option", args=[original.pk]))
        duplicate = Quote.objects.exclude(pk=original.pk).get()
        self.assertRedirects(response, reverse("quote_detail", args=[duplicate.pk]))
        original.refresh_from_db()
        self.assertEqual(original.status, Quote.Status.DRAFT)
        self.assertIsNotNone(original.group_id)
        self.assertEqual(duplicate.group_id, original.group_id)
        self.assertEqual(duplicate.items.get().description, "Computer parts")
        self.assertEqual(duplicate.surcharges.get().amount, Decimal("50.00"))
        self.assertEqual(list(duplicate.selected_terms.all()), [term])
        self.assertContains(web.get(reverse("quote_detail", args=[duplicate.pk])), "Duplicate as option")


class FirstRunTest(TestCase):
    def test_first_run_redirects_to_setup(self):
        response = TestClient().get("/")
        self.assertRedirects(response, reverse("setup"))

    def test_setup_password_minimum_is_eight_characters(self):
        base = {
            "username": "owner",
            "password_confirm": "xQ7!aB2#",
            "business_name": "Forged Systems",
            "abbreviation": "FS",
            "email": "",
            "website": "",
        }
        valid_form = SetupForm({**base, "password": "xQ7!aB2#"})
        self.assertTrue(valid_form.is_valid(), valid_form.errors)
        short_form = SetupForm({**base, "password": "xQ7!aB2", "password_confirm": "xQ7!aB2"})
        self.assertFalse(short_form.is_valid())
        self.assertIn("password", short_form.errors)

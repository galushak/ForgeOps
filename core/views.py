import calendar
import io
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_http_methods, require_POST

from .forms import (
    ApplyProjectCreditForm,
    AttachmentForm,
    BusinessProfileForm,
    CategoryForm,
    ClientAddressForm,
    ClientForm,
    DiscountProgramForm,
    ExpenseForm,
    InvoiceCreditForm,
    InvoiceForm,
    InvoiceItemForm,
    InvoiceSurchargeForm,
    LaborEntryForm,
    NoteForm,
    PaymentForm,
    ProjectForm,
    QuickLaborForm,
    QuoteForm,
    QuoteItemForm,
    QuoteSurchargeForm,
    SetupForm,
    TermClauseForm,
    VendorForm,
)
from .models import (
    AccountingCategory,
    Attachment,
    BusinessProfile,
    Client,
    ClientAddress,
    DiscountProgram,
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
    ProjectCredit,
    Quote,
    QuoteItem,
    QuoteSurcharge,
    TermClause,
    Vendor,
    money,
)
from .pdfs import invoice_pdf_bytes, project_packet_bytes, quote_pdf_bytes
from .services import (
    apply_project_credit,
    approve_quote,
    create_backup_zip,
    duplicate_quote_option,
    expire_quotes,
    finalize_payment,
    issue_invoice,
    issue_quote,
    record_activity,
    replace_quote,
    save_attachments,
    seed_defaults,
)


def healthz(request):
    return JsonResponse({"status": "ok", "app": "ForgeOps"})


@login_required
def protected_file(request, path):
    from django.conf import settings

    requested = (settings.MEDIA_ROOT / path).resolve()
    try:
        requested.relative_to(settings.MEDIA_ROOT.resolve())
    except ValueError as error:
        raise Http404 from error
    if not requested.is_file():
        raise Http404
    return FileResponse(open(requested, "rb"))


@require_http_methods(["GET", "POST"])
def setup(request):
    if User.objects.exists():
        return redirect("login")
    form = SetupForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        with transaction.atomic():
            seed_defaults()
            profile = BusinessProfile.get_solo()
            profile.business_name = form.cleaned_data["business_name"]
            profile.abbreviation = form.cleaned_data["abbreviation"]
            profile.email = form.cleaned_data["email"]
            profile.website = form.cleaned_data["website"]
            profile.save()
            user = User.objects.create_superuser(
                username=form.cleaned_data["username"],
                password=form.cleaned_data["password"],
                email=form.cleaned_data["email"],
            )
        login(request, user)
        messages.success(request, "ForgeOps is ready. Add your first client when you are ready.")
        return redirect("dashboard")
    return render(request, "setup.html", {"form": form})


def _sum(queryset, field="amount"):
    return money(queryset.aggregate(total=Sum(field))["total"])


@login_required
def dashboard(request):
    expire_quotes()
    today = timezone.localdate()
    month_start = today.replace(day=1)
    payments = Payment.objects.filter(payment_date__range=(month_start, today))
    revenue = _sum(PaymentAllocation.objects.filter(payment__in=payments, kind=PaymentAllocation.Kind.REVENUE))
    project_expenses = _sum(Expense.objects.filter(expense_type=Expense.Type.PROJECT, expense_date__range=(month_start, today)))
    business_expenses = _sum(
        Expense.objects.filter(
            expense_type=Expense.Type.BUSINESS,
            expense_date__range=(month_start, today),
        ).exclude(category__name__in=["Sales Tax Paid", "Income Tax Paid"])
    )
    tax_collected = _sum(PaymentAllocation.objects.filter(payment__in=payments, kind=PaymentAllocation.Kind.SALES_TAX))
    attention_project_query = Project.objects.filter(is_support_project=False).exclude(
        status__in=[Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED]
    )
    attention_project_count = attention_project_query.count()
    attention_projects = attention_project_query.select_related("client")[:8]
    pending_quotes = Quote.objects.filter(status__in=[Quote.Status.AWAITING_APPROVAL, Quote.Status.APPROVED_PENDING]).select_related("project", "project__client")[:6]
    unpaid_invoices = Invoice.objects.filter(status=Invoice.Status.SENT_PENDING).select_related("project", "project__client")[:6]
    upcoming_expirations = Quote.objects.filter(
        status=Quote.Status.AWAITING_APPROVAL,
        expires_on__range=(today, today + timedelta(days=7)),
    ).select_related("project")
    context = {
        "today": today,
        "revenue": revenue,
        "project_expenses": project_expenses,
        "business_expenses": business_expenses,
        "net_income": revenue - project_expenses - business_expenses,
        "tax_collected": tax_collected,
        "attention_projects": attention_projects,
        "attention_project_count": attention_project_count,
        "pending_quotes": pending_quotes,
        "unpaid_invoices": unpaid_invoices,
        "upcoming_expirations": upcoming_expirations,
        "available_credits": _sum(ProjectCredit.objects.filter(remaining_amount__gt=0), "remaining_amount"),
    }
    return render(request, "dashboard.html", context)


@login_required
def global_search(request):
    query = request.GET.get("q", "").strip()
    context = {"query": query, "clients": [], "projects": [], "quotes": [], "invoices": [], "vendors": []}
    if query:
        context.update(
            {
                "clients": Client.objects.filter(Q(name__icontains=query) | Q(primary_contact__icontains=query) | Q(email__icontains=query) | Q(phone__icontains=query))[:20],
                "projects": Project.objects.filter(Q(name__icontains=query) | Q(project_number__icontains=query) | Q(internal_notes__icontains=query) | Q(client_notes__icontains=query)).select_related("client")[:20],
                "quotes": Quote.objects.filter(Q(name__icontains=query) | Q(quote_number__icontains=query)).select_related("project")[:20],
                "invoices": Invoice.objects.filter(Q(name__icontains=query) | Q(invoice_number__icontains=query)).select_related("project")[:20],
                "vendors": Vendor.objects.filter(name__icontains=query)[:20],
            }
        )
    return render(request, "search.html", context)


@login_required
def client_list(request):
    clients = Client.objects.annotate(project_count=Count("projects")).order_by("name")
    return render(request, "clients/list.html", {"clients": clients})


@login_required
def client_detail(request, pk):
    client = get_object_or_404(Client, pk=pk)
    recent_limit = 5
    base_url = reverse("client_detail", args=[client.pk])

    def section(queryset, key):
        queryset = queryset.order_by("-created_at", "-pk")
        show_all = request.GET.get(key) == "all"
        total = queryset.count()
        records = queryset if show_all else queryset[:recent_limit]
        params = request.GET.copy()
        if show_all:
            params.pop(key, None)
        else:
            params[key] = "all"
        query = params.urlencode()
        toggle_url = f"{base_url}?{query}#{key}" if query else f"{base_url}#{key}"
        return records, total, show_all, toggle_url

    projects, project_count, show_all_projects, projects_toggle_url = section(
        Project.objects.filter(client=client).select_related("service_address"), "projects"
    )
    quotes, quote_count, show_all_quotes, quotes_toggle_url = section(
        Quote.objects.filter(project__client=client).select_related("project"), "quotes"
    )
    invoices, invoice_count, show_all_invoices, invoices_toggle_url = section(
        Invoice.objects.filter(project__client=client).select_related("project"), "invoices"
    )
    return render(
        request,
        "clients/detail.html",
        {
            "client": client,
            "projects": projects,
            "project_count": project_count,
            "show_all_projects": show_all_projects,
            "projects_toggle_url": projects_toggle_url,
            "quotes": quotes,
            "quote_count": quote_count,
            "show_all_quotes": show_all_quotes,
            "quotes_toggle_url": quotes_toggle_url,
            "invoices": invoices,
            "invoice_count": invoice_count,
            "show_all_invoices": show_all_invoices,
            "invoices_toggle_url": invoices_toggle_url,
        },
    )


@login_required
@require_http_methods(["GET", "POST"])
def client_form(request, pk=None):
    client = get_object_or_404(Client, pk=pk) if pk else None
    form = ClientForm(request.POST or None, instance=client)
    if request.method == "POST" and form.is_valid():
        client = form.save()
        messages.success(request, "Client saved. The Support Calls project is ready.")
        return redirect("client_detail", pk=client.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Edit client" if client else "New client", "cancel_url": reverse("client_detail", args=[pk]) if pk else reverse("client_list")})


@login_required
@require_http_methods(["GET", "POST"])
def address_form(request, client_pk, pk=None):
    client = get_object_or_404(Client, pk=client_pk)
    address = get_object_or_404(ClientAddress, pk=pk, client=client) if pk else None
    form = ClientAddressForm(request.POST or None, instance=address)
    if request.method == "POST" and form.is_valid():
        address = form.save(commit=False)
        address.client = client
        address.save()
        messages.success(request, "Service address saved.")
        return redirect("client_detail", pk=client.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Service address", "cancel_url": reverse("client_detail", args=[client.pk])})


@login_required
def project_list(request):
    status = request.GET.get("status", "active")
    projects = Project.objects.select_related("client", "service_address")
    if status == "active":
        projects = projects.exclude(status__in=[Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED])
    elif status == "all":
        pass
    elif status in dict(Project.Status.choices):
        projects = projects.filter(status=status)
    else:
        status = "active"
        projects = projects.exclude(status__in=[Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED])
    filter_choices = [("active", "All active"), ("all", "All projects"), *Project.Status.choices]
    selected_status_label = dict(filter_choices).get(status, "All active")
    return render(
        request,
        "projects/list.html",
        {
            "projects": projects,
            "selected_status": status,
            "selected_status_label": selected_status_label,
            "filter_choices": filter_choices,
        },
    )


@login_required
def project_detail(request, pk):
    project = get_object_or_404(Project.objects.select_related("client", "service_address"), pk=pk)
    uninvoiced_labor = project.labor_entries.filter(invoice__isnull=True)
    context = {
        "project": project,
        "uninvoiced_labor": uninvoiced_labor,
        "ungrouped_quotes": project.quotes.filter(group__isnull=True),
        "available_credit": _sum(project.credits.filter(remaining_amount__gt=0), "remaining_amount"),
    }
    return render(request, "projects/detail.html", context)


@login_required
@require_POST
def project_complete(request, pk):
    project = get_object_or_404(Project, pk=pk)
    if project.is_support_project:
        messages.error(request, "Support Calls remains active while its client is active.")
        return redirect("project_detail", pk=project.pk)
    if project.status != Project.Status.COMPLETED:
        project.status = Project.Status.COMPLETED
        project.save()
        record_activity(project, "status", "Project marked completed")
        messages.success(request, "Project marked complete.")
    return redirect("project_detail", pk=project.pk)


@login_required
@require_POST
def project_reopen(request, pk):
    project = get_object_or_404(Project, pk=pk, status=Project.Status.COMPLETED, is_support_project=False)
    project.status = Project.Status.IN_PROGRESS
    project.save()
    record_activity(project, "status", "Project reopened", "Status changed to In Progress")
    messages.success(request, "Project reopened and moved to In Progress.")
    return redirect("project_detail", pk=project.pk)


@login_required
@require_http_methods(["GET", "POST"])
def project_form(request, client_pk=None, pk=None):
    project = get_object_or_404(Project, pk=pk) if pk else None
    client = project.client if project else (get_object_or_404(Client, pk=client_pk) if client_pk else None)
    if project and project.is_support_project and project.status == Project.Status.SUPPORT_ACTIVE:
        pass
    old_status = project.status if project else None
    profile = BusinessProfile.get_solo()
    initial = {}
    if not project:
        initial = {
            "hourly_rate": profile.default_hourly_rate,
            "labor_minimum_hours": profile.default_labor_minimum,
        }
    form = ProjectForm(request.POST or None, instance=project, client=client, initial=initial)
    if request.method == "POST" and form.is_valid():
        project = form.save(commit=False)
        project.client = form.cleaned_data["resolved_client"]
        service_address = form.cleaned_data.get("resolved_service_address") or project.client.primary_service_address
        if form.cleaned_data.get("service_address_choice") == "__new__":
            address = ClientAddress.objects.create(
                client=project.client,
                label=form.cleaned_data.get("new_address_label") or "Service address",
                address_line_1=form.cleaned_data["new_address_line_1"],
                address_line_2=form.cleaned_data.get("new_address_line_2", ""),
                city=form.cleaned_data["new_address_city"],
                state=form.cleaned_data["new_address_state"],
                postal_code=form.cleaned_data["new_address_postal_code"],
                is_primary=not project.client.addresses.exists(),
            )
            service_address = address
        project.service_address = service_address
        project.save()
        if old_status and old_status != project.status:
            record_activity(project, "status", f"Status changed to {project.get_status_display()}", form.cleaned_data.get("status_note", ""))
        elif not old_status:
            record_activity(project, "project_created", "Project created")
        messages.success(request, "Project saved.")
        return redirect("project_detail", pk=project.pk)
    cancel_url = reverse("project_detail", args=[pk]) if pk else (reverse("client_detail", args=[client.pk]) if client else reverse("project_list"))
    return render(
        request,
        "projects/form.html",
        {"form": form, "title": "Edit project" if project else "New project", "client": client, "cancel_url": cancel_url},
    )


@login_required
@require_http_methods(["GET", "POST"])
def note_add(request, project_pk=None, client_pk=None):
    project = get_object_or_404(Project, pk=project_pk) if project_pk else None
    client = project.client if project else get_object_or_404(Client, pk=client_pk)
    form = NoteForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        note = form.save(commit=False)
        note.project = project
        note.client = None if project else client
        note.save()
        if project:
            record_activity(project, "note", "Note added", note.get_visibility_display())
        messages.success(request, "Note added.")
        return redirect("project_detail", pk=project.pk) if project else redirect("client_detail", pk=client.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Add note", "cancel_url": reverse("project_detail", args=[project.pk]) if project else reverse("client_detail", args=[client.pk])})


@login_required
@require_POST
def quote_form(request, project_pk):
    project = get_object_or_404(Project, pk=project_pk)
    profile = BusinessProfile.get_solo()
    quote = Quote.objects.create(
        project=project,
        name=project.name,
        labor_rate=project.hourly_rate,
        labor_minimum_hours=project.labor_minimum_hours,
        labor_category=AccountingCategory.objects.filter(name="Client Labor", active=True).first(),
        sales_tax_rate=profile.sales_tax_rate,
        admin_fee_rate=profile.admin_fee_rate,
    )
    quote.selected_terms.set(
        TermClause.objects.filter(
            active=True,
            selected_by_default=True,
            applies_to__in=[TermClause.AppliesTo.QUOTE, TermClause.AppliesTo.BOTH],
        )
    )
    messages.success(request, "Quote workspace created. Add the equipment, labor estimate, and notes here.")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_http_methods(["GET", "POST"])
def quote_detail(request, pk):
    quote = get_object_or_404(Quote.objects.select_related("project", "project__client"), pk=pk)
    quote_form = None
    if not quote.is_issued:
        quote_form = QuoteForm(request.POST or None, instance=quote, project=quote.project)
        if request.method == "POST" and quote_form.is_valid():
            quote_form.save()
            messages.success(request, "Quote details saved.")
            return redirect("quote_detail", pk=quote.pk)
    elif request.method == "POST":
        messages.error(request, "Issued quotes are read-only. Create a replacement to make changes.")
        return redirect("quote_detail", pk=quote.pk)
    return render(request, "quotes/detail.html", {"quote": quote, "quote_form": quote_form})


@login_required
@require_http_methods(["GET", "POST"])
def quote_item_form(request, quote_pk, pk=None):
    quote = get_object_or_404(Quote, pk=quote_pk)
    if quote.is_issued:
        messages.error(request, "Issued quotes cannot be edited.")
        return redirect("quote_detail", pk=quote.pk)
    item = get_object_or_404(QuoteItem, pk=pk, quote=quote) if pk else None
    form = QuoteItemForm(request.POST or None, instance=item, project=quote.project)
    if request.method == "POST" and form.is_valid():
        item = form.save(commit=False)
        item.quote = quote
        item.save()
        messages.success(request, "Quote item saved.")
        return redirect("quote_detail", pk=quote.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Quote item", "cancel_url": reverse("quote_detail", args=[quote.pk]), "delete_url": reverse("quote_item_delete", args=[quote.pk, item.pk]) if item else None, "delete_label": "Delete item"})


@login_required
@require_POST
def quote_item_delete(request, quote_pk, pk):
    quote = get_object_or_404(Quote, pk=quote_pk)
    item = get_object_or_404(QuoteItem, pk=pk, quote=quote)
    if quote.is_issued:
        messages.error(request, "Issued quote items cannot be deleted.")
    else:
        item.delete()
        messages.success(request, "Quote item deleted.")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_http_methods(["GET", "POST"])
def quote_surcharge_form(request, quote_pk, pk=None):
    quote = get_object_or_404(Quote, pk=quote_pk)
    if quote.is_issued:
        messages.error(request, "Issued quotes cannot be edited.")
        return redirect("quote_detail", pk=quote.pk)
    surcharge = get_object_or_404(QuoteSurcharge, pk=pk, quote=quote) if pk else None
    form = QuoteSurchargeForm(request.POST or None, instance=surcharge)
    if request.method == "POST" and form.is_valid():
        surcharge = form.save(commit=False)
        surcharge.quote = quote
        surcharge.save()
        return redirect("quote_detail", pk=quote.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Vendor surcharge", "cancel_url": reverse("quote_detail", args=[quote.pk]), "surcharge_datalist": True, "delete_url": reverse("quote_surcharge_delete", args=[quote.pk, surcharge.pk]) if surcharge else None, "delete_label": "Delete surcharge"})


@login_required
@require_POST
def quote_surcharge_delete(request, quote_pk, pk):
    quote = get_object_or_404(Quote, pk=quote_pk)
    surcharge = get_object_or_404(QuoteSurcharge, pk=pk, quote=quote)
    if quote.is_issued:
        messages.error(request, "Issued quote surcharges cannot be deleted.")
    else:
        surcharge.delete()
        messages.success(request, "Vendor surcharge deleted.")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_POST
def quote_issue(request, pk):
    quote = get_object_or_404(Quote, pk=pk)
    if not quote.items.exists():
        messages.error(request, "Add at least one item before issuing the quote.")
    else:
        issue_quote(quote)
        messages.success(request, f"{quote.quote_number} issued and valid for 30 days.")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_POST
def quote_approve(request, pk):
    quote = get_object_or_404(Quote, pk=pk)
    approve_quote(quote)
    messages.success(request, "Quote marked approved.")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_POST
def quote_status(request, pk, status):
    quote = get_object_or_404(Quote, pk=pk)
    allowed = {Quote.Status.NOT_APPROVED, Quote.Status.VOID}
    if status not in allowed:
        raise Http404
    quote.status = status
    quote.save(update_fields=["status", "updated_at"])
    record_activity(quote.project, "quote_status", f"Quote marked {quote.get_status_display()}: {quote}")
    return redirect("quote_detail", pk=quote.pk)


@login_required
@require_POST
def quote_replace(request, pk):
    quote = get_object_or_404(Quote, pk=pk)
    replacement = replace_quote(quote)
    messages.success(request, "Replacement quote created. The original is preserved as Superseded.")
    return redirect("quote_detail", pk=replacement.pk)


@login_required
@require_POST
def quote_duplicate_option(request, pk):
    quote = get_object_or_404(Quote, pk=pk)
    duplicate = duplicate_quote_option(quote)
    messages.success(request, f"Created {duplicate.name} in the related quote set.")
    return redirect("quote_detail", pk=duplicate.pk)


@login_required
def quote_pdf(request, pk):
    quote = get_object_or_404(Quote, pk=pk)
    filename = f"{quote.quote_number or 'DRAFT-QUOTE'}.pdf"
    return FileResponse(io.BytesIO(quote_pdf_bytes(quote)), as_attachment=True, filename=filename)


@login_required
@require_POST
def invoice_form(request, project_pk):
    project = get_object_or_404(Project, pk=project_pk)
    profile = BusinessProfile.get_solo()
    invoice = Invoice.objects.create(
        project=project,
        name="Final Invoice",
        sales_tax_rate=profile.sales_tax_rate,
        admin_fee_rate=profile.admin_fee_rate,
    )
    invoice.selected_terms.set(
        TermClause.objects.filter(
            active=True,
            selected_by_default=True,
            applies_to__in=[TermClause.AppliesTo.INVOICE, TermClause.AppliesTo.BOTH],
        )
    )
    messages.success(request, "Invoice workspace created. Add labor and any additional items here.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_http_methods(["GET", "POST"])
def invoice_detail(request, pk):
    invoice = get_object_or_404(Invoice.objects.select_related("project", "project__client"), pk=pk)
    invoice_form = None
    if not invoice.is_issued:
        invoice_form = InvoiceForm(request.POST or None, instance=invoice, project=invoice.project)
        if request.method == "POST" and invoice_form.is_valid():
            invoice_form.save()
            messages.success(request, "Invoice details saved.")
            return redirect("invoice_detail", pk=invoice.pk)
    elif request.method == "POST":
        messages.error(request, "Issued invoices are read-only. Use credits or void the document to correct it.")
        return redirect("invoice_detail", pk=invoice.pk)
    uninvoiced_labor = invoice.project.labor_entries.filter(invoice__isnull=True)
    available_credits = invoice.project.credits.filter(remaining_amount__gt=0)
    return render(
        request,
        "invoices/detail.html",
        {
            "invoice": invoice,
            "invoice_form": invoice_form,
            "uninvoiced_labor": uninvoiced_labor,
            "available_credits": available_credits,
        },
    )


@login_required
@require_http_methods(["GET", "POST"])
def invoice_item_form(request, invoice_pk, pk=None):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    if invoice.is_issued:
        messages.error(request, "Issued invoices cannot be edited.")
        return redirect("invoice_detail", pk=invoice.pk)
    item = get_object_or_404(InvoiceItem, pk=pk, invoice=invoice) if pk else None
    form = InvoiceItemForm(request.POST or None, instance=item, project=invoice.project)
    if request.method == "POST" and form.is_valid():
        item = form.save(commit=False)
        item.invoice = invoice
        item.save()
        return redirect("invoice_detail", pk=invoice.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Additional invoice item", "cancel_url": reverse("invoice_detail", args=[invoice.pk]), "delete_url": reverse("invoice_item_delete", args=[invoice.pk, item.pk]) if item else None, "delete_label": "Delete item"})


@login_required
@require_POST
def invoice_item_delete(request, invoice_pk, pk):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    item = get_object_or_404(InvoiceItem, pk=pk, invoice=invoice)
    if invoice.is_issued:
        messages.error(request, "Issued invoice items cannot be deleted.")
    else:
        item.delete()
        messages.success(request, "Invoice item deleted.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_http_methods(["GET", "POST"])
def invoice_surcharge_form(request, invoice_pk, pk=None):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    if invoice.is_issued:
        messages.error(request, "Issued invoices cannot be edited.")
        return redirect("invoice_detail", pk=invoice.pk)
    surcharge = get_object_or_404(InvoiceSurcharge, pk=pk, invoice=invoice) if pk else None
    form = InvoiceSurchargeForm(request.POST or None, instance=surcharge)
    if request.method == "POST" and form.is_valid():
        surcharge = form.save(commit=False)
        surcharge.invoice = invoice
        surcharge.save()
        return redirect("invoice_detail", pk=invoice.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Vendor surcharge", "cancel_url": reverse("invoice_detail", args=[invoice.pk]), "surcharge_datalist": True, "delete_url": reverse("invoice_surcharge_delete", args=[invoice.pk, surcharge.pk]) if surcharge else None, "delete_label": "Delete surcharge"})


@login_required
@require_POST
def invoice_surcharge_delete(request, invoice_pk, pk):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    surcharge = get_object_or_404(InvoiceSurcharge, pk=pk, invoice=invoice)
    if invoice.is_issued:
        messages.error(request, "Issued invoice surcharges cannot be deleted.")
    else:
        surcharge.delete()
        messages.success(request, "Vendor surcharge deleted.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_POST
def invoice_assign_labor(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk)
    if invoice.is_issued:
        messages.error(request, "Issued invoices cannot be edited.")
        return redirect("invoice_detail", pk=invoice.pk)
    ids = request.POST.getlist("labor_ids")
    count = invoice.project.labor_entries.filter(pk__in=ids, invoice__isnull=True).update(invoice=invoice)
    messages.success(request, f"Added {count} labor entr{'y' if count == 1 else 'ies'} to the invoice.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_POST
def invoice_remove_labor(request, invoice_pk, pk):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    entry = get_object_or_404(LaborEntry, pk=pk, invoice=invoice)
    if invoice.is_issued:
        messages.error(request, "Labor cannot be removed from an issued invoice.")
    else:
        entry.invoice = None
        entry.save(update_fields=["invoice", "updated_at"])
        record_activity(invoice.project, "labor_unassigned", "Labor removed from draft invoice", entry.description)
        messages.success(request, "Labor removed from the invoice and kept with the project.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_POST
def invoice_issue(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk)
    if not invoice.labor_entries.exists() and not invoice.items.exists():
        messages.error(request, "Add labor or an item before issuing the invoice.")
    else:
        issue_invoice(invoice)
        messages.success(request, f"{invoice.invoice_number} issued.")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
@require_POST
def invoice_void(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk)
    invoice.status = Invoice.Status.VOID
    invoice.save(update_fields=["status", "updated_at"])
    record_activity(invoice.project, "invoice_status", f"Invoice voided: {invoice}")
    return redirect("invoice_detail", pk=invoice.pk)


@login_required
def invoice_pdf(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk)
    filename = f"{invoice.invoice_number or 'DRAFT-INVOICE'}.pdf"
    return FileResponse(io.BytesIO(invoice_pdf_bytes(invoice)), as_attachment=True, filename=filename)


@login_required
@require_http_methods(["GET", "POST"])
def labor_form(request, project_pk, pk=None):
    project = get_object_or_404(Project, pk=project_pk)
    entry = get_object_or_404(LaborEntry, pk=pk, project=project) if pk else None
    if entry and entry.invoice and entry.invoice.is_issued:
        messages.error(request, "Labor on an issued invoice cannot be edited.")
        return redirect("project_detail", pk=project.pk)
    form = LaborEntryForm(request.POST or None, instance=entry, project=project)
    if request.method == "POST" and form.is_valid():
        entry = form.save(commit=False)
        entry.project = project
        entry.save()
        record_activity(project, "labor", f"Labor recorded: {entry.actual_hours:.2f} hours", entry.description)
        messages.success(request, "Labor entry saved.")
        return redirect("project_detail", pk=project.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Edit labor" if entry else "Add labor", "cancel_url": reverse("project_detail", args=[project.pk]), "delete_url": reverse("labor_delete", args=[project.pk, entry.pk]) if entry else None, "delete_label": "Delete labor entry"})


@login_required
@require_POST
def labor_delete(request, project_pk, pk):
    project = get_object_or_404(Project, pk=project_pk)
    entry = get_object_or_404(LaborEntry, pk=pk, project=project)
    if entry.invoice and entry.invoice.is_issued:
        messages.error(request, "Labor on an issued invoice cannot be deleted.")
        return redirect("project_detail", pk=project.pk)
    invoice_pk = entry.invoice_id
    description = entry.description
    entry.delete()
    record_activity(project, "labor_deleted", "Labor entry deleted", description)
    messages.success(request, "Labor entry deleted.")
    return redirect("invoice_detail", pk=invoice_pk) if invoice_pk else redirect("project_detail", pk=project.pk)


@login_required
@require_http_methods(["GET", "POST"])
def invoice_labor_form(request, invoice_pk):
    invoice = get_object_or_404(Invoice.objects.select_related("project"), pk=invoice_pk)
    if invoice.is_issued:
        messages.error(request, "Issued invoices cannot be edited.")
        return redirect("invoice_detail", pk=invoice.pk)
    form = LaborEntryForm(request.POST or None, project=invoice.project)
    if request.method == "POST" and form.is_valid():
        entry = form.save(commit=False)
        entry.project = invoice.project
        entry.invoice = invoice
        entry.save()
        record_activity(invoice.project, "labor", f"Labor recorded: {entry.actual_hours:.2f} hours", entry.description)
        messages.success(request, "Labor added to this invoice.")
        return redirect("invoice_detail", pk=invoice.pk)
    return render(
        request,
        "generic/form.html",
        {"form": form, "title": "Add labor to invoice", "cancel_url": reverse("invoice_detail", args=[invoice.pk])},
    )


@login_required
@require_http_methods(["GET", "POST"])
def quick_labor(request):
    form = QuickLaborForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        project = form.cleaned_data["project"]
        entry = LaborEntry.objects.create(
            project=project,
            work_date=form.cleaned_data["work_date"],
            description=form.cleaned_data["description"],
            actual_minutes=int((form.cleaned_data["hours"] * 60).quantize(Decimal("1"))),
            hourly_rate=project.hourly_rate,
            category=form.cleaned_data["category"],
            billable=form.cleaned_data["billable"],
        )
        record_activity(project, "labor", f"Labor recorded: {entry.actual_hours:.2f} hours", entry.description)
        messages.success(request, "Labor saved.")
        return redirect("project_detail", pk=project.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Quick labor entry", "cancel_url": reverse("dashboard")})


@login_required
@require_http_methods(["GET", "POST"])
def payment_form(request, document_type, pk):
    document = get_object_or_404(Quote if document_type == "quote" else Invoice, pk=pk)
    balance_before = document.balance
    payment_instance = Payment(client=document.project.client, project=document.project)
    if document_type == "quote":
        payment_instance.quote = document
    else:
        payment_instance.invoice = document
    form = PaymentForm(request.POST or None, instance=payment_instance, initial={"amount": balance_before})
    if request.method == "POST" and form.is_valid():
        payment = form.save(commit=False)
        payment.client = document.project.client
        payment.project = document.project
        if document_type == "quote":
            payment.quote = document
        else:
            payment.invoice = document
        payment.full_clean()
        payment.save()
        finalize_payment(payment, balance_before)
        save_attachments(payment, request.FILES.getlist("receipts"), kind=Attachment.Kind.RECEIPT)
        messages.success(request, "Payment recorded. The accounting breakdown was created automatically.")
        return redirect("quote_detail" if document_type == "quote" else "invoice_detail", pk=document.pk)
    return render(request, "generic/form.html", {"form": form, "title": f"Record payment for {document}", "cancel_url": reverse("quote_detail" if document_type == "quote" else "invoice_detail", args=[document.pk]), "show_receipts": True})


@login_required
@require_http_methods(["GET", "POST"])
def invoice_credit_form(request, invoice_pk):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    form = InvoiceCreditForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        credit = form.save(commit=False)
        credit.invoice = invoice
        credit.save()
        record_activity(invoice.project, "credit", f"Invoice credit added: ${credit.amount}", credit.reason)
        return redirect("invoice_detail", pk=invoice.pk)
    return render(request, "generic/form.html", {"form": form, "title": "Add invoice credit or discount", "cancel_url": reverse("invoice_detail", args=[invoice.pk])})


@login_required
@require_http_methods(["GET", "POST"])
def apply_credit_form(request, invoice_pk):
    invoice = get_object_or_404(Invoice, pk=invoice_pk)
    form = ApplyProjectCreditForm(request.POST or None, project=invoice.project)
    if request.method == "POST" and form.is_valid():
        try:
            apply_project_credit(invoice, form.cleaned_data["project_credit"], form.cleaned_data["amount"], form.cleaned_data["reason"])
            messages.success(request, "Project credit applied.")
            return redirect("invoice_detail", pk=invoice.pk)
        except ValueError as error:
            form.add_error("amount", str(error))
    return render(request, "generic/form.html", {"form": form, "title": "Apply available project credit", "cancel_url": reverse("invoice_detail", args=[invoice.pk])})


@login_required
def expense_list(request):
    expenses = Expense.objects.select_related("client", "project", "vendor", "category")
    return render(request, "money/list.html", {"payments": Payment.objects.select_related("client", "project", "quote", "invoice")[:100], "expenses": expenses[:100]})


@login_required
@require_http_methods(["GET", "POST"])
def expense_form(request, expense_type, pk=None):
    if expense_type not in [Expense.Type.PROJECT, Expense.Type.BUSINESS]:
        raise Http404
    expense = get_object_or_404(Expense, pk=pk, expense_type=expense_type) if pk else None
    initial = {}
    if not expense:
        initial = {key: request.GET.get(key) for key in ["client", "project", "quote", "invoice"] if request.GET.get(key)}
    form = ExpenseForm(request.POST or None, instance=expense, expense_type=expense_type, initial=initial)
    form.instance.expense_type = expense_type
    if request.method == "POST" and form.is_valid():
        expense = form.save(commit=False)
        expense.full_clean()
        expense.save()
        save_attachments(expense, request.FILES.getlist("receipts"), kind=Attachment.Kind.RECEIPT)
        if expense.project:
            record_activity(expense.project, "expense", f"Project expense recorded: ${expense.amount}", expense.description)
        messages.success(request, "Expense saved.")
        return redirect("expense_list")
    active_projects = Project.objects.exclude(
        status__in=[Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED]
    ).select_related("client")
    project_ids = list(active_projects.values_list("pk", flat=True))
    dependent_data = {
        "projects": [
            {"id": project.pk, "clientId": project.client_id, "label": f"{project.name} — {project.project_number}"}
            for project in active_projects
        ],
        "quotes": [
            {"id": quote.pk, "projectId": quote.project_id, "label": f"{quote.quote_number or 'Draft'} — {quote.name}"}
            for quote in Quote.objects.filter(project_id__in=project_ids).order_by("-created_at")
        ],
        "invoices": [
            {"id": invoice.pk, "projectId": invoice.project_id, "label": f"{invoice.invoice_number or 'Draft'} — {invoice.name}"}
            for invoice in Invoice.objects.filter(project_id__in=project_ids).order_by("-created_at")
        ],
    }
    return render(
        request,
        "money/form.html",
        {
            "form": form,
            "title": "Project expense" if expense_type == Expense.Type.PROJECT else "Business expense",
            "cancel_url": reverse("expense_list"),
            "expense_type": expense_type,
            "dependent_data": dependent_data,
        },
    )


ATTACHMENT_MODELS = {
    "project": Project,
    "quote": Quote,
    "invoice": Invoice,
    "payment": Payment,
    "expense": Expense,
}


@login_required
@require_http_methods(["GET", "POST"])
def attachment_add(request, model_name, pk):
    model = ATTACHMENT_MODELS.get(model_name)
    if not model:
        raise Http404
    target = get_object_or_404(model, pk=pk)
    form = AttachmentForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        save_attachments(
            target,
            form.cleaned_data["files"],
            label=form.cleaned_data["label"],
            kind=form.cleaned_data["kind"],
            visibility=form.cleaned_data["visibility"],
        )
        project = target if isinstance(target, Project) else getattr(target, "project", None)
        if project:
            record_activity(project, "attachment", "Files uploaded", form.cleaned_data["label"])
        messages.success(request, "Files uploaded.")
        return redirect(_target_detail_url(target))
    return render(
        request,
        "generic/form.html",
        {
            "form": form,
            "title": "Files and receipts",
            "cancel_url": _target_detail_url(target),
            "existing_files": target.attachments.all(),
        },
    )


def _target_detail_url(target):
    if isinstance(target, Project):
        return reverse("project_detail", args=[target.pk])
    if isinstance(target, Quote):
        return reverse("quote_detail", args=[target.pk])
    if isinstance(target, Invoice):
        return reverse("invoice_detail", args=[target.pk])
    if isinstance(target, Payment):
        return reverse("quote_detail" if target.quote_id else "invoice_detail", args=[target.quote_id or target.invoice_id])
    return reverse("expense_list")


@login_required
@require_POST
def attachment_delete(request, pk):
    attachment = get_object_or_404(Attachment, pk=pk)
    target = attachment.content_object
    attachment.file.delete(save=False)
    attachment.delete()
    messages.success(request, "Attachment removed.")
    return redirect(_target_detail_url(target))


def _report_range(request):
    today = timezone.localdate()
    kind = request.GET.get("range", "month")
    try:
        year = int(request.GET.get("year", today.year))
    except ValueError:
        year = today.year
    if kind == "quarter":
        try:
            quarter = int(request.GET.get("quarter", 1))
        except ValueError:
            quarter = 1
        periods = {
            1: (date(year, 3, 1), date(year, 5, 31), "March 1 – May 31"),
            2: (date(year, 6, 1), date(year, 8, 31), "June 1 – August 31"),
            3: (date(year, 9, 1), date(year, 11, 30), "September 1 – November 30"),
            4: (date(year, 12, 1), date(year + 1, 2, calendar.monthrange(year + 1, 2)[1]), "December 1 – February 28/29"),
        }
        start, end, label = periods.get(quarter, periods[1])
        due = end + timedelta(days=20)
        while due.weekday() >= 5:
            due += timedelta(days=1)
        return kind, year, start, end, f"NYS Q{quarter} · {label}, {year}", due
    if kind == "year":
        return kind, year, date(year, 1, 1), date(year, 12, 31), str(year), None
    try:
        month = int(request.GET.get("month", today.month))
        start = date(year, month, 1)
    except ValueError:
        month = today.month
        start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    return "month", year, start, end, start.strftime("%B %Y"), None


def _report_data(request):
    kind, year, start, end, label, due = _report_range(request)
    payments = Payment.objects.filter(payment_date__range=(start, end))
    allocations = PaymentAllocation.objects.filter(payment__in=payments)
    revenue = _sum(allocations.filter(kind=PaymentAllocation.Kind.REVENUE))
    tax_collected = _sum(allocations.filter(kind=PaymentAllocation.Kind.SALES_TAX))
    project_expenses = _sum(Expense.objects.filter(expense_type=Expense.Type.PROJECT, expense_date__range=(start, end)))
    tax_category_names = ["Sales Tax Paid", "Income Tax Paid"]
    business_expense_query = Expense.objects.filter(
        expense_type=Expense.Type.BUSINESS,
        expense_date__range=(start, end),
    ).exclude(category__name__in=tax_category_names)
    business_expenses = _sum(business_expense_query)
    total_expenses = project_expenses + business_expenses
    net_income = revenue - total_expenses
    profile = BusinessProfile.get_solo()
    income_tax_estimate = money(max(Decimal("0"), net_income) * profile.income_tax_reserve_rate / 100)
    period_tax_payments = Expense.objects.filter(
        expense_type=Expense.Type.BUSINESS,
        expense_date__range=(start, end),
        category__name__in=tax_category_names,
    )
    sales_tax_paid = _sum(period_tax_payments.filter(category__name="Sales Tax Paid"))
    income_tax_paid = _sum(period_tax_payments.filter(category__name="Income Tax Paid"))
    exact_sales_reserve = max(Decimal("0"), tax_collected - sales_tax_paid)
    conservative_target = money(revenue * profile.conservative_sales_tax_rate / 100)
    conservative_sales_reserve = max(exact_sales_reserve, conservative_target - sales_tax_paid)
    income_tax_remaining = max(Decimal("0"), income_tax_estimate - income_tax_paid)
    invoice_query = Invoice.objects.filter(issue_date__range=(start, end)).exclude(status=Invoice.Status.VOID)
    invoice_total = money(sum((invoice.total + invoice.credits_total for invoice in invoice_query), Decimal("0")))
    outstanding_invoices = Invoice.objects.filter(issue_date__lte=end).exclude(status=Invoice.Status.VOID)
    outstanding_quotes = Quote.objects.filter(issue_date__lte=end, status__in=[Quote.Status.APPROVED_PENDING])
    outstanding = money(sum((invoice.balance for invoice in outstanding_invoices), Decimal("0")) + sum((quote.balance for quote in outstanding_quotes), Decimal("0")))
    income_by_category = list(
        allocations.filter(kind=PaymentAllocation.Kind.REVENUE, category__isnull=False)
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    project_expense_by_category = list(
        Expense.objects.filter(expense_type=Expense.Type.PROJECT, expense_date__range=(start, end))
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    business_expense_by_category = list(
        business_expense_query
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )
    project_profitability = []
    for project in Project.objects.exclude(is_support_project=True):
        collected = _sum(
            PaymentAllocation.objects.filter(
                payment__project=project,
                payment__payment_date__range=(start, end),
                kind=PaymentAllocation.Kind.REVENUE,
            )
        )
        costs = _sum(project.expenses.filter(expense_date__range=(start, end)))
        if collected or costs:
            project_profitability.append({"project": project, "collected": collected, "costs": costs, "profit": collected - costs})
    project_profitability.sort(key=lambda row: row["profit"], reverse=True)
    max_chart = max([revenue, total_expenses, Decimal("1")])
    return {
        "range_kind": kind,
        "year": year,
        "start": start,
        "end": end,
        "range_label": label,
        "filing_due": due,
        "revenue": revenue,
        "project_expenses": project_expenses,
        "business_expenses": business_expenses,
        "total_expenses": total_expenses,
        "net_income": net_income,
        "income_tax_estimate": income_tax_estimate,
        "income_tax_paid": income_tax_paid,
        "income_tax_remaining": income_tax_remaining,
        "estimated_after_tax_profit": net_income - income_tax_estimate - conservative_sales_reserve - sales_tax_paid,
        "tax_collected": tax_collected,
        "sales_tax_paid": sales_tax_paid,
        "exact_sales_reserve": exact_sales_reserve,
        "conservative_sales_reserve": conservative_sales_reserve,
        "sales_tax_cushion": conservative_sales_reserve - exact_sales_reserve,
        "total_tax_remaining": conservative_sales_reserve + income_tax_remaining,
        "total_tax_paid": sales_tax_paid + income_tax_paid,
        "invoice_total": invoice_total,
        "invoice_count": invoice_query.count(),
        "outstanding": outstanding,
        "income_by_category": income_by_category,
        "project_expense_by_category": project_expense_by_category,
        "business_expense_by_category": business_expense_by_category,
        "project_profitability": project_profitability[:12],
        "revenue_chart_width": int((revenue / max_chart) * 100),
        "expense_chart_width": int((total_expenses / max_chart) * 100),
        "month_choices": [(i, calendar.month_name[i]) for i in range(1, 13)],
        "selected_month": start.month,
        "selected_quarter": int(request.GET.get("quarter", 1)) if kind == "quarter" else 1,
    }


@login_required
def reports(request):
    return render(request, "reports.html", _report_data(request))


@login_required
def report_pdf(request):
    from .reporting_pdf import report_pdf_bytes

    data = _report_data(request)
    return FileResponse(io.BytesIO(report_pdf_bytes(data)), as_attachment=True, filename=f"ForgeOps-Report-{data['start']}-{data['end']}.pdf")


@login_required
def project_packet(request, pk, audience):
    project = get_object_or_404(Project, pk=pk)
    client_safe = audience == "client"
    if audience not in ["client", "internal"]:
        raise Http404
    filename = f"{project.project_number}-{'CLIENT' if client_safe else 'INTERNAL'}-PACKET.pdf"
    return FileResponse(io.BytesIO(project_packet_bytes(project, client_safe=client_safe)), as_attachment=True, filename=filename)


@login_required
@require_http_methods(["GET", "POST"])
def settings_profile(request):
    profile = BusinessProfile.get_solo()
    form = BusinessProfileForm(request.POST or None, request.FILES or None, instance=profile)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Business settings saved.")
        return redirect("settings_profile")
    return render(
        request,
        "settings/index.html",
        {
            "form": form,
            "categories": AccountingCategory.objects.all(),
            "terms": TermClause.objects.all(),
            "vendors": Vendor.objects.all(),
            "discounts": DiscountProgram.objects.all(),
        },
    )


MODEL_FORM_CONFIG = {
    "category": (AccountingCategory, CategoryForm, "Accounting category"),
    "term": (TermClause, TermClauseForm, "Terms clause"),
    "vendor": (Vendor, VendorForm, "Vendor"),
    "discount": (DiscountProgram, DiscountProgramForm, "Discount program"),
}


@login_required
@require_http_methods(["GET", "POST"])
def settings_record_form(request, kind, pk=None):
    config = MODEL_FORM_CONFIG.get(kind)
    if not config:
        raise Http404
    model, form_class, title = config
    instance = get_object_or_404(model, pk=pk) if pk else None
    form = form_class(request.POST or None, instance=instance)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, f"{title} saved.")
        return redirect("settings_profile")
    return render(request, "generic/form.html", {"form": form, "title": title, "cancel_url": reverse("settings_profile")})


@login_required
@require_POST
def backup_create(request):
    path = create_backup_zip()
    messages.success(request, f"Backup created: {path.name}")
    return FileResponse(open(path, "rb"), as_attachment=True, filename=path.name)

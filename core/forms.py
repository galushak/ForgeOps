from decimal import Decimal

from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone

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
    Project,
    ProjectCredit,
    Quote,
    QuoteGroup,
    QuoteItem,
    QuoteSurcharge,
    TermClause,
    Vendor,
    money,
)


class StyledFormMixin:
    def _style_fields(self):
        for field in self.fields.values():
            widget = field.widget
            if isinstance(widget, forms.CheckboxInput):
                widget.attrs.setdefault("class", "check-input")
            elif isinstance(widget, forms.CheckboxSelectMultiple):
                widget.attrs.pop("class", None)
            elif isinstance(widget, forms.FileInput):
                widget.attrs.setdefault("class", "file-input")
            else:
                widget.attrs.setdefault("class", "form-control")


class SetupForm(StyledFormMixin, forms.Form):
    username = forms.CharField(max_length=150, initial="admin")
    password = forms.CharField(widget=forms.PasswordInput, help_text="Minimum 8 characters.")
    password_confirm = forms.CharField(widget=forms.PasswordInput)
    business_name = forms.CharField(max_length=160, initial="ForgedSystems")
    abbreviation = forms.CharField(max_length=12, initial="FS")
    email = forms.EmailField(required=False)
    website = forms.URLField(required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()

    def clean_username(self):
        username = self.cleaned_data["username"]
        if User.objects.filter(username__iexact=username).exists():
            raise ValidationError("That username already exists.")
        return username

    def clean(self):
        cleaned = super().clean()
        password = cleaned.get("password")
        if password:
            try:
                validate_password(password)
            except ValidationError as error:
                self.add_error("password", error)
        if password != cleaned.get("password_confirm"):
            self.add_error("password_confirm", "Passwords do not match.")
        return cleaned


class BusinessProfileForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = BusinessProfile
        fields = [
            "business_name",
            "abbreviation",
            "email",
            "website",
            "logo",
            "sales_tax_rate",
            "admin_fee_rate",
            "default_hourly_rate",
            "default_labor_minimum",
            "quote_valid_days",
            "income_tax_reserve_rate",
            "conservative_sales_tax_rate",
            "quote_acceptance_text",
            "invoice_acknowledgement_text",
        ]
        widgets = {
            "quote_acceptance_text": forms.Textarea(attrs={"rows": 3}),
            "invoice_acknowledgement_text": forms.Textarea(attrs={"rows": 3}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class ClientForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Client
        fields = ["name", "primary_contact", "phone", "email", "billing_address", "notes", "status"]
        widgets = {"billing_address": forms.Textarea(attrs={"rows": 3}), "notes": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class ClientAddressForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = ClientAddress
        exclude = ["client"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class ServiceAddressSelect(forms.Select):
    address_client_ids = {}

    def create_option(self, name, value, label, selected, index, subindex=None, attrs=None):
        option = super().create_option(name, value, label, selected, index, subindex, attrs)
        client_id = self.address_client_ids.get(str(value))
        if client_id:
            option["attrs"]["data-client-id"] = str(client_id)
        return option


class ProjectForm(StyledFormMixin, forms.ModelForm):
    client = forms.ModelChoiceField(queryset=Client.objects.none(), required=False)
    service_address_choice = forms.ChoiceField(
        required=False,
        label="Service address",
        widget=ServiceAddressSelect(),
    )
    status_note = forms.CharField(required=False, widget=forms.Textarea(attrs={"rows": 2}), help_text="Optional activity note")
    new_address_label = forms.CharField(required=False, max_length=80, initial="Service address", label="Address label")
    new_address_line_1 = forms.CharField(required=False, max_length=160, label="New address line 1")
    new_address_line_2 = forms.CharField(required=False, max_length=160, label="New address line 2")
    new_address_city = forms.CharField(required=False, max_length=100, label="City")
    new_address_state = forms.CharField(required=False, max_length=40, initial="NY", label="State")
    new_address_postal_code = forms.CharField(required=False, max_length=20, label="Postal code")

    class Meta:
        model = Project
        fields = [
            "name",
            "status",
            "internal_notes",
            "client_notes",
            "hourly_rate",
            "labor_minimum_hours",
        ]
        widgets = {
            "internal_notes": forms.Textarea(attrs={"rows": 3}),
            "client_notes": forms.Textarea(attrs={"rows": 3}),
        }

    def __init__(self, *args, client=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fixed_client = client
        if not self.fixed_client and self.instance.pk:
            self.fixed_client = self.instance.client
        self.fields["client"].queryset = Client.objects.order_by("name")
        if self.fixed_client:
            self.fields.pop("client")

        addresses = ClientAddress.objects.select_related("client").order_by("client__name", "-is_primary", "label")
        if self.fixed_client:
            addresses = addresses.filter(client=self.fixed_client)
        choices = [("", "Use the client's primary service address")]
        address_clients = {}
        for address in addresses:
            label = str(address) if self.fixed_client else f"{address.client.name} — {address}"
            choices.append((str(address.pk), label))
            address_clients[str(address.pk)] = address.client_id
        choices.append(("__new__", "+ Add a new service address"))
        self.fields["service_address_choice"].choices = choices
        self.fields["service_address_choice"].widget.address_client_ids = address_clients
        if self.instance.pk and self.instance.service_address_id:
            self.initial["service_address_choice"] = str(self.instance.service_address_id)
        self._style_fields()

    def clean(self):
        cleaned = super().clean()
        client = self.fixed_client or cleaned.get("client")
        if not client:
            self.add_error("client", "Choose a client for this project.")
        choice = cleaned.get("service_address_choice")
        cleaned["resolved_client"] = client
        cleaned["resolved_service_address"] = None
        if choice and choice != "__new__":
            address = ClientAddress.objects.filter(pk=choice).first()
            if not address or not client or address.client_id != client.pk:
                self.add_error("service_address_choice", "Choose an address that belongs to the selected client.")
            else:
                cleaned["resolved_service_address"] = address
        if choice == "__new__":
            for field in ["new_address_city", "new_address_state", "new_address_postal_code"]:
                if not cleaned.get(field):
                    self.add_error(field, "Required when entering a new service address.")
            if not cleaned.get("new_address_line_1"):
                self.add_error("new_address_line_1", "Enter the new service address.")
        return cleaned


class QuoteForm(StyledFormMixin, forms.ModelForm):
    discount_program = forms.ModelChoiceField(queryset=DiscountProgram.objects.none(), required=False)
    new_group_name = forms.CharField(
        required=False,
        max_length=180,
        label="New related quote set",
        help_text="Enter a name here to create a new set instead of choosing an existing one.",
    )

    class Meta:
        model = Quote
        fields = [
            "name",
            "group",
            "estimated_labor_hours",
            "labor_rate",
            "labor_minimum_hours",
            "labor_category",
            "client_notes",
            "internal_notes",
            "selected_terms",
        ]
        widgets = {
            "client_notes": forms.Textarea(attrs={"rows": 3}),
            "internal_notes": forms.Textarea(attrs={"rows": 3}),
            "selected_terms": forms.CheckboxSelectMultiple(),
        }

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.project = project or getattr(self.instance, "project", None)
        self.fields["group"].label = "Related quote set"
        self.fields["group"].required = False
        self.fields["group"].help_text = "Use a set for related options, such as Good / Better / Best quotes."
        self.fields["group"].queryset = (
            QuoteGroup.objects.filter(project=self.project) if self.project else QuoteGroup.objects.none()
        )
        self.fields["labor_category"].queryset = AccountingCategory.objects.filter(
            group=AccountingCategory.Group.INCOME, active=True
        )
        self.fields["labor_category"].required = True
        self.fields["discount_program"].queryset = DiscountProgram.objects.filter(active=True)
        self.fields["selected_terms"].queryset = TermClause.objects.filter(
            active=True, applies_to__in=[TermClause.AppliesTo.QUOTE, TermClause.AppliesTo.BOTH]
        )
        if not self.is_bound and not self.instance.pk:
            self.initial["selected_terms"] = list(
                self.fields["selected_terms"].queryset.filter(selected_by_default=True).values_list("pk", flat=True)
            )
        if not self.is_bound and not self.initial.get("labor_category") and not self.instance.labor_category_id:
            self.initial["labor_category"] = AccountingCategory.objects.filter(name="Client Labor", active=True).first()
        if not self.is_bound and self.instance.pk and self.instance.labor_discount_percent:
            program_name = self.instance.discount_label.removesuffix(" Discount")
            self.initial["discount_program"] = DiscountProgram.objects.filter(
                name=program_name,
                percentage=self.instance.labor_discount_percent,
                active=True,
            ).first()
        for field in self.fields.values():
            field.widget.attrs["form"] = "quote-details-form"
        self._style_fields()

    def save(self, commit=True):
        quote = super().save(commit=False)
        group_name = self.cleaned_data.get("new_group_name", "").strip()
        if group_name and self.project:
            quote.group = QuoteGroup.objects.filter(project=self.project, name__iexact=group_name).first()
            if not quote.group:
                quote.group = QuoteGroup.objects.create(project=self.project, name=group_name)
        program = self.cleaned_data.get("discount_program")
        if program:
            quote.discount_label = f"{program.name} Discount"
            quote.labor_discount_percent = program.percentage
        else:
            quote.discount_label = ""
            quote.labor_discount_percent = Decimal("0.00")
        if commit:
            quote.save()
            self.save_m2m()
        return quote


class QuoteItemForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = QuoteItem
        fields = ["description", "quantity", "unit_price", "taxable", "income_category"]

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["income_category"].queryset = AccountingCategory.objects.filter(
            group=AccountingCategory.Group.INCOME, active=True
        )
        self.fields["income_category"].required = True
        if not self.instance.pk:
            self.initial["income_category"] = AccountingCategory.objects.filter(name="Client Materials", active=True).first()
        self._style_fields()


class SurchargeForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        fields = ["label", "amount"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["label"].widget.attrs["list"] = "surcharge-labels"
        self._style_fields()


class QuoteSurchargeForm(SurchargeForm):
    class Meta(SurchargeForm.Meta):
        model = QuoteSurcharge


class InvoiceForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Invoice
        fields = ["name", "payment_terms", "due_date", "selected_terms", "client_notes", "internal_notes"]
        widgets = {
            "due_date": forms.DateInput(attrs={"type": "date"}),
            "client_notes": forms.Textarea(attrs={"rows": 3}),
            "internal_notes": forms.Textarea(attrs={"rows": 3}),
            "selected_terms": forms.CheckboxSelectMultiple(),
        }

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["due_date"].label = "Custom due date"
        self.fields["due_date"].help_text = "Only used when Payment terms is Custom Due Date. Other due dates are calculated when the invoice is issued."
        self.fields["selected_terms"].queryset = TermClause.objects.filter(
            active=True, applies_to__in=[TermClause.AppliesTo.INVOICE, TermClause.AppliesTo.BOTH]
        )
        if not self.is_bound and not self.instance.pk:
            self.initial["selected_terms"] = list(
                self.fields["selected_terms"].queryset.filter(selected_by_default=True).values_list("pk", flat=True)
            )
        for field in self.fields.values():
            field.widget.attrs["form"] = "invoice-details-form"
        self._style_fields()

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("payment_terms") == Invoice.PaymentTerms.CUSTOM:
            if not cleaned.get("due_date"):
                self.add_error("due_date", "Enter the custom due date.")
        else:
            cleaned["due_date"] = None
        return cleaned


class InvoiceItemForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = InvoiceItem
        fields = ["description", "quantity", "unit_price", "taxable", "income_category"]

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["income_category"].queryset = AccountingCategory.objects.filter(
            group=AccountingCategory.Group.INCOME, active=True
        )
        self.fields["income_category"].required = True
        if not self.instance.pk:
            self.initial["income_category"] = AccountingCategory.objects.filter(name="Client Materials", active=True).first()
        self._style_fields()


class InvoiceSurchargeForm(SurchargeForm):
    class Meta(SurchargeForm.Meta):
        model = InvoiceSurcharge


class LaborEntryForm(StyledFormMixin, forms.ModelForm):
    hours = forms.DecimalField(max_digits=6, decimal_places=2, min_value=Decimal("0.00"), help_text="Actual hours worked; zero is allowed for nonbillable service-history entries")

    class Meta:
        model = LaborEntry
        fields = ["work_date", "description", "hours", "billable_hours_override", "hourly_rate", "category", "billable"]
        widgets = {
            "work_date": forms.DateInput(attrs={"type": "date"}),
            "description": forms.Textarea(attrs={"rows": 3}),
        }

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["category"].queryset = AccountingCategory.objects.filter(
            group=AccountingCategory.Group.INCOME, active=True
        )
        self.fields["category"].required = True
        if self.instance.pk:
            self.initial["hours"] = self.instance.actual_hours
        elif project:
            self.initial["hourly_rate"] = project.hourly_rate
            self.initial["category"] = AccountingCategory.objects.filter(name="Client Labor", active=True).first()
        self._style_fields()

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("billable") and cleaned.get("hours") == Decimal("0.00"):
            self.add_error("hours", "Billable labor must include actual time.")
        return cleaned

    def save(self, commit=True):
        entry = super().save(commit=False)
        entry.actual_minutes = int((self.cleaned_data["hours"] * 60).quantize(Decimal("1")))
        if commit:
            entry.save()
        return entry


class QuickLaborForm(StyledFormMixin, forms.Form):
    project = forms.ModelChoiceField(queryset=Project.objects.none())
    work_date = forms.DateField(widget=forms.DateInput(attrs={"type": "date"}))
    description = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}))
    hours = forms.DecimalField(max_digits=6, decimal_places=2, min_value=Decimal("0.00"))
    category = forms.ModelChoiceField(queryset=AccountingCategory.objects.none())
    billable = forms.BooleanField(required=False, initial=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["project"].queryset = Project.objects.exclude(
            status__in=[Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED]
        ).select_related("client")
        self.fields["category"].queryset = AccountingCategory.objects.filter(group=AccountingCategory.Group.INCOME, active=True)
        self.fields["category"].initial = AccountingCategory.objects.filter(name="Client Labor", active=True).first()
        self.fields["work_date"].initial = timezone.localdate()
        self._style_fields()

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("billable") and cleaned.get("hours") == Decimal("0.00"):
            self.add_error("hours", "Billable labor must include actual time.")
        return cleaned


class PaymentForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Payment
        fields = ["payment_date", "amount", "notes"]
        widgets = {"payment_date": forms.DateInput(attrs={"type": "date"}), "notes": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class ExpenseForm(StyledFormMixin, forms.ModelForm):
    vendor_choice = forms.ChoiceField(label="Vendor")
    new_vendor_name = forms.CharField(required=False, max_length=160, label="New vendor name")

    class Meta:
        model = Expense
        fields = [
            "expense_date",
            "amount",
            "client",
            "project",
            "quote",
            "invoice",
            "vendor_choice",
            "new_vendor_name",
            "category",
            "description",
        ]
        widgets = {"expense_date": forms.DateInput(attrs={"type": "date"}), "description": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, expense_type=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.expense_type = expense_type or getattr(self.instance, "expense_type", None)
        vendor_queryset = Vendor.objects.filter(active=True)
        if self.instance.pk and self.instance.vendor_id:
            vendor_queryset = Vendor.objects.filter(Q(active=True) | Q(pk=self.instance.vendor_id))
        self.fields["vendor_choice"].choices = [('', "Select a vendor")] + [
            (str(vendor.pk), vendor.name) for vendor in vendor_queryset.order_by("name")
        ] + [("__new__", "+ Add a new vendor")]
        if not self.is_bound and self.instance.vendor_id:
            self.initial["vendor_choice"] = str(self.instance.vendor_id)
        if self.expense_type == Expense.Type.PROJECT:
            self.fields["category"].queryset = AccountingCategory.objects.filter(group=AccountingCategory.Group.COGS, active=True)
            client_queryset = Client.objects.filter(status=Client.Status.ACTIVE)
            if self.instance.pk and self.instance.client_id:
                client_queryset = Client.objects.filter(Q(status=Client.Status.ACTIVE) | Q(pk=self.instance.client_id))
            self.fields["client"].queryset = client_queryset.order_by("name")

            client_id = (
                self.data.get(self.add_prefix("client"))
                if self.is_bound
                else (self.initial.get("client") or self.instance.client_id)
            )
            project_id = (
                self.data.get(self.add_prefix("project"))
                if self.is_bound
                else (self.initial.get("project") or self.instance.project_id)
            )
            inactive_statuses = [Project.Status.COMPLETED, Project.Status.ARCHIVED, Project.Status.CANCELLED]
            active_projects = Project.objects.exclude(status__in=inactive_statuses)
            if self.instance.pk and self.instance.project_id:
                active_projects = Project.objects.filter(
                    Q(pk=self.instance.project_id)
                    | ~Q(status__in=inactive_statuses)
                )
            self.fields["project"].queryset = (
                active_projects.filter(client_id=client_id).select_related("client") if client_id else Project.objects.none()
            )
            self.fields["quote"].queryset = Quote.objects.filter(project_id=project_id) if project_id else Quote.objects.none()
            self.fields["invoice"].queryset = Invoice.objects.filter(project_id=project_id) if project_id else Invoice.objects.none()
        else:
            self.fields["category"].queryset = AccountingCategory.objects.filter(group=AccountingCategory.Group.EXPENSE, active=True)
            for field in ["client", "project", "quote", "invoice"]:
                self.fields.pop(field, None)
        self._style_fields()

    def clean(self):
        cleaned = super().clean()
        vendor_choice = cleaned.get("vendor_choice")
        if vendor_choice == "__new__":
            if not cleaned.get("new_vendor_name", "").strip():
                self.add_error("new_vendor_name", "Enter the new vendor name.")
            cleaned["resolved_vendor"] = None
        elif vendor_choice:
            vendor = Vendor.objects.filter(pk=vendor_choice).first()
            if not vendor:
                self.add_error("vendor_choice", "Choose a valid vendor.")
            cleaned["resolved_vendor"] = vendor
        else:
            self.add_error("vendor_choice", "Choose a vendor.")
        if cleaned.get("quote") and cleaned.get("invoice"):
            self.add_error("invoice", "Choose either a quote or an invoice, not both.")
        return cleaned

    def save(self, commit=True):
        expense = super().save(commit=False)
        expense.vendor = self.cleaned_data.get("resolved_vendor")
        if self.cleaned_data.get("vendor_choice") == "__new__":
            vendor_name = self.cleaned_data["new_vendor_name"].strip()
            expense.vendor = Vendor.objects.filter(name__iexact=vendor_name).first()
            if not expense.vendor:
                expense.vendor = Vendor.objects.create(name=vendor_name)
        expense.expense_type = self.expense_type
        if commit:
            expense.save()
        return expense

class NoteForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Note
        fields = ["visibility", "body"]
        widgets = {"body": forms.Textarea(attrs={"rows": 4})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True


class MultipleFileField(forms.FileField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("widget", MultipleFileInput())
        super().__init__(*args, **kwargs)

    def clean(self, data, initial=None):
        single_clean = super().clean
        if isinstance(data, (list, tuple)):
            return [single_clean(item, initial) for item in data]
        return [single_clean(data, initial)] if data else []


class AttachmentForm(StyledFormMixin, forms.Form):
    files = MultipleFileField()
    label = forms.CharField(required=False, max_length=160)
    kind = forms.ChoiceField(choices=Attachment.Kind.choices, initial=Attachment.Kind.GENERAL)
    visibility = forms.ChoiceField(choices=Attachment.Visibility.choices, initial=Attachment.Visibility.INTERNAL)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["files"].widget.attrs.update({"accept": "image/*,.pdf", "capture": "environment"})
        self._style_fields()


class InvoiceCreditForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = InvoiceCredit
        fields = ["label", "amount", "reason"]
        widgets = {"reason": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class ApplyProjectCreditForm(StyledFormMixin, forms.Form):
    project_credit = forms.ModelChoiceField(queryset=ProjectCredit.objects.none())
    amount = forms.DecimalField(max_digits=11, decimal_places=2, min_value=Decimal("0.01"))
    reason = forms.CharField(widget=forms.Textarea(attrs={"rows": 3}), initial="Apply available client credit")

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["project_credit"].queryset = ProjectCredit.objects.filter(project=project, remaining_amount__gt=0)
        self._style_fields()


class CategoryForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = AccountingCategory
        fields = ["group", "name", "active", "sort_order"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class TermClauseForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = TermClause
        fields = ["name", "body", "applies_to", "selected_by_default", "active", "sort_order"]
        widgets = {"body": forms.Textarea(attrs={"rows": 4})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class VendorForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = Vendor
        fields = ["name", "active"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()


class DiscountProgramForm(StyledFormMixin, forms.ModelForm):
    class Meta:
        model = DiscountProgram
        fields = ["name", "percentage", "active"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()

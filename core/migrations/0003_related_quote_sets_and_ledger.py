from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


def consolidate_existing_data(apps, schema_editor):
    Quote = apps.get_model("core", "Quote")
    Invoice = apps.get_model("core", "Invoice")
    QuoteSurcharge = apps.get_model("core", "QuoteSurcharge")
    InvoiceSurcharge = apps.get_model("core", "InvoiceSurcharge")
    AccountingCategory = apps.get_model("core", "AccountingCategory")
    Expense = apps.get_model("core", "Expense")
    Vendor = apps.get_model("core", "Vendor")
    TaxPayment = apps.get_model("core", "TaxPayment")
    Attachment = apps.get_model("core", "Attachment")
    ContentType = apps.get_model("contenttypes", "ContentType")

    for quote in Quote.objects.exclude(shipping_cost=Decimal("0.00")):
        surcharge, created = QuoteSurcharge.objects.get_or_create(
            quote_id=quote.pk,
            label="Shipping",
            defaults={"amount": quote.shipping_cost},
        )
        if not created:
            surcharge.amount += quote.shipping_cost
            surcharge.save(update_fields=["amount"])

    for invoice in Invoice.objects.exclude(shipping_cost=Decimal("0.00")):
        surcharge, created = InvoiceSurcharge.objects.get_or_create(
            invoice_id=invoice.pk,
            label="Shipping",
            defaults={"amount": invoice.shipping_cost},
        )
        if not created:
            surcharge.amount += invoice.shipping_cost
            surcharge.save(update_fields=["amount"])

    category_references = [
        ("Expense", "category"),
        ("Quote", "labor_category"),
        ("QuoteItem", "income_category"),
        ("InvoiceItem", "income_category"),
        ("LaborEntry", "category"),
        ("PaymentAllocation", "category"),
    ]
    tax_categories = {}
    for category_name in ["Sales Tax Paid", "Income Tax Paid"]:
        target = AccountingCategory.objects.filter(group="expense", name=category_name).first()
        source = AccountingCategory.objects.filter(group="tax", name=category_name).first()
        if not target and source:
            source.group = "expense"
            source.save(update_fields=["group"])
            target = source
            source = None
        if not target:
            target = AccountingCategory.objects.create(group="expense", name=category_name, active=True)
        if source and source.pk != target.pk:
            for model_name, field_name in category_references:
                model = apps.get_model("core", model_name)
                model.objects.filter(**{f"{field_name}_id": source.pk}).update(**{f"{field_name}_id": target.pk})
            source.delete()
        tax_categories[category_name] = target

    vendor, _ = Vendor.objects.get_or_create(name="New York State Department of Taxation and Finance")
    tax_content_type = ContentType.objects.filter(app_label="core", model="taxpayment").first()
    expense_content_type, _ = ContentType.objects.get_or_create(app_label="core", model="expense")
    for payment in TaxPayment.objects.all().order_by("pk"):
        category_name = "Sales Tax Paid" if payment.tax_type == "sales" else "Income Tax Paid"
        details = []
        if payment.period_label:
            details.append(f"Period: {payment.period_label}")
        elif payment.period_start or payment.period_end:
            details.append(f"Period: {payment.period_start or 'unspecified'} through {payment.period_end or 'unspecified'}")
        else:
            details.append(f"Tax year: {payment.tax_year}")
        if payment.confirmation:
            details.append(f"Confirmation: {payment.confirmation}")
        if payment.notes:
            details.append(payment.notes)
        expense = Expense.objects.create(
            expense_type="business",
            expense_date=payment.payment_date,
            amount=payment.amount,
            vendor_id=vendor.pk,
            category_id=tax_categories[category_name].pk,
            description=f"{category_name}. " + " ".join(details),
        )
        if tax_content_type:
            Attachment.objects.filter(
                content_type_id=tax_content_type.pk,
                object_id=payment.pk,
            ).update(content_type_id=expense_content_type.pk, object_id=expense.pk)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_simplify_document_workflows"),
    ]

    operations = [
        migrations.CreateModel(
            name="QuoteGroup",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=180)),
                ("description", models.TextField(blank=True)),
                (
                    "project",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="quote_groups", to="core.project"),
                ),
            ],
            options={"ordering": ["created_at"]},
        ),
        migrations.AddConstraint(
            model_name="quotegroup",
            constraint=models.UniqueConstraint(fields=("project", "name"), name="uniq_quote_group_project_name"),
        ),
        migrations.AddField(
            model_name="quote",
            name="group",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="quotes", to="core.quotegroup"),
        ),
        migrations.RunPython(consolidate_existing_data, migrations.RunPython.noop),
        migrations.RemoveField(model_name="quote", name="shipping_cost"),
        migrations.RemoveField(model_name="invoice", name="shipping_cost"),
        migrations.AlterField(
            model_name="accountingcategory",
            name="group",
            field=models.CharField(choices=[("income", "Income"), ("cogs", "Cost of Goods Sold"), ("expense", "Business Expenses")], max_length=16),
        ),
        migrations.DeleteModel(name="TaxPayment"),
    ]

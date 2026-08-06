from django.db import migrations


def order_ledger_categories(apps, schema_editor):
    AccountingCategory = apps.get_model("core", "AccountingCategory")
    names = [
        "Tools & Equipment",
        "Office Supplies",
        "Renewals",
        "Gas & Mileage",
        "General Business Expenses",
        "Sales Tax Paid",
        "Income Tax Paid",
    ]
    for order, name in enumerate(names):
        AccountingCategory.objects.filter(group="expense", name=name).update(sort_order=order)


class Migration(migrations.Migration):
    dependencies = [("core", "0003_related_quote_sets_and_ledger")]

    operations = [migrations.RunPython(order_ledger_categories, migrations.RunPython.noop)]

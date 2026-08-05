from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0004_order_ledger_categories")]

    operations = [
        migrations.AddField(
            model_name="quote",
            name="labor_taxable",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="invoice",
            name="labor_taxable",
            field=models.BooleanField(default=True),
        ),
    ]

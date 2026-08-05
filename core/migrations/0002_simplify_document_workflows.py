from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="project",
            name="default_labor_category",
        ),
        migrations.RemoveField(
            model_name="project",
            name="default_material_category",
        ),
        migrations.RemoveField(
            model_name="project",
            name="site_visit_at",
        ),
        migrations.RemoveField(
            model_name="project",
            name="target_completion_date",
        ),
        migrations.RemoveField(
            model_name="quote",
            name="group",
        ),
        migrations.DeleteModel(
            name="QuoteGroup",
        ),
    ]

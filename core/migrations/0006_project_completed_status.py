from django.db import migrations, models


def mark_completed_projects(apps, schema_editor):
    Project = apps.get_model("core", "Project")
    Project.objects.filter(status="archived", is_support_project=False).update(status="completed")


def restore_archived_projects(apps, schema_editor):
    Project = apps.get_model("core", "Project")
    Project.objects.filter(status="completed").update(status="archived")


class Migration(migrations.Migration):
    dependencies = [("core", "0005_historical_labor_taxability")]

    operations = [
        migrations.AlterField(
            model_name="project",
            name="status",
            field=models.CharField(
                choices=[
                    ("support_active", "Active"),
                    ("lead", "Lead"),
                    ("pending_site_visit", "Pending Site Visit"),
                    ("pending_quote", "Pending Quote"),
                    ("pending_approval", "Pending Approval"),
                    ("in_progress", "In Progress"),
                    ("pending_invoice", "Pending Invoice"),
                    ("awaiting_payment", "Awaiting Payment"),
                    ("waiting_parts", "Waiting for Parts"),
                    ("on_hold", "On-Hold"),
                    ("completed", "Completed"),
                    ("cancelled", "Cancelled"),
                    ("archived", "Archived"),
                ],
                default="lead",
                max_length=24,
            ),
        ),
        migrations.RunPython(mark_completed_projects, restore_archived_projects),
    ]

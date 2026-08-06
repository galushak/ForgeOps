from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from core.models import Payment, PaymentAllocation, money
from core.services import backfill_payment_sales_tax, expected_payment_sales_tax


class Command(BaseCommand):
    help = "Audit or repair imported payments whose sales tax was recorded entirely as revenue."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply verified reclassifications. Without this flag the command is read-only.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        candidates = []
        for payment in Payment.objects.filter(voided_at__isnull=True).select_related("client", "project", "quote", "invoice"):
            expected = expected_payment_sales_tax(payment)
            existing = money(
                payment.allocations.filter(kind=PaymentAllocation.Kind.SALES_TAX).aggregate(total=Sum("amount"))["total"]
            )
            if expected != existing:
                candidates.append((payment, expected, existing))
                self.stdout.write(
                    f"Payment {payment.pk} · {payment.payment_date} · {payment.document}: existing ${existing}, expected ${expected}"
                )
        if not candidates:
            self.stdout.write(self.style.SUCCESS("All active payment sales-tax allocations are correct."))
            return
        if not apply_changes:
            self.stdout.write(self.style.WARNING(f"Dry run only: {len(candidates)} payment(s) require repair. Re-run with --apply."))
            return
        repaired = 0
        for payment, _expected, existing in candidates:
            if existing:
                raise CommandError(f"Payment {payment.pk} already has a nonzero tax allocation and needs manual review.")
            if backfill_payment_sales_tax(payment, reason="Correct legacy import that classified collected sales tax as revenue"):
                repaired += 1
        self.stdout.write(self.style.SUCCESS(f"Repaired {repaired} payment sales-tax allocation(s)."))

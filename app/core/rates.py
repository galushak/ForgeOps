from decimal import Decimal, InvalidOperation


RATE_ERROR = "Enter a rate from 0 to 100, using either 7 or 0.07 for 7%"


def normalize_percentage_rate(value: object) -> Decimal:
    """Accept a decimal rate or whole-number percent and return a decimal rate."""
    try:
        rate = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(RATE_ERROR) from exc
    if not rate.is_finite() or rate < 0:
        raise ValueError(RATE_ERROR)
    if rate > 1:
        rate /= Decimal("100")
    if rate > 1:
        raise ValueError(RATE_ERROR)
    return rate


def canonical_percentage_rate(value: object) -> str:
    return format(normalize_percentage_rate(value).normalize(), "f")

from decimal import Decimal

from django import template

from core.models import money

register = template.Library()


@register.filter
def currency(value):
    return f"${money(value):,.2f}"


@register.filter
def hours_from_minutes(value):
    return f"{Decimal(value or 0) / Decimal(60):.2f}"


@register.filter
def status_class(value):
    value = str(value or "").lower()
    if any(token in value for token in ["paid", "approved", "active", "in_progress", "completed"]):
        return "status-good"
    if any(token in value for token in ["pending", "awaiting", "hold", "parts", "site"]):
        return "status-warn"
    if any(token in value for token in ["void", "cancel", "expired", "not_approved", "superseded"]):
        return "status-bad"
    return "status-neutral"


@register.filter
def file_basename(value):
    return str(value).rsplit("/", 1)[-1]


@register.filter
def subtract(value, arg):
    return money(Decimal(value or 0) - Decimal(arg or 0))

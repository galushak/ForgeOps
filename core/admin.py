from django.contrib import admin

from . import models

for model in [
    models.BusinessProfile,
    models.AccountingCategory,
    models.TermClause,
    models.DiscountProgram,
    models.Vendor,
    models.Client,
    models.ClientAddress,
    models.Project,
    models.QuoteGroup,
    models.Quote,
    models.QuoteItem,
    models.QuoteSurcharge,
    models.Invoice,
    models.InvoiceItem,
    models.InvoiceSurcharge,
    models.LaborEntry,
    models.Payment,
    models.PaymentAllocation,
    models.ProjectCredit,
    models.InvoiceCredit,
    models.Expense,
    models.Note,
    models.ProjectActivity,
    models.Attachment,
]:
    admin.site.register(model)

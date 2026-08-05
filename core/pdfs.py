import io
import mimetypes
from decimal import Decimal

from django.conf import settings
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .models import Attachment, BusinessProfile, Invoice, PaymentAllocation, Quote, money

INK = colors.HexColor("#132225")
TEAL = colors.HexColor("#0D7168")
MINT = colors.HexColor("#B8F15C")
PAPER = colors.HexColor("#F5F2E9")
LINE = colors.HexColor("#D8D6CC")
MUTED = colors.HexColor("#647174")
WHITE = colors.white


def currency(value):
    return f"${money(value):,.2f}"


def _styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=TEAL, spaceAfter=4))
    styles.add(ParagraphStyle(name="DocTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=25, leading=28, textColor=INK, alignment=TA_LEFT, spaceAfter=8))
    styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=INK, spaceBefore=12, spaceAfter=7))
    styles.add(ParagraphStyle(name="BodySmall", parent=styles["BodyText"], fontSize=8.5, leading=12, textColor=INK))
    styles.add(ParagraphStyle(name="Muted", parent=styles["BodyText"], fontSize=8, leading=11, textColor=MUTED))
    styles.add(ParagraphStyle(name="Right", parent=styles["BodyText"], fontSize=8.5, leading=12, alignment=TA_RIGHT, textColor=INK))
    styles.add(ParagraphStyle(name="Signature", parent=styles["BodyText"], fontSize=8, leading=11, textColor=INK, spaceBefore=8))
    return styles


def _logo(profile, width=1.7 * inch, height=0.55 * inch):
    if profile.logo and profile.logo.storage.exists(profile.logo.name):
        image = RLImage(profile.logo.path, width=width, height=height, kind="proportional")
        image.hAlign = "LEFT"
        return image
    return Paragraph(f"<b>{profile.business_name}</b>", ParagraphStyle("Brand", fontName="Helvetica-Bold", fontSize=17, textColor=INK))


def _header(profile, document_name, number, status, dates, styles):
    brand_lines = [_logo(profile), Spacer(1, 5)]
    contact = " · ".join(x for x in [profile.email, profile.website] if x)
    if contact:
        brand_lines.append(Paragraph(contact, styles["Muted"]))
    meta = [
        Paragraph(document_name.upper(), ParagraphStyle("MetaTitle", fontName="Helvetica-Bold", fontSize=15, textColor=INK, alignment=TA_RIGHT)),
        Paragraph(number or "DRAFT", ParagraphStyle("MetaNumber", fontName="Helvetica-Bold", fontSize=9, textColor=TEAL, alignment=TA_RIGHT)),
        Paragraph(status, ParagraphStyle("MetaStatus", fontName="Helvetica-Bold", fontSize=8, textColor=MUTED, alignment=TA_RIGHT)),
    ]
    for label, value in dates:
        if value:
            meta.append(Paragraph(f"<b>{label}:</b> {value:%B %-d, %Y}", styles["Right"]))
    table = Table([[brand_lines, meta]], colWidths=[4.3 * inch, 2.2 * inch])
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]))
    return table


def _client_block(project, styles):
    address = project.service_address
    address_text = ""
    if address:
        address_text = f"{address.address_line_1} {address.address_line_2}<br/>{address.city}, {address.state} {address.postal_code}"
    client = project.client
    left = Paragraph(
        f"<b>Prepared for</b><br/>{client.name}<br/>{client.primary_contact or ''}<br/>{client.email or ''}<br/>{client.phone or ''}",
        styles["BodySmall"],
    )
    right = Paragraph(f"<b>Project</b><br/>{project.name}<br/>{project.project_number}<br/>{address_text}", styles["BodySmall"])
    table = Table([[left, right]], colWidths=[3.25 * inch, 3.25 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return table


def _line_table(rows, headers, widths, styles):
    data = [[Paragraph(f"<b>{h}</b>", styles["BodySmall"]) for h in headers]] + rows
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _totals_table(rows, styles, highlight_label=None):
    data = []
    for label, value in rows:
        data.append([Paragraph(label, styles["Right"]), Paragraph(f"<b>{currency(value)}</b>", styles["Right"])])
    table = Table(data, colWidths=[2.05 * inch, 1.25 * inch], hAlign="RIGHT")
    commands = [("LINEABOVE", (0, -1), (-1, -1), 1.2, INK), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]
    if highlight_label:
        for index, (label, _) in enumerate(rows):
            if label == highlight_label:
                commands.extend([("BACKGROUND", (0, index), (-1, index), MINT), ("BOX", (0, index), (-1, index), 0.8, INK)])
    table.setStyle(TableStyle(commands))
    return table


def _terms_and_signature(terms, statement, styles):
    flow = [Paragraph("Terms", styles["Section"])]
    for index, term in enumerate(terms, 1):
        flow.append(Paragraph(f"<b>{index}. {term.name}</b> — {term.body}", styles["Muted"]))
        flow.append(Spacer(1, 3))
    flow.extend(
        [
            Spacer(1, 14),
            Paragraph(statement, styles["Signature"]),
            Spacer(1, 24),
            Table(
                [
                    ["Client name", "Signature", "Date"],
                    ["________________________", "________________________", "______________"],
                ],
                colWidths=[2.1 * inch, 2.6 * inch, 1.5 * inch],
                style=TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 7.5), ("TEXTCOLOR", (0, 0), (-1, 0), MUTED), ("TOPPADDING", (0, 0), (-1, -1), 3)]),
            ),
        ]
    )
    return flow


def _watermark(status):
    labels = {
        "paid": "PAID",
        "void": "VOID",
        "expired": "EXPIRED",
        "superseded": "SUPERSEDED",
        "approved_paid": "PAID",
    }
    label = labels.get(status)

    def callback(pdf_canvas, doc):
        pdf_canvas.saveState()
        pdf_canvas.setFont("Helvetica-Bold", 8)
        pdf_canvas.setFillColor(MUTED)
        pdf_canvas.drawString(0.6 * inch, 0.38 * inch, "ForgeOps · Confidential business document")
        pdf_canvas.drawRightString(7.9 * inch, 0.38 * inch, f"Page {doc.page}")
        if label:
            pdf_canvas.setFillAlpha(0.09)
            pdf_canvas.setFillColor(TEAL)
            pdf_canvas.setFont("Helvetica-Bold", 66)
            pdf_canvas.translate(4.25 * inch, 5.5 * inch)
            pdf_canvas.rotate(35)
            pdf_canvas.drawCentredString(0, 0, label)
        pdf_canvas.restoreState()

    return callback


def quote_pdf_bytes(quote):
    profile = BusinessProfile.get_solo()
    styles = _styles()
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.65 * inch, leftMargin=0.65 * inch, topMargin=0.55 * inch, bottomMargin=0.65 * inch)
    story = [
        _header(profile, "Quote", quote.quote_number, quote.get_status_display(), [("Issued", quote.issue_date), ("Valid through", quote.expires_on)], styles),
        _client_block(quote.project, styles),
        Spacer(1, 12),
        Paragraph(quote.name, styles["DocTitle"]),
    ]
    if quote.client_notes:
        story.extend([Paragraph(quote.client_notes, styles["BodySmall"]), Spacer(1, 10)])
    rows = []
    for item in quote.items.all():
        rows.append(
            [
                Paragraph(item.description, styles["BodySmall"]),
                Paragraph(f"{item.quantity:g}", styles["Right"]),
                Paragraph(currency(item.unit_price), styles["Right"]),
                Paragraph(currency(item.line_total), styles["Right"]),
            ]
        )
    story.extend([Paragraph("Equipment and materials", styles["Section"]), _line_table(rows, ["Description", "Qty", "Unit price", "Amount"], [3.55 * inch, 0.65 * inch, 1.1 * inch, 1.2 * inch], styles), Spacer(1, 8)])
    totals = [("Items subtotal", quote.items_subtotal)]
    for surcharge in quote.surcharges.all():
        totals.append((surcharge.label, surcharge.amount))
    totals.extend(
        [
            (f"Sales tax ({quote.sales_tax_rate:g}%)", quote.materials_tax),
            (f"Administrative/coordination fee ({quote.admin_fee_rate:g}%)", quote.administrative_fee),
            ("PARTS TOTAL DUE UPFRONT", quote.parts_total),
        ]
    )
    story.extend([_totals_table(totals, styles, "PARTS TOTAL DUE UPFRONT"), Spacer(1, 10)])
    labor_rows = [
        [
            Paragraph("Estimated labor", styles["BodySmall"]),
            Paragraph(f"{quote.estimated_billable_hours:g} hrs", styles["Right"]),
            Paragraph(currency(quote.labor_rate), styles["Right"]),
            Paragraph(currency(quote.labor_subtotal), styles["Right"]),
        ]
    ]
    story.extend([Paragraph("Estimated labor", styles["Section"]), _line_table(labor_rows, ["Description", "Hours", "Rate", "Amount"], [3.55 * inch, 0.65 * inch, 1.1 * inch, 1.2 * inch], styles), Spacer(1, 8)])
    labor_totals = [(f"Labor sales tax ({quote.sales_tax_rate:g}%)", quote.labor_tax)]
    if quote.labor_discount_credit:
        labor_totals.append((quote.discount_label or "Labor discount", -quote.labor_discount_credit))
    labor_totals.append(("ESTIMATED QUOTE TOTAL", quote.estimated_total))
    story.extend([_totals_table(labor_totals, styles, "ESTIMATED QUOTE TOTAL")])
    terms = quote.term_snapshots.all() if quote.is_issued else quote.selected_terms.all()
    story.extend(_terms_and_signature(terms, profile.quote_acceptance_text, styles))
    callback = _watermark(quote.status)
    document.build(story, onFirstPage=callback, onLaterPages=callback)
    return output.getvalue()


def invoice_pdf_bytes(invoice):
    profile = BusinessProfile.get_solo()
    styles = _styles()
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.65 * inch, leftMargin=0.65 * inch, topMargin=0.55 * inch, bottomMargin=0.65 * inch)
    story = [
        _header(profile, "Invoice", invoice.invoice_number, invoice.get_status_display(), [("Issued", invoice.issue_date), ("Due", invoice.due_date)], styles),
        _client_block(invoice.project, styles),
        Spacer(1, 12),
        Paragraph(invoice.name, styles["DocTitle"]),
    ]
    if invoice.client_notes:
        story.extend([Paragraph(invoice.client_notes, styles["BodySmall"]), Spacer(1, 10)])
    labor_rows = []
    for entry in invoice.labor_entries.all():
        labor_rows.append(
            [
                Paragraph(f"{entry.work_date:%b %-d, %Y}<br/>{entry.description}", styles["BodySmall"]),
                Paragraph(f"{entry.effective_billable_hours:g}", styles["Right"]),
                Paragraph(currency(entry.hourly_rate), styles["Right"]),
                Paragraph(currency(entry.billable_amount), styles["Right"]),
            ]
        )
    if invoice.minimum_adjustment_hours:
        labor_rows.append(
            [
                Paragraph("Project labor minimum adjustment", styles["BodySmall"]),
                Paragraph(f"{invoice.minimum_adjustment_hours:g}", styles["Right"]),
                Paragraph(currency(invoice.project.hourly_rate), styles["Right"]),
                Paragraph(currency(invoice.minimum_adjustment_hours * invoice.project.hourly_rate), styles["Right"]),
            ]
        )
    if labor_rows:
        story.extend([Paragraph("Labor", styles["Section"]), _line_table(labor_rows, ["Work performed", "Hours", "Rate", "Amount"], [3.55 * inch, 0.65 * inch, 1.1 * inch, 1.2 * inch], styles), Spacer(1, 8)])
    item_rows = []
    for item in invoice.items.all():
        item_rows.append(
            [
                Paragraph(item.description, styles["BodySmall"]),
                Paragraph(f"{item.quantity:g}", styles["Right"]),
                Paragraph(currency(item.unit_price), styles["Right"]),
                Paragraph(currency(item.line_total), styles["Right"]),
            ]
        )
    if item_rows:
        story.extend([Paragraph("Additional items", styles["Section"]), _line_table(item_rows, ["Description", "Qty", "Unit price", "Amount"], [3.55 * inch, 0.65 * inch, 1.1 * inch, 1.2 * inch], styles), Spacer(1, 8)])
    totals = [("Labor", invoice.labor_subtotal), (f"Labor sales tax ({invoice.sales_tax_rate:g}%)", invoice.labor_tax)]
    if invoice.materials_subtotal:
        totals.append(("Additional items", invoice.materials_subtotal))
    for surcharge in invoice.surcharges.all():
        totals.append((surcharge.label, surcharge.amount))
    if invoice.materials_tax:
        totals.append((f"Materials sales tax ({invoice.sales_tax_rate:g}%)", invoice.materials_tax))
    if invoice.administrative_fee:
        totals.append((f"Administrative/coordination fee ({invoice.admin_fee_rate:g}%)", invoice.administrative_fee))
    for credit in invoice.credits.all():
        totals.append((credit.label, -credit.amount))
    totals.append(("AMOUNT DUE", invoice.total))
    story.extend([_totals_table(totals, styles, "AMOUNT DUE")])
    terms = invoice.term_snapshots.all() if invoice.is_issued else invoice.selected_terms.all()
    story.extend(_terms_and_signature(terms, profile.invoice_acknowledgement_text, styles))
    callback = _watermark(invoice.status)
    document.build(story, onFirstPage=callback, onLaterPages=callback)
    return output.getvalue()


def _packet_summary(project, client_safe=False):
    profile = BusinessProfile.get_solo()
    styles = _styles()
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.65 * inch, leftMargin=0.65 * inch, topMargin=0.55 * inch, bottomMargin=0.65 * inch)
    label = "Client Project Packet" if client_safe else "Internal Project Packet"
    story = [
        _header(profile, label, project.project_number, project.get_status_display(), [("Generated", timezone.localdate())], styles),
        Spacer(1, 20),
        Paragraph(project.name, styles["DocTitle"]),
        _client_block(project, styles),
        Spacer(1, 14),
    ]
    notes = project.client_notes if client_safe else "\n\n".join(x for x in [project.client_notes, project.internal_notes] if x)
    if notes:
        story.extend([Paragraph("Project notes", styles["Section"]), Paragraph(notes.replace("\n", "<br/>"), styles["BodySmall"])])
    story.append(Paragraph("Document index", styles["Section"]))
    quote_query = project.quotes.filter(quote_number__isnull=False)
    if client_safe:
        quote_query = quote_query.filter(status__in=[Quote.Status.APPROVED_PENDING, Quote.Status.APPROVED_PAID])
    invoice_query = project.invoices.filter(invoice_number__isnull=False)
    index_rows = []
    for quote in quote_query:
        index_rows.append([Paragraph("Quote", styles["BodySmall"]), Paragraph(str(quote), styles["BodySmall"]), Paragraph(quote.get_status_display(), styles["BodySmall"])])
    for invoice in invoice_query:
        index_rows.append([Paragraph("Invoice", styles["BodySmall"]), Paragraph(str(invoice), styles["BodySmall"]), Paragraph(invoice.get_status_display(), styles["BodySmall"])])
    if index_rows:
        story.append(_line_table(index_rows, ["Type", "Document", "Status"], [1.0 * inch, 3.7 * inch, 1.8 * inch], styles))
    if not client_safe:
        story.extend(
            [
                Paragraph("Internal financial summary", styles["Section"]),
                _totals_table(
                    [
                        ("Client payments", project.payments_total),
                        ("Project expenses", project.expenses_total),
                        ("Collected cash profit", project.cash_profit),
                    ],
                    styles,
                    "Collected cash profit",
                ),
                Paragraph("Labor log", styles["Section"]),
            ]
        )
        labor_rows = [
            [
                Paragraph(f"{entry.work_date:%b %-d, %Y}", styles["BodySmall"]),
                Paragraph(entry.description, styles["BodySmall"]),
                Paragraph(f"{entry.actual_hours:.2f}", styles["Right"]),
                Paragraph(f"{entry.effective_billable_hours:.2f}", styles["Right"]),
            ]
            for entry in project.labor_entries.all()
        ]
        if labor_rows:
            story.append(_line_table(labor_rows, ["Date", "Description", "Actual", "Billable"], [1.0 * inch, 3.9 * inch, 0.8 * inch, 0.8 * inch], styles))
        story.append(Paragraph("Project activity", styles["Section"]))
        for activity in project.activity.all():
            story.append(Paragraph(f"<b>{activity.occurred_at:%b %-d, %Y %I:%M %p}</b> — {activity.title} {activity.details}", styles["Muted"]))
    else:
        story.append(Paragraph("Payment history", styles["Section"]))
        payment_rows = [
            [Paragraph(f"{p.payment_date:%b %-d, %Y}", styles["BodySmall"]), Paragraph(str(p.document), styles["BodySmall"]), Paragraph(currency(p.amount), styles["Right"])]
            for p in project.payments.all()
        ]
        if payment_rows:
            story.append(_line_table(payment_rows, ["Date", "Document", "Amount"], [1.1 * inch, 4.0 * inch, 1.4 * inch], styles))
    callback = _watermark("")
    document.build(story, onFirstPage=callback, onLaterPages=callback)
    return output.getvalue()


def _append_pdf(writer, pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        writer.add_page(page)


def _attachment_pdf_bytes(attachment):
    path = attachment.file.path
    mime, _ = mimetypes.guess_type(path)
    if mime == "application/pdf" or path.lower().endswith(".pdf"):
        return open(path, "rb").read()
    if mime and mime.startswith("image/"):
        with Image.open(path) as image:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            output = io.BytesIO()
            image.save(output, format="PDF", resolution=150)
            return output.getvalue()
    return None


def project_packet_bytes(project, client_safe=False):
    writer = PdfWriter()
    _append_pdf(writer, _packet_summary(project, client_safe=client_safe))
    quotes = project.quotes.filter(quote_number__isnull=False)
    if client_safe:
        quotes = quotes.filter(status__in=[Quote.Status.APPROVED_PENDING, Quote.Status.APPROVED_PAID])
    for quote in quotes:
        _append_pdf(writer, quote_pdf_bytes(quote))
    for invoice in project.invoices.filter(invoice_number__isnull=False):
        _append_pdf(writer, invoice_pdf_bytes(invoice))
    attachments = list(project.attachments.all())
    if not client_safe:
        for quote in project.quotes.all():
            attachments.extend(list(quote.attachments.all()))
        for invoice in project.invoices.all():
            attachments.extend(list(invoice.attachments.all()))
        for payment in project.payments.all():
            attachments.extend(list(payment.attachments.all()))
        for expense in project.expenses.all():
            attachments.extend(list(expense.attachments.all()))
    else:
        attachments = [a for a in attachments if a.visibility == Attachment.Visibility.CLIENT and a.kind != Attachment.Kind.PHOTO]
    for attachment in attachments:
        try:
            pdf_bytes = _attachment_pdf_bytes(attachment)
            if pdf_bytes:
                _append_pdf(writer, pdf_bytes)
        except Exception:
            continue
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()

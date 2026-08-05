import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import BusinessProfile, money

INK = colors.HexColor("#132225")
TEAL = colors.HexColor("#0D7168")
MINT = colors.HexColor("#B8F15C")
PAPER = colors.HexColor("#F5F2E9")
LINE = colors.HexColor("#D8D6CC")
MUTED = colors.HexColor("#647174")


def _currency(value):
    return f"${money(value):,.2f}"


def report_pdf_bytes(data):
    profile = BusinessProfile.get_solo()
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, leftMargin=0.55 * inch, rightMargin=0.55 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("TitleX", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=24, leading=28, textColor=INK)
    eyebrow = ParagraphStyle("Eye", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=TEAL, spaceAfter=4)
    section = ParagraphStyle("SectionX", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=INK, spaceBefore=14, spaceAfter=7)
    small = ParagraphStyle("SmallX", parent=styles["BodyText"], fontSize=8, leading=11, textColor=INK)
    right = ParagraphStyle("RightX", parent=small, alignment=TA_RIGHT)
    story = [
        Paragraph(profile.business_name.upper(), eyebrow),
        Paragraph("Business Performance Report", title),
        Paragraph(f"{data['range_label']} · {data['start']:%B %-d, %Y} through {data['end']:%B %-d, %Y}", small),
        Spacer(1, 14),
    ]
    cards = [
        ("Revenue", data["revenue"]),
        ("Total expenses", data["total_expenses"]),
        ("Project expenses", data["project_expenses"]),
        ("Business expenses", data["business_expenses"]),
        ("Net income", data["net_income"]),
        ("Estimated after-tax profit", data["estimated_after_tax_profit"]),
        ("Invoice total", data["invoice_total"]),
        ("Outstanding", data["outstanding"]),
        ("Exact sales-tax reserve", data["exact_sales_reserve"]),
        ("Conservative sales-tax reserve", data["conservative_sales_reserve"]),
        ("Income-tax reserve", data["income_tax_remaining"]),
        ("Total tax remaining", data["total_tax_remaining"]),
    ]
    card_rows = []
    for index in range(0, len(cards), 3):
        cells = []
        for label, value in cards[index : index + 3]:
            cells.append([Paragraph(label, small), Paragraph(f"<b>{_currency(value)}</b>", ParagraphStyle("CardValue", parent=small, fontSize=13, leading=17))])
        while len(cells) < 3:
            cells.append("")
        card_rows.append(cells)
    card_table = Table(card_rows, colWidths=[2.3 * inch] * 3, rowHeights=[0.7 * inch] * len(card_rows))
    card_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PAPER), ("GRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 9)]))
    story.append(card_table)
    if data.get("filing_due"):
        story.extend([Spacer(1, 8), Paragraph(f"NYS filing due date: <b>{data['filing_due']:%B %-d, %Y}</b>", small)])

    def add_breakdown(name, rows, key="category__name"):
        story.append(Paragraph(name, section))
        if not rows:
            story.append(Paragraph("No activity for this reporting period.", small))
            return
        table_rows = [[Paragraph("Category", small), Paragraph("Amount", right)]]
        for row in rows:
            table_rows.append([Paragraph(row.get(key) or "Uncategorized", small), Paragraph(_currency(row["total"]), right)])
        table = Table(table_rows, colWidths=[5.4 * inch, 1.5 * inch], repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.35, LINE), ("PADDING", (0, 0), (-1, -1), 6)]))
        story.append(table)

    add_breakdown("Income by category", data["income_by_category"])
    add_breakdown("Project expenses by category", data["project_expense_by_category"])
    add_breakdown("Business expenses by category", data["business_expense_by_category"])
    story.append(Paragraph("Project profitability", section))
    rows = [[Paragraph("Project", small), Paragraph("Collected", right), Paragraph("Costs", right), Paragraph("Cash profit", right)]]
    for row in data["project_profitability"]:
        rows.append(
            [
                Paragraph(f"{row['project'].name}<br/><font color='#647174'>{row['project'].project_number}</font>", small),
                Paragraph(_currency(row["collected"]), right),
                Paragraph(_currency(row["costs"]), right),
                Paragraph(f"<b>{_currency(row['profit'])}</b>", right),
            ]
        )
    if len(rows) > 1:
        table = Table(rows, colWidths=[3.4 * inch, 1.15 * inch, 1.15 * inch, 1.2 * inch], repeatRows=1)
        table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.35, LINE), ("PADDING", (0, 0), (-1, -1), 6)]))
        story.append(table)
    else:
        story.append(Paragraph("No project activity for this reporting period.", small))
    document.build(story)
    return output.getvalue()

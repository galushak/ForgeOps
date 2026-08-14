import re
import sqlite3
from contextlib import closing
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from sqlalchemy import create_engine, inspect, text
from sqlmodel import Session

from app.core.ny_sales_tax import ny_sales_tax_period, ny_sales_tax_periods
from app.core.security import utc_now
from app.db import engine
from app.models import LedgerBusinessType, LedgerEntry, LedgerKind


def _ledger_payload(**overrides):
    payload = {
        "entry_date": "2026-06-19",
        "kind": "expense",
        "business_type": "admin",
        "category": "Sales Tax Paid",
        "amount": "319.53",
        "sales_tax_period": "2026-Q2",
    }
    payload.update(overrides)
    return payload


def _quarter_report(authed, period: str):
    tax_period = ny_sales_tax_period(period)
    return authed.get(
        "/api/reports/money-flow",
        params={
            "start_date": tax_period.start_date.isoformat(),
            "end_date": tax_period.end_date.isoformat(),
            "sales_tax_period": period,
        },
    )


def _create_legacy_sales_tax_payment(amount="10.00", entry_date=date(2026, 6, 20)) -> int:
    now = utc_now()
    with Session(engine) as session:
        entry = LedgerEntry(
            entry_date=entry_date,
            kind=LedgerKind.expense,
            business_type=LedgerBusinessType.admin,
            category="Sales Tax Paid",
            amount=Decimal(amount),
            sales_tax_period=None,
            created_at=now,
            updated_at=now,
        )
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return int(entry.id)


def test_ny_sales_tax_period_source_and_frontend_characterization(authed):
    q1 = ny_sales_tax_period("2026-Q1")
    assert q1.start_date == date(2025, 12, 1)
    assert q1.end_date == date(2026, 2, 28)
    assert q1.label == "Q1 2026 (Dec-Feb)"
    assert ny_sales_tax_period("2026-Q2").model_dump() == {
        "key": "2026-Q2",
        "year": 2026,
        "quarter": 2,
        "start_date": "2026-03-01",
        "end_date": "2026-05-31",
        "label": "Q2 2026 (Mar-May)",
        "report_label": "NY Sales Tax Q2 2026 (Mar-May)",
    }
    assert [period.key for period in ny_sales_tax_periods(2026, 2026)] == [
        "2026-Q1",
        "2026-Q2",
        "2026-Q3",
        "2026-Q4",
    ]
    assert ny_sales_tax_periods(2101, 2102) == []

    options = authed.get("/api/reports/ny-sales-tax-periods")
    assert options.status_code == 200
    period_map = {item["key"]: item for item in options.json()["items"]}
    assert period_map["2026-Q3"]["start_date"] == "2026-06-01"
    assert period_map["2026-Q3"]["end_date"] == "2026-08-31"

    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    ledger_css = (static_dir / "phase6-ledger.css").read_text(encoding="utf-8")
    service_worker = (static_dir / "service-worker.js").read_text(encoding="utf-8")
    assert "/static/js/app.js?v=0.8.12-app-dialogs" in html
    assert "/static/phase6-ledger.css?v=0.8.12-sales-tax-period-controls" in html
    assert "forgeops-v2-app-dialogs-v1" in service_worker
    assert "/static/js/app.js?v=0.8.12-app-dialogs" in service_worker
    assert "/static/phase6-ledger.css?v=0.8.12-sales-tax-period-controls" in service_worker
    for marker in [
        "NY Sales Tax Quarter",
        'name="sales_tax_quarter"',
        'name="sales_tax_year"',
        'name="sales_tax_period" type="hidden"',
        "sales_tax_period",
        "data-ledger-sales-tax-period-wrap",
        "parseSalesTaxPeriod(editing?.sales_tax_period)",
        "composeSalesTaxPeriod(payload.sales_tax_year, payload.sales_tax_quarter)",
        "followEntryDateYear = false",
        "Tax period unassigned",
        "Applies to ${escapeHtml(salesTaxPeriodLabel",
        "/api/reports/ny-sales-tax-periods",
        "params.set('sales_tax_period'",
        "Applied Payments",
        "Sales tax payments applied to this quarter",
    ]:
        assert marker in javascript
    quarter_values = re.search(r"const SALES_TAX_QUARTERS = \[([^\]]+)\]", javascript)
    assert quarter_values
    assert [int(value.strip()) for value in quarter_values.group(1).split(",")] == [1, 2, 3, 4]
    assert 'select name="sales_tax_period"' not in javascript
    assert "salesTaxPeriodOptions" not in javascript
    assert ".ledger-sales-tax-period-fields" in ledger_css
    assert ".ledger-sales-tax-year-field" in ledger_css
    assert ".ledger-tax-period-unassigned" in ledger_css


def test_sales_tax_period_create_read_edit_clear_and_validation(authed):
    created = authed.post("/api/ledger", json=_ledger_payload())
    assert created.status_code == 201
    entry_id = created.json()["id"]
    assert created.json()["sales_tax_period"] == "2026-Q2"
    listed = authed.get("/api/ledger").json()["items"]
    assert listed[0]["sales_tax_period"] == "2026-Q2"

    edited = authed.patch(f"/api/ledger/{entry_id}", json={"sales_tax_period": "2026-Q3"})
    assert edited.status_code == 200
    assert edited.json()["sales_tax_period"] == "2026-Q3"

    changed_year = authed.patch(f"/api/ledger/{entry_id}", json={"sales_tax_period": "2025-Q2"})
    assert changed_year.status_code == 200
    assert changed_year.json()["sales_tax_period"] == "2025-Q2"

    invalid_shape = authed.post("/api/ledger", json=_ledger_payload(sales_tax_period="2026-Q5"))
    assert invalid_shape.status_code == 422
    invalid_year = authed.post("/api/ledger", json=_ledger_payload(sales_tax_period="1999-Q1"))
    assert invalid_year.status_code == 400
    missing = authed.post("/api/ledger", json=_ledger_payload(sales_tax_period=None))
    assert missing.status_code == 400
    assert missing.json()["detail"] == "Applies To NY Sales Tax Quarter is required for Sales Tax Paid entries"

    changed_category = authed.patch(
        f"/api/ledger/{entry_id}",
        json={"category": "General Business Expense"},
    )
    assert changed_category.status_code == 200
    assert changed_category.json()["sales_tax_period"] is None

    legacy_id = _create_legacy_sales_tax_payment()
    legacy = next(item for item in authed.get("/api/ledger").json()["items"] if item["id"] == legacy_id)
    assert legacy["sales_tax_period"] is None
    safe_maintenance = authed.patch(f"/api/ledger/{legacy_id}", json={"receipt_id": None})
    assert safe_maintenance.status_code == 200
    intentional_save = authed.patch(
        f"/api/ledger/{legacy_id}",
        json={"category": "Sales Tax Paid", "description": "Legacy edit"},
    )
    assert intentional_save.status_code == 400


def test_q2_payment_dated_in_q3_does_not_reduce_q3_reserve(authed):
    assert authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-05-15",
            "kind": "income",
            "business_type": "admin",
            "category": "Services",
            "amount": "1000.00",
        },
    ).status_code == 201
    assert authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-06-10",
            "kind": "income",
            "business_type": "admin",
            "category": "Services",
            "amount": "455.00",
        },
    ).status_code == 201
    assert authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-06-11",
            "kind": "expense",
            "business_type": "admin",
            "category": "General Business Expense",
            "amount": "161.95",
        },
    ).status_code == 201
    payment = authed.post("/api/ledger", json=_ledger_payload())
    assert payment.status_code == 201

    q3_response = _quarter_report(authed, "2026-Q3")
    assert q3_response.status_code == 200
    q3 = q3_response.json()
    cards = q3["cards"]
    assert cards["ledger_revenue"] == "455.00"
    assert cards["ledger_expenses"] == "161.95"
    assert cards["net_income"] == "293.05"
    assert cards["gross_sales_tax_estimate"] == "31.85"
    assert cards["sales_tax_paid"] == "0.00"
    assert cards["estimated_sales_tax"] == "31.85"
    assert cards["gross_income_tax_estimate"] == "87.92"
    assert cards["estimated_income_tax"] == "87.92"
    assert cards["ledger_net_profit"] == "173.28"
    assert Decimal(cards["ledger_net_profit"]) + Decimal(cards["estimated_sales_tax"]) + Decimal(
        cards["estimated_income_tax"]
    ) == Decimal(cards["net_income"])
    assert not any(
        row["category"] == "Sales Tax Paid" for row in q3["account_type_breakdown"]
    )
    assert q3["sales_tax_attribution"]["period"]["key"] == "2026-Q3"

    q2_response = _quarter_report(authed, "2026-Q2")
    assert q2_response.status_code == 200
    q2 = q2_response.json()
    assert q2["cards"]["ledger_revenue"] == "1000.00"
    assert q2["cards"]["sales_tax_paid"] == "319.53"
    assert any(
        row == {"account_type": "Tax Payments", "category": "Sales Tax Paid", "total": "319.53"}
        for row in q2["account_type_breakdown"]
    )

    june_date_report = authed.get(
        "/api/reports/money-flow",
        params={"start_date": "2026-06-01", "end_date": "2026-06-30"},
    )
    assert june_date_report.status_code == 200
    assert june_date_report.json()["cards"]["sales_tax_paid"] == "319.53"
    assert june_date_report.json()["sales_tax_attribution"]["mode"] == "transaction-date"
    invalid = authed.get(
        "/api/reports/money-flow",
        params={"start_date": "2026-06-01", "end_date": "2026-08-31", "sales_tax_period": "bad"},
    )
    assert invalid.status_code == 400
    mismatched_range = authed.get(
        "/api/reports/money-flow",
        params={
            "start_date": "2026-06-01",
            "end_date": "2026-08-31",
            "sales_tax_period": "2026-Q2",
        },
    )
    assert mismatched_range.status_code == 400
    assert mismatched_range.json()["detail"] == "Selected dates do not match the NY sales-tax period"


def test_legacy_date_fallback_until_period_is_assigned(authed):
    legacy_id = _create_legacy_sales_tax_payment()
    assert _quarter_report(authed, "2026-Q3").json()["cards"]["sales_tax_paid"] == "10.00"
    assert _quarter_report(authed, "2026-Q2").json()["cards"]["sales_tax_paid"] == "0.00"

    assigned = authed.patch(f"/api/ledger/{legacy_id}", json={"sales_tax_period": "2026-Q2"})
    assert assigned.status_code == 200
    assert assigned.json()["sales_tax_period"] == "2026-Q2"
    assert _quarter_report(authed, "2026-Q3").json()["cards"]["sales_tax_paid"] == "0.00"
    assert _quarter_report(authed, "2026-Q2").json()["cards"]["sales_tax_paid"] == "10.00"


def test_old_schema_migration_is_additive_idempotent_and_preserves_rows(tmp_path, monkeypatch):
    from app import db as db_module

    old_db = tmp_path / "old-schema.db"
    old_engine = create_engine(f"sqlite:///{old_db}")
    with old_engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE ledgerentry (
                    id INTEGER PRIMARY KEY,
                    entry_date DATE NOT NULL,
                    kind VARCHAR(10) NOT NULL,
                    business_type VARCHAR(10) NOT NULL,
                    category VARCHAR(80) NOT NULL,
                    amount NUMERIC(12, 2) NOT NULL,
                    description VARCHAR(500)
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO ledgerentry "
                "(id, entry_date, kind, business_type, category, amount, description) "
                "VALUES (7, '2026-06-19', 'revenue', 'admin', 'Services', 455.00, 'Preserve me')"
            )
        )
    monkeypatch.setattr(db_module, "engine", old_engine)

    db_module.run_lightweight_migrations()
    db_module.run_lightweight_migrations()

    columns = {column["name"] for column in inspect(old_engine).get_columns("ledgerentry")}
    assert {"quote_id", "invoice_id", "sales_tax_period"}.issubset(columns)
    with old_engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, entry_date, kind, category, amount, description, sales_tax_period FROM ledgerentry")
        ).one()
    assert tuple(row) == (7, "2026-06-19", "income", "Services", 455, "Preserve me", None)
    old_engine.dispose()


def test_backup_restore_preserves_period_and_upgrades_old_schema_backup(authed, tmp_path):
    created = authed.post("/api/ledger", json=_ledger_payload())
    assert created.status_code == 201
    entry_id = created.json()["id"]
    backup = authed.get("/api/admin/backups/download")
    assert backup.status_code == 200

    assert authed.patch(f"/api/ledger/{entry_id}", json={"sales_tax_period": "2026-Q3"}).status_code == 200
    restored = authed.post(
        "/api/admin/backups/restore",
        files={"file": ("sales-tax-period.zip", backup.content, "application/zip")},
    )
    assert restored.status_code == 200
    restored_entry = authed.get("/api/ledger").json()["items"][0]
    assert restored_entry["id"] == entry_id
    assert restored_entry["sales_tax_period"] == "2026-Q2"

    old_db = tmp_path / "old-backup.db"
    with ZipFile(BytesIO(backup.content)) as source:
        old_db.write_bytes(source.read("database/app.db"))
        archive_entries = [
            (info, source.read(info.filename))
            for info in source.infolist()
            if info.filename != "database/app.db"
        ]
    with closing(sqlite3.connect(old_db)) as conn:
        conn.execute("ALTER TABLE ledgerentry DROP COLUMN sales_tax_period")
        conn.commit()
    old_backup = tmp_path / "old-schema-backup.zip"
    with ZipFile(old_backup, "w", compression=ZIP_DEFLATED) as target:
        for info, content in archive_entries:
            target.writestr(info, content)
        target.write(old_db, "database/app.db")

    restored_old = authed.post(
        "/api/admin/backups/restore",
        files={"file": ("old-schema-backup.zip", old_backup.read_bytes(), "application/zip")},
    )
    assert restored_old.status_code == 200
    legacy_entry = authed.get("/api/ledger").json()["items"][0]
    assert legacy_entry["id"] == entry_id
    assert legacy_entry["amount"] == "319.53"
    assert legacy_entry["sales_tax_period"] is None
    with closing(sqlite3.connect("test-data/app.db")) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(ledgerentry)")}
    assert "sales_tax_period" in columns

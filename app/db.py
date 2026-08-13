from collections.abc import Generator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import get_settings
from app.core.security import utc_now
from app.models import AppSetting, DropdownKind, DropdownOption

settings = get_settings()
connect_args = {"check_same_thread": False}
engine = create_engine(settings.database_url, connect_args=connect_args)


DEFAULT_DROPDOWNS = {
    DropdownKind.ledger_category: [
        ("Services", "green"),
        ("Installation", "green"),
        ("Sales of Product", "green"),
        ("Computer Parts & Accessories", "green"),
        ("Networking Parts & Accessories", "green"),
        ("Security Parts & Accessories", "green"),
        ("Cost of Goods Sold", "blue"),
        ("CGS Computer Parts & Accessories", "blue"),
        ("CGS Networking Parts & Accessories", "blue"),
        ("CGS Security Parts & Accessories", "blue"),
        ("CGS Software & Apps", "blue"),
        ("General Business Expense", "red"),
        ("Tools and Equipment", "red"),
        ("Office Supplies", "red"),
        ("Sales Tax Paid", "red"),
        ("Income Tax Paid", "red"),
    ],
    DropdownKind.service_type: [
        ("Setup/Installation", None),
        ("Troubleshooting", None),
        ("Maintenance", None),
        ("System Configuration", None),
        ("Network Work", None),
        ("Security", None),
        ("Planning/Design/Research", None),
        ("Client Meeting/Call", None),
        ("Purchasing", None),
        ("Cable Runs", None),
    ],
}

DEFAULT_SETTINGS = {
    "company_name": "Forged Systems LLC",
    "quote_prefix": "FS-QUOTE",
    "invoice_prefix": "FS-INV",
    "default_labor_rate": "100.00",
    "sales_tax_rate": "0.07",
    "income_tax_reserve_rate": "0.30",
    "quote_markup_percent": "10",
    "default_quote_terms": "Full payment for equipment is due upfront prior to ordering hardware.\nLabor is billed after work is completed and is subject to change.\nTwo (2) hour minimum labor charge applies.\nAdditional labor beyond estimate will be billed at the standard hourly rate.\nThis quote is valid for 30 days from the date issued. Pricing and availability of equipment are subject to change after this period.",
    "default_invoice_terms": "Payment due upon receipt of this invoice.",
}


def init_storage() -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.db_file_path.parent.mkdir(parents=True, exist_ok=True)
    settings.receipts_dir.mkdir(parents=True, exist_ok=True)
    settings.exports_dir.mkdir(parents=True, exist_ok=True)
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)


def run_lightweight_migrations() -> None:
    # SQLite MVP migrations: create_all adds new tables, then this adds columns
    # introduced after an older backup/database was created.
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "laborentry" in table_names:
        existing_columns = {column["name"] for column in inspector.get_columns("laborentry")}
        if "invoice_id" not in existing_columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE laborentry ADD COLUMN invoice_id INTEGER"))

    # v0.7.7: Ledger now follows QuickBooks-style account types. Move legacy
    # "revenue" rows to "income" so old backups/databases continue working.
    if "ledgerentry" in table_names:
        existing_columns = {column["name"] for column in inspector.get_columns("ledgerentry")}
        with engine.begin() as conn:
            if "quote_id" not in existing_columns:
                conn.execute(text("ALTER TABLE ledgerentry ADD COLUMN quote_id INTEGER"))
            if "invoice_id" not in existing_columns:
                conn.execute(text("ALTER TABLE ledgerentry ADD COLUMN invoice_id INTEGER"))
            if "sales_tax_period" not in existing_columns:
                conn.execute(text("ALTER TABLE ledgerentry ADD COLUMN sales_tax_period VARCHAR(7)"))
            conn.execute(text("UPDATE ledgerentry SET kind = 'income' WHERE kind = 'revenue'"))


def init_db() -> None:
    init_storage()
    SQLModel.metadata.create_all(engine)
    run_lightweight_migrations()
    seed_defaults()


def seed_defaults() -> None:
    with Session(engine) as session:
        for key, value in DEFAULT_SETTINGS.items():
            existing = session.get(AppSetting, key)
            if existing is None:
                session.add(AppSetting(key=key, value=value, updated_at=utc_now()))

        # Repair only known placeholder/incorrect quote terms from early MVP builds.
        quote_terms = session.get(AppSetting, "default_quote_terms")
        if quote_terms is not None and quote_terms.value.strip() in {
            "",
            "Equipment due up front. Labor due after completion.",
            "Payment due upon receipt of this invoice.",
            "Payment is due upon receipt of this invoice.",
        }:
            quote_terms.value = DEFAULT_SETTINGS["default_quote_terms"]
            quote_terms.updated_at = utc_now()
            session.add(quote_terms)

        invoice_terms = session.get(AppSetting, "default_invoice_terms")
        if invoice_terms is None:
            session.add(AppSetting(key="default_invoice_terms", value=DEFAULT_SETTINGS["default_invoice_terms"], updated_at=utc_now()))

        for kind, options in DEFAULT_DROPDOWNS.items():
            for index, (label, color) in enumerate(options, start=10):
                existing_option = session.exec(
                    select(DropdownOption).where(DropdownOption.kind == kind, DropdownOption.label == label)
                ).first()
                if existing_option is None:
                    session.add(
                        DropdownOption(
                            kind=kind,
                            label=label,
                            color=color,
                            sort_order=index * 10,
                            is_active=True,
                            created_at=utc_now(),
                            updated_at=utc_now(),
                        )
                    )
        session.commit()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

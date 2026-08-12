# Forged Systems Tracking

Forged Systems Tracking is a self-hosted business tracker for Forged Systems LLC-style workflows: clients, projects, quotes, invoices, labor, ledger entries, receipt uploads, and full backup/restore from day one.

## Current MVP

- Initial setup flow plus login with remember-me session cookie
- Dashboard cards for revenue, expenses, net profit, clients, projects, quotes, invoices, labor, and receipts
- Clients CRUD plus saved client site addresses
- Projects CRUD with site address dropdown based on selected client
- Quotes CRUD attached to clients and projects
- Invoices CRUD attached to clients, projects, and optional quotes
- Labor CRUD with client/project/invoice links, hours, rate, invoice status, and line totals
- Ledger CRUD with client/project links
- Receipt photo/PDF uploads, metadata editing, download/preview links, and delete
- Admin Backup & Restore page
- Full backups include `app.db`, uploads, exports, and a manifest
- Docker + SQLite persistence using `./data:/app/data`

## Initial Setup

On first boot, the app shows an initial setup screen. Choose one:

- **Create Account** to create the first local admin user.
- **Restore Backup** to restore an existing full backup before any account exists.

The boot-time restore option is only shown during initial setup. After setup, restore is available from the authenticated **Backup & Restore** admin page.

Set a strong secret before real use:

```env
APP_SECRET_KEY=change-me-to-a-long-random-secret
```

## Local Run

```bash
python -m venv .venv
. .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate  # Windows PowerShell
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Open http://localhost:8000

## Docker Run

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:8000

## Backup & Restore

Go to **Backup & Restore** in the app.

Backups are ZIP files containing:

```text
database/app.db
uploads/
exports/
manifest.json
```

Restore validates the backup, creates an automatic pre-restore backup, then replaces the database/uploads/exports.

## Quality Gates

```bash
black app tests
ruff check app tests
mypy app
pytest --cov=app --cov-report=term-missing --cov-fail-under=85
```

Common fixes:

- If you want to test initial setup again, stop the app and remove old `data/app.db` plus SQLite sidecar files.
- If backup fails, confirm the container/user can write to `./data`.
- If Docker does not rebuild frontend changes, run `docker compose up --build --force-recreate`.

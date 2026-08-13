import json
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile


def test_frontend_shell_characterization():
    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    shell_css = (static_dir / "shell.css").read_text(encoding="utf-8")
    manifest = json.loads((static_dir / "manifest.webmanifest").read_text(encoding="utf-8"))

    assert "<title>ForgeOps</title>" in html
    assert 'aria-label="ForgeOps">FO<' in html
    assert manifest["name"] == "ForgeOps"
    assert manifest["short_name"] == "ForgeOps"
    assert [icon["src"] for icon in manifest["icons"]] == [
        "/static/icons/icon-192.png",
        "/static/icons/icon-512.png",
    ]

    assert '<html lang="en" data-theme="light">' in html
    assert "forgeops-theme" in html
    assert "forgeops-theme" in javascript
    assert html.count("data-theme-toggle") >= 3

    bottom_nav = html[
        html.index('<nav class="mobile-bottom-nav"') : html.index(
            "</nav>", html.index('<nav class="mobile-bottom-nav"')
        )
    ]
    required_order = [
        'data-page="dashboard"',
        'data-page="clients"',
        'id="mobileCreateBtn"',
        'data-page="projects"',
        'data-page="ledger"',
        'data-page="reports"',
    ]
    assert [bottom_nav.index(marker) for marker in required_order] == sorted(
        bottom_nav.index(marker) for marker in required_order
    )
    assert html.count('id="mobileCreateBtn"') == 1
    assert 'aria-label="Create new"' in bottom_nav

    for label in ["New Client", "New Project", "Add Labor", "Add Expense", "New Quote", "New Invoice"]:
        assert label in html
    for page in ["quotes", "invoices", "labor", "admin"]:
        assert f'data-page="{page}"' in html

    assert "mobileMenuBtn" not in html
    assert "sidebarScrim" not in html
    assert "mobile-nav-open" not in javascript
    assert "env(safe-area-inset-bottom" in shell_css


def test_frontend_phase_2_home_clients_projects_characterization():
    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    phase2_css = (static_dir / "phase2.css").read_text(encoding="utf-8")
    service_worker = (static_dir / "service-worker.js").read_text(encoding="utf-8")

    assert "/static/phase2.css?v=0.8.12-phase2-polish" in html
    assert "/static/js/app.js?v=0.8.12-phase5-labor" in html
    assert "forgeops-phase-5-labor" in service_worker
    assert "async function renderProjectDetail" in javascript
    assert "async function renderClientDetail" in javascript
    assert "Needs Attention" in javascript
    assert "Estimated Take-Home" in javascript
    assert "Sales Tax Safety Hold" in javascript
    assert "/api/reports/money-flow?start_date=" in javascript
    assert "openScopedActionSheet" in javascript
    assert "data-client-tab" in javascript
    assert "data-project-tab" in javascript
    assert "projectClientFilter" in javascript
    assert "adaptiveRecordList" in javascript
    assert javascript.index("<h2>This Month</h2>") < javascript.index("<h2>Needs Attention</h2>")
    assert "No open work yet." not in javascript
    assert 'class="tabs hub-tabs detail-tab-grid client-detail-tabs"' in javascript
    assert 'class="tabs hub-tabs detail-tab-grid project-detail-tabs"' in javascript
    assert 'class="tabs hub-tabs" role="tablist"' not in javascript
    assert ".record-list-head" in phase2_css
    assert ".scoped-action-sheet" in phase2_css
    assert ".detail-header ~ .hub-tabs.detail-tab-grid" in phase2_css
    assert ".client-detail-tabs" in phase2_css
    assert ".project-detail-tabs" in phase2_css
    assert "overflow: visible" in phase2_css
    assert "@media (max-width: 760px)" in phase2_css


def test_frontend_phase_3_quote_workflow_characterization():
    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    phase3_css = (static_dir / "phase3-quotes.css").read_text(encoding="utf-8")
    service_worker = (static_dir / "service-worker.js").read_text(encoding="utf-8")

    assert "/static/phase3-quotes.css?v=0.8.12-phase3-quotes-v2" in html
    assert "/static/js/app.js?v=0.8.12-phase5-labor" in html
    assert "/static/phase3-quotes.css?v=0.8.12-phase3-quotes-v2" in service_worker

    for marker in [
        "quote-list-controls",
        "Search Quotes",
        'id="quoteStatusFilter"',
        'id="quoteClientFilter"',
        'id="resetQuoteFilters"',
        'id="openQuoteModal"',
        "quote-mobile-list",
        "quote-desktop-list",
        "quote-record-card",
    ]:
        assert marker in javascript

    assert "function quoteEditorFormHtml" in javascript
    assert javascript.count("quoteEditorFormHtml({") == 3
    assert "function persistQuoteEditor" in javascript
    assert "formId:'quoteForm'" in javascript
    assert "formId:'clientQuoteForm'" in javascript

    line_editor = javascript[
        javascript.index("function quoteLineEditorHtml") : javascript.index("function collectQuoteLineItems")
    ]
    required_line_section_order = [
        "Equipment & Materials",
        "Shipping, Tariff & Markup",
        "Estimated Labor",
        "Quote Summary",
    ]
    assert [line_editor.index(marker) for marker in required_line_section_order] == sorted(
        line_editor.index(marker) for marker in required_line_section_order
    )

    form_editor = javascript[
        javascript.index("function quoteEditorFormHtml") : javascript.index("async function persistQuoteEditor")
    ]
    assert form_editor.index("Quote Details") < form_editor.index("quoteLineEditorHtml")
    assert form_editor.index("quoteLineEditorHtml") < form_editor.index("Payment Terms & Conditions")
    assert form_editor.index("Payment Terms & Conditions") < form_editor.index("Internal Notes")

    for marker in [
        'name="client_id"',
        'name="project_id"',
        'name="quote_number"',
        'id="addEquipmentLine"',
        'id="addLaborLine"',
        'id="quoteShippingInput"',
        'id="quoteTariffInput"',
        'id="quoteTaxDisplay"',
        'id="quoteMarkupPercentInput"',
        'id="quoteGrandTotalDisplay"',
        'name="terms"',
        'name="notes"',
        "Save Quote",
        "Cancel",
        "Print Quote",
    ]:
        assert marker in javascript

    assert "Quote – Internal Working Sheet" not in javascript
    assert "just like the spreadsheet" not in javascript
    assert "quote-approval-preview" not in javascript
    assert "Client Approval & Authorization" in javascript
    assert 'Client Name:<span class="signature-line"' in javascript

    for marker in [
        ".quote-mobile-list",
        ".quote-desktop-list",
        ".quote-line-card",
        ".quote-fee-grid",
        ".quote-summary-grid",
        ".quote-editor-actions",
        "@media (max-width: 800px)",
        "env(safe-area-inset-bottom",
    ]:
        assert marker in phase3_css

    assert "const tax = (equipmentSubtotal + shipping + tariff) * taxRate;" in javascript
    assert "const markup = (equipmentSubtotal + shipping + tariff + tax) * (markupPercent / 100);" in javascript
    assert "const subtotal = equipmentSubtotal + shipping + tariff + markup + laborTotal;" in javascript
    assert "Project Coordination & Logistics', description:" in javascript
    assert "taxable:false" in javascript


def test_frontend_phase_4_invoice_workflow_characterization():
    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    phase4_css = (static_dir / "phase4-invoices.css").read_text(encoding="utf-8")
    service_worker = (static_dir / "service-worker.js").read_text(encoding="utf-8")

    assert "/static/phase4-invoices.css?v=0.8.12-phase4-invoices-mobile-fix" in html
    assert "/static/js/app.js?v=0.8.12-phase5-labor" in html
    assert "forgeops-phase-5-labor" in service_worker
    assert "/static/phase4-invoices.css?v=0.8.12-phase4-invoices-mobile-fix" in service_worker

    for marker in [
        "invoiceStatusFilter",
        "invoiceClientFilter",
        "Search Invoices",
        "invoice-desktop-list",
        "invoice-mobile-list",
        "invoiceCardHtml",
        "invoiceListEmptyHtml",
        "Available Uninvoiced Labor",
        "statusLabel(entry.status)",
        "invoice-totals-summary",
        "invoice-terms-notes-grid",
        "data-invoice-sticky-balance",
    ]:
        assert marker in javascript

    invoice_editor = javascript[
        javascript.index("function invoiceInternalSheetHtml") : javascript.index("function invoiceEditorShellHtml")
    ]
    required_section_order = [
        "Invoice Details",
        "Billing Context",
        "Available Uninvoiced Labor",
        "Additional Materials",
        "Credits / Payments Applied",
        "Invoice Totals",
        "Terms and Notes",
    ]
    assert [invoice_editor.index(marker) for marker in required_section_order] == sorted(
        invoice_editor.index(marker) for marker in required_section_order
    )

    line_wiring = javascript[
        javascript.index("function wireInvoiceLineEditor") : javascript.index("function recalcInvoiceEditor")
    ]
    assert "addMaterial.onclick" in line_wiring
    assert "addCredit.onclick" in line_wiring
    assert "{ once: true }" not in line_wiring

    for marker in [
        'data-action="create-invoice-from-quote"',
        "startInvoiceFromQuote",
        "Create another invoice?",
        "scopedQuoteId",
        "returnToProject",
        "returnToDashboard",
        "printInvoice",
        "invoicePrintSection",
        "QUICK_CREATE_ACTIONS",
        "New Invoice",
        "setInvoiceEditorPageState(true)",
        "setInvoiceEditorPageState(false)",
        "mobileNavigation.inert = active",
        "mobileNavigation.setAttribute('aria-hidden', 'true')",
    ]:
        assert marker in javascript

    for marker in [
        ".invoice-desktop-list",
        ".invoice-mobile-list",
        ".invoice-record-card",
        ".invoice-editor-shell",
        ".invoice-labor-card",
        ".invoice-totals-summary",
        ".invoice-editor-actions",
        ".quote-invoice-actions",
        ".quote-desktop-list .quote-invoice-actions",
        "@media (max-width: 700px)",
        "@media (max-width: 360px)",
        "env(safe-area-inset-bottom",
        "body.invoice-editor-open .mobile-bottom-nav",
        "visibility: hidden",
        "pointer-events: none",
        ".invoice-editor-shell.modal-card.wide-modal",
        "min-height: 100dvh",
    ]:
        assert marker in phase4_css


def test_frontend_phase_5_labor_workflow_characterization():
    static_dir = Path(__file__).resolve().parents[1] / "app" / "static"
    html = (static_dir / "index.html").read_text(encoding="utf-8")
    javascript = (static_dir / "js" / "app.js").read_text(encoding="utf-8")
    phase5_css = (static_dir / "phase5-labor.css").read_text(encoding="utf-8")
    service_worker = (static_dir / "service-worker.js").read_text(encoding="utf-8")

    assert "/static/phase5-labor.css?v=0.8.12-phase5-labor" in html
    assert "/static/js/app.js?v=0.8.12-phase5-labor" in html
    assert "forgeops-phase-5-labor" in service_worker
    assert "/static/phase5-labor.css?v=0.8.12-phase5-labor" in service_worker
    assert "/static/js/app.js?v=0.8.12-phase5-labor" in service_worker

    for marker in [
        "Search Labor",
        "laborStatusFilter",
        "laborClientFilter",
        "laborProjectFilter",
        "laborBillingFilter",
        "laborResultCount",
        "labor-desktop-list",
        "labor-mobile-list",
        "laborCardHtml",
        "laborStatusChip",
        "laborBillingChip",
        "Available / Uninvoiced",
        "No Labor yet.",
        "No Labor matches these filters.",
        "Work Context",
        "Work Details",
        "Billing State",
        "laborEditorShellHtml",
        "wireLaborEditor",
        "setLaborEditorPageState(true)",
        "setLaborEditorPageState(false)",
        "mobileNavigation.inert = active",
        "QUICK_CREATE_ACTIONS",
        "openClientQuickModal(project.client_id, 'labor'",
        "returnToDashboard: true",
    ]:
        assert marker in javascript

    assert "laborEditorShellHtml({editing, settings, formId:'clientLaborForm'" in javascript

    for marker in [
        ".labor-desktop-list",
        ".labor-mobile-list",
        ".labor-record-card",
        ".labor-chip",
        ".labor-editor-shell",
        ".labor-editor-actions",
        "body.labor-editor-open .mobile-bottom-nav",
        "visibility: hidden",
        "pointer-events: none",
        "min-height: 100dvh",
        "env(safe-area-inset-bottom",
        "@media (max-width: 700px)",
        "@media (max-width: 360px)",
    ]:
        assert marker in phase5_css


def test_health(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_auth_required(client):
    response = client.get("/api/dashboard")
    assert response.status_code == 401


def test_client_project_ledger_flow(authed):
    c = authed.post("/api/clients", json={"name": "Smith Family", "email": "smith@example.com"})
    assert c.status_code == 201
    client_id = c.json()["id"]

    p = authed.post("/api/projects", json={"client_id": client_id, "name": "Camera Install", "status": "lead"})
    assert p.status_code == 201
    project_id = p.json()["id"]

    entry = authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-05-26",
            "kind": "income",
            "business_type": "client",
            "category": "Services",
            "amount": "300.00",
            "client_id": client_id,
            "project_id": project_id,
            "description": "Initial deposit",
        },
    )
    assert entry.status_code == 201
    dash = authed.get("/api/dashboard").json()["cards"]
    assert dash["clients"] == 1
    assert dash["projects"] == 1
    assert dash["revenue"] == "300.00"


def test_validation_error_for_missing_project_client(authed):
    response = authed.post("/api/projects", json={"client_id": 999, "name": "Bad Project"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Client does not exist"


def test_receipt_upload_and_download(authed):
    files = {"file": ("receipt.pdf", b"%PDF-1.4 fake receipt", "application/pdf")}
    response = authed.post("/api/receipts", files=files)
    assert response.status_code == 201
    receipt_id = response.json()["id"]
    downloaded = authed.get(f"/api/receipts/{receipt_id}/file")
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"%PDF")


def test_backup_download_contains_database_and_uploads(authed):
    authed.post("/api/receipts", files={"file": ("receipt.png", b"png-data", "image/png")})
    response = authed.get("/api/admin/backups/download")
    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as zf:
        names = set(zf.namelist())
    assert "manifest.json" in names
    assert "database/app.db" in names
    assert any(name.startswith("uploads/receipts/") for name in names)


def test_clients_update_read_list_delete(authed):
    created = authed.post("/api/clients", json={"name": "Acme"}).json()
    cid = created["id"]
    assert authed.get("/api/clients", params={"q": "Acme"}).json()["meta"]["total"] == 1
    assert authed.get(f"/api/clients/{cid}").json()["name"] == "Acme"
    updated = authed.patch(f"/api/clients/{cid}", json={"phone": "518-555-1212"}).json()
    assert updated["phone"] == "518-555-1212"
    assert authed.delete(f"/api/clients/{cid}").status_code == 200
    assert authed.get(f"/api/clients/{cid}").status_code == 404


def test_projects_update_list_delete(authed):
    cid = authed.post("/api/clients", json={"name": "Project Client"}).json()["id"]
    pid = authed.post("/api/projects", json={"client_id": cid, "name": "Network Install"}).json()["id"]
    assert authed.get("/api/projects", params={"client_id": cid}).json()["meta"]["total"] == 1
    changed = authed.patch(f"/api/projects/{pid}", json={"status": "completed"}).json()
    assert changed["status"] == "completed"
    assert authed.patch(f"/api/projects/{pid}", json={"client_id": 999}).status_code == 400
    assert authed.delete(f"/api/projects/{pid}").status_code == 200
    assert authed.patch(f"/api/projects/{pid}", json={"name": "Gone"}).status_code == 404


def test_ledger_update_summary_delete_and_invalid_receipt(authed):
    response = authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-05-26",
            "kind": "expense",
            "business_type": "admin",
            "category": "Tools and Equipment",
            "amount": "50.00",
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert created["client_id"] is None
    assert created["project_id"] is None
    eid = created["id"]
    listed = authed.get("/api/ledger", params={"kind": "expense", "business_type": "admin"}).json()
    assert listed["meta"]["total"] == 1
    assert listed["items"][0]["project_id"] is None
    assert authed.get("/api/ledger/summary").json()["expenses"] == "50.00"
    updated = authed.patch(f"/api/ledger/{eid}", json={"amount": "75.00"}).json()
    assert updated["amount"] == "75.00"
    assert (
        authed.post(
            "/api/ledger",
            json={
                "entry_date": "2026-05-26",
                "kind": "expense",
                "business_type": "admin",
                "category": "Tools and Equipment",
                "amount": "10.00",
                "receipt_id": 999,
            },
        ).status_code
        == 400
    )
    assert authed.delete(f"/api/ledger/{eid}").status_code == 200
    assert authed.patch(f"/api/ledger/{eid}", json={"amount": "5.00"}).status_code == 404


def test_receipts_update_list_delete_invalid_type(authed):
    bad = authed.post("/api/receipts", files={"file": ("bad.txt", b"hello", "text/plain")})
    assert bad.status_code == 400
    rid = authed.post("/api/receipts", files={"file": ("receipt.jpg", b"jpg-data", "image/jpeg")}).json()["id"]
    listed = authed.get("/api/receipts").json()
    assert listed["meta"]["total"] == 1
    updated = authed.patch(
        f"/api/receipts/{rid}",
        json={
            "vendor_name": "Home Depot",
            "total_amount": "12.34",
            "status": "reviewed",
            "linked_type": "admin_expense",
            "linked_id": 1,
        },
    ).json()
    assert updated["vendor_name"] == "Home Depot"
    assert authed.get("/api/receipts", params={"linked_type": "admin_expense"}).json()["meta"]["total"] == 1
    assert authed.delete(f"/api/receipts/{rid}").status_code == 200
    assert authed.get(f"/api/receipts/{rid}/file").status_code == 404


def test_settings_and_backup_validate_restore(authed):
    settings = authed.get("/api/admin/settings")
    assert settings.status_code == 200
    assert "company_name" in settings.json()["settings"]
    assert authed.put("/api/admin/settings", json={"company_name": "Forged Systems LLC"}).status_code == 200

    authed.post("/api/clients", json={"name": "Before Restore"})
    backup = authed.get("/api/admin/backups/download")
    assert backup.status_code == 200
    invalid = authed.post("/api/admin/backups/validate", files={"file": ("bad.zip", b"nope", "application/zip")})
    assert invalid.status_code == 400
    valid = authed.post(
        "/api/admin/backups/validate", files={"file": ("backup.zip", backup.content, "application/zip")}
    )
    assert valid.status_code == 200
    restored = authed.post(
        "/api/admin/backups/restore", files={"file": ("backup.zip", backup.content, "application/zip")}
    )
    assert restored.status_code == 200
    assert restored.json()["pre_restore_backup"].startswith("fst-backup-")


def test_full_backup_restore_preserves_business_graph_settings_and_startup(authed):
    assert authed.put(
        "/api/admin/settings",
        json={"company_name": "Backup Graph LLC", "sales_tax_rate": "7"},
    ).status_code == 200
    client_id = authed.post("/api/clients", json={"name": "Backup Graph Client"}).json()["id"]
    project_id = authed.post(
        "/api/projects",
        json={"client_id": client_id, "name": "Backup Graph Project", "status": "in_progress"},
    ).json()["id"]
    quote_id = authed.post(
        "/api/quotes",
        json={
            "quote_number": "FS-QUOTE-BACKUP-GRAPH",
            "client_id": client_id,
            "project_id": project_id,
            "status": "approved",
            "title": "Backup Graph Quote",
            "quote_date": "2026-08-12",
            "tax_amount": "7.00",
        },
    ).json()["id"]
    quote_lines = authed.put(
        f"/api/quotes/{quote_id}/line-items",
        json={
            "items": [
                {
                    "quote_id": quote_id,
                    "kind": "equipment",
                    "name": "Backup appliance",
                    "description": "Relationship validation",
                    "quantity": "1.00",
                    "unit_price": "100.00",
                    "line_total": "100.00",
                    "taxable": True,
                }
            ]
        },
    )
    assert quote_lines.status_code == 200
    labor_id = authed.post(
        "/api/labor",
        json={
            "work_date": "2026-08-12",
            "client_id": client_id,
            "project_id": project_id,
            "status": "completed",
            "service_type": "Backup validation",
            "hours": "2.00",
            "hourly_rate": "100.00",
        },
    ).json()["id"]
    invoice = authed.post(
        "/api/invoices",
        json={
            "invoice_number": "FS-INV-BACKUP-GRAPH",
            "client_id": client_id,
            "project_id": project_id,
            "quote_id": quote_id,
            "status": "sent",
            "title": "Backup Graph Invoice",
            "invoice_date": "2026-08-12",
            "labor_entry_ids": [labor_id],
            "line_items": [
                {
                    "kind": "material",
                    "description": "Backup media",
                    "quantity": "1.00",
                    "unit_price": "50.00",
                    "line_total": "50.00",
                    "taxable": True,
                },
                {
                    "kind": "payment",
                    "description": "Partial payment",
                    "quantity": "1.00",
                    "unit_price": "25.00",
                    "line_total": "25.00",
                    "taxable": False,
                },
            ],
        },
    )
    assert invoice.status_code == 201
    invoice_id = invoice.json()["id"]
    ledger_id = authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-08-12",
            "kind": "income",
            "business_type": "client",
            "category": "Services",
            "amount": "25.00",
            "client_id": client_id,
            "project_id": project_id,
            "quote_id": quote_id,
            "invoice_id": invoice_id,
            "description": "Partial payment received",
        },
    )
    assert ledger_id.status_code == 201

    backup = authed.get("/api/admin/backups/download")
    assert backup.status_code == 200
    assert authed.patch(f"/api/clients/{client_id}", json={"name": "Mutated Client"}).status_code == 200
    assert authed.put("/api/admin/settings", json={"company_name": "Mutated LLC"}).status_code == 200

    restored = authed.post(
        "/api/admin/backups/restore",
        files={"file": ("business-graph.zip", backup.content, "application/zip")},
    )
    assert restored.status_code == 200
    counts = restored.json()["restored_counts"]
    assert counts == {
        "clients": 1,
        "projects": 1,
        "quotes": 1,
        "quote_line_items": 1,
        "invoices": 1,
        "labor_entries": 1,
        "ledger_entries": 1,
        "receipts": 0,
    }

    settings = authed.get("/api/admin/settings").json()["settings"]
    assert settings["company_name"] == "Backup Graph LLC"
    assert settings["sales_tax_rate"] == "0.07"
    restored_client = authed.get(f"/api/clients/{client_id}").json()
    restored_project = authed.get("/api/projects", params={"client_id": client_id}).json()["items"][0]
    restored_quote = authed.get("/api/quotes", params={"project_id": project_id}).json()["items"][0]
    restored_quote_lines = authed.get(f"/api/quotes/{quote_id}/line-items").json()["items"]
    restored_invoice = authed.get("/api/invoices", params={"project_id": project_id}).json()["items"][0]
    restored_labor = authed.get("/api/labor", params={"project_id": project_id}).json()["items"][0]
    restored_ledger = authed.get("/api/ledger", params={"project_id": project_id}).json()["items"][0]
    assert restored_client["name"] == "Backup Graph Client"
    assert restored_project["client_id"] == client_id
    assert restored_quote["project_id"] == project_id
    assert restored_quote_lines[0]["quote_id"] == quote_id
    assert restored_invoice["client_id"] == client_id
    assert restored_invoice["project_id"] == project_id
    assert restored_invoice["quote_id"] == quote_id
    assert len(restored_invoice["line_items"]) == 2
    assert restored_labor["invoice_id"] == invoice_id
    assert restored_labor["is_invoiced"] is True
    assert restored_ledger["client_id"] == client_id
    assert restored_ledger["project_id"] == project_id
    assert restored_ledger["quote_id"] == quote_id
    assert restored_ledger["invoice_id"] == invoice_id

    from app.db import init_db

    init_db()
    assert authed.get(f"/api/clients/{client_id}").json()["name"] == "Backup Graph Client"
    assert authed.get("/api/admin/settings").json()["settings"]["company_name"] == "Backup Graph LLC"


def test_sales_tax_setting_normalizes_percent_and_decimal_inputs(authed):
    normalized = authed.put("/api/admin/settings", json={"sales_tax_rate": "7"})
    assert normalized.status_code == 200
    assert authed.get("/api/admin/settings").json()["settings"]["sales_tax_rate"] == "0.07"

    client_id = authed.post("/api/clients", json={"name": "Tax Rate Client"}).json()["id"]
    invoice_payload = {
        "invoice_number": "FS-INV-TAX-SAFE-001",
        "client_id": client_id,
        "title": "Tax Rate Safety",
        "invoice_date": "2026-08-12",
        "line_items": [
            {
                "kind": "material",
                "description": "Taxable material",
                "quantity": "1.00",
                "unit_price": "100.00",
                "line_total": "100.00",
                "taxable": True,
            }
        ],
    }
    invoice = authed.post("/api/invoices", json=invoice_payload)
    assert invoice.status_code == 201
    assert invoice.json()["tax_amount"] == "7.00"
    assert invoice.json()["total_amount"] == "107.00"

    decimal_input = authed.put("/api/admin/settings", json={"sales_tax_rate": "0.07"})
    assert decimal_input.status_code == 200
    assert authed.get("/api/admin/settings").json()["settings"]["sales_tax_rate"] == "0.07"

    invalid = authed.put("/api/admin/settings", json={"sales_tax_rate": "700"})
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "Enter a rate from 0 to 100, using either 7 or 0.07 for 7%"
    assert authed.get("/api/admin/settings").json()["settings"]["sales_tax_rate"] == "0.07"

    from sqlmodel import Session

    from app.db import engine
    from app.models import AppSetting

    with Session(engine) as session:
        stored_rate = session.get(AppSetting, "sales_tax_rate")
        stored_rate.value = "7"
        session.add(stored_rate)
        session.commit()
    legacy_invoice = authed.post(
        "/api/invoices",
        json={**invoice_payload, "invoice_number": "FS-INV-TAX-SAFE-002"},
    )
    assert legacy_invoice.status_code == 201
    assert legacy_invoice.json()["tax_amount"] == "7.00"


def test_login_failure_and_logout(client, authed):
    client.post("/api/auth/logout")
    failed = client.post("/api/auth/login", json={"email": "admin@example.com", "password": "wrongpass123"})
    assert failed.status_code == 401


def test_client_addresses_and_labor_flow(authed):
    client = authed.post(
        "/api/clients",
        json={"name": "Address Client", "site_address": "100 Main St"},
    ).json()
    client_id = client["id"]

    addresses = authed.get(f"/api/clients/{client_id}/addresses")
    assert addresses.status_code == 200
    assert any(item["address"] == "100 Main St" for item in addresses.json()["items"])

    new_address = authed.post(
        f"/api/clients/{client_id}/addresses",
        json={"client_id": client_id, "label": "Barn", "address": "200 Barn Rd", "is_default": False},
    )
    assert new_address.status_code == 201
    address_id = new_address.json()["id"]
    assert (
        authed.patch(f"/api/clients/{client_id}/addresses/{address_id}", json={"is_default": True}).status_code == 200
    )

    project_id = authed.post(
        "/api/projects",
        json={"client_id": client_id, "name": "Camera Work", "site_address": "200 Barn Rd"},
    ).json()["id"]

    labor = authed.post(
        "/api/labor",
        json={
            "work_date": "2026-05-26",
            "client_id": client_id,
            "project_id": project_id,
            "status": "completed",
            "service_type": "Camera install",
            "hours": "2.50",
            "hourly_rate": "100.00",
            "notes": "Mounted cameras",
        },
    )
    assert labor.status_code == 201
    labor_id = labor.json()["id"]
    assert labor.json()["line_total"] == "250.00"

    listed = authed.get("/api/labor", params={"client_id": client_id, "project_id": project_id}).json()
    assert listed["meta"]["total"] == 1
    assert listed["meta"]["page_total_amount"] == "250.00"

    changed = authed.patch(f"/api/labor/{labor_id}", json={"is_invoiced": True, "status": "invoiced"}).json()
    assert changed["is_invoiced"] is True
    assert changed["status"] == "invoiced"

    assert authed.delete(f"/api/projects/{project_id}").status_code == 400
    assert authed.delete(f"/api/labor/{labor_id}").status_code == 200
    assert authed.delete(f"/api/projects/{project_id}").status_code == 200


def test_dropdown_options_admin_flow(authed):
    listed = authed.get("/api/dropdowns", params={"kind": "ledger_category"})
    assert listed.status_code == 200
    assert any(item["label"] == "Tools and Equipment" for item in listed.json()["items"])

    created = authed.post(
        "/api/admin/dropdowns",
        json={"kind": "service_type", "label": "Rack Cleanup", "sort_order": 500, "is_active": True},
    )
    assert created.status_code == 201
    option_id = created.json()["id"]

    changed = authed.patch(f"/api/admin/dropdowns/{option_id}", json={"is_active": False})
    assert changed.status_code == 200
    assert changed.json()["is_active"] is False

    active_only = authed.get("/api/dropdowns", params={"kind": "service_type"}).json()["items"]
    assert all(item["id"] != option_id for item in active_only)

    assert authed.delete(f"/api/admin/dropdowns/{option_id}").status_code == 200


def test_quotes_invoices_and_labor_invoice_link_flow(authed):
    client_id = authed.post("/api/clients", json={"name": "Billing Client"}).json()["id"]
    project_id = authed.post("/api/projects", json={"client_id": client_id, "name": "Billing Project"}).json()["id"]

    quote = authed.post(
        "/api/quotes",
        json={
            "quote_number": "FS-QUOTE-20260526-001",
            "client_id": client_id,
            "project_id": project_id,
            "status": "sent",
            "title": "Camera Work Quote",
            "quote_date": "2026-05-26",
            "subtotal": "500.00",
            "tax_amount": "0.00",
            "total_amount": "500.00",
        },
    )
    assert quote.status_code == 201
    quote_id = quote.json()["id"]
    assert authed.get("/api/quotes", params={"project_id": project_id}).json()["meta"]["total"] == 1

    labor_id = authed.post(
        "/api/labor",
        json={
            "work_date": "2026-05-26",
            "client_id": client_id,
            "project_id": project_id,
            "service_type": "Setup/Installation",
            "hours": "1.00",
            "hourly_rate": "100.00",
        },
    ).json()["id"]

    invoice = authed.post(
        "/api/invoices",
        json={
            "invoice_number": "FS-INV-20260526-001",
            "client_id": client_id,
            "project_id": project_id,
            "quote_id": quote_id,
            "status": "sent",
            "title": "Camera Work Invoice",
            "invoice_date": "2026-05-26",
            "subtotal": "100.00",
            "tax_amount": "0.00",
            "total_amount": "100.00",
            "amount_paid": "25.00",
            "labor_entry_ids": [labor_id],
        },
    )
    assert invoice.status_code == 201
    invoice_json = invoice.json()
    assert invoice_json["subtotal"] == "100.00"
    assert invoice_json["tax_amount"] == "7.00"
    assert invoice_json["total_amount"] == "107.00"
    assert invoice_json["amount_paid"] == "0.00"
    assert invoice_json["balance_due"] == "107.00"
    invoice_id = invoice_json["id"]

    invoice_with_payment = authed.patch(
        f"/api/invoices/{invoice_id}",
        json={
            "line_items": [
                {
                    "kind": "payment",
                    "description": "Payment received",
                    "quantity": "1.00",
                    "unit_price": "25.00",
                    "line_total": "25.00",
                    "taxable": False,
                }
            ]
        },
    )
    assert invoice_with_payment.status_code == 200
    assert invoice_with_payment.json()["amount_paid"] == "25.00"
    assert invoice_with_payment.json()["balance_due"] == "82.00"

    labor = authed.get("/api/labor", params={"client_id": client_id}).json()["items"][0]
    assert labor["invoice_id"] == invoice_id
    assert labor["invoice_number"] == "FS-INV-20260526-001"
    assert labor["is_invoiced"] is True

    assert authed.patch(f"/api/quotes/{quote_id}", json={"status": "approved"}).json()["status"] == "approved"
    assert authed.delete(f"/api/invoices/{invoice_id}").status_code == 200
    labor_after_delete = authed.get("/api/labor", params={"client_id": client_id}).json()["items"][0]
    assert labor_after_delete["invoice_id"] is None
    assert labor_after_delete["is_invoiced"] is False
    assert authed.delete(f"/api/quotes/{quote_id}").status_code == 200


def test_invoice_phase4_characterizes_legacy_totals_status_and_quote_links(authed):
    client_id = authed.post("/api/clients", json={"name": "Phase 4 Billing Client"}).json()["id"]
    project_id = authed.post(
        "/api/projects",
        json={"client_id": client_id, "name": "Phase 4 Billing Project"},
    ).json()["id"]
    quote_id = authed.post(
        "/api/quotes",
        json={
            "quote_number": "FS-QUOTE-PHASE4-001",
            "client_id": client_id,
            "project_id": project_id,
            "status": "approved",
            "title": "Phase 4 Source Quote",
            "quote_date": "2026-08-12",
        },
    ).json()["id"]
    planned_labor_id = authed.post(
        "/api/labor",
        json={
            "work_date": "2026-08-12",
            "client_id": client_id,
            "project_id": project_id,
            "status": "planned",
            "service_type": "Planned follow-up",
            "hours": "2.00",
            "hourly_rate": "100.00",
        },
    ).json()["id"]

    first = authed.post(
        "/api/invoices",
        json={
            "invoice_number": "FS-INV-PHASE4-001",
            "client_id": client_id,
            "project_id": project_id,
            "quote_id": quote_id,
            "status": "sent",
            "title": "Phase 4 Legacy Behavior",
            "invoice_date": "2026-08-12",
            "amount_paid": "999.00",
            "labor_entry_ids": [planned_labor_id],
            "line_items": [
                {
                    "kind": "material",
                    "description": "Server-trusted material total",
                    "quantity": "2.00",
                    "unit_price": "100.00",
                    "line_total": "50.00",
                    "taxable": False,
                },
                {
                    "kind": "payment",
                    "description": "Existing payment line",
                    "quantity": "1.00",
                    "unit_price": "25.00",
                    "line_total": "25.00",
                    "taxable": False,
                },
            ],
        },
    )
    assert first.status_code == 201
    first_json = first.json()
    assert first_json["status"] == "sent"
    assert first_json["subtotal"] == "250.00"
    assert first_json["tax_amount"] == "17.50"
    assert first_json["total_amount"] == "267.50"
    assert first_json["amount_paid"] == "25.00"
    assert first_json["balance_due"] == "242.50"

    linked_labor = authed.get("/api/labor", params={"client_id": client_id}).json()["items"][0]
    assert linked_labor["status"] == "planned"
    assert linked_labor["invoice_id"] == first_json["id"]
    assert linked_labor["is_invoiced"] is True

    manually_paid = authed.patch(f"/api/invoices/{first_json['id']}", json={"status": "paid"})
    assert manually_paid.status_code == 200
    assert manually_paid.json()["status"] == "paid"
    assert manually_paid.json()["amount_paid"] == "25.00"

    second = authed.post(
        "/api/invoices",
        json={
            "invoice_number": "FS-INV-PHASE4-002",
            "client_id": client_id,
            "project_id": project_id,
            "quote_id": quote_id,
            "status": "draft",
            "title": "Second Invoice For Same Quote",
            "invoice_date": "2026-08-12",
        },
    )
    assert second.status_code == 201
    assert second.json()["quote_id"] == quote_id
    assert authed.get("/api/invoices", params={"project_id": project_id}).json()["meta"]["total"] == 2
    assert authed.delete(f"/api/quotes/{quote_id}").status_code == 400

    assert authed.delete(f"/api/invoices/{first_json['id']}").status_code == 200
    unlinked_labor = authed.get("/api/labor", params={"client_id": client_id}).json()["items"][0]
    assert unlinked_labor["invoice_id"] is None
    assert unlinked_labor["invoice_number"] is None
    assert unlinked_labor["is_invoiced"] is False


def test_invoice_phase4_characterizes_link_ownership_validation(authed):
    first_client = authed.post("/api/clients", json={"name": "First Invoice Client"}).json()["id"]
    second_client = authed.post("/api/clients", json={"name": "Second Invoice Client"}).json()["id"]
    first_project = authed.post(
        "/api/projects", json={"client_id": first_client, "name": "First Invoice Project"}
    ).json()["id"]
    second_project = authed.post(
        "/api/projects", json={"client_id": second_client, "name": "Second Invoice Project"}
    ).json()["id"]
    second_quote = authed.post(
        "/api/quotes",
        json={
            "quote_number": "FS-QUOTE-PHASE4-OWNERSHIP",
            "client_id": second_client,
            "project_id": second_project,
            "title": "Second Client Quote",
            "quote_date": "2026-08-12",
        },
    ).json()["id"]

    base_payload = {
        "invoice_number": "FS-INV-PHASE4-OWNERSHIP",
        "client_id": first_client,
        "title": "Invalid Ownership Invoice",
        "invoice_date": "2026-08-12",
    }
    wrong_project = authed.post("/api/invoices", json={**base_payload, "project_id": second_project})
    assert wrong_project.status_code == 400
    assert wrong_project.json()["detail"] == "Project does not belong to selected client"

    wrong_quote = authed.post(
        "/api/invoices",
        json={**base_payload, "project_id": first_project, "quote_id": second_quote},
    )
    assert wrong_quote.status_code == 400
    assert wrong_quote.json()["detail"] == "Quote does not belong to selected client"


def test_authenticated_user_profile_updates_and_password_change(authed):
    current = authed.get("/api/auth/me")
    assert current.status_code == 200
    assert current.json()["email"] == "admin@example.com"

    renamed = authed.patch("/api/auth/me", json={"full_name": "Baseline Administrator"})
    assert renamed.status_code == 200
    assert renamed.json()["full_name"] == "Baseline Administrator"

    changed_email = authed.patch("/api/auth/me", json={"email": "baseline@example.com"})
    assert changed_email.status_code == 200
    assert changed_email.json()["email"] == "baseline@example.com"

    invalid_email = authed.patch("/api/auth/me", json={"email": "not-an-email"})
    assert invalid_email.status_code == 422
    assert invalid_email.json()["detail"] == "Enter a valid email address"

    wrong_password = authed.patch(
        "/api/auth/me",
        json={"current_password": "WrongPassword123!", "new_password": "NewPassword123!"},
    )
    assert wrong_password.status_code == 400
    assert wrong_password.json()["detail"] == "Current password is required to change your password"

    changed_password = authed.patch(
        "/api/auth/me",
        json={"current_password": "ChangeMe123!", "new_password": "NewPassword123!"},
    )
    assert changed_password.status_code == 200

    assert authed.post("/api/auth/logout").status_code == 200
    old_login = authed.post(
        "/api/auth/login",
        json={"email": "baseline@example.com", "password": "ChangeMe123!"},
    )
    assert old_login.status_code == 401
    new_login = authed.post(
        "/api/auth/login",
        json={"email": "baseline@example.com", "password": "NewPassword123!"},
    )
    assert new_login.status_code == 200


def test_money_flow_report_characterizes_tax_and_expense_treatment(authed):
    client_id = authed.post("/api/clients", json={"name": "Report Client"}).json()["id"]
    project_id = authed.post(
        "/api/projects",
        json={"client_id": client_id, "name": "Report Project", "status": "in_progress"},
    ).json()["id"]

    entries = [
        {
            "entry_date": "2026-05-26",
            "kind": "income",
            "business_type": "client",
            "category": "Services",
            "amount": "300.00",
            "client_id": client_id,
            "project_id": project_id,
        },
        {
            "entry_date": "2026-05-26",
            "kind": "cogs",
            "business_type": "client",
            "category": "Cost of Goods Sold",
            "amount": "100.00",
            "client_id": client_id,
            "project_id": project_id,
        },
        {
            "entry_date": "2026-05-26",
            "kind": "expense",
            "business_type": "admin",
            "category": "General Business Expense",
            "amount": "50.00",
        },
        {
            "entry_date": "2026-05-26",
            "kind": "expense",
            "business_type": "admin",
            "category": "Sales Tax Paid",
            "amount": "20.00",
        },
        {
            "entry_date": "2026-05-26",
            "kind": "expense",
            "business_type": "admin",
            "category": "Income Tax Paid",
            "amount": "10.00",
        },
    ]
    for entry in entries:
        response = authed.post("/api/ledger", json=entry)
        assert response.status_code == 201

    report = authed.get(
        "/api/reports/money-flow",
        params={"start_date": "2026-01-01", "end_date": "2026-12-31"},
    )
    assert report.status_code == 200
    data = report.json()
    cards = data["cards"]
    assert cards["ledger_revenue"] == "300.00"
    assert cards["job_expenses"] == "100.00"
    assert cards["business_expenses"] == "50.00"
    assert cards["ledger_expenses"] == "150.00"
    assert cards["net_income"] == "150.00"
    assert cards["gross_sales_tax_estimate"] == "21.00"
    assert cards["gross_income_tax_estimate"] == "45.00"
    assert cards["sales_tax_paid"] == "20.00"
    assert cards["income_tax_paid"] == "10.00"
    assert cards["total_tax_paid"] == "30.00"
    assert cards["estimated_sales_tax"] == "1.00"
    assert cards["estimated_income_tax"] == "35.00"
    assert cards["estimated_tax_owed"] == "36.00"
    assert cards["ledger_net_profit"] == "114.00"
    assert cards["owner_pay"] == "114.00"
    assert (
        Decimal(cards["ledger_net_profit"])
        + Decimal(cards["estimated_sales_tax"])
        + Decimal(cards["estimated_income_tax"])
        == Decimal(cards["net_income"])
    )
    assert Decimal(cards["net_income"]) + Decimal(cards["ledger_expenses"]) == Decimal(cards["ledger_revenue"])

    tax_rows = [row for row in data["account_type_breakdown"] if row["account_type"] == "Tax Payments"]
    assert {row["category"]: row["total"] for row in tax_rows} == {
        "Income Tax Paid": "10.00",
        "Sales Tax Paid": "20.00",
    }

    reversed_range = authed.get(
        "/api/reports/money-flow",
        params={"start_date": "2026-12-31", "end_date": "2026-01-01"},
    )
    assert reversed_range.status_code == 400
    assert reversed_range.json()["detail"] == "End date must be on or after start date"


def test_money_flow_report_uses_configured_income_tax_rate(authed):
    saved = authed.put("/api/admin/settings", json={"income_tax_reserve_rate": "0.25"})
    assert saved.status_code == 200
    income = authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-08-12",
            "kind": "income",
            "business_type": "admin",
            "category": "Services",
            "amount": "100.00",
        },
    )
    assert income.status_code == 201
    cards = authed.get(
        "/api/reports/money-flow",
        params={"start_date": "2026-01-01", "end_date": "2026-12-31"},
    ).json()["cards"]
    assert cards["net_income"] == "100.00"
    assert cards["gross_sales_tax_estimate"] == "7.00"
    assert cards["gross_income_tax_estimate"] == "25.00"
    assert cards["ledger_net_profit"] == "68.00"
    assert (
        Decimal(cards["ledger_net_profit"])
        + Decimal(cards["estimated_sales_tax"])
        + Decimal(cards["estimated_income_tax"])
        == Decimal(cards["net_income"])
    )

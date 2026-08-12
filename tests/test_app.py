from io import BytesIO
from zipfile import ZipFile


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
            "kind": "revenue",
            "business_type": "client",
            "category": "Client Labor",
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
    cid = authed.post("/api/clients", json={"name": "Ledger Client"}).json()["id"]
    pid = authed.post("/api/projects", json={"client_id": cid, "name": "Ledger Project"}).json()["id"]
    created = authed.post(
        "/api/ledger",
        json={
            "entry_date": "2026-05-26",
            "kind": "expense",
            "business_type": "admin",
            "category": "Tools",
            "amount": "50.00",
            "client_id": cid,
            "project_id": pid,
        },
    ).json()
    eid = created["id"]
    assert (
        authed.get("/api/ledger", params={"kind": "expense", "business_type": "admin", "project_id": pid}).json()[
            "meta"
        ]["total"]
        == 1
    )
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
                "category": "Tools",
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
    assert any(item["label"] == "Tools" for item in listed.json()["items"])

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
    assert invoice_json["balance_due"] == "75.00"
    invoice_id = invoice_json["id"]

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

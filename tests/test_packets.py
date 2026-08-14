import os
import shutil
import subprocess
from base64 import b64decode
from pathlib import Path

import pytest
from sqlmodel import Session

from app.core.security import utc_now
from app.db import engine
from app.models import Project


STATIC_DIR = Path(__file__).resolve().parents[1] / "app" / "static"
JAVASCRIPT_PATH = STATIC_DIR / "js" / "app.js"
RENDERERS_PATH = STATIC_DIR / "js" / "packet-renderers.js"


def test_packet_frontend_actions_print_reuse_and_pwa_characterization():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    javascript = JAVASCRIPT_PATH.read_text(encoding="utf-8")
    renderers = RENDERERS_PATH.read_text(encoding="utf-8")
    packet_css = (STATIC_DIR / "forgeops-packets.css").read_text(encoding="utf-8")
    service_worker = (STATIC_DIR / "service-worker.js").read_text(encoding="utf-8")

    assert "/static/js/app.js?v=0.8.12-vendor-fees-terms" in html
    assert "/static/forgeops-packets.css?v=0.8.12-print-packets" in html
    assert "forgeops-v2-vendor-fees-terms-v1" in service_worker
    assert "/static/js/packet-renderers.js?v=0.8.12-print-packets" in service_worker
    assert "./packet-renderers.js?v=0.8.12-print-packets" in javascript

    for marker in [
        "Print Project Packet",
        "Print Client Copy",
        "Print Admin Copy",
        "Print Admin Packet",
        "Project Packet — Client Copy",
        "Project Packet — Admin Copy",
        "Client Packet — Admin Copy",
        "INTERNAL / ADMIN COPY",
        "openProjectPacketMenu",
        "buildProjectClientPacket",
        "buildProjectAdminPacket",
        "buildClientAdminPacket",
        "quotePrintSection",
        "invoicePrintSection",
        "receiptPrintSection",
        "printWindow(title, bodyHtml, targetWindow=null)",
        "reservePacketPrintWindow",
    ]:
        assert marker in javascript or marker in renderers

    assert "Client Packet — Client Copy" not in javascript
    assert "Client Packet — Client Copy" not in renderers
    assert ".packet-header-action" in packet_css
    assert "@media screen and (max-width: 760px)" in packet_css
    assert "page-break-before: always" in packet_css


def test_project_client_packet_renderer_has_a_strict_privacy_boundary():
    renderers = RENDERERS_PATH.read_text(encoding="utf-8")
    client_renderer = renderers[
        renderers.index("export function projectClientPacketHtml") : renderers.index(
            "export function projectAdminGroupHtml"
        )
    ]

    assert "quoteSections" in client_renderer
    assert "invoiceSections" in client_renderer
    for forbidden in [
        "ledger",
        "receipt",
        "labor",
        "notes",
        "salesTax",
        "tax reserve",
        "net profit",
        "cost basis",
    ]:
        assert forbidden.lower() not in client_renderer.lower()

    javascript = JAVASCRIPT_PATH.read_text(encoding="utf-8")
    client_builder = javascript[
        javascript.index("async function buildProjectClientPacket") : javascript.index(
            "async function buildProjectAdminPacket"
        )
    ]
    assert "projectQuotePacketSections(data, {clientCopy:true})" in client_builder
    assert "projectInvoicePacketSections(data, {clientCopy:true})" in client_builder
    assert "adminLaborPacketSection" not in client_builder
    assert "adminLedgerPacketSection" not in client_builder
    assert "adminReceiptPacketSections" not in client_builder


def test_packet_data_loaders_are_complete_read_only_and_client_isolated():
    javascript = JAVASCRIPT_PATH.read_text(encoding="utf-8")
    pagination = javascript[
        javascript.index("async function fetchAllPages") : javascript.index("function packetGeneratedAt")
    ]
    assert "while (items.length < total)" in pagination
    assert "url.searchParams.set('page'" in pagination
    assert "url.searchParams.set('page_size'" in pagination
    assert "response.meta?.total" in pagination

    project_loader = javascript[
        javascript.index("async function loadProjectPacketData") : javascript.index(
            "async function loadClientAdminPacketData"
        )
    ]
    assert "fetchAllPages('/api/projects')" in project_loader
    for path in ["/api/quotes?project_id=", "/api/invoices?project_id=", "/api/labor?project_id="]:
        assert path in project_loader
    assert "/api/ledger?project_id=" in project_loader
    assert "fetchAllPages('/api/receipts')" in project_loader
    assert "method:" not in project_loader

    client_loader = javascript[
        javascript.index("async function loadClientAdminPacketData") : javascript.index(
            "function adminProjectSummaryHtml"
        )
    ]
    for path in ["/api/projects?client_id=", "/api/quotes?client_id=", "/api/invoices?client_id=", "/api/labor?client_id="]:
        assert path in client_loader
    assert "fetchAllPages('/api/ledger')" in client_loader
    assert "fetchAllPages('/api/receipts')" in client_loader
    assert "Number(entry.client_id) === Number(clientId)" in client_loader
    assert "projectIds.has(Number(entry.project_id))" in client_loader
    assert "method:" not in client_loader

    client_builder = javascript[
        javascript.index("async function buildClientAdminPacket") : javascript.index(
            "async function runPacketPrint"
        )
    ]
    assert "for (const project of data.projects)" in client_builder
    assert "Number(item.project_id) === Number(project.id)" in client_builder
    assert "Client-Level / Unassigned Records" in client_builder
    assert "!item.project_id" in client_builder
    assert "usedReceiptIds" in client_builder


def test_packet_filtered_api_can_page_beyond_the_first_100_records(authed):
    client_id = authed.post("/api/clients", json={"name": "Packet Pagination Client"}).json()["id"]
    now = utc_now()
    with Session(engine) as session:
        session.add_all(
            [
                Project(client_id=client_id, name=f"Packet Project {index:03d}", created_at=now, updated_at=now)
                for index in range(105)
            ]
        )
        session.commit()

    first = authed.get("/api/projects", params={"client_id": client_id, "page": 1, "page_size": 100})
    second = authed.get("/api/projects", params={"client_id": client_id, "page": 2, "page_size": 100})
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["meta"]["total"] == 105
    assert len(first.json()["items"]) == 100
    assert len(second.json()["items"]) == 5
    assert {item["name"] for item in first.json()["items"] + second.json()["items"]} == {
        f"Packet Project {index:03d}" for index in range(105)
    }


def test_packet_receipt_documentation_routes_render_images_and_pdfs(authed):
    image_bytes = b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs1sAAAAASUVORK5CYII="
    )
    uploaded_image = authed.post(
        "/api/receipts",
        files={"file": ("packet-image.png", image_bytes, "image/png")},
    )
    assert uploaded_image.status_code == 201
    image_id = uploaded_image.json()["id"]

    patched = authed.patch(
        f"/api/receipts/{image_id}",
        json={
            "vendor_name": "Packet Documentation Vendor",
            "linked_type": "project",
            "linked_id": 77,
            "status": "attached",
        },
    )
    assert patched.status_code == 200
    assert patched.json()["vendor_name"] == "Packet Documentation Vendor"
    assert authed.get(f"/api/receipts/{image_id}").json()["original_filename"] == "packet-image.png"

    image_preview = authed.get(f"/api/receipts/{image_id}/preview")
    image_download = authed.get(f"/api/receipts/{image_id}/file")
    image_pages = authed.get(f"/api/receipts/{image_id}/print-pages")
    assert image_preview.status_code == 200
    assert image_preview.headers["content-disposition"].startswith("inline;")
    assert image_download.status_code == 200
    assert image_download.content == image_bytes
    assert image_pages.status_code == 200
    assert image_pages.json() == {
        "receipt_id": image_id,
        "content_type": "image/png",
        "mode": "image",
        "pages": [f"/api/receipts/{image_id}/preview"],
    }

    import fitz

    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "ForgeOps packet documentation validation")
    pdf_bytes = document.tobytes()
    document.close()
    uploaded_pdf = authed.post(
        "/api/receipts",
        files={"file": ("packet-document.pdf", pdf_bytes, "application/pdf")},
    )
    assert uploaded_pdf.status_code == 201
    pdf_id = uploaded_pdf.json()["id"]
    pdf_pages = authed.get(f"/api/receipts/{pdf_id}/print-pages")
    assert pdf_pages.status_code == 200
    assert pdf_pages.json()["mode"] == "pdf_pages"
    assert len(pdf_pages.json()["pages"]) == 1
    rendered_page = authed.get(pdf_pages.json()["pages"][0])
    assert rendered_page.status_code == 200
    assert rendered_page.headers["content-type"].startswith("image/png")

    filtered = authed.get("/api/receipts", params={"linked_type": "project", "page_size": 100})
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()["items"]] == [image_id]

    assert authed.get("/api/receipts/999999").status_code == 404
    assert authed.get("/api/receipts/999999/preview").status_code == 404
    assert authed.get("/api/receipts/999999/print-pages").status_code == 404
    assert authed.get(f"/api/receipts/{image_id}/print-pages/not-a-png.jpg").status_code == 400
    assert authed.get(f"/api/receipts/{image_id}/print-pages/missing-page.png").status_code == 404

    Path(uploaded_image.json()["file_path"]).unlink()
    assert authed.get(f"/api/receipts/{image_id}/file").status_code == 404
    assert authed.get(f"/api/receipts/{image_id}/print-pages").status_code == 404


def test_packet_source_detail_routes_keep_client_context_complete(authed):
    created = authed.post(
        "/api/clients",
        json={
            "name": "Packet Client Detail Source",
            "billing_address": "10 Billing Lane",
            "site_address": "20 Original Site Road",
        },
    )
    assert created.status_code == 201
    client_id = created.json()["id"]

    updated = authed.patch(
        f"/api/clients/{client_id}",
        json={"site_address": "30 Updated Packet Site"},
    )
    assert updated.status_code == 200
    assert updated.json()["site_address"] == "30 Updated Packet Site"
    addresses = authed.get(f"/api/clients/{client_id}/addresses")
    assert addresses.status_code == 200
    assert {item["address"] for item in addresses.json()["items"]} == {
        "10 Billing Lane",
        "20 Original Site Road",
        "30 Updated Packet Site",
    }
    first_number = authed.get("/api/quotes/next-number")
    assert first_number.status_code == 200
    created_quote = authed.post(
        "/api/quotes",
        json={
            "quote_number": first_number.json()["quote_number"],
            "client_id": client_id,
            "title": "Client-level Packet Source Quote",
            "quote_date": "2026-08-14",
        },
    )
    assert created_quote.status_code == 201
    next_number = authed.get("/api/quotes/next-number")
    assert next_number.status_code == 200
    assert next_number.json()["quote_number"] != first_number.json()["quote_number"]
    assert authed.patch("/api/projects/999999", json={"name": "Missing Packet Project"}).status_code == 404
    assert authed.get("/api/quotes/999999/line-items").status_code == 404


def test_pure_packet_renderer_privacy_inclusion_and_isolation():
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if node is None:
        pytest.skip("Node.js is unavailable for the pure frontend packet renderer regression")
    script = Path(__file__).with_name("packet_render_test.mjs")
    result = subprocess.run([node, str(script)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert "privacy, inclusion, and isolation assertions passed" in result.stdout


def test_pure_document_math_vendor_fee_examples():
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if node is None:
        pytest.skip("Node.js is unavailable for the pure document math regression")
    script = Path(__file__).with_name("document_math_test.mjs")
    result = subprocess.run([node, str(script)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert "quote and invoice vendor fee calculations passed" in result.stdout

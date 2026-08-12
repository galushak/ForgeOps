from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user
from app.core.config import get_settings
from app.core.security import utc_now
from app.models import Receipt
from app.schemas import ReceiptRead, ReceiptUpdate

router = APIRouter(prefix="/api/receipts", tags=["receipts"], dependencies=[Depends(get_current_user)])
settings = get_settings()
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
EXTENSIONS = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@router.get("", response_model=dict)
def list_receipts(
    session: SessionDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    linked_type: str | None = None,
) -> dict:
    stmt = select(Receipt)
    count_stmt = select(func.count(Receipt.id))
    if linked_type:
        stmt = stmt.where(Receipt.linked_type == linked_type)
        count_stmt = count_stmt.where(Receipt.linked_type == linked_type)
    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(Receipt.uploaded_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [ReceiptRead.model_validate(i).model_dump(mode="json") for i in items],
        "meta": {"page": page, "page_size": page_size, "total": total},
    }


@router.post("", response_model=ReceiptRead, status_code=status.HTTP_201_CREATED)
async def upload_receipt(session: SessionDep, file: UploadFile = File(...)) -> Receipt:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only PDF, JPG, PNG, and WEBP receipts are supported")
    content = await file.read()
    if len(content) > settings.upload_max_bytes:
        raise HTTPException(status_code=400, detail="Receipt file is larger than the allowed upload limit")
    ext = EXTENSIONS[file.content_type]
    stored = f"{uuid4().hex}{ext}"
    destination = settings.receipts_dir / stored
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    receipt = Receipt(
        original_filename=Path(file.filename or "receipt").name,
        stored_filename=stored,
        file_path=str(destination),
        content_type=file.content_type,
        file_size_bytes=len(content),
        uploaded_at=utc_now(),
    )
    session.add(receipt)
    session.commit()
    session.refresh(receipt)
    return receipt


@router.get("/{receipt_id}", response_model=ReceiptRead)
def read_receipt(receipt_id: int, session: SessionDep) -> Receipt:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


def _receipt_file_response(receipt: Receipt, *, inline: bool) -> FileResponse:
    path = Path(receipt.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Receipt file is missing from storage")
    headers = {}
    if inline:
        safe_name = receipt.original_filename.replace('"', "")
        headers["Content-Disposition"] = f'inline; filename="{safe_name}"'
        return FileResponse(path, media_type=receipt.content_type, headers=headers)
    return FileResponse(path, media_type=receipt.content_type, filename=receipt.original_filename)


@router.get("/{receipt_id}/file")
def download_receipt(receipt_id: int, session: SessionDep) -> FileResponse:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _receipt_file_response(receipt, inline=False)


@router.get("/{receipt_id}/preview")
def preview_receipt(receipt_id: int, session: SessionDep) -> FileResponse:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return _receipt_file_response(receipt, inline=True)




@router.get("/{receipt_id}/print-pages", response_model=dict)
def receipt_print_pages(receipt_id: int, session: SessionDep) -> dict:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    path = Path(receipt.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Receipt file is missing from storage")

    if receipt.content_type.startswith("image/"):
        return {
            "receipt_id": receipt.id,
            "content_type": receipt.content_type,
            "mode": "image",
            "pages": [f"/api/receipts/{receipt.id}/preview"],
        }

    if receipt.content_type != "application/pdf":
        return {
            "receipt_id": receipt.id,
            "content_type": receipt.content_type,
            "mode": "unsupported",
            "pages": [],
        }

    try:
        import fitz  # type: ignore[import-not-found]
    except Exception as exc:  # pragma: no cover - dependency/runtime safety
        raise HTTPException(
            status_code=500,
            detail="PDF receipt print rendering is unavailable. The PDF rendering package is not installed.",
        ) from exc

    output_dir = settings.receipts_dir / "print_cache" / str(receipt.id)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        source_mtime = int(path.stat().st_mtime)
        doc = fitz.open(path)
        page_urls: list[str] = []
        for index in range(len(doc)):
            image_name = f"page-{index + 1}-{source_mtime}.png"
            image_path = output_dir / image_name
            if not image_path.exists():
                page = doc.load_page(index)
                # 2x scale keeps receipt text readable without generating enormous images.
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                pixmap.save(image_path)
            page_urls.append(f"/api/receipts/{receipt.id}/print-pages/{image_name}")
        doc.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to render receipt PDF for printing") from exc

    return {
        "receipt_id": receipt.id,
        "content_type": receipt.content_type,
        "mode": "pdf_pages",
        "pages": page_urls,
    }


@router.get("/{receipt_id}/print-pages/{image_name}")
def receipt_print_page_image(receipt_id: int, image_name: str, session: SessionDep) -> FileResponse:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if "/" in image_name or "\\" in image_name or not image_name.endswith(".png"):
        raise HTTPException(status_code=400, detail="Invalid receipt page image")
    image_path = settings.receipts_dir / "print_cache" / str(receipt_id) / image_name
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Receipt page image not found")
    return FileResponse(image_path, media_type="image/png")


@router.patch("/{receipt_id}", response_model=ReceiptRead)
def update_receipt(receipt_id: int, payload: ReceiptUpdate, session: SessionDep) -> Receipt:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(receipt, key, value)
    session.add(receipt)
    session.commit()
    session.refresh(receipt)
    return receipt


@router.delete("/{receipt_id}", response_model=dict)
def delete_receipt(receipt_id: int, session: SessionDep) -> dict[str, str]:
    receipt = session.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    path = Path(receipt.file_path)
    session.delete(receipt)
    session.commit()
    if path.exists():
        path.unlink()
    return {"message": "Receipt deleted"}

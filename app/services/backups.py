import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.security import utc_now

settings = get_settings()
BACKUP_VERSION = 1
BUSINESS_TABLES = {
    "clients": "client",
    "projects": "project",
    "quotes": "quote",
    "quote_line_items": "quotelineitem",
    "invoices": "invoice",
    "labor_entries": "laborentry",
    "ledger_entries": "ledgerentry",
    "receipts": "receipt",
}


def _safe_copy_sqlite(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        raise FileNotFoundError(f"Database not found at {source}")
    source_conn = sqlite3.connect(source)
    try:
        dest_conn = sqlite3.connect(destination)
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()


def _copy_if_exists(src: Path, dst: Path) -> None:
    if src.exists():
        shutil.copytree(src, dst, dirs_exist_ok=True)


def _remove_sqlite_sidecars(db_path: Path) -> None:
    for suffix in ("-wal", "-shm", "-journal"):
        db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)


def _count_records(db_path: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    if not db_path.exists():
        return {key: 0 for key in BUSINESS_TABLES}
    conn = sqlite3.connect(db_path)
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for label, table in BUSINESS_TABLES.items():
            if table in tables:
                counts[label] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            else:
                counts[label] = 0
    finally:
        conn.close()
    return counts


def create_backup(user_id: int | None = None, note: str | None = None) -> Path:
    now = utc_now()
    stamp = now.strftime("%Y%m%d-%H%M%S")
    filename = f"fst-backup-{stamp}.zip"
    backup_path = settings.backup_dir / filename
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
        tmp_path = Path(tmp)
        package_root = tmp_path / "fst-backup"
        (package_root / "database").mkdir(parents=True)
        _safe_copy_sqlite(settings.db_file_path, package_root / "database" / "app.db")
        _copy_if_exists(settings.uploads_dir, package_root / "uploads")
        _copy_if_exists(settings.exports_dir, package_root / "exports")
        manifest: dict[str, Any] = {
            "app_name": settings.app_name,
            "backup_version": BACKUP_VERSION,
            "created_at": now.isoformat() + "Z",
            "created_by_user_id": user_id,
            "database_engine": "sqlite",
            "database_file": "database/app.db",
            "included_paths": ["database/app.db", "uploads", "exports"],
            "note": note,
            "record_counts": _count_records(package_root / "database" / "app.db"),
        }
        (package_root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in package_root.rglob("*"):
                if item.is_file():
                    zf.write(item, item.relative_to(package_root))
    return backup_path


def validate_backup_zip(zip_path: Path) -> dict[str, Any]:
    try:
        zf_ctx = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as exc:
        raise ValueError("File is not a valid zip backup") from exc
    with zf_ctx as zf:
        names = set(zf.namelist())
        if "manifest.json" not in names:
            raise ValueError("Backup is missing manifest.json")
        if "database/app.db" not in names:
            raise ValueError("Backup is missing database/app.db")
        manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        if manifest.get("backup_version") != BACKUP_VERSION:
            raise ValueError("Unsupported backup version")
        with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
            tmp_db = Path(tmp) / "app.db"
            with zf.open("database/app.db") as src, tmp_db.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            manifest["record_counts"] = _count_records(tmp_db)
        return manifest


def restore_backup(zip_path: Path) -> tuple[dict[str, Any], Path, dict[str, int]]:
    manifest = validate_backup_zip(zip_path)
    pre_restore = create_backup(note="Automatic backup before restore")

    with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp_path)
        restored_db = tmp_path / "database" / "app.db"
        if not restored_db.exists():
            raise ValueError("Restored database was not found after extraction")

        # Close all pooled SQLite connections before replacing app.db.
        from app.db import engine, init_db

        engine.dispose()
        _remove_sqlite_sidecars(settings.db_file_path)

        rollback = settings.temp_dir / f'rollback-{datetime.utcnow().strftime("%Y%m%d-%H%M%S")}'
        rollback.mkdir(parents=True, exist_ok=True)
        if settings.db_file_path.exists():
            shutil.copy2(settings.db_file_path, rollback / "app.db")
        if settings.uploads_dir.exists():
            shutil.copytree(settings.uploads_dir, rollback / "uploads", dirs_exist_ok=True)
        if settings.exports_dir.exists():
            shutil.copytree(settings.exports_dir, rollback / "exports", dirs_exist_ok=True)

        settings.db_file_path.parent.mkdir(parents=True, exist_ok=True)
        staged_db = settings.db_file_path.with_name(f"{settings.db_file_path.name}.restore")
        staged_db.unlink(missing_ok=True)
        shutil.copy2(restored_db, staged_db)
        os.replace(staged_db, settings.db_file_path)
        _remove_sqlite_sidecars(settings.db_file_path)

        if settings.uploads_dir.exists():
            shutil.rmtree(settings.uploads_dir)
        if (tmp_path / "uploads").exists():
            shutil.copytree(tmp_path / "uploads", settings.uploads_dir)
        else:
            settings.uploads_dir.mkdir(parents=True, exist_ok=True)

        if settings.exports_dir.exists():
            shutil.rmtree(settings.exports_dir)
        if (tmp_path / "exports").exists():
            shutil.copytree(tmp_path / "exports", settings.exports_dir)
        else:
            settings.exports_dir.mkdir(parents=True, exist_ok=True)

        # Bring older backup databases forward without changing their records.
        engine.dispose()
        init_db()
        engine.dispose()

    restored_counts = _count_records(settings.db_file_path)
    return manifest, pre_restore, restored_counts

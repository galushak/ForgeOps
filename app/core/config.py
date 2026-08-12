from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Forged Systems Tracking"
    app_env: str = "local"
    app_secret_key: str = Field(default="dev-only-change-me")
    database_url: str = "sqlite:///data/app.db"
    data_dir: Path = Path("data")
    upload_max_bytes: int = 10 * 1024 * 1024
    backup_dir: Path = Path("data/backups")
    default_admin_email: str = "admin@example.com"
    default_admin_password: str = "ChangeMe123!"
    session_cookie_name: str = "fst_session"
    session_days: int = 14

    @property
    def db_file_path(self) -> Path:
        if self.database_url.startswith("sqlite:///"):
            return Path(self.database_url.replace("sqlite:///", "", 1))
        raise ValueError("Only sqlite:/// database URLs are supported for this app.")

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def receipts_dir(self) -> Path:
        return self.uploads_dir / "receipts"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"

    @property
    def temp_dir(self) -> Path:
        return self.data_dir / "temp"


@lru_cache
def get_settings() -> Settings:
    return Settings()

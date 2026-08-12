import os
import shutil

os.environ.setdefault("APP_SECRET_KEY", "test-secret")
os.environ.setdefault("DATABASE_URL", "sqlite:///test-data/app.db")
os.environ.setdefault("DATA_DIR", "test-data")
os.environ.setdefault("BACKUP_DIR", "test-data/backups")
os.environ.setdefault("DEFAULT_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("DEFAULT_ADMIN_PASSWORD", "ChangeMe123!")

import pytest
from fastapi.testclient import TestClient

from app.db import engine
from app.main import app


@pytest.fixture(autouse=True)
def clean_test_data():
    engine.dispose()
    shutil.rmtree("test-data", ignore_errors=True)
    yield
    engine.dispose()
    shutil.rmtree("test-data", ignore_errors=True)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def authed(client):
    setup = client.post(
        "/api/setup/account",
        json={"full_name": "Administrator", "email": "admin@example.com", "password": "ChangeMe123!"},
    )
    assert setup.status_code == 200
    return client

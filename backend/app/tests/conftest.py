"""
pytest fixtures for IPAM Portal backend tests.

Uses mongomock-motor for in-memory async MongoDB and httpx AsyncClient
against the FastAPI test app. All tests run with isolated state.
"""
import asyncio
from datetime import datetime, timezone
from typing import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


# ---------------------------------------------------------------------------
# Settings override — use a safe test JWT secret
# ---------------------------------------------------------------------------
TEST_JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long!"

TEST_SETTINGS_OVERRIDES = {
    "MONGODB_URI": "mongodb://localhost:27017",
    "MONGODB_DB_NAME": "ipam_test",
    "JWT_SECRET_KEY": TEST_JWT_SECRET,
    "JWT_ALGORITHM": "HS256",
    "JWT_EXPIRE_MINUTES": 60,
    "JWT_REFRESH_EXPIRE_HOURS": 8,
    "INITIAL_ADMIN_USERNAME": "admin",
    "INITIAL_ADMIN_PASSWORD": "changeme123",
    "APP_ENV": "test",
    "ALLOWED_ORIGINS": ["http://testserver"],
    "ENABLE_SWAGGER": True,
    "RATE_LIMIT_LOGIN": "1000/minute",
    "RATE_LIMIT_API": "10000/minute",
}


@pytest.fixture(scope="session")
def test_settings():
    from app.config import Settings
    return Settings(**TEST_SETTINGS_OVERRIDES)


# ---------------------------------------------------------------------------
# In-memory MongoDB via mongomock-motor
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def mock_db():
    """Provides an isolated in-memory async MongoDB database for each test."""
    from mongomock_motor import AsyncMongoMockClient
    client = AsyncMongoMockClient()
    db = client["ipam_test"]
    yield db
    # Clean up all collections after each test
    for collection_name in await db.list_collection_names():
        await db[collection_name].drop()
    client.close()


# ---------------------------------------------------------------------------
# Repository fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def user_repo(mock_db):
    from app.repositories.user_repository import UserRepository
    return UserRepository(mock_db["users"])


@pytest_asyncio.fixture()
async def subnet_repo(mock_db):
    from app.repositories.subnet_repository import SubnetRepository
    return SubnetRepository(mock_db["subnets"])


@pytest_asyncio.fixture()
async def ip_record_repo(mock_db):
    from app.repositories.ip_record_repository import IPRecordRepository
    return IPRecordRepository(mock_db["ip_records"])


@pytest_asyncio.fixture()
async def audit_repo(mock_db):
    from app.repositories.audit_log_repository import AuditLogRepository
    return AuditLogRepository(mock_db["audit_logs"])


# ---------------------------------------------------------------------------
# Seeded test data helpers
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def admin_user(user_repo):
    """Creates and returns a seeded admin user in the mock DB."""
    from app.core.password import hash_password
    from app.models.user import Role

    now = datetime.now(timezone.utc)
    doc = {
        "username": "admin",
        "password_hash": hash_password("AdminPass1!"),
        "full_name": "Test Admin",
        "email": "admin@example.com",
        "role": Role.ADMINISTRATOR.value,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": "system",
        "last_login": None,
    }
    return await user_repo.create(doc)


@pytest_asyncio.fixture()
async def operator_user(user_repo):
    """Creates and returns a seeded operator user in the mock DB."""
    from app.core.password import hash_password
    from app.models.user import Role

    now = datetime.now(timezone.utc)
    doc = {
        "username": "operator1",
        "password_hash": hash_password("OperatorPass1!"),
        "full_name": "Test Operator",
        "email": "operator@example.com",
        "role": Role.OPERATOR.value,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": "admin",
        "last_login": None,
    }
    return await user_repo.create(doc)


@pytest_asyncio.fixture()
async def viewer_user(user_repo):
    """Creates and returns a seeded viewer user in the mock DB."""
    from app.core.password import hash_password
    from app.models.user import Role

    now = datetime.now(timezone.utc)
    doc = {
        "username": "viewer1",
        "password_hash": hash_password("ViewerPass1!"),
        "full_name": "Test Viewer",
        "email": "viewer@example.com",
        "role": Role.VIEWER.value,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "created_by": "admin",
        "last_login": None,
    }
    return await user_repo.create(doc)


@pytest_asyncio.fixture()
async def sample_subnet(subnet_repo):
    """Creates and returns a sample subnet."""
    from app.models.ip_record import Environment

    now = datetime.now(timezone.utc)
    doc = {
        "cidr": "192.168.1.0/24",
        "name": "Test Subnet",
        "description": "A subnet for testing",
        "gateway": "192.168.1.1",
        "vlan_id": 100,
        "environment": Environment.TEST.value,
        "created_at": now,
        "updated_at": now,
        "created_by": "admin",
        "updated_by": "admin",
    }
    return await subnet_repo.create(doc)


@pytest_asyncio.fixture()
async def sample_ip_record(ip_record_repo, sample_subnet):
    """Creates and returns a sample IP record linked to sample_subnet."""
    from app.models.ip_record import Environment, IPStatus, OSType

    now = datetime.now(timezone.utc)
    doc = {
        "ip_address": "192.168.1.10",
        "hostname": "test-host-01",
        "os_type": OSType.LINUX.value,
        "subnet_id": sample_subnet.id,
        "status": IPStatus.FREE.value,
        "environment": Environment.TEST.value,
        "owner": "test-owner",
        "description": "Test IP record",
        "created_at": now,
        "updated_at": now,
        "created_by": "admin",
        "updated_by": "admin",
        "reserved_at": None,
        "reserved_by": None,
    }
    return await ip_record_repo.create(doc)


# ---------------------------------------------------------------------------
# JWT token helper
# ---------------------------------------------------------------------------
def make_access_token(username: str, role: str, full_name: str, settings) -> str:
    from app.core.security import create_access_token
    return create_access_token(username=username, role=role, full_name=full_name, settings=settings)


@pytest.fixture()
def admin_token(admin_user, test_settings):
    return make_access_token(
        username=admin_user.username,
        role=admin_user.role.value,
        full_name=admin_user.full_name,
        settings=test_settings,
    )


@pytest.fixture()
def operator_token(operator_user, test_settings):
    return make_access_token(
        username=operator_user.username,
        role=operator_user.role.value,
        full_name=operator_user.full_name,
        settings=test_settings,
    )


@pytest.fixture()
def viewer_token(viewer_user, test_settings):
    return make_access_token(
        username=viewer_user.username,
        role=viewer_user.role.value,
        full_name=viewer_user.full_name,
        settings=test_settings,
    )


# ---------------------------------------------------------------------------
# FastAPI test client wired to mock_db
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def client(mock_db, test_settings) -> AsyncIterator[AsyncClient]:
    """
    Provides an httpx AsyncClient pointed at the FastAPI app, with:
    - Settings overridden to use test values
    - get_database() patched to return the in-memory mock_db
    - MongoDB connection calls bypassed (no real server needed)
    """
    from app.config import get_settings
    from app.core import database as db_module

    # Patch get_database to return our mock_db
    db_module._client = MagicMock()  # satisfy the None check
    original_get_database = db_module.get_database
    db_module.get_database = lambda: mock_db

    # Patch lifespan DB operations
    with patch("app.core.database.connect_to_mongo", new_callable=AsyncMock), \
         patch("app.core.database.close_mongo_connection", new_callable=AsyncMock), \
         patch("app.main._seed_default_admin", new_callable=AsyncMock):

        from app.main import create_app
        app = create_app()
        app.dependency_overrides[get_settings] = lambda: test_settings

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as ac:
            yield ac

    # Restore
    db_module.get_database = original_get_database
    db_module._client = None

"""Unit tests for CabinetService CRUD and membership."""
import pytest
import pytest_asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.repositories.cabinet_repository import CabinetRepository
from app.repositories.password_repository import PasswordRepository
from app.repositories.user_repository import UserRepository
from app.repositories.audit_log_repository import AuditLogRepository
from app.schemas.cabinet import CabinetCreate, CabinetUpdate, MembersUpdate
from app.services.cabinet_service import CabinetService


@pytest_asyncio.fixture()
async def cabinet_repo(mock_db):
    return CabinetRepository(mock_db["cabinets"])


@pytest_asyncio.fixture()
async def password_repo(mock_db):
    return PasswordRepository(mock_db["password_entries"])


@pytest_asyncio.fixture()
async def cabinet_service(mock_db, cabinet_repo, password_repo, user_repo, audit_repo):
    return CabinetService(
        cabinet_repo=cabinet_repo,
        password_repo=password_repo,
        user_repo=user_repo,
        audit_repo=audit_repo,
    )


@pytest.mark.asyncio
async def test_create_cabinet_admin(cabinet_service):
    data = CabinetCreate(name="Linux Admins", description="Linux team")
    result = await cabinet_service.create_cabinet(
        data=data,
        created_by="admin",
        role="Administrator",
        client_ip="127.0.0.1",
    )
    assert result.name == "Linux Admins"
    assert result.description == "Linux team"
    assert result.id is not None


@pytest.mark.asyncio
async def test_create_cabinet_non_admin_forbidden(cabinet_service):
    data = CabinetCreate(name="Forbidden")
    with pytest.raises(HTTPException) as exc_info:
        await cabinet_service.create_cabinet(
            data=data,
            created_by="operator1",
            role="Operator",
            client_ip="127.0.0.1",
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_create_cabinet_duplicate_name(cabinet_service):
    data = CabinetCreate(name="DBA Team")
    await cabinet_service.create_cabinet(data=data, created_by="admin", role="Administrator", client_ip="127.0.0.1")
    with pytest.raises(HTTPException) as exc_info:
        await cabinet_service.create_cabinet(data=data, created_by="admin", role="Administrator", client_ip="127.0.0.1")
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_list_cabinets_admin_sees_all(cabinet_service):
    await cabinet_service.create_cabinet(
        CabinetCreate(name="Team A"), created_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    await cabinet_service.create_cabinet(
        CabinetCreate(name="Team B"), created_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    result = await cabinet_service.list_cabinets(username="admin", role="Administrator")
    assert len(result) == 2


@pytest.mark.asyncio
async def test_list_cabinets_viewer_sees_only_member(cabinet_service, user_repo):
    now = datetime.now(timezone.utc)
    await user_repo.create({
        "username": "alice", "password_hash": "x", "full_name": "Alice",
        "email": None, "role": "Viewer", "is_active": True,
        "created_at": now, "updated_at": now, "created_by": "admin", "last_login": None,
    })
    cab = await cabinet_service.create_cabinet(
        CabinetCreate(name="Team Alice", member_usernames=["alice"]),
        created_by="admin", role="Administrator", client_ip="127.0.0.1",
    )
    await cabinet_service.create_cabinet(
        CabinetCreate(name="Team Other"),
        created_by="admin", role="Administrator", client_ip="127.0.0.1",
    )
    result = await cabinet_service.list_cabinets(username="alice", role="Viewer")
    assert len(result) == 1
    assert result[0].id == cab.id


@pytest.mark.asyncio
async def test_add_and_remove_member(cabinet_service, user_repo):
    now = datetime.now(timezone.utc)
    await user_repo.create({
        "username": "bob", "password_hash": "x", "full_name": "Bob",
        "email": None, "role": "Operator", "is_active": True,
        "created_at": now, "updated_at": now, "created_by": "admin", "last_login": None,
    })
    cab = await cabinet_service.create_cabinet(
        CabinetCreate(name="Bob Cabinet"), created_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    updated = await cabinet_service.add_members(
        cabinet_id=cab.id, usernames=["bob"], updated_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    assert "bob" in updated.member_usernames

    removed = await cabinet_service.remove_member(
        cabinet_id=cab.id, username="bob", updated_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    assert "bob" not in removed.member_usernames


@pytest.mark.asyncio
async def test_delete_cabinet_cascades(cabinet_service, password_repo):
    cab = await cabinet_service.create_cabinet(
        CabinetCreate(name="Delete Me"), created_by="admin", role="Administrator", client_ip="127.0.0.1"
    )
    now = datetime.now(timezone.utc)
    await password_repo.create({
        "cabinet_id": cab.id, "title": "entry1", "ciphertext": "x", "iv": "y",
        "created_at": now, "updated_at": now, "created_by": "admin", "updated_by": "admin",
    })
    await cabinet_service.delete_cabinet(
        cabinet_id=cab.id, deleted_by="admin", role="SuperAdmin", client_ip="127.0.0.1"
    )
    remaining, _ = await password_repo.find_by_cabinet(cab.id)
    assert len(remaining) == 0

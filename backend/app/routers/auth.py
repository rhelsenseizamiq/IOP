import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status

from app.config import Settings, get_settings
from app.core.database import get_database
from app.core.rate_limiter import limiter
from app.dependencies.auth import get_current_user
from app.models.user import UserInToken
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _get_client_ip(request: Request) -> str:
    return request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")


def _build_auth_service(db=None) -> AuthService:
    if db is None:
        db = get_database()
    return AuthService(
        user_repo=UserRepository(db["users"]),
        audit_repo=AuditLogRepository(db["audit_logs"]),
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    db = get_database()
    service = _build_auth_service(db)
    client_ip = _get_client_ip(request)
    return await service.login(
        username=body.username,
        password=body.password,
        client_ip=client_ip,
        settings=settings,
        response=response,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    current_user: UserInToken = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    from jose import jwt as _jwt

    db = get_database()
    service = _build_auth_service(db)
    client_ip = _get_client_ip(request)

    # Decode token to get exp for blocklist TTL
    from app.core.security import decode_token
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

    # Re-read the raw Authorization header to get expiry
    auth_header = request.headers.get("Authorization", "")
    raw_token = auth_header.removeprefix("Bearer ").strip()
    payload = decode_token(raw_token, settings)
    exp_timestamp = payload.get("exp", 0)
    exp_dt = datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)

    await service.logout(
        jti=current_user.jti,
        exp=exp_dt,
        db=db,
        username=current_user.sub,
        user_role=current_user.role.value,
        client_ip=client_ip,
        response=response,
    )


@router.get("/me", response_model=dict)
async def me(
    current_user: UserInToken = Depends(get_current_user),
) -> dict:
    return {
        "username": current_user.sub,
        "role": current_user.role.value,
        "full_name": current_user.full_name,
    }


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    response: Response,
    ipam_refresh: str | None = Cookie(default=None),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    if ipam_refresh is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not provided",
        )
    db = get_database()
    service = _build_auth_service(db)
    return await service.refresh(
        refresh_token=ipam_refresh,
        settings=settings,
        db=db,
        response=response,
    )


@router.get("/config", response_model=dict)
async def auth_config(
    settings: Settings = Depends(get_settings),
) -> dict:
    """Returns public auth configuration (no credentials required)."""
    return {"ldap_enabled": getattr(settings, "LDAP_ENABLED", False)}


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    request: Request,
    body: ChangePasswordRequest,
    current_user: UserInToken = Depends(get_current_user),
) -> None:
    db = get_database()
    service = _build_auth_service(db)
    client_ip = _get_client_ip(request)
    await service.change_password(
        username=current_user.sub,
        current_password=body.current_password,
        new_password=body.new_password,
        client_ip=client_ip,
        user_role=current_user.role.value,
    )

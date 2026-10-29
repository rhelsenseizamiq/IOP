import logging
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import get_settings, Settings
from app.core.database import get_database
from app.core.security import decode_token, is_blocklisted
from app.models.user import UserInToken, Role

logger = logging.getLogger(__name__)

bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> UserInToken:
    token = credentials.credentials
    payload = decode_token(token, settings)

    token_type = payload.get("type")
    if token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username: str | None = payload.get("sub")
    jti: str | None = payload.get("jti")
    role_str: str | None = payload.get("role")
    full_name: str | None = payload.get("full_name")

    if not username or not jti or not role_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    db = get_database()
    if await is_blocklisted(jti, db):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_doc = await db["users"].find_one({"username": username})
    if not user_doc or not user_doc.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Role comes from the DB doc (already fetched above for the is_active
    # check, so this is free — no extra round trip), not the JWT claim.
    # The claim is frozen at token-issue time: if an admin demotes a user
    # mid-session, a role taken from the token would keep granting the OLD
    # privilege level until the token expires (up to JWT_EXPIRE_MINUTES).
    # See security review 2026-10-29.
    try:
        role = Role(user_doc.get("role", role_str))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid role in token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserInToken(
        sub=username,
        role=role,
        full_name=full_name or "",
        jti=jti,
    )


def require_role(*roles: str):
    """
    Dependency factory that enforces role-based access control.
    Usage: Depends(require_role("Operator", "Administrator"))
    """
    async def _role_checker(
        current_user: UserInToken = Depends(get_current_user),
    ) -> UserInToken:
        if current_user.role.value not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {list(roles)}",
            )
        return current_user

    return _role_checker

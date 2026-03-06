import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.core.database import close_mongo_connection, connect_to_mongo, get_database
from app.core.logging_config import configure_logging
from app.core.password import hash_password
from app.core.rate_limiter import limiter
from app.models.user import Role

logger = logging.getLogger(__name__)


async def _set_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


async def _seed_default_admin() -> None:
    """Creates the default administrator account if it does not already exist."""
    settings = get_settings()
    db = get_database()
    now = datetime.now(timezone.utc)
    result = await db["users"].update_one(
        {"username": settings.INITIAL_ADMIN_USERNAME},
        {
            "$setOnInsert": {
                "username": settings.INITIAL_ADMIN_USERNAME,
                "password_hash": hash_password(settings.INITIAL_ADMIN_PASSWORD),
                "full_name": "System Administrator",
                "email": None,
                "role": Role.ADMINISTRATOR.value,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
                "created_by": "system",
                "last_login": None,
            }
        },
        upsert=True,
    )
    if result.upserted_id:
        logger.info(
            "Default admin user '%s' created. Change the password immediately.",
            settings.INITIAL_ADMIN_USERNAME,
        )


_DEFAULT_RIRS = [
    {"name": "ARIN", "slug": "arin", "description": "American Registry for Internet Numbers", "is_private": False},
    {"name": "RIPE NCC", "slug": "ripe-ncc", "description": "Réseaux IP Européens Network Coordination Centre", "is_private": False},
    {"name": "APNIC", "slug": "apnic", "description": "Asia-Pacific Network Information Centre", "is_private": False},
    {"name": "LACNIC", "slug": "lacnic", "description": "Latin America and Caribbean Network Information Centre", "is_private": False},
    {"name": "AFRINIC", "slug": "afrinic", "description": "African Network Information Centre", "is_private": False},
    {"name": "RFC1918", "slug": "rfc1918", "description": "Private address space (RFC 1918)", "is_private": True},
]


async def _seed_default_rirs() -> None:
    """Creates default RIR records if they do not already exist."""
    db = get_database()
    now = datetime.now(timezone.utc)
    for rir_data in _DEFAULT_RIRS:
        await db["rirs"].update_one(
            {"slug": rir_data["slug"]},
            {
                "$setOnInsert": {
                    **rir_data,
                    "created_at": now,
                    "updated_at": now,
                    "created_by": "system",
                    "updated_by": "system",
                }
            },
            upsert=True,
        )
    logger.info("RIR seed complete (%d records)", len(_DEFAULT_RIRS))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    logger.info("Starting IPAM Portal API")
    await connect_to_mongo()
    await _seed_default_admin()
    await _seed_default_rirs()
    yield
    logger.info("Shutting down IPAM Portal API")
    await close_mongo_connection()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="IPAM Portal API",
        version="1.0.0",
        description="IP Address Management Portal — REST API",
        docs_url="/api/docs" if settings.ENABLE_SWAGGER else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.ENABLE_SWAGGER else None,
        lifespan=lifespan,
    )

    # Attach rate limiter state
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Security headers on all responses (must be added before CORS)
    app.add_middleware(BaseHTTPMiddleware, dispatch=_set_security_headers)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Real-IP"],
    )

    # Include routers
    from app.routers import auth, users, ip_records, subnets, audit_logs, scan
    from app.routers import vrfs, rirs, aggregates, ip_ranges

    api_prefix = "/api/v1"
    app.include_router(auth.router, prefix=api_prefix)
    app.include_router(users.router, prefix=api_prefix)
    app.include_router(ip_records.router, prefix=api_prefix)
    app.include_router(subnets.router, prefix=api_prefix)
    app.include_router(audit_logs.router, prefix=api_prefix)
    app.include_router(scan.router, prefix=api_prefix)
    app.include_router(vrfs.router, prefix=api_prefix)
    app.include_router(rirs.router, prefix=api_prefix)
    app.include_router(aggregates.router, prefix=api_prefix)
    app.include_router(ip_ranges.router, prefix=api_prefix)

    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    return app


app = create_app()

from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "ipam"
    JWT_SECRET_KEY: str = "change-this-secret-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_EXPIRE_HOURS: int = 8
    INITIAL_ADMIN_USERNAME: str = "admin"
    INITIAL_ADMIN_PASSWORD: str = "changeme123"
    APP_ENV: str = "production"
    ALLOWED_ORIGINS: list[str] = ["https://ipam-portal.com"]
    ENABLE_SWAGGER: bool = False
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_API: str = "200/minute"

    # LDAP / Active Directory (optional)
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str = "ldap://ldap.example.com"
    LDAP_PORT: int = 389
    LDAP_USE_TLS: bool = False
    LDAP_BIND_DN: str = ""
    LDAP_BIND_PASSWORD: str = ""
    LDAP_BASE_DN: str = "dc=example,dc=com"
    LDAP_USER_FILTER: str = "(sAMAccountName={username})"
    LDAP_DEFAULT_ROLE: str = "Viewer"

    @field_validator("JWT_SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters long")
        if v == "change-this-secret-in-production":
            raise ValueError(
                "JWT_SECRET_KEY is set to the insecure default value. "
                "Generate a strong secret with: openssl rand -hex 32"
            )
        return v


@lru_cache()
def get_settings() -> Settings:
    return Settings()

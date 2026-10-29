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

    # Password Vault
    VAULT_MASTER_KEY: str = ""

    # File sharing — see app/core/file_vault.py, app/services/file_service.py.
    # FILE_STORAGE_ROOT is this container's view of the bind-mounted storage
    # directory; FILE_STORAGE_HOST_ROOT is the HOST's view of the exact same
    # files, used only by app/core/clamav.py to tell clamd (which runs
    # natively on the host, not in Docker) a path it can actually open.
    # Deliberately NOT /opt — that volume is only 500MB on this host.
    FILE_STORAGE_ROOT: str = "/app/file_storage"
    FILE_STORAGE_HOST_ROOT: str = "/data/iop-file-storage"
    MAX_FILE_SIZE_BYTES: int = 250 * 1024 * 1024  # 250 MB
    # Real, externally-resolvable hostname — used to build share_url in
    # ShareLinkResponse. Must be reachable from outside the bank's network
    # for file-type share links to actually work for external recipients;
    # verify this resolves externally at deploy time, don't assume.
    PUBLIC_BASE_URL: str = "https://ipam.abb-bank.az"

    # ClamAV — native clamd on the host (same reason Ollama is native, see
    # OLLAMA_URL below: this host cannot pull Docker images from any
    # registry, confirmed directly). Reached over the same Docker bridge
    # gateway address.
    CLAMD_HOST: str = "172.18.0.1"
    CLAMD_PORT: int = 3310
    CLAMD_TIMEOUT_SECONDS: float = 60.0

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

    # Check Availability — per-interface scan helper (runs on the host, outside Docker)
    SCAN_HELPER_URL: str = ""
    SCAN_HELPER_TOKEN: str = ""

    # Check Availability — Device42 real-time lookup
    DEVICE42_HOST: str = ""
    DEVICE42_USERNAME: str = ""
    DEVICE42_PASSWORD: str = ""

    # Zabbix integration — real-time monitoring lookup + bulk discover/import
    ZABBIX_HOST: str = ""
    ZABBIX_TOKEN: str = ""

    # PaloAlto integration — real-time Check Availability lookup + PaloAlto
    # Check tab. PALOALTO_HOSTS is comma-separated (multiple firewalls).
    PALOALTO_HOSTS: str = ""
    PALOALTO_USERNAME: str = ""
    PALOALTO_PASSWORD: str = ""

    # vCenter/vSphere integration — real-time Check Availability lookup +
    # nightly VM inventory sync. VCENTER_HOSTS is comma-separated (multiple
    # vCenters); the same read-only service account is used for all of them.
    VCENTER_HOSTS: str = ""
    VCENTER_USERNAME: str = ""
    VCENTER_PASSWORD: str = ""
    VCENTER_VERIFY_SSL: bool = False

    # Offline AI assistant — Ollama running natively on the host (not in
    # Docker; the server has no outbound internet, so the model files were
    # pulled elsewhere and staged on /data). Reached over the iop-external
    # bridge's own gateway address, never a public port.
    OLLAMA_URL: str = "http://172.18.0.1:11434"
    OLLAMA_CHAT_MODEL: str = "iop-llama3.1"
    OLLAMA_EMBED_MODEL: str = "iop-nomic-embed"

    @field_validator("VAULT_MASTER_KEY")
    @classmethod
    def validate_vault_master_key(cls, v: str) -> str:
        if not v:
            return v  # Vault is optional; validated at request time if vault routes are used
        import base64
        try:
            decoded = base64.b64decode(v)
        except Exception as exc:
            raise ValueError("VAULT_MASTER_KEY must be a valid base64-encoded string") from exc
        if len(decoded) < 32:
            raise ValueError(
                "VAULT_MASTER_KEY must decode to at least 32 bytes. "
                "Generate with: openssl rand -base64 32"
            )
        return v

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

    @field_validator("INITIAL_ADMIN_PASSWORD")
    @classmethod
    def validate_initial_admin_password(cls, v: str) -> str:
        # _seed_default_admin() in main.py only uses this on a genuinely
        # fresh DB (upsert with $setOnInsert) — but if it were ever left at
        # the placeholder and the DB got wiped/reseeded, a fresh deploy
        # would silently create admin/changeme123 with no startup warning.
        # Same pattern as JWT_SECRET_KEY/VAULT_MASTER_KEY above. See
        # security review 2026-10-29.
        if v == "changeme123":
            raise ValueError(
                "INITIAL_ADMIN_PASSWORD is set to the insecure default value. "
                "Set a strong password in .env.api before first boot."
            )
        return v


@lru_cache()
def get_settings() -> Settings:
    return Settings()

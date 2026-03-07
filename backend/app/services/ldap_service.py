import logging
from typing import Optional

logger = logging.getLogger(__name__)


class LDAPService:
    """
    Authenticates users against an LDAP/AD server using ldap3.
    Returns user attributes on success, None on failure.
    """

    def __init__(self, settings) -> None:
        self._settings = settings

    def authenticate(self, username: str, password: str) -> Optional[dict]:
        """
        Attempt to bind to LDAP with the provided credentials.
        Returns a dict with 'username', 'full_name', 'email' on success,
        or None if authentication fails.
        """
        if not password:
            return None

        try:
            from ldap3 import Server, Connection, ALL, SUBTREE, Tls
            import ssl

            tls = None
            if self._settings.LDAP_USE_TLS:
                tls = Tls(validate=ssl.CERT_NONE)

            server = Server(
                self._settings.LDAP_SERVER,
                port=self._settings.LDAP_PORT,
                use_ssl=False,
                tls=tls,
                get_info=ALL,
            )

            # Service-account bind to search for the user DN
            service_conn = None
            if self._settings.LDAP_BIND_DN:
                service_conn = Connection(
                    server,
                    user=self._settings.LDAP_BIND_DN,
                    password=self._settings.LDAP_BIND_PASSWORD,
                    auto_bind=True,
                )
            else:
                service_conn = Connection(server, auto_bind=True)

            search_filter = self._settings.LDAP_USER_FILTER.format(username=username)
            service_conn.search(
                search_base=self._settings.LDAP_BASE_DN,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=["cn", "mail", "displayName", "sAMAccountName", "uid"],
            )

            if not service_conn.entries:
                logger.debug("LDAP: user '%s' not found in directory", username)
                service_conn.unbind()
                return None

            entry = service_conn.entries[0]
            user_dn = entry.entry_dn
            service_conn.unbind()

            # Bind as the user to verify password
            user_conn = Connection(server, user=user_dn, password=password)
            if not user_conn.bind():
                logger.debug("LDAP: bind failed for user '%s'", username)
                return None
            user_conn.unbind()

            # Extract display name: prefer displayName, fall back to cn
            full_name = username
            if hasattr(entry, "displayName") and entry.displayName:
                full_name = str(entry.displayName)
            elif hasattr(entry, "cn") and entry.cn:
                full_name = str(entry.cn)

            email = None
            if hasattr(entry, "mail") and entry.mail:
                email = str(entry.mail)

            return {
                "username": username,
                "full_name": full_name,
                "email": email,
            }

        except ImportError:
            logger.error("ldap3 is not installed. Install it with: pip install ldap3>=2.9")
            return None
        except Exception as exc:
            logger.warning("LDAP authentication error for user '%s': %s", username, exc)
            return None

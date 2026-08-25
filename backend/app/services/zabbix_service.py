import logging
from typing import Optional

import httpx

from app.schemas.zabbix import ZabbixHost

logger = logging.getLogger(__name__)


class ZabbixService:
    """Reads host/interface data from Zabbix's JSON-RPC API using a
    pre-configured API token (Zabbix 5.4+ auth-token feature) — never
    accepts credentials from the request, only from server config."""

    @staticmethod
    async def _rpc(
        client: httpx.AsyncClient, host: str, method: str, params: dict
    ) -> dict:
        resp = await client.post(
            f"{host}/api_jsonrpc.php",
            json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1},
            headers={"Content-Type": "application/json-rpc"},
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"Zabbix API error: {data['error'].get('data') or data['error'].get('message')}")
        return data["result"]

    @staticmethod
    async def discover(
        host: str,
        token: str,
        verify_ssl: bool = False,
        limit: int = 2000,
    ) -> list[ZabbixHost]:
        results: list[ZabbixHost] = []

        async with httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}"},
            verify=verify_ssl,
            timeout=30.0,
            follow_redirects=True,
        ) as client:
            try:
                hosts = await ZabbixService._rpc(
                    client,
                    host,
                    "host.get",
                    {
                        "output": ["hostid", "host", "name", "status"],
                        "selectInterfaces": ["ip", "available"],
                        "limit": limit,
                    },
                )
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(
                    f"Zabbix API returned {exc.response.status_code}: {exc.response.text[:200]}"
                ) from exc
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Zabbix connection error: {exc}") from exc

            for h in hosts:
                for iface in h.get("interfaces", []):
                    ip = (iface.get("ip") or "").strip()
                    if not ip:
                        continue
                    results.append(ZabbixHost(
                        ip_address=ip,
                        hostname=h.get("name") or h.get("host"),
                        device_name=h.get("host"),
                        zabbix_status="enabled" if h.get("status") == "0" else "disabled",
                        available=iface.get("available") == "1",
                    ))

        logger.info("Zabbix discover: %d host IPs fetched from %s", len(results), host)
        return results

    @staticmethod
    async def lookup_ip(
        host: str, token: str, target_ip: str, verify_ssl: bool = False
    ) -> tuple[bool, Optional[str]]:
        """Real-time single-IP lookup for Check Availability. Returns
        (reachable, device_name). reachable is True only when Zabbix both
        knows the host AND its interface is currently reporting available —
        this reflects Zabbix's own live monitoring state, not just presence
        in inventory."""
        async with httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}"},
            verify=verify_ssl,
            timeout=10.0,
            follow_redirects=True,
        ) as client:
            interfaces = await ZabbixService._rpc(
                client,
                host,
                "hostinterface.get",
                {"output": ["ip", "available", "hostid"], "filter": {"ip": target_ip}},
            )
            if not interfaces:
                return False, None

            iface = interfaces[0]
            available = iface.get("available") == "1"

            device_name = None
            hostid = iface.get("hostid")
            if hostid:
                hosts = await ZabbixService._rpc(
                    client, host, "host.get", {"output": ["host", "name"], "hostids": [hostid]}
                )
                if hosts:
                    device_name = hosts[0].get("name") or hosts[0].get("host")

            return available, device_name

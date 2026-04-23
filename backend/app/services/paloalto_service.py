import logging
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

from app.schemas.paloalto import (
    PaloAltoAddress,
    PaloAltoDiscoverResult,
    PaloAltoInterface,
)

logger = logging.getLogger(__name__)


class PaloAltoService:
    """Fetches address objects, interfaces and ARP table from PAN-OS XML API."""

    @staticmethod
    async def _keygen(
        client: httpx.AsyncClient,
        base: str,
        username: str,
        password: str,
    ) -> str:
        resp = await client.get(
            f"{base}/api/",
            params={"type": "keygen", "user": username, "password": password},
        )
        resp.raise_for_status()
        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as exc:
            raise RuntimeError("PaloAlto returned non-XML during auth") from exc
        key_el = root.find(".//key")
        if key_el is None or not key_el.text:
            msg_el = root.find(".//msg")
            detail = msg_el.text if msg_el is not None else "unknown"
            raise RuntimeError(f"PaloAlto auth failed: {detail}")
        return key_el.text

    @staticmethod
    def _check_status(root: ET.Element) -> None:
        status = root.get("status")
        if status and status != "success":
            msg = root.findtext(".//msg") or root.findtext(".//line") or "unknown"
            raise RuntimeError(f"PaloAlto API error: {msg}")

    @staticmethod
    async def discover(
        host: str,
        username: str,
        password: str,
        verify_ssl: bool = False,
    ) -> PaloAltoDiscoverResult:
        base = host if host.startswith("http") else f"https://{host}"
        addresses: list[PaloAltoAddress] = []
        interfaces: list[PaloAltoInterface] = []
        arp_entries: list[dict] = []

        async with httpx.AsyncClient(
            verify=verify_ssl,
            timeout=30.0,
            follow_redirects=True,
        ) as client:
            try:
                api_key = await PaloAltoService._keygen(client, base, username, password)
            except httpx.HTTPError as exc:
                raise RuntimeError(f"Cannot connect to PaloAlto {host}: {exc}") from exc

            headers = {"X-PAN-KEY": api_key}

            # ── Address objects ──────────────────────────────────────────────────
            try:
                resp = await client.get(
                    f"{base}/api/",
                    headers=headers,
                    params={
                        "type": "config",
                        "action": "get",
                        "xpath": (
                            "/config/devices/entry[@name='localhost.localdomain']"
                            "/vsys/entry[@name='vsys1']/address"
                        ),
                        "key": api_key,
                    },
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                PaloAltoService._check_status(root)

                for entry in root.findall(".//entry"):
                    name = entry.get("name", "")
                    ip_netmask = entry.findtext("ip-netmask")
                    ip_range_val = entry.findtext("ip-range")
                    fqdn = entry.findtext("fqdn")
                    description = entry.findtext("description")

                    tags: list[str] = [
                        m.text for m in entry.findall(".//tag/member") if m.text
                    ]

                    addr_type = "ip-netmask"
                    if ip_range_val:
                        addr_type = "ip-range"
                    elif fqdn:
                        addr_type = "fqdn"

                    if ip_netmask or ip_range_val:
                        addresses.append(PaloAltoAddress(
                            name=name,
                            ip_netmask=ip_netmask,
                            ip_range=ip_range_val,
                            description=description,
                            tags=tags,
                            address_type=addr_type,
                        ))
            except RuntimeError:
                raise
            except Exception as exc:
                logger.warning("PaloAlto: could not fetch address objects: %s", exc)

            # ── Interfaces ───────────────────────────────────────────────────────
            try:
                resp = await client.get(
                    f"{base}/api/",
                    headers=headers,
                    params={
                        "type": "op",
                        "cmd": "<show><interface>all</interface></show>",
                        "key": api_key,
                    },
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)

                for iface in root.findall(".//ifnet"):
                    name_text = iface.findtext("name", "")
                    ip_text = iface.findtext("ip", "")
                    zone_text = iface.findtext("zone", "")
                    state_text = iface.findtext("state", "unknown")

                    if name_text and ip_text and ip_text not in ("N/A", ""):
                        # Strip CIDR prefix if present
                        ip_only = ip_text.split("/")[0]
                        interfaces.append(PaloAltoInterface(
                            name=name_text,
                            ip_address=ip_only,
                            zone=zone_text or None,
                            state=state_text,
                        ))
            except Exception as exc:
                logger.warning("PaloAlto: could not fetch interfaces: %s", exc)

            # ── ARP table ────────────────────────────────────────────────────────
            try:
                resp = await client.get(
                    f"{base}/api/",
                    headers=headers,
                    params={
                        "type": "op",
                        "cmd": "<show><arp><entry name='all'/></arp></show>",
                        "key": api_key,
                    },
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)

                for entry in root.findall(".//entry"):
                    ip_val = entry.findtext("ip", "")
                    if ip_val:
                        arp_entries.append({
                            "ip": ip_val,
                            "mac": entry.findtext("hw", ""),
                            "interface": entry.findtext("interface", ""),
                            "status": entry.findtext("status", ""),
                            "ttl": entry.findtext("ttl", ""),
                        })
            except Exception as exc:
                logger.warning("PaloAlto: could not fetch ARP table: %s", exc)

        logger.info(
            "PaloAlto discover: %d addresses, %d interfaces, %d ARP from %s",
            len(addresses), len(interfaces), len(arp_entries), host,
        )
        return PaloAltoDiscoverResult(
            addresses=addresses,
            interfaces=interfaces,
            arp_entries=arp_entries,
        )

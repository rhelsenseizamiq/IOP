import asyncio
import ipaddress
import logging
import socket
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.schemas.paloalto import (
    PaloAltoAddress,
    PaloAltoCheckMatch,
    PaloAltoCheckResult,
    PaloAltoDiscoverResult,
    PaloAltoInterface,
    PaloAltoNatMatch,
    PaloAltoSecurityMatch,
    PaloAltoTrafficLogEntry,
)

logger = logging.getLogger(__name__)

# Cap on how many IPs a single bulk check (subnet scan) may cover — matches
# the existing Network Scan feature's "deep" mode cap (up to /24), since a
# bulk PaloAlto check does real in-memory work (NAT + security rulebase
# matching) per IP per host, not just a network probe.
MAX_BULK_IPS = 254

# PAN-OS API keys are long-lived (not single-use) — cache per-host so a
# real-time search-as-you-type UI doesn't hit keygen on every keystroke.
_KEY_CACHE: dict[str, tuple[str, float]] = {}
_KEY_TTL_SECONDS = 600

# Raw address-object entries, cached per host — used both for direct
# per-IP address-object lookup and to resolve named object references
# inside NAT/security rules.
_ADDR_ENTRIES_CACHE: dict[str, tuple[list[ET.Element], float]] = {}

# NAT/security rules, cached PRE-RESOLVED (source/destination/translated
# tokens already turned into ipaddress networks) rather than as raw XML.
# A bulk scan checks every rule against every requested IP — resolving each
# rule's tokens fresh for every IP (thousands of rules x hundreds of IPs)
# was the actual bottleneck, not the network fetch. Pre-resolving once per
# cache refresh turns each IP's check into cheap containment tests.
_NAT_INDEX_CACHE: dict[str, tuple[list[dict], float]] = {}
_SECURITY_INDEX_CACHE: dict[str, tuple[list[dict], float]] = {}
_INTERFACE_ZONE_CACHE: dict[str, tuple[dict[str, str], float]] = {}
_INVENTORY_TTL_SECONDS = 600


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
    async def _cached_key(
        client: httpx.AsyncClient,
        base: str,
        username: str,
        password: str,
    ) -> str:
        cached = _KEY_CACHE.get(base)
        now = time.monotonic()
        if cached and (now - cached[1]) < _KEY_TTL_SECONDS:
            return cached[0]
        key = await PaloAltoService._keygen(client, base, username, password)
        _KEY_CACHE[base] = (key, now)
        return key

    @staticmethod
    async def _fetch_entries(
        client: httpx.AsyncClient, base: str, headers: dict, api_key: str, xpath: str,
    ) -> list[ET.Element]:
        resp = await client.get(
            f"{base}/api/",
            headers=headers,
            params={"type": "config", "action": "get", "xpath": xpath, "key": api_key},
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        return root.findall(".//entry")

    @staticmethod
    async def _get_address_entries(
        client: httpx.AsyncClient, base: str, headers: dict, api_key: str,
    ) -> list[ET.Element]:
        """Every address object, raw. Cached — a firewall's full address
        list can be large (thousands of entries) and doesn't change every
        minute. Used both to resolve named object references inside NAT/
        security rules and for direct per-IP address-object lookup."""
        cached = _ADDR_ENTRIES_CACHE.get(base)
        now = time.monotonic()
        if cached and (now - cached[1]) < _INVENTORY_TTL_SECONDS:
            return cached[0]
        entries = await PaloAltoService._fetch_entries(
            client, base, headers, api_key,
            "/config/devices/entry[@name='localhost.localdomain']/vsys/entry[@name='vsys1']/address",
        )
        _ADDR_ENTRIES_CACHE[base] = (entries, now)
        return entries

    @staticmethod
    def _build_address_name_map(entries: list[ET.Element]) -> dict[str, "ipaddress._BaseNetwork"]:
        """name -> network, for resolving a NAT/security rule token that's a
        named address object rather than a literal IP/CIDR."""
        name_map: dict[str, "ipaddress._BaseNetwork"] = {}
        for entry in entries:
            name = entry.get("name", "")
            raw = entry.findtext("ip-netmask")
            if not raw:
                continue
            try:
                name_map[name] = ipaddress.ip_network(raw, strict=False)
            except ValueError:
                continue
        return name_map

    @staticmethod
    def _build_address_by_ip(entries: list[ET.Element]) -> dict[str, ET.Element]:
        """Exact single-host (/32) address -> its entry, for O(1) per-IP
        lookup of a curated, named address object."""
        by_ip: dict[str, ET.Element] = {}
        for entry in entries:
            raw = entry.findtext("ip-netmask")
            if not raw:
                continue
            try:
                network = ipaddress.ip_network(raw, strict=False)
            except ValueError:
                continue
            if network.num_addresses == 1:
                by_ip[str(network.network_address)] = entry
        return by_ip

    @staticmethod
    def _resolve_tokens(
        tokens: list[str], name_map: dict[str, "ipaddress._BaseNetwork"],
    ) -> list["ipaddress._BaseNetwork"]:
        """Resolve a list of rule tokens (literal IPs/CIDRs, or named
        address objects via name_map) into parsed networks ONCE. 'any'
        never resolves to anything. Skips anything unresolvable rather than
        raising — a dangling/renamed object reference shouldn't break the
        whole rule's matching."""
        out: list["ipaddress._BaseNetwork"] = []
        for token in tokens:
            if not token or token.lower() == "any":
                continue
            try:
                out.append(ipaddress.ip_network(token, strict=False))
                continue
            except ValueError:
                pass
            net = name_map.get(token)
            if net is not None:
                out.append(net)
        return out

    @staticmethod
    def _precompute_nat_index(nat_entries: list[ET.Element], name_map: dict) -> list[dict]:
        """Pre-resolves every NAT rule's source/destination/translated
        tokens into networks once, so matching an IP against thousands of
        rules is a cheap containment test instead of re-parsing every
        token per IP."""
        precomputed: list[dict] = []
        for rule in nat_entries:
            src_members = [m.text for m in rule.findall("./source/member") if m.text]
            dst_members = [m.text for m in rule.findall("./destination/member") if m.text]

            static_ip_el = rule.find("./source-translation/static-ip/translated-address")
            static_translated = static_ip_el.text if static_ip_el is not None and static_ip_el.text else None
            pool_members = [
                m.text for m in rule.findall(
                    "./source-translation/dynamic-ip-and-port/translated-address/member"
                ) + rule.findall(
                    "./source-translation/dynamic-ip/translated-address/member"
                )
                if m.text
            ]
            translated_source_tokens = [static_translated] if static_translated else pool_members
            translated_source_display = static_translated or (", ".join(pool_members) if pool_members else None)

            dst_translated_el = rule.find("./destination-translation/translated-address")
            translated_destination = dst_translated_el.text if dst_translated_el is not None else None

            precomputed.append({
                "name": rule.get("name", ""),
                "from_zones": [m.text for m in rule.findall("./from/member") if m.text],
                "to_zones": [m.text for m in rule.findall("./to/member") if m.text],
                "original_source": src_members,
                "original_destination": dst_members,
                "src_networks": PaloAltoService._resolve_tokens(src_members, name_map),
                "dst_networks": PaloAltoService._resolve_tokens(dst_members, name_map),
                "translated_source_display": translated_source_display,
                "translated_source_networks": PaloAltoService._resolve_tokens(translated_source_tokens, name_map),
                "translated_destination": translated_destination,
                "translated_destination_networks": PaloAltoService._resolve_tokens(
                    [translated_destination] if translated_destination else [], name_map,
                ),
                "disabled": rule.findtext("disabled") == "yes",
            })
        return precomputed

    @staticmethod
    def _precompute_security_index(security_entries: list[ET.Element], name_map: dict) -> list[dict]:
        precomputed: list[dict] = []
        for rule in security_entries:
            src_members = [m.text for m in rule.findall("./source/member") if m.text]
            dst_members = [m.text for m in rule.findall("./destination/member") if m.text]
            precomputed.append({
                "name": rule.get("name", ""),
                "action": rule.findtext("action") or "unknown",
                "from_zones": [m.text for m in rule.findall("./from/member") if m.text],
                "to_zones": [m.text for m in rule.findall("./to/member") if m.text],
                "source": src_members,
                "destination": dst_members,
                "src_networks": PaloAltoService._resolve_tokens(src_members, name_map),
                "dst_networks": PaloAltoService._resolve_tokens(dst_members, name_map),
                "applications": [m.text for m in rule.findall("./application/member") if m.text],
                "services": [m.text for m in rule.findall("./service/member") if m.text],
                "tags": [m.text for m in rule.findall("./tag/member") if m.text],
                "disabled": rule.findtext("disabled") == "yes",
            })
        return precomputed

    @staticmethod
    async def _get_nat_index(
        client: httpx.AsyncClient, base: str, headers: dict, api_key: str,
        name_map: dict,
    ) -> list[dict]:
        """Pre-resolved NAT rulebase for this vsys, cached (rule count is
        small — tens, not thousands — but re-resolving on every keystroke
        is still wasteful)."""
        cached = _NAT_INDEX_CACHE.get(base)
        now = time.monotonic()
        if cached and (now - cached[1]) < _INVENTORY_TTL_SECONDS:
            return cached[0]
        entries = await PaloAltoService._fetch_entries(
            client, base, headers, api_key,
            "/config/devices/entry[@name='localhost.localdomain']/vsys/entry[@name='vsys1']/rulebase/nat/rules/entry",
        )
        precomputed = PaloAltoService._precompute_nat_index(entries, name_map)
        _NAT_INDEX_CACHE[base] = (precomputed, now)
        return precomputed

    @staticmethod
    async def _get_security_index(
        client: httpx.AsyncClient, base: str, headers: dict, api_key: str,
        name_map: dict,
    ) -> list[dict]:
        """Pre-resolved security rulebase for this vsys, cached — can be
        thousands of rules, so this is the single most expensive per-host
        step; the 10-minute cache plus one-time resolution is what makes
        repeated/bulk checks fast."""
        cached = _SECURITY_INDEX_CACHE.get(base)
        now = time.monotonic()
        if cached and (now - cached[1]) < _INVENTORY_TTL_SECONDS:
            return cached[0]
        entries = await PaloAltoService._fetch_entries(
            client, base, headers, api_key,
            "/config/devices/entry[@name='localhost.localdomain']/vsys/entry[@name='vsys1']/rulebase/security/rules/entry",
        )
        precomputed = PaloAltoService._precompute_security_index(entries, name_map)
        _SECURITY_INDEX_CACHE[base] = (precomputed, now)
        return precomputed

    @staticmethod
    async def _get_interface_zone_map(
        client: httpx.AsyncClient, base: str, headers: dict, api_key: str,
    ) -> dict[str, str]:
        """interface name -> security zone, so an ARP match's raw interface
        name (e.g. 'ae1.700') can also show which zone that is — cached,
        interface-to-zone bindings don't change often."""
        cached = _INTERFACE_ZONE_CACHE.get(base)
        now = time.monotonic()
        if cached and (now - cached[1]) < _INVENTORY_TTL_SECONDS:
            return cached[0]
        zone_map: dict[str, str] = {}
        try:
            resp = await client.get(
                f"{base}/api/",
                headers=headers,
                params={"type": "op", "cmd": "<show><interface>all</interface></show>", "key": api_key},
            )
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            for iface in root.findall(".//ifnet/entry"):
                name = iface.findtext("name")
                zone = iface.findtext("zone")
                if name and zone:
                    zone_map[name] = zone
        except Exception as exc:
            logger.warning("PaloAlto: could not fetch interface/zone map on %s: %s", base, exc)
        _INTERFACE_ZONE_CACHE[base] = (zone_map, now)
        return zone_map

    @staticmethod
    def _host_specific_hit(
        addr: "ipaddress._BaseAddress", networks: list["ipaddress._BaseNetwork"],
    ) -> bool:
        """True only if addr falls within a HOST-level (/32 or /128) network
        among the given ones. A hit against a broad subnet (e.g. a rule
        whose destination is a /16 covering an entire site) is not
        meaningful evidence that THIS specific address is in use — nearly
        every address in that subnet would match the same rule."""
        return any(addr in n and n.num_addresses == 1 for n in networks)

    @staticmethod
    def _any_hit(addr: "ipaddress._BaseAddress", networks: list["ipaddress._BaseNetwork"]) -> bool:
        return any(addr in n for n in networks)

    @staticmethod
    def _match_nat_index(
        nat_index: list[dict], ip: str, host: str,
    ) -> tuple[list[PaloAltoNatMatch], list[str]]:
        """Returns (host-specific matches, names of rules that only matched
        via a broad subnet and were excluded — for the transparency log)."""
        addr = ipaddress.ip_address(ip)
        out: list[PaloAltoNatMatch] = []
        broad_skipped: list[str] = []
        for r in nat_index:
            roles: list[str] = []
            any_broad = False
            for key, role in (
                ("src_networks", "original-source"),
                ("dst_networks", "original-destination"),
                ("translated_source_networks", "translated-source"),
                ("translated_destination_networks", "translated-destination"),
            ):
                if PaloAltoService._host_specific_hit(addr, r[key]):
                    roles.append(role)
                elif PaloAltoService._any_hit(addr, r[key]):
                    any_broad = True
            if roles:
                out.append(PaloAltoNatMatch(
                    host=host,
                    rule_name=r["name"],
                    roles=roles,
                    from_zones=r["from_zones"],
                    to_zones=r["to_zones"],
                    original_source=r["original_source"],
                    original_destination=r["original_destination"],
                    translated_source=r["translated_source_display"],
                    translated_destination=r["translated_destination"],
                    disabled=r["disabled"],
                ))
            elif any_broad:
                broad_skipped.append(r["name"])
        return out, broad_skipped

    @staticmethod
    def _match_security_index(
        security_index: list[dict], ip: str, host: str,
    ) -> tuple[list[PaloAltoSecurityMatch], list[str]]:
        """Returns (host-specific matches, names of rules that only matched
        via a broad subnet and were excluded — for the transparency log)."""
        addr = ipaddress.ip_address(ip)
        out: list[PaloAltoSecurityMatch] = []
        broad_skipped: list[str] = []
        for r in security_index:
            roles: list[str] = []
            any_broad = False
            if PaloAltoService._host_specific_hit(addr, r["src_networks"]):
                roles.append("source")
            elif PaloAltoService._any_hit(addr, r["src_networks"]):
                any_broad = True
            if PaloAltoService._host_specific_hit(addr, r["dst_networks"]):
                roles.append("destination")
            elif PaloAltoService._any_hit(addr, r["dst_networks"]):
                any_broad = True
            if not roles:
                if any_broad:
                    broad_skipped.append(r["name"])
                continue
            out.append(PaloAltoSecurityMatch(
                host=host,
                rule_name=r["name"],
                roles=roles,
                action=r["action"],
                from_zones=r["from_zones"],
                to_zones=r["to_zones"],
                source=r["source"],
                destination=r["destination"],
                applications=r["applications"],
                services=r["services"],
                tags=r["tags"],
                disabled=r["disabled"],
            ))
        return out, broad_skipped

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

                for iface in root.findall(".//ifnet/entry"):
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
                            "mac": entry.findtext("mac", ""),
                            "interface": entry.findtext("interface", ""),
                            "status": (entry.findtext("status", "") or "").strip(),
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

    @staticmethod
    async def log_check(db, result: PaloAltoCheckResult, source: str, checked_by: str) -> None:
        """Persists one check's outcome + full trace log for 30-day
        audit/history (paloalto_check_logs, TTL-indexed — see mongodb/init.js).
        Best-effort: a logging failure must never break the actual check."""
        try:
            await db["paloalto_check_logs"].insert_one({
                "ip_address": result.ip_address,
                "found": result.found,
                "hostname": result.hostname,
                "log": result.log,
                "matches_count": len(result.matches),
                "nat_matches_count": len(result.nat_matches),
                "security_matches_total": result.security_matches_total,
                "errors": result.errors,
                "source": source,
                "checked_by": checked_by,
                "checked_at": datetime.now(timezone.utc),
            })
        except Exception as exc:
            logger.warning("PaloAlto: failed to persist check log for %s: %s", result.ip_address, exc)

    @staticmethod
    async def log_checks_bulk(db, results: list[PaloAltoCheckResult], source: str, checked_by: str) -> None:
        """Bulk version of log_check — one insert_many call instead of N
        round-trips, for subnet scans that can cover up to MAX_BULK_IPS
        addresses."""
        if not results:
            return
        now = datetime.now(timezone.utc)
        docs = [
            {
                "ip_address": r.ip_address,
                "found": r.found,
                "hostname": r.hostname,
                "log": r.log,
                "matches_count": len(r.matches),
                "nat_matches_count": len(r.nat_matches),
                "security_matches_total": r.security_matches_total,
                "errors": r.errors,
                "source": source,
                "checked_by": checked_by,
                "checked_at": now,
            }
            for r in results
        ]
        try:
            await db["paloalto_check_logs"].insert_many(docs, ordered=False)
        except Exception as exc:
            logger.warning("PaloAlto: failed to persist bulk check logs: %s", exc)

    @staticmethod
    async def _reverse_dns(ip: str) -> Optional[str]:
        """Best-effort PTR lookup, off the event loop with a short timeout
        (gethostbyaddr is blocking). This is independent of PaloAlto's own
        naming — it queries whatever DNS resolver this server uses — so it
        can occasionally resolve to something unrelated (e.g. an address
        that numerically overlaps this server's own local Docker network);
        the UI labels it separately from PaloAlto-sourced names for that
        reason."""
        loop = asyncio.get_running_loop()
        try:
            name, _, _ = await asyncio.wait_for(
                loop.run_in_executor(None, socket.gethostbyaddr, ip), timeout=2.0,
            )
            return name
        except Exception:
            return None

    @staticmethod
    def _int_or_none(text: Optional[str]) -> Optional[int]:
        try:
            return int(text) if text is not None else None
        except ValueError:
            return None

    @staticmethod
    async def get_traffic_logs(
        hosts: list[str],
        username: str,
        password: str,
        ip: str,
        days: int = 30,
        max_logs: int = 50,
        verify_ssl: bool = False,
    ) -> tuple[list[PaloAltoTrafficLogEntry], list[str], bool]:
        """PaloAlto's own traffic log history for one address, across every
        configured firewall — real observed sessions (allow/deny, app,
        rule, bytes) over the last `days` days. This is PAN-OS's own log
        database (an async query-job + poll API), not our check-history —
        genuinely different data, and genuinely slower (several seconds),
        so this is only fetched on explicit user request, never as part of
        the fast real-time check.

        Returns (entries newest-first capped at max_logs, per-host errors,
        whether more entries existed than max_logs could hold).
        """
        ipaddress.ip_address(ip)  # defense-in-depth before it lands in a query string
        start_time = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y/%m/%d %H:%M:%S")
        query = f"((addr.src in {ip}) or (addr.dst in {ip})) and (receive_time geq '{start_time}')"

        entries: list[PaloAltoTrafficLogEntry] = []
        errors: list[str] = []
        truncated = False

        async def _fetch_one(client: httpx.AsyncClient, host: str) -> None:
            nonlocal truncated
            base = host if host.startswith("http") else f"https://{host}"
            try:
                api_key = await PaloAltoService._cached_key(client, base, username, password)
            except Exception as exc:
                errors.append(f"{host}: {exc}")
                return
            headers = {"X-PAN-KEY": api_key}

            try:
                resp = await client.get(
                    f"{base}/api/",
                    headers=headers,
                    params={
                        "type": "log",
                        "log-type": "traffic",
                        "query": query,
                        "nlogs": str(max_logs),
                        "key": api_key,
                    },
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                job_id = root.findtext(".//job")
                if not job_id:
                    msg = root.findtext(".//msg/line") or root.findtext(".//msg") or "no job id returned"
                    errors.append(f"{host}: {msg}")
                    return
            except Exception as exc:
                errors.append(f"{host}: failed to submit log query — {exc}")
                return

            for _ in range(15):  # ~15s max wait for the async log job
                await asyncio.sleep(1)
                try:
                    resp = await client.get(
                        f"{base}/api/",
                        headers=headers,
                        params={"type": "log", "action": "get", "job-id": job_id, "key": api_key},
                    )
                    resp.raise_for_status()
                    root = ET.fromstring(resp.text)
                except Exception as exc:
                    errors.append(f"{host}: polling failed — {exc}")
                    return

                if root.findtext(".//job/status") != "FIN":
                    continue

                logs_el = root.find(".//log/logs")
                if logs_el is not None and int(logs_el.get("count", "0")) >= max_logs:
                    truncated = True
                for entry in root.findall(".//log/logs/entry"):
                    entries.append(PaloAltoTrafficLogEntry(
                        host=host,
                        time_generated=entry.findtext("time_generated") or "",
                        src=entry.findtext("src") or "",
                        dst=entry.findtext("dst") or "",
                        sport=PaloAltoService._int_or_none(entry.findtext("sport")),
                        dport=PaloAltoService._int_or_none(entry.findtext("dport")),
                        proto=entry.findtext("proto"),
                        app=entry.findtext("app"),
                        action=entry.findtext("action"),
                        rule=entry.findtext("rule"),
                        from_zone=entry.findtext("from"),
                        to_zone=entry.findtext("to"),
                        bytes=PaloAltoService._int_or_none(entry.findtext("bytes")),
                        bytes_sent=PaloAltoService._int_or_none(entry.findtext("bytes_sent")),
                        bytes_received=PaloAltoService._int_or_none(entry.findtext("bytes_received")),
                        elapsed=PaloAltoService._int_or_none(entry.findtext("elapsed")),
                        session_end_reason=entry.findtext("session_end_reason"),
                    ))
                return
            errors.append(f"{host}: log query timed out")

        async with httpx.AsyncClient(
            verify=verify_ssl, timeout=30.0, follow_redirects=True,
        ) as client:
            await asyncio.gather(*(_fetch_one(client, host) for host in hosts))

        entries.sort(key=lambda e: e.time_generated, reverse=True)
        return entries[:max_logs], errors, truncated

    @staticmethod
    async def check_ip(
        hosts: list[str],
        username: str,
        password: str,
        ip: str,
        verify_ssl: bool = False,
    ) -> PaloAltoCheckResult:
        """Real-time single-IP lookup — see check_ips for the actual logic
        (this just runs a batch of one)."""
        results = await PaloAltoService.check_ips(hosts, username, password, [ip], verify_ssl)
        return results[0]

    @staticmethod
    async def check_ips(
        hosts: list[str],
        username: str,
        password: str,
        ips: list[str],
        verify_ssl: bool = False,
        on_log=None,
    ) -> list[PaloAltoCheckResult]:
        """Real-time lookup for one or many IPs (a single search, or a whole
        subnet scan) across every configured firewall — powers the PaloAlto
        Check page and the Check Availability dropdown.

        Per host, the address list, NAT rulebase, and security rulebase are
        each fetched ONCE (cached 10 minutes) and reused for every IP in
        `ips`, rather than re-fetched per IP — a firewall's security
        rulebase alone can be thousands of rules, so this is what keeps a
        subnet scan (up to MAX_BULK_IPS addresses) fast. Only the ARP table
        is fetched fresh every call, since it's a live/real-time signal.

        Checks four independent signals per host per IP:
        - A named address object with this exact IP — curated identity.
        - A live ARP entry — evidence something is plugged in right now.
        - Any NAT rule where this IP is an original or translated address
          (`nat_matches`) — an IP can be a pure NAT artifact with nothing
          else pointing to it.
        - Any security policy rule referencing this IP as source or
          destination (`security_matches`, capped at 30 with the true count
          in `security_matches_total`) — what traffic is actually allowed/
          denied to or from this address.

        Any signal on any host counts as "found". A failure fetching one
        host's data is recorded in every result's `errors` but never blocks
        the other hosts or other IPs.

        Every result also carries a human-readable `log` — a step-by-step
        trace of what was checked and why, including which rules matched
        a broad subnet only and were deliberately excluded — so a user can
        see exactly why an address was called "in use" instead of taking
        it on faith. Pass `on_log(ip, line)` (async callable) to also
        receive each line the moment it's produced, for real-time
        streaming — see check_ips_streaming.
        """
        matches_by_ip: dict[str, list[PaloAltoCheckMatch]] = {ip: [] for ip in ips}
        nat_by_ip: dict[str, list[PaloAltoNatMatch]] = {ip: [] for ip in ips}
        sec_by_ip: dict[str, list[PaloAltoSecurityMatch]] = {ip: [] for ip in ips}
        sec_total_by_ip: dict[str, int] = {ip: 0 for ip in ips}
        log_by_ip: dict[str, list[str]] = {ip: [] for ip in ips}
        errors: list[str] = []

        async def _emit(target_ip: str, line: str) -> None:
            log_by_ip[target_ip].append(line)
            if on_log is not None:
                await on_log(target_ip, line)

        async def _check_host(client: httpx.AsyncClient, host: str) -> None:
            base = host if host.startswith("http") else f"https://{host}"
            for target_ip in ips:
                await _emit(target_ip, f"Connecting to {host}...")
            try:
                api_key = await PaloAltoService._cached_key(client, base, username, password)
            except Exception as exc:
                errors.append(f"{host}: {exc}")
                for target_ip in ips:
                    await _emit(target_ip, f"{host}: authentication failed — {exc}")
                return
            headers = {"X-PAN-KEY": api_key}

            try:
                addr_entries = await PaloAltoService._get_address_entries(client, base, headers, api_key)
            except Exception as exc:
                errors.append(f"{host} (address objects): {exc}")
                addr_entries = []
            name_map = PaloAltoService._build_address_name_map(addr_entries)
            addr_by_ip = PaloAltoService._build_address_by_ip(addr_entries)

            try:
                nat_index = await PaloAltoService._get_nat_index(client, base, headers, api_key, name_map)
            except Exception as exc:
                errors.append(f"{host} (NAT rules): {exc}")
                nat_index = []

            try:
                security_index = await PaloAltoService._get_security_index(client, base, headers, api_key, name_map)
            except Exception as exc:
                errors.append(f"{host} (security rules): {exc}")
                security_index = []

            arp_by_ip: dict[str, ET.Element] = {}
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
                    ip_val = entry.findtext("ip")
                    if ip_val:
                        arp_by_ip[ip_val] = entry
            except Exception as exc:
                errors.append(f"{host} (ARP table): {exc}")

            try:
                zone_map = await PaloAltoService._get_interface_zone_map(client, base, headers, api_key)
            except Exception as exc:
                errors.append(f"{host} (interfaces): {exc}")
                zone_map = {}

            for target_ip in ips:
                addr_entry = addr_by_ip.get(target_ip)
                address_name = description = ip_netmask = None
                tags: list[str] = []
                if addr_entry is not None:
                    address_name = addr_entry.get("name")
                    description = addr_entry.findtext("description")
                    ip_netmask = addr_entry.findtext("ip-netmask")
                    tags = [m.text for m in addr_entry.findall(".//tag/member") if m.text]
                    await _emit(target_ip, f"{host}: address object — matched '{address_name}'")
                else:
                    await _emit(target_ip, f"{host}: address object — no match")

                arp_entry = arp_by_ip.get(target_ip)
                mac = interface = zone = arp_status = ttl = None
                if arp_entry is not None:
                    mac = arp_entry.findtext("mac")
                    interface = arp_entry.findtext("interface")
                    zone = zone_map.get(interface) if interface else None
                    arp_status = (arp_entry.findtext("status") or "").strip()
                    ttl = arp_entry.findtext("ttl")
                    zone_part = f", zone {zone}" if zone else ""
                    await _emit(target_ip, f"{host}: ARP — live entry (mac {mac}, interface {interface}{zone_part})")
                else:
                    await _emit(target_ip, f"{host}: ARP — no live entry")

                if address_name or mac:
                    matches_by_ip[target_ip].append(PaloAltoCheckMatch(
                        host=host,
                        address_name=address_name,
                        description=description,
                        tags=tags,
                        ip_netmask=ip_netmask,
                        mac=mac,
                        interface=interface,
                        zone=zone,
                        arp_status=arp_status,
                        ttl=ttl,
                    ))

                nat_matches, nat_broad_skipped = PaloAltoService._match_nat_index(nat_index, target_ip, host)
                nat_by_ip[target_ip].extend(nat_matches)
                if nat_matches:
                    names = ", ".join(m.rule_name for m in nat_matches[:5])
                    await _emit(target_ip, f"{host}: NAT — {len(nat_matches)} rule(s) matched: {names}")
                else:
                    await _emit(target_ip, f"{host}: NAT — no match")
                if nat_broad_skipped:
                    names = ", ".join(nat_broad_skipped[:5])
                    more = f" (+{len(nat_broad_skipped) - 5} more)" if len(nat_broad_skipped) > 5 else ""
                    await _emit(
                        target_ip,
                        f"{host}: NAT — {len(nat_broad_skipped)} rule(s) skipped "
                        f"(matched only a broad subnet, not this specific host): {names}{more}",
                    )

                sec_matches, sec_broad_skipped = PaloAltoService._match_security_index(
                    security_index, target_ip, host,
                )
                sec_total_by_ip[target_ip] += len(sec_matches)
                sec_by_ip[target_ip].extend(sec_matches)
                if sec_matches:
                    names = ", ".join(m.rule_name for m in sec_matches[:5])
                    more = f" (+{len(sec_matches) - 5} more)" if len(sec_matches) > 5 else ""
                    await _emit(target_ip, f"{host}: security policy — {len(sec_matches)} rule(s) matched: {names}{more}")
                else:
                    await _emit(target_ip, f"{host}: security policy — no host-specific match")
                if sec_broad_skipped:
                    names = ", ".join(sec_broad_skipped[:5])
                    more = f" (+{len(sec_broad_skipped) - 5} more)" if len(sec_broad_skipped) > 5 else ""
                    await _emit(
                        target_ip,
                        f"{host}: security policy — {len(sec_broad_skipped)} rule(s) skipped "
                        f"(matched only a broad subnet, not this specific host): {names}{more}",
                    )

        async with httpx.AsyncClient(
            verify=verify_ssl, timeout=30.0, follow_redirects=True,
        ) as client:
            await asyncio.gather(*(_check_host(client, host) for host in hosts))

        hostname_by_ip: dict[str, Optional[str]] = {}

        async def _resolve_dns(target_ip: str) -> None:
            name = await PaloAltoService._reverse_dns(target_ip)
            hostname_by_ip[target_ip] = name
            if name:
                await _emit(target_ip, f"Reverse DNS: {target_ip} -> {name}")
            else:
                await _emit(target_ip, f"Reverse DNS: no PTR record for {target_ip}")

        await asyncio.gather(*(_resolve_dns(ip) for ip in ips))

        results: list[PaloAltoCheckResult] = []
        for target_ip in ips:
            found = bool(matches_by_ip[target_ip]) or bool(nat_by_ip[target_ip]) or bool(sec_by_ip[target_ip])
            if found:
                reasons = []
                if matches_by_ip[target_ip]:
                    reasons.append("address object/ARP")
                if nat_by_ip[target_ip]:
                    reasons.append(f"{len(nat_by_ip[target_ip])} NAT rule(s)")
                if sec_by_ip[target_ip]:
                    reasons.append(f"{len(sec_by_ip[target_ip])} security rule(s)")
                await _emit(target_ip, f"RESULT: IN USE — {', '.join(reasons)}")
            else:
                await _emit(target_ip, "RESULT: UNUSED — no host-specific evidence found")

            results.append(PaloAltoCheckResult(
                ip_address=target_ip,
                found=found,
                hostname=hostname_by_ip.get(target_ip),
                matches=matches_by_ip[target_ip],
                nat_matches=nat_by_ip[target_ip],
                security_matches=sec_by_ip[target_ip][:30],
                security_matches_total=sec_total_by_ip[target_ip],
                log=log_by_ip[target_ip],
                errors=list(errors),
            ))
        return results

    @staticmethod
    async def check_ips_streaming(
        hosts: list[str],
        username: str,
        password: str,
        ips: list[str],
        verify_ssl: bool = False,
    ):
        """Thin streaming wrapper around check_ips — runs the real check in
        the background and yields ("log", ip, line) the moment each line is
        produced, then ("result", ip, PaloAltoCheckResult) once per ip after
        everything finishes. Powers the PaloAlto Check page's live trace —
        the underlying check logic is identical to the non-streaming path,
        just observed as it happens instead of only at the end."""
        queue: asyncio.Queue = asyncio.Queue()

        async def _on_log(ip: str, line: str) -> None:
            await queue.put(("log", ip, line))

        async def _runner() -> None:
            try:
                results = await PaloAltoService.check_ips(
                    hosts, username, password, ips, verify_ssl, on_log=_on_log,
                )
                for r in results:
                    await queue.put(("result", r.ip_address, r))
            except Exception as exc:
                await queue.put(("error", None, str(exc)))
            finally:
                await queue.put(("done", None, None))

        task = asyncio.create_task(_runner())
        try:
            while True:
                kind, ip, payload = await queue.get()
                if kind == "done":
                    break
                yield kind, ip, payload
        finally:
            if not task.done():
                task.cancel()

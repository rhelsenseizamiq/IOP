import ipaddress
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.database import get_database
from app.dependencies.auth import require_role
from app.models.user import UserInToken
from app.repositories.conversation_repository import ConversationRepository
from app.repositories.embedding_repository import EmbeddingRepository
from app.repositories.ip_record_repository import IPRecordRepository
from app.services import ai_service
# Reusing the exact same live-lookup functions the real Check Availability
# feature already uses (ip_records.py), rather than re-implementing
# Device42/Zabbix/PaloAlto/vSphere API calls a second time here. This is
# what lets the assistant actually check something live instead of only
# ever answering from the static subnet index.
from app.routers.ip_records import (
    _device42_lookup,
    _paloalto_lookup,
    _vsphere_display_name,
    _vsphere_lookup,
    _zabbix_lookup,
)
# Same reuse principle as the live-lookup imports above: the Dashboard's
# stats.py already computes real, trusted fleet-wide aggregations
# (duplicates, stale records, DR-tagging confirmation, critical subnets,
# sync health, breakdowns...) — reused here rather than re-querying the
# same collections a second time with slightly different logic.
from app.routers.stats import compute_dashboard_stats

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assistant", tags=["assistant"])

_VIEWER_PLUS = require_role("Viewer", "Operator", "Administrator", "SuperAdmin")


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=8, ge=1, le=50)


class SearchResultItem(BaseModel):
    text: str
    score: float
    source_collection: str
    source_id: str
    metadata: dict


class SearchResponse(BaseModel):
    results: list[SearchResultItem]


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)


class AskResponse(BaseModel):
    answer: str
    sources: list[SearchResultItem]


class HistoryMessage(BaseModel):
    role: str
    text: str
    sources: Optional[list[SearchResultItem]] = None
    created_at: datetime


class HistoryResponse(BaseModel):
    session_id: str
    messages: list[HistoryMessage]


class SessionSummary(BaseModel):
    session_id: str
    preview: str
    last_message_at: datetime
    message_count: int
    is_current: bool


class SessionListResponse(BaseModel):
    sessions: list[SessionSummary]


class SwitchSessionRequest(BaseModel):
    session_id: str


def _repo() -> EmbeddingRepository:
    return EmbeddingRepository(get_database()["record_embeddings"])


def _conversations() -> ConversationRepository:
    db = get_database()
    return ConversationRepository(db["assistant_messages"], db["assistant_sessions"])


# Matches an IPv4 address, with or without a /prefix — used to detect when
# a question mentions a specific subnet/address directly.
_IP_OR_CIDR_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}(?:/\d{1,2})?\b")


async def _find_mentioned_subnet(question: str, db) -> Optional[dict]:
    """If the question names a specific IP or CIDR, resolve it to the
    actual subnet deterministically — semantic search over embeddings is
    unreliable for exact numeric matches (verified: a subnet's own exact
    CIDR can score LOWER than an unrelated subnet, since the embedding
    model mostly captures the blurb's template text, not the specific
    digits). A directly-named address should never depend on the
    embedding model ranking it highly enough."""
    tokens = _IP_OR_CIDR_RE.findall(question)
    if not tokens:
        return None

    subnets = await db["subnets"].find(
        {}, {"cidr": 1, "name": 1, "environment": 1, "vlan_id": 1, "gateway": 1,
             "alert_threshold": 1, "description": 1},
    ).to_list(length=None)
    parsed = []
    for s in subnets:
        try:
            parsed.append((ipaddress.ip_network(s["cidr"], strict=False), s))
        except ValueError:
            continue

    for token in tokens:
        try:
            if "/" in token:
                target = ipaddress.ip_network(token, strict=False)
                for net, s in parsed:
                    if net == target:
                        return s
                continue
            addr = ipaddress.ip_address(token)
        except ValueError:
            continue

        # Bare address, no prefix given — check for an exact network-address
        # match first (a user typing "172.31.4.0" almost always means the
        # whole subnet, not a single host), then fall back to "which
        # subnet contains this address" (longest matching prefix).
        exact = [s for net, s in parsed if net.network_address == addr]
        if exact:
            return max(
                exact,
                key=lambda s: ipaddress.ip_network(s["cidr"], strict=False).prefixlen,
            )
        best, best_prefix = None, -1
        for net, s in parsed:
            if addr in net and net.prefixlen > best_prefix:
                best, best_prefix = s, net.prefixlen
        if best:
            return best
    return None


# Minimum cosine similarity (embeddings are L2-normalized — see
# ai_service.py — so this IS the dot product) for a semantic search
# match to be considered real grounding rather than noise. Measured
# live against real production data: a question genuinely unrelated to
# subnets ("how many users do I have", "check docker status") still
# scores ~0.48-0.54 against the nearest subnet blurb, purely from
# shared vocabulary/template text — subnets are the only thing ever
# embedded (see build_embeddings.py), so /search always returns
# *something*, never "no match". A real subnet-adjacent question scored
# 0.67+. Anything below this floor is dropped from both the shown
# source chips and the model's context — see ask()'s general fallback.
_SEMANTIC_RELEVANCE_FLOOR = 0.55

_FREE_ADDRESS_KEYWORDS = re.compile(r"\bfree\b|\bavailable\b|\bunused\b", re.IGNORECASE)


def _wants_free_addresses(question: str) -> bool:
    return bool(_FREE_ADDRESS_KEYWORDS.search(question))


def _subnet_summary_blurb(subnet_doc: dict) -> str:
    """Same shape as build_embeddings.py's _subnet_blurb (duplicated
    rather than cross-imported — that file is a standalone script outside
    the app package, not meant to be imported at request time). Used
    when a subnet is named but the question isn't about free addresses —
    e.g. "what's the gateway for 172.31.4.0/24" — so the LLM gets the
    subnet's real fields as context instead of nothing."""
    parts = [
        f"Subnet {subnet_doc['cidr']} ({subnet_doc.get('name', '')})",
        f"— {subnet_doc.get('environment', 'Production')}.",
    ]
    if subnet_doc.get("vlan_id"):
        parts.append(f"VLAN {subnet_doc['vlan_id']}.")
    if subnet_doc.get("gateway"):
        parts.append(f"Gateway {subnet_doc['gateway']}.")
    if subnet_doc.get("alert_threshold"):
        parts.append(f"Alert threshold {subnet_doc['alert_threshold']}%.")
    if subnet_doc.get("description"):
        parts.append(subnet_doc["description"])
    return " ".join(parts)


class FreeAddressInfo(BaseModel):
    context_text: str  # short summary fed to the LLM as context
    free_addresses: list[str]  # sample only for huge subnets — see below
    total_usable: int
    occupied: int


# Above this many usable addresses, don't materialize every host address
# into a Python list — this IPAM's real data has an actual /13 subnet
# (524,286 usable addresses) and nine /16s (65,534 each); building a full
# address list for one of those on a 15GB host already running two
# resident LLM models is real memory/latency risk, not a hypothetical
# one. Counts are still exact either way (cheap arithmetic); only the
# enumerated sample list is skipped for subnets this large.
_MAX_ENUMERABLE_ADDRESSES = 4096  # a /20-sized subnet


async def _free_address_info(
    subnet_doc: dict, ip_repo: IPRecordRepository,
) -> Optional[FreeAddressInfo]:
    """Real, computed free-address data for a subnet — deterministic
    Python arithmetic against actual IP records, never left to the LLM to
    guess or regenerate. A quantized 8B model running at ~0.18 tok/s has
    no business inventing (or slowly retyping, with real risk of
    transcription error) IP addresses for an IPAM tool — see how this is
    used in ask() below: the model only writes a short intro sentence,
    and the actual list here is appended in code, unchanged."""
    try:
        network = ipaddress.ip_network(subnet_doc["cidr"], strict=False)
    except ValueError:
        return None
    occupied = await ip_repo.find_occupied_addresses_by_subnet(str(subnet_doc["_id"]))
    total_usable = max(0, network.num_addresses - 2)
    occupied_count = len(occupied)
    free_count = max(0, total_usable - occupied_count)

    if network.num_addresses <= _MAX_ENUMERABLE_ADDRESSES:
        free_sample = [str(h) for h in network.hosts() if str(h) not in occupied]
    else:
        # Still correct, just no per-address sample for a subnet this large.
        free_sample = []

    context_text = (
        f"Subnet {subnet_doc['cidr']} ({subnet_doc.get('name', '')}) has "
        f"{total_usable} usable addresses, {occupied_count} in use/reserved, "
        f"{free_count} free."
    )
    return FreeAddressInfo(
        context_text=context_text, free_addresses=free_sample,
        total_usable=total_usable, occupied=occupied_count,
    )


# ── Meta questions — about the assistant itself or this app's data
# sources, never about a specific subnet/IP. Answered entirely in code:
# no retrieval, no LLM call. Before this, ANY question (even "what is
# your model?") ran semantic search anyway and attached 4 essentially-
# random subnet CIDRs as "sources" — technically not wrong (the search
# always returns its top-k), but meaningless and confusing for a question
# that was never about subnets at all. ──────────────────────────────────

_META_IDENTITY_RE = re.compile(
    r"\b(what (is|are) you\b|who are you\b|what('s| is) your model|which model"
    r"|what can you do|what you can do|what do you do\b|what are your (capabilities|features)"
    r"|^help$)",
    re.IGNORECASE,
)

_IDENTITY_ANSWER = (
    "I'm the offline AI assistant for the IOP IPAM portal — I run "
    "entirely on this server (Llama 3.1 8B), no data ever leaves it. "
    "I can: answer questions about subnet inventory (CIDR, VLAN, "
    "gateway, environment), give you exact free/used address counts "
    "and lists for a specific subnet, look up what this IPAM already "
    "knows about a specific IP or hostname (e.g. \"what do we know "
    "about 10.1.2.3?\" or \"what's the IP for db-prod-3?\"), check a "
    "specific IP's live status across Device42, Zabbix, PaloAlto, and "
    "vSphere on request — e.g. \"is 10.1.2.3 in use in PaloAlto?\" — "
    "report this server's "
    "own RAM/CPU usage and Docker container status, and answer "
    "fleet-wide questions like duplicate hostnames, stale 'In Use' "
    "records, DR-tagging records vCenter has never confirmed, subnets "
    "over/close to their alert threshold, nightly sync health, and "
    "environment/OS breakdowns. I only answer from this app's real "
    "data, never general knowledge."
)

_DATA_SOURCE_FAQ_RE = re.compile(
    r"\bwhy (only|just) (device\s?42|zabbix|paloalto|palo alto|vsphere|vcenter)"
    r"|where does .*(data|information|subnets?) come from"
    r"|which (data )?sources?\b|how (is|are) .*(imported|synced)\b",
    re.IGNORECASE,
)

_DATA_SOURCE_FAQ_ANSWER = (
    "New subnet records are created by Device42 (or manually) — that's "
    "why subnet descriptions say \"Imported from Device42\" or "
    "\"Auto-imported\". Zabbix, PaloAlto, and vSphere never create new "
    "subnets; they update IP records *within* subnets that already "
    "exist — device presence, live reachability, and VM inventory "
    "respectively. All four show up together in Check Availability and "
    "the nightly sync. Ask me to check a specific IP's live status "
    "(e.g. \"is 10.1.2.3 in use in PaloAlto?\") and I'll query it directly."
)


# ── Live IP check — the assistant actually calling this app's real
# Check Availability logic, not just searching static text. Detected
# separately from the free-address path above: a BARE host IP (no
# "/prefix" — see _extract_bare_ip) combined with an availability/check
# keyword or an explicit source name routes here; a CIDR or a bare
# address that's a subnet's own network address (e.g. "172.31.4.0",
# meaning the whole /24) still goes through _find_mentioned_subnet
# below. ─────────────────────────────────────────────────────────────

# Deliberately does NOT include "available"/"in use"/"free" — those
# overlap with the free-address subnet-listing wording above, and a bare
# host IP can also resolve to a *containing* subnet (not just an exact
# network-address match) via _find_mentioned_subnet's longest-prefix
# fallback. Without this exclusion, "is 172.31.3.166 available" could
# wrongly trigger a free-address listing for the whole containing /24
# instead of checking that one address — the exact shape of bug already
# fixed once for exact-CIDR matching. A strong check-verb or an
# explicitly named source is what actually signals "look this one
# address up live", so only those are used here.
_LIVE_CHECK_VERB_RE = re.compile(
    r"\b(check|ping|reachable|status of|is it (up|down|active))\b",
    re.IGNORECASE,
)

_SOURCE_NAME_PATTERNS: dict[str, re.Pattern] = {
    "device42": re.compile(r"device\s?42", re.IGNORECASE),
    "zabbix": re.compile(r"zabbix", re.IGNORECASE),
    "paloalto": re.compile(r"palo\s?alto", re.IGNORECASE),
    "vsphere": re.compile(r"vsphere|vcenter", re.IGNORECASE),
}
_ALL_LIVE_SOURCES = ["device42", "zabbix", "paloalto", "vsphere"]


def _extract_bare_ip(question: str) -> Optional[str]:
    """First token that's an IP address with NO /prefix — a subnet-level
    mention (CIDR, or a bare address matching a subnet's own network
    address) is handled by _find_mentioned_subnet instead."""
    for token in _IP_OR_CIDR_RE.findall(question):
        if "/" not in token:
            try:
                ipaddress.ip_address(token)
                return token
            except ValueError:
                continue
    return None


def _mentions_named_source(question: str) -> bool:
    return any(pat.search(question) for pat in _SOURCE_NAME_PATTERNS.values())


def _wants_live_check(question: str) -> bool:
    return bool(_LIVE_CHECK_VERB_RE.search(question)) or _mentions_named_source(question)


def _explicit_live_sources(question: str) -> list[str]:
    named = [name for name, pat in _SOURCE_NAME_PATTERNS.items() if pat.search(question)]
    return named or _ALL_LIVE_SOURCES


# ── Hostname lookup — "what's the IP for db-prod-3", "tell me about
# host X". Only high-confidence trigger phrases are matched (never a
# bare word alone — far too many false-positive risks in ordinary
# English), and the captured token must contain a digit, dot, dash, or
# underscore to look hostname-shaped, not just any word that happened
# to follow the trigger phrase. Underscore is included in the character
# class deliberately — this app's real hostnames use it (e.g.
# "MP_Server_MP_UniMed_Server", found via this app's own live data)
# and excluding it silently broke every match against a real hostname
# containing one, since the capture group couldn't reach its 3-char
# minimum before hitting the underscore. ───────────────────────────────

_HOSTNAME_QUERY_RE = re.compile(
    r"\b(?:ip (?:address )?(?:for|of)|what(?:'s| is) the ip (?:address )?(?:for|of)"
    r"|hostname (?:for|of)|which ip does"
    r"|(?:info(?:rmation)?|details?) (?:about|on|for) (?:host|server|device)"
    r"|tell me about (?:host|server|device))\s+"
    r"([a-zA-Z0-9][a-zA-Z0-9._\-]{2,63})",
    re.IGNORECASE,
)


def _extract_hostname_query(question: str) -> Optional[str]:
    m = _HOSTNAME_QUERY_RE.search(question)
    if not m:
        return None
    candidate = m.group(1).rstrip(".,?!")
    if not re.search(r"[0-9._\-]", candidate):
        return None
    return candidate


async def _hostname_lookup(db, hostname_fragment: str) -> list:
    cursor = db["ip_records"].find(
        {"hostname": {"$regex": re.escape(hostname_fragment), "$options": "i"}},
    ).limit(10)
    return await cursor.to_list(length=10)


def _own_record_blurb(record) -> str:
    """Deterministic blurb from this app's OWN ip_records data — the
    IPAM's actual source of truth, not a live external system. Real gap
    found and fixed: the assistant previously only ever consulted its
    own database as a side effect of a subnet-level match; asking about
    one specific IP always went straight to external live checks (or,
    without a check-verb, to the general LLM fallback with no IP-record
    context at all) — for an IPAM tool, never looking at its own core
    data first is backwards."""
    parts = [f"{record.ip_address}" + (f" ({record.hostname})" if record.hostname else "")]
    parts.append(f"— status: {record.status.value}, environment: {record.environment.value}.")
    if record.os_type:
        parts.append(f"OS: {record.os_type.value}.")
    if record.power_state:
        parts.append(f"vSphere power state: {record.power_state}.")
    if record.owner:
        parts.append(f"Owner: {record.owner}.")
    if record.description:
        parts.append(record.description)
    if record.updated_at:
        parts.append(f"Last updated {record.updated_at.isoformat()} by {record.updated_by}.")
    return " ".join(parts)


async def _live_ip_check(
    target_ip: str, source_names: list[str], current_user: UserInToken,
    ip_repo: IPRecordRepository,
) -> tuple[str, list[SearchResultItem]]:
    """Actually calls this app's real, live Device42/Zabbix/PaloAlto/
    vSphere lookups — the same functions the real Check Availability
    feature uses — and reports the real result. No LLM involved: this is
    live network/API data, not something to hand to a model to phrase or
    (worse) guess at. A source that's unreachable/unconfigured is
    reported as such rather than failing the whole check, same as the
    real Check Availability UI does. Also always prepends this app's OWN
    ip_records entry for the address, if one exists — see
    _own_record_blurb — so a check reports both "what we already have
    on file" and "what's true right now", not just the latter."""
    lines: list[str] = []
    sources: list[SearchResultItem] = []
    any_found = False

    own_record = await ip_repo.find_by_ip(target_ip)
    if own_record:
        # Deliberately NOT folded into any_found/the verdict below — that
        # verdict means "confirmed live right now by an external source",
        # and an existing IPAM record could itself be stale (that's
        # exactly what the stale-in-use fleet-stats check watches for).
        # Reported as its own line so the answer distinguishes "what we
        # have on file" from "what's true right now".
        blurb = _own_record_blurb(own_record)
        lines.append(f"IPAM record: {blurb}")
        sources.append(SearchResultItem(
            text=blurb, score=1.0, source_collection="ip_records",
            source_id=str(own_record.id), metadata={"ip_address": target_ip},
        ))

    async def _report(name: str, label: str, found: bool) -> None:
        nonlocal any_found
        any_found = any_found or found
        lines.append(f"{name}: {label}")
        sources.append(SearchResultItem(
            text=f"{target_ip} — {name}: {label}", score=1.0,
            source_collection="live_check", source_id=f"{target_ip}:{name}",
            metadata={"ip_address": target_ip, "source": name},
        ))

    for name in source_names:
        try:
            if name == "device42":
                found, device_name, _os = await _device42_lookup(target_ip)
                await _report("Device42", f"in use ({device_name})" if found else "not found", found)
            elif name == "zabbix":
                found, device_name, _os = await _zabbix_lookup(target_ip)
                await _report("Zabbix", f"reachable ({device_name})" if found else "not reachable", found)
            elif name == "paloalto":
                found, device_name = await _paloalto_lookup(target_ip, current_user, "ai-assistant")
                await _report("PaloAlto", f"found ({device_name})" if found else "not found", found)
            elif name == "vsphere":
                found, hostname, _os, power_state = await _vsphere_lookup(target_ip)
                label = _vsphere_display_name(hostname, power_state) if found else None
                await _report("vSphere", f"found ({label})" if found else "not found", found)
        except Exception as exc:
            lines.append(f"{name}: check failed ({exc})")

    verdict = "IN USE" if any_found else "not confirmed live by any checked source"
    answer = f"{target_ip} — {verdict}.\n" + "\n".join(lines)
    return answer, sources


# ── Conversational follow-up ("try again", "check again") — a short
# message with no IP/CIDR/keywords of its own is otherwise unanswerable
# (a real reported bug: "try again please to check" fell through to the
# general LLM fallback with no idea what to check again). When this
# matches AND the message doesn't already resolve on its own, the
# previous user message's text is prepended before intent detection —
# carrying its IP/subnet/source-name forward without needing the LLM to
# track state, since the deterministic intent detectors above are what
# actually need the missing information, not the LLM. ────────────────

_FOLLOWUP_RE = re.compile(
    r"\b(try again|once more|again please|please try again|retry"
    r"|check again|do it again|one more time)\b",
    re.IGNORECASE,
)


# ── Server status — RAM/CPU, read directly from /proc inside the
# container. Verified empirically that these specific files are NOT
# namespaced per-container (unlike cgroup memory limits) — they reflect
# the real host's numbers almost exactly (checked side-by-side against
# `free -h` and `/proc/loadavg` run directly on the host). Deliberately
# does NOT report disk usage: the container's "/" is its own writable
# overlay layer, unrelated to the host's actual disk layout (/opt, /var,
# /data are separate LVs) — reporting that would be a confidently wrong
# number, not a merely-approximate one. ──────────────────────────────

_SERVER_STATUS_RE = re.compile(
    r"\b(ram usage|memory usage|cpu usage|server status|server health"
    r"|how much (memory|ram|cpu)|load average|system (status|health|resources))\b",
    re.IGNORECASE,
)


def _server_status() -> str:
    mem: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                try:
                    mem[key] = int(rest.strip().split()[0])
                except (ValueError, IndexError):
                    continue
        with open("/proc/loadavg") as f:
            load1, load5, load15 = f.read().split()[:3]
    except OSError as exc:
        return f"Couldn't read server resource stats: {exc}"

    total_gb = mem.get("MemTotal", 0) / 1024 / 1024
    available_gb = mem.get("MemAvailable", 0) / 1024 / 1024
    used_gb = total_gb - available_gb
    cpu_count = os.cpu_count() or 1

    return (
        f"RAM: {used_gb:.1f} GB used / {total_gb:.1f} GB total "
        f"({available_gb:.1f} GB available). "
        f"CPU load average across {cpu_count} cores: {load1} (1 min), "
        f"{load5} (5 min), {load15} (15 min)."
    )


# ── Docker container status — real reported gap: "check docker status
# in server" had nothing to answer from and fell through to the general
# LLM fallback, which correctly said it had no information (context was
# just unrelated subnet blurbs). Deliberately does NOT mount
# docker.sock into this container to fix that: giving an app container
# that also executes chat-driven code paths access to the Docker socket
# is equivalent to giving it root on the host (anyone with socket
# access can launch a privileged container and escape), and the
# standard mitigation — a read-only docker-socket-proxy sidecar — needs
# an image pulled from a registry, which this air-gapped host can't do.
# Instead: a host-side cron script (scripts/docker_status_snapshot.sh,
# runs as the ansible user via its existing passwordless sudo docker
# access — see README) snapshots `docker inspect` output for every
# container to a plain JSON file, which is bind-mounted READ-ONLY into
# this container (docker-compose.yml) — same "read a file, no socket,
# no LLM" shape as _server_status() above, just sourced from outside
# the container instead of /proc. ────────────────────────────────────

_DOCKER_STATUS_RE = re.compile(
    r"docker|container status|containers? (running|healthy|status)|pod status(es)?",
    re.IGNORECASE,
)

_DOCKER_STATUS_PATH = "/app/docker_status.json"
# If the snapshot is older than this, the cron job itself is probably
# broken (or was never deployed) — say so explicitly rather than quietly
# serve stale status as if it were live.
_DOCKER_STATUS_STALE_SECONDS = 600


def _docker_status() -> str:
    try:
        with open(_DOCKER_STATUS_PATH) as f:
            data = json.load(f)
    except FileNotFoundError:
        return (
            "No Docker status snapshot is available yet — the host-side "
            "cron job (scripts/docker_status_snapshot.sh) may not be "
            "deployed or hasn't run yet."
        )
    except (OSError, json.JSONDecodeError) as exc:
        return f"Couldn't read the Docker status snapshot: {exc}"

    generated_at = data.get("generated_at")
    staleness_note = ""
    if generated_at:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(generated_at)).total_seconds()
            if age > _DOCKER_STATUS_STALE_SECONDS:
                staleness_note = (
                    f" (WARNING: this snapshot is {int(age // 60)} minutes "
                    f"old — the cron job may have stopped running)"
                )
        except ValueError:
            pass

    containers = data.get("containers", [])
    if not containers:
        return f"Docker status snapshot has no containers listed{staleness_note}."

    lines = [f"Docker containers as of {generated_at}{staleness_note}:"]
    for c in containers:
        health = c.get("health")
        health_part = f", health: {health}" if health and health != "n/a" else ""
        lines.append(f"- {c.get('name')}: {c.get('status')}{health_part}")
    return "\n".join(lines)


# ── Fleet analytics — the biggest gap in what the assistant could
# actually answer before this: everything above only ever knew about
# individual subnets/IPs. Real questions about the *whole* fleet
# ("any duplicate hostnames?", "how many DR records has vCenter never
# confirmed?", "which subnets are over their alert threshold?", "what's
# the nightly sync status?") had nothing to answer from and fell through
# to the general LLM fallback with only a handful of semantically-
# matched subnet blurbs as context — nowhere near enough to answer, and
# the model would (correctly) say so, which read as "dumb"/templated
# rather than actually incapable of a fleet-wide question.
#
# Reuses stats.py's compute_dashboard_stats() (the exact same aggregation
# the Dashboard page itself displays) and the nightly anomaly digest doc
# — never a second, slightly-different reimplementation of these counts.
# Every fact below is real, computed Python/Mongo arithmetic; the model
# is never asked to state or reproduce any of these numbers itself, same
# "let the LLM narrate, never let it compute" principle as
# _free_address_info/_server_status above. Only engaged when the question
# doesn't already name a specific IP/subnet — a subnet-scoped question
# still goes through the existing per-subnet paths. ───────────────────

def _fmt_duplicates(stats: dict, digest: Optional[dict]) -> str:
    d = stats["duplicates_summary"]
    if not d["hostname_groups"]:
        return "No duplicate hostnames found across all IP records."
    return (
        f"{d['hostname_groups']} hostname(s) are duplicated across "
        f"{d['hostname_records']} IP records fleet-wide."
    )


def _fmt_stale(stats: dict, digest: Optional[dict]) -> str:
    s = stats["stale_in_use"]
    if not s["count"]:
        return f"No 'In Use' records are stale — all reconfirmed within {s['threshold_days']} days."
    return (
        f"{s['count']} IP records marked 'In Use' haven't been "
        f"reconfirmed by any source (Device42/Zabbix/PaloAlto/vSphere/"
        f"manual check) in over {s['threshold_days']} days."
    )


def _fmt_dr(stats: dict, digest: Optional[dict]) -> str:
    counters = (digest or {}).get("counters", {})
    dr_total = counters.get("dr_total")
    dr_unconfirmed = counters.get("dr_unconfirmed_by_vcenter")
    if dr_total is None:
        return "DR-tagging confirmation data isn't available yet (nightly digest hasn't run)."
    if dr_unconfirmed:
        return (
            f"{dr_unconfirmed} of {dr_total} records tagged Environment=DR "
            f"have never been confirmed by a vCenter sync (power_state "
            f"unset) — worth checking these are genuinely DR, not a "
            f"tagging error."
        )
    return f"All {dr_total} records tagged Environment=DR have been confirmed by vCenter."


def _fmt_critical(stats: dict, digest: Optional[dict]) -> str:
    crit = stats["critical_subnets"]
    over = [
        c for c in crit
        if c.get("alert_threshold") is not None and c["utilization_pct"] >= c["alert_threshold"]
    ]
    if not over:
        top = sorted(crit, key=lambda c: c["utilization_pct"], reverse=True)[:3]
        preview = ", ".join(f"{c['cidr']} ({c['utilization_pct']}%)" for c in top)
        return f"No subnets are currently over their alert threshold. Highest utilization: {preview}."
    listing = ", ".join(
        f"{c['cidr']} ({c['utilization_pct']}%, threshold {c['alert_threshold']}%)"
        for c in over[:10]
    )
    return f"{len(over)} subnet(s) are over their alert threshold: {listing}."


def _fmt_env_breakdown(stats: dict, digest: Optional[dict]) -> str:
    return "IP records by environment: " + ", ".join(f"{k}: {v}" for k, v in stats["environment_breakdown"].items())


def _fmt_os_breakdown(stats: dict, digest: Optional[dict]) -> str:
    return "IP records by OS: " + ", ".join(f"{k}: {v}" for k, v in stats["os_breakdown"].items())


def _fmt_status_breakdown(stats: dict, digest: Optional[dict]) -> str:
    listing = ", ".join(f"{k}: {v}" for k, v in stats["status_breakdown"].items())
    return f"Total IP records: {stats['total_ips']}. By status: {listing}."


def _fmt_sync_status(stats: dict, digest: Optional[dict]) -> str:
    ss = stats["sync_status"]
    if not ss:
        return "No nightly sync status has been recorded yet."
    parts = [f"{src}: {info.get('status')} (last run {info.get('last_run_at')})" for src, info in ss.items()]
    return "Nightly sync status — " + "; ".join(parts)


def _fmt_counts(stats: dict, digest: Optional[dict]) -> str:
    return (
        f"{stats['total_subnets']} subnets, {stats['total_vrfs']} VRFs, "
        f"{stats['total_aggregates']} aggregates, {stats['total_ips']} IP records total."
    )


def _fmt_unused(stats: dict, digest: Optional[dict]) -> str:
    return f"{stats['unused_ips_total']} IP addresses across all subnets have no record at all (unused)."


def _fmt_power_state(stats: dict, digest: Optional[dict]) -> str:
    listing = ", ".join(f"{k}: {v}" for k, v in stats["power_state_breakdown"].items())
    return f"vSphere power state (only for records vCenter has matched): {listing}."


def _fmt_paloalto_activity(stats: dict, digest: Optional[dict]) -> str:
    pa = stats["paloalto_activity"]
    pct = f"{pa['found_pct_7d']}%" if pa["found_pct_7d"] is not None else "n/a"
    return (
        f"PaloAlto Check Availability: {pa['checks_24h']} checks in the "
        f"last 24h, {pa['checks_7d']} in the last 7 days ({pct} found)."
    )


_FLEET_STATS_TOPICS: list[tuple[re.Pattern, "callable"]] = [
    (re.compile(r"duplicate", re.IGNORECASE), _fmt_duplicates),
    (re.compile(r"\bstale\b", re.IGNORECASE), _fmt_stale),
    (re.compile(r"\bdr\b|disaster recovery", re.IGNORECASE), _fmt_dr),
    (
        re.compile(
            r"critical subnet|over.*threshold|threshold|full\b|close to full"
            r"|near(ly)? full|near capacity|running out|highest utilization|most utilized"
            r"|busiest subnet",
            re.IGNORECASE,
        ),
        _fmt_critical,
    ),
    (re.compile(r"environment breakdown|by environment|per environment", re.IGNORECASE), _fmt_env_breakdown),
    (re.compile(r"os breakdown|by os\b|operating system", re.IGNORECASE), _fmt_os_breakdown),
    (
        re.compile(
            r"status breakdown|how many ips|total ip records|count.*in use|in use.*count",
            re.IGNORECASE,
        ),
        _fmt_status_breakdown,
    ),
    (re.compile(r"sync status|last sync|nightly sync", re.IGNORECASE), _fmt_sync_status),
    (
        re.compile(r"how many subnets|how many vrfs|how many aggregates|total subnets|total vrfs", re.IGNORECASE),
        _fmt_counts,
    ),
    (re.compile(r"unused ip|unused address", re.IGNORECASE), _fmt_unused),
    (re.compile(r"power state|vms? (on|off)|powered (on|off)", re.IGNORECASE), _fmt_power_state),
    (
        re.compile(r"paloalto activity|check availability activity|checks (today|this week|24h|7d)", re.IGNORECASE),
        _fmt_paloalto_activity,
    ),
]


def _wants_fleet_stats(question: str) -> list:
    return [fmt for pat, fmt in _FLEET_STATS_TOPICS if pat.search(question)]


def _unavailable(exc: Exception) -> HTTPException:
    logger.error("AI assistant backend unavailable: %s", exc)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The AI assistant is currently unavailable. Try again shortly.",
    )


@router.post("/search", response_model=SearchResponse)
async def semantic_search(
    body: SearchRequest,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> SearchResponse:
    """Pure semantic search — no generation, just embed the query and
    retrieve the closest matching records. Cheap and near-instant since it
    never touches the chat model."""
    try:
        query_vector = await ai_service.embed_text(body.query)
    except httpx.HTTPError as exc:
        raise _unavailable(exc) from exc

    results = await _repo().search(query_vector, top_k=body.top_k)
    return SearchResponse(results=[SearchResultItem(**r) for r in results])


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> AskResponse:
    """Routes the question, in priority order, to whichever of this
    app's real capabilities actually answers it — never forcing every
    question through subnet semantic search regardless of what was
    asked (a real reported bug: even "what is your model?" used to run
    subnet search and attach 4 unrelated CIDRs as "sources"):
    0. A short follow-up with no content of its own ("try again") gets
       the previous question's text prepended before anything below
       runs, so a carried-forward IP/subnet/source name still resolves.
    1. Meta questions about the assistant itself — answered in code.
    2. Meta questions about why only some data sources create subnets —
       answered in code (a real, common point of confusion).
    3. Server resource status (RAM/CPU) — read directly from /proc,
       answered in code.
    4. A live IP-availability check ("is 10.1.2.3 in use in PaloAlto?")
       — actually calls this app's real Device42/Zabbix/PaloAlto/vSphere
       lookups, the same ones Check Availability uses, and reports the
       real result. No LLM involved.
    5. A directly-named subnet/CIDR — resolved deterministically (see
       _find_mentioned_subnet), then either a deterministic free-address
       answer or a grounded chat answer using that subnet's real fields.
    6. Otherwise: semantic search + a grounded chat answer, same as
       before."""
    db = get_database()
    ip_repo = IPRecordRepository(db["ip_records"])
    conversations = _conversations()
    session_id = await conversations.get_or_create_session(current_user.sub)

    # See _FOLLOWUP_RE above — only kicks in when the message doesn't
    # already resolve anything on its own, so a genuinely new question
    # that happens to contain "again" is never affected.
    effective_question = body.question
    if (
        _FOLLOWUP_RE.search(body.question)
        and not _extract_bare_ip(body.question)
        and not await _find_mentioned_subnet(body.question, db)
    ):
        previous = await conversations.last_user_message(current_user.sub, session_id)
        if previous:
            effective_question = f"{previous} {body.question}"

    bare_ip = _extract_bare_ip(effective_question)
    # Resolved once up front (rather than inside the "else" below, as
    # before) so the new fleet-analytics branch can also check "was a
    # specific subnet/IP named" without a second, redundant query.
    mentioned = await _find_mentioned_subnet(effective_question, db)
    # Fleet-wide analytics only makes sense when the question isn't
    # already about one specific IP/subnet — those keep using the
    # existing per-subnet/per-IP paths below.
    fleet_formatters = _wants_fleet_stats(effective_question) if not bare_ip and not mentioned else []

    if _META_IDENTITY_RE.search(body.question):
        answer = _IDENTITY_ANSWER
        sources: list[SearchResultItem] = []

    elif _DATA_SOURCE_FAQ_RE.search(body.question):
        answer = _DATA_SOURCE_FAQ_ANSWER
        sources = []

    elif _SERVER_STATUS_RE.search(body.question):
        answer = _server_status()
        sources = []

    elif _DOCKER_STATUS_RE.search(body.question):
        answer = _docker_status()
        sources = []

    elif bare_ip and _wants_live_check(effective_question):
        answer, sources = await _live_ip_check(
            bare_ip, _explicit_live_sources(effective_question), current_user, ip_repo,
        )

    elif bare_ip:
        # A bare IP mentioned WITHOUT a check-verb ("what do we know
        # about 172.31.3.166", "tell me about 10.1.2.3") previously fell
        # through to the general LLM fallback, which has zero access to
        # individual IP-record data (only subnets are embedded — see
        # build_embeddings.py) — meaning the single most obvious kind of
        # question an IPAM assistant should answer had no real path to
        # this app's own core data at all. Deterministic, no LLM, no
        # external API calls — just this app's own database, same as
        # _live_ip_check's own-record lookup above but without paying
        # for live external checks nobody asked for.
        own_record = await ip_repo.find_by_ip(bare_ip)
        if own_record:
            answer = _own_record_blurb(own_record)
            sources = [SearchResultItem(
                text=answer, score=1.0, source_collection="ip_records",
                source_id=str(own_record.id), metadata={"ip_address": bare_ip},
            )]
        else:
            answer = (
                f"{bare_ip} has no record in this IPAM. Ask me to \"check "
                f"{bare_ip}\" if you want a live lookup across Device42/"
                f"Zabbix/PaloAlto/vSphere instead."
            )
            sources = []

    elif not mentioned and _extract_hostname_query(effective_question):
        # Same principle, keyed by hostname instead of IP — "what's the
        # IP for db-prod-3", "tell me about host X". Fuzzy (regex
        # substring, case-insensitive) since real hostnames are rarely
        # typed with exact casing/fully-qualified form; capped and each
        # match shown individually rather than silently picking one.
        fragment = _extract_hostname_query(effective_question)
        matches = await _hostname_lookup(db, fragment)
        if matches:
            # Same conversion the repository layer itself uses (raw Mongo
            # doc -> typed IPRecord), reused here so this goes through
            # the exact same validation/shape as every other IP-record
            # read in the app, then formatted with the same blurb helper
            # as the bare-IP path above — one source of truth for "what
            # does a real IP record look like as text".
            records = [ip_repo._doc_to_model(doc) for doc in matches]
            lines = [_own_record_blurb(r) for r in records]
            answer = "\n".join(lines)
            sources = [
                SearchResultItem(
                    text=line, score=1.0, source_collection="ip_records",
                    source_id=str(r.id), metadata={"ip_address": r.ip_address},
                )
                for r, line in zip(records, lines)
            ]
        else:
            answer = f"No IP record with a hostname matching \"{fragment}\" was found in this IPAM."
            sources = []

    elif fleet_formatters:
        # Deterministic, real, computed answer — same principle as
        # _server_status/_free_address_info: the model never states these
        # numbers itself, only genuinely fleet-wide facts computed live
        # via stats.py's own trusted aggregation, reused as-is.
        stats = await compute_dashboard_stats(db)
        digest = await db["dashboard_digests"].find_one({"_id": "latest"})
        answer = "\n".join(fmt(stats, digest) for fmt in fleet_formatters)
        sources = [SearchResultItem(
            text=answer, score=1.0, source_collection="fleet_stats",
            source_id="dashboard_stats", metadata={},
        )]

    else:
        if mentioned and _wants_free_addresses(effective_question):
            # Deterministic path, no LLM call at all: asked twice now for
            # a short LLM-written intro sentence over real free-address
            # data, and got it wrong both times in different ways (once a
            # false "ranging from X to Y" claim, once outright confused/
            # off-topic text) — a small quantized model at a tight token
            # budget just isn't reliable even for a heavily-constrained
            # one-sentence task. The count/list are the part that
            # actually matters here and are always correct either way;
            # building the sentence in code removes the failure mode
            # entirely and is also much faster (skips embed_text +
            # chat_completion — both genuinely slow on this CPU — for the
            # single most common question type).
            free_info = await _free_address_info(mentioned, ip_repo)
            answer = free_info.context_text if free_info else (
                f"Subnet {mentioned['cidr']} ({mentioned.get('name', '')})."
            )
            if free_info and free_info.free_addresses:
                sample = free_info.free_addresses[:30]
                more = len(free_info.free_addresses) - len(sample)
                answer += "\n\n" + ", ".join(sample) + (f", plus {more} more" if more > 0 else "")
            sources = [SearchResultItem(
                text=answer, score=1.0, source_collection="subnets",
                source_id=str(mentioned["_id"]), metadata={"cidr": mentioned["cidr"]},
            )]

        else:
            exact_blurb: Optional[str] = None
            exact_source: Optional[SearchResultItem] = None
            if mentioned:
                exact_blurb = _subnet_summary_blurb(mentioned)
                # score=1.0 marks this as a deterministic exact match, not
                # a semantic-similarity guess — shown as a source chip
                # either way.
                exact_source = SearchResultItem(
                    text=exact_blurb, score=1.0, source_collection="subnets",
                    source_id=str(mentioned["_id"]), metadata={"cidr": mentioned["cidr"]},
                )

            try:
                query_vector = await ai_service.embed_text(effective_question)
            except httpx.HTTPError as exc:
                raise _unavailable(exc) from exc

            # Raised 2026-09-23 after the host resize made prompt
            # processing ~30x faster (~1.1 → ~34 tok/s measured, see
            # ai_service.py) — extra context tokens no longer cost what
            # they used to, so this can now match /search's own default
            # top_k instead of being deliberately starved. Still one
            # fewer slot when an exact subnet was already resolved above,
            # to keep the total prompt size about the same.
            semantic_top_k = 6 if mentioned else 8
            matches = await _repo().search(query_vector, top_k=semantic_top_k)
            # Real reported bug: a question with nothing to do with
            # subnets ("how many users do I have", "check docker status")
            # still got 4 subnet CIDRs attached as "sources" — misleading,
            # since /search always returns its top-k *nearest* matches
            # with no relevance floor, and subnets are the only thing
            # ever embedded (see build_embeddings.py's scope note), so
            # ANY question gets *something* back. Measured live: truly
            # unrelated questions score ~0.48-0.54 against subnet blurbs;
            # a genuinely subnet-adjacent one scored 0.67+. Below this
            # floor, a match is noise, not a real answer — drop it from
            # both the shown sources and the model's context rather than
            # let low-relevance results masquerade as grounding.
            semantic_sources = [
                SearchResultItem(**m) for m in matches
                if m["score"] >= _SEMANTIC_RELEVANCE_FLOOR
                and not (exact_source and m["source_id"] == exact_source.source_id)
            ]

            sources = ([exact_source] if exact_source else []) + semantic_sources

            # For a genuinely open-ended question (no specific subnet
            # named), give the model real, current fleet context instead
            # of only whatever subnets happened to rank in semantic
            # search — this is what previously produced "I don't have
            # enough information" for anything not directly about one
            # subnet's own fields. Skipped when a subnet IS named, to
            # keep the prompt (and therefore the ~1.1 tok/s prompt-eval
            # cost) from growing for the already-well-served case.
            fleet_snapshot: Optional[str] = None
            if not mentioned:
                stats = await compute_dashboard_stats(db)
                digest = await db["dashboard_digests"].find_one({"_id": "latest"})
                snapshot_parts = [
                    f"Fleet totals: {stats['total_subnets']} subnets, "
                    f"{stats['total_ips']} IP records, {stats['total_vrfs']} VRFs.",
                ]
                if digest and digest.get("summary"):
                    snapshot_parts.append(f"Latest nightly anomaly digest: {digest['summary']}")
                fleet_snapshot = " ".join(snapshot_parts)

            context_blurbs = (
                ([exact_blurb] if exact_blurb else [])
                + ([fleet_snapshot] if fleet_snapshot else [])
                + [s.text for s in semantic_sources]
            )

            try:
                # effective_question (not the literal body.question) so a
                # resolved follow-up's carried-forward context reaches the
                # model too, not just the deterministic paths above.
                answer = await ai_service.chat_completion(effective_question, context_blurbs)
            except httpx.HTTPError as exc:
                raise _unavailable(exc) from exc

    logger.info("Assistant question from %s: %r", current_user.sub, body.question)

    # Persisted under the caller's own username (from the auth token, never
    # client input) — this is what makes history private per user and lets
    # it survive a page refresh/navigation instead of living only in React
    # state. Tagged with the user's current session — "New Conversation"
    # (see /session/new below) points that forward without deleting
    # anything, so both sides of the exchange are saved permanently even
    # once a "new" conversation starts. The literal body.question is what
    # gets saved (never effective_question) — history should show what
    # the user actually typed, not the internally-reconstructed version.
    await conversations.append(current_user.sub, session_id, "user", body.question)
    await conversations.append(
        current_user.sub, session_id, "assistant", answer,
        sources=[s.model_dump() for s in sources],
    )

    return AskResponse(answer=answer, sources=sources)


@router.get("/history", response_model=HistoryResponse)
async def history(
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> HistoryResponse:
    """This user's own current-session conversation, oldest first —
    scoped strictly by the authenticated token's username, so one user
    can never see another's chat history via this endpoint."""
    conversations = _conversations()
    session_id = await conversations.get_or_create_session(current_user.sub)
    docs = await conversations.list_for_session(current_user.sub, session_id)
    return HistoryResponse(
        session_id=session_id,
        messages=[
            HistoryMessage(
                role=d["role"], text=d["text"], sources=d.get("sources"),
                created_at=d["created_at"],
            )
            for d in docs
        ],
    )


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> SessionListResponse:
    """Every past conversation for this user — powers the "old
    conversations" sidebar. Scoped strictly by the authenticated token's
    username, same as every other endpoint here."""
    conversations = _conversations()
    current_session_id = await conversations.get_or_create_session(current_user.sub)
    sessions = await conversations.list_sessions(current_user.sub)
    return SessionListResponse(sessions=[
        SessionSummary(
            session_id=s["_id"], preview=s["preview"],
            last_message_at=s["last_message_at"], message_count=s["message_count"],
            is_current=(s["_id"] == current_session_id),
        )
        for s in sessions
    ])


@router.post("/session/switch", response_model=HistoryResponse)
async def switch_session(
    body: SwitchSessionRequest,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> HistoryResponse:
    """Resumes an old conversation — makes it the current session (new
    messages append to it going forward) and returns its messages. Only
    works for a session that actually belongs to this user; every query
    here is scoped by username, so there's no way to resume someone
    else's conversation even by guessing a session_id."""
    conversations = _conversations()
    if not await conversations.session_belongs_to_user(current_user.sub, body.session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.",
        )
    await conversations.switch_session(current_user.sub, body.session_id)
    docs = await conversations.list_for_session(current_user.sub, body.session_id)
    return HistoryResponse(
        session_id=body.session_id,
        messages=[
            HistoryMessage(
                role=d["role"], text=d["text"], sources=d.get("sources"),
                created_at=d["created_at"],
            )
            for d in docs
        ],
    )


@router.post("/session/new", status_code=status.HTTP_204_NO_CONTENT)
async def new_session(
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> None:
    """Manually ends the current conversation and starts a new one —
    this does NOT delete anything. Prior messages stay in the database
    under the old session_id (the user asked for chat history to be
    saved, not lost) and simply stop showing up in /history once the
    pointer moves forward."""
    await _conversations().start_new_session(current_user.sub)


@router.delete("/session/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    current_user: UserInToken = Depends(_VIEWER_PLUS),
) -> None:
    """Permanently deletes a conversation — the explicit, user-triggered
    exception to "history is never deleted automatically". Only works
    for a session that actually belongs to this user. If it was the
    current session, a fresh one is started automatically (same as
    /session/new) so the user isn't left pointed at a conversation that
    no longer exists."""
    conversations = _conversations()
    if not await conversations.session_belongs_to_user(current_user.sub, session_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.",
        )
    was_current = await conversations.is_current_session(current_user.sub, session_id)
    await conversations.delete_session(current_user.sub, session_id)
    if was_current:
        await conversations.start_new_session(current_user.sub)

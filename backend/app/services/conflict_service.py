import ipaddress
import logging
from datetime import datetime, timezone

from app.schemas.conflicts import ConflictItem, ConflictReport

logger = logging.getLogger(__name__)


class ConflictService:
    """Scans IP records for DNS conflicts: forward mismatches, PTR mismatches,
    missing forward records, and duplicate hostnames within a subnet."""

    @staticmethod
    def scan_subnet(subnet_id: str, ip_records: list) -> ConflictReport:
        try:
            import dns.resolver
            import dns.reversename
            import dns.exception
        except ImportError:
            logger.error("dnspython is not installed. Install it with: pip install dnspython>=2.6")
            return ConflictReport(
                subnet_id=subnet_id,
                scanned_at=datetime.now(timezone.utc),
                total_checked=0,
                conflicts=[],
            )

        scanned_at = datetime.now(timezone.utc)
        conflicts: list[ConflictItem] = []
        total_checked = 0

        # Build hostname → list of ip_addresses mapping for duplicate detection
        hostname_map: dict[str, list[str]] = {}
        for record in ip_records:
            hn = record.hostname
            if hn:
                hostname_lower = hn.lower()
                if hostname_lower not in hostname_map:
                    hostname_map[hostname_lower] = []
                hostname_map[hostname_lower].append(record.ip_address)

        # Flag duplicates first
        duplicate_hostnames: set[str] = {
            hn for hn, ips in hostname_map.items() if len(ips) > 1
        }
        for hn_lower, ips in hostname_map.items():
            if hn_lower in duplicate_hostnames:
                for ip in ips:
                    conflicts.append(ConflictItem(
                        ip_address=ip,
                        hostname=hn_lower,
                        conflict_type="DUPLICATE_HOSTNAME",
                        detail=f"Hostname '{hn_lower}' is assigned to {len(ips)} IP records: {', '.join(ips)}",
                    ))

        # Per-record DNS checks
        for record in ip_records:
            if not record.hostname:
                continue

            total_checked += 1
            hostname = record.hostname.lower()
            ip = record.ip_address

            # Skip duplicate hostnames (already reported above)
            if hostname in duplicate_hostnames:
                continue

            # Forward lookup
            resolved_ips: list[str] = []
            try:
                rtype = "AAAA" if _is_ipv6(ip) else "A"
                answers = dns.resolver.resolve(hostname, rtype)
                resolved_ips = [str(r) for r in answers]
            except dns.resolver.NXDOMAIN:
                conflicts.append(ConflictItem(
                    ip_address=ip,
                    hostname=hostname,
                    conflict_type="NO_FORWARD",
                    detail=f"Hostname '{hostname}' does not resolve (NXDOMAIN)",
                ))
                continue
            except dns.exception.DNSException as exc:
                conflicts.append(ConflictItem(
                    ip_address=ip,
                    hostname=hostname,
                    conflict_type="NO_FORWARD",
                    detail=f"Hostname '{hostname}' could not be resolved: {exc}",
                ))
                continue

            if ip not in resolved_ips:
                conflicts.append(ConflictItem(
                    ip_address=ip,
                    hostname=hostname,
                    conflict_type="FORWARD_MISMATCH",
                    detail=(
                        f"'{hostname}' resolves to {resolved_ips} "
                        f"but record has {ip}"
                    ),
                ))

            # PTR lookup
            try:
                ptr_name = dns.reversename.from_address(ip)
                ptr_answers = dns.resolver.resolve(ptr_name, "PTR")
                ptr_hosts = [str(r).rstrip(".").lower() for r in ptr_answers]
                if hostname not in ptr_hosts and (hostname + ".") not in ptr_hosts:
                    conflicts.append(ConflictItem(
                        ip_address=ip,
                        hostname=hostname,
                        conflict_type="PTR_MISMATCH",
                        detail=(
                            f"PTR for {ip} returns {ptr_hosts} "
                            f"but expected '{hostname}'"
                        ),
                    ))
            except dns.exception.DNSException:
                # PTR missing is not necessarily a conflict — skip silently
                pass

        return ConflictReport(
            subnet_id=subnet_id,
            scanned_at=scanned_at,
            total_checked=total_checked,
            conflicts=conflicts,
        )


def _is_ipv6(ip: str) -> bool:
    try:
        return isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address)
    except ValueError:
        return False

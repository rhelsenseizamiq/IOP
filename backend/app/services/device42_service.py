import logging
from typing import Optional

import httpx

from app.schemas.device42 import Device42IP

logger = logging.getLogger(__name__)

_OS_HINT_MAP = {
    "linux": "Linux",
    "windows": "Windows",
    "darwin": "macOS",
    "mac": "macOS",
    "aix": "AIX",
    "rhel": "Linux",
    "centos": "Linux",
    "ubuntu": "Linux",
    "debian": "Linux",
    "redhat": "Linux",
    "suse": "Linux",
    "openshift": "OpenShift",
}


def _map_os(os_name: Optional[str]) -> str:
    if not os_name:
        return "Unknown"
    lc = os_name.lower()
    for fragment, os_type in _OS_HINT_MAP.items():
        if fragment in lc:
            return os_type
    return "Unknown"


class Device42Service:
    """Fetches IP address and device data from Device42 REST API."""

    @staticmethod
    async def discover(
        host: str,
        username: str,
        password: str,
        verify_ssl: bool = False,
        limit: int = 2000,
    ) -> list[Device42IP]:
        base = host if host.startswith("http") else f"https://{host}"
        results: list[Device42IP] = []

        async with httpx.AsyncClient(
            auth=(username, password),
            verify=verify_ssl,
            timeout=30.0,
            follow_redirects=True,
        ) as client:
            # First pass: collect device OS info by device name
            device_os: dict[str, str] = {}
            try:
                dev_resp = await client.get(
                    f"{base}/api/1.0/devices/",
                    params={"limit": 500, "include_cols": "name,os"},
                )
                dev_resp.raise_for_status()
                for dev in dev_resp.json().get("Devices", []):
                    name = dev.get("name", "")
                    os_name = dev.get("os", "")
                    if name:
                        device_os[name] = _map_os(os_name)
            except Exception as exc:
                logger.warning("Could not fetch Device42 device list: %s", exc)

            # Main pass: fetch IPs with pagination
            offset = 0
            batch = min(limit, 500)

            while True:
                try:
                    resp = await client.get(
                        f"{base}/api/1.0/ips/",
                        params={
                            "limit": batch,
                            "offset": offset,
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                except httpx.HTTPStatusError as exc:
                    raise RuntimeError(
                        f"Device42 API returned {exc.response.status_code}: {exc.response.text[:200]}"
                    ) from exc
                except httpx.HTTPError as exc:
                    raise RuntimeError(f"Device42 connection error: {exc}") from exc
                except Exception as exc:
                    raise RuntimeError(f"Device42 unexpected error: {exc}") from exc

                ip_list = data.get("ips", [])
                if not ip_list:
                    break

                for entry in ip_list:
                    ip_addr = entry.get("ip", "").strip()
                    if not ip_addr:
                        continue

                    device_name = entry.get("device", "") or ""
                    subnet = entry.get("subnet", "") or ""
                    available = entry.get("available", "no") == "yes"
                    mac = entry.get("mac_address", "") or ""
                    label = entry.get("label", "") or ""

                    results.append(Device42IP(
                        ip_address=ip_addr,
                        hostname=device_name or None,
                        device_name=device_name or None,
                        os_type=device_os.get(device_name, "Unknown"),
                        subnet=subnet or None,
                        mac_address=mac or None,
                        label=label or None,
                        available=available,
                    ))

                total = data.get("total_count", 0)
                offset += len(ip_list)
                if offset >= total or offset >= limit:
                    break

        logger.info("Device42 discover: %d IPs fetched from %s", len(results), host)
        return results

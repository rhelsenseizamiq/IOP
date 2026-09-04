import asyncio
import ipaddress
import logging
from typing import Optional

from app.schemas.integrations import VsphereIPInfo, VsphereVM

logger = logging.getLogger(__name__)

_OS_HINT_MAP = {
    "linux": "Linux",
    "windows": "Windows",
    "darwin": "macOS",
    "aix": "AIX",
    "rhel": "Linux",
    "centos": "Linux",
    "ubuntu": "Linux",
    "debian": "Linux",
    "suse": "Linux",
    "coreos": "OpenShift",
    "photon": "Linux",
}


def _guess_os_type(guest_full_name: Optional[str]) -> str:
    if not guest_full_name:
        return "Unknown"
    lc = guest_full_name.lower()
    for fragment, os_type in _OS_HINT_MAP.items():
        if fragment in lc:
            return os_type
    return "Unknown"


# Guest hostnames VMware Tools reports when the OS was never actually
# customized after clone/template deploy (no sysprep/cloud-init hostname
# step ran) — not a real DNS name, just the OS's unconfigured default.
# Trusting these blindly overwrote real, human-assigned VM names with the
# literal string "localhost.localdomain" on several records. Shared here
# so both the nightly sync (vcenter_sync.py) and the real-time Check
# Availability lookup below apply the exact same guard.
PLACEHOLDER_HOSTNAMES = {"localhost", "localhost.localdomain", "localhost.local", ""}


def is_real_hostname(name: Optional[str]) -> bool:
    return bool(name) and name.strip().lower() not in PLACEHOLDER_HOSTNAMES


def _ip_version(addr: str) -> int:
    try:
        return ipaddress.ip_address(addr).version
    except ValueError:
        return 4


class VsphereService:
    """Discovers VMs from a vCenter server using pyVmomi."""

    @staticmethod
    def discover(
        host: str,
        username: str,
        password: str,
        datacenter: Optional[str],
        verify_ssl: bool,
    ) -> list[VsphereVM]:
        try:
            import ssl
            from pyVmomi import vim
            from pyVim.connect import SmartConnect, Disconnect

            ssl_context = ssl.create_default_context()
            if not verify_ssl:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            si = SmartConnect(
                host=host,
                user=username,
                pwd=password,
                sslContext=ssl_context,
            )
        except ImportError:
            logger.error("pyVmomi is not installed. Install it with: pip install pyVmomi>=8.0")
            raise RuntimeError("pyVmomi package is not installed")
        except Exception as exc:
            logger.error("Failed to connect to vCenter %s: %s", host, exc)
            raise RuntimeError(f"Cannot connect to vCenter: {exc}") from exc

        try:
            content = si.RetrieveContent()
            vms: list[VsphereVM] = []

            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.VirtualMachine], True
            )

            for vm in container.view:
                try:
                    summary = vm.summary
                    config = summary.config
                    guest = summary.guest

                    # Gather IP addresses from all NICs
                    ip_infos: list[VsphereIPInfo] = []
                    if vm.guest and vm.guest.net:
                        for nic in vm.guest.net:
                            if nic.ipAddress:
                                for addr in nic.ipAddress:
                                    try:
                                        ip_infos.append(VsphereIPInfo(
                                            address=addr,
                                            version=_ip_version(addr),
                                        ))
                                    except Exception:
                                        pass
                    elif guest and guest.ipAddress:
                        try:
                            ip_infos.append(VsphereIPInfo(
                                address=guest.ipAddress,
                                version=_ip_version(guest.ipAddress),
                            ))
                        except Exception:
                            pass

                    # Datacenter / cluster
                    dc_name: Optional[str] = None
                    cluster_name: Optional[str] = None
                    if datacenter:
                        dc_name = datacenter
                    try:
                        parent = vm.parent
                        while parent:
                            if isinstance(parent, vim.ClusterComputeResource):
                                cluster_name = parent.name
                            if isinstance(parent, vim.Datacenter):
                                dc_name = parent.name
                                break
                            parent = getattr(parent, "parent", None)
                    except Exception:
                        pass

                    power_state = "on" if summary.runtime.powerState == vim.VirtualMachinePowerState.poweredOn else "off"

                    vms.append(VsphereVM(
                        name=config.name if config else vm.name,
                        guest_hostname=guest.hostName if guest else None,
                        ip_addresses=ip_infos,
                        os_type=_guess_os_type(config.guestFullName if config else None),
                        power_state=power_state,
                        datacenter=dc_name,
                        cluster=cluster_name,
                    ))
                except Exception as vm_exc:
                    logger.warning("Skipped VM due to error: %s", vm_exc)
                    continue

            container.Destroy()
            return vms

        finally:
            try:
                from pyVim.connect import Disconnect
                Disconnect(si)
            except Exception:
                pass

    @staticmethod
    def _lookup_ip_sync(
        host: str, username: str, password: str, target_ip: str, verify_ssl: bool,
    ) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
        """Blocking single-IP lookup via vCenter's SearchIndex.FindAllByIp —
        an indexed point lookup, not a full VM inventory walk like
        discover(), so it stays fast even against a vCenter with thousands
        of VMs. Returns (found, guest_hostname, os_type, power_state).
        power_state is "on" or "off" — lets a caller tell "VM exists but is
        shut down" apart from "not found at all", instead of collapsing
        both into a bare False.

        Does a raw-socket preflight before ever calling SmartConnect: an
        asyncio-level timeout around this whole method can't actually cut
        it short once SmartConnect's own blocking connect is underway
        (cancelling a thread that's already running a synchronous socket
        call is a no-op — the OS-level TCP connect timeout, ~2 minutes,
        still has to elapse). A short, explicit connect() here is what
        actually bounds the wait when a vCenter is unreachable (firewalled,
        down, wrong host) — the same class of problem PaloAlto's DR hosts
        hit, fixed there with httpx's connect-timeout split."""
        import socket
        import ssl
        from pyVmomi import vim
        from pyVim.connect import SmartConnect, Disconnect

        try:
            with socket.create_connection((host, 443), timeout=5):
                pass
        except OSError as exc:
            raise RuntimeError(f"vCenter {host} is unreachable: {exc}") from exc

        ssl_context = ssl.create_default_context()
        if not verify_ssl:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        si = SmartConnect(host=host, user=username, pwd=password, sslContext=ssl_context)
        try:
            content = si.RetrieveContent()
            vms = content.searchIndex.FindAllByIp(datacenter=None, ip=target_ip, vmSearch=True)
            if not vms:
                return False, None, None, None

            vm = vms[0]
            summary = vm.summary
            config = summary.config
            guest = summary.guest
            guest_hostname = guest.hostName if guest else None
            hostname = guest_hostname if is_real_hostname(guest_hostname) else (
                config.name if config else vm.name
            )
            os_type = _guess_os_type(config.guestFullName if config else None)
            power_state = (
                "on" if summary.runtime.powerState == vim.VirtualMachinePowerState.poweredOn else "off"
            )
            return True, hostname, (os_type if os_type != "Unknown" else None), power_state
        finally:
            try:
                Disconnect(si)
            except Exception:
                pass

    # Backstop only — the real fix is the raw-socket preflight inside
    # _lookup_ip_sync above. This bounds anything unexpectedly slow AFTER
    # that preflight passes (e.g. a sluggish SOAP response), but it can't
    # cut off the preflight's own blocking connect() once it's running —
    # cancelling a thread mid-syscall is a no-op — hence the preflight
    # needing its own explicit timeout rather than relying on this alone.
    _CONNECT_TIMEOUT_SECONDS = 20.0

    @staticmethod
    async def lookup_ip(
        host: str, username: str, password: str, target_ip: str, verify_ssl: bool = False,
    ) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
        """Async wrapper for _lookup_ip_sync — pyVmomi has no async API, so
        the blocking SmartConnect+search runs in a worker thread instead of
        stalling the event loop for every other request during a Check
        Availability call."""
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(
                    VsphereService._lookup_ip_sync, host, username, password, target_ip, verify_ssl,
                ),
                timeout=VsphereService._CONNECT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                f"vCenter {host} did not respond within {VsphereService._CONNECT_TIMEOUT_SECONDS:.0f}s"
            ) from exc

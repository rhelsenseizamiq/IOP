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

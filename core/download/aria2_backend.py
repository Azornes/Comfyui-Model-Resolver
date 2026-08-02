"""Low-level aria2 helpers used by the downloader facade."""

import importlib
import socket
from typing import Any, Dict, Optional

from ..log_system import create_module_logger

log = create_module_logger("core.downloader")


class Aria2Error(RuntimeError):
    """Raised when the aria2 backend cannot start or process a request."""


def _downloader_module():
    """Return the facade module so existing dependency patches remain effective."""
    return importlib.import_module("core.downloader")


def try_certifi_ca_path() -> str:
    """Return certifi's CA bundle path when it is available."""
    facade = _downloader_module()
    try:
        import certifi  # type: ignore

        path = certifi.where()
        return path if path and facade.os.path.isfile(path) else ""
    except Exception:
        return ""


def resolve_aria2c_executable(settings: Optional[Dict[str, Any]] = None) -> str:
    """Resolve aria2c while restricting explicit paths to the managed install."""
    facade = _downloader_module()
    active_settings = (
        settings if isinstance(settings, dict) else facade.load_settings()
    )
    configured = str(active_settings.get("aria2c_path") or "").strip()
    candidate = facade.os.path.expandvars(
        facade.os.path.expanduser(configured or "aria2c")
    )
    expected_names = {"aria2c", "aria2c.exe"}
    candidate_name = facade.get_filename_from_path(candidate).lower()
    has_path_component = bool(
        facade.os.path.isabs(candidate)
        or facade.os.path.dirname(candidate)
        or "/" in candidate
        or "\\" in candidate
    )

    if has_path_component:
        if (
            candidate_name in expected_names
            and facade.os.path.isfile(candidate)
            and facade.is_path_within(candidate, facade.MANAGED_ARIA2_ROOT)
        ):
            return facade.os.path.realpath(facade.os.path.abspath(candidate))
        raise Aria2Error(
            "Custom aria2c paths are restricted to the managed Model Resolver install. "
            "Use the built-in aria2 installer or place aria2c on PATH."
        )

    if candidate_name in expected_names:
        resolved = facade.shutil.which(candidate)
        if resolved and facade.get_filename_from_path(resolved).lower() in expected_names:
            return facade.os.path.realpath(facade.os.path.abspath(resolved))

    raise Aria2Error(
        "aria2c executable was not found. Use the built-in installer or place aria2c on PATH."
    )


def find_free_port() -> int:
    """Return an unused local TCP port for the aria2 RPC endpoint."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def parse_aria2_int(value: Any) -> int:
    """Parse an aria2 numeric field without propagating malformed values."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def resolve_aria2_completed_path(status: Dict[str, Any], default_path: str) -> str:
    """Use aria2's completed file path when it reports one."""
    files = status.get("files")
    if isinstance(files, list) and files:
        first = files[0]
        if isinstance(first, dict):
            candidate = first.get("path")
            if isinstance(candidate, str) and candidate:
                return candidate
    return default_path


def delete_partial_download_files(dest_path: str) -> None:
    """Delete an incomplete model and its aria2 control sidecar."""
    facade = _downloader_module()
    for path in (dest_path, f"{dest_path}.aria2"):
        try:
            if path and facade.os.path.exists(path):
                facade.os.remove(path)
        except Exception as exc:
            log.warning(f"Could not delete incomplete download file {path}: {exc}")


def delete_python_partial_download_file(partial_path: str) -> None:
    """Remove a partial Python download without touching the final model path."""
    facade = _downloader_module()
    try:
        if partial_path and facade.os.path.exists(partial_path):
            facade.os.remove(partial_path)
    except Exception as exc:
        log.warning(
            f"Could not delete incomplete Python download file {partial_path}: {exc}"
        )


def delete_xet_partial_file(partial_path: str, attempts: int = 5) -> bool:
    """Delete a stopped Xet partial file, retrying while Windows releases it."""
    facade = _downloader_module()
    attempts = max(1, int(attempts or 1))
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            if not facade.os.path.exists(partial_path):
                return True
            facade.os.remove(partial_path)
            return True
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                facade.time.sleep(0.25)

    log.warning(f"Could not delete incomplete Xet file {partial_path}: {last_error}")
    return False


def aria2_action_error_is_ok(status: str, message: str) -> bool:
    """Recognize idempotent aria2 pause/resume errors."""
    lowered = str(message or "").lower()
    if status == "paused":
        return "already paused" in lowered or "is paused" in lowered
    if status == "downloading":
        return "not paused" in lowered or "has not been paused" in lowered
    return False

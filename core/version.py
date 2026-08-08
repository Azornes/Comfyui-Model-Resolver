"""Project version discovery and update checks."""

import os
import re
import threading
import time
from typing import Any, Callable

from .log_system import create_module_logger

PROJECT_VERSION_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "pyproject.toml",
)
PROJECT_GITHUB_URL = "https://github.com/Azornes/Comfyui-Model-Resolver"
PROJECT_GITHUB_PYPROJECT_URL = (
    "https://raw.githubusercontent.com/Azornes/Comfyui-Model-Resolver/main/pyproject.toml"
)
PROJECT_REGISTRY_NODE_ID = "Comfyui-Model-Resolver"
PROJECT_REGISTRY_INSTALL_URL = (
    f"https://api.comfy.org/nodes/{PROJECT_REGISTRY_NODE_ID}/install"
)
PROJECT_VERSION_CACHE_TTL_SECONDS = 6 * 60 * 60
PROJECT_VERSION_REQUEST_TIMEOUT_SECONDS = 5
PROJECT_VERSION_MAX_ATTEMPTS = 3
_project_version_cache = {"checked_at": 0.0, "latest_version": None}
_project_version_cache_lock = threading.Lock()
log = create_module_logger(__name__)


def _extract_project_version(text: str) -> str:
    """Extract the package version from a pyproject.toml document."""
    match = re.search(r"(?m)^\s*version\s*=\s*[\"']([^\"']+)[\"']\s*$", str(text or ""))
    return match.group(1).strip() if match else ""


def _get_local_project_version() -> str:
    try:
        with open(PROJECT_VERSION_FILE, encoding="utf-8") as version_file:
            return _extract_project_version(version_file.read()) or "unknown"
    except (OSError, UnicodeError):
        return "unknown"


def _version_sort_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", str(version or "")))


def _fetch_remote_project_version(
    request_source_response: Any,
    *,
    url: str,
    log_name: str,
    log_prefix: str,
    max_attempts: int,
    parse_response: Callable[[Any], str],
    invalid_response_message: str,
) -> str:
    """Fetch and parse a remote project version with shared response handling."""
    for attempt in range(1, max_attempts + 1):
        response = None
        attempt_suffix = (
            f" attempt {attempt}/{max_attempts}" if max_attempts > 1 else ""
        )
        try:
            response = request_source_response(
                url,
                timeout=PROJECT_VERSION_REQUEST_TIMEOUT_SECONDS,
                max_attempts=1,
                log_name=log_name,
            )
            if response is None:
                log.warning(f"{log_prefix}{attempt_suffix} failed: no response")
                continue

            status_code = getattr(response, "status_code", None)
            if status_code != 200:
                log.warning(
                    f"{log_prefix}{attempt_suffix} failed: HTTP {status_code}"
                )
                continue

            version = str(parse_response(response) or "").strip()
            if version:
                success_suffix = (
                    f" succeeded on attempt {attempt}/{max_attempts}: v{version}"
                    if max_attempts > 1
                    else f" succeeded: v{version}"
                )
                log.debug(f"{log_prefix}{success_suffix}")
                return version

            log.warning(
                f"{log_prefix}{attempt_suffix} failed: {invalid_response_message}"
            )
        except Exception as exc:
            log.warning(
                f"{log_prefix}{attempt_suffix} failed: {exc}"
            )
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

    return ""


def _parse_registry_project_version(response: Any) -> str:
    payload = response.json()
    version = payload.get("version") if isinstance(payload, dict) else ""
    return str(version or "").strip()


def _fetch_github_project_version(request_source_response: Any) -> str:
    """Fetch the published version from GitHub, retrying every failed attempt."""
    return _fetch_remote_project_version(
        request_source_response,
        url=PROJECT_GITHUB_PYPROJECT_URL,
        log_name="GitHub version check",
        log_prefix="GitHub version check",
        max_attempts=PROJECT_VERSION_MAX_ATTEMPTS,
        parse_response=lambda response: _extract_project_version(response.text),
        invalid_response_message="response did not contain a valid version",
    )


def _fetch_registry_project_version(request_source_response: Any) -> str:
    """Fetch the latest installable version from the Comfy Registry fallback."""
    return _fetch_remote_project_version(
        request_source_response,
        url=PROJECT_REGISTRY_INSTALL_URL,
        log_name="Comfy Registry install version check",
        log_prefix="Comfy Registry install version check",
        max_attempts=1,
        parse_response=_parse_registry_project_version,
        invalid_response_message="response did not contain version",
    )


def _get_project_version_info() -> dict[str, Any]:
    """Return the installed version and the latest published project version."""
    current_version = _get_local_project_version()
    now = time.monotonic()

    with _project_version_cache_lock:
        cached_at = float(_project_version_cache.get("checked_at") or 0.0)
        latest_version = _project_version_cache.get("latest_version")
        cache_is_fresh = bool(latest_version) and now - cached_at < PROJECT_VERSION_CACHE_TTL_SECONDS

    if not cache_is_fresh:
        latest_version = None
        try:
            from .network_utils import request_source_response

            latest_version = _fetch_github_project_version(request_source_response)
            if not latest_version:
                log.warning(
                    f"GitHub version check failed after {PROJECT_VERSION_MAX_ATTEMPTS} attempts; "
                    "trying Comfy Registry fallback"
                )
                latest_version = _fetch_registry_project_version(request_source_response)
        except Exception:
            log.exception("Project version checks failed unexpectedly")
            latest_version = None

        if latest_version:
            with _project_version_cache_lock:
                _project_version_cache.update(
                    {
                        "checked_at": now,
                        "latest_version": latest_version,
                    }
                )
        else:
            log.warning("Could not determine the latest project version; result was not cached")

    current_key = _version_sort_key(current_version)
    latest_key = _version_sort_key(latest_version or "")
    if not latest_version or not latest_key:
        status = "unavailable"
    elif current_key and latest_key > current_key:
        status = "update_available"
    else:
        status = "current"

    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "status": status,
        "github_url": PROJECT_GITHUB_URL,
    }

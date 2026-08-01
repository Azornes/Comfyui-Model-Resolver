"""Project version discovery and update checks."""

import os
import re
import threading
import time
from typing import Any

PROJECT_VERSION_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "pyproject.toml",
)
PROJECT_GITHUB_URL = "https://github.com/Azornes/Comfyui-Model-Resolver"
PROJECT_GITHUB_PYPROJECT_URL = (
    "https://raw.githubusercontent.com/Azornes/Comfyui-Model-Resolver/main/pyproject.toml"
)
PROJECT_VERSION_CACHE_TTL_SECONDS = 6 * 60 * 60
_project_version_cache = {"checked_at": 0.0, "latest_version": None}
_project_version_cache_lock = threading.Lock()


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


def _get_project_version_info() -> dict[str, Any]:
    """Return the installed version and the version currently published on GitHub."""
    current_version = _get_local_project_version()
    now = time.monotonic()

    with _project_version_cache_lock:
        cached_at = float(_project_version_cache.get("checked_at") or 0.0)
        latest_version = _project_version_cache.get("latest_version")
        cache_is_fresh = now - cached_at < PROJECT_VERSION_CACHE_TTL_SECONDS

    if not cache_is_fresh:
        latest_version = None
        try:
            from .network_utils import request_source_response

            response = request_source_response(
                PROJECT_GITHUB_PYPROJECT_URL,
                timeout=5,
                max_attempts=1,
                log_name="GitHub version check",
            )
            try:
                if response is not None and response.status_code == 200:
                    latest_version = _extract_project_version(response.text)
            finally:
                if response is not None:
                    response.close()
        except Exception:
            latest_version = None

        with _project_version_cache_lock:
            _project_version_cache.update(
                {
                    "checked_at": now,
                    "latest_version": latest_version or None,
                }
            )

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

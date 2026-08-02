"""Small configuration helpers used by download orchestration."""

import importlib
import uuid
from typing import Any, Dict, Optional


def _downloader_module():
    """Return the facade so runtime patches remain effective."""
    return importlib.import_module("core.downloader")


def generate_download_id() -> str:
    """Generate a unique download ID."""
    return str(uuid.uuid4())[:8]


def download_backend_from_settings(
    settings: Optional[Dict[str, Any]] = None,
) -> str:
    """Return the normalized backend selected in the active settings."""
    facade = _downloader_module()
    active_settings = settings if isinstance(settings, dict) else facade.load_settings()
    return facade.normalize_download_backend(active_settings.get("download_backend"))

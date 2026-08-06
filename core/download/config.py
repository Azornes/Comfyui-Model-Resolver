"""Small configuration helpers used by download orchestration."""

import uuid
from typing import Any, Dict, Optional

from .dependencies import require_download_dependencies


def generate_download_id() -> str:
    """Generate a unique download ID."""
    return str(uuid.uuid4())[:8]


def download_backend_from_settings(
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> str:
    """Return the normalized backend selected in the active settings."""
    facade = require_download_dependencies(dependencies, "download configuration")
    active_settings = settings if isinstance(settings, dict) else facade.load_settings()
    return facade.normalize_download_backend(active_settings.get("download_backend"))

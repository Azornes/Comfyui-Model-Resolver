"""Shared helpers for metadata payload construction and aggregation."""

import time
from typing import Any, Dict, Iterable, Optional

from .path_utils import (
    MODEL_RESOLVER_METADATA_SCHEMA,
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
    get_filename_from_path,
    normalize_metadata_file_path,
)


def build_sidecar_file_identity(
    model_path: str,
    *,
    model_name: str,
    size: int,
    modified_at: Optional[float] = None,
    last_checked_at: Optional[float] = None,
) -> Dict[str, Any]:
    """Build the common Model Resolver sidecar file identity fields."""
    filename = get_filename_from_path(model_path)
    file_name = filename.rsplit(".", 1)[0] if "." in filename else filename
    return {
        "schema": MODEL_RESOLVER_METADATA_SCHEMA,
        "schema_version": MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
        "managed_by": MODEL_RESOLVER_METADATA_SCHEMA,
        "file_name": file_name,
        "filename": filename,
        "model_name": model_name,
        "file_path": normalize_metadata_file_path(model_path),
        "size": size,
        "modified": time.time() if modified_at is None else modified_at,
        "last_checked_at": (
            time.time() if last_checked_at is None else last_checked_at
        ),
    }


def merge_counted_payload(
    target: Dict[str, Any],
    source: Dict[str, Any],
    *,
    numeric_keys: Iterable[str],
    list_keys: Iterable[str],
) -> None:
    """Merge numeric counters and ordered list fields into one result payload."""
    for key in numeric_keys:
        target[key] += int(source.get(key) or 0)
    for key in list_keys:
        target[key].extend(source.get(key) or [])

"""Shared helpers for aggregating metadata maintenance results."""

from typing import Any, Dict, Iterable


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

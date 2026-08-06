"""Shared worker-count resolution for local parallel operations."""

import os
from typing import Any, Optional, Tuple


def _coerce_positive_int(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def resolve_worker_count(
    total_items: int,
    requested_workers: Optional[int] = None,
    *,
    default_worker_multiplier: int = 1,
    default_worker_limit: int = 64,
    cpu_count_fallback: int = 1,
    minimum_workers: int = 1,
    maximum_workers: int = 64,
    empty_total_workers: Optional[int] = None,
) -> Tuple[int, int]:
    """Resolve a bounded worker count and return it with the detected CPU count."""
    cpu_count = os.cpu_count() or cpu_count_fallback
    requested = _coerce_positive_int(requested_workers)
    if requested:
        workers = requested
    else:
        workers = min(
            default_worker_limit,
            cpu_count * default_worker_multiplier,
        )

    workers = max(minimum_workers, min(maximum_workers, workers))
    if total_items > 0:
        workers = min(total_items, workers)
    elif empty_total_workers is not None:
        workers = min(empty_total_workers, workers)
    return workers, cpu_count

"""Shared helpers for enriching local model matches found by SHA-256."""

from typing import Any, Callable, Dict, List, Optional

SearchLocalMatchesByHash = Callable[..., List[Dict[str, Any]]]


def collect_local_hash_matches_for_result(
    sha256: str,
    *,
    search_local_matches_by_hash: SearchLocalMatchesByHash,
    category: Optional[str] = None,
    max_matches: int = 20,
    force_rescan: bool = False,
    source: str = "download_source",
    filename: str = "",
) -> List[Dict[str, Any]]:
    """Find local matches and add the shared hash-lookup result fields."""
    if not sha256:
        return []

    matches = search_local_matches_by_hash(
        sha256,
        category=category,
        max_matches=max_matches,
        force_rescan=force_rescan,
    )
    return [
        {
            **match,
            "hash_lookup_source": source,
            "hash_lookup_filename": filename,
            "hash_lookup_sha256": sha256,
        }
        for match in matches
    ]

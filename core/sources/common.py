"""
Common utilities for external model metadata sources.
"""

from typing import Any, Callable, Dict, List, Optional, Tuple


def is_remote_link_marked_dead(item: Any) -> bool:
    """Return whether remote metadata marks a link as unavailable."""
    if not isinstance(item, dict):
        return False
    status = str(item.get("status") or "").lower()
    return bool(
        item.get("deletedAt")
        or item.get("deleted_at")
        or item.get("is_dead")
        or item.get("isDead")
        or item.get("likelyDead")
        or item.get("likely_dead")
        or item.get("dead")
        or status in {"dead", "deleted", "unavailable", "missing"}
    )


def collect_download_urls(
    item: Dict[str, Any],
    *,
    model_file_predicate: Callable[[str, str], bool],
    expected_filename: str = "",
    url_normalizer: Optional[Callable[[Any], Optional[str]]] = None,
    include_download_urls: bool = False,
    skip_dead_item: bool = False,
    download_url_keys: Tuple[str, ...] = ("downloadUrl",),
) -> List[str]:
    """Collect valid, ordered, and deduplicated model download URLs."""
    if not isinstance(item, dict):
        return []
    if skip_dead_item and is_remote_link_marked_dead(item):
        return []

    def normalize_url(value: Any) -> Optional[str]:
        normalized = (
            url_normalizer(value)
            if url_normalizer is not None
            else str(value or "").strip()
        )
        return normalized or None

    expected = item.get("filename") or expected_filename
    urls: List[str] = []
    dead_urls = set()
    mirrors = item.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        url = normalize_url(mirror.get("url"))
        if is_remote_link_marked_dead(mirror):
            if url and url.startswith(("http://", "https://")):
                dead_urls.add(url)
            continue
        mirror_filename = mirror.get("filename") or mirror.get("name") or expected
        if url and model_file_predicate(url, mirror_filename) and url not in urls:
            urls.append(url)

    if include_download_urls:
        raw_urls = item.get("download_urls") or []
        if not isinstance(raw_urls, list):
            raw_urls = [raw_urls]
        for raw_url in raw_urls:
            url = normalize_url(raw_url)
            if (
                url
                and url not in dead_urls
                and model_file_predicate(url, expected)
                and url not in urls
            ):
                urls.append(url)

    if not is_remote_link_marked_dead(item):
        for key in download_url_keys:
            url = normalize_url(item.get(key))
            if (
                url
                and url not in dead_urls
                and model_file_predicate(url, expected)
                and url not in urls
            ):
                urls.append(url)

    return urls

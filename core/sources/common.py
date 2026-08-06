"""
Common utilities for external model metadata sources.
"""

from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from ..type_utils import extract_file_sha256, extract_file_size


def resolve_file_size(
    file_info: Dict[str, Any],
    candidate_urls: Iterable[str],
    *,
    probe: Callable[[str], Optional[int]],
) -> Optional[int]:
    """Resolve a model file size from metadata and ordered remote candidates."""
    size = extract_file_size(file_info)
    if size:
        return size

    for url in candidate_urls:
        size = probe(url)
        if size:
            return size

    return None


def build_custom_result_fields(
    *,
    source: str,
    details: Dict[str, Any],
    selected_version: Dict[str, Any],
    file_info: Dict[str, Any],
    filename: str,
    download_url: Optional[str],
    version_url: Optional[str],
) -> Dict[str, Any]:
    """Build the shared result fields for provider custom-URL results."""
    hashes = (
        file_info.get("hashes")
        if isinstance(file_info.get("hashes"), dict)
        else {}
    )
    resolved_url = version_url or details.get("url")
    return {
        "source": source,
        "model_id": details.get("model_id"),
        "version_id": details.get("version_id") or selected_version.get("id"),
        "name": details.get("name") or filename,
        "version_name": selected_version.get("name") or "",
        "type": details.get("type") or file_info.get("type") or "",
        "filename": filename,
        "url": resolved_url,
        "download_url": download_url,
        "size": file_info.get("size"),
        "base_model": selected_version.get("base_model"),
        "tags": details.get("tags") or [],
        "trained_words": selected_version.get("trained_words") or [],
        "images": details.get("images") or selected_version.get("images") or [],
        "description": (
            selected_version.get("description")
            or details.get("description")
            or ""
        ),
        "sha256": extract_file_sha256(file_info),
        "hashes": hashes,
        "details_source": source,
        "version_url": resolved_url,
        "custom_url": True,
        "result_mode": "custom_url",
    }


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

"""
Common utilities and result builder functions for external model metadata sources.
"""

from typing import Any, Callable, Dict, List, Optional, Tuple

from ..type_utils import build_search_result, normalize_sha256


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


def normalize_hashes_dict(hashes: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """
    Normalize a hashes dictionary (e.g. from CivitAI API or CivArchive) so that
    hash algorithm keys are standardized and SHA256 values are uppercase.
    """
    if not isinstance(hashes, dict):
        return {}

    normalized: Dict[str, str] = {}
    for k, v in hashes.items():
        if not k or not v:
            continue
        key_str = str(k).strip()
        val_str = str(v).strip()
        if key_str.lower() in ("sha256", "sha-256"):
            normalized["sha256"] = normalize_sha256(val_str)
        elif key_str.lower() in ("autov2", "auto_v2"):
            normalized["autoV2"] = val_str
        elif key_str.lower() in ("autov1", "auto_v1"):
            normalized["autoV1"] = val_str
        elif key_str.lower() == "blake3":
            normalized["blake3"] = val_str
        else:
            normalized[key_str] = val_str

    return normalized


def build_unified_search_result(
    source: str,
    *,
    model_id: Any,
    version_id: Any,
    name: str = "",
    version_name: str = "",
    type: str = "",
    filename: str = "",
    url: str = "",
    download_url: Optional[str] = None,
    size: Optional[int] = None,
    base_model: Optional[str] = None,
    tags: Optional[List[str]] = None,
    match_type: str = "similar",
    confidence: float = 0.0,
    sha256: Optional[str] = None,
    hashes: Optional[Dict[str, Any]] = None,
    trained_words: Optional[List[str]] = None,
    images: Optional[List[Dict[str, Any]]] = None,
    **extra: Any,
) -> Dict[str, Any]:
    """
    Unified result builder for all model metadata sources.
    Normalizes hash dictionaries and formats a standard model search result.
    """
    norm_hashes = normalize_hashes_dict(hashes)
    if not sha256 and "sha256" in norm_hashes:
        sha256 = norm_hashes["sha256"]

    return build_search_result(
        source,
        model_id=model_id,
        version_id=version_id,
        name=name,
        version_name=version_name,
        type=type,
        filename=filename,
        url=url,
        download_url=download_url,
        size=size,
        base_model=base_model,
        tags=tags,
        match_type=match_type,
        confidence=confidence,
        sha256=sha256,
        hashes=norm_hashes,
        trained_words=trained_words,
        images=images,
        **extra,
    )


def build_custom_url_result(
    source: str,
    *,
    model_id: Any,
    version_id: Any,
    name: str,
    version_name: str,
    type: str,
    filename: str,
    url: str,
    download_url: str,
    size: Optional[int],
    base_model: Optional[str],
    tags: List[Any],
    trained_words: List[Any],
    images: List[Dict[str, Any]],
    description: str,
    sha256: Optional[str],
    hashes: Dict[str, Any],
    **extra: Any,
) -> Dict[str, Any]:
    """Build the shared, unnormalized result contract for custom URL resolvers."""
    result = {
        "source": source,
        "details_source": source,
        "model_id": model_id,
        "version_id": version_id,
        "name": name,
        "version_name": version_name,
        "type": type,
        "filename": filename,
        "url": url,
        "version_url": url,
        "download_url": download_url,
        "size": size,
        "base_model": base_model,
        "tags": tags,
        "trained_words": trained_words,
        "images": images,
        "description": description,
        "sha256": sha256,
        "hashes": hashes,
        "match_type": "custom_url",
        "custom_url": True,
    }
    result.update(extra)
    return result

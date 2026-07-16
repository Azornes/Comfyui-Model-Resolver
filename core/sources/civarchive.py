"""
CivArchive Source Module

Search and resolve models from CivArchive.
"""

import html
import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import requests

from ..network_utils import host_matches_domain, request_source_response
from ..matcher import (
    calculate_archived_model_confidence,
    calculate_model_title_confidence,
    has_known_model_extension as _has_known_model_extension,
    normalize_base_model as _normalize_base_model,
    base_model_matches as _base_model_matches,
    base_model_score as _base_model_score,
    calculate_candidate_rank,
    build_filename_search_queries,
    MODEL_TITLE_MATCH_THRESHOLD,
    should_update_best_match,
)
from ..path_utils import get_filename_from_path
from ..type_utils import (
    to_int,
    CIVARCHIVE_API_TYPE_MAP,
    select_primary_model_file,
    parse_size_to_bytes,
    get_version_sort_key,
    DEFAULT_BROWSER_USER_AGENT,
    parse_civitai_model_path,
    looks_like_model_file,
    normalize_model_image,
    fetch_remote_file_size_cached,
    clear_remote_size_cache,
    extract_trained_words,
    extract_file_size,
    normalize_model_file_info,
    build_search_result,
    normalize_sha256,
)
from ..progress import report_progress, get_progress_reporter
from ..log_system import create_module_logger
log = create_module_logger(__name__)


_coerce_int = to_int

CIVARCHIVE_BASE_URL = "https://civarchive.com"
CIVARCHIVE_API_URL = f"{CIVARCHIVE_BASE_URL}/api"
CIVITAI_DOWNLOAD_URL_PREFIXES = (
    "https://civitai.com/api/download/",
    "https://civitai.red/api/download/",
)

DEFAULT_CIVARCHIVE_CANDIDATE_LIMIT = 10
MAX_CIVARCHIVE_CANDIDATE_LIMIT = 30
SEARCH_RESULT_DETAIL_LIMIT = 5
HASH_PAGE_MODEL_LINK_LIMIT = 5



_search_cache: Dict[str, Any] = {}

REQUEST_HEADERS = {
    "accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    "user-agent": DEFAULT_BROWSER_USER_AGENT,
}

# Imported CIVARCHIVE_API_TYPE_MAP


class CivArchiveSearchError(Exception):
    """Raised when CivArchive cannot complete a search request."""


def clear_search_cache():
    """Clear cached CivArchive search results."""
    _search_cache.clear()
    clear_remote_size_cache()


_report_progress = get_progress_reporter("CivArchive progress callback")


def is_civarchive_available() -> bool:
    """Return True when the CivArchive provider can be offered."""
    return True


# _extract_file_size_bytes removed in favor of extract_file_size from type_utils



def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _extract_next_data(html_text: str) -> Dict[str, Any]:
    match = re.search(
        r'<script\b(?=[^>]*\bid=["\']__NEXT_DATA__["\'])(?=[^>]*\btype=["\']application/json["\'])[^>]*>(.*?)</script>',
        html_text,
        flags=re.DOTALL,
    )
    if not match:
        return {}

    try:
        return json.loads(html.unescape(match.group(1)))
    except Exception as e:
        log.warning(f"CivArchive search JSON parse failed: {e}")
        return {}


def _request_json(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Optional[Dict[str, Any]]:
    from ..network_utils import request_source_json
    url = f"{CIVARCHIVE_API_URL}{path}"
    return request_source_json(
        url,
        params=params,
        headers=REQUEST_HEADERS,
        timeout=timeout,
        log_name="CivArchive API"
    )



def _normalize_embedded_html_text(html_text: str) -> str:
    if not html_text:
        return ""
    return (
        html.unescape(html_text)
        .replace("\\/", "/")
        .replace("\\u002F", "/")
        .replace("\\u0026", "&")
    )


def _request_page_text(
    path_or_url: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Optional[str]:
    url = urljoin(CIVARCHIVE_BASE_URL, path_or_url)
    response = request_source_response(
        url,
        method="GET",
        headers=REQUEST_HEADERS,
        params=params,
        timeout=timeout,
        log_name="CivArchive page",
    )
    if response is None:
        return None

    if response.status_code != 200:
        log.debug(f"CivArchive page returned {response.status_code}: url={url}")
        return None

    return response.text


def _normalize_civarchive_type(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    mapped = CIVARCHIVE_API_TYPE_MAP.get(text.lower(), text)
    return re.sub(r"[^a-z0-9]+", "", str(mapped).lower())


def _extract_hash_page_model_cards(next_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    page_props = next_data.get("props", {}).get("pageProps", {})
    models = page_props.get("models") if isinstance(page_props, dict) else []
    if not isinstance(models, list):
        models = [models]

    cards: List[Dict[str, Any]] = []
    for model in models:
        if not isinstance(model, dict):
            continue

        version = model.get("version") if isinstance(model.get("version"), dict) else {}
        model_id = _coerce_int(
            model.get("id")
            or model.get("model_id")
            or model.get("modelId")
            or version.get("model_id")
            or version.get("modelId")
        )
        version_id = _coerce_int(
            version.get("id")
            or model.get("model_version_id")
            or model.get("modelVersionId")
            or model.get("version_id")
        )
        if not model_id:
            continue

        cards.append(
            {
                "model_id": model_id,
                "version_id": version_id,
                "type": model.get("type"),
                "name": model.get("name"),
            }
        )

    return cards


def _extract_model_links_from_html(html_text: str) -> List[Dict[str, Any]]:
    text = _normalize_embedded_html_text(html_text)
    if not text:
        return []

    next_data = _extract_next_data(html_text)
    model_cards = _extract_hash_page_model_cards(next_data)
    card_meta_by_key = {
        (card.get("model_id"), card.get("version_id")): card
        for card in model_cards
        if card.get("model_id")
    }
    links: List[Dict[str, Any]] = []
    links_by_key: Dict[Tuple[Optional[int], Optional[int]], Dict[str, Any]] = {}
    seen = set()

    def add_link(model_id: Any, version_id: Any = None, **metadata: Any) -> None:
        resolved_model_id = _coerce_int(model_id)
        resolved_version_id = _coerce_int(version_id) if version_id else None
        key = (resolved_model_id, resolved_version_id)
        if not resolved_model_id:
            return
        card_meta = card_meta_by_key.get(key) or {}
        if key in seen:
            existing = links_by_key.get(key)
            if existing:
                for field in ("type", "name"):
                    value = metadata.get(field) or card_meta.get(field)
                    if value and not existing.get(field):
                        existing[field] = value
            return
        seen.add(key)
        link = {
            "model_id": resolved_model_id,
            "version_id": resolved_version_id,
        }
        for field in ("type", "name"):
            value = metadata.get(field) or card_meta.get(field)
            if value:
                link[field] = value
        links.append(link)
        links_by_key[key] = link

    pattern = re.compile(r"(?<!/download)/models/(\d+)(?:\?[^\"'<>\s]*?modelVersionId=(\d+))?")

    def add_links_from_text(value: Any) -> None:
        if not isinstance(value, str) or "/models/" not in value:
            return
        for match in pattern.finditer(_normalize_embedded_html_text(value)):
            add_link(match.group(1), match.group(2))

    def walk_next_data(value: Any) -> None:
        if isinstance(value, dict):
            model_id = (
                value.get("model_id")
                or value.get("modelId")
                or value.get("civitai_model_id")
            )
            version_id = (
                value.get("model_version_id")
                or value.get("modelVersionId")
                or value.get("version_id")
                or value.get("civitai_model_version_id")
                or (value.get("id") if model_id else None)
            )
            if model_id and version_id:
                add_link(model_id, version_id)

            for key in ("href", "url", "platform_url", "version_url"):
                add_links_from_text(value.get(key))

            for nested in value.values():
                walk_next_data(nested)
        elif isinstance(value, list):
            for item in value:
                walk_next_data(item)

    walk_next_data(next_data)

    for match in pattern.finditer(text):
        add_link(match.group(1), match.group(2))

    for card in model_cards:
        add_link(
            card.get("model_id"),
            card.get("version_id"),
            type=card.get("type"),
            name=card.get("name"),
        )

    filtered_links = []
    for link in links:
        if not link.get("version_id"):
            continue
        filtered_links.append(link)
    filtered_links.extend(link for link in links if not link.get("version_id"))
    return filtered_links


def _prefer_model_links_for_expected_type(
    links: List[Dict[str, Any]],
    expected_model_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    expected_type = _normalize_civarchive_type(expected_model_type)
    if not expected_type:
        return links

    def is_expected(link: Dict[str, Any]) -> bool:
        return _normalize_civarchive_type(link.get("type")) == expected_type

    if not any(is_expected(link) for link in links):
        return links

    ordered = sorted(
        enumerate(links),
        key=lambda item: (0 if is_expected(item[1]) else 1, item[0]),
    )
    return [link for _, link in ordered]


def _extract_download_urls_from_html(html_text: str) -> List[str]:
    text = _normalize_embedded_html_text(html_text)
    if not text:
        return []

    urls: List[str] = []
    pattern = re.compile(
        r"https?://(?:huggingface\.co|civitai\.com|civitai\.red)/[^\"'<>\s)]+",
        flags=re.IGNORECASE,
    )
    for match in pattern.finditer(text):
        url = _normalize_download_url(match.group(0).rstrip(".,;]})"))
        if url and _download_url_looks_like_model_file(url) and url not in urls:
            urls.append(url)
    return urls


def _extract_model_payload_from_page(
    model_id: int,
    version_id: Optional[int] = None,
    timeout: int = 20,
) -> Optional[Dict[str, Any]]:
    params = {"modelVersionId": version_id} if version_id is not None else None
    page_text = _request_page_text(
        f"/models/{model_id}",
        params=params,
        timeout=timeout,
    )
    if not page_text:
        return None

    next_data = _extract_next_data(page_text)
    page_props = next_data.get("props", {}).get("pageProps", {})
    if isinstance(page_props.get("data"), dict):
        return page_props["data"]
    if isinstance(page_props.get("model"), dict):
        return page_props["model"]
    return page_props if isinstance(page_props, dict) and page_props else None


def _request_model_payload(
    model_id: int,
    version_id: Optional[int] = None,
    timeout: int = 20,
    prefer_page: bool = False,
) -> Optional[Dict[str, Any]]:
    params = {"modelVersionId": version_id} if version_id is not None else None
    if prefer_page:
        payload = _extract_model_payload_from_page(model_id, version_id, timeout=timeout)
        if payload:
            return payload

    payload = _request_json(f"/models/{model_id}", params=params, timeout=timeout)
    if payload:
        return payload
    if prefer_page:
        return None
    return _extract_model_payload_from_page(model_id, version_id, timeout=timeout)


def _search_page(
    query: str,
    model_type: Optional[str] = None,
    timeout: int = 20,
) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {
        "q": query,
        "rating": "all",
        "platform": "civitai,huggingface,malcolmrey,modelscope,modelscope_cn",
        "sort": "relevance",
    }
    # We do not send the 'type' parameter to CivArchive because crowdsourced model uploads
    # (especially VAEs) are frequently misclassified (e.g. as Checkpoint or null type) in their database.
    # We rely on name confidence sorting instead.

    response = request_source_response(
        f"{CIVARCHIVE_BASE_URL}/search",
        method="GET",
        headers=REQUEST_HEADERS,
        params=params,
        timeout=timeout,
        log_name="CivArchive search",
    )
    if response is None:
        raise CivArchiveSearchError("CivArchive search request failed (network error or timeout)")

    if response.status_code != 200:
        log.warning(
            f"CivArchive search returned {response.status_code}: query={query}"
        )
        raise CivArchiveSearchError(f"HTTP {response.status_code}")

    next_data = _extract_next_data(response.text)
    results = (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("data", {})
        .get("results", [])
    )
    if not isinstance(results, list):
        return []

    log.info(
        f"CivArchive search returned {len(results)} candidates for query={query}"
    )
    return [result for result in results if isinstance(result, dict)]


def parse_civarchive_url(url: str) -> Optional[Dict[str, Any]]:
    """Parse CivArchive URLs into sha256 or model/version identifiers."""
    from ..type_utils import parse_provider_model_url
    if not url:
        return None
    full_url = urljoin(CIVARCHIVE_BASE_URL, url)
    return parse_provider_model_url(full_url, ["civarchive.com"])


def _extract_sha256(value: str) -> Optional[str]:
    if not value:
        return None
    normalized = normalize_sha256(value)
    if normalized:
        return normalized
    parsed = parse_civarchive_url(value)
    return parsed.get("sha256") if parsed else None



def _extract_model_context(
    payload: Dict[str, Any],
) -> Tuple[Dict[str, Any], Dict[str, Any], List[Dict[str, Any]]]:
    data = _normalize_payload(payload)
    if not data:
        return {}, {}, []

    top_files = data.get("files") or []
    if not isinstance(top_files, list):
        top_files = [top_files]

    model_block = data.get("model")
    if isinstance(model_block, dict):
        context = {k: v for k, v in model_block.items() if k != "version"}
        version = model_block.get("version")
    else:
        context = {k: v for k, v in data.items() if k not in {"version", "files"}}
        version = data.get("version")

    if not isinstance(version, dict):
        version = data.get("version") if isinstance(data.get("version"), dict) else {}

    return context, version, [item for item in top_files if isinstance(item, dict)]


def _normalize_download_url(url: Any) -> Optional[str]:
    if not isinstance(url, str) or not url.strip():
        return None

    value = url.strip()
    if value.startswith("//"):
        return f"https:{value}"
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("/api/download/"):
        return urljoin(CIVARCHIVE_BASE_URL, value)
    return None


def _download_url_looks_like_model_file(
    url: Any,
    expected_filename: str = "",
) -> bool:
    normalized = _normalize_download_url(url)
    if not normalized:
        return False
    return looks_like_model_file(normalized, expected_filename)



def _archive_link_is_dead(item: Dict[str, Any]) -> bool:
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


def _prepare_size_probe_url(url: Any) -> Optional[str]:
    normalized = _normalize_download_url(url)
    if not normalized:
        return None

    parsed = urlparse(normalized)
    host = parsed.hostname
    path = parsed.path or ""

    if host_matches_domain(host, "huggingface.co") and "/blob/" in path:
        normalized = normalized.replace("/blob/", "/resolve/", 1)
        parsed = urlparse(normalized)
        host = parsed.hostname
        path = parsed.path or ""

    if host_matches_domain(host, "civarchive.com") and not path.startswith("/api/download/"):
        return None
    if host_matches_domain(host, "civitai.com", "civitai.red") and not path.startswith("/api/download/"):
        return None

    return normalized




def _fetch_remote_file_size_bytes(url: Any, timeout: int = 15) -> Optional[int]:
    probe_url = _prepare_size_probe_url(url)
    if not probe_url:
        return None
    return fetch_remote_file_size_cached(probe_url, headers=REQUEST_HEADERS, timeout=timeout)



def _resolve_file_size_bytes(
    file_info: Dict[str, Any],
    download_urls: Optional[List[str]] = None,
) -> Optional[int]:
    size = extract_file_size(file_info)
    if size:
        return size

    urls = download_urls if download_urls is not None else _collect_normalized_download_urls(file_info)
    for url in urls:
        size = _fetch_remote_file_size_bytes(url)
        if size:
            return size

    return None


def _mirror_from_top_file(file_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    url = _normalize_download_url(file_data.get("url") or file_data.get("downloadUrl"))
    if not url:
        return None

    hashes = file_data.get("hashes") if isinstance(file_data.get("hashes"), dict) else {}
    sha256 = (
        file_data.get("sha256")
        or file_data.get("hash")
        or hashes.get("SHA256")
        or hashes.get("sha256")
    )

    return {
        "filename": file_data.get("filename") or file_data.get("name"),
        "url": url,
        "source": file_data.get("source") or file_data.get("platform"),
        "sha256": sha256,
        "hash": sha256,
        "model_id": file_data.get("model_id") or file_data.get("modelId"),
        "model_version_id": file_data.get("model_version_id")
        or file_data.get("modelVersionId"),
        "sizeKB": file_data.get("sizeKB") or file_data.get("size_kb"),
        "sizeBytes": file_data.get("sizeBytes")
        or file_data.get("size_bytes")
        or file_data.get("fileSize")
        or file_data.get("file_size")
        or file_data.get("bytes"),
        "size": file_data.get("size"),
        "deletedAt": file_data.get("deletedAt") or file_data.get("deleted_at"),
        "is_dead": file_data.get("is_dead")
        or file_data.get("isDead")
        or file_data.get("likelyDead")
        or file_data.get("likely_dead")
        or file_data.get("dead"),
        "is_gated": file_data.get("is_gated"),
        "is_paid": file_data.get("is_paid"),
    }


def _transform_file_entry(file_data: Dict[str, Any]) -> Dict[str, Any]:
    mirrors = file_data.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    transformed_mirrors = []
    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        mirror_url = _normalize_download_url(mirror.get("url"))
        if mirror_url:
            mirror = dict(mirror)
            mirror["url"] = mirror_url
            transformed_mirrors.append(mirror)

    download_url = None
    if not _archive_link_is_dead(file_data):
        download_url = _normalize_download_url(
            file_data.get("downloadUrl")
            or file_data.get("download_url")
            or file_data.get("url")
        )
    name = file_data.get("name") or file_data.get("filename")

    if not download_url:
        for mirror in transformed_mirrors:
            if not _archive_link_is_dead(mirror) and mirror.get("url"):
                download_url = mirror["url"]
                break

    return {
        "id": file_data.get("id"),
        "name": name,
        "type": file_data.get("type"),
        "sizeKB": file_data.get("sizeKB") or file_data.get("size_kb"),
        "sizeBytes": file_data.get("sizeBytes")
        or file_data.get("size_bytes")
        or file_data.get("fileSize")
        or file_data.get("file_size")
        or file_data.get("bytes"),
        "size": file_data.get("size"),
        "downloadUrl": download_url,
        "primary": bool(file_data.get("primary", file_data.get("is_primary", False))),
        "mirrors": transformed_mirrors,
        "hashes": file_data.get("hashes", {}),
        "sha256": file_data.get("sha256"),
        "metadata": file_data.get("metadata"),
        "modelId": file_data.get("modelId") or file_data.get("model_id"),
        "modelVersionId": file_data.get("modelVersionId")
        or file_data.get("model_version_id"),
    }


def _same_file(file_info: Dict[str, Any], mirror: Dict[str, Any]) -> bool:
    file_name = str(file_info.get("name") or "").lower()
    mirror_name = str(mirror.get("filename") or "").lower()
    if file_name and mirror_name and file_name == mirror_name:
        return True

    file_sha = (
        file_info.get("sha256")
        or (file_info.get("hashes") or {}).get("SHA256")
        or (file_info.get("hashes") or {}).get("sha256")
    )
    mirror_sha = mirror.get("sha256") or mirror.get("hash")
    return bool(file_sha and mirror_sha and str(file_sha).lower() == str(mirror_sha).lower())


def _merge_top_file_mirrors(
    files: List[Dict[str, Any]], top_files: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    if not top_files:
        return files

    if not files:
        merged = []
        for top_file in top_files:
            mirror = _mirror_from_top_file(top_file)
            if not mirror:
                continue
            merged.append(
                {
                    "id": top_file.get("id"),
                    "name": mirror.get("filename"),
                    "type": top_file.get("type") or "Model",
                    "sizeKB": top_file.get("sizeKB") or top_file.get("size_kb"),
                    "sizeBytes": top_file.get("sizeBytes")
                    or top_file.get("size_bytes")
                    or top_file.get("fileSize")
                    or top_file.get("file_size")
                    or top_file.get("bytes"),
                    "size": top_file.get("size"),
                    "downloadUrl": mirror.get("url"),
                    "primary": True,
                    "mirrors": [mirror],
                    "hashes": {"SHA256": top_file.get("sha256")}
                    if top_file.get("sha256")
                    else {},
                    "sha256": top_file.get("sha256"),
                    "modelId": top_file.get("model_id") or top_file.get("modelId"),
                    "modelVersionId": top_file.get("model_version_id")
                    or top_file.get("modelVersionId"),
                }
            )
        return merged

    for top_file in top_files:
        mirror = _mirror_from_top_file(top_file)
        if not mirror:
            continue

        target = next((file_info for file_info in files if _same_file(file_info, mirror)), None)
        if target is None:
            target = files[0]

        mirrors = target.setdefault("mirrors", [])
        mirror_url = mirror.get("url")
        if mirror_url and not any(existing.get("url") == mirror_url for existing in mirrors):
            mirrors.append(mirror)
        if not extract_file_size(target):
            target_size_bytes = extract_file_size(top_file)
            if target_size_bytes:
                target["sizeBytes"] = target_size_bytes

    return files


def _extract_version_files(
    version: Dict[str, Any], top_files: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    raw_files = version.get("files") or []
    if not isinstance(raw_files, list):
        raw_files = [raw_files]

    files = [
        _transform_file_entry(file_data)
        for file_data in raw_files
        if isinstance(file_data, dict)
    ]
    return _merge_top_file_mirrors(files, top_files or [])


def _select_primary_file(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return select_primary_model_file(files)


def _collect_download_urls_unified(
    file_info: Dict[str, Any],
    prioritize_civitai_last: bool = False,
    skip_file_if_dead: bool = False,
    check_download_urls_list: bool = False,
    download_url_keys: Tuple[str, ...] = ("downloadUrl",),
) -> List[str]:
    urls: List[str] = []
    if skip_file_if_dead and _archive_link_is_dead(file_info):
        return urls

    expected_filename = file_info.get("filename") or file_info.get("name") or ""
    dead_urls = set()
    mirrors = file_info.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        if _archive_link_is_dead(mirror):
            dead_url = _normalize_download_url(mirror.get("url"))
            if dead_url:
                dead_urls.add(dead_url)
            continue
        url = _normalize_download_url(mirror.get("url"))
        mirror_filename = mirror.get("filename") or mirror.get("name") or expected_filename
        if (
            url
            and _download_url_looks_like_model_file(url, mirror_filename)
            and url not in urls
        ):
            urls.append(url)

    if check_download_urls_list:
        raw_urls = file_info.get("download_urls") or []
        if not isinstance(raw_urls, list):
            raw_urls = [raw_urls]
        for raw_url in raw_urls:
            url = _normalize_download_url(raw_url)
            if (
                url
                and url not in dead_urls
                and _download_url_looks_like_model_file(url, expected_filename)
                and url not in urls
            ):
                urls.append(url)

    if not _archive_link_is_dead(file_info):
        for key in download_url_keys:
            url = _normalize_download_url(file_info.get(key))
            if (
                url
                and url not in dead_urls
                and _download_url_looks_like_model_file(url, expected_filename)
                and url not in urls
            ):
                urls.append(url)

    if prioritize_civitai_last:
        non_civitai_urls = [
            url for url in urls if not url.startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)
        ]
        civitai_urls = [
            url for url in urls if url.startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)
        ]
        return non_civitai_urls + civitai_urls

    return urls


def _collect_download_urls(file_info: Dict[str, Any]) -> List[str]:
    return _collect_download_urls_unified(
        file_info,
        prioritize_civitai_last=True,
        skip_file_if_dead=False,
        check_download_urls_list=False,
        download_url_keys=("downloadUrl",),
    )


def _normalize_archive_mirrors(file_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    mirrors = file_info.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    normalized: List[Dict[str, Any]] = []
    seen_urls = set()
    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        url = _normalize_download_url(mirror.get("url"))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        sha256 = mirror.get("sha256") or mirror.get("hash")
        deleted_at = mirror.get("deletedAt") or mirror.get("deleted_at")
        is_dead = _archive_link_is_dead(mirror)
        normalized.append(
            {
                "url": url,
                "source": mirror.get("source") or mirror.get("platform"),
                "filename": mirror.get("filename") or mirror.get("name") or file_info.get("name"),
                "sha256": sha256,
                "hash": sha256,
                "deleted_at": deleted_at,
                "is_dead": is_dead,
                "is_gated": mirror.get("is_gated"),
                "is_paid": mirror.get("is_paid"),
            }
        )

    download_url = None
    if not _archive_link_is_dead(file_info):
        download_url = _normalize_download_url(file_info.get("downloadUrl"))
    if download_url and download_url not in seen_urls:
        normalized.append(
            {
                "url": download_url,
                "source": file_info.get("source") or file_info.get("platform"),
                "filename": file_info.get("name") or file_info.get("filename"),
                "sha256": file_info.get("sha256"),
                "hash": file_info.get("sha256"),
                "deleted_at": file_info.get("deletedAt") or file_info.get("deleted_at"),
                "is_dead": _archive_link_is_dead(file_info),
                "is_gated": file_info.get("is_gated"),
                "is_paid": file_info.get("is_paid"),
            }
        )

    non_civitai = [
        mirror for mirror in normalized
        if not str(mirror.get("url") or "").startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)
    ]
    civitai = [
        mirror for mirror in normalized
        if str(mirror.get("url") or "").startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)
    ]
    return non_civitai + civitai





def _normalize_archive_file(file_info: Dict[str, Any], model_id: Optional[int], version_id: Optional[int]) -> Dict[str, Any]:
    transformed = _transform_file_entry(file_info)
    download_urls = _collect_download_urls(transformed)
    mirrors = _normalize_archive_mirrors(transformed)
    normalized = normalize_model_file_info(transformed, model_id=model_id, version_id=version_id)
    # Re-extract size using exact logic and append mirror info
    normalized["size"] = extract_file_size(transformed)
    normalized["download_urls"] = download_urls
    normalized["mirrors"] = mirrors
    normalized["mirror_count"] = len(mirrors)
    return normalized


def _normalize_archive_version(
    version: Dict[str, Any],
    context: Dict[str, Any],
    top_files: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    model_id = _coerce_int(context.get("id") or version.get("modelId"))
    version_id = _coerce_int(version.get("id"))
    files = _extract_version_files(version, top_files or [])
    normalized_files = [
        _normalize_archive_file(file_info, model_id, version_id)
        for file_info in files
        if isinstance(file_info, dict)
    ]
    raw_images = version.get("images") or []
    if not isinstance(raw_images, list):
        raw_images = [raw_images]
    images = [
        normalize_model_image(image)
        for image in raw_images
        if isinstance(image, dict) and (image.get("url") or image.get("imageUrl") or image.get("src"))
    ]
    trained_words = extract_trained_words(version.get("trainedWords"), version.get("trigger"))
    return {
        "id": version_id,
        "name": version.get("name") or "",
        "base_model": version.get("baseModel") or version.get("base_model") or version.get("baseModelType"),
        "platform_url": version.get("platform_url") or version.get("platformUrl"),
        "civitai_model_id": version.get("civitai_model_id") or version.get("civitaiModelId"),
        "civitai_model_version_id": version.get("civitai_model_version_id") or version.get("civitaiModelVersionId"),
        "published_at": version.get("publishedAt") or version.get("createdAt"),
        "updated_at": version.get("updatedAt"),
        "description": version.get("description") or "",
        "trained_words": trained_words,
        "stats": version.get("stats") or {},
        "files": normalized_files,
        "images": images,
        "url": f"{CIVARCHIVE_BASE_URL}/models/{model_id}?modelVersionId={version_id}" if model_id and version_id else "",
    }


def get_civarchive_model_details(
    model_id: int,
    version_id: Optional[int] = None,
    prefer_page: bool = False,
) -> Optional[Dict[str, Any]]:
    """Fetch and normalize full CivArchive model details for the resolver UI."""
    if not model_id:
        return None

    payload = _request_model_payload(
        model_id,
        version_id,
        timeout=25,
        prefer_page=prefer_page,
    )
    if not payload and version_id and not prefer_page:
        resolved = resolve_civarchive_model_version(model_id, version_id)
        if not resolved:
            return None
        fallback_version = {
            "id": resolved.get("version_id"),
            "name": resolved.get("version_name"),
            "baseModel": resolved.get("base_model"),
            "trainedWords": resolved.get("trained_words", []),
            "images": resolved.get("images", []),
            "files": [
                {
                    "name": resolved.get("filename"),
                    "type": resolved.get("type"),
                    "downloadUrl": resolved.get("download_url"),
                    "sizeKB": (resolved.get("size") or 0) / 1024 if resolved.get("size") else None,
                    "primary": True,
                }
            ],
        }
        context = {
            "id": model_id,
            "name": resolved.get("name"),
            "type": resolved.get("type"),
            "tags": resolved.get("tags", []),
            "creator": resolved.get("creator", {}),
            "platform": resolved.get("platform"),
        }
        selected = _normalize_archive_version(fallback_version, context)
        return {
            "source": "civarchive",
            "model_id": model_id,
            "version_id": selected.get("id"),
            "name": context.get("name") or "",
            "type": context.get("type") or "",
            "description": "",
            "tags": context.get("tags") or [],
            "stats": {},
            "creator": context.get("creator") or {},
            "platform": context.get("platform"),
            "url": f"{CIVARCHIVE_BASE_URL}/models/{model_id}",
            "version_url": selected.get("url"),
            "platform_url": selected.get("platform_url"),
            "civitai_model_id": selected.get("civitai_model_id"),
            "civitai_model_version_id": selected.get("civitai_model_version_id"),
            "versions": [selected],
            "selected_version": selected,
            "images": selected.get("images", []),
        }
    if not payload:
        return None

    data = _normalize_payload(payload)
    model_block = data.get("model") if isinstance(data.get("model"), dict) else data
    context = {k: v for k, v in model_block.items() if k not in {"version", "versions", "modelVersions", "files"}}
    context.setdefault("id", model_id)

    raw_versions = (
        model_block.get("modelVersions")
        or model_block.get("versions")
        or data.get("modelVersions")
        or data.get("versions")
        or []
    )
    if not isinstance(raw_versions, list):
        raw_versions = [raw_versions]
    if not raw_versions and isinstance(model_block.get("version"), dict):
        raw_versions = [model_block.get("version")]

    top_files = data.get("files") or model_block.get("files") or []
    if not isinstance(top_files, list):
        top_files = [top_files]

    active_version = model_block.get("version") if isinstance(model_block.get("version"), dict) else {}
    active_version_id = _coerce_int(active_version.get("id"))
    hydrated_versions: List[Dict[str, Any]] = []

    for version_summary in raw_versions:
        if not isinstance(version_summary, dict):
            continue

        current_id = _coerce_int(version_summary.get("id"))
        if current_id and active_version_id and current_id == active_version_id:
            hydrated_versions.append({**version_summary, **active_version})
        else:
            hydrated_versions.append(version_summary)

    versions = [
        _normalize_archive_version(version, context, top_files)
        for version in hydrated_versions
        if isinstance(version, dict)
    ]
    selected = next((version for version in versions if version_id and str(version.get("id")) == str(version_id)), None)
    if not selected and versions:
        selected = versions[0]

    return {
        "source": "civarchive",
        "model_id": model_id,
        "version_id": selected.get("id") if selected else version_id,
        "name": context.get("name") or context.get("modelName") or "",
        "type": context.get("type") or "",
        "description": context.get("description") or "",
        "tags": context.get("tags") or [],
        "stats": context.get("stats") or {},
        "creator": context.get("creator") or {
            "username": context.get("creator_username") or context.get("username"),
            "name": context.get("creator_name"),
            "url": context.get("creator_url"),
        },
        "platform": context.get("platform") or context.get("platform_name"),
        "url": f"{CIVARCHIVE_BASE_URL}/models/{model_id}",
        "version_url": selected.get("url") if selected else f"{CIVARCHIVE_BASE_URL}/models/{model_id}",
        "platform_url": selected.get("platform_url") if selected else None,
        "civitai_model_id": selected.get("civitai_model_id") if selected else None,
        "civitai_model_version_id": selected.get("civitai_model_version_id") if selected else None,
        "versions": versions,
        "selected_version": selected,
        "images": selected.get("images", []) if selected else [],
    }







def _collect_normalized_download_urls(file_info: Dict[str, Any]) -> List[str]:
    return _collect_download_urls_unified(
        file_info,
        prioritize_civitai_last=False,
        skip_file_if_dead=True,
        check_download_urls_list=True,
        download_url_keys=("download_url", "downloadUrl"),
    )


def _select_primary_model_file(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    valid_files = [
        file_info
        for file_info in files
        if isinstance(file_info, dict)
        and _collect_normalized_download_urls(file_info)
    ]
    return select_primary_model_file(valid_files)


def _build_result_from_normalized_version(
    model_details: Dict[str, Any],
    version: Dict[str, Any],
    file_info: Dict[str, Any],
    match_type: str,
) -> Optional[Dict[str, Any]]:
    download_urls = _collect_normalized_download_urls(file_info)
    if not download_urls:
        return None

    model_id = _coerce_int(model_details.get("model_id") or file_info.get("model_id"))
    version_id = _coerce_int(version.get("id") or file_info.get("version_id"))
    filename = file_info.get("name") or file_info.get("filename") or ""
    url = version.get("url") or (
        f"{CIVARCHIVE_BASE_URL}/models/{model_id}?modelVersionId={version_id}"
        if model_id and version_id
        else model_details.get("url", "")
    )

    tags = model_details.get("tags") or []
    if not isinstance(tags, list):
        tags = [tags] if tags else []

    size = file_info.get("size")
    if size is None:
        size = _resolve_file_size_bytes(file_info, download_urls)

    return build_search_result(
        source="civarchive",
        model_id=model_id,
        version_id=version_id,
        name=model_details.get("name") or "",
        version_name=version.get("name") or "",
        type=model_details.get("type") or file_info.get("type"),
        filename=filename,
        url=url,
        platform_url=version.get("platform_url") or version.get("platformUrl"),
        civitai_model_id=version.get("civitai_model_id") or version.get("civitaiModelId"),
        civitai_model_version_id=version.get("civitai_model_version_id") or version.get("civitaiModelVersionId"),
        download_url=download_urls[0],
        download_urls=download_urls,
        size=size,
        base_model=version.get("base_model") or version.get("baseModel") or version.get("baseModelType"),
        tags=tags,
        trained_words=version.get("trained_words") or [],
        images=version.get("images") or [],
        creator=model_details.get("creator") or {},
        platform=model_details.get("platform"),
        is_deleted=False,
        match_type=match_type,
    )


def _hydrate_civarchive_version_with_files(
    model_id: int, version: Dict[str, Any]
) -> Dict[str, Any]:
    if _select_primary_model_file(version.get("files") or []):
        return version

    version_id = _coerce_int(version.get("id"))
    if not model_id or not version_id:
        return version

    details = get_civarchive_model_details(model_id, version_id)
    if not details:
        return version

    selected = details.get("selected_version")
    if isinstance(selected, dict) and _coerce_int(selected.get("id")) == version_id:
        return selected

    for candidate in details.get("versions") or []:
        if isinstance(candidate, dict) and _coerce_int(candidate.get("id")) == version_id:
            return candidate

    return version


def _find_model_title_match_in_model_details(
    model_id: int,
    model_details: Dict[str, Any],
    title_query: str,
    base_model_context: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """For extensionless workflow values, resolve by CivArchive model page title."""
    from ..matcher import match_model_by_title_generic

    model_name = model_details.get("name", "")
    versions = [
        version
        for version in (model_details.get("versions") or [])
        if isinstance(version, dict)
    ]
    selected_version = model_details.get("selected_version")
    if isinstance(selected_version, dict):
        selected_id = _coerce_int(selected_version.get("id"))
        if not any(_coerce_int(version.get("id")) == selected_id for version in versions):
            versions.append(selected_version)

    def hydrate_version(v):
        return _hydrate_civarchive_version_with_files(model_id, v)

    def get_base_model(v):
        return v.get("base_model")

    def select_file(v):
        return _select_primary_model_file(v.get("files") or [])

    def build_result(v, file_info, confidence):
        return _build_result_from_normalized_version(
            model_details=model_details,
            version=v,
            file_info=file_info,
            match_type="model_title",
        )

    return match_model_by_title_generic(
        model_id=model_id,
        title_query=title_query,
        model_name=model_name,
        versions=versions,
        base_model_context=base_model_context,
        get_base_model_fn=get_base_model,
        select_file_fn=select_file,
        build_result_fn=build_result,
        hydrate_version_fn=hydrate_version,
        log_prefix="CivArchive",
    )




def _build_result_from_model_details(
    model_details: Dict[str, Any],
    query: str = "",
    exact_only: bool = False,
) -> Optional[Dict[str, Any]]:
    selected_version = model_details.get("selected_version")
    if not isinstance(selected_version, dict):
        return None

    files = selected_version.get("files") or []
    if not isinstance(files, list):
        files = [files]

    selected_file = None
    best_confidence = -1.0
    for file_info in files:
        if not isinstance(file_info, dict):
            continue
        filename = file_info.get("name") or file_info.get("filename") or ""
        confidence = calculate_archived_model_confidence(
            query,
            model_details.get("name", ""),
            selected_version.get("name", ""),
            filename,
        )
        if confidence > best_confidence:
            best_confidence = confidence
            selected_file = file_info

    if selected_file is None:
        selected_file = _select_primary_model_file(files)
        if selected_file:
            best_confidence = calculate_archived_model_confidence(
                query,
                model_details.get("name", ""),
                selected_version.get("name", ""),
                selected_file.get("name") or selected_file.get("filename") or "",
            )

    if selected_file is None:
        return None
    if exact_only and best_confidence < 100.0:
        return None

    result = _build_result_from_normalized_version(
        model_details=model_details,
        version=selected_version,
        file_info=selected_file,
        match_type="exact" if best_confidence == 100.0 else "similar",
    )
    if not result:
        return None

    hashes = selected_file.get("hashes") if isinstance(selected_file.get("hashes"), dict) else {}
    sha256 = (
        selected_file.get("sha256")
        or selected_file.get("hash")
        or hashes.get("SHA256")
        or hashes.get("sha256")
    )
    result["confidence"] = best_confidence
    result["sha256"] = sha256
    result["hash"] = sha256
    result["hashes"] = hashes
    return result


def _extract_hash_page_files(html_text: str) -> List[Dict[str, Any]]:
    next_data = _extract_next_data(html_text)
    page_props = next_data.get("props", {}).get("pageProps", {})
    files = page_props.get("files") if isinstance(page_props, dict) else []
    if not isinstance(files, list):
        files = [files]
    return [file_info for file_info in files if isinstance(file_info, dict)]


def _hash_page_file_matches_model(
    file_info: Dict[str, Any],
    model_id: Optional[int],
    version_id: Optional[int],
) -> bool:
    if not model_id and not version_id:
        return False

    file_model_id = _coerce_int(file_info.get("model_id") or file_info.get("modelId"))
    file_version_id = _coerce_int(
        file_info.get("model_version_id")
        or file_info.get("modelVersionId")
        or file_info.get("version_id")
    )
    if model_id and file_model_id and file_model_id != _coerce_int(model_id):
        return False
    if version_id and file_version_id and file_version_id != _coerce_int(version_id):
        return False
    return bool((model_id and file_model_id) or (version_id and file_version_id))


def _select_hash_page_file(
    files: List[Dict[str, Any]],
    query: str,
    model_id: Optional[int] = None,
    version_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    best_file = None
    best_score = -1.0
    for file_info in files:
        if not isinstance(file_info, dict):
            continue
        if _archive_link_is_dead(file_info):
            continue
        if not _collect_normalized_download_urls(file_info):
            continue

        filename = file_info.get("filename") or file_info.get("name") or ""
        confidence = calculate_archived_model_confidence(query, "", "", filename)
        model_match = _hash_page_file_matches_model(file_info, model_id, version_id)
        score = confidence + (8.0 if model_match else 0.0)
        if score > best_score:
            best_score = score
            best_file = file_info

    if best_file is None:
        return None

    filename = best_file.get("filename") or best_file.get("name") or ""
    confidence = calculate_archived_model_confidence(query, "", "", filename)
    if confidence >= 70.0 or _hash_page_file_matches_model(best_file, model_id, version_id):
        return best_file
    return None


def _select_model_details_file(
    files: List[Dict[str, Any]],
    query: str,
    sha256: str = "",
) -> Optional[Dict[str, Any]]:
    normalized_hash = (sha256 or "").lower()
    best_file = None
    best_confidence = -1.0

    for file_info in files:
        if not isinstance(file_info, dict):
            continue
        if not _collect_normalized_download_urls(file_info):
            continue

        hashes = file_info.get("hashes") if isinstance(file_info.get("hashes"), dict) else {}
        file_hash = (
            file_info.get("sha256")
            or file_info.get("hash")
            or hashes.get("SHA256")
            or hashes.get("sha256")
        )
        if normalized_hash and str(file_hash or "").lower() == normalized_hash:
            return file_info

        filename = file_info.get("name") or file_info.get("filename") or ""
        confidence = calculate_archived_model_confidence(query, "", "", filename)
        if confidence > best_confidence:
            best_confidence = confidence
            best_file = file_info

    if best_file is None:
        return None

    filename = best_file.get("name") or best_file.get("filename") or ""
    confidence = calculate_archived_model_confidence(query, "", "", filename)
    return best_file if confidence >= 70.0 else None


def _prefer_query_matching_mirror(
    file_info: Dict[str, Any],
    query: str,
) -> Dict[str, Any]:
    mirrors = file_info.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    best_mirror = None
    best_confidence = -1.0
    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        if _archive_link_is_dead(mirror):
            continue
        url = _normalize_download_url(mirror.get("url"))
        filename = mirror.get("filename") or mirror.get("name") or ""
        if not url or not filename:
            continue
        confidence = calculate_archived_model_confidence(query, "", "", filename)
        if confidence > best_confidence:
            best_confidence = confidence
            best_mirror = mirror

    if not best_mirror or best_confidence < 70.0:
        return file_info

    preferred_url = _normalize_download_url(best_mirror.get("url"))
    download_urls = []
    if preferred_url:
        download_urls.append(preferred_url)
    for url in _collect_normalized_download_urls(file_info):
        if url and url not in download_urls:
            download_urls.append(url)

    preferred = dict(file_info)
    preferred["name"] = best_mirror.get("filename") or best_mirror.get("name")
    preferred["filename"] = preferred["name"]
    preferred["download_url"] = preferred_url or preferred.get("download_url")
    preferred["downloadUrl"] = preferred["download_url"]
    preferred["download_urls"] = download_urls
    return preferred


def _build_result_from_hash_page_file(
    model_details: Dict[str, Any],
    version: Dict[str, Any],
    file_info: Dict[str, Any],
    query: str,
    sha256: str = "",
) -> Optional[Dict[str, Any]]:
    model_id = _coerce_int(model_details.get("model_id") or file_info.get("model_id"))
    version_id = _coerce_int(version.get("id") or file_info.get("model_version_id"))
    normalized_file = _normalize_archive_file(file_info, model_id, version_id)
    confidence = calculate_archived_model_confidence(
        query,
        model_details.get("name", ""),
        version.get("name", ""),
        normalized_file.get("name") or normalized_file.get("filename") or "",
    )
    result = _build_result_from_normalized_version(
        model_details=model_details,
        version=version,
        file_info=normalized_file,
        match_type="exact" if confidence == 100.0 else "similar",
    )
    if not result:
        return None

    result["confidence"] = confidence
    if sha256:
        result["sha256"] = sha256
        result["hash"] = sha256
        hashes = result.get("hashes") if isinstance(result.get("hashes"), dict) else {}
        if not hashes.get("SHA256") and not hashes.get("sha256"):
            result["hashes"] = {**hashes, "SHA256": sha256}
    return result


def _resolve_civarchive_model_title_match(
    model_id: int,
    title_query: str,
    base_model_context: Optional[str] = None,
    prefer_page: bool = False,
) -> Optional[Dict[str, Any]]:
    details = get_civarchive_model_details(model_id, prefer_page=prefer_page)
    if not details:
        return None

    return _find_model_title_match_in_model_details(
        model_id=model_id,
        model_details=details,
        title_query=title_query,
        base_model_context=base_model_context,
    )



def _build_result_from_payload(
    payload: Dict[str, Any],
    query: str = "",
    preferred_filename: str = "",
    exact_only: bool = False,
) -> Optional[Dict[str, Any]]:
    context, version, top_files = _extract_model_context(payload)
    if not version:
        return None

    files = _extract_version_files(version, top_files)
    if not files:
        return None

    query_value = preferred_filename or query
    selected_file = None
    best_confidence = -1.0

    for file_info in files:
        file_name = file_info.get("name") or ""
        confidence = calculate_archived_model_confidence(
            query_value,
            context.get("name", ""),
            version.get("name", ""),
            file_name,
        )
        if confidence > best_confidence:
            best_confidence = confidence
            selected_file = file_info

    if selected_file is None:
        selected_file = _select_primary_file(files)
        best_confidence = calculate_archived_model_confidence(
            query_value,
            context.get("name", ""),
            version.get("name", ""),
            selected_file.get("name", "") if selected_file else "",
        )

    if selected_file is None:
        return None

    if exact_only and best_confidence < 100.0:
        return None

    download_urls = _collect_download_urls(selected_file)
    if not download_urls:
        return None

    model_id = _coerce_int(
        context.get("id")
        or version.get("modelId")
        or selected_file.get("modelId")
    )
    version_id = _coerce_int(
        version.get("id")
        or selected_file.get("modelVersionId")
    )
    model_name = context.get("name") or selected_file.get("modelName") or ""
    version_name = version.get("name") or ""
    filename = selected_file.get("name") or preferred_filename or query
    match_type = "exact" if best_confidence == 100.0 else "similar"
    hashes = selected_file.get("hashes") if isinstance(selected_file.get("hashes"), dict) else {}
    sha256 = (
        selected_file.get("sha256")
        or selected_file.get("hash")
        or hashes.get("SHA256")
        or hashes.get("sha256")
    )

    tags = context.get("tags") or []
    if not isinstance(tags, list):
        tags = [tags] if tags else []

    trained_words = extract_trained_words(version.get("trainedWords"), version.get("trigger"))

    civarchive_url = (
        f"{CIVARCHIVE_BASE_URL}/models/{model_id}?modelVersionId={version_id}"
        if model_id and version_id
        else context.get("meta", {}).get("canonical")
        if isinstance(context.get("meta"), dict)
        else ""
    )

    return build_search_result(
        source="civarchive",
        model_id=model_id,
        version_id=version_id,
        name=model_name,
        version_name=version_name,
        type=context.get("type") or selected_file.get("type"),
        filename=filename,
        url=civarchive_url,
        platform_url=version.get("platform_url") or version.get("platformUrl"),
        civitai_model_id=version.get("civitai_model_id") or version.get("civitaiModelId"),
        civitai_model_version_id=version.get("civitai_model_version_id") or version.get("civitaiModelVersionId"),
        download_url=download_urls[0],
        download_urls=download_urls,
        size=_resolve_file_size_bytes(selected_file, download_urls),
        base_model=version.get("baseModel") or version.get("base_model") or version.get("baseModelType"),
        tags=tags,
        trained_words=trained_words,
        images=version.get("images", []),
        creator={
            "username": context.get("creator_username") or context.get("username"),
            "name": context.get("creator_name"),
            "url": context.get("creator_url"),
        },
        platform=context.get("platform") or context.get("platform_name"),
        is_deleted=bool(context.get("deletedAt") or version.get("deletedAt")),
        match_type=match_type,
        confidence=best_confidence,
        sha256=sha256,
        hash=sha256,
        hashes=hashes,
    )


def resolve_civarchive_by_hash(
    sha256: str,
    query: str = "",
    exact_only: bool = False,
    model_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Resolve a model by SHA256 hash through CivArchive."""
    if not sha256:
        return None

    result = _resolve_hash_search_candidate_from_page(
        {"url": f"/sha256/{sha256.lower()}", "name": query or sha256},
        sha256,
        query=query or sha256,
        exact_only=exact_only,
        expected_model_type=model_type,
    )
    if result:
        return result

    payload = _request_json(f"/sha256/{sha256.lower()}")
    if not payload:
        return None

    return _build_result_from_payload(
        payload,
        query=query or sha256,
        exact_only=exact_only,
    )


def resolve_civarchive_model_version(
    model_id: int,
    version_id: Optional[int] = None,
    query: str = "",
    exact_only: bool = False,
    prefer_page: bool = False,
) -> Optional[Dict[str, Any]]:
    """Resolve a model/version through CivArchive."""
    if model_id is None:
        return None

    payload = _request_model_payload(model_id, version_id, prefer_page=prefer_page)
    if not payload:
        return None

    result = _build_result_from_payload(
        payload,
        query=query or str(model_id),
        exact_only=exact_only,
    )
    if result:
        return result

    details = get_civarchive_model_details(
        model_id,
        version_id,
        prefer_page=prefer_page,
    )
    if not details:
        return None

    return _build_result_from_model_details(
        details,
        query=query or str(model_id),
        exact_only=exact_only,
    )


def _candidate_identity(candidate: Dict[str, Any]) -> Tuple[Any, Any, Any]:
    parsed = parse_civarchive_url(candidate.get("url", ""))
    if parsed:
        return (
            parsed.get("sha256"),
            parsed.get("model_id"),
            parsed.get("version_id"),
        )
    return (candidate.get("id"), candidate.get("url"), None)


def _candidate_display_name(candidate: Dict[str, Any]) -> str:
    for key in ("name", "title", "filename", "fileName", "modelName"):
        value = candidate.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _build_result_from_search_candidate(
    candidate: Dict[str, Any],
    query: str,
    page_text: str = "",
    parsed: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    candidate_name = _candidate_display_name(candidate)
    query_basename = get_filename_from_path(query or "").strip()
    filename = (
        candidate.get("filename")
        or candidate.get("fileName")
        or (candidate_name if _has_known_model_extension(candidate_name) else query_basename)
    )
    confidence = calculate_archived_model_confidence(
        query,
        candidate_name,
        "",
        filename or "",
    )
    if confidence < 95.0:
        return None

    download_urls = []
    for key in ("download_url", "downloadUrl", "url"):
        url = _normalize_download_url(candidate.get(key))
        if url and not url.startswith(CIVARCHIVE_BASE_URL) and url not in download_urls:
            download_urls.append(url)
    for url in _extract_download_urls_from_html(page_text):
        if url not in download_urls:
            download_urls.append(url)
    if not download_urls:
        return None

    open_url = urljoin(CIVARCHIVE_BASE_URL, str(candidate.get("url") or ""))
    sha256 = (parsed or {}).get("sha256")
    return build_search_result(
        source="civarchive",
        model_id=candidate.get("model_id") or candidate.get("modelId"),
        version_id=candidate.get("version_id") or candidate.get("modelVersionId"),
        name=candidate_name or filename or query_basename,
        version_name="",
        type=candidate.get("type"),
        filename=filename or query_basename,
        url=open_url,
        download_url=download_urls[0],
        download_urls=download_urls,
        size=_resolve_file_size_bytes(candidate, download_urls),
        base_model=candidate.get("base_model") or candidate.get("baseModel"),
        tags=candidate.get("tags") or [],
        trained_words=[],
        images=[],
        creator=candidate.get("creator") or {},
        platform=candidate.get("platform") or candidate.get("source"),
        is_deleted=False,
        match_type="exact" if confidence == 100.0 else "similar",
        confidence=confidence,
        sha256=sha256,
        hash=sha256,
        hashes={"SHA256": sha256} if sha256 else {},
    )


def _resolve_civarchive_model_link(
    model_id: int,
    version_id: Optional[int],
    query: str,
    exact_only: bool = False,
    base_model_context: Optional[str] = None,
    allow_model_title_match: bool = False,
) -> Optional[Dict[str, Any]]:
    details = get_civarchive_model_details(
        model_id,
        version_id,
        prefer_page=True,
    )
    if not details:
        return None

    if allow_model_title_match:
        result = _find_model_title_match_in_model_details(
            model_id=model_id,
            model_details=details,
            title_query=query,
            base_model_context=base_model_context,
        )
        if result:
            return result

    return _build_result_from_model_details(
        details,
        query=query,
        exact_only=exact_only,
    )


def _resolve_hash_search_candidate_from_page(
    candidate: Dict[str, Any],
    sha256: str,
    query: str,
    exact_only: bool = False,
    base_model_context: Optional[str] = None,
    allow_model_title_match: bool = False,
    expected_model_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    page_text = _request_page_text(f"/sha256/{sha256.lower()}")
    hash_page_files = _extract_hash_page_files(page_text or "")
    model_links = _prefer_model_links_for_expected_type(
        _extract_model_links_from_html(page_text or ""),
        expected_model_type=expected_model_type,
    )
    for link in model_links[:HASH_PAGE_MODEL_LINK_LIMIT]:
        model_id = link["model_id"]
        version_id = link.get("version_id")
        details = get_civarchive_model_details(
            model_id,
            version_id,
            prefer_page=True,
        )
        if not details:
            continue

        result = None
        if allow_model_title_match:
            result = _find_model_title_match_in_model_details(
                model_id=model_id,
                model_details=details,
                title_query=query,
                base_model_context=base_model_context,
            )

        selected_version = details.get("selected_version")
        if not result and isinstance(selected_version, dict):
            selected_model_file = _select_model_details_file(
                selected_version.get("files") or [],
                query,
                sha256=sha256,
            )
            if selected_model_file:
                selected_model_file = _prefer_query_matching_mirror(
                    selected_model_file,
                    query,
                )
                confidence = calculate_archived_model_confidence(
                    query,
                    details.get("name", ""),
                    selected_version.get("name", ""),
                    selected_model_file.get("name")
                    or selected_model_file.get("filename")
                    or "",
                )
                result = _build_result_from_normalized_version(
                    model_details=details,
                    version=selected_version,
                    file_info=selected_model_file,
                    match_type="exact" if confidence == 100.0 else "similar",
                )
                if result:
                    result["confidence"] = confidence

            selected_file = None
            if not result:
                selected_file = _select_hash_page_file(
                    hash_page_files,
                    query,
                    model_id=model_id,
                    version_id=version_id,
                )
                if not selected_file:
                    selected_file = _select_hash_page_file(hash_page_files, query)
            if selected_file:
                result = _build_result_from_hash_page_file(
                    details,
                    selected_version,
                    selected_file,
                    query,
                    sha256=sha256,
                )

        if not result:
            result = _build_result_from_model_details(
                details,
                query=query,
                exact_only=exact_only,
            )

        if result:
            if exact_only and float(result.get("confidence") or 0) < 100.0:
                continue
            result.setdefault("sha256", sha256)
            result.setdefault("hash", sha256)
            hashes = result.get("hashes") if isinstance(result.get("hashes"), dict) else {}
            if sha256 and not hashes.get("SHA256") and not hashes.get("sha256"):
                hashes = {**hashes, "SHA256": sha256}
                result["hashes"] = hashes
            return result

    return _build_result_from_search_candidate(
        candidate,
        query,
        page_text=page_text or "",
        parsed={"sha256": sha256},
    )


def _resolve_search_candidate(
    candidate: Dict[str, Any],
    query: str,
    exact_only: bool = False,
    base_model_context: Optional[str] = None,
    allow_model_title_match: bool = False,
    model_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    parsed = parse_civarchive_url(candidate.get("url", ""))
    if not parsed:
        return None

    if parsed.get("sha256"):
        result = _resolve_hash_search_candidate_from_page(
            candidate,
            parsed["sha256"],
            query=query,
            exact_only=exact_only,
            base_model_context=base_model_context,
            allow_model_title_match=allow_model_title_match,
            expected_model_type=model_type,
        )
    elif parsed.get("model_id"):
        result = _resolve_civarchive_model_link(
            parsed["model_id"],
            parsed.get("version_id"),
            query=query,
            exact_only=exact_only,
            base_model_context=base_model_context,
            allow_model_title_match=allow_model_title_match,
        )
    else:
        result = None

    if result and not result.get("confidence"):
        result["confidence"] = calculate_archived_model_confidence(
            query,
            candidate.get("name", ""),
            "",
            result.get("filename", ""),
        )
    return result


def _is_hash_verified_exact_match(result: Optional[Dict[str, Any]], confidence: float) -> bool:
    if not result or confidence < 100.0:
        return False
    return bool(result.get("sha256") or result.get("hash"))




def _build_search_queries(filename: str) -> List[str]:
    return build_filename_search_queries(filename)


def search_civarchive(
    query: str,
    model_type: Optional[str] = None,
    limit: int = DEFAULT_CIVARCHIVE_CANDIDATE_LIMIT,
) -> List[Dict[str, Any]]:
    """
    Search CivArchive by model name or filename.
    """
    normalized_query = (query or "").strip()
    if not normalized_query:
        return []

    limit = max(1, min(int(limit), MAX_CIVARCHIVE_CANDIDATE_LIMIT))
    detail_limit = min(limit, SEARCH_RESULT_DETAIL_LIMIT)
    cache_key = f"search::{normalized_query.lower()}::{model_type or ''}::{limit}"
    if cache_key in _search_cache:
        return list(_search_cache[cache_key])

    results = []
    seen = set()
    candidates = _search_page(normalized_query, model_type=model_type)

    for candidate in candidates:
        if len(seen) >= detail_limit:
            break
        identity = _candidate_identity(candidate)
        if identity in seen:
            continue
        seen.add(identity)

        resolved = _resolve_search_candidate(
            candidate,
            normalized_query,
            model_type=model_type,
        )
        if not resolved:
            continue

        if resolved.get("confidence", 0) < 40:
            continue
        results.append(resolved)
        if len(results) >= detail_limit:
            break

    results.sort(
        key=lambda item: (
            item.get("confidence", 0),
            1 if item.get("match_type") == "exact" else 0,
        ),
        reverse=True,
    )
    _search_cache[cache_key] = list(results)
    return results


def search_civarchive_for_file(
    filename: str,
    model_type: Optional[str] = None,
    base_model_context: Optional[str] = None,
    exact_only: bool = False,
    limit: int = DEFAULT_CIVARCHIVE_CANDIDATE_LIMIT,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search CivArchive for the best downloadable match for a model filename.
    """
    normalized_filename = (filename or "").strip()
    if not normalized_filename:
        return None

    limit = max(1, min(int(limit), MAX_CIVARCHIVE_CANDIDATE_LIMIT))
    detail_limit = min(limit, SEARCH_RESULT_DETAIL_LIMIT)
    base_model_key = _normalize_base_model(base_model_context or "")
    cache_key = (
        f"file::{normalized_filename.lower()}::{model_type or ''}::{base_model_key}::{exact_only}::{limit}"
    )
    if cache_key in _search_cache:
        _report_progress(
            progress_callback,
            "cache",
            "Using CivArchive cache",
            86,
        )
        return _search_cache[cache_key]

    sha256 = _extract_sha256(normalized_filename)
    if sha256:
        _report_progress(
            progress_callback,
            "hash",
            "Resolving CivArchive hash",
            40,
            sha256=sha256,
        )
        result = resolve_civarchive_by_hash(
            sha256,
            query=normalized_filename,
            exact_only=exact_only,
            model_type=model_type,
        )
        _search_cache[cache_key] = result
        _report_progress(
            progress_callback,
            "done",
            "CivArchive checked",
            92,
            found=bool(result),
        )
        return result

    best_match = None
    best_confidence = 0.0
    best_rank = -9999.0
    seen = set()
    allow_model_title_match = not exact_only and not _has_known_model_extension(
        get_filename_from_path(normalized_filename)
    )

    try:
        search_queries = build_filename_search_queries(normalized_filename)
        query_count = max(1, len(search_queries))
        for query_index, search_query in enumerate(search_queries, start=1):
            query_percent = 30 + ((query_index - 1) / query_count) * 18
            _report_progress(
                progress_callback,
                "query",
                f"CivArchive query {query_index}/{query_count}",
                query_percent,
                query=search_query,
                query_index=query_index,
                query_count=query_count,
            )
            candidates = _search_page(search_query, model_type=model_type)
            _report_progress(
                progress_callback,
                "candidates",
                f"CivArchive candidates: {len(candidates)}",
                min(55, query_percent + 10),
                candidate_count=len(candidates),
                checked_candidate_count=len(seen),
            )
            # Pre-calculate preliminary confidence, filter, and sort candidates
            scored_candidates = []
            for candidate in candidates:
                candidate_name = candidate.get("name") or ""
                if not candidate_name:
                    continue
                prelim = calculate_archived_model_confidence(
                    normalized_filename,
                    candidate_name,
                )
                if prelim >= 35.0:
                    scored_candidates.append((prelim, candidate))

            # Sort by preliminary confidence descending
            scored_candidates.sort(key=lambda x: x[0], reverse=True)

            candidate_count = len(scored_candidates)
            for candidate_index, (prelim_confidence, candidate) in enumerate(scored_candidates, start=1):
                if len(seen) >= detail_limit:
                    break
                identity = _candidate_identity(candidate)
                if identity in seen:
                    continue

                checked_index = min(len(seen) + 1, detail_limit)

                # Throttling: sleep a bit between requests to stay under the rate limit
                if checked_index > 1:
                    time.sleep(0.6)

                _report_progress(
                    progress_callback,
                    "candidate",
                    f"Resolving CivArchive candidate {checked_index}/{detail_limit}",
                    58 + (checked_index / max(1, detail_limit)) * 30,
                    candidate_index=candidate_index,
                    candidate_count=candidate_count,
                    checked_candidate_count=checked_index,
                    candidate_limit=detail_limit,
                )
                seen.add(identity)

                resolved = _resolve_search_candidate(
                    candidate,
                    normalized_filename,
                    exact_only=exact_only,
                    base_model_context=base_model_context,
                    allow_model_title_match=allow_model_title_match,
                    model_type=model_type,
                )
                if not resolved:
                    continue

                if resolved.get("match_type") == "model_title":
                    confidence = float(
                        resolved.get("title_confidence")
                        or resolved.get("confidence")
                        or calculate_model_title_confidence(
                            normalized_filename,
                            resolved.get("name", ""),
                        )
                    )
                else:
                    confidence = calculate_archived_model_confidence(
                        normalized_filename,
                        resolved.get("name", ""),
                        resolved.get("version_name", ""),
                        resolved.get("filename", ""),
                    )
                    if exact_only and confidence < 100.0:
                        continue

                    resolved["confidence"] = confidence
                    resolved["match_type"] = "exact" if confidence == 100.0 else "similar"

                should_update, rank, base_model_matches = should_update_best_match(
                    confidence, resolved.get("base_model"), base_model_context, best_rank, exact_only
                )
                if exact_only and confidence < 100.0:
                    continue

                if should_update:
                    best_rank = rank
                    best_confidence = confidence
                    best_match = resolved

                if confidence == 100.0 and (
                    base_model_matches
                    or _is_hash_verified_exact_match(resolved, confidence)
                ):
                    _search_cache[cache_key] = best_match
                    _report_progress(
                        progress_callback,
                        "found",
                        "Found CivArchive match",
                        92,
                        confidence=confidence,
                        checked_candidate_count=len(seen),
                    )
                    return best_match

                if len(seen) >= detail_limit:
                    break

            if len(seen) >= detail_limit:
                break

            if best_match and (
                not base_model_context
                or _base_model_matches(best_match.get("base_model"), base_model_context)
            ):
                break
    except CivArchiveSearchError:
        raise
    except Exception as e:
        log.exception(f"CivArchive search error for {normalized_filename}: {e}")
        _report_progress(
            progress_callback,
            "error",
            f"CivArchive search error: {e}",
            100,
            status="error",
        )
        return None

    if best_match and best_confidence < 40:
        best_match = None
    if (
        best_match
        and base_model_context
        and not _base_model_matches(best_match.get("base_model"), base_model_context)
        and not _is_hash_verified_exact_match(best_match, best_confidence)
    ):
        best_match = None

    _search_cache[cache_key] = best_match
    _report_progress(
        progress_callback,
        "found" if best_match else "done",
        "Found CivArchive match" if best_match else "CivArchive checked",
        92,
        found=bool(best_match),
        confidence=best_confidence if best_match else None,
        checked_candidate_count=len(seen),
        candidate_limit=detail_limit,
    )
    return best_match

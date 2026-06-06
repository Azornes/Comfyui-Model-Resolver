"""
CivArchive Source Module

Search and resolve models from CivArchive.
"""

import html
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse

import requests

from ..matcher import calculate_similarity_with_normalization, normalize_filename
from ..log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_exception,
)

CIVARCHIVE_BASE_URL = "https://civarchive.com"
CIVARCHIVE_API_URL = f"{CIVARCHIVE_BASE_URL}/api"
CIVITAI_DOWNLOAD_URL_PREFIXES = (
    "https://civitai.com/api/download/",
    "https://civitai.red/api/download/",
)

DEFAULT_CIVARCHIVE_CANDIDATE_LIMIT = 10
MAX_CIVARCHIVE_CANDIDATE_LIMIT = 30

_search_cache: Dict[str, Any] = {}

REQUEST_HEADERS = {
    "accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/147.0.0.0 Safari/537.36"
    ),
}

CIVARCHIVE_TYPE_MAP = {
    "checkpoint": "Checkpoint",
    "checkpoints": "Checkpoint",
    "lora": "LORA",
    "loras": "LORA",
    "locon": "LoCon",
    "lycoris": "LoCon",
    "vae": "VAE",
    "controlnet": "Controlnet",
    "embedding": "TextualInversion",
    "embeddings": "TextualInversion",
    "textualinversion": "TextualInversion",
    "upscaler": "Upscaler",
    "upscale_models": "Upscaler",
    "workflow": "Workflows",
    "workflows": "Workflows",
}


class CivArchiveSearchError(Exception):
    """Raised when CivArchive cannot complete a search request."""


def clear_search_cache():
    """Clear cached CivArchive search results."""
    _search_cache.clear()


def is_civarchive_available() -> bool:
    """Return True when the CivArchive provider can be offered."""
    return True


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _size_kb_to_bytes(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(float(value) * 1024)
    except (TypeError, ValueError):
        return None


def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    return data if isinstance(data, dict) else payload


def _extract_next_data(html_text: str) -> Dict[str, Any]:
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html_text,
        flags=re.DOTALL,
    )
    if not match:
        return {}

    try:
        return json.loads(html.unescape(match.group(1)))
    except Exception as e:
        log_warn(f"CivArchive search JSON parse failed: {e}")
        return {}


def _request_json(
    path: str,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Optional[Dict[str, Any]]:
    url = f"{CIVARCHIVE_API_URL}{path}"
    try:
        response = requests.get(
            url,
            params={k: v for k, v in (params or {}).items() if v is not None},
            headers=REQUEST_HEADERS,
            timeout=timeout,
        )
    except Exception as e:
        log_warn(f"CivArchive API request failed: path={path}, error={e}")
        return None

    if response.status_code != 200:
        log_debug(
            f"CivArchive API returned {response.status_code}: path={path}, params={params}"
        )
        return None

    try:
        return response.json()
    except Exception as e:
        log_warn(f"CivArchive API JSON parse failed: path={path}, error={e}")
        return None


def _search_page(
    query: str,
    model_type: Optional[str] = None,
    timeout: int = 20,
) -> List[Dict[str, Any]]:
    params: Dict[str, Any] = {
        "q": query,
        "rating": "all",
        "platform": "all",
    }
    civarchive_type = CIVARCHIVE_TYPE_MAP.get(str(model_type or "").lower())
    if civarchive_type:
        params["type"] = civarchive_type

    try:
        response = requests.get(
            f"{CIVARCHIVE_BASE_URL}/search",
            params=params,
            headers=REQUEST_HEADERS,
            timeout=timeout,
        )
    except Exception as e:
        log_warn(f"CivArchive search request failed: query={query}, error={e}")
        raise CivArchiveSearchError(str(e)) from e

    if response.status_code != 200:
        log_warn(
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

    log_info(
        f"CivArchive search returned {len(results)} candidates for query={query}"
    )
    return [result for result in results if isinstance(result, dict)]


def parse_civarchive_url(url: str) -> Optional[Dict[str, Any]]:
    """Parse CivArchive URLs into sha256 or model/version identifiers."""
    if not url:
        return None

    parsed = urlparse(urljoin(CIVARCHIVE_BASE_URL, url))
    if parsed.netloc and "civarchive.com" not in parsed.netloc:
        return None

    sha_match = re.search(r"/sha256/([a-fA-F0-9]{64})", parsed.path)
    if sha_match:
        return {"sha256": sha_match.group(1).lower()}

    model_match = re.search(r"/models/(\d+)", parsed.path)
    if model_match:
        result: Dict[str, Any] = {"model_id": int(model_match.group(1))}
        query = parse_qs(parsed.query)
        version_id = query.get("modelVersionId", [None])[0]
        if version_id:
            result["version_id"] = _coerce_int(version_id)
        return result

    return None


def _extract_sha256(value: str) -> Optional[str]:
    if not value:
        return None
    direct = re.fullmatch(r"[a-fA-F0-9]{64}", value.strip())
    if direct:
        return direct.group(0).lower()
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
        "deletedAt": file_data.get("deletedAt") or file_data.get("deleted_at"),
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

    download_url = _normalize_download_url(file_data.get("downloadUrl"))
    name = file_data.get("name") or file_data.get("filename")

    if not download_url:
        for mirror in transformed_mirrors:
            if mirror.get("deletedAt") is None and mirror.get("url"):
                download_url = mirror["url"]
                break

    return {
        "id": file_data.get("id"),
        "name": name,
        "type": file_data.get("type"),
        "sizeKB": file_data.get("sizeKB"),
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
                    "sizeKB": top_file.get("sizeKB"),
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
    if not files:
        return None

    for file_info in files:
        if file_info.get("primary"):
            return file_info
    for file_info in files:
        if str(file_info.get("type", "")).lower() == "model":
            return file_info
    return files[0]


def _collect_download_urls(file_info: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    mirrors = file_info.get("mirrors") or []
    if not isinstance(mirrors, list):
        mirrors = [mirrors]

    for mirror in mirrors:
        if not isinstance(mirror, dict):
            continue
        if mirror.get("deletedAt") is not None:
            continue
        url = _normalize_download_url(mirror.get("url"))
        if url and url not in urls:
            urls.append(url)

    download_url = _normalize_download_url(file_info.get("downloadUrl"))
    if download_url and download_url not in urls:
        urls.append(download_url)

    non_civitai_urls = [
        url for url in urls if not url.startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)
    ]
    civitai_urls = [url for url in urls if url.startswith(CIVITAI_DOWNLOAD_URL_PREFIXES)]
    return non_civitai_urls + civitai_urls


def _calculate_confidence(
    query: str,
    model_name: str = "",
    version_name: str = "",
    filename: str = "",
) -> float:
    candidates = [value for value in [filename, model_name, version_name] if value]
    if not candidates:
        return 0.0

    query_norm = normalize_filename(query)
    best = 0.0
    for candidate in candidates:
        candidate_norm = normalize_filename(candidate)
        if query_norm == candidate_norm:
            return 100.0

        similarity = calculate_similarity_with_normalization(query, candidate)
        similarity_no_ext = calculate_similarity_with_normalization(
            os.path.splitext(query)[0],
            os.path.splitext(candidate)[0],
        )
        score = max(similarity, similarity_no_ext)
        if query_norm and candidate_norm and (
            query_norm in candidate_norm or candidate_norm in query_norm
        ):
            score = max(score, 0.85)
        best = max(best, score)

    return round(best * 100, 1)


def _normalize_base_model(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _base_model_matches(candidate: str, preferred: Optional[str]) -> bool:
    preferred_norm = _normalize_base_model(preferred or "")
    if not preferred_norm:
        return True

    candidate_norm = _normalize_base_model(candidate or "")
    if not candidate_norm:
        return False

    from .popular import load_base_model_aliases
    aliases = load_base_model_aliases()
    preferred_tokens = aliases.get(preferred_norm, [preferred_norm])
    return any(
        token and (token in candidate_norm or candidate_norm in token)
        for token in preferred_tokens
    )


def _base_model_score(candidate: str, preferred: Optional[str]) -> float:
    if not preferred:
        return 0.0
    return 1000.0 if _base_model_matches(candidate, preferred) else -1000.0


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
        confidence = _calculate_confidence(
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
        best_confidence = _calculate_confidence(
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

    tags = context.get("tags") or []
    if not isinstance(tags, list):
        tags = [tags] if tags else []

    trained_words = version.get("trainedWords") or version.get("trigger") or []
    if isinstance(trained_words, str):
        trained_words = [trained_words]
    elif not isinstance(trained_words, list):
        trained_words = []

    civarchive_url = (
        f"{CIVARCHIVE_BASE_URL}/models/{model_id}?modelVersionId={version_id}"
        if model_id and version_id
        else context.get("meta", {}).get("canonical")
        if isinstance(context.get("meta"), dict)
        else ""
    )

    return {
        "source": "civarchive",
        "model_id": model_id,
        "version_id": version_id,
        "name": model_name,
        "version_name": version_name,
        "type": context.get("type") or selected_file.get("type"),
        "filename": filename,
        "url": civarchive_url,
        "download_url": download_urls[0],
        "download_urls": download_urls,
        "size": _size_kb_to_bytes(selected_file.get("sizeKB")),
        "base_model": version.get("baseModel"),
        "tags": tags,
        "trained_words": trained_words,
        "images": version.get("images", []),
        "creator": {
            "username": context.get("creator_username") or context.get("username"),
            "name": context.get("creator_name"),
            "url": context.get("creator_url"),
        },
        "platform": context.get("platform") or context.get("platform_name"),
        "is_deleted": bool(context.get("deletedAt") or version.get("deletedAt")),
        "match_type": match_type,
        "confidence": best_confidence,
    }


def resolve_civarchive_by_hash(
    sha256: str,
    query: str = "",
    exact_only: bool = False,
) -> Optional[Dict[str, Any]]:
    """Resolve a model by SHA256 hash through CivArchive."""
    if not sha256:
        return None

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
) -> Optional[Dict[str, Any]]:
    """Resolve a model/version through CivArchive."""
    if model_id is None:
        return None

    params = {"modelVersionId": version_id} if version_id is not None else None
    payload = _request_json(f"/models/{model_id}", params=params)
    if not payload:
        return None

    return _build_result_from_payload(
        payload,
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


def _resolve_search_candidate(
    candidate: Dict[str, Any],
    query: str,
    exact_only: bool = False,
) -> Optional[Dict[str, Any]]:
    parsed = parse_civarchive_url(candidate.get("url", ""))
    if not parsed:
        return None

    if parsed.get("sha256"):
        result = resolve_civarchive_by_hash(
            parsed["sha256"],
            query=query,
            exact_only=exact_only,
        )
    elif parsed.get("model_id"):
        result = resolve_civarchive_model_version(
            parsed["model_id"],
            parsed.get("version_id"),
            query=query,
            exact_only=exact_only,
        )
    else:
        result = None

    if result and not result.get("confidence"):
        result["confidence"] = _calculate_confidence(
            query,
            candidate.get("name", ""),
            "",
            result.get("filename", ""),
        )
    return result


def _build_search_queries(filename: str) -> List[str]:
    basename = os.path.basename(filename or "").strip()
    stem = os.path.splitext(basename)[0].strip()
    simplified = re.sub(
        r"[-_]?(fp16|fp32|fp8|fp4|bf16|e4m3fn|scaled|pruned|emaonly|mixed|q4|q8)$",
        "",
        stem,
        flags=re.IGNORECASE,
    ).strip(" -_")

    queries = []
    for query in [basename, stem, simplified]:
        if query and query not in queries:
            queries.append(query)
    return queries


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
    cache_key = f"search::{normalized_query.lower()}::{model_type or ''}::{limit}"
    if cache_key in _search_cache:
        return list(_search_cache[cache_key])

    results = []
    seen = set()
    candidates = _search_page(normalized_query, model_type=model_type)

    for candidate in candidates:
        identity = _candidate_identity(candidate)
        if identity in seen:
            continue
        seen.add(identity)

        resolved = _resolve_search_candidate(candidate, normalized_query)
        if not resolved:
            continue

        if resolved.get("confidence", 0) < 40:
            continue
        results.append(resolved)
        if len(results) >= limit:
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
) -> Optional[Dict[str, Any]]:
    """
    Search CivArchive for the best downloadable match for a model filename.
    """
    normalized_filename = (filename or "").strip()
    if not normalized_filename:
        return None

    limit = max(1, min(int(limit), MAX_CIVARCHIVE_CANDIDATE_LIMIT))
    base_model_key = _normalize_base_model(base_model_context or "")
    cache_key = (
        f"file::{normalized_filename.lower()}::{model_type or ''}::{base_model_key}::{exact_only}::{limit}"
    )
    if cache_key in _search_cache:
        return _search_cache[cache_key]

    sha256 = _extract_sha256(normalized_filename)
    if sha256:
        result = resolve_civarchive_by_hash(
            sha256,
            query=normalized_filename,
            exact_only=exact_only,
        )
        _search_cache[cache_key] = result
        return result

    best_match = None
    best_confidence = 0.0
    best_rank = -9999.0
    seen = set()

    try:
        for search_query in _build_search_queries(normalized_filename):
            candidates = _search_page(search_query, model_type=model_type)
            for candidate in candidates:
                identity = _candidate_identity(candidate)
                if identity in seen:
                    continue
                seen.add(identity)

                resolved = _resolve_search_candidate(
                    candidate,
                    normalized_filename,
                    exact_only=exact_only,
                )
                if not resolved:
                    continue

                confidence = _calculate_confidence(
                    normalized_filename,
                    resolved.get("name", ""),
                    resolved.get("version_name", ""),
                    resolved.get("filename", ""),
                )
                if exact_only and confidence < 100.0:
                    continue

                resolved["confidence"] = confidence
                resolved["match_type"] = "exact" if confidence == 100.0 else "similar"
                base_model_matches = _base_model_matches(
                    resolved.get("base_model"), base_model_context
                )
                rank = confidence + _base_model_score(
                    resolved.get("base_model"), base_model_context
                )

                if rank > best_rank:
                    best_rank = rank
                    best_confidence = confidence
                    best_match = resolved

                if confidence == 100.0 and base_model_matches:
                    _search_cache[cache_key] = best_match
                    return best_match

                if len(seen) >= limit:
                    break

            if best_match and (
                not base_model_context
                or _base_model_matches(best_match.get("base_model"), base_model_context)
            ):
                break
    except CivArchiveSearchError:
        raise
    except Exception as e:
        log_exception(f"CivArchive search error for {normalized_filename}: {e}")
        return None

    if best_match and best_confidence < 40:
        best_match = None
    if best_match and base_model_context and not _base_model_matches(
        best_match.get("base_model"), base_model_context
    ):
        best_match = None

    _search_cache[cache_key] = best_match
    return best_match

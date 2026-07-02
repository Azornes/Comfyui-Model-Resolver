"""
CivitAI Source Module

Search and download models from CivitAI.
"""

import os
import re
import json
import hashlib
import requests
from typing import Dict, Any, Optional, List, Callable
from urllib.parse import urlparse, parse_qs, quote

from ..matcher import (
    calculate_filename_confidence,
    calculate_model_title_confidence,
    has_known_model_extension as _has_known_model_extension,
    normalize_base_model as _normalize_base_model,
    base_model_matches as _base_model_matches,
    base_model_score as _base_model_score,
)
from ..type_utils import (
    first_non_empty,
    CIVITAI_API_TYPE_MAP,
    select_primary_model_file,
    parse_size_to_bytes,
    get_version_sort_key,
    check_credential_http,
    DEFAULT_BROWSER_USER_AGENT,
    parse_civitai_model_path,
    normalize_model_image,
)
from ..progress import report_progress, get_progress_reporter
from ..path_utils import calculate_file_sha256, get_filename_from_path, read_json_safe
from ..log_system import create_module_logger
log = create_module_logger(__name__)


CIVITAI_API_URL = "https://civitai.com/api/v1"

# Cache for search results and URN resolutions
_search_cache: Dict[str, Any] = {}
_urn_cache: Dict[tuple[int, int], Dict[str, Any]] = {}
_hash_cache: Dict[str, Dict[str, Any]] = {}
DEFAULT_CIVITAI_CANDIDATE_LIMIT = 5
MAX_CIVITAI_CANDIDATE_LIMIT = 20
MODEL_TITLE_MATCH_THRESHOLD = 82.0






def clear_search_cache():
    """Clear cached CivitAI search, URN, and hash results."""
    global _search_cache, _urn_cache, _hash_cache
    _search_cache.clear()
    _urn_cache.clear()
    _hash_cache.clear()


_report_progress = get_progress_reporter("CivitAI progress callback")


def check_civitai_session_token(session_token: Optional[str]) -> Dict[str, Any]:
    """Check whether a CivitAI browser session token is accepted by civitai.com."""
    token = (session_token or "").strip()
    if not token:
        return {
            "success": False,
            "valid": False,
            "status": "missing",
            "message": "Paste a CivitAI session token first.",
        }

    headers = {
        "accept": "application/json",
        "Cookie": f"__Secure-civitai-token={token}",
        "user-agent": DEFAULT_BROWSER_USER_AGENT,
    }

    def get_user(data):
        return data.get("username") or data.get("name") or data.get("email") or ""

    return check_credential_http(
        "https://civitai.com/api/v1/me",
        headers=headers,
        success_message="Session token is valid.",
        get_username=get_user,
        error_msg_401_403="Session token is not accepted by CivitAI.",
    )


def check_civitai_api_key(api_key: Optional[str]) -> Dict[str, Any]:
    """Check whether a CivitAI API key is accepted by civitai.com."""
    key = (api_key or "").strip()
    if not key:
        return {
            "success": False,
            "valid": False,
            "status": "missing",
            "message": "Paste a CivitAI API key first.",
        }

    headers = {
        "accept": "application/json",
        "Authorization": f"Bearer {key}",
        "user-agent": DEFAULT_BROWSER_USER_AGENT,
    }

    def get_user(data):
        return data.get("username") or data.get("name") or data.get("email") or ""

    return check_credential_http(
        "https://civitai.com/api/v1/me",
        headers=headers,
        success_message="CivitAI API key is valid.",
        get_username=get_user,
        error_msg_401_403="CivitAI API key is not accepted.",
    )


def _build_civitai_result_from_version(
    model_id: int,
    model_name: str,
    model_type: str,
    version: Dict[str, Any],
    file_info: Dict[str, Any],
    tags: Optional[List[str]] = None,
    match_type: str = "exact",
) -> Dict[str, Any]:
    """Normalize CivitAI model/version/file data into the search result format."""
    version_id = version.get("id")
    hashes = file_info.get("hashes") if isinstance(file_info.get("hashes"), dict) else {}
    sha256 = file_info.get("sha256") or hashes.get("SHA256") or hashes.get("sha256")
    return {
        "source": "civitai",
        "model_id": model_id,
        "version_id": version_id,
        "name": model_name,
        "type": model_type,
        "filename": file_info.get("name", ""),
        "url": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}",
        "download_url": file_info.get("downloadUrl")
        or get_civitai_download_url(version_id),
        "size": file_info.get("sizeKB", 0) * 1024,
        "base_model": version.get("baseModel"),
        "tags": tags or [],
        "match_type": match_type,
        "sha256": sha256,
        "hashes": hashes,
    }







def _find_model_title_match_in_model(
    model_id: int,
    model_data: Dict[str, Any],
    title_query: str,
    api_key: Optional[str] = None,
    base_model_context: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """For extensionless workflow values, resolve by CivitAI model page title."""
    model_name = model_data.get("name", "")
    title_confidence = calculate_model_title_confidence(title_query, model_name)
    if title_confidence < MODEL_TITLE_MATCH_THRESHOLD:
        log.debug(
            f"CivitAI title candidate rejected: model_id={model_id}, query={title_query}, model_name={model_name}, confidence={title_confidence}"
        )
        return None

    versions = [
        version
        for version in (model_data.get("modelVersions") or [])
        if isinstance(version, dict)
    ]
    if not versions:
        return None

    if base_model_context:
        versions = [
            version
            for version in versions
            if _base_model_matches(version.get("baseModel"), base_model_context)
        ]
        if not versions:
            log.debug(
                f"CivitAI title candidate rejected by base model: model_id={model_id}, base={base_model_context}"
            )
            return None

    versions = sorted(versions, key=get_version_sort_key, reverse=True)

    for version in versions:
        file_info = select_primary_model_file(version.get("files") or [])
        if not file_info:
            continue

        result = _build_civitai_result_from_version(
            model_id=model_id,
            model_name=model_name,
            model_type=model_data.get("type", ""),
            version=version,
            file_info=file_info,
            tags=model_data.get("tags", []),
            match_type="model_title",
        )
        result["confidence"] = title_confidence
        result["title_confidence"] = title_confidence
        result["version_name"] = version.get("name", "")
        log.info(
            f"CivitAI model-title match: query={title_query}, model_id={model_id}, model_name={model_name}, version_id={result.get('version_id')}, filename={result.get('filename')}, confidence={title_confidence}, base={result.get('base_model')}"
        )
        return result

    return None



def _find_matching_file_in_versions(
    versions: List[Dict[str, Any]],
    filename: str,
    exact_only: bool = False,
) -> Optional[Dict[str, Any]]:
    """Search all versions/files for an exact or partial filename match."""
    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    best_match = None
    best_confidence = 0.0

    for version in versions:
        version_id = version.get("id")
        files = version.get("files", [])
        log.debug(
            f"CivitAI checking version_id={version_id} with {len(files)} files"
        )

        for file_info in files:
            file_name = file_info.get("name", "")
            if not file_name:
                continue

            file_name_lower = file_name.lower()
            file_base = os.path.splitext(file_name_lower)[0]

            if file_name_lower == filename_lower:
                return {"version": version, "file_info": file_info, "match_type": "exact"}

            if not exact_only and (
                filename_base in file_base or file_base in filename_base
            ):
                return {
                    "version": version,
                    "file_info": file_info,
                    "match_type": "partial",
                }

            if not exact_only:
                confidence = calculate_filename_confidence(filename, file_name)
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match = {
                        "version": version,
                        "file_info": file_info,
                        "match_type": "similar",
                        "confidence": confidence,
                    }

    if best_match and best_confidence >= 50.0:
        return best_match

    return None


def _extract_civitai_red_candidates(html: str, limit: int = 5) -> List[Dict[str, int]]:
    """Extract model/version candidates from civitai.red search results HTML."""
    candidates: List[Dict[str, int]] = []
    seen = set()

    for match in re.finditer(r"/models/(\d+)(?:\?modelVersionId=(\d+))?", html):
        model_id = int(match.group(1))
        version_id = int(match.group(2)) if match.group(2) else None
        key = (model_id, version_id)
        if key in seen:
            continue
        seen.add(key)
        candidates.append({"model_id": model_id, "version_id": version_id})
        if len(candidates) >= limit:
            break

    return candidates


def _extract_trpc_model_candidates(
    payload: Any, limit: int = 5
) -> List[Dict[str, Optional[int]]]:
    """Extract model/version candidates from a tRPC JSON response."""
    candidates: List[Dict[str, Optional[int]]] = []
    seen = set()

    items = (
        payload.get("result", {})
        .get("data", {})
        .get("json", {})
        .get("items", [])
    )

    if not isinstance(items, list):
        return candidates

    for item in items:
        if not isinstance(item, dict):
            continue

        model_id = item.get("id")
        version = item.get("version", {})
        version_id = version.get("id") if isinstance(version, dict) else None

        if not isinstance(model_id, int):
            continue

        key = (model_id, version_id if isinstance(version_id, int) else None)
        if key in seen:
            continue

        seen.add(key)
        candidates.append(
            {
                "model_id": model_id,
                "version_id": version_id if isinstance(version_id, int) else None,
            }
        )

        if len(candidates) >= limit:
            break

    return candidates


def _search_civitai_trpc_candidates(
    filename: str,
    model_type: Optional[str] = None,
    session_token: Optional[str] = None,
    timeout: int = 15,
    limit: int = 5,
) -> List[Dict[str, Optional[int]]]:
    """Try CivitAI.red tRPC search endpoint and log the raw outcome for diagnostics."""
    input_payload = {
        "json": {
            "period": "Month",
            "periodMode": "stats",
            "sort": "Highest Rated",
            "query": filename,
            "pending": False,
            "browsingLevel": 28,
            "excludedTagIds": [
                415792,
                426772,
                5351,
                5161,
                5162,
                5188,
                5249,
                306619,
                5351,
                154326,
                161829,
                163032,
                130818,
                130820,
                133182,
            ],
            "disablePoi": True,
            "disableMinor": True,
            "limit": limit,
            "authed": True,
        },
        "meta": {"values": {"cursor": ["undefined"]}},
    }
    civitai_type = CIVITAI_API_TYPE_MAP.get(str(model_type).lower()) if model_type else None
    if civitai_type:
        input_payload["json"]["types"] = [civitai_type]

    url = (
        "https://civitai.red/api/trpc/model.getAll?input="
        + quote(json.dumps(input_payload, separators=(",", ":")))
    )
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "referer": f"https://civitai.red/models?query={quote(filename)}",
        "user-agent": DEFAULT_BROWSER_USER_AGENT,
        "x-client": "web",
        "x-client-version": "5.0.1657",
    }
    if session_token:
        headers["Cookie"] = f"__Secure-civitai-token={session_token}"

    log.info(
        f"CivitAI tRPC search start: filename={filename}, model_type={model_type}, session_token={'yes' if session_token else 'no'}, url={url}"
    )

    try:
        response = requests.get(url, headers=headers, timeout=timeout)
    except Exception as e:
        log.warning(f"CivitAI tRPC request failed for filename={filename}: {e}")
        return []

    text_preview = response.text[:800].replace("\n", " ").replace("\r", " ")
    log.info(
        f"CivitAI tRPC response: status={response.status_code}, content_type={response.headers.get('content-type')}, text_preview={text_preview}"
    )

    if response.status_code != 200:
        return []

    try:
        payload = response.json()
    except Exception as e:
        log.warning(f"CivitAI tRPC JSON parse failed for filename={filename}: {e}")
        return []

    candidates = _extract_trpc_model_candidates(payload, limit=limit)
    log.info(
        f"CivitAI tRPC extracted {len(candidates)} candidates for filename={filename}: {candidates}"
    )
    return candidates


def _search_civitai_red_candidates(
    filename: str, timeout: int = 15, limit: int = 5
) -> List[Dict[str, int]]:
    """Search civitai.red by full filename and return model/version candidates."""
    search_url = f"https://civitai.red/models?query={quote(filename)}"
    log.info(f"CivitAI.red search start: filename={filename}, url={search_url}")

    response = requests.get(search_url, timeout=timeout)
    if response.status_code != 200:
        log.warning(
            f"CivitAI.red search returned {response.status_code} for filename={filename}"
        )
        return []

    candidates = _extract_civitai_red_candidates(response.text, limit=limit)
    log.info(
        f"CivitAI.red search extracted {len(candidates)} candidates for filename={filename}"
    )
    return candidates


def _find_civitai_file_in_model(
    model_id: int,
    filename: str,
    api_key: Optional[str] = None,
    exact_only: bool = False,
    preferred_version_id: Optional[int] = None,
    base_model_context: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Load one CivitAI model and search all its versions for the requested file."""
    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    allow_model_title_match = not exact_only and not _has_known_model_extension(
        get_filename_from_path(filename)
    )

    def build_result_from_resolved_version(
        resolved: Dict[str, Any], version_id: int
    ) -> Dict[str, Any]:
        expected_filename = resolved.get("expected_filename", "")
        primary_file = None
        for file_info in resolved.get("files", []):
            if file_info.get("name") == expected_filename:
                primary_file = file_info
                break
        if primary_file is None:
            primary_file = (resolved.get("files") or [{}])[0]

        hashes = primary_file.get("hashes") if isinstance(primary_file.get("hashes"), dict) else {}
        sha256 = primary_file.get("sha256") or hashes.get("SHA256") or hashes.get("sha256")

        return {
            "source": "civitai",
            "model_id": model_id,
            "version_id": version_id,
            "name": resolved.get("model_name", ""),
            "type": "",
            "filename": expected_filename,
            "url": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}",
            "download_url": get_civitai_download_url(version_id, api_key),
            "size": primary_file.get("size"),
            "base_model": resolved.get("base_model"),
            "tags": resolved.get("tags", []),
            "match_type": "exact",
            "confidence": calculate_filename_confidence(
                filename, expected_filename
            ),
            "sha256": sha256,
            "hashes": hashes,
        }

    def resolved_version_matches(resolved: Dict[str, Any]) -> bool:
        expected_filename = str(resolved.get("expected_filename", "")).lower()
        expected_base = os.path.splitext(expected_filename)[0]
        log.debug(
            f"CivitAI resolved version filename check: expected_filename={resolved.get('expected_filename')}, target_filename={filename}"
        )
        if expected_filename == filename_lower:
            return True
        if not exact_only and (
            filename_base in expected_base or expected_base in filename_base
        ):
            return True
        return False

    if preferred_version_id is not None:
        resolved = resolve_urn(model_id, preferred_version_id, api_key)
        if resolved:
            if resolved_version_matches(resolved) and _base_model_matches(
                resolved.get("base_model"), base_model_context
            ):
                return build_result_from_resolved_version(resolved, preferred_version_id)

    best_resolved_result = None
    best_resolved_confidence = 0.0

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = requests.get(
        f"{CIVITAI_API_URL}/models/{model_id}", headers=headers, timeout=15
    )
    if response.status_code != 200:
        log.warning(f"CivitAI model lookup returned {response.status_code} for model_id={model_id}")
        return None

    data = response.json()
    versions = data.get("modelVersions", [])

    if allow_model_title_match:
        title_match = _find_model_title_match_in_model(
            model_id=model_id,
            model_data=data,
            title_query=filename,
            api_key=api_key,
            base_model_context=base_model_context,
        )
        if title_match:
            return title_match

    if preferred_version_id is not None:
        preferred = [v for v in versions if v.get("id") == preferred_version_id]
        others = [v for v in versions if v.get("id") != preferred_version_id]
        versions = preferred + others

    log.debug(
        f"CivitAI model lookup model_id={model_id} returned {len(versions)} versions"
    )

    for version in versions:
        version_id = version.get("id")
        if not version_id:
            continue

        resolved = resolve_urn(model_id, version_id, api_key)
        if resolved:
            if resolved_version_matches(resolved) and _base_model_matches(
                resolved.get("base_model"), base_model_context
            ):
                return build_result_from_resolved_version(resolved, version_id)

            if not exact_only:
                expected_filename = resolved.get("expected_filename", "")
                confidence = calculate_filename_confidence(filename, expected_filename)
                ranking_score = confidence + _base_model_score(
                    resolved.get("base_model"), base_model_context
                )
                log.debug(
                    f"CivitAI resolved version confidence: model_id={model_id}, version_id={version_id}, expected_filename={expected_filename}, confidence={confidence}"
                )
                if ranking_score > best_resolved_confidence:
                    best_resolved_confidence = ranking_score
                    best_resolved_result = build_result_from_resolved_version(
                        resolved, version_id
                    )
                    best_resolved_result["match_type"] = "similar"
                    best_resolved_result["confidence"] = confidence

        files = version.get("files", [])
        file_names = [f.get("name", "") for f in files if isinstance(f, dict)]
        log.debug(
            f"CivitAI version file names: model_id={model_id}, version_id={version_id}, files={file_names}"
        )

    if best_resolved_result and best_resolved_confidence >= 50.0:
        log.info(
            f"CivitAI best probable match: model_id={model_id}, version_id={best_resolved_result.get('version_id')}, filename={best_resolved_result.get('filename')}, confidence={best_resolved_confidence}"
        )
        return best_resolved_result

    match = _find_matching_file_in_versions(versions, filename, exact_only=exact_only)
    if match:
        version = match["version"]
        file_info = match["file_info"]
        result = _build_civitai_result_from_version(
            model_id=model_id,
            model_name=data.get("name", ""),
            model_type=data.get("type", ""),
            version=version,
            file_info=file_info,
            tags=data.get("tags", []),
            match_type=match["match_type"],
        )
        result["confidence"] = match.get(
            "confidence",
            calculate_filename_confidence(filename, result.get("filename", "")),
        )
        if match["match_type"] == "similar":
            log.info(
                f"CivitAI version-list probable match: model_id={model_id}, version_id={result.get('version_id')}, filename={result.get('filename')}, confidence={result['confidence']}"
            )
        if _base_model_matches(result.get("base_model"), base_model_context):
            return result
        if not base_model_context:
            return result

    return None



def parse_civitai_url(url: str) -> Optional[Dict[str, Any]]:
    """
    Parse a CivitAI URL to extract model/version info.
    """
    parsed = urlparse(url)
    if "civitai.com" not in parsed.netloc:
        return None

    if "/api/download/models/" in parsed.path:
        match = re.search(r"/api/download/models/(\d+)", parsed.path)
        if match:
            return {"version_id": int(match.group(1))}

    return parse_civitai_model_path(parsed.path, parsed.query)


def get_civitai_download_url(version_id: int, api_key: Optional[str] = None) -> str:
    """Get download URL for a CivitAI model version."""
    url = f"https://civitai.com/api/download/models/{version_id}"
    if api_key:
        url += f"?token={api_key}"
    return url


def search_civitai_for_file(
    filename: str,
    api_key: Optional[str] = None,
    exact_only: bool = False,
    model_type: Optional[str] = None,
    base_model_context: Optional[str] = None,
    session_token: Optional[str] = None,
    candidate_limit: int = DEFAULT_CIVITAI_CANDIDATE_LIMIT,
    use_trpc_search: bool = True,
    use_html_fallback: bool = True,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search CivitAI for a specific model file.
    Returns the first model that actually has this exact filename.

    Args:
        filename: Exact filename to search for
        api_key: Optional API key
        exact_only: If True, only return exact filename matches (for downloads).
                   If False, also try partial matching (for local file resolution).

    Returns:
        Dict with download info if found, None otherwise
    """
    global _search_cache

    candidate_limit = max(1, min(int(candidate_limit), MAX_CIVITAI_CANDIDATE_LIMIT))
    session_key = "session" if session_token else "anon"
    model_type_key = str(model_type or "").lower()
    base_model_key = _normalize_base_model(base_model_context or "")
    methods_key = f"trpc{int(bool(use_trpc_search))}_html{int(bool(use_html_fallback))}"
    cache_key = (
        f"civit_{filename}_exact{exact_only}_type{model_type_key}_base{base_model_key}_session{session_key}_limit{candidate_limit}_{methods_key}"
    )
    if cache_key in _search_cache:
        log.debug(f"CivitAI search cache hit for {filename} (exact_only={exact_only})")
        _report_progress(
            progress_callback,
            "cache",
            "Using CivitAI cache",
            86,
        )
        return _search_cache[cache_key]

    try:
        # Prefer the CivitAI.red tRPC search because it is much closer to what
        # the browser search UI returns than the broad public /models API.
        if use_trpc_search:
            _report_progress(
                progress_callback,
                "trpc",
                "Searching CivitAI tRPC",
                32,
            )
        trpc_candidates = (
            _search_civitai_trpc_candidates(
                filename,
                model_type=model_type,
                session_token=session_token,
                limit=candidate_limit,
            )
            if use_trpc_search
            else []
        )
        _report_progress(
            progress_callback,
            "trpc_candidates",
            f"CivitAI tRPC candidates: {len(trpc_candidates)}",
            42,
            candidate_count=len(trpc_candidates),
        )
        candidates_to_check: List[Dict[str, Optional[int]]] = []
        seen_candidates = set()

        def add_candidates(candidates: List[Dict[str, Optional[int]]]) -> None:
            for candidate in candidates:
                key = (candidate.get("model_id"), candidate.get("version_id"))
                if key in seen_candidates:
                    continue
                seen_candidates.add(key)
                candidates_to_check.append(candidate)
                if len(candidates_to_check) >= candidate_limit:
                    break

        add_candidates(trpc_candidates)

        if use_html_fallback and len(candidates_to_check) < candidate_limit:
            _report_progress(
                progress_callback,
                "html",
                "Searching CivitAI HTML fallback",
                50,
            )
            html_candidates = _search_civitai_red_candidates(
                filename, limit=candidate_limit
            )
            add_candidates(html_candidates)
        else:
            html_candidates = []
        _report_progress(
            progress_callback,
            "html_candidates",
            f"CivitAI HTML candidates: {len(html_candidates)}",
            58,
            candidate_count=len(html_candidates),
        )
        _report_progress(
            progress_callback,
            "candidates",
            f"CivitAI candidates to check: {len(candidates_to_check)}",
            60,
            candidate_count=len(candidates_to_check),
            candidate_limit=candidate_limit,
        )

        best_result = None
        best_confidence = 0.0

        total_candidates = len(candidates_to_check)
        for candidate_index, candidate in enumerate(candidates_to_check, start=1):
            model_id = candidate["model_id"]
            version_id = candidate.get("version_id")
            _report_progress(
                progress_callback,
                "candidate",
                f"Checking CivitAI candidate {candidate_index}/{total_candidates}",
                62 + (candidate_index / max(1, total_candidates)) * 24,
                model_id=model_id,
                version_id=version_id,
                candidate_index=candidate_index,
                candidate_count=total_candidates,
            )
            log.info(
                f"CivitAI candidate check: model_id={model_id}, preferred_version_id={version_id}, filename={filename}"
            )
            result = _find_civitai_file_in_model(
                model_id=model_id,
                filename=filename,
                api_key=api_key,
                exact_only=exact_only,
                preferred_version_id=version_id,
                base_model_context=base_model_context,
            )
            if result:
                confidence = float(result.get("confidence") or 0.0)
                if confidence >= 100.0:
                    _search_cache[cache_key] = result
                    _report_progress(
                        progress_callback,
                        "found",
                        "Found exact CivitAI match",
                        92,
                        model_id=result.get("model_id"),
                        version_id=result.get("version_id"),
                        confidence=confidence,
                    )
                    log.info(
                        f"Found exact CivitAI match for {filename}: model_id={result.get('model_id')}, version_id={result.get('version_id')}, candidate_limit={candidate_limit}"
                    )
                    return result
                if confidence > best_confidence:
                    best_result = result
                    best_confidence = confidence

        if best_result:
            _search_cache[cache_key] = best_result
            _report_progress(
                progress_callback,
                "found",
                "Found CivitAI match",
                92,
                model_id=best_result.get("model_id"),
                version_id=best_result.get("version_id"),
                confidence=best_confidence,
            )
            log.info(
                f"Found best CivitAI match for {filename}: model_id={best_result.get('model_id')}, version_id={best_result.get('version_id')}, confidence={best_confidence}, candidate_limit={candidate_limit}"
            )
            return best_result

        # Not found
        _search_cache[cache_key] = None
        _report_progress(
            progress_callback,
            "done",
            "CivitAI checked",
            92,
            trpc_candidate_count=len(trpc_candidates),
            html_candidate_count=len(html_candidates),
            checked_candidate_count=len(candidates_to_check),
            candidate_limit=candidate_limit,
        )
        log.info(
            f"CivitAI search no result: filename={filename}, trpc_candidates={len(trpc_candidates)}, html_candidates={len(html_candidates)}, checked_candidates={len(candidates_to_check)}, candidate_limit={candidate_limit}"
        )
        return None

    except Exception as e:
        log.exception(f"CivitAI search error for {filename}: {e}")
        _report_progress(
            progress_callback,
            "error",
            f"CivitAI search error: {e}",
            100,
            status="error",
        )
        return None


def search_civitai(
    query: str,
    model_type: Optional[str] = None,
    limit: int = 10,
    api_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search CivitAI for models (general search).
    Returns models that might be relevant.
    """
    results = []

    try:
        params = {"query": query, "limit": limit, "nsfw": "false"}

        if model_type:
            civitai_type = CIVITAI_API_TYPE_MAP.get(model_type.lower())
            if civitai_type:
                params["types"] = civitai_type

        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        response = requests.get(
            f"{CIVITAI_API_URL}/models", params=params, headers=headers, timeout=15
        )

        if response.status_code == 200:
            data = response.json()

            for model in data.get("items", []):
                model_id = model.get("id")
                model_name = model.get("name", "")
                model_type = model.get("type", "")

                versions = model.get("modelVersions", [])
                if versions:
                    latest = versions[0]
                    version_id = latest.get("id")

                    files = latest.get("files", [])
                    primary_file = None
                    for f in files:
                        if f.get("primary", False) or f.get("type") == "Model":
                            primary_file = f
                            break

                    if not primary_file and files:
                        primary_file = files[0]

                    result = {
                        "source": "civitai",
                        "model_id": model_id,
                        "version_id": version_id,
                        "name": model_name,
                        "type": model_type,
                        "url": f"https://civitai.com/models/{model_id}",
                        "download_url": get_civitai_download_url(version_id, api_key),
                        "downloads": model.get("stats", {}).get("downloadCount", 0),
                        "base_model": latest.get("baseModel"),
                        "tags": model.get("tags", []),
                    }

                    if primary_file:
                        result["filename"] = primary_file.get("name", "")
                        result["size"] = primary_file.get("sizeKB", 0) * 1024

                    results.append(result)

    except Exception as e:
        log.error(f"CivitAI search error: {e}")

    return results


def _normalize_civitai_file(
    file_info: Dict[str, Any],
    model_id: Optional[int],
    version_id: Optional[int],
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    hashes = file_info.get("hashes") if isinstance(file_info.get("hashes"), dict) else {}
    return {
        "id": file_info.get("id"),
        "name": file_info.get("name") or file_info.get("filename"),
        "type": file_info.get("type"),
        "size": file_info.get("sizeKB", 0) * 1024 if file_info.get("sizeKB") else file_info.get("size"),
        "download_url": file_info.get("downloadUrl") or (
            get_civitai_download_url(version_id, api_key) if version_id else None
        ),
        "primary": bool(file_info.get("primary", False)),
        "sha256": file_info.get("sha256") or hashes.get("SHA256") or hashes.get("sha256"),
        "hashes": hashes,
        "metadata": file_info.get("metadata") or {},
        "model_id": model_id,
        "version_id": version_id,
    }


def get_civitai_model_details(
    model_id: int,
    version_id: Optional[int] = None,
    api_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Fetch and normalize full CivitAI model details for the resolver UI."""
    if not model_id:
        return None

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    response = requests.get(
        f"{CIVITAI_API_URL}/models/{model_id}",
        headers=headers,
        timeout=20,
    )
    if response.status_code != 200:
        log.warning(f"CivitAI model details returned {response.status_code}: model_id={model_id}")
        return None

    data = response.json()
    versions = data.get("modelVersions") or []
    normalized_versions = []
    selected_version = None

    for version in versions:
        if not isinstance(version, dict):
            continue

        current_version_id = version.get("id")
        files = [
            _normalize_civitai_file(file_info, model_id, current_version_id, api_key)
            for file_info in (version.get("files") or [])
            if isinstance(file_info, dict)
        ]
        normalized = {
            "id": current_version_id,
            "name": version.get("name") or "",
            "base_model": version.get("baseModel"),
            "published_at": version.get("publishedAt"),
            "updated_at": version.get("updatedAt"),
            "description": version.get("description") or "",
            "trained_words": _extract_trained_words(version),
            "clip_skip": version.get("clipSkip"),
            "stats": version.get("stats") or {},
            "files": files,
            "images": _extract_model_images(version),
            "url": f"https://civitai.com/models/{model_id}?modelVersionId={current_version_id}",
        }
        normalized_versions.append(normalized)
        if version_id and str(current_version_id) == str(version_id):
            selected_version = normalized

    if not selected_version and normalized_versions:
        selected_version = normalized_versions[0]

    selected_images = selected_version.get("images", []) if selected_version else []
    return {
        "source": "civitai",
        "model_id": model_id,
        "version_id": selected_version.get("id") if selected_version else version_id,
        "name": data.get("name") or "",
        "type": data.get("type") or "",
        "description": data.get("description") or "",
        "tags": data.get("tags") or [],
        "stats": data.get("stats") or {},
        "creator": data.get("creator") or {},
        "url": f"https://civitai.com/models/{model_id}",
        "version_url": selected_version.get("url") if selected_version else f"https://civitai.com/models/{model_id}",
        "versions": normalized_versions,
        "selected_version": selected_version,
        "images": selected_images,
    }


def _enrich_model_info_with_details(
    result: Dict[str, Any],
    model_id: Optional[int],
    version_id: Optional[int],
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Fill hash lookup results with the fuller /models/{id} payload when useful."""
    if not result or not model_id:
        return result

    needs_details = (
        not result.get("images")
        or not result.get("description")
        or not result.get("model_description")
        or not result.get("tags")
    )
    if not needs_details:
        return result

    try:
        details = get_civitai_model_details(model_id, version_id, api_key)
    except Exception as exc:
        log.debug(f"CivitAI details enrichment failed for model_id={model_id}: {exc}")
        return result

    if not details:
        return result

    selected_version = _as_metadata_dict(details.get("selected_version"))
    result["model_name"] = result.get("model_name") or details.get("name")
    result["model_type"] = result.get("model_type") or details.get("type")
    result["description"] = (
        result.get("description")
        or selected_version.get("description")
        or details.get("description")
        or ""
    )
    result["model_description"] = (
        result.get("model_description")
        or details.get("description")
        or ""
    )
    result["tags"] = result.get("tags") or details.get("tags") or []
    result["images"] = result.get("images") or details.get("images") or []
    result["version_url"] = result.get("version_url") or details.get("version_url")
    result["url"] = result.get("url") or details.get("url")
    return result


def search_civitai_by_hash(
    hash_value: str, api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Look up a model by file hash on CivitAI."""
    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        response = requests.get(
            f"{CIVITAI_API_URL}/model-versions/by-hash/{hash_value}",
            headers=headers,
            timeout=15,
        )

        if response.status_code == 200:
            data = response.json()

            model_id = data.get("modelId")
            version_id = data.get("id")
            files = data.get("files", [])
            primary_file = files[0] if files else {}

            return {
                "source": "civitai",
                "model_id": model_id,
                "version_id": version_id,
                "name": data.get("model", {}).get("name", ""),
                "url": f"https://civitai.com/models/{model_id}",
                "download_url": get_civitai_download_url(version_id, api_key),
                "filename": primary_file.get("name", ""),
                "size": primary_file.get("sizeKB", 0) * 1024,
            }

    except Exception as e:
        log.error(f"CivitAI hash lookup error: {e}")

    return None


def resolve_urn(
    model_id: int, version_id: int, api_key: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Resolve URN model_id/version_id to model info and expected filename.

    Args:
        model_id: CivitAI model ID
        version_id: CivitAI version ID
        api_key: Optional API key

    Returns:
        Dict with model name and primary filename, or None
    """
    cache_key = (model_id, version_id)
    if cache_key in _urn_cache:
        return _urn_cache[cache_key]

    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        url = f"{CIVITAI_API_URL}/models/{model_id}"
        params = {"modelVersionId": version_id}

        response = requests.get(url, headers=headers, params=params, timeout=15)

        if response.status_code != 200:
            log.warning(f"CivitAI URN resolve failed: {response.status_code}")
            _urn_cache[cache_key] = None
            return None

        data = response.json()
        versions = data.get("modelVersions", [])

        if not versions:
            log.warning(f"No versions found for model {model_id}/version {version_id}")
            _urn_cache[cache_key] = None
            return None

        # Get specific version
        target_version = None
        for v in versions:
            if v.get("id") == version_id:
                target_version = v
                break

        if not target_version:
            log.warning(f"Version {version_id} not found in model {model_id}")
            _urn_cache[cache_key] = None
            return None

        files = target_version.get("files", [])
        primary_file = None

        # Prefer primary file or type=='Model'
        for f in files:
            if f.get("primary") or f.get("type") == "Model":
                primary_file = f
                break

        if not primary_file and files:
            primary_file = files[0]  # Fallback to first

        if not primary_file:
            log.warning(f"No files found for version {version_id}")
            _urn_cache[cache_key] = None
            return None

        result = {
            "model_name": data.get("name", "Unknown"),
            "version_name": target_version.get("name", "Unknown"),
            "expected_filename": primary_file.get("name", "Unknown"),
            "base_model": target_version.get("baseModel"),
            "tags": data.get("tags", []),
            "files": [
                {
                    "name": f.get("name"),
                    "size": f.get("sizeKB", 0) * 1024,
                    "sha256": (
                        f.get("sha256")
                        or (f.get("hashes") or {}).get("SHA256")
                        or (f.get("hashes") or {}).get("sha256")
                    ),
                    "hashes": f.get("hashes") or {},
                }
                for f in files
            ],
        }

        _urn_cache[cache_key] = result
        log.info(
            f"CivitAI resolved urn={model_id}@{version_id} file={result['expected_filename']}"
        )
        return result

    except Exception as e:
        log.error(f"CivitAI URN resolve error for {model_id}@{version_id}: {e}")
        _urn_cache[cache_key] = None
        return None




def get_model_info_by_hash(
    file_hash: str, api_key: Optional[str] = None, use_cache: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Look up a model on CivitAI using its sha256 hash.
    Uses the CivitAI API endpoint: /api/v1/model-versions/by-hash/{hash}

    Args:
        file_hash: SHA256 hash of the model file
        api_key: Optional CivitAI API key
        use_cache: Whether to use cached results

    Returns:
        Dict with model info from CivitAI, or None if not found
    """
    global _hash_cache

    if not file_hash:
        return None

    cache_key = f"hash_{file_hash}"

    if use_cache and cache_key in _hash_cache:
        return _hash_cache[cache_key]

    api_url = f"{CIVITAI_API_URL}/model-versions/by-hash/{file_hash}"

    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        response = requests.get(api_url, headers=headers, timeout=15)

        if response.status_code == 200:
            data = response.json()

            # Extract useful info from the response
            model_info = data.get("model", {})
            version_info = data

            # Get model_id from top level or nested model object
            model_id = data.get("modelId") or model_info.get("id")

            # Extract images with metadata
            images = _extract_model_images(version_info)

            result = {
                "source": "civitai",
                "model_id": model_id,
                "model_name": model_info.get("name"),
                "model_type": model_info.get("type"),
                "version_id": version_info.get("id"),
                "version_name": version_info.get("name"),
                "sha256": file_hash,
                "url": f"https://civitai.com/models/{model_id}" if model_id else None,
                "version_url": f"https://civitai.com/models/{model_id}?modelVersionId={version_info.get('id')}"
                if model_id
                else None,
                "download_url": version_info.get("downloadUrl"),
                "base_model": version_info.get("baseModel"),
                "tags": model_info.get("tags", []),
                "trained_words": _extract_trained_words(version_info),
                "images": images,
                "clip_skip": version_info.get("clipSkip"),
                "description": version_info.get("description", ""),
                "model_description": model_info.get("description", ""),
            }

            result = _enrich_model_info_with_details(
                result,
                model_id,
                version_info.get("id"),
                api_key,
            )
            _hash_cache[cache_key] = result
            log.info(f"Found model by hash {file_hash}: {result.get('model_name')}")
            return result

        elif response.status_code == 404:
            log.info(f"Model not found on CivitAI for hash {file_hash}")
            _hash_cache[cache_key] = None
            return None
        else:
            log.warning(
                f"CivitAI hash lookup returned {response.status_code} for {file_hash}"
            )
            return None

    except Exception as e:
        log.error(f"Error looking up model by hash {file_hash}: {e}")
        return None

    cache_key = f"hash_{file_hash}"

    if use_cache and cache_key in _hash_cache:
        return _hash_cache[cache_key]

    api_url = f"{CIVITAI_API_URL}/model-versions/by-hash/{file_hash}"

    try:
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        response = requests.get(api_url, headers=headers, timeout=15)

        if response.status_code == 200:
            data = response.json()

            # Extract useful info from the response
            model_info = data.get("model", {})
            version_info = data

            # Get model_id from top level or nested model object
            model_id = data.get("modelId") or model_info.get("id")

            # Extract images with metadata
            images = _extract_model_images(version_info)

            result = {
                "source": "civitai",
                "model_id": model_id,
                "model_name": model_info.get("name"),
                "model_type": model_info.get("type"),
                "version_id": version_info.get("id"),
                "version_name": version_info.get("name"),
                "sha256": file_hash,
                "url": f"https://civitai.com/models/{model_id}" if model_id else None,
                "version_url": f"https://civitai.com/models/{model_id}?modelVersionId={version_info.get('id')}"
                if model_id
                else None,
                "download_url": version_info.get("downloadUrl"),
                "base_model": version_info.get("baseModel"),
                "tags": model_info.get("tags", []),
                "trained_words": _extract_trained_words(version_info),
                "images": images,
                "clip_skip": version_info.get("clipSkip"),
                "description": version_info.get("description", ""),
                "model_description": model_info.get("description", ""),
            }

            result = _enrich_model_info_with_details(
                result,
                model_id,
                version_info.get("id"),
                api_key,
            )
            _hash_cache[cache_key] = result
            log.info(f"Found model by hash {file_hash}: {result.get('model_name')}")
            return result

        elif response.status_code == 404:
            log.info(f"Model not found on CivitAI for hash {file_hash}")
            _hash_cache[cache_key] = None
            return None
        else:
            log.warning(
                f"CivitAI hash lookup returned {response.status_code} for {file_hash}"
            )
            return None

    except Exception as e:
        log.error(f"Error looking up model by hash {file_hash}: {e}")
        return None


def _extract_trained_words(version_info: Dict[str, Any]) -> List[str]:
    """
    Extract trained words/phrases from model version info.
    """
    trained_words = []

    # Try to get from metadata
    metadata = version_info.get("trainedWords", [])
    if isinstance(metadata, list):
        trained_words.extend(metadata)
    elif isinstance(metadata, str) and metadata:
        trained_words.append(metadata)

    # Also check metadata field
    model = version_info.get("model", {})
    if isinstance(model, dict):
        model_tags = model.get("tags", [])
        if isinstance(model_tags, list):
            for tag in model_tags:
                if tag not in trained_words:
                    trained_words.append(tag)

    return trained_words


def _extract_model_images(version_info: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract images with metadata from model version info.
    Each image can have: url, civitaiUrl, seed, steps, cfg, sampler, model, positive, negative
    """
    images = []

    # Get images from modelVersions or direct images field
    images_data = version_info.get("images", [])
    if not images_data:
        # Check nested modelVersions
        model_versions = version_info.get("modelVersions", [])
        if model_versions and len(model_versions) > 0:
            images_data = model_versions[0].get("images", [])

    for img in images_data:
        if not isinstance(img, dict):
            continue

        img_info = normalize_model_image(img)
        if img_info.get("url"):
            images.append(img_info)

    return images


def _get_metadata_file_path(model_path: str) -> str:
    """
    Get the path to the metadata file for a model.
    For example, for 'model.safetensors', it returns 'model.metadata.json'
    Also checks for variations without extension or with different extensions.
    """
    if not model_path:
        return ""

    # Get directory and filename
    directory = os.path.dirname(model_path)
    filename = get_filename_from_path(model_path)

    # Try different variations of the metadata file name
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

    possible_names = [
        base_name + ".metadata.json",
        filename + ".metadata.json",
        base_name + ".civitai.info",
        filename + ".civitai.info",
        base_name + ".json",
        filename.replace("_", " ").split()[0] + ".metadata.json"
        if "_" in base_name
        else None,
    ]

    for name in possible_names:
        if name:
            path = os.path.join(directory, name)
            if os.path.exists(path):
                log.info(f"Found metadata file: {path}")
                return path

    return ""


def _read_model_metadata(metadata_path: str) -> Optional[Dict[str, Any]]:
    """
    Read model metadata from a JSON file.
    Returns the metadata if found and valid, None otherwise.
    """
    data = read_json_safe(metadata_path, None)
    if not isinstance(data, dict):
        return None

    try:
        files = _as_metadata_list(data.get("files"))
        file_hashes = [
            _as_metadata_dict(file_info).get("hashes")
            for file_info in files
            if isinstance(file_info, dict)
        ]
        has_file_sha = any(
            isinstance(hashes, dict)
            and (hashes.get("SHA256") or hashes.get("sha256"))
            for hashes in file_hashes
        )
        has_civitai_shape = bool(
            data.get("civitai")
            or data.get("modelId")
            or data.get("model")
            or data.get("images")
            or data.get("downloadUrl")
        )

        # Check if it has the needed info. Older sidecars use a top-level
        # CivitAI model-version shape and are commonly named *.civitai.info.
        if (
            not data.get("sha256")
            and not data.get("hash")
            and not data.get("hashes")
            and not has_file_sha
            and not has_civitai_shape
        ):
            return None

        log.info(f"Successfully read metadata from: {metadata_path}")
        return data
    except Exception as e:
        log.debug(f"Error parsing metadata file {metadata_path}: {e}")
        return None


def _as_metadata_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_metadata_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value] if value else []


def _first_metadata_value(*values: Any) -> Any:
    return first_non_empty(*values, default=None)


def _metadata_size_to_bytes(value: Any) -> Optional[int]:
    return parse_size_to_bytes(value)


def _format_model_location(file_path: str) -> str:
    if not file_path:
        return ""

    location = os.path.dirname(file_path).replace("\\", "/")
    if location and not location.endswith("/"):
        location += "/"
    return location


def _normalize_metadata_trained_words(*values: Any) -> List[str]:
    words: List[str] = []
    seen = set()

    for value in values:
        for item in _as_metadata_list(value):
            if isinstance(item, dict):
                item = (
                    item.get("word")
                    or item.get("name")
                    or item.get("text")
                    or item.get("value")
                )
            text = str(item or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            words.append(text)

    return words


def _metadata_to_model_info(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert metadata file format to model info format used by our extension.
    """
    embedded_civitai_data = _as_metadata_dict(metadata.get("civitai"))
    looks_like_civitai_version = bool(
        metadata.get("modelId")
        or metadata.get("files")
        or metadata.get("images")
        or metadata.get("downloadUrl")
    )
    civitai_data = embedded_civitai_data or (
        metadata if looks_like_civitai_version else {}
    )
    selected_version = _as_metadata_dict(metadata.get("selected_version"))
    if not selected_version and looks_like_civitai_version:
        selected_version = civitai_data
    path_metadata = _as_metadata_dict(metadata.get("path_metadata"))

    # Extract images with metadata
    images = []
    for img in (
        civitai_data.get("images")
        or selected_version.get("images")
        or metadata.get("images")
        or []
    ):
        if isinstance(img, dict) and img.get("url"):
            img_info = normalize_model_image(img)
            if img_info.get("url"):
                images.append(img_info)

    # Get trained words from common sidecar shapes, including LoRA Manager metadata.
    trained_words = _normalize_metadata_trained_words(
        metadata.get("trained_words"),
        metadata.get("trainedWords"),
        civitai_data.get("trainedWords"),
        selected_version.get("trained_words"),
        selected_version.get("trainedWords"),
        path_metadata.get("trained_words"),
        path_metadata.get("trainedWords"),
    )

    # Get model info
    model_info = _as_metadata_dict(civitai_data.get("model"))
    file_infos = _as_metadata_list(civitai_data.get("files"))
    file_info = _as_metadata_dict(file_infos[0]) if file_infos else {}
    metadata_hashes = _as_metadata_dict(metadata.get("hashes"))
    file_hashes = _as_metadata_dict(file_info.get("hashes"))

    # Build model_id from CivitAI data
    model_id = (
        civitai_data.get("modelId")
        or metadata.get("model_id")
        or metadata.get("modelId")
    )
    version_id = (
        civitai_data.get("id")
        or metadata.get("version_id")
        or metadata.get("versionId")
    )
    details_source = (
        metadata.get("details_source")
        or metadata.get("source")
        or metadata.get("metadata_source")
        or "metadata"
    )
    stored_page_url = _first_metadata_value(
        metadata.get("version_url"),
        metadata.get("model_url"),
        metadata.get("page_url"),
        metadata.get("source_url"),
        metadata.get("url"),
        metadata.get("platform_url"),
        path_metadata.get("version_url"),
        path_metadata.get("model_url"),
        path_metadata.get("source_url"),
        path_metadata.get("url"),
        path_metadata.get("platform_url"),
    )
    civitai_model_url = f"https://civitai.com/models/{model_id}" if model_id else None
    civitai_version_url = (
        f"https://civitai.com/models/{model_id}?modelVersionId={version_id}"
        if model_id and version_id
        else civitai_model_url
    )
    page_url = stored_page_url or civitai_version_url

    return {
        "source": details_source,
        "details_source": details_source,
        "model_id": model_id,
        "model_name": _first_metadata_value(
            metadata.get("model_name"),
            metadata.get("modelName"),
            model_info.get("name"),
            metadata.get("name") if not model_id else None,
            metadata.get("file_name"),
        )
        or "",
        "model_type": model_info.get("type", "") or civitai_data.get("type", ""),
        "version_id": version_id,
        "version_name": _first_metadata_value(
            metadata.get("version_name"),
            metadata.get("versionName"),
            selected_version.get("name"),
            civitai_data.get("name"),
        )
        or "",
        "sha256": _first_metadata_value(
            metadata.get("sha256"),
            metadata.get("hash"),
            metadata_hashes.get("SHA256"),
            metadata_hashes.get("sha256"),
            file_hashes.get("SHA256"),
            file_hashes.get("sha256"),
        )
        or "",
        "size": _metadata_size_to_bytes(
            _first_metadata_value(
                metadata.get("size"),
                metadata.get("file_size"),
                metadata.get("fileSize"),
                metadata.get("sizeBytes"),
                path_metadata.get("size"),
                path_metadata.get("file_size"),
                path_metadata.get("fileSize"),
                path_metadata.get("sizeBytes"),
                (file_info.get("sizeKB") * 1024)
                if file_info.get("sizeKB") is not None
                else None,
            )
        ),
        "url": page_url,
        "version_url": page_url,
        "model_url": stored_page_url or civitai_model_url,
        "source_url": stored_page_url,
        "platform_url": metadata.get("platform_url") or path_metadata.get("platform_url"),
        "download_url": _first_metadata_value(
            metadata.get("download_url"),
            civitai_data.get("downloadUrl"),
            file_info.get("downloadUrl"),
        ),
        "base_model": _first_metadata_value(
            metadata.get("base_model"),
            metadata.get("baseModel"),
            selected_version.get("base_model"),
            selected_version.get("baseModel"),
            civitai_data.get("baseModel"),
        )
        or "",
        "tags": _as_metadata_list(metadata.get("tags") or model_info.get("tags")),
        "trained_words": trained_words,
        "images": images,
        "clip_skip": civitai_data.get("clipSkip"),
        "description": _first_metadata_value(
            metadata.get("modelDescription"),
            metadata.get("model_description"),
            metadata.get("description"),
            model_info.get("description"),
            civitai_data.get("description"),
        )
        or "",
        "model_description": _first_metadata_value(
            metadata.get("modelDescription"),
            metadata.get("model_description"),
            model_info.get("description"),
        )
        or "",
        "from_metadata": True,
    }


def get_model_info_for_file(
    file_path: str, api_key: Optional[str] = None, local_only: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Get model info from CivitAI by computing file hash and looking up by hash.
    First checks if there's a metadata file in the same folder.

    Args:
        file_path: Full path to the model file
        api_key: Optional CivitAI API key
        local_only: If true, never calculate a hash or query CivitAI when
            metadata is missing. Return only local file information.

    Returns:
        Dict with model info from CivitAI, or None if not found
    """
    log.info(f"get_model_info_for_file called with: {file_path}")

    # First check for metadata file
    metadata_path = _get_metadata_file_path(file_path)
    log.info(f"Looking for metadata file, checked: {metadata_path}")

    if metadata_path:
        metadata = _read_model_metadata(metadata_path)
        if metadata:
            log.info(f"Using metadata file for {file_path}")
            result = _metadata_to_model_info(metadata)
            result["file_path"] = file_path
            result["metadata_path"] = metadata_path
            result["location"] = _format_model_location(file_path)
            if not result.get("size"):
                try:
                    result["size"] = os.path.getsize(file_path)
                except Exception:
                    pass
            return result
    else:
        # Debug: list all files in the same directory
        directory = os.path.dirname(file_path)
        if directory and os.path.exists(directory):
            files = os.listdir(directory)
            metadata_files = [
                f for f in files if "metadata" in f.lower() or f.endswith(".json")
            ]
            log.info(f"Files in {directory}: {metadata_files}")

    if local_only:
        filename = get_filename_from_path(file_path)
        stem = os.path.splitext(filename)[0]
        result = {
            "source": "local",
            "filename": filename,
            "file_path": file_path,
            "resolved_path": file_path,
            "model_name": stem,
            "model_type": "",
            "location": _format_model_location(file_path),
            "from_metadata": False,
            "local_only": True,
        }
        try:
            result["size"] = os.path.getsize(file_path)
        except Exception:
            pass
        return result

    # If no metadata file, compute hash and look up on CivitAI
    file_hash = calculate_file_sha256(file_path)
    if not file_hash:
        return None

    result = get_model_info_by_hash(file_hash, api_key)
    if result:
        result["file_path"] = file_path
        result["location"] = _format_model_location(file_path)
        if not result.get("size"):
            try:
                result["size"] = os.path.getsize(file_path)
            except Exception:
                pass

    return result

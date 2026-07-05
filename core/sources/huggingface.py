"""
HuggingFace Source Module

Search and download models from HuggingFace Hub.
"""

import json
import os
import re
import threading
import time
import requests
from typing import Dict, Any, Optional, List, Callable
from urllib.parse import urlparse, quote

from ..progress import report_progress, get_progress_reporter
from ..log_system import create_module_logger
log = create_module_logger(__name__)

from ..path_utils import write_json_atomic, METADATA_DIR, read_json_safe
from ..type_utils import check_credential_http, parse_size_header as _parse_size_header, fetch_remote_file_size, fetch_remote_file_size_cached, clear_remote_size_cache, extract_file_size
from ..matcher import build_filename_search_queries, clean_filename_for_search

HF_API_URL = "https://huggingface.co/api"
HF_AUTHOR_FALLBACKS = ["Comfy-Org"]
BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search"
HF_AUTHOR_INDEX_CACHE_TTL_SECONDS = 24 * 60 * 60
HF_AUTHOR_INDEX_CACHE_VERSION = 1

HF_AUTHOR_INDEX_CACHE_PATH = os.path.join(
    METADATA_DIR, "huggingface-author-index.json"
)

# Cache for search results
_search_cache: Dict[str, Any] = {}
_author_index_cache: Dict[str, Dict[str, Any]] = {}
_author_index_lock = threading.RLock()


def clear_search_cache():
    """Clear cached HuggingFace search results and in-memory indexes."""
    global _search_cache, _author_index_cache
    _search_cache.clear()
    clear_remote_size_cache()
    with _author_index_lock:
        _author_index_cache.clear()


_report_progress = get_progress_reporter("HuggingFace progress callback")


def check_huggingface_token(token: Optional[str]) -> Dict[str, Any]:
    """Check whether a HuggingFace access token is accepted."""
    from ..type_utils import check_credential_preconditions
    precheck = check_credential_preconditions(token, "HuggingFace token")
    if precheck:
        return precheck

    value = (token or "").strip()
    headers = {"Authorization": f"Bearer {value}"}

    def get_user(data):
        return data.get("name") or data.get("user", {}).get("name") or ""

    result = check_credential_http(
        f"{HF_API_URL}/whoami-v2",
        headers=headers,
        success_message="HuggingFace token is valid.",
        get_username=get_user,
        error_msg_401_403="HuggingFace token is not accepted.",
    )
    if result.get("status_code") == 404:
        result = check_credential_http(
            f"{HF_API_URL}/whoami",
            headers=headers,
            success_message="HuggingFace token is valid.",
            get_username=get_user,
            error_msg_401_403="HuggingFace token is not accepted.",
        )
    return result


def check_brave_search_api_key(api_key: Optional[str]) -> Dict[str, Any]:
    """Check whether a Brave Search API key is accepted."""
    from ..type_utils import check_credential_preconditions
    precheck = check_credential_preconditions(api_key, "Brave Search API key")
    if precheck:
        return precheck

    key = (api_key or "").strip()
    headers = {"X-Subscription-Token": key}
    params = {"q": "test", "count": 1}

    def custom_429(response):
        return {
            "success": False,
            "valid": False,
            "status": "limited",
            "message": "Brave Search rate limit was reached.",
            "status_code": 429,
        }

    return check_credential_http(
        BRAVE_SEARCH_API_URL,
        headers=headers,
        params=params,
        success_message="Brave Search API key is valid.",
        error_msg_401_403="Brave Search API key is not accepted.",
        custom_429_handler=custom_429,
    )


def _author_index_cache_key(author: str, headers: Dict[str, str]) -> str:
    auth_key = "token" if headers.get("Authorization") else "public"
    return f"{author}::{auth_key}"


def _is_author_index_fresh(index: Optional[Dict[str, Any]]) -> bool:
    if not index:
        return False

    updated_at = index.get("updated_at")
    if not isinstance(updated_at, (int, float)):
        return False

    return (time.time() - updated_at) < HF_AUTHOR_INDEX_CACHE_TTL_SECONDS


def _read_persistent_author_indexes() -> Dict[str, Any]:
    default_val = {"version": HF_AUTHOR_INDEX_CACHE_VERSION, "authors": {}}
    data = read_json_safe(HF_AUTHOR_INDEX_CACHE_PATH, default_val)
    if not isinstance(data, dict) or data.get("version") != HF_AUTHOR_INDEX_CACHE_VERSION:
        return {"version": HF_AUTHOR_INDEX_CACHE_VERSION, "authors": {}}
    if not isinstance(data.get("authors"), dict):
        data["authors"] = {}
    return data


def _write_persistent_author_index(author: str, index: Dict[str, Any]) -> None:
    try:
        data = _read_persistent_author_indexes()
        data["authors"][author] = index
        write_json_atomic(
            HF_AUTHOR_INDEX_CACHE_PATH,
            data,
            separators=(",", ":"),
        )
    except Exception as e:
        log.debug(f"Error writing HuggingFace author index cache: {e}")


def _build_author_index_from_models(
    author: str, repos: List[Dict[str, Any]]
) -> Dict[str, Any]:
    files = []
    repo_ids = []

    for repo in repos:
        repo_id = repo.get("id", "")
        if not repo_id:
            continue

        repo_ids.append(repo_id)
        for sibling in repo.get("siblings") or []:
            file_path = sibling.get("rfilename") or sibling.get("path") or ""
            if not file_path:
                continue

            files.append(
                {
                    "repo_id": repo_id,
                    "path": file_path,
                    "filename": os.path.basename(file_path),
                    "size": sibling.get("size"),
                }
            )

    return {
        "author": author,
        "updated_at": time.time(),
        "repo_count": len(repo_ids),
        "file_count": len(files),
        "repos": repo_ids,
        "files": files,
    }


def _fetch_author_index(author: str, headers: Dict[str, str], limit: int = 200):
    try:
        response = requests.get(
            f"{HF_API_URL}/models",
            params={"author": author, "limit": limit, "full": "true"},
            headers=headers,
            timeout=15,
        )
        if response.status_code != 200:
            log.debug(
                f"HuggingFace author index returned {response.status_code} for author={author}"
            )
            return None

        repos = response.json()
        if not isinstance(repos, list):
            return None

        index = _build_author_index_from_models(author, repos)
        log.info(
            f"HuggingFace author index refreshed for author={author}: repos={index['repo_count']}, files={index['file_count']}"
        )
        return index
    except Exception as e:
        log.debug(f"Error refreshing HuggingFace author index for author={author}: {e}")
        return None


def _get_author_index(
    author: str, headers: Dict[str, str], force_refresh: bool = False
) -> Optional[Dict[str, Any]]:
    cache_key = _author_index_cache_key(author, headers)
    can_persist = not headers.get("Authorization")

    with _author_index_lock:
        memory_index = _author_index_cache.get(cache_key)
        if not force_refresh and _is_author_index_fresh(memory_index):
            return memory_index

        persistent_index = None
        if can_persist:
            persistent_index = _read_persistent_author_indexes().get("authors", {}).get(
                author
            )
            if not force_refresh and _is_author_index_fresh(persistent_index):
                _author_index_cache[cache_key] = persistent_index
                log.debug(f"HuggingFace author index cache hit for author={author}")
                return persistent_index

        fresh_index = _fetch_author_index(author, headers=headers)
        if fresh_index:
            _author_index_cache[cache_key] = fresh_index
            if can_persist:
                _write_persistent_author_index(author, fresh_index)
            return fresh_index

        if persistent_index:
            log.warning(
                f"Using stale HuggingFace author index for author={author}; refresh failed"
            )
            _author_index_cache[cache_key] = persistent_index
            return persistent_index

        return None


def get_author_fallback_index_status(author: str = "Comfy-Org") -> Dict[str, Any]:
    """Return persisted public author fallback index status for the options UI."""
    with _author_index_lock:
        index = _read_persistent_author_indexes().get("authors", {}).get(author)

    updated_at = index.get("updated_at") if isinstance(index, dict) else None
    age_seconds = (time.time() - updated_at) if isinstance(updated_at, (int, float)) else None
    return {
        "author": author,
        "exists": bool(index),
        "updated_at": updated_at,
        "age_seconds": age_seconds,
        "ttl_seconds": HF_AUTHOR_INDEX_CACHE_TTL_SECONDS,
        "stale": bool(index) and not _is_author_index_fresh(index),
        "repo_count": index.get("repo_count", 0) if isinstance(index, dict) else 0,
        "file_count": index.get("file_count", 0) if isinstance(index, dict) else 0,
    }


def refresh_author_fallback_index(
    token: Optional[str] = None, author: str = "Comfy-Org"
) -> Dict[str, Any]:
    """Force refresh the public HuggingFace author fallback index."""
    headers = {}

    index = _get_author_index(author, headers=headers, force_refresh=True)
    status = get_author_fallback_index_status(author)
    status["success"] = bool(index)
    status["persisted"] = bool(index)
    return status


def parse_huggingface_url(url: str) -> Optional[Dict[str, str]]:
    """
    Parse a HuggingFace URL to extract repo and filename.

    Handles formats:
    - https://huggingface.co/user/repo/resolve/main/file.safetensors
    - https://huggingface.co/user/repo/blob/main/file.safetensors
    - hf://user/repo/file.safetensors

    Returns:
        Dictionary with 'repo' and 'filename' keys, or None if not HF URL
    """
    if url.startswith("hf://"):
        parts = url[5:].split("/", 2)
        if len(parts) >= 3:
            return {"repo": f"{parts[0]}/{parts[1]}", "filename": parts[2]}
        return None

    parsed = urlparse(url)
    if "huggingface.co" not in parsed.netloc:
        return None

    match = re.match(r"^/([^/]+/[^/]+)/(resolve|blob)/([^/]+)/(.+)$", parsed.path)
    if match:
        return {
            "repo": match.group(1),
            "branch": match.group(3),
            "filename": match.group(4),
        }

    return None


def get_huggingface_download_url(repo: str, filename: str, branch: str = "main") -> str:
    """Generate a direct download URL for a HuggingFace file."""
    return f"https://huggingface.co/{repo}/resolve/{branch}/{quote(filename)}"




# _extract_file_info_size removed in favor of extract_file_size from type_utils



def _normalize_huggingface_size_probe_url(url: str) -> Optional[str]:
    if not isinstance(url, str) or not url.strip():
        return None
    value = url.strip()
    parsed = urlparse(value)
    if "huggingface.co" not in parsed.netloc:
        return None
    if "/blob/" in parsed.path:
        value = value.replace("/blob/", "/resolve/", 1)
    return value




def _fetch_remote_file_size_bytes(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 15,
) -> Optional[int]:
    probe_url = _normalize_huggingface_size_probe_url(url)
    if not probe_url:
        return None
    return fetch_remote_file_size_cached(probe_url, headers=headers, timeout=timeout)


def _build_huggingface_result(
    repo_id: str,
    file_path: str,
    file_info: Dict[str, Any],
    match_type: str,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    lfs_info = file_info.get("lfs") if isinstance(file_info.get("lfs"), dict) else {}
    sha256 = (
        file_info.get("sha256")
        or file_info.get("hash")
        or lfs_info.get("sha256")
        or lfs_info.get("oid")
    )
    download_url = get_huggingface_download_url(repo_id, file_path)
    size = extract_file_size(file_info)
    if not size:
        size = _fetch_remote_file_size_bytes(download_url, headers=headers)
    return {
        "source": "huggingface",
        "repo_id": repo_id,
        "filename": os.path.basename(file_path),
        "path": file_path,
        "url": download_url,
        "size": size,
        "match_type": match_type,
        "sha256": sha256,
    }


def _get_repo_tree(
    repo_id: str, headers: Dict[str, str], branch: str = "main"
) -> Optional[List[Dict[str, Any]]]:
    files_url = f"{HF_API_URL}/models/{repo_id}/tree/{quote(branch, safe='')}"

    try:
        response = requests.get(
            files_url,
            params={"recursive": "1"},
            headers=headers,
            timeout=15,
        )
        if response.status_code != 200:
            log.debug(
                f"HuggingFace tree request returned {response.status_code} for repo={repo_id}, branch={branch}"
            )
            return None
        return response.json()
    except Exception as e:
        log.debug(f"Error getting HuggingFace tree for {repo_id}@{branch}: {e}")
        return None


def _find_matching_file_in_repo(
    repo_id: str,
    files: List[Dict[str, Any]],
    filename: str,
    exact_only: bool = False,
    headers: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, Any]]:
    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    partial_match = None

    for file_info in files:
        file_path = file_info.get("path", "")
        if not file_path:
            continue

        file_name = os.path.basename(file_path)
        file_name_lower = file_name.lower()
        file_base = os.path.splitext(file_name_lower)[0]

        if file_name_lower == filename_lower or file_path.lower().endswith(filename_lower):
            return _build_huggingface_result(
                repo_id,
                file_path,
                file_info,
                "exact",
                headers=headers,
            )

    if exact_only:
        return None

    for file_info in files:
        file_path = file_info.get("path", "")
        if not file_path:
            continue

        file_name = os.path.basename(file_path)
        file_name_lower = file_name.lower()
        file_base = os.path.splitext(file_name_lower)[0]

        if not exact_only:
            if filename_base in file_base or file_base in filename_base:
                if file_path.endswith(".safetensors") or file_path.endswith(".ckpt"):
                    partial_match = _build_huggingface_result(
                        repo_id,
                        file_path,
                        file_info,
                        "partial",
                        headers=headers,
                    )
                    break

    return partial_match


def _find_matching_file_in_author_index(
    index: Dict[str, Any],
    filename: str,
    exact_only: bool = False,
    headers: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, Any]]:
    files = index.get("files") or []
    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    partial_match = None

    for file_info in files:
        repo_id = file_info.get("repo_id", "")
        file_path = file_info.get("path", "")
        if not repo_id or not file_path:
            continue

        file_name = os.path.basename(file_path)
        file_name_lower = file_name.lower()
        if file_name_lower == filename_lower or file_path.lower().endswith(
            filename_lower
        ):
            return _build_huggingface_result(
                repo_id,
                file_path,
                file_info,
                "exact",
                headers=headers,
            )

    if exact_only:
        return None

    for file_info in files:
        repo_id = file_info.get("repo_id", "")
        file_path = file_info.get("path", "")
        if not repo_id or not file_path:
            continue

        file_name = os.path.basename(file_path)
        file_name_lower = file_name.lower()
        file_base = os.path.splitext(file_name_lower)[0]
        file_path_lower = file_path.lower()

        if filename_base in file_base or file_base in filename_base:
            if file_path_lower.endswith(".safetensors") or file_path_lower.endswith(
                ".ckpt"
            ):
                partial_match = _build_huggingface_result(
                    repo_id,
                    file_path,
                    file_info,
                    "partial",
                    headers=headers,
                )
                break

    return partial_match




def _get_repos_by_author(
    author: str, headers: Dict[str, str], limit: int = 200
) -> List[str]:
    try:
        response = requests.get(
            f"{HF_API_URL}/models",
            params={"author": author, "limit": limit},
            headers=headers,
            timeout=15,
        )
        if response.status_code != 200:
            log.debug(
                f"HuggingFace author search returned {response.status_code} for author={author}"
            )
            return []

        repos = response.json()
        return [repo.get("id", "") for repo in repos if repo.get("id")]
    except Exception as e:
        log.debug(f"Error getting HuggingFace repos for author={author}: {e}")
        return []


def _search_brave_for_huggingface_candidates(
    filename: str, brave_api_key: str
) -> List[Dict[str, str]]:
    if not brave_api_key:
        return []

    query = f'"{filename}" site:huggingface.co'
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": brave_api_key,
    }
    params = {
        "q": query,
        "count": 20,
        "safesearch": "off",
        "spellcheck": "false",
    }
    candidates = []
    seen = set()

    try:
        response = requests.get(
            BRAVE_SEARCH_API_URL, headers=headers, params=params, timeout=15
        )
        if response.status_code != 200:
            log.warning(
                f"Brave search returned {response.status_code} for query={query}"
            )
            return []

        payload = response.json()
        results = ((payload or {}).get("web") or {}).get("results") or []
        for result in results:
            candidate_url = result.get("url", "")
            if not candidate_url:
                continue

            parsed = parse_huggingface_url(candidate_url)
            if parsed:
                repo_id = parsed.get("repo", "")
                file_path = parsed.get("filename", "")
                branch = parsed.get("branch", "main")
            else:
                parsed_url = urlparse(candidate_url)
                if "huggingface.co" not in parsed_url.netloc:
                    continue
                path_parts = [part for part in parsed_url.path.split("/") if part]
                if len(path_parts) < 2:
                    continue
                repo_id = f"{path_parts[0]}/{path_parts[1]}"
                file_path = filename
                branch = "main"

            key = (repo_id, branch, file_path)
            if not repo_id or key in seen:
                continue

            seen.add(key)
            candidates.append(
                {
                    "repo": repo_id,
                    "branch": branch,
                    "filename": file_path,
                    "url": candidate_url,
                }
            )
    except Exception as e:
        log.debug(f"Brave search error for filename={filename}: {e}")

    return candidates


def search_huggingface_for_file(
    filename: str,
    token: Optional[str] = None,
    exact_only: bool = False,
    brave_api_key: Optional[str] = None,
    use_api_search: bool = True,
    use_comfy_org_fallback: bool = True,
    use_brave_fallback: bool = True,
    force_refresh: bool = False,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search HuggingFace for a specific model file.
    Returns the first repo that contains a matching file.

    Args:
        filename: Filename to search for
        token: Optional HF token
        exact_only: If True, only return exact filename matches (for downloads).
                   If False, also try partial matching (for local file resolution).

    Returns:
        Dict with url, repo, filename if found, None otherwise
    """
    global _search_cache

    brave_key = "brave" if brave_api_key and use_brave_fallback else "nobrave"
    token_key = "token" if token else "notoken"
    methods_key = (
        f"api{int(bool(use_api_search))}_"
        f"comfy{int(bool(use_comfy_org_fallback))}_"
        f"brave{int(bool(use_brave_fallback))}_"
        f"force{int(bool(force_refresh))}"
    )
    cache_key = f"hf_{filename}_exact{exact_only}_{token_key}_{brave_key}_{methods_key}"
    if cache_key in _search_cache:
        log.debug(f"HuggingFace cache hit file={filename} exact={exact_only}")
        _report_progress(
            progress_callback,
            "cache",
            "Using HuggingFace cache",
            86,
        )
        return _search_cache[cache_key]

    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        log.info(f"HuggingFace start file={filename} exact={exact_only}")

        repos_to_check = []
        seen_repos = set()
        search_queries = build_filename_search_queries(filename)

        if use_api_search:
            total_queries = max(1, len(search_queries))
            for query_index, search_query in enumerate(search_queries, start=1):
                _report_progress(
                    progress_callback,
                    "api_search",
                    f"HuggingFace API query {query_index}/{total_queries}",
                    32 + ((query_index - 1) / total_queries) * 10,
                    query=search_query,
                    query_index=query_index,
                    query_count=total_queries,
                )
                search_url = f"{HF_API_URL}/models?search={quote(search_query)}&limit=20"
                response = requests.get(search_url, headers=headers, timeout=10)
                if response.status_code != 200:
                    log.warning(
                        f"HuggingFace API status={response.status_code} query={search_query}"
                    )
                    continue

                repos = response.json()
                log.info(f"HuggingFace API query={search_query} repos={len(repos)}")

                for repo in repos:
                    repo_id = repo.get("id", "")
                    if repo_id and repo_id not in seen_repos:
                        seen_repos.add(repo_id)
                        repos_to_check.append(repo_id)

                _report_progress(
                    progress_callback,
                    "api_candidates",
                    f"HuggingFace API candidates: {len(repos_to_check)} repos",
                    44,
                    candidate_count=len(repos_to_check),
                )
        else:
            _report_progress(
                progress_callback,
                "api_skip",
                "Skipping HuggingFace API search",
                44,
            )

        repo_count = len(repos_to_check)
        for repo_index, repo_id in enumerate(repos_to_check, start=1):
            _report_progress(
                progress_callback,
                "repo_files",
                f"Checking HF repo {repo_index}/{repo_count}",
                48 + (repo_index / max(1, repo_count)) * 14,
                repo=repo_id,
                candidate_index=repo_index,
                candidate_count=repo_count,
            )
            log.debug(f"HuggingFace check repo={repo_id} file={filename}")
            files = _get_repo_tree(repo_id, headers=headers)
            if not files:
                continue

            log.debug(f"HuggingFace tree repo={repo_id} files={len(files)}")
            result = _find_matching_file_in_repo(
                repo_id,
                files,
                filename,
                exact_only=exact_only,
                headers=headers,
            )
            if result:
                _search_cache[cache_key] = result
                _report_progress(
                    progress_callback,
                    "found",
                    "Found HuggingFace match",
                    92,
                    repo=repo_id,
                    match_type=result.get("match_type"),
                )
                log.info(
                    f"HuggingFace found match={result['match_type']} file={filename} repo={repo_id} path={result['path']}"
                )
                return result

        author_fallback_repos = []
        author_fallback_repo_count = 0
        if use_comfy_org_fallback:
            total_authors = max(1, len(HF_AUTHOR_FALLBACKS))
            for author_index, author in enumerate(HF_AUTHOR_FALLBACKS, start=1):
                _report_progress(
                    progress_callback,
                    "author_index",
                    f"Checking HF fallback index {author_index}/{total_authors}",
                    64 + ((author_index - 1) / total_authors) * 6,
                    author=author,
                    author_index=author_index,
                    author_count=total_authors,
                )
                index = _get_author_index(
                    author,
                    headers={},
                    force_refresh=force_refresh,
                )
                if index:
                    result = _find_matching_file_in_author_index(
                        index,
                        filename,
                        exact_only=exact_only,
                        headers={},
                    )
                    author_fallback_repo_count += int(index.get("repo_count") or 0)
                    if result:
                        _search_cache[cache_key] = result
                        _report_progress(
                            progress_callback,
                            "found",
                            "Found HuggingFace fallback match",
                            92,
                            repo=result.get("repo_id"),
                            match_type=result.get("match_type"),
                        )
                        log.info(
                            f"HuggingFace found source=author_index match={result['match_type']} file={filename} repo={result['repo_id']} path={result['path']}"
                        )
                        return result

                    log.debug(
                        f"HuggingFace author_index miss author={author} file={filename} repos={index.get('repo_count', 0)} files={index.get('file_count', 0)}"
                    )
                    continue

                repos = _get_repos_by_author(author, headers=headers)
                log.info(f"HuggingFace author_fallback author={author} repos={len(repos)}")
                for repo_id in repos:
                    if repo_id not in seen_repos:
                        seen_repos.add(repo_id)
                        author_fallback_repos.append(repo_id)
                        author_fallback_repo_count += 1
        else:
            _report_progress(
                progress_callback,
                "author_skip",
                "Skipping HuggingFace fallback index",
                70,
            )

        fallback_repo_count = len(author_fallback_repos)
        for repo_index, repo_id in enumerate(author_fallback_repos, start=1):
            _report_progress(
                progress_callback,
                "author_repo",
                f"Checking HF fallback repo {repo_index}/{fallback_repo_count}",
                70 + (repo_index / max(1, fallback_repo_count)) * 8,
                repo=repo_id,
                candidate_index=repo_index,
                candidate_count=fallback_repo_count,
            )
            log.debug(
                f"HuggingFace author_fallback check repo={repo_id} file={filename}"
            )
            files = _get_repo_tree(repo_id, headers=headers)
            if not files:
                continue

            result = _find_matching_file_in_repo(
                repo_id,
                files,
                filename,
                exact_only=exact_only,
                headers=headers,
            )
            if result:
                _search_cache[cache_key] = result
                _report_progress(
                    progress_callback,
                    "found",
                    "Found HuggingFace fallback match",
                    92,
                    repo=repo_id,
                    match_type=result.get("match_type"),
                )
                log.info(
                    f"HuggingFace found source=author_fallback match={result['match_type']} file={filename} repo={repo_id} path={result['path']}"
                )
                return result

        if use_brave_fallback:
            _report_progress(
                progress_callback,
                "brave_search",
                "Searching Brave fallback",
                80,
            )
        brave_candidates = (
            _search_brave_for_huggingface_candidates(filename, brave_api_key or "")
            if use_brave_fallback
            else []
        )
        log.info(f"HuggingFace brave_fallback file={filename} candidates={len(brave_candidates)}")
        _report_progress(
            progress_callback,
            "brave_candidates",
            f"Brave candidates: {len(brave_candidates)}",
            84,
            candidate_count=len(brave_candidates),
        )

        brave_count = len(brave_candidates)
        for candidate_index, candidate in enumerate(brave_candidates, start=1):
            repo_id = candidate.get("repo", "")
            branch = candidate.get("branch", "main")
            expected_file = candidate.get("filename", filename)
            _report_progress(
                progress_callback,
                "brave_repo",
                f"Checking Brave candidate {candidate_index}/{brave_count}",
                84 + (candidate_index / max(1, brave_count)) * 6,
                repo=repo_id,
                candidate_index=candidate_index,
                candidate_count=brave_count,
            )
            files = _get_repo_tree(repo_id, headers=headers, branch=branch)
            if not files:
                continue

            result = _find_matching_file_in_repo(
                repo_id,
                files,
                expected_file,
                exact_only=True,
                headers=headers,
            )
            if result and result.get("filename", "").lower() == filename.lower():
                _search_cache[cache_key] = result
                _report_progress(
                    progress_callback,
                    "found",
                    "Found HuggingFace Brave match",
                    92,
                    repo=repo_id,
                    match_type=result.get("match_type"),
                )
                log.info(
                    f"HuggingFace found source=brave_fallback match=exact file={filename} repo={repo_id} path={result['path']}"
                )
                return result

        # Not found
        _search_cache[cache_key] = None
        _report_progress(
            progress_callback,
            "done",
            "HuggingFace checked",
            92,
            candidate_count=len(repos_to_check),
            author_repo_count=author_fallback_repo_count,
            brave_candidate_count=len(brave_candidates),
        )
        log.info(
            f"HuggingFace miss file={filename} repos={len(repos_to_check)} author_repos={author_fallback_repo_count} brave={len(brave_candidates)}"
        )
        return None

    except Exception as e:
        log.exception(f"HuggingFace search error for {filename}: {e}")
        _report_progress(
            progress_callback,
            "error",
            f"HuggingFace search error: {e}",
            100,
            status="error",
        )
        return None


def search_huggingface(
    query: str,
    model_type: Optional[str] = None,
    limit: int = 10,
    token: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search HuggingFace Hub for models (general search).
    Returns repos that might be relevant, not guaranteed to have exact file.
    """
    results = []

    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        params = {"search": query, "limit": limit, "full": "true"}

        response = requests.get(
            f"{HF_API_URL}/models", params=params, headers=headers, timeout=15
        )

        if response.status_code == 200:
            models = response.json()

            for model in models:
                repo_id = model.get("id", "")

                results.append(
                    {
                        "source": "huggingface",
                        "repo": repo_id,
                        "name": model.get("modelId", repo_id),
                        "downloads": model.get("downloads", 0),
                        "likes": model.get("likes", 0),
                        "url": f"https://huggingface.co/{repo_id}",
                    }
                )

    except Exception as e:
        log.error(f"HuggingFace search error: {e}")

    return results


def get_repo_files(repo: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get list of model files in a HuggingFace repo."""
    files = []

    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        items = _get_repo_tree(repo, headers=headers)
        if items:
            for item in items:
                path = item.get("path", "")
                if path.endswith(
                    (".safetensors", ".ckpt", ".pt", ".bin", ".pth", ".onnx", ".gguf")
                ):
                    url = get_huggingface_download_url(repo, path)
                    size = extract_file_size(item)
                    if not size:
                        size = _fetch_remote_file_size_bytes(url, headers=headers)
                    files.append(
                        {
                            "filename": os.path.basename(path),
                            "path": path,
                            "url": url,
                            "size": size,
                        }
                    )

    except Exception as e:
        log.error(f"Error getting repo files: {e}")

    return files

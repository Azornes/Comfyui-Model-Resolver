"""
HuggingFace Source Module

Search and download models from HuggingFace Hub.
"""

import os
import re
import requests
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, quote

from ..log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)

HF_API_URL = "https://huggingface.co/api"
HF_AUTHOR_FALLBACKS = ["Comfy-Org"]
BRAVE_SEARCH_API_URL = "https://api.search.brave.com/res/v1/web/search"

# Cache for search results
_search_cache: Dict[str, Any] = {}


def clear_search_cache():
    """Clear cached HuggingFace search results."""
    global _search_cache
    _search_cache.clear()


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


def clean_filename_for_search(filename: str) -> str:
    """
    Clean up filename for better search results.
    Remove common suffixes that might prevent matches.
    """
    base = os.path.splitext(filename)[0]
    # Remove common precision/format suffixes
    base = re.sub(
        r"[-_]?(fp16|fp32|fp8|fp4|bf16|e4m3fn|scaled|pruned|emaonly|mixed|q4|q8).*$",
        "",
        base,
        flags=re.IGNORECASE,
    )
    return base


def _build_huggingface_result(
    repo_id: str, file_path: str, file_info: Dict[str, Any], match_type: str
) -> Dict[str, Any]:
    return {
        "source": "huggingface",
        "repo_id": repo_id,
        "filename": os.path.basename(file_path),
        "path": file_path,
        "url": get_huggingface_download_url(repo_id, file_path),
        "size": file_info.get("size"),
        "match_type": match_type,
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
            log_debug(
                f"HuggingFace tree request returned {response.status_code} for repo={repo_id}, branch={branch}"
            )
            return None
        return response.json()
    except Exception as e:
        log_debug(f"Error getting HuggingFace tree for {repo_id}@{branch}: {e}")
        return None


def _find_matching_file_in_repo(
    repo_id: str,
    files: List[Dict[str, Any]],
    filename: str,
    exact_only: bool = False,
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
            return _build_huggingface_result(repo_id, file_path, file_info, "exact")

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
                        repo_id, file_path, file_info, "partial"
                    )
                    break

    return partial_match


def _build_huggingface_search_queries(filename: str) -> List[str]:
    filename_base = os.path.splitext(os.path.basename(filename))[0].lower()
    cleaned_base = clean_filename_for_search(filename).lower()
    simplified_base = re.sub(
        r"[-_]?(fp16|fp32|fp8|fp4|bf16|e4m3fn|mixed|scaled|pruned|emaonly|q4|q8)$",
        "",
        filename_base,
        flags=re.IGNORECASE,
    )

    queries = []
    for query in [filename_base, cleaned_base, simplified_base]:
        query = (query or "").strip(" -_")
        if query and query not in queries:
            queries.append(query)

    return queries


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
            log_debug(
                f"HuggingFace author search returned {response.status_code} for author={author}"
            )
            return []

        repos = response.json()
        return [repo.get("id", "") for repo in repos if repo.get("id")]
    except Exception as e:
        log_debug(f"Error getting HuggingFace repos for author={author}: {e}")
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
            log_warn(
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
        log_debug(f"Brave search error for filename={filename}: {e}")

    return candidates


def search_huggingface_for_file(
    filename: str,
    token: Optional[str] = None,
    exact_only: bool = False,
    brave_api_key: Optional[str] = None,
    use_api_search: bool = True,
    use_comfy_org_fallback: bool = True,
    use_brave_fallback: bool = True,
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
        f"brave{int(bool(use_brave_fallback))}"
    )
    cache_key = f"hf_{filename}_exact{exact_only}_{token_key}_{brave_key}_{methods_key}"
    if cache_key in _search_cache:
        log_debug(f"HuggingFace search cache hit for {filename} (exact_only={exact_only})")
        return _search_cache[cache_key]

    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        log_info(
            f"HuggingFace search start: filename={filename}, exact_only={exact_only}"
        )

        repos_to_check = []
        seen_repos = set()
        search_queries = _build_huggingface_search_queries(filename)

        if use_api_search:
            for search_query in search_queries:
                search_url = f"{HF_API_URL}/models?search={quote(search_query)}&limit=20"
                response = requests.get(search_url, headers=headers, timeout=10)
                if response.status_code != 200:
                    log_warn(
                        f"HuggingFace search returned {response.status_code} for query={search_query}"
                    )
                    continue

                repos = response.json()
                log_info(
                    f"HuggingFace search API returned {len(repos)} repos for query={search_query}"
                )

                for repo in repos:
                    repo_id = repo.get("id", "")
                    if repo_id and repo_id not in seen_repos:
                        seen_repos.add(repo_id)
                        repos_to_check.append(repo_id)

        for repo_id in repos_to_check:
            log_debug(f"HuggingFace checking repo {repo_id} for filename={filename}")
            files = _get_repo_tree(repo_id, headers=headers)
            if not files:
                continue

            log_debug(f"HuggingFace repo {repo_id} returned {len(files)} tree items")
            result = _find_matching_file_in_repo(
                repo_id, files, filename, exact_only=exact_only
            )
            if result:
                _search_cache[cache_key] = result
                log_info(
                    f"Found {result['match_type']} HuggingFace match for {filename}: {repo_id}/{result['path']}"
                )
                return result

        author_fallback_repos = []
        if use_comfy_org_fallback:
            for author in HF_AUTHOR_FALLBACKS:
                repos = _get_repos_by_author(author, headers=headers)
                log_info(
                    f"HuggingFace author fallback returned {len(repos)} repos for author={author}"
                )
                for repo_id in repos:
                    if repo_id not in seen_repos:
                        seen_repos.add(repo_id)
                        author_fallback_repos.append(repo_id)

        for repo_id in author_fallback_repos:
            log_debug(
                f"HuggingFace author fallback checking repo {repo_id} for filename={filename}"
            )
            files = _get_repo_tree(repo_id, headers=headers)
            if not files:
                continue

            result = _find_matching_file_in_repo(
                repo_id, files, filename, exact_only=exact_only
            )
            if result:
                _search_cache[cache_key] = result
                log_info(
                    f"Found {result['match_type']} HuggingFace author fallback match for {filename}: {repo_id}/{result['path']}"
                )
                return result

        brave_candidates = (
            _search_brave_for_huggingface_candidates(filename, brave_api_key or "")
            if use_brave_fallback
            else []
        )
        log_info(
            f"Brave fallback returned {len(brave_candidates)} candidates for filename={filename}"
        )

        for candidate in brave_candidates:
            repo_id = candidate.get("repo", "")
            branch = candidate.get("branch", "main")
            expected_file = candidate.get("filename", filename)
            files = _get_repo_tree(repo_id, headers=headers, branch=branch)
            if not files:
                continue

            result = _find_matching_file_in_repo(
                repo_id, files, expected_file, exact_only=True
            )
            if result and result.get("filename", "").lower() == filename.lower():
                _search_cache[cache_key] = result
                log_info(
                    f"Found exact Brave fallback match for {filename}: {repo_id}/{result['path']}"
                )
                return result

        # Not found
        _search_cache[cache_key] = None
        log_info(
            f"HuggingFace search no result: filename={filename}, repos_checked={len(repos_to_check)}, author_fallback_repos={len(author_fallback_repos)}, brave_candidates={len(brave_candidates)}"
        )
        return None

    except Exception as e:
        log_exception(f"HuggingFace search error for {filename}: {e}")
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
        log_error(f"HuggingFace search error: {e}")

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
                    files.append(
                        {
                            "filename": os.path.basename(path),
                            "path": path,
                            "url": get_huggingface_download_url(repo, path),
                            "size": item.get("size"),
                        }
                    )

    except Exception as e:
        log_error(f"Error getting repo files: {e}")

    return files

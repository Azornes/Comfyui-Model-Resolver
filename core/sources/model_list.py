"""
Model List Database Module

Search the ComfyUI Manager model-list.json database with fuzzy matching.
"""

import hashlib
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..log_system import create_module_logger
from ..matcher import calculate_similarity, normalize_filename

log = create_module_logger(__name__)


from ..catalog_manager import CatalogManager
from ..path_utils import METADATA_DIR

MODEL_LIST_FILE = os.path.join(METADATA_DIR, "model-list.json")
MODEL_LIST_META_FILE = os.path.join(METADATA_DIR, "model-list.meta.json")
catalog_mgr = CatalogManager(MODEL_LIST_FILE, MODEL_LIST_META_FILE, "models")
MODEL_LIST_SOURCE_URL = (
    "https://raw.githubusercontent.com/Comfy-Org/ComfyUI-Manager/main/model-list.json"
)
MODEL_LIST_GITHUB_API_URL = (
    "https://api.github.com/repos/Comfy-Org/ComfyUI-Manager/contents/model-list.json?ref=main"
)
from ..network_utils import request_source_json

HTTP_TIMEOUT = 30

# Cache for loaded data
_model_list_cache: Optional[List[Dict]] = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _fetch_json_url(url: str) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "comfyui-model-resolver",
    }
    return request_source_json(
        url,
        headers=headers,
        timeout=HTTP_TIMEOUT,
        log_name="ModelList",
        raise_on_error=True,
    )





def _read_model_list_file() -> Dict[str, Any]:
    return catalog_mgr.read_data()


def _read_model_list_meta() -> Dict[str, Any]:
    return catalog_mgr.read_meta()


def _get_local_model_list_sha() -> str:
    try:
        with open(MODEL_LIST_FILE, "rb") as f:
            content = f.read()
        header = f"blob {len(content)}\0".encode()
        return hashlib.sha1(header + content).hexdigest()
    except Exception as e:
        log.warning(f"Error calculating model-list.json SHA: {e}")
        return ""


def _get_remote_model_list_info() -> Dict[str, Any]:
    data = _fetch_json_url(MODEL_LIST_GITHUB_API_URL)
    return {
        "sha": data.get("sha") or "",
        "size": data.get("size") or 0,
        "download_url": data.get("download_url") or MODEL_LIST_SOURCE_URL,
        "html_url": data.get("html_url") or "https://github.com/Comfy-Org/ComfyUI-Manager/blob/main/model-list.json",
    }


def reload_model_list():
    """Clear in-memory cache so the next search reads model-list.json again."""
    global _model_list_cache
    _model_list_cache = None
    _load_model_list()


def _load_model_list() -> List[Dict]:
    """Load model list database."""
    global _model_list_cache

    if _model_list_cache is not None:
        return _model_list_cache

    data = catalog_mgr.read_data()
    _model_list_cache = data.get("models", [])
    log.info(
        f"Loaded {len(_model_list_cache)} models from model-list.json"
    )
    return _model_list_cache


def get_model_list_update_status(check_remote: bool = False) -> Dict[str, Any]:
    """Return local model-list metadata and optionally compare it with GitHub."""
    data = _read_model_list_file()
    models = data.get("models", []) if isinstance(data, dict) else []
    meta = _read_model_list_meta()
    local_sha = meta.get("sha") or _get_local_model_list_sha()
    local_updated_at = meta.get("updated_at") or ""

    status = {
        "source_url": MODEL_LIST_SOURCE_URL,
        "github_url": "https://github.com/Comfy-Org/ComfyUI-Manager/blob/main/model-list.json",
        "local_count": len(models) if isinstance(models, list) else 0,
        "local_sha": local_sha,
        "local_updated_at": local_updated_at,
        "remote_sha": "",
        "remote_size": 0,
        "remote_checked_at": "",
        "update_available": False,
        "can_compare": bool(local_sha),
    }

    if check_remote:
        remote = _get_remote_model_list_info()
        remote_sha = remote.get("sha") or ""
        status.update(
            {
                "remote_sha": remote_sha,
                "remote_size": remote.get("size") or 0,
                "remote_checked_at": _utc_now_iso(),
                "update_available": bool(remote_sha and local_sha and remote_sha != local_sha),
                "can_compare": bool(local_sha and remote_sha),
            }
        )

    return status


def update_model_list_from_remote() -> Dict[str, Any]:
    """Download the latest ComfyUI-Manager model-list.json and refresh cache."""
    remote = _get_remote_model_list_info()
    download_url = remote.get("download_url") or MODEL_LIST_SOURCE_URL
    data = _fetch_json_url(download_url)
    models = data.get("models", []) if isinstance(data, dict) else []
    if not isinstance(models, list) or not models:
        raise ValueError("Downloaded model-list.json does not contain a non-empty models list")

    meta = {
        "source": "Comfy-Org/ComfyUI-Manager",
        "source_url": MODEL_LIST_SOURCE_URL,
        "github_url": remote.get("html_url")
        or "https://github.com/Comfy-Org/ComfyUI-Manager/blob/main/model-list.json",
        "sha": remote.get("sha") or "",
        "size": remote.get("size") or 0,
        "model_count": len(models),
        "updated_at": _utc_now_iso(),
    }
    catalog_mgr.save(data, meta, indent=2)
    reload_model_list()

    return {
        **get_model_list_update_status(check_remote=False),
        "updated": True,
        "remote_sha": meta["sha"],
        "remote_size": meta["size"],
    }





def search_model_list(
    filename: str, exact_only: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Search model-list.json for a model by filename.
    Uses exact match first, then fuzzy matching (unless exact_only=True).

    Args:
        filename: Model filename to search for
        exact_only: If True, only return exact matches (for downloads).
                   If False, also try fuzzy matching (for local file resolution).

    Returns:
        Dict with url, filename, type, etc. if found, None otherwise
    """
    models = _load_model_list()
    if not models:
        return None

    filename_lower = filename.lower()
    filename_base = os.path.splitext(filename_lower)[0]
    filename_norm = normalize_filename(filename)

    # 1. Exact match first (always try this)
    for model in models:
        model_filename = model.get("filename", "")
        if model_filename.lower() == filename_lower:
            url = model.get("url", "")
            if url:
                return {
                    "source": "model_list",
                    "filename": model_filename,
                    "url": url,
                    "name": model.get("name", ""),
                    "type": model.get("type", ""),
                    "directory": model.get("save_path", "checkpoints"),
                    "size": model.get("size", ""),
                    "match_type": "exact",
                }

    # If exact_only is True, don't try fuzzy matching - prevents confusing
    # users with wrong model suggestions for downloads
    if exact_only:
        return None

    # 2. Fuzzy substring match - check if filename contains or is contained by model name
    # WMD returns immediately on first substring match - do the same for reliability
    for model in models:
        model_filename = model.get("filename", "")
        if not model_filename:
            continue

        model_base = os.path.splitext(model_filename.lower())[0]

        # Check substring matches (exactly like WMD does)
        if filename_base in model_base or model_base in filename_base:
            url = model.get("url", "")
            if url:
                score = calculate_similarity(filename_norm, normalize_filename(model_filename))
                return {
                    "source": "model_list",
                    "filename": model_filename,
                    "url": url,
                    "name": model.get("name", ""),
                    "type": model.get("type", ""),
                    "directory": model.get("save_path", "checkpoints"),
                    "size": model.get("size", ""),
                    "match_type": "fuzzy",
                    "confidence": round(score * 100, 1),
                }

    # 3. Try normalized similarity matching on all models (fallback)
    best_match = None
    best_score = 0.0

    for model in models:
        model_filename = model.get("filename", "")
        if not model_filename:
            continue

        model_norm = normalize_filename(model_filename)
        score = calculate_similarity(filename_norm, model_norm)

        if score > best_score and score > 0.5:  # Require 50% similarity
            url = model.get("url", "")
            if url:
                best_score = score
                best_match = {
                    "source": "model_list",
                    "filename": model_filename,
                    "url": url,
                    "name": model.get("name", ""),
                    "type": model.get("type", ""),
                    "directory": model.get("save_path", "checkpoints"),
                    "size": model.get("size", ""),
                    "match_type": "similar",
                    "confidence": round(score * 100, 1),
                }

    return best_match


def search_model_list_multiple(filename: str, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Search model-list.json and return multiple fuzzy matches.

    Args:
        filename: Model filename to search for
        limit: Maximum results to return

    Returns:
        List of matching models sorted by relevance
    """
    models = _load_model_list()
    if not models:
        return []

    filename_norm = normalize_filename(filename)
    results = []

    for model in models:
        model_filename = model.get("filename", "")
        if not model_filename:
            continue

        model_norm = normalize_filename(model_filename)
        score = calculate_similarity(filename_norm, model_norm)

        if score > 0.4:  # Minimum 40% similarity
            url = model.get("url", "")
            if url:
                results.append(
                    {
                        "source": "model_list",
                        "filename": model_filename,
                        "url": url,
                        "name": model.get("name", ""),
                        "type": model.get("type", ""),
                        "directory": model.get("save_path", "checkpoints"),
                        "size": model.get("size", ""),
                        "confidence": round(score * 100, 1),
                    }
                )

    # Sort by confidence descending
    results.sort(key=lambda x: x["confidence"], reverse=True)

    return results[:limit]



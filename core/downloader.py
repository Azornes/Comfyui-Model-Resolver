"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests

from .log_system import create_module_logger

log = create_module_logger(__name__)

from .network_utils import (
    host_matches_domain,
    request_public_url,
    validate_public_http_url,
)
from .path_utils import (
    calculate_file_sha256,
    get_comfy_root_path,
    get_filename_from_path,
    get_metadata_sidecar_path,
    get_path_identity,
    is_path_within,
    read_json_safe,
    write_json_atomic,
)
from .resolver import invalidate_local_hash_match_cache, normalize_sha256
from .scanner import invalidate_model_files_cache
from .type_utils import (
    DEFAULT_BROWSER_USER_AGENT,
    MODEL_EXTENSIONS,
    as_dict,
    as_list,
    extract_response_file_size,
    first_non_empty,
    get_category_folder_keys,
    normalize_category_to_model_type,
)
from .type_utils import format_size_bytes as format_bytes

try:
    import folder_paths
except ImportError:
    folder_paths = None

# Download state tracking
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()
aria2_lock = threading.RLock()
aria2_process: Optional[subprocess.Popen] = None
aria2_rpc_url = ""
aria2_rpc_secret = ""
aria2_rpc_lock = threading.Lock()
aria2_transfers: Dict[str, Dict[str, Any]] = {}
aria2_action_locks: Dict[str, threading.Lock] = {}
aria2_desired_states: Dict[str, Dict[str, Any]] = {}
aria2_idle_timer: Optional[threading.Timer] = None
aria2_process_started_by_resolver = False
xet_transfers: Dict[str, Dict[str, Any]] = {}
xet_transfers_lock = threading.Lock()

# Speed calculation settings
SPEED_HISTORY_SIZE = 5  # Number of samples for smoothing
CHUNK_SIZE = 1024 * 1024  # 1MB chunks for faster downloads
CLI_LOG_INTERVAL = 5  # Log progress to CLI every N seconds
ARIA2_RPC_TIMEOUT = (2, 5)  # local JSON-RPC should respond quickly
ARIA2_STATUS_RPC_RETRIES = 4
ARIA2_STATUS_RPC_RETRY_DELAY = 0.15
ARIA2_IDLE_STOP_SECONDS = 5 * 60
DOWNLOAD_USER_AGENT = DEFAULT_BROWSER_USER_AGENT
MANAGED_ARIA2_ROOT = Path(__file__).resolve().parents[1] / "tools" / "aria2"
HF_XET_ARIA2_AUTH_HOSTS = {
    "cas-bridge.xethub.hf.co",
    "cas-bridge-direct.xethub.hf.co",
    "cas-bridge-direct.xethub-eu.hf.co",
}

from .settings import (
    load_settings,
    normalize_download_backend,
    normalize_download_category,
    normalize_relative_subfolder,
)

SENSITIVE_METADATA_KEYS = {
    "authorization",
    "headers",
    "hf_token",
    "civitai_key",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "session",
    "session_token",
    "cookie",
    "cookies",
}

SENSITIVE_QUERY_KEYS = {
    "authorization",
    "auth",
    "hf_token",
    "civitai_key",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "session",
    "sessionid",
    "cookie",
}

_INVALID_DOWNLOAD_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_HTTP_URL_IN_TEXT_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def sanitize_download_filename(filename: Any) -> str:
    """Return a safe basename for a downloaded model file."""
    text = get_filename_from_path(str(filename or "")).strip()
    text = _INVALID_DOWNLOAD_FILENAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if text in {"", ".", ".."}:
        return ""
    return text


def is_allowed_model_download_filename(filename: Any) -> bool:
    """Return True only for model file extensions supported by the resolver."""
    safe_name = sanitize_download_filename(filename)
    return bool(safe_name and os.path.splitext(safe_name)[1].lower() in MODEL_EXTENSIONS)


def _is_sensitive_metadata_key(key: Any) -> bool:
    key_text = str(key or "").strip().lower()
    return (
        key_text in SENSITIVE_METADATA_KEYS
        or "token" in key_text
        or "authorization" in key_text
        or "cookie" in key_text
    )


def _strip_sensitive_url_params(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.query:
        return value

    filtered = []
    changed = False
    for key, item_value in parse_qsl(parsed.query, keep_blank_values=True):
        key_lower = key.lower()
        if key_lower in SENSITIVE_QUERY_KEYS or "token" in key_lower:
            changed = True
            continue
        filtered.append((key, item_value))

    if not changed:
        return value
    return urlunparse(parsed._replace(query=urlencode(filtered, doseq=True)))


def _sanitize_download_error(value: Any) -> str:
    """Remove signed query strings and credentials from errors shown or logged."""
    text = str(value or "")

    def redact_url(match: re.Match) -> str:
        raw_url = match.group(0)
        try:
            parsed = urlparse(raw_url)
            if parsed.query:
                return urlunparse(parsed._replace(query="", fragment=""))
        except Exception:
            pass
        return raw_url

    return _HTTP_URL_IN_TEXT_RE.sub(redact_url, text)


def _clean_http_header_value(value: Any) -> str:
    return str(value or "").replace("\r", "").replace("\n", "").strip()


def _get_header_value(headers: Dict[str, str], key: str) -> str:
    key_lower = key.lower()
    for existing_key, value in headers.items():
        if str(existing_key).lower() == key_lower:
            return str(value or "")
    return ""


def _set_header_default(headers: Dict[str, str], key: str, value: str) -> None:
    if not _get_header_value(headers, key):
        headers[key] = value


def build_download_headers(
    url: str,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build request headers shared by the Python and aria2 download backends."""
    request_headers: Dict[str, str] = {}
    for key, value in (headers or {}).items():
        clean_key = _clean_http_header_value(key)
        clean_value = _clean_http_header_value(value)
        if clean_key and clean_value:
            request_headers[clean_key] = clean_value

    _set_header_default(request_headers, "User-Agent", DOWNLOAD_USER_AGENT)
    _set_header_default(request_headers, "Accept", "*/*")
    _set_header_default(request_headers, "Accept-Encoding", "identity")

    host = urlparse(str(url or "")).hostname
    if host_matches_domain(host, "civitai.com", "civitai.red"):
        _set_header_default(request_headers, "Referer", "https://civitai.com/")
        _set_header_default(request_headers, "Origin", "https://civitai.com")

    return request_headers


def _resolve_download_url_for_aria2(
    url: str,
    headers: Optional[Dict[str, str]] = None,
) -> tuple[str, Dict[str, str]]:
    """Preflight an aria2 URL and validate every redirect before RPC handoff."""
    request_headers = build_download_headers(url, headers)
    source_host = urlparse(str(url or "")).hostname
    is_huggingface_source = host_matches_domain(source_host, "huggingface.co")
    response = None
    try:
        response, resolved_url, resolved_headers = request_public_url(
            "GET",
            url,
            headers=request_headers,
            timeout=20,
            stream=True,
            trusted_sensitive_redirect_hosts=(
                HF_XET_ARIA2_AUTH_HOSTS if is_huggingface_source else None
            ),
            trusted_sensitive_redirect_headers=(
                {"authorization"} if is_huggingface_source else None
            ),
        )
        response.raise_for_status()
        return resolved_url, resolved_headers
    finally:
        if response is not None:
            response.close()


def _json_safe_metadata(value: Any, depth: int = 0) -> Any:
    if depth > 10:
        return str(value)

    if isinstance(value, dict):
        cleaned = {}
        for key, item_value in value.items():
            if _is_sensitive_metadata_key(key):
                continue
            cleaned[str(key)] = _json_safe_metadata(item_value, depth + 1)
        return cleaned

    if isinstance(value, (list, tuple, set)):
        return [_json_safe_metadata(item, depth + 1) for item in value]

    if isinstance(value, str):
        return _strip_sensitive_url_params(value)

    if value is None or isinstance(value, (bool, int, float)):
        return value

    return str(value)


_as_dict = as_dict
_as_list = as_list
_first_present = first_non_empty


def _coerce_int_or_value(value: Any) -> Any:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _coerce_size(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _normalise_metadata_file_path(path_value: str) -> str:
    return str(path_value or "").replace(os.sep, "/")


def _resolve_lora_manager_model_type(category: str, source_type: Any = "") -> str:
    res = normalize_category_to_model_type(category)
    if res in ("checkpoint", "diffusion_model", "embedding"):
        return res

    source_token = (
        str(source_type or "")
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
    )
    if "checkpoint" in source_token:
        return "checkpoint"
    if "diffusion" in source_token or source_token == "unet":
        return "diffusion_model"
    if "textual" in source_token or "embedding" in source_token:
        return "embedding"
    return ""


def _metadata_source_value(source_name: str, existing: Any = None) -> Optional[str]:
    if existing:
        return str(existing)

    source_token = str(source_name or "").strip().lower()
    if source_token == "civitai":
        return "civitai_api"
    if source_token == "civarchive":
        return "civarchive"
    if source_token == "lora_manager_archive":
        return "archive_db"
    return None


def _find_metadata_file_info(
    source: Dict[str, Any],
    selected_version: Dict[str, Any],
    filename: str,
) -> Dict[str, Any]:
    for key in ("file_info", "file"):
        value = source.get(key)
        if isinstance(value, dict):
            return value

    filename_lower = get_filename_from_path(str(filename or "")).lower()
    file_lists = [
        source.get("files"),
        selected_version.get("files"),
    ]
    for file_list in file_lists:
        if not isinstance(file_list, list):
            continue
        first_file = None
        for file_info in file_list:
            if not isinstance(file_info, dict):
                continue
            if first_file is None:
                first_file = file_info
            candidate = str(
                file_info.get("name")
                or file_info.get("filename")
                or file_info.get("fileName")
                or ""
            ).lower()
            if filename_lower and candidate == filename_lower:
                return file_info
        if first_file:
            return first_file
    return {}


def _extract_expected_sha256(metadata: Optional[Dict[str, Any]]) -> str:
    source = metadata if isinstance(metadata, dict) else {}
    details = _as_dict(source.get("civitai_details") or source.get("details"))
    selected_version = _as_dict(
        source.get("selected_version") or details.get("selected_version")
    )
    path_metadata = _as_dict(source.get("path_metadata"))
    filename = _first_present(
        source.get("filename"),
        path_metadata.get("filename"),
    )
    file_info = _find_metadata_file_info(source, selected_version, str(filename))
    hashes = _as_dict(_first_present(file_info.get("hashes"), source.get("hashes")))
    return normalize_sha256(
        _first_present(
            source.get("sha256"),
            source.get("hash"),
            file_info.get("sha256"),
            file_info.get("hash"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
        )
    )


def read_completed_metadata_sha256(file_path: str) -> str:
    """Read a trusted SHA256 from a LoRA Manager-compatible sidecar if available."""
    metadata_path = get_metadata_sidecar_path(file_path)
    if not os.path.exists(metadata_path):
        return ""

    payload = read_json_safe(metadata_path, {})
    if not isinstance(payload, dict) or not payload:
        return ""

    hash_status = str(payload.get("hash_status") or "completed").strip().lower()
    if hash_status != "completed":
        log.debug(
            f"Skipping metadata SHA256 for {metadata_path}: hash_status={hash_status}"
        )
        return ""

    return normalize_sha256(payload.get("sha256") or payload.get("hash"))


def build_lora_manager_metadata(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    source_url: str = "",
) -> Dict[str, Any]:
    """Build a LoRA Manager-compatible .metadata.json payload."""
    source = _json_safe_metadata(metadata or {})
    if not isinstance(source, dict):
        source = {}

    path_metadata = _as_dict(source.get("path_metadata"))
    details = _as_dict(source.get("civitai_details") or source.get("details"))
    selected_version = _as_dict(
        source.get("selected_version") or details.get("selected_version")
    )

    basename = get_filename_from_path(dest_path)
    file_name = os.path.splitext(basename)[0]
    filename = _first_present(
        source.get("filename"),
        path_metadata.get("filename"),
        basename,
    )
    model_name = _first_present(
        source.get("model_name"),
        source.get("model"),
        source.get("name"),
        details.get("name"),
        path_metadata.get("model_name"),
        path_metadata.get("name"),
        os.path.splitext(str(filename))[0],
        file_name,
    )
    version_name = _first_present(
        source.get("version_name"),
        source.get("versionName"),
        source.get("version"),
        selected_version.get("name"),
        path_metadata.get("version_name"),
    )
    base_model = _first_present(
        source.get("base_model"),
        source.get("baseModel"),
        selected_version.get("base_model"),
        selected_version.get("baseModel"),
        path_metadata.get("base_model"),
        "Unknown",
    )
    source_name = str(
        _first_present(source.get("details_source"), source.get("source"), details.get("source"))
        or ""
    ).lower()

    model_id = _first_present(
        source.get("model_id"),
        source.get("modelId"),
        details.get("model_id"),
        path_metadata.get("model_id"),
    )
    version_id = _first_present(
        source.get("version_id"),
        source.get("versionId"),
        details.get("version_id"),
        selected_version.get("id"),
        path_metadata.get("version_id"),
    )

    tags = _as_list(
        _first_present(
            source.get("tags"),
            details.get("tags"),
            path_metadata.get("tags"),
        )
    )
    trained_words = _as_list(
        _first_present(
            source.get("trained_words"),
            source.get("trainedWords"),
            selected_version.get("trained_words"),
            selected_version.get("trainedWords"),
        )
    )
    images = _as_list(
        _first_present(
            source.get("images"),
            selected_version.get("images"),
            details.get("images"),
        )
    )
    creator = _as_dict(
        _first_present(source.get("creator"), details.get("creator"), path_metadata.get("creator"))
    )
    file_info = _find_metadata_file_info(source, selected_version, str(filename))
    hashes = _as_dict(_first_present(file_info.get("hashes"), source.get("hashes")))
    sha256 = str(
        _first_present(
            source.get("sha256"),
            source.get("hash"),
            file_info.get("sha256"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
        )
        or ""
    ).lower()
    direct_url = _first_present(
        source.get("download_url"),
        source.get("downloadUrl"),
        source.get("source_url"),
        source_url,
        source.get("url"),
    )
    source_page_url = _first_present(
        source.get("version_url"),
        source.get("model_url"),
        source.get("page_url"),
        source.get("source_url"),
        source.get("url"),
        source.get("platform_url"),
        source_url,
    )
    platform_url = _first_present(source.get("platform_url"), source.get("platformUrl"))
    preview_url = _first_present(
        source.get("preview_url"),
        source.get("previewUrl"),
        source.get("preview"),
        source.get("thumbnail_url"),
        source.get("thumbnailUrl"),
    )
    model_description = _first_present(
        source.get("modelDescription"),
        source.get("model_description"),
        source.get("description"),
        details.get("description"),
        _as_dict(source.get("model")).get("description"),
    )
    version_description = _first_present(
        selected_version.get("description"),
        source.get("version_description"),
    )

    civitai_payload = dict(_as_dict(source.get("civitai")))
    if model_id and "modelId" not in civitai_payload:
        civitai_payload["modelId"] = _coerce_int_or_value(model_id)
    if version_id and "id" not in civitai_payload:
        civitai_payload["id"] = _coerce_int_or_value(version_id)
    if version_name and "name" not in civitai_payload:
        civitai_payload["name"] = str(version_name)
    if base_model and "baseModel" not in civitai_payload:
        civitai_payload["baseModel"] = str(base_model)
    if trained_words and "trainedWords" not in civitai_payload:
        civitai_payload["trainedWords"] = trained_words
    if images and "images" not in civitai_payload:
        civitai_payload["images"] = images
    if direct_url and "downloadUrl" not in civitai_payload:
        civitai_payload["downloadUrl"] = _strip_sensitive_url_params(str(direct_url))
    if version_description and "description" not in civitai_payload:
        civitai_payload["description"] = str(version_description)

    files = _as_list(_first_present(selected_version.get("files"), source.get("files")))
    if files and "files" not in civitai_payload:
        civitai_payload["files"] = files

    model_payload = dict(_as_dict(civitai_payload.get("model")))
    if model_name and "name" not in model_payload:
        model_payload["name"] = str(model_name)
    model_type = _first_present(source.get("type"), source.get("model_type"), details.get("type"))
    if model_type and "type" not in model_payload:
        model_payload["type"] = str(model_type)
    if model_description and "description" not in model_payload:
        model_payload["description"] = str(model_description)
    if tags and "tags" not in model_payload:
        model_payload["tags"] = tags
    if model_payload:
        civitai_payload["model"] = model_payload
    if creator and "creator" not in civitai_payload:
        civitai_payload["creator"] = creator

    metadata_source = _metadata_source_value(source_name, source.get("metadata_source"))
    if os.path.exists(dest_path):
        size = os.path.getsize(dest_path)
    else:
        size = _coerce_size(_first_present(source.get("size"), file_info.get("size")))

    payload: Dict[str, Any] = {
        "file_name": file_name,
        "model_name": str(model_name or file_name),
        "file_path": _normalise_metadata_file_path(dest_path),
        "size": size,
        "modified": time.time(),
        "sha256": sha256,
        "base_model": str(base_model or "Unknown"),
        "preview_url": str(preview_url or ""),
        "preview_nsfw_level": 0,
        "notes": "",
        "from_civitai": bool(metadata_source or model_id or version_id),
        "civitai": civitai_payload,
        "tags": tags,
        "modelDescription": str(model_description or ""),
        "civitai_deleted": bool(source.get("is_deleted") or source.get("civitai_deleted")),
        "favorite": False,
        "exclude": False,
        "db_checked": False,
        "skip_metadata_refresh": False,
        "source": source_name,
        "details_source": source_name,
        "source_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "model_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "version_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "download_url": _strip_sensitive_url_params(str(direct_url or "")),
        "platform_url": _strip_sensitive_url_params(str(platform_url or "")),
        "metadata_source": metadata_source,
        "last_checked_at": time.time(),
        "hash_status": "completed" if sha256 else "pending",
    }

    lora_manager_type = _resolve_lora_manager_model_type(category, model_type)
    if normalize_download_category(category) == "loras":
        payload["usage_tips"] = str(source.get("usage_tips") or "{}")
    elif lora_manager_type:
        payload["model_type"] = lora_manager_type
        payload["sub_type"] = lora_manager_type

    return payload


def write_lora_manager_metadata(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    source_url: str = "",
) -> Optional[str]:
    """Write the LoRA Manager-compatible sidecar metadata next to a model file."""
    metadata_path = get_metadata_sidecar_path(dest_path)

    try:
        payload = build_lora_manager_metadata(dest_path, metadata, category, source_url)
        write_json_atomic(metadata_path, payload, indent=2)
        log.info(f"Metadata saved: {metadata_path}")
        return metadata_path
    except Exception as e:
        log.warning(f"Could not save metadata sidecar for {dest_path}: {e}")
        return None




# Imported from .settings


def get_download_directory(category: str, preferred_base_directory: str = "") -> Optional[str]:
    """
    Get the appropriate download directory for a model category.

    Args:
        category: Model category (e.g., 'checkpoints', 'loras', 'vae')
        preferred_base_directory: Optional configured base directory to use

    Returns:
        Absolute path to the download directory, or None if not found
    """
    global folder_paths

    if folder_paths is None:
        # Try to import again - ComfyUI might have initialized since last check
        try:
            import folder_paths as fp

            folder_paths = fp
        except ImportError:
            return None

    folder_keys = get_category_folder_keys(category)
    folder_key = folder_keys[0]

    def _normalize(path_value: str) -> str:
        return get_path_identity(path_value)

    def _is_within(path_value: str, root_value: str) -> bool:
        return is_path_within(path_value, root_value)

    def _choose_preferred_path(paths: List[str], preferred_key: str = "") -> Optional[str]:
        if not paths:
            return None

        comfy_root = get_comfy_root_path(folder_paths)

        def _basename(path_value: str) -> str:
            return get_filename_from_path(os.path.normpath(path_value)).lower()

        def _prefer_redirected(candidate_paths: List[str]) -> Optional[str]:
            if not candidate_paths:
                return None
            if comfy_root:
                redirected_paths = [path for path in candidate_paths if not _is_within(path, comfy_root)]
                if redirected_paths:
                    return redirected_paths[0]
            return candidate_paths[0]

        if preferred_key == "diffusion_models":
            canonical_paths = [path for path in paths if _basename(path) == "diffusion_models"]
            preferred_path = _prefer_redirected(canonical_paths)
            if preferred_path:
                return preferred_path

            non_legacy_paths = [path for path in paths if _basename(path) != "unet"]
            preferred_path = _prefer_redirected(non_legacy_paths)
            if preferred_path:
                return preferred_path

        if preferred_key == "text_encoders":
            canonical_paths = [path for path in paths if _basename(path) == "text_encoders"]
            preferred_path = _prefer_redirected(canonical_paths)
            if preferred_path:
                return preferred_path

            non_legacy_paths = [path for path in paths if _basename(path) != "clip"]
            preferred_path = _prefer_redirected(non_legacy_paths)
            if preferred_path:
                return preferred_path

        if comfy_root:
            redirected_paths = [path for path in paths if not _is_within(path, comfy_root)]
            if redirected_paths:
                return redirected_paths[0]

        return paths[0]

    try:
        paths = []
        seen_paths = set()
        for candidate_key in folder_keys:
            for path in folder_paths.get_folder_paths(candidate_key) or []:
                path_key = _normalize(path)
                if path_key in seen_paths:
                    continue
                seen_paths.add(path_key)
                paths.append(path)
        if paths:
            if preferred_base_directory:
                preferred_normalized = _normalize(preferred_base_directory)
                for path in paths:
                    if _normalize(path) == preferred_normalized:
                        return path
            return _choose_preferred_path(paths, folder_key)

        # If category not found, try to get any models directory as fallback
        all_names = folder_paths.get_folder_names()
        if all_names:
            # Fall back to first available directory
            fallback_paths = folder_paths.get_folder_paths(all_names[0])
            if fallback_paths:
                return _choose_preferred_path(fallback_paths, all_names[0])
    except Exception as e:
        log.debug(f"Could not get folder path for {folder_key}: {e}")

    return None


def generate_download_id() -> str:
    """Generate a unique download ID."""
    import uuid

    return str(uuid.uuid4())[:8]


class Aria2Error(RuntimeError):
    """Raised when the aria2 backend cannot start or process a request."""


def _download_backend_from_settings(settings: Optional[Dict[str, Any]] = None) -> str:
    active_settings = settings if isinstance(settings, dict) else load_settings()
    return normalize_download_backend(active_settings.get("download_backend"))


def _try_certifi_ca_path() -> str:
    try:
        import certifi  # type: ignore

        path = certifi.where()
        return path if path and os.path.isfile(path) else ""
    except Exception:
        return ""


def _resolve_aria2c_executable(settings: Optional[Dict[str, Any]] = None) -> str:
    active_settings = settings if isinstance(settings, dict) else load_settings()
    configured = str(active_settings.get("aria2c_path") or "").strip()
    candidate = os.path.expandvars(os.path.expanduser(configured or "aria2c"))
    expected_names = {"aria2c", "aria2c.exe"}
    candidate_name = get_filename_from_path(candidate).lower()
    has_path_component = bool(
        os.path.isabs(candidate)
        or os.path.dirname(candidate)
        or "/" in candidate
        or "\\" in candidate
    )

    if has_path_component:
        if (
            candidate_name in expected_names
            and os.path.isfile(candidate)
            and is_path_within(candidate, MANAGED_ARIA2_ROOT)
        ):
            return os.path.realpath(os.path.abspath(candidate))
        raise Aria2Error(
            "Custom aria2c paths are restricted to the managed Model Resolver install. "
            "Use the built-in aria2 installer or place aria2c on PATH."
        )

    if candidate_name in expected_names:
        resolved = shutil.which(candidate)
        if resolved and get_filename_from_path(resolved).lower() in expected_names:
            return os.path.realpath(os.path.abspath(resolved))

    raise Aria2Error(
        "aria2c executable was not found. Use the built-in installer or place aria2c on PATH."
    )


def _read_aria2_version(executable: str) -> str:
    if not executable:
        return ""
    try:
        kwargs: Dict[str, Any] = {}
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            [executable, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=5,
            check=False,
            **kwargs,
        )
    except Exception:
        return ""

    first_line = ""
    for line in str(result.stdout or "").splitlines():
        text = line.strip()
        if text:
            first_line = text
            break
    if not first_line:
        return ""

    for token in first_line.replace(",", " ").split():
        if token and token[0].isdigit():
            return token
    return first_line


def get_aria2_status(settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    global aria2_process, aria2_process_started_by_resolver

    active_settings = settings if isinstance(settings, dict) else load_settings()
    configured_path = str(active_settings.get("aria2c_path") or "").strip()
    try:
        resolved_path = _resolve_aria2c_executable(active_settings)
        available = True
        version = _read_aria2_version(resolved_path)
        error = ""
    except Exception as exc:
        resolved_path = ""
        available = False
        version = ""
        error = str(exc)

    with aria2_lock:
        running = aria2_process is not None and aria2_process.poll() is None
        if not running and aria2_process is not None:
            aria2_process = None
            aria2_process_started_by_resolver = False
        managed = bool(running and aria2_process_started_by_resolver)
        active_transfers = len(aria2_transfers)

    return {
        "backend": _download_backend_from_settings(active_settings),
        "configured_path": configured_path,
        "resolved_path": resolved_path,
        "available": available,
        "version": version,
        "running": running,
        "managed": managed,
        "can_stop": bool(managed and active_transfers == 0),
        "active_transfers": active_transfers,
        "auto_stop_enabled": bool(active_settings.get("aria2_auto_stop_daemon", True)),
        "idle_stop_seconds": ARIA2_IDLE_STOP_SECONDS,
        "error": error,
    }


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _aria2_rpc(method: str, params: Optional[List[Any]] = None) -> Any:
    if not aria2_rpc_url:
        raise Aria2Error("aria2 RPC endpoint is not initialized")

    payload = {
        "jsonrpc": "2.0",
        "id": secrets.token_hex(8),
        "method": method,
        "params": [f"token:{aria2_rpc_secret}", *(params or [])],
    }
    # aria2's Windows RPC server can reset one connection when status polling
    # overlaps a pause/resume command. Keep local RPC requests serialized.
    with aria2_rpc_lock:
        response = requests.post(aria2_rpc_url, json=payload, timeout=ARIA2_RPC_TIMEOUT)
        text = response.text
        try:
            body = response.json()
        except ValueError as exc:
            raise Aria2Error(
                f"aria2 RPC returned non-JSON response ({response.status_code}): {text[:300]}"
            ) from exc

        if "error" in body:
            error = body.get("error") or {}
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise Aria2Error(message or f"aria2 RPC {method} failed")

        if response.status_code != 200:
            raise Aria2Error(
                f"aria2 RPC {method} returned HTTP {response.status_code}: {text[:300]}"
            )

        return body.get("result")


def _aria2_ping() -> bool:
    try:
        result = _aria2_rpc("aria2.getVersion", [])
        return isinstance(result, dict)
    except Exception:
        return False


def _cancel_aria2_idle_timer_locked() -> None:
    global aria2_idle_timer
    if aria2_idle_timer is not None:
        aria2_idle_timer.cancel()
        aria2_idle_timer = None


def _aria2_has_active_transfers_locked() -> bool:
    return bool(aria2_transfers)


def stop_aria2_daemon(reason: str = "manual") -> Dict[str, Any]:
    """Stop the aria2 RPC process started by Model Resolver."""
    global aria2_process, aria2_rpc_url, aria2_rpc_secret, aria2_process_started_by_resolver

    with aria2_lock:
        _cancel_aria2_idle_timer_locked()
        running = aria2_process is not None and aria2_process.poll() is None
        if not running:
            aria2_process = None
            aria2_rpc_url = ""
            aria2_rpc_secret = ""
            aria2_process_started_by_resolver = False
            return {"success": True, "stopped": False, "message": "aria2 daemon is not running"}

        if not aria2_process_started_by_resolver:
            return {
                "success": False,
                "stopped": False,
                "error": "This aria2 daemon was not started by Model Resolver.",
            }

        if _aria2_has_active_transfers_locked():
            return {
                "success": False,
                "stopped": False,
                "error": "aria2 daemon has active downloads.",
            }

        process = aria2_process
        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=2)
            except Exception:
                pass

        aria2_process = None
        aria2_rpc_url = ""
        aria2_rpc_secret = ""
        aria2_process_started_by_resolver = False

    log.info(f"aria2 RPC daemon stopped ({reason})")
    return {"success": True, "stopped": True, "message": "aria2 daemon stopped"}


def start_aria2_daemon(settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Start the aria2 RPC process without creating a download."""
    active_settings = settings if isinstance(settings, dict) else load_settings()
    try:
        _ensure_aria2_daemon(active_settings)
        status = get_aria2_status(active_settings)
        return {
            **status,
            "success": True,
            "started": bool(status.get("running")),
            "message": "aria2 daemon is running",
        }
    except Exception as exc:
        try:
            status = get_aria2_status(active_settings)
        except Exception:
            status = {}
        return {
            **status,
            "success": False,
            "started": False,
            "error": str(exc),
        }


def _aria2_idle_stop_worker() -> None:
    global aria2_idle_timer

    with aria2_lock:
        aria2_idle_timer = None

    settings = load_settings()
    if not settings.get("aria2_auto_stop_daemon", True):
        return
    with aria2_lock:
        running = aria2_process is not None and aria2_process.poll() is None
        if not running or not aria2_process_started_by_resolver or _aria2_has_active_transfers_locked():
            return
    stop_aria2_daemon(reason="idle")


def _schedule_aria2_idle_stop() -> None:
    global aria2_idle_timer
    settings = load_settings()
    if not settings.get("aria2_auto_stop_daemon", True):
        return
    with aria2_lock:
        _cancel_aria2_idle_timer_locked()
        running = aria2_process is not None and aria2_process.poll() is None
        if not running or not aria2_process_started_by_resolver or _aria2_has_active_transfers_locked():
            return
        aria2_idle_timer = threading.Timer(ARIA2_IDLE_STOP_SECONDS, _aria2_idle_stop_worker)
        aria2_idle_timer.daemon = True
        aria2_idle_timer.start()


def _ensure_aria2_daemon(settings: Optional[Dict[str, Any]] = None) -> None:
    global aria2_process, aria2_rpc_url, aria2_rpc_secret, aria2_process_started_by_resolver

    active_settings = settings if isinstance(settings, dict) else load_settings()
    with aria2_lock:
        _cancel_aria2_idle_timer_locked()
        if aria2_process is not None and aria2_process.poll() is None and _aria2_ping():
            return

        if aria2_process is not None and aria2_process.poll() is None:
            try:
                aria2_process.terminate()
            except Exception:
                pass
        aria2_process = None
        aria2_process_started_by_resolver = False

        executable = _resolve_aria2c_executable(active_settings)
        port = _find_free_port()
        aria2_rpc_secret = secrets.token_hex(16)
        aria2_rpc_url = f"http://127.0.0.1:{port}/jsonrpc"

        command = [
            executable,
            "--enable-rpc=true",
            "--rpc-listen-all=false",
            f"--rpc-listen-port={port}",
            f"--rpc-secret={aria2_rpc_secret}",
            "--check-certificate=true",
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "--file-allocation=none",
            "--max-concurrent-downloads=5",
            "--continue=true",
            "--daemon=false",
            "--quiet=true",
            f"--stop-with-process={os.getpid()}",
        ]
        ca_cert = _try_certifi_ca_path()
        if ca_cert:
            command.insert(5, f"--ca-certificate={ca_cert}")

        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        log.info(f"Starting aria2 RPC daemon from {executable}")
        aria2_process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=creationflags,
        )
        aria2_process_started_by_resolver = True

        start_time = time.time()
        last_error = ""
        while time.time() - start_time < 10:
            if aria2_process.poll() is not None:
                stderr = ""
                try:
                    stderr = (aria2_process.stderr.read() if aria2_process.stderr else b"").decode(
                        "utf-8",
                        errors="replace",
                    )
                except Exception:
                    stderr = ""
                raise Aria2Error(
                    f"aria2 RPC process exited early with code {aria2_process.returncode}: {stderr.strip()}"
                )
            try:
                if _aria2_ping():
                    return
            except Exception as exc:
                last_error = str(exc)
            time.sleep(0.2)

        raise Aria2Error(
            f"Timed out waiting for aria2 RPC to become ready{': ' + last_error if last_error else ''}"
        )


def _aria2_tell_status(gid: str) -> Dict[str, Any]:
    keys = [
        "gid",
        "status",
        "totalLength",
        "completedLength",
        "downloadSpeed",
        "errorMessage",
        "files",
    ]
    for attempt in range(ARIA2_STATUS_RPC_RETRIES):
        try:
            result = _aria2_rpc("aria2.tellStatus", [gid, keys])
            return result if isinstance(result, dict) else {}
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            if attempt + 1 >= ARIA2_STATUS_RPC_RETRIES:
                raise
            log.debug(
                f"Retrying aria2 status RPC for {gid} "
                f"({attempt + 2}/{ARIA2_STATUS_RPC_RETRIES})"
            )
            time.sleep(ARIA2_STATUS_RPC_RETRY_DELAY * (attempt + 1))

    return {}


def _parse_aria2_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _resolve_aria2_completed_path(status: Dict[str, Any], default_path: str) -> str:
    files = status.get("files")
    if isinstance(files, list) and files:
        first = files[0]
        if isinstance(first, dict):
            candidate = first.get("path")
            if isinstance(candidate, str) and candidate:
                return candidate
    return default_path


def _delete_partial_download_files(dest_path: str) -> None:
    for path in (dest_path, f"{dest_path}.aria2"):
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception as exc:
            log.warning(f"Could not delete incomplete download file {path}: {exc}")


def _delete_xet_partial_file(partial_path: str, attempts: int = 5) -> bool:
    """Delete a stopped Xet partial file, retrying while Windows releases it."""
    attempts = max(1, int(attempts or 1))
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            if not os.path.exists(partial_path):
                return True
            os.remove(partial_path)
            return True
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.25)

    log.warning(f"Could not delete incomplete Xet file {partial_path}: {last_error}")
    return False


class _HuggingFaceXetDownloadCancelled(Exception):
    """Raised by the Xet progress adapter when a download is cancelled."""


class _HuggingFaceXetProgressAdapter:
    """Forward hf_xet byte progress to the resolver's download state."""

    def __init__(self, download_id: str, total_size: int, start_time: float) -> None:
        self.download_id = download_id
        self.total_size = max(0, int(total_size or 0))
        self.downloaded = 0
        self.transfer_downloaded = 0
        self.transfer_total_size = 0
        self.last_update = start_time
        self.speed = 0

    def _publish(
        self,
        downloaded: int,
        speed: int,
        transfer_downloaded: int = 0,
        transfer_total_size: int = 0,
    ) -> None:
        downloaded = max(0, int(downloaded or 0))
        if self.total_size > 0:
            downloaded = min(downloaded, self.total_size)
        self.downloaded = max(self.downloaded, downloaded)
        progress = (
            min(100.0, round((self.downloaded / self.total_size) * 100, 1))
            if self.total_size > 0
            else 0
        )

        self.transfer_downloaded = max(
            self.transfer_downloaded,
            max(0, int(transfer_downloaded or 0)),
        )
        self.transfer_total_size = max(
            self.transfer_total_size,
            max(0, int(transfer_total_size or 0)),
        )
        transfer_progress = (
            min(
                100.0,
                round(
                    (self.transfer_downloaded / self.transfer_total_size) * 100,
                    1,
                ),
            )
            if self.transfer_total_size > 0
            else 0
        )

        self.speed = max(0, int(speed or 0))
        with download_lock:
            state = download_progress.get(self.download_id)
            if state is not None:
                state.update(
                    {
                        "status": "downloading",
                        "progress": progress,
                        "downloaded": self.downloaded,
                        "total_size": self.total_size,
                        "speed": self.speed,
                        "transfer_downloaded": self.transfer_downloaded,
                        "transfer_total_size": self.transfer_total_size,
                        "transfer_progress": transfer_progress,
                        "download_backend": "huggingface_xet",
                    }
                )

    def update(self, byte_delta: Any) -> None:
        if self.download_id in cancelled_downloads:
            raise _HuggingFaceXetDownloadCancelled("Download cancelled")

        try:
            delta = max(0, int(float(byte_delta or 0)))
        except (TypeError, ValueError):
            delta = 0

        downloaded = self.downloaded + delta
        # The legacy one-argument callback exposes logical byte increments only,
        # not network-transfer speed. Reporting a derived rate here would confuse
        # fast cache/file reconstruction with actual download throughput.
        self._publish(downloaded, 0)

    def __call__(self, total_update: Any, item_updates: Any) -> None:
        """Receive hf_xet's detailed 200 ms progress snapshots when available."""
        if self.download_id in cancelled_downloads:
            raise _HuggingFaceXetDownloadCancelled("Download cancelled")

        downloaded = int(getattr(total_update, "total_bytes_completed", 0) or 0)
        if downloaded <= 0:
            items = item_updates.values() if isinstance(item_updates, dict) else item_updates
            for item in items or []:
                downloaded = max(
                    downloaded,
                    int(getattr(item, "bytes_completed", 0) or 0),
                )

        transfer_downloaded = int(
            getattr(total_update, "total_transfer_bytes_completed", 0) or 0
        )
        transfer_total_size = int(
            getattr(total_update, "total_transfer_bytes", 0) or 0
        )
        transfer_rate = getattr(
            total_update,
            "total_transfer_bytes_completion_rate",
            None,
        )
        try:
            speed = max(0, int(float(transfer_rate or 0)))
        except (TypeError, ValueError):
            speed = 0
        self.last_update = time.time()
        self._publish(
            downloaded,
            speed,
            transfer_downloaded,
            transfer_total_size,
        )


def _run_huggingface_xet_transfer(
    incomplete_path: Path,
    xet_file_data: Any,
    request_headers: Dict[str, str],
    expected_size: int,
    filename: str,
    progress_adapter: _HuggingFaceXetProgressAdapter,
) -> None:
    """Use detailed native Xet progress when supported, with legacy fallback."""
    import hf_xet
    from huggingface_hub.file_download import xet_get
    try:
        from huggingface_hub.utils import refresh_xet_connection_info
    except ImportError:
        refresh_xet_connection_info = None

    supports_session_progress = all(
        hasattr(hf_xet, name)
        for name in ("XetFileInfo", "XetSession")
    )
    if supports_session_progress:
        try:
            from huggingface_hub.utils._xet import (
                get_xet_session,
                xet_headers_without_auth,
            )
        except ImportError:
            supports_session_progress = False

    if supports_session_progress:
        session = get_xet_session()
        xet_headers = xet_headers_without_auth(request_headers)
        group = session.new_file_download_group(
            token_refresh_url=xet_file_data.refresh_route,
            token_refresh_headers=request_headers,
            custom_headers=xet_headers,
            progress_callback=progress_adapter,
            progress_interval_ms=200,
        )
        try:
            with group:
                handle = group.start_download_file(
                    hf_xet.XetFileInfo(xet_file_data.file_hash, expected_size or None),
                    str(incomplete_path.absolute()),
                )
                with xet_transfers_lock:
                    xet_transfers[progress_adapter.download_id] = {
                        "handle": handle,
                        "partial_path": str(incomplete_path),
                    }
                if progress_adapter.download_id in cancelled_downloads:
                    cancel = getattr(handle, "cancel", None)
                    if callable(cancel):
                        cancel()
        finally:
            with xet_transfers_lock:
                xet_transfers.pop(progress_adapter.download_id, None)
        return

    supports_detailed_progress = refresh_xet_connection_info is not None and all(
        hasattr(hf_xet, name)
        for name in (
            "PyItemProgressUpdate",
            "PyTotalProgressUpdate",
            "PyXetDownloadInfo",
            "download_files",
        )
    )
    if not supports_detailed_progress:
        xet_get(
            incomplete_path=incomplete_path,
            xet_file_data=xet_file_data,
            headers=request_headers,
            expected_size=expected_size or None,
            displayed_filename=filename,
            _tqdm_bar=progress_adapter,
        )
        return

    connection_info = refresh_xet_connection_info(
        file_data=xet_file_data,
        headers=request_headers,
    )
    if connection_info is None:
        raise ValueError("Failed to refresh Hugging Face Xet connection info")

    def token_refresher() -> tuple[str, int]:
        refreshed = refresh_xet_connection_info(
            file_data=xet_file_data,
            headers=request_headers,
        )
        if refreshed is None:
            raise ValueError("Failed to refresh Hugging Face Xet access token")
        return refreshed.access_token, refreshed.expiration_unix_epoch

    download_info = hf_xet.PyXetDownloadInfo(
        destination_path=str(incomplete_path.absolute()),
        hash=xet_file_data.file_hash,
        file_size=expected_size or None,
    )
    hf_xet.download_files(
        [download_info],
        endpoint=connection_info.endpoint,
        token_info=(
            connection_info.access_token,
            connection_info.expiration_unix_epoch,
        ),
        token_refresher=token_refresher,
        progress_updater=[progress_adapter],
    )


def _download_huggingface_xet(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
) -> Optional[Dict[str, Any]]:
    """Download Hugging Face Xet files with the official hf_xet transport."""
    validated_url = validate_public_http_url(url)
    parsed_url = urlparse(validated_url)
    if not (
        host_matches_domain(parsed_url.hostname, "huggingface.co")
        and "/resolve/" in parsed_url.path
    ):
        return None

    try:
        __import__("hf_xet")
        from huggingface_hub.file_download import get_hf_file_metadata
    except ImportError:
        return None

    request_headers = build_download_headers(validated_url, headers)
    try:
        file_metadata = get_hf_file_metadata(
            validated_url,
            headers=request_headers,
            timeout=20,
        )
    except Exception as exc:
        log.debug(
            "Hugging Face Xet metadata probe failed; using HTTP fallback: "
            f"{type(exc).__name__}"
        )
        return None

    xet_file_data = getattr(file_metadata, "xet_file_data", None)
    if xet_file_data is None:
        return None

    try:
        expected_size = max(0, int(getattr(file_metadata, "size", 0) or 0))
    except (TypeError, ValueError):
        expected_size = 0

    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }
    start_time = time.time()
    filename = get_filename_from_path(dest_path)
    partial_path = f"{dest_path}.xet-part"
    progress_adapter = _HuggingFaceXetProgressAdapter(
        download_id,
        expected_size,
        start_time,
    )

    with download_lock:
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": expected_size,
            "downloaded": 0,
            "filename": filename,
            "path": dest_path,
            "directory": os.path.dirname(dest_path),
            "url": validated_url,
            "error": None,
            "speed": 0,
            "start_time": start_time,
            "download_backend": "huggingface_xet",
        }

    cancelled_downloads.discard(download_id)
    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        if os.path.exists(partial_path):
            os.remove(partial_path)

        log.info(f"Starting Hugging Face Xet download: {filename}")
        _run_huggingface_xet_transfer(
            Path(partial_path),
            xet_file_data,
            request_headers,
            expected_size,
            filename,
            progress_adapter,
        )

        if download_id in cancelled_downloads:
            raise _HuggingFaceXetDownloadCancelled("Download cancelled")

        size = os.path.getsize(partial_path)
        if expected_size and size != expected_size:
            raise OSError(
                f"Downloaded size mismatch: expected {expected_size}, received {size}"
            )
        os.replace(partial_path, dest_path)

        metadata_path = write_lora_manager_metadata(
            dest_path,
            metadata or {},
            category,
            validated_url,
        )
        with download_lock:
            state = download_progress.get(download_id)
            if state is not None:
                state.update(
                    {
                        "status": "completed",
                        "progress": 100,
                        "downloaded": size,
                        "total_size": expected_size or size,
                        "speed": 0,
                    }
                )
                if metadata_path:
                    state["metadata_path"] = metadata_path

        result.update(
            {
                "success": True,
                "size": size,
                "metadata_path": metadata_path,
            }
        )
        elapsed = time.time() - start_time
        avg_speed = size / elapsed if elapsed > 0 else 0
        log.info(f"✓ Hugging Face Xet download complete: {filename}")
        log.info(
            f"Size: {format_bytes(size)}, Time: {elapsed:.1f}s, "
            f"Avg speed: {format_bytes(int(avg_speed))}/s"
        )
        invalidate_model_files_cache()
        invalidate_local_hash_match_cache()
        return result
    except Exception as exc:
        was_cancelled = (
            isinstance(exc, _HuggingFaceXetDownloadCancelled)
            or download_id in cancelled_downloads
        )
        _delete_xet_partial_file(partial_path)

        error_msg = (
            "Download cancelled" if was_cancelled else _sanitize_download_error(exc)
        )
        with download_lock:
            state = download_progress.get(download_id)
            if state is not None:
                state.update(
                    {
                        "status": "cancelled" if was_cancelled else "error",
                        "error": error_msg,
                        "speed": 0,
                    }
                )
        cancelled_downloads.discard(download_id)
        result["error"] = error_msg
        if was_cancelled:
            log.info(f"Hugging Face Xet download cancelled: {filename}")
        else:
            log.error(f"✗ Hugging Face Xet download failed: {filename}")
            log.error(f"Error: {error_msg}")
        return result


def download_file_with_aria2(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
) -> Dict[str, Any]:
    """Download a file with an aria2c JSON-RPC process."""
    settings = load_settings()
    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }
    start_time = time.time()
    filename = get_filename_from_path(dest_path)

    with download_lock:
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": 0,
            "downloaded": 0,
            "filename": filename,
            "path": dest_path,
            "directory": os.path.dirname(dest_path),
            "url": url,
            "error": None,
            "speed": 0,
            "start_time": start_time,
            "download_backend": "aria2",
        }

    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        _ensure_aria2_daemon(settings)
        aria2_url, request_headers = _resolve_download_url_for_aria2(url, headers)

        options: Dict[str, Any] = {
            "dir": os.path.dirname(dest_path),
            "out": filename,
            "continue": "true",
            "max-connection-per-server": "4",
            "split": "4",
            "min-split-size": "1M",
            "allow-overwrite": "true",
            "auto-file-renaming": "false",
            "file-allocation": "none",
            "no-want-digest-header": "true",
            # Redirects were already resolved and validated above. Keeping them
            # disabled prevents sensitive headers from reaching another host.
            "max-redirect": "0",
        }
        user_agent = _get_header_value(request_headers, "User-Agent")
        referer = _get_header_value(request_headers, "Referer")
        if user_agent:
            options["user-agent"] = user_agent
        if referer:
            options["referer"] = referer

        header_values = [
            f"{key}: {value}"
            for key, value in request_headers.items()
            if str(key).lower() not in {"user-agent", "referer"}
        ]
        if header_values:
            options["header"] = header_values

        gid = _aria2_rpc("aria2.addUri", [[aria2_url], options])
        if not isinstance(gid, str) or not gid:
            raise Aria2Error("aria2 did not return a download gid")

        with aria2_lock:
            aria2_transfers[download_id] = {
                "gid": gid,
                "path": dest_path,
            }
        with download_lock:
            download_progress[download_id]["aria2_gid"] = gid
            download_progress[download_id]["status"] = "downloading"

        log.info(f"Starting aria2 download: {filename}")
        last_cli_log = start_time

        while True:
            if download_id in cancelled_downloads:
                try:
                    _aria2_rpc("aria2.forceRemove", [gid])
                except Exception:
                    pass
                with download_lock:
                    if download_id in download_progress:
                        download_progress[download_id]["status"] = "cancelled"
                        download_progress[download_id]["speed"] = 0
                _delete_partial_download_files(dest_path)
                cancelled_downloads.discard(download_id)
                result["error"] = "Download cancelled"
                return result

            status = _aria2_tell_status(gid)
            state = str(status.get("status") or "")
            total_size = _parse_aria2_int(status.get("totalLength"))
            downloaded = _parse_aria2_int(status.get("completedLength"))
            speed = _parse_aria2_int(status.get("downloadSpeed"))
            progress = int((downloaded / total_size) * 100) if total_size > 0 else 0
            mapped_status = {
                "active": "downloading",
                "waiting": "downloading",
                "paused": "paused",
                "complete": "completed",
                "error": "error",
                "removed": "cancelled",
            }.get(state, state or "downloading")

            with download_lock:
                if download_id in download_progress:
                    download_progress[download_id].update(
                        {
                            "status": mapped_status,
                            "progress": max(0, min(progress, 100)),
                            "total_size": total_size,
                            "downloaded": downloaded,
                            "speed": 0 if mapped_status in {"paused", "completed"} else speed,
                            "download_backend": "aria2",
                            "aria2_gid": gid,
                        }
                    )

            now = time.time()
            if now - last_cli_log >= CLI_LOG_INTERVAL and mapped_status == "downloading":
                last_cli_log = now
                total_str = format_bytes(total_size) if total_size else "?"
                log.info(
                    f"aria2 progress: {format_bytes(downloaded)} / {total_str} ({progress}%) - {format_bytes(speed)}/s"
                )

            if state == "complete":
                completed_path = _resolve_aria2_completed_path(status, dest_path)
                size = os.path.getsize(completed_path) if os.path.exists(completed_path) else downloaded
                metadata_path = write_lora_manager_metadata(
                    completed_path,
                    metadata or {},
                    category,
                    url,
                )
                with download_lock:
                    download_progress[download_id].update(
                        {
                            "status": "completed",
                            "progress": 100,
                            "downloaded": size,
                            "total_size": total_size or size,
                            "speed": 0,
                            "path": completed_path,
                            "directory": os.path.dirname(completed_path),
                        }
                    )
                    if metadata_path:
                        download_progress[download_id]["metadata_path"] = metadata_path
                result.update(
                    {
                        "success": True,
                        "path": completed_path,
                        "size": size,
                        "metadata_path": metadata_path,
                    }
                )
                elapsed = time.time() - start_time
                avg_speed = size / elapsed if elapsed > 0 else 0
                log.info(f"✓ aria2 download complete: {filename}")
                log.info(
                    f"Size: {format_bytes(size)}, Time: {elapsed:.1f}s, Avg speed: {format_bytes(int(avg_speed))}/s"
                )
                invalidate_model_files_cache()
                invalidate_local_hash_match_cache()
                return result

            if state == "error":
                error_msg = status.get("errorMessage") or "aria2 download failed"
                with download_lock:
                    download_progress[download_id]["status"] = "error"
                    download_progress[download_id]["error"] = error_msg
                result["error"] = error_msg
                return result

            if state == "removed":
                with download_lock:
                    download_progress[download_id]["status"] = "cancelled"
                    download_progress[download_id]["speed"] = 0
                _delete_partial_download_files(dest_path)
                cancelled_downloads.discard(download_id)
                result["error"] = "Download cancelled"
                return result

            time.sleep(0.5)

    except Exception as exc:
        error_msg = _sanitize_download_error(exc)
        with download_lock:
            if download_id in download_progress:
                download_progress[download_id]["status"] = "error"
                download_progress[download_id]["error"] = error_msg
                download_progress[download_id]["speed"] = 0
        result["error"] = error_msg
        log.error(f"✗ aria2 download failed: {filename}")
        log.error(f"Error: {error_msg}")
        return result
    finally:
        with aria2_lock:
            aria2_transfers.pop(download_id, None)
            aria2_action_locks.pop(download_id, None)
            aria2_desired_states.pop(download_id, None)
        _schedule_aria2_idle_stop()


def download_file(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    chunk_size: int = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
) -> Dict[str, Any]:
    """
    Download a file from URL with progress tracking and speed calculation.

    Args:
        url: URL to download from
        dest_path: Destination file path
        download_id: Unique ID for tracking this download
        headers: Optional HTTP headers (for auth tokens)
        chunk_size: Download chunk size in bytes (defaults to 1MB)
        progress_callback: Optional callback(downloaded_bytes, total_bytes)
        metadata: Optional sidecar metadata to save next to the model file
        category: Model category used for LoRA Manager metadata typing

    Returns:
        Result dictionary with status and info
    """
    global download_progress, cancelled_downloads

    download_backend = _download_backend_from_settings()
    if download_backend != "aria2":
        xet_result = _download_huggingface_xet(
            url,
            dest_path,
            download_id,
            headers=headers,
            metadata=metadata,
            category=category,
        )
        if xet_result is not None:
            return xet_result

    if download_backend == "aria2":
        return download_file_with_aria2(
            url,
            dest_path,
            download_id,
            headers=headers,
            metadata=metadata,
            category=category,
        )

    # Use default 1MB chunk size if not specified
    if chunk_size is None:
        chunk_size = CHUNK_SIZE

    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }

    # Initialize progress tracking with speed calculation
    start_time = time.time()
    speed_history: deque = deque(maxlen=SPEED_HISTORY_SIZE)
    last_speed_update = start_time
    last_downloaded = 0
    last_cli_log = start_time  # Track when we last logged to CLI

    with download_lock:
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": 0,
            "downloaded": 0,
            "filename": get_filename_from_path(dest_path),
            "path": dest_path,
            "directory": os.path.dirname(dest_path),
            "url": url,
            "error": None,
            "speed": 0,  # bytes per second
            "start_time": start_time,
            "download_backend": "python",
        }

    try:
        # Ensure destination directory exists
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        # Verbose logging - what model and from where
        filename = get_filename_from_path(dest_path)
        source_host = urlparse(url).hostname
        source = (
            "HuggingFace"
            if host_matches_domain(source_host, "huggingface.co")
            else "CivitAI"
            if host_matches_domain(source_host, "civitai.com", "civitai.red")
            else "URL"
        )
        log.info(f"Starting download: {filename}")
        log.info(f"Source: {source}")
        log.info(f"URL: {_strip_sensitive_url_params(url)}")

        # Start download
        request_headers = build_download_headers(url, headers)
        response, final_url, _final_headers = request_public_url(
            "GET",
            url,
            headers=request_headers,
            stream=True,
            timeout=30,
        )
        response.raise_for_status()
        if final_url != url:
            log.debug("Validated download redirect target")

        # Get total size
        total_size = extract_response_file_size(response) or 0
        total_size_str = format_bytes(total_size) if total_size > 0 else "unknown"
        log.info(f"Size: {total_size_str}")

        with download_lock:
            download_progress[download_id]["total_size"] = total_size
            download_progress[download_id]["status"] = "downloading"

        downloaded = 0

        # Download with progress and speed calculation
        cancelled = False
        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=chunk_size):
                # Check for cancellation
                if download_id in cancelled_downloads:
                    cancelled = True
                    break

                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    # Calculate speed with smoothing
                    current_time = time.time()
                    time_delta = current_time - last_speed_update

                    # Update speed every 0.5 seconds to avoid too frequent calculations
                    if time_delta >= 0.5:
                        bytes_delta = downloaded - last_downloaded
                        instant_speed = (
                            bytes_delta / time_delta if time_delta > 0 else 0
                        )
                        speed_history.append(instant_speed)

                        # Calculate smoothed speed (average of recent samples)
                        smoothed_speed = (
                            sum(speed_history) / len(speed_history)
                            if speed_history
                            else 0
                        )

                        last_speed_update = current_time
                        last_downloaded = downloaded

                        # Update progress with speed
                        with download_lock:
                            download_progress[download_id]["downloaded"] = downloaded
                            download_progress[download_id]["speed"] = int(
                                smoothed_speed
                            )
                            if total_size > 0:
                                download_progress[download_id]["progress"] = int(
                                    (downloaded / total_size) * 100
                                )

                        # CLI progress logging (every CLI_LOG_INTERVAL seconds)
                        if current_time - last_cli_log >= CLI_LOG_INTERVAL:
                            last_cli_log = current_time
                            progress_pct = (
                                int((downloaded / total_size) * 100)
                                if total_size > 0
                                else 0
                            )
                            downloaded_str = format_bytes(downloaded)
                            total_str = (
                                format_bytes(total_size) if total_size > 0 else "?"
                            )
                            speed_str = format_bytes(int(smoothed_speed)) + "/s"
                            log.info(
                                f"Progress: {downloaded_str} / {total_str} ({progress_pct}%) - {speed_str}"
                            )
                    else:
                        # Just update downloaded bytes without recalculating speed
                        with download_lock:
                            download_progress[download_id]["downloaded"] = downloaded
                            if total_size > 0:
                                download_progress[download_id]["progress"] = int(
                                    (downloaded / total_size) * 100
                                )

                    if progress_callback:
                        progress_callback(downloaded, total_size)

        # Handle cancellation after file is closed (so we can delete it on Windows)
        # Also check if cancellation was requested while we were finishing up
        if cancelled or download_id in cancelled_downloads:
            with download_lock:
                download_progress[download_id]["status"] = "cancelled"
            # Clean up partial/incomplete file
            try:
                if os.path.exists(dest_path):
                    os.remove(dest_path)
                    log.info(f"Cancelled: {filename} - incomplete file deleted")
                else:
                    log.info(f"Cancelled: {filename} - no file to delete")
            except Exception as e:
                log.warning(f"Could not delete incomplete file {dest_path}: {e}")
                # Try harder on Windows - sometimes the file handle takes a moment to release
                try:
                    time.sleep(0.5)  # time is already imported at module level
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                        log.info(
                            f"Cancelled: {filename} - incomplete file deleted (delayed)"
                        )
                except Exception:
                    pass
            result["error"] = "Download cancelled"
            cancelled_downloads.discard(download_id)
            return result

        # Success
        with download_lock:
            download_progress[download_id]["status"] = "completed"
            download_progress[download_id]["progress"] = 100
            download_progress[download_id]["speed"] = 0  # Reset speed on completion

        result["success"] = True
        result["size"] = downloaded
        metadata_path = write_lora_manager_metadata(
            dest_path,
            metadata or {},
            category,
            url,
        )
        if metadata_path:
            result["metadata_path"] = metadata_path
            with download_lock:
                if download_id in download_progress:
                    download_progress[download_id]["metadata_path"] = metadata_path

        # CLI completion log
        elapsed = time.time() - start_time
        avg_speed = downloaded / elapsed if elapsed > 0 else 0
        log.info(f"✓ Download complete: {filename}")
        log.info(
            f"Size: {format_bytes(downloaded)}, Time: {elapsed:.1f}s, Avg speed: {format_bytes(int(avg_speed))}/s"
        )
        invalidate_model_files_cache()
        invalidate_local_hash_match_cache()

    except requests.exceptions.RequestException as e:
        error_msg = _sanitize_download_error(e)
        # Check for specific HTTP errors
        if hasattr(e, "response") and e.response is not None:
            status_code = e.response.status_code
            if status_code in [401, 403]:
                if "huggingface.co" in url:
                    error_msg = f"Unauthorized (HTTP {status_code}): HuggingFace token may be required."
                elif "civitai.com" in url:
                    error_msg = f"Unauthorized (HTTP {status_code}): CivitAI API key may be required."
                else:
                    error_msg = (
                        f"Unauthorized (HTTP {status_code}): Authentication required."
                    )
            elif status_code == 404:
                error_msg = "Model not found (HTTP 404): The file may have been moved or deleted."

        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg

        # CLI error log
        log.error(f"✗ Download failed: {get_filename_from_path(dest_path)}")
        log.error(f"Error: {error_msg}")

        # Clean up partial file
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass

    except Exception as e:
        error_msg = _sanitize_download_error(e)
        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg

        # CLI error log
        log.error(f"✗ Download failed: {get_filename_from_path(dest_path)}")
        log.error(f"Error: {error_msg}")
        log.error(f"Download error: {e}", exc_info=True)

    return result


def download_model(
    url: str,
    filename: str,
    category: str,
    download_id: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = "",
    base_directory: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Download a model to the appropriate directory.

    Args:
        url: URL to download from
        filename: Filename to save as
        category: Model category for directory selection
        download_id: Optional download ID (generated if not provided)
        headers: Optional HTTP headers
        subfolder: Optional subfolder within category directory
        base_directory: Optional configured base directory to use
        metadata: Optional sidecar metadata to save next to the model file

    Returns:
        Result dictionary
    """
    if download_id is None:
        download_id = generate_download_id()

    filename = sanitize_download_filename(filename)
    if not filename:
        return {
            "success": False,
            "download_id": download_id,
            "error": "Invalid filename",
        }
    if not is_allowed_model_download_filename(filename):
        return {
            "success": False,
            "download_id": download_id,
            "error": "Unsupported model file extension",
        }
    subfolder = normalize_relative_subfolder(subfolder)

    # Get destination directory
    dest_dir = get_download_directory(category, base_directory)
    if not dest_dir:
        return {
            "success": False,
            "download_id": download_id,
            "error": f"Could not find directory for category: {category}",
        }

    # Add subfolder if specified
    if subfolder:
        dest_dir = os.path.join(dest_dir, *subfolder.split("/"))

    dest_dir = os.path.abspath(os.path.normpath(dest_dir))
    dest_path = os.path.abspath(os.path.normpath(os.path.join(dest_dir, filename)))
    if not is_path_within(dest_path, dest_dir):
        return {
            "success": False,
            "download_id": download_id,
            "error": "Download target is outside the selected model directory",
        }

    # A matching aria2 control file means the destination is incomplete and can
    # be resumed safely by aria2's continue mode after a restart or RPC failure.
    resume_aria2_partial = bool(
        _download_backend_from_settings() == "aria2"
        and os.path.isfile(dest_path)
        and os.path.isfile(f"{dest_path}.aria2")
    )
    if resume_aria2_partial:
        log.info(f"Resuming partial aria2 download: {dest_path}")

    # Check if a complete file already exists.
    if os.path.exists(dest_path) and not resume_aria2_partial:
        expected_sha256 = _extract_expected_sha256(metadata)
        if expected_sha256:
            metadata_sha256 = read_completed_metadata_sha256(dest_path)
            sha256_source = "metadata"
            existing_sha256 = metadata_sha256
            if metadata_sha256:
                if metadata_sha256 == expected_sha256:
                    log.info(f"File exists, metadata SHA256 matches: {dest_path}")
                else:
                    log.info(
                        "File exists, metadata SHA256 differs from source; "
                        f"verifying file content: {dest_path}"
                    )
                    existing_sha256 = ""

            try:
                if not existing_sha256:
                    sha256_source = "file"
                    log.info(f"File exists, verifying SHA256: {dest_path}")
                    detected_sha256_source = ["file"]

                    def set_detected_sha256_source(source: str) -> None:
                        if source:
                            detected_sha256_source[0] = source

                    existing_sha256 = calculate_file_sha256(
                        dest_path,
                        on_hash_source=set_detected_sha256_source,
                    ) or ""
                    sha256_source = detected_sha256_source[0]
            except Exception as e:
                error_msg = (
                    f"File already exists and its SHA256 could not be verified: {dest_path}"
                )
                log.warning(f"{error_msg} ({e})")
                return {
                    "success": False,
                    "download_id": download_id,
                    "error": error_msg,
                    "path": dest_path,
                }

            if existing_sha256 == expected_sha256:
                message = "This model is already downloaded and matches the source hash."
                metadata_path = get_metadata_sidecar_path(dest_path)
                if not os.path.exists(metadata_path):
                    metadata_path = write_lora_manager_metadata(
                        dest_path,
                        metadata or {},
                        category,
                        url,
                    ) or ""
                size = os.path.getsize(dest_path)
                with download_lock:
                    if download_id in download_progress:
                        download_progress[download_id].update(
                            {
                                "status": "completed",
                                "progress": 100,
                                "total_size": size,
                                "downloaded": size,
                                "speed": 0,
                                "path": dest_path,
                                "directory": os.path.dirname(dest_path),
                                "error": None,
                                "already_exists": True,
                                "message": message,
                                "sha256": existing_sha256,
                                "expected_sha256": expected_sha256,
                                "sha256_source": sha256_source,
                            }
                        )
                        if metadata_path:
                            download_progress[download_id]["metadata_path"] = metadata_path
                log.info(f"{message} Path: {dest_path}")
                return {
                    "success": True,
                    "download_id": download_id,
                    "path": dest_path,
                    "size": size,
                    "already_exists": True,
                    "message": message,
                    "metadata_path": metadata_path,
                    "sha256_source": sha256_source,
                }

            error_msg = (
                "File already exists, but its SHA256 does not match the selected "
                f"source: {dest_path}"
            )
            log.warning(
                f"{error_msg} (existing={existing_sha256}, expected={expected_sha256})"
            )
            return {
                "success": False,
                "download_id": download_id,
                "error": error_msg,
                "path": dest_path,
                "existing_sha256": existing_sha256,
                "expected_sha256": expected_sha256,
            }

        return {
            "success": False,
            "download_id": download_id,
            "error": f"File already exists: {dest_path}",
            "path": dest_path,
        }

    return download_file(
        url,
        dest_path,
        download_id,
        headers=headers,
        metadata=metadata,
        category=category,
    )


def get_progress(download_id: str) -> Optional[Dict[str, Any]]:
    """Get progress for a specific download."""
    with download_lock:
        return download_progress.get(download_id, {}).copy()


def get_all_progress() -> Dict[str, Dict[str, Any]]:
    """Get progress for all downloads."""
    with download_lock:
        return {k: v.copy() for k, v in download_progress.items()}


def _force_remove_aria2_transfer(download_id: str, gid: str) -> None:
    try:
        _aria2_rpc("aria2.forceRemove", [gid])
    except Exception as exc:
        log.warning(f"Could not cancel aria2 download {download_id}: {exc}")


def _get_aria2_action_lock(download_id: str) -> threading.Lock:
    with aria2_lock:
        lock = aria2_action_locks.get(download_id)
        if lock is None:
            lock = threading.Lock()
            aria2_action_locks[download_id] = lock
        return lock


def _set_download_progress_status(download_id: str, status: str, **updates: Any) -> None:
    with download_lock:
        if download_id in download_progress:
            download_progress[download_id]["status"] = status
            download_progress[download_id].update(updates)


def _aria2_action_error_is_ok(status: str, message: str) -> bool:
    lowered = str(message or "").lower()
    if status == "paused":
        return "already paused" in lowered or "is paused" in lowered
    if status == "downloading":
        return "not paused" in lowered or "has not been paused" in lowered
    return False


def _run_aria2_desired_state_worker(download_id: str) -> None:
    while True:
        with aria2_lock:
            desired = dict(aria2_desired_states.get(download_id) or {})
        if not desired or download_id in cancelled_downloads:
            with aria2_lock:
                state = aria2_desired_states.get(download_id)
                if state:
                    state["running"] = False
            return

        desired_status = str(desired.get("status") or "")
        desired_seq = int(desired.get("seq") or 0)
        transfer = aria2_transfers.get(download_id)
        gid = transfer.get("gid") if isinstance(transfer, dict) else ""
        if not gid:
            with aria2_lock:
                aria2_desired_states.pop(download_id, None)
            return

        method = "aria2.forcePause" if desired_status == "paused" else "aria2.unpause"
        try:
            with _get_aria2_action_lock(download_id):
                _aria2_rpc(method, [gid])
            _set_download_progress_status(
                download_id,
                desired_status,
                speed=0 if desired_status == "paused" else download_progress.get(download_id, {}).get("speed", 0),
            )
        except Exception as exc:
            if _aria2_action_error_is_ok(desired_status, str(exc)):
                _set_download_progress_status(download_id, desired_status, speed=0 if desired_status == "paused" else download_progress.get(download_id, {}).get("speed", 0))
            else:
                if desired_status == "downloading":
                    _set_download_progress_status(download_id, "paused", speed=0)
                safe_error = _sanitize_download_error(exc)
                log.warning(f"aria2 {desired_status} action failed for {download_id}: {safe_error}")

        with aria2_lock:
            latest = aria2_desired_states.get(download_id)
            if not latest:
                return
            if int(latest.get("seq") or 0) == desired_seq:
                aria2_desired_states.pop(download_id, None)
                return


def _queue_aria2_desired_state(download_id: str, status: str) -> Dict[str, Any]:
    transfer = aria2_transfers.get(download_id)
    if not transfer or not transfer.get("gid"):
        return {"success": False, "error": "Download action is not available yet"}

    start_worker = False
    with aria2_lock:
        previous = aria2_desired_states.get(download_id) or {}
        seq = int(previous.get("seq") or 0) + 1
        running = bool(previous.get("running"))
        aria2_desired_states[download_id] = {
            "status": status,
            "seq": seq,
            "running": True,
        }
        start_worker = not running

    _set_download_progress_status(
        download_id,
        status,
        speed=0 if status == "paused" else download_progress.get(download_id, {}).get("speed", 0),
    )

    if start_worker:
        threading.Thread(
            target=_run_aria2_desired_state_worker,
            args=(download_id,),
            daemon=True,
        ).start()

    return {"success": True, "message": "Download paused" if status == "paused" else "Download resumed"}


def cancel_download(download_id: str) -> bool:
    """Cancel a download in progress."""
    cancelled_downloads.add(download_id)
    with aria2_lock:
        aria2_desired_states.pop(download_id, None)
    _set_download_progress_status(download_id, "cancelling", speed=0)
    transfer = aria2_transfers.get(download_id)
    if transfer and transfer.get("gid"):
        threading.Thread(
            target=_force_remove_aria2_transfer,
            args=(download_id, transfer["gid"]),
            daemon=True,
        ).start()
    with xet_transfers_lock:
        xet_transfer = dict(xet_transfers.get(download_id) or {})
    xet_handle = xet_transfer.get("handle")
    xet_cancel = getattr(xet_handle, "cancel", None)
    if callable(xet_cancel):
        try:
            xet_cancel()
        except Exception as exc:
            log.warning(f"Could not cancel Hugging Face Xet transfer {download_id}: {exc}")
    return True


def pause_download(download_id: str) -> Dict[str, Any]:
    """Pause an aria2 download. Built-in Python downloads cannot be paused."""
    if download_id in cancelled_downloads:
        return {"success": False, "error": "Download is being cancelled"}
    return _queue_aria2_desired_state(download_id, "paused")


def resume_download(download_id: str) -> Dict[str, Any]:
    """Resume a paused aria2 download."""
    if download_id in cancelled_downloads:
        return {"success": False, "error": "Download is being cancelled"}
    return _queue_aria2_desired_state(download_id, "downloading")


def clear_completed_downloads():
    """Clear completed/failed downloads from progress tracking."""
    with download_lock:
        to_remove = [
            did
            for did, info in download_progress.items()
            if info.get("status") in ("completed", "error", "cancelled")
        ]
        for did in to_remove:
            del download_progress[did]
            cancelled_downloads.discard(did)


def start_background_download(
    url: str,
    filename: str,
    category: str,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = "",
    base_directory: str = "",
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Start a download in a background thread.

    Returns:
        download_id for tracking progress
    """
    download_id = generate_download_id()
    filename = sanitize_download_filename(filename)
    subfolder = normalize_relative_subfolder(subfolder)
    initial_directory = get_download_directory(category, base_directory) or ""
    if initial_directory and subfolder:
        initial_directory = os.path.join(initial_directory, *subfolder.split("/"))
    initial_path = os.path.join(initial_directory, filename) if initial_directory and filename else ""

    # Pre-initialize progress dict so it's always available for polling
    # even if download fails before download_file is called
    with download_lock:
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": 0,
            "downloaded": 0,
            "filename": filename,
            "path": initial_path,
            "directory": initial_directory,
            "url": url,
            "error": None,
            "speed": 0,
            "start_time": time.time(),
            "download_backend": _download_backend_from_settings(),
        }

    def run_download():
        try:
            result = download_model(
                url,
                filename,
                category,
                download_id,
                headers,
                subfolder,
                base_directory,
                metadata,
            )
            if not result.get("success"):
                # Mark as error if download failed
                with download_lock:
                    if download_id in download_progress:
                        download_progress[download_id]["status"] = "error"
                        download_progress[download_id]["error"] = result.get(
                            "error", "Download failed"
                        )
                        if result.get("path"):
                            download_progress[download_id]["path"] = result["path"]
                            download_progress[download_id]["directory"] = os.path.dirname(
                                result["path"]
                            )
        except Exception as e:
            # Ensure any exception is captured and logged
            with download_lock:
                download_progress[download_id] = {
                    "status": "error",
                    "progress": 0,
                    "total_size": 0,
                    "downloaded": 0,
                    "filename": filename,
                    "path": "",
                    "directory": "",
                    "url": url,
                    "error": str(e),
                    "speed": 0,
                    "start_time": time.time(),
                    "download_backend": _download_backend_from_settings(),
                }

    thread = threading.Thread(target=run_download, daemon=True)
    thread.start()

    return download_id

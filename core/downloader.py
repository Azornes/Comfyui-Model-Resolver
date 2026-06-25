"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import os
import json
import hashlib
import threading
import time
import requests
from typing import Dict, Any, Optional, Callable, List
from pathlib import Path
from collections import deque
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)
from .resolver import normalize_sha256
from .path_utils import is_path_within, get_path_identity, write_json_atomic
from .type_utils import as_dict, as_list, first_non_empty

try:
    import folder_paths
except ImportError:
    folder_paths = None

# Download state tracking
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()

# Speed calculation settings
SPEED_HISTORY_SIZE = 5  # Number of samples for smoothing
CHUNK_SIZE = 1024 * 1024  # 1MB chunks for faster downloads
CLI_LOG_INTERVAL = 5  # Log progress to CLI every N seconds

from .settings import CATEGORY_MAP, normalize_download_category

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


def _as_dict(value: Any) -> Dict[str, Any]:
    return as_dict(value)


def _as_list(value: Any) -> List[Any]:
    return as_list(value)


def _first_present(*values: Any) -> Any:
    return first_non_empty(*values)


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


def get_metadata_sidecar_path(file_path: str) -> str:
    """Return the LoRA Manager-compatible sidecar path for a model file."""
    base_path, _extension = os.path.splitext(file_path)
    return f"{base_path}.metadata.json"


def _resolve_lora_manager_model_type(category: str, source_type: Any = "") -> str:
    category_key = normalize_download_category(category)
    if category_key == "diffusion_models":
        return "diffusion_model"
    if category_key == "checkpoints":
        return "checkpoint"
    if category_key == "embeddings":
        return "embedding"

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

    filename_lower = os.path.basename(str(filename or "")).lower()
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

    try:
        with open(metadata_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception as e:
        log_warn(f"Could not read metadata sidecar for SHA256 check: {metadata_path} ({e})")
        return ""

    if not isinstance(payload, dict):
        return ""

    hash_status = str(payload.get("hash_status") or "completed").strip().lower()
    if hash_status != "completed":
        log_debug(
            f"Skipping metadata SHA256 for {metadata_path}: hash_status={hash_status}"
        )
        return ""

    return normalize_sha256(payload.get("sha256") or payload.get("hash"))


def calculate_file_sha256(file_path: str) -> str:
    """Calculate SHA256 for an existing local file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            if chunk:
                sha256_hash.update(chunk)
    return sha256_hash.hexdigest()


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

    basename = os.path.basename(dest_path)
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
        "preview_url": "",
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
        log_info(f"Metadata saved: {metadata_path}")
        return metadata_path
    except Exception as e:
        log_warn(f"Could not save metadata sidecar for {dest_path}: {e}")
        return None


def format_bytes(bytes_value: int) -> str:
    """Format bytes to human readable string (e.g., 1.5 GB)."""
    if bytes_value == 0:
        return "0 B"
    k = 1024
    sizes = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while bytes_value >= k and i < len(sizes) - 1:
        bytes_value /= k
        i += 1
    return f"{bytes_value:.1f} {sizes[i]}"


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

    folder_key = normalize_download_category(category)
    folder_keys = [folder_key]
    if folder_key == "diffusion_models":
        folder_keys.append("unet")
    elif folder_key == "text_encoders":
        folder_keys.append("clip")

    def _normalize(path_value: str) -> str:
        return get_path_identity(path_value)

    def _is_within(path_value: str, root_value: str) -> bool:
        return is_path_within(path_value, root_value)

    def _choose_preferred_path(paths: List[str], preferred_key: str = "") -> Optional[str]:
        if not paths:
            return None

        comfy_root = os.path.dirname(os.path.abspath(getattr(folder_paths, "__file__", "")))

        def _basename(path_value: str) -> str:
            return os.path.basename(os.path.normpath(path_value)).lower()

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
        log_debug(f"Could not get folder path for {folder_key}: {e}")

    return None


def generate_download_id() -> str:
    """Generate a unique download ID."""
    import uuid

    return str(uuid.uuid4())[:8]


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
            "filename": os.path.basename(dest_path),
            "path": dest_path,
            "directory": os.path.dirname(dest_path),
            "url": url,
            "error": None,
            "speed": 0,  # bytes per second
            "start_time": start_time,
        }

    try:
        # Ensure destination directory exists
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        # Verbose logging - what model and from where
        filename = os.path.basename(dest_path)
        source = (
            "HuggingFace"
            if "huggingface.co" in url
            else "CivitAI"
            if "civitai.com" in url
            else "URL"
        )
        log_info(f"Starting download: {filename}")
        log_info(f"Source: {source}")
        log_info(f"URL: {url}")

        # Start download
        response = requests.get(url, headers=headers, stream=True, timeout=30)
        response.raise_for_status()

        # Get total size
        total_size = int(response.headers.get("content-length", 0))
        total_size_str = format_bytes(total_size) if total_size > 0 else "unknown"
        log_info(f"Size: {total_size_str}")

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
                            log_info(
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
                    log_info(f"Cancelled: {filename} - incomplete file deleted")
                else:
                    log_info(f"Cancelled: {filename} - no file to delete")
            except Exception as e:
                log_warn(f"Could not delete incomplete file {dest_path}: {e}")
                # Try harder on Windows - sometimes the file handle takes a moment to release
                try:
                    time.sleep(0.5)  # time is already imported at module level
                    if os.path.exists(dest_path):
                        os.remove(dest_path)
                        log_info(
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
        log_info(f"✓ Download complete: {filename}")
        log_info(
            f"Size: {format_bytes(downloaded)}, Time: {elapsed:.1f}s, Avg speed: {format_bytes(int(avg_speed))}/s"
        )

    except requests.exceptions.RequestException as e:
        error_msg = str(e)
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
        log_error(f"✗ Download failed: {os.path.basename(dest_path)}")
        log_error(f"Error: {error_msg}")

        # Clean up partial file
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except:
            pass

    except Exception as e:
        error_msg = str(e)
        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg

        # CLI error log
        log_error(f"✗ Download failed: {os.path.basename(dest_path)}")
        log_error(f"Error: {error_msg}")
        log_error(f"Download error: {e}", exc_info=True)

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
        dest_dir = os.path.join(dest_dir, subfolder)

    dest_path = os.path.join(dest_dir, filename)

    # Check if file already exists
    if os.path.exists(dest_path):
        expected_sha256 = _extract_expected_sha256(metadata)
        if expected_sha256:
            metadata_sha256 = read_completed_metadata_sha256(dest_path)
            sha256_source = "metadata"
            existing_sha256 = metadata_sha256
            if metadata_sha256:
                if metadata_sha256 == expected_sha256:
                    log_info(f"File exists, metadata SHA256 matches: {dest_path}")
                else:
                    log_info(
                        "File exists, metadata SHA256 differs from source; "
                        f"verifying file content: {dest_path}"
                    )
                    existing_sha256 = ""

            try:
                if not existing_sha256:
                    sha256_source = "file"
                    log_info(f"File exists, verifying SHA256: {dest_path}")
                    existing_sha256 = calculate_file_sha256(dest_path)
            except Exception as e:
                error_msg = (
                    f"File already exists and its SHA256 could not be verified: {dest_path}"
                )
                log_warn(f"{error_msg} ({e})")
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
                log_info(f"{message} Path: {dest_path}")
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
            log_warn(
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


def cancel_download(download_id: str) -> bool:
    """Cancel a download in progress."""
    cancelled_downloads.add(download_id)
    return True


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
    initial_directory = get_download_directory(category, base_directory) or ""
    if initial_directory and subfolder:
        initial_directory = os.path.join(initial_directory, subfolder)
    initial_path = os.path.join(initial_directory, filename) if initial_directory else ""

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
                }

    thread = threading.Thread(target=run_download, daemon=True)
    thread.start()

    return download_id

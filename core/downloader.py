"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import hashlib  # noqa: F401
import os
import secrets  # noqa: F401
import shutil  # noqa: F401
import subprocess
import threading
import time
from collections import deque  # noqa: F401
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional  # noqa: F401
from urllib.parse import urlparse

import requests  # noqa: F401

from .log_system import create_module_logger

log = create_module_logger(__name__)

from .download.aria2_backend import (
    Aria2Error,  # noqa: F401
    download_file_with_aria2,  # noqa: F401
    get_aria2_status,  # noqa: F401
    pause_download,  # noqa: F401
    resume_download,  # noqa: F401
    start_aria2_daemon,  # noqa: F401
    stop_aria2_daemon,  # noqa: F401
)
from .download.aria2_backend import (
    aria2_action_error_is_ok as _aria2_action_error_is_ok,  # noqa: F401
)
from .download.aria2_backend import (
    aria2_has_active_transfers_locked as _aria2_has_active_transfers_locked,  # noqa: F401
)
from .download.aria2_backend import (
    aria2_idle_stop_worker as _aria2_idle_stop_worker,  # noqa: F401
)
from .download.aria2_backend import aria2_ping as _aria2_ping  # noqa: F401
from .download.aria2_backend import aria2_rpc as _aria2_rpc  # noqa: F401
from .download.aria2_backend import aria2_tell_status as _aria2_tell_status  # noqa: F401
from .download.aria2_backend import (
    cancel_aria2_idle_timer_locked as _cancel_aria2_idle_timer_locked,  # noqa: F401
)
from .download.aria2_backend import (
    delete_partial_download_files as _delete_partial_download_files,  # noqa: F401
)
from .download.aria2_backend import (
    delete_python_partial_download_file as _delete_python_partial_download_file,  # noqa: F401
)
from .download.aria2_backend import (
    delete_xet_partial_file as _delete_xet_partial_file,  # noqa: F401
)
from .download.aria2_backend import ensure_aria2_daemon as _ensure_aria2_daemon  # noqa: F401
from .download.aria2_backend import (
    find_free_port as _find_free_port,  # noqa: F401
)
from .download.aria2_backend import (
    force_remove_aria2_transfer as _force_remove_aria2_transfer,
)
from .download.aria2_backend import (
    get_aria2_action_lock as _get_aria2_action_lock,  # noqa: F401
)
from .download.aria2_backend import (
    parse_aria2_int as _parse_aria2_int,  # noqa: F401
)
from .download.aria2_backend import (
    queue_aria2_desired_state as _queue_aria2_desired_state,  # noqa: F401
)
from .download.aria2_backend import read_aria2_version as _read_aria2_version  # noqa: F401
from .download.aria2_backend import (
    resolve_aria2_completed_path as _resolve_aria2_completed_path,  # noqa: F401
)
from .download.aria2_backend import (
    resolve_aria2c_executable as _resolve_aria2c_executable,  # noqa: F401
)
from .download.aria2_backend import (
    run_aria2_desired_state_worker as _run_aria2_desired_state_worker,  # noqa: F401
)
from .download.aria2_backend import (
    schedule_aria2_idle_stop as _schedule_aria2_idle_stop,  # noqa: F401
)
from .download.aria2_backend import (
    set_download_progress_status as _set_download_progress_status,
)
from .download.aria2_backend import (
    try_certifi_ca_path as _try_certifi_ca_path,  # noqa: F401
)
from .download.huggingface_xet import (
    HuggingFaceXetDownloadCancelled as _HuggingFaceXetDownloadCancelled,  # noqa: F401
)
from .download.huggingface_xet import (
    HuggingFaceXetProgressAdapter as _HuggingFaceXetProgressAdapter,  # noqa: F401
)
from .download.huggingface_xet import (
    download_huggingface_xet as _download_huggingface_xet,  # noqa: F401
)
from .download.huggingface_xet import (
    run_huggingface_xet_transfer as _run_huggingface_xet_transfer,  # noqa: F401
)
from .download.orchestrator import download_file
from .download.previews import (
    MODEL_PREVIEW_EXTENSIONS,  # noqa: F401
    MODEL_PREVIEW_MAX_DOWNLOAD_BYTES,  # noqa: F401
    MODEL_PREVIEW_MAX_HEIGHT,  # noqa: F401
    MODEL_PREVIEW_QUALITY,  # noqa: F401
    MODEL_PREVIEW_VIDEO_MAX_DOWNLOAD_BYTES,  # noqa: F401
    MODEL_PREVIEW_WIDTH,  # noqa: F401
    _download_preview_asset,  # noqa: F401
    _download_preview_asset_with_system_trust,  # noqa: F401
    _download_preview_image,  # noqa: F401
    _download_preview_image_with_system_trust,  # noqa: F401
    _first_model_preview_asset,  # noqa: F401
    _preview_media_type,  # noqa: F401
    _rewrite_civitai_preview_url,  # noqa: F401
    _save_optimized_jpeg,  # noqa: F401
    _save_preview_video,  # noqa: F401
    create_model_preview,
    get_existing_model_preview_path,  # noqa: F401
)
from .network_utils import (
    host_matches_domain,
    request_public_url,
    validate_public_http_url,  # noqa: F401
)
from .path_utils import (
    calculate_file_sha256,
    get_comfy_root_path,
    get_filename_from_path,
    get_model_resolver_sidecar_path,
    get_path_identity,
    is_path_within,
    write_json_atomic,
)
from .resolver import invalidate_local_hash_match_cache  # noqa: F401
from .scanner import invalidate_model_files_cache  # noqa: F401
from .type_utils import (
    extract_response_file_size,  # noqa: F401
    get_category_folder_keys,
    normalize_download_category,  # noqa: F401
)
from .type_utils import format_size_bytes as format_bytes  # noqa: F401

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
MANAGED_ARIA2_ROOT = Path(__file__).resolve().parents[1] / "tools" / "aria2"
HF_XET_ARIA2_AUTH_HOSTS = {
    "cas-bridge.xethub.hf.co",
    "cas-bridge-direct.xethub.hf.co",
    "cas-bridge-direct.xethub-eu.hf.co",
}

from .download.metadata import (
    _coerce_int_or_value,  # noqa: F401
    _coerce_size,  # noqa: F401
    _extract_expected_sha256,
    _find_metadata_file_info,  # noqa: F401
    _json_safe_metadata,  # noqa: F401
    _metadata_source_value,  # noqa: F401
    _normalise_metadata_file_path,
    _resolve_lora_manager_model_type,  # noqa: F401
    build_model_resolver_metadata,
    read_completed_metadata_sha256,
)
from .download.validation import (
    DOWNLOAD_USER_AGENT,  # noqa: F401
    _get_header_value,  # noqa: F401
    _is_sensitive_metadata_key,  # noqa: F401
    _sanitize_download_error,  # noqa: F401
    _strip_sensitive_url_params,  # noqa: F401
    build_download_headers,
    is_allowed_model_download_filename,
    sanitize_download_filename,
)
from .settings import (
    load_settings,
    normalize_download_backend,
    normalize_relative_subfolder,
)


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


def write_model_resolver_metadata(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    source_url: str = "",
    create_preview: bool = False,
) -> Optional[str]:
    """Write metadata only to the sidecar owned by Model Resolver."""
    metadata_path = get_model_resolver_sidecar_path(dest_path)

    try:
        payload = build_model_resolver_metadata(dest_path, metadata, category, source_url)
        if create_preview:
            preview_source = {
                **payload,
                **(metadata if isinstance(metadata, dict) else {}),
            }
            preview_path = create_model_preview(dest_path, preview_source)
            if preview_path:
                payload["preview_url"] = _normalise_metadata_file_path(preview_path)
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


def _download_backend_from_settings(settings: Optional[Dict[str, Any]] = None) -> str:
    active_settings = settings if isinstance(settings, dict) else load_settings()
    return normalize_download_backend(active_settings.get("download_backend"))


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
                # Refresh the sidecar even when it already exists. The selected
                # source may be more authoritative than metadata left by an
                # earlier fuzzy search or manual download attempt.
                metadata_path = write_model_resolver_metadata(
                    dest_path,
                    metadata or {},
                    category,
                    url,
                    create_preview=True,
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

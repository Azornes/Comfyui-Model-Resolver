"""
Model Downloader Module

Handles downloading models from various sources with progress tracking.
"""

import hashlib  # noqa: F401
import os  # noqa: F401
import secrets  # noqa: F401
import shutil  # noqa: F401
import subprocess
import sys
import threading
import time  # noqa: F401
from collections import deque  # noqa: F401
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse  # noqa: F401

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
    resolve_download_url_for_aria2 as _resolve_download_url_for_aria2,  # noqa: F401
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
from .download.config import (
    download_backend_from_settings as _download_backend_from_settings,  # noqa: F401
)
from .download.config import (
    generate_download_id,  # noqa: F401
)
from .download.directories import get_download_directory  # noqa: F401
from .download.huggingface_xet import (
    HuggingFaceXetDownloadCancelled as _HuggingFaceXetDownloadCancelled,  # noqa: F401
)
from .download.huggingface_xet import (
    HuggingFaceXetProgressAdapter as _HuggingFaceXetProgressAdapter,
)
from .download.huggingface_xet import (
    download_huggingface_xet as _download_huggingface_xet,  # noqa: F401
)
from .download.huggingface_xet import (
    run_huggingface_xet_transfer as _run_huggingface_xet_transfer,  # noqa: F401
)
from .download.orchestrator import (
    download_file as _download_file,
)
from .download.orchestrator import (
    download_model as _download_model,
)
from .download.orchestrator import (
    start_background_download as _start_background_download,
)
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
    create_model_preview,  # noqa: F401
    get_existing_model_preview_path,  # noqa: F401
)
from .download.state import (
    DownloadStateDependencies,
    aria2_action_locks,  # noqa: F401
    aria2_desired_states,
    aria2_lock,
    aria2_transfers,
    cancelled_downloads,
    download_lock,
    download_progress,
    xet_transfers,
    xet_transfers_lock,
)
from .download.state import (
    cancel_download as _cancel_download,
)
from .download.state import (
    clear_completed_downloads as _clear_completed_downloads,
)
from .download.state import (
    get_all_progress as _get_all_progress,
)
from .download.state import (
    get_progress as _get_progress,
)
from .network_utils import (
    host_matches_domain,  # noqa: F401
    request_public_url,  # noqa: F401
    validate_public_http_url,  # noqa: F401
)
from .path_utils import (
    calculate_file_sha256,  # noqa: F401
    get_comfy_root_path,  # noqa: F401
    get_filename_from_path,  # noqa: F401
    get_model_resolver_sidecar_path,  # noqa: F401
    get_path_identity,  # noqa: F401
    is_path_within,  # noqa: F401
    write_json_atomic,  # noqa: F401
)
from .resolver import invalidate_local_hash_match_cache  # noqa: F401
from .scanner import invalidate_model_files_cache  # noqa: F401
from .type_utils import (
    extract_response_file_size,  # noqa: F401
    get_category_folder_keys,  # noqa: F401
    normalize_download_category,  # noqa: F401
)
from .type_utils import format_size_bytes as format_bytes  # noqa: F401

try:
    import folder_paths
except ImportError:
    folder_paths = None

aria2_process: Optional[subprocess.Popen] = None
aria2_rpc_url = ""
aria2_rpc_secret = ""
aria2_rpc_lock = threading.Lock()
aria2_idle_timer: Optional[threading.Timer] = None
aria2_process_started_by_resolver = False

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
    _extract_expected_sha256,  # noqa: F401
    _json_safe_metadata,  # noqa: F401
    _metadata_source_value,  # noqa: F401
    _normalise_metadata_file_path,  # noqa: F401
    _resolve_lora_manager_model_type,  # noqa: F401
    build_model_resolver_metadata,  # noqa: F401
    read_completed_metadata_sha256,  # noqa: F401
    write_model_resolver_metadata,  # noqa: F401
)
from .download.validation import (
    DOWNLOAD_USER_AGENT,  # noqa: F401
    _get_header_value,  # noqa: F401
    _sanitize_download_error,  # noqa: F401
    _strip_sensitive_url_params,  # noqa: F401
    build_download_headers,  # noqa: F401
    is_allowed_model_download_filename,  # noqa: F401
    sanitize_download_filename,  # noqa: F401
)
from .settings import (
    load_settings,  # noqa: F401
    normalize_download_backend,  # noqa: F401
    normalize_relative_subfolder,  # noqa: F401
)


def _bind_aria2_dependencies(function):
    """Bind the downloader facade as explicit aria2 backend dependencies."""
    def bound(*args: Any, **kwargs: Any):
        kwargs.setdefault("dependencies", sys.modules[__name__])
        return function(*args, **kwargs)

    return bound


def _bind_download_dependencies(function):
    """Bind the downloader facade as explicit download-module dependencies."""
    def bound(*args: Any, **kwargs: Any):
        kwargs.setdefault("dependencies", sys.modules[__name__])
        return function(*args, **kwargs)

    return bound


for _aria2_dependency_name in (
    "download_file_with_aria2",
    "get_aria2_status",
    "pause_download",
    "resume_download",
    "start_aria2_daemon",
    "stop_aria2_daemon",
    "_aria2_ping",
    "_aria2_rpc",
    "_aria2_tell_status",
    "_cancel_aria2_idle_timer_locked",
    "_delete_partial_download_files",
    "_delete_python_partial_download_file",
    "_delete_xet_partial_file",
    "_ensure_aria2_daemon",
    "_force_remove_aria2_transfer",
    "_get_aria2_action_lock",
    "_read_aria2_version",
    "_resolve_aria2c_executable",
    "_resolve_download_url_for_aria2",
    "_run_aria2_desired_state_worker",
    "_schedule_aria2_idle_stop",
    "_set_download_progress_status",
    "_try_certifi_ca_path",
    "_aria2_has_active_transfers_locked",
    "_queue_aria2_desired_state",
):
    globals()[_aria2_dependency_name] = _bind_aria2_dependencies(
        globals()[_aria2_dependency_name]
    )


for _download_dependency_name in (
    "get_download_directory",
    "write_model_resolver_metadata",
    "create_model_preview",
    "_download_preview_asset",
    "_download_preview_asset_with_system_trust",
    "_download_preview_image",
    "_download_preview_image_with_system_trust",
    "_download_huggingface_xet",
    "_run_huggingface_xet_transfer",
):
    globals()[_download_dependency_name] = _bind_download_dependencies(
        globals()[_download_dependency_name]
    )


class _BoundHuggingFaceXetProgressAdapter(_HuggingFaceXetProgressAdapter):
    """Keep the local test/import surface bound to downloader dependencies."""

    def __init__(self, *args: Any, **kwargs: Any):
        kwargs.setdefault("dependencies", sys.modules[__name__])
        super().__init__(*args, **kwargs)


_HuggingFaceXetProgressAdapter = _BoundHuggingFaceXetProgressAdapter


def _state_dependencies() -> DownloadStateDependencies:
    """Build state dependencies from the current facade patchpoints."""
    return DownloadStateDependencies(
        download_progress=download_progress,
        download_lock=download_lock,
        cancelled_downloads=cancelled_downloads,
        aria2_lock=aria2_lock,
        aria2_transfers=aria2_transfers,
        aria2_desired_states=aria2_desired_states,
        xet_transfers=xet_transfers,
        xet_transfers_lock=xet_transfers_lock,
        set_download_progress_status=_set_download_progress_status,
        force_remove_aria2_transfer=_force_remove_aria2_transfer,
        thread_factory=threading.Thread,
        log=log,
    )


def get_progress(download_id: str) -> Optional[Dict[str, Any]]:
    return _get_progress(download_id, _state_dependencies())


def get_all_progress() -> Dict[str, Dict[str, Any]]:
    return _get_all_progress(_state_dependencies())


def cancel_download(download_id: str) -> bool:
    return _cancel_download(download_id, _state_dependencies())


def clear_completed_downloads():
    return _clear_completed_downloads(_state_dependencies())


def download_file(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    kwargs["dependencies"] = sys.modules[__name__]
    return _download_file(*args, **kwargs)


def download_model(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    kwargs["dependencies"] = sys.modules[__name__]
    return _download_model(*args, **kwargs)


def start_background_download(*args: Any, **kwargs: Any) -> str:
    kwargs["dependencies"] = sys.modules[__name__]
    return _start_background_download(*args, **kwargs)


__all__ = [
    "cancel_download",
    "clear_completed_downloads",
    "download_file",
    "download_model",
    "get_all_progress",
    "get_progress",
    "start_background_download",
]

# End of downloader facade.

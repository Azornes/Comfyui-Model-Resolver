"""Public download operations composed from the internal download modules."""

import hashlib
import os
import secrets
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests

from ..log_system import create_module_logger
from ..network_utils import (
    host_matches_domain,
    request_public_url,
    validate_public_http_url,
)
from ..path_utils import (
    calculate_file_sha256,
    get_comfy_root_path,
    get_filename_from_path,
    get_model_resolver_sidecar_path,
    get_path_identity,
    is_path_within,
    write_json_atomic,
)
from ..resolver import (
    invalidate_local_hash_match_cache,
)
from ..scanner import invalidate_model_files_cache
from ..settings import (
    load_settings,
    normalize_download_backend,
    normalize_relative_subfolder,
)
from ..type_utils import (
    extract_response_file_size,
    get_category_folder_keys,
    normalize_download_category,
)
from ..type_utils import (
    format_size_bytes as format_bytes,
)
from . import aria2_backend, config, directories, huggingface_xet, metadata, orchestrator, previews, state, validation

try:
    import folder_paths
except ImportError:
    folder_paths = None


log = create_module_logger("core.downloader")

SPEED_HISTORY_SIZE = 5
CHUNK_SIZE = 1024 * 1024
CLI_LOG_INTERVAL = 5
ARIA2_RPC_TIMEOUT = (2, 5)
ARIA2_STATUS_RPC_RETRIES = 4
ARIA2_STATUS_RPC_RETRY_DELAY = 0.15
ARIA2_IDLE_STOP_SECONDS = 5 * 60
MANAGED_ARIA2_ROOT = Path(__file__).resolve().parents[1] / "tools" / "aria2"
HF_XET_ARIA2_AUTH_HOSTS = {
    "cas-bridge.xethub.hf.co",
    "cas-bridge-direct.xethub.hf.co",
    "cas-bridge-direct.xethub-eu.hf.co",
}


context = SimpleNamespace()
context.log = log
context.os = os
context.secrets = secrets
context.shutil = shutil
context.subprocess = subprocess
context.threading = threading
context.time = time
context.hashlib = hashlib
context.deque = deque
context.requests = requests
context.urlparse = urlparse
context.folder_paths = folder_paths

context.SPEED_HISTORY_SIZE = SPEED_HISTORY_SIZE
context.CHUNK_SIZE = CHUNK_SIZE
context.CLI_LOG_INTERVAL = CLI_LOG_INTERVAL
context.ARIA2_RPC_TIMEOUT = ARIA2_RPC_TIMEOUT
context.ARIA2_STATUS_RPC_RETRIES = ARIA2_STATUS_RPC_RETRIES
context.ARIA2_STATUS_RPC_RETRY_DELAY = ARIA2_STATUS_RPC_RETRY_DELAY
context.ARIA2_IDLE_STOP_SECONDS = ARIA2_IDLE_STOP_SECONDS
context.MANAGED_ARIA2_ROOT = MANAGED_ARIA2_ROOT
context.HF_XET_ARIA2_AUTH_HOSTS = HF_XET_ARIA2_AUTH_HOSTS

context.aria2_process = None
context.aria2_rpc_url = ""
context.aria2_rpc_secret = ""
context.aria2_rpc_lock = threading.Lock()
context.aria2_idle_timer = None
context.aria2_process_started_by_resolver = False

context.download_progress = state.download_progress
context.download_lock = state.download_lock
context.cancelled_downloads = state.cancelled_downloads
context.aria2_lock = state.aria2_lock
context.aria2_transfers = state.aria2_transfers
context.aria2_action_locks = state.aria2_action_locks
context.aria2_desired_states = state.aria2_desired_states
context.xet_transfers = state.xet_transfers
context.xet_transfers_lock = state.xet_transfers_lock

context.load_settings = load_settings
context.normalize_download_backend = normalize_download_backend
context.normalize_relative_subfolder = normalize_relative_subfolder
context.generate_download_id = config.generate_download_id

context.host_matches_domain = host_matches_domain
context.request_public_url = request_public_url
context.validate_public_http_url = validate_public_http_url
context.build_download_headers = validation.build_download_headers
context.DOWNLOAD_USER_AGENT = validation.DOWNLOAD_USER_AGENT
context._get_header_value = validation._get_header_value
context._sanitize_download_error = validation._sanitize_download_error
context._strip_sensitive_url_params = validation._strip_sensitive_url_params
context.is_allowed_model_download_filename = (
    validation.is_allowed_model_download_filename
)
context.sanitize_download_filename = validation.sanitize_download_filename
context.extract_response_file_size = extract_response_file_size
context.format_bytes = format_bytes
context.calculate_file_sha256 = calculate_file_sha256
context.get_comfy_root_path = get_comfy_root_path
context.get_filename_from_path = get_filename_from_path
context.get_model_resolver_sidecar_path = get_model_resolver_sidecar_path
context.get_path_identity = get_path_identity
context.is_path_within = is_path_within
context.write_json_atomic = write_json_atomic
context.get_category_folder_keys = get_category_folder_keys
context.invalidate_model_files_cache = invalidate_model_files_cache
context.invalidate_local_hash_match_cache = invalidate_local_hash_match_cache

context._extract_expected_sha256 = metadata._extract_expected_sha256
context._normalise_metadata_file_path = metadata._normalise_metadata_file_path
context._json_safe_metadata = metadata._json_safe_metadata
context._coerce_int_or_value = metadata._coerce_int_or_value
context._coerce_size = metadata._coerce_size
context._metadata_source_value = metadata._metadata_source_value
context._resolve_lora_manager_model_type = metadata._resolve_lora_manager_model_type
context.build_model_resolver_metadata = metadata.build_model_resolver_metadata
context.read_completed_metadata_sha256 = metadata.read_completed_metadata_sha256


def _bind(function):
    """Bind the composed download context to an internal operation."""
    def bound(*args: Any, **kwargs: Any):
        kwargs.setdefault("dependencies", context)
        return function(*args, **kwargs)

    return bound


context._download_backend_from_settings = _bind(
    config.download_backend_from_settings
)
context.get_download_directory = _bind(directories.get_download_directory)
context.write_model_resolver_metadata = _bind(
    metadata.write_model_resolver_metadata
)
context.create_model_preview = _bind(previews.create_model_preview)
context._download_preview_asset = _bind(previews._download_preview_asset)
context._download_preview_asset_with_system_trust = _bind(
    previews._download_preview_asset_with_system_trust
)
context._download_preview_image = _bind(previews._download_preview_image)
context._download_preview_image_with_system_trust = _bind(
    previews._download_preview_image_with_system_trust
)
context.get_existing_model_preview_path = previews.get_existing_model_preview_path

context._download_huggingface_xet = _bind(
    huggingface_xet.download_huggingface_xet
)
context._run_huggingface_xet_transfer = _bind(
    huggingface_xet.run_huggingface_xet_transfer
)

context.download_file_with_aria2 = _bind(aria2_backend.download_file_with_aria2)
context.get_aria2_status = _bind(aria2_backend.get_aria2_status)
context.pause_download = _bind(aria2_backend.pause_download)
context.resume_download = _bind(aria2_backend.resume_download)
context.start_aria2_daemon = _bind(aria2_backend.start_aria2_daemon)
context.stop_aria2_daemon = _bind(aria2_backend.stop_aria2_daemon)
context._aria2_ping = _bind(aria2_backend.aria2_ping)
context._aria2_rpc = _bind(aria2_backend.aria2_rpc)
context._aria2_tell_status = _bind(aria2_backend.aria2_tell_status)
context._cancel_aria2_idle_timer_locked = _bind(
    aria2_backend.cancel_aria2_idle_timer_locked
)
context._delete_partial_download_files = _bind(
    aria2_backend.delete_partial_download_files
)
context._delete_python_partial_download_file = _bind(
    aria2_backend.delete_python_partial_download_file
)
context._delete_xet_partial_file = _bind(aria2_backend.delete_xet_partial_file)
context._ensure_aria2_daemon = _bind(aria2_backend.ensure_aria2_daemon)
context._force_remove_aria2_transfer = _bind(
    aria2_backend.force_remove_aria2_transfer
)
context._get_aria2_action_lock = _bind(aria2_backend.get_aria2_action_lock)
context._read_aria2_version = _bind(aria2_backend.read_aria2_version)
context._resolve_aria2c_executable = _bind(
    aria2_backend.resolve_aria2c_executable
)
context._resolve_download_url_for_aria2 = _bind(
    aria2_backend.resolve_download_url_for_aria2
)
context._run_aria2_desired_state_worker = _bind(
    aria2_backend.run_aria2_desired_state_worker
)
context._schedule_aria2_idle_stop = _bind(aria2_backend.schedule_aria2_idle_stop)
context._set_download_progress_status = _bind(
    aria2_backend.set_download_progress_status
)
context._try_certifi_ca_path = _bind(aria2_backend.try_certifi_ca_path)
context._aria2_has_active_transfers_locked = _bind(
    aria2_backend.aria2_has_active_transfers_locked
)
context._queue_aria2_desired_state = _bind(
    aria2_backend.queue_aria2_desired_state
)
context._aria2_action_error_is_ok = aria2_backend.aria2_action_error_is_ok
context.Aria2Error = aria2_backend.Aria2Error
context._find_free_port = aria2_backend.find_free_port
context._parse_aria2_int = aria2_backend.parse_aria2_int
context._resolve_aria2_completed_path = aria2_backend.resolve_aria2_completed_path


def _state_dependencies() -> state.DownloadStateDependencies:
    return state.DownloadStateDependencies(
        download_progress=context.download_progress,
        download_lock=context.download_lock,
        cancelled_downloads=context.cancelled_downloads,
        aria2_lock=context.aria2_lock,
        aria2_transfers=context.aria2_transfers,
        aria2_desired_states=context.aria2_desired_states,
        xet_transfers=context.xet_transfers,
        xet_transfers_lock=context.xet_transfers_lock,
        set_download_progress_status=context._set_download_progress_status,
        force_remove_aria2_transfer=context._force_remove_aria2_transfer,
        thread_factory=threading.Thread,
        log=log,
    )


def get_progress(download_id: str) -> Optional[Dict[str, Any]]:
    return state.get_progress(download_id, _state_dependencies())


def get_all_progress() -> Dict[str, Dict[str, Any]]:
    return state.get_all_progress(_state_dependencies())


def cancel_download(download_id: str) -> bool:
    return state.cancel_download(download_id, _state_dependencies())


def clear_completed_downloads():
    return state.clear_completed_downloads(_state_dependencies())


context.get_progress = get_progress
context.get_all_progress = get_all_progress
context.cancel_download = cancel_download
context.clear_completed_downloads = clear_completed_downloads


class _BoundHuggingFaceXetProgressAdapter(
    huggingface_xet.HuggingFaceXetProgressAdapter
):
    """Bind the composed context for direct progress adapter consumers."""

    def __init__(self, *args: Any, **kwargs: Any):
        kwargs.setdefault("dependencies", context)
        super().__init__(*args, **kwargs)


context._HuggingFaceXetProgressAdapter = _BoundHuggingFaceXetProgressAdapter


def _download_file(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    kwargs["dependencies"] = context
    return orchestrator.download_file(*args, **kwargs)


def _download_model(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    kwargs["dependencies"] = context
    return orchestrator.download_model(*args, **kwargs)


def download_file(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return _download_file(*args, **kwargs)


def download_model(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return _download_model(*args, **kwargs)


def start_background_download(*args: Any, **kwargs: Any) -> str:
    kwargs["dependencies"] = context
    return orchestrator.start_background_download(*args, **kwargs)


context.download_file = _download_file
context.download_model = _download_model


is_allowed_model_download_filename = context.is_allowed_model_download_filename
sanitize_download_filename = context.sanitize_download_filename
get_existing_model_preview_path = context.get_existing_model_preview_path


__all__ = [
    "cancel_download",
    "clear_completed_downloads",
    "download_file",
    "download_model",
    "get_all_progress",
    "get_aria2_status",
    "get_download_directory",
    "get_existing_model_preview_path",
    "get_progress",
    "is_allowed_model_download_filename",
    "normalize_download_category",
    "pause_download",
    "resume_download",
    "sanitize_download_filename",
    "start_aria2_daemon",
    "start_background_download",
    "stop_aria2_daemon",
    "write_model_resolver_metadata",
]


get_aria2_status = context.get_aria2_status
get_download_directory = context.get_download_directory
pause_download = context.pause_download
resume_download = context.resume_download
start_aria2_daemon = context.start_aria2_daemon
stop_aria2_daemon = context.stop_aria2_daemon
write_model_resolver_metadata = context.write_model_resolver_metadata

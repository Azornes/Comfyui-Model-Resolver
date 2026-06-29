"""
@author: Model Resolver Team
@title: ComfyUI Model Resolver
@nickname: Model Resolver
@version: 1.1.0
@description: Extension for resolving missing models and downloading from HuggingFace/CivitAI
"""

import asyncio
import threading
import time
import sys
import os

if not __package__ or __package__ == "":
    this_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(this_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
    package_name = os.path.basename(this_dir)
    __package__ = package_name

    current_module = sys.modules.get(__name__)
    if current_module:
        sys.modules[package_name] = current_module
        if not hasattr(current_module, "__path__"):
            current_module.__path__ = [this_dir]
from .core.log_system.log_funcs import (
    create_module_logger,
    log_debug,
    log_info,
    log_error,
    log_exception,
    log_warn,
)
from .core.log_system.config import LOG_LEVEL as BACKEND_DEFAULT_LOG_LEVEL
from .core.log_system.logger import LogLevel, logger as backend_log_controller

# Web directory for JavaScript interface
WEB_DIRECTORY = "./web"

# Empty NODE_CLASS_MAPPINGS - we don't provide custom nodes, only web extension
# This prevents ComfyUI from showing "IMPORT FAILED" message
NODE_CLASS_MAPPINGS = {}

__all__ = ["WEB_DIRECTORY"]


class ModelResolverExtension:
    """Main extension class for Model Resolver."""

    def __init__(self):
        self.routes_setup = False
        self.logger = create_module_logger(__name__)
        self.analysis_progress = {}
        self.search_progress = {}
        self.hash_progress = {}
        self.cancelled_search_progress = set()
        self.cancelled_hash_progress = set()
        self.search_progress_lock = threading.Lock()
        self.hash_progress_lock = threading.Lock()
        self.search_result_timestamps = {}

    def initialize(self):
        """Initialize the extension and set up API routes."""
        try:
            self.setup_routes()
            self.logger.info("Model Resolver: Extension initialized successfully")
        except Exception as e:
            self.logger.error(
                f"Model Resolver: Extension initialization failed: {e}", exc_info=True
            )

    def setup_routes(self):
        """Register API routes for the Model Resolver extension."""
        if self.routes_setup:
            return  # Already set up

        try:
            from aiohttp import web

            # Try to get routes from PromptServer
            try:
                from server import PromptServer

                if (
                    not hasattr(PromptServer, "instance")
                    or PromptServer.instance is None
                ):
                    self.logger.debug("Model Resolver: PromptServer not available yet")
                    return False

                routes = PromptServer.instance.routes
            except (ImportError, AttributeError) as e:
                self.logger.debug(f"Model Resolver: Could not access PromptServer: {e}")
                return False

            # Import resolver modules
            try:
                from .core.resolver import (
                    analyze_and_find_matches,
                    apply_resolution,
                    normalize_sha256,
                    search_local_matches_by_hash,
                    search_local_matches,
                )
                from .core.path_templates import infer_download_path_templates
                from .core.scanner import get_model_files, invalidate_model_files_cache
                from .core.path_utils import (
                    get_filename_from_path,
                    read_json_safe,
                    write_json_atomic,
                )
                from .core.type_utils import first_non_empty, to_int, to_bool
                from .core.settings import (
                    TEMPLATE_KEY_ALIASES,
                    bool_setting as resolver_bool_setting,
                    get_default_root_for_category,
                    load_settings as load_resolver_settings,
                    resolve_download_subfolder,
                    save_settings as save_resolver_settings,
                )
            except ImportError as e:
                self.logger.error(f"Model Resolver: Could not import core modules: {e}")
                return False

            # Import download modules
            try:
                from .core.downloader import (
                    start_background_download,
                    get_progress,
                    get_all_progress,
                    cancel_download,
                    pause_download,
                    resume_download,
                    get_aria2_status,
                    start_aria2_daemon,
                    stop_aria2_daemon,
                    get_download_directory,
                    get_metadata_sidecar_path,
                    normalize_download_category,
                    write_lora_manager_metadata,
                )
                from .core.aria2_installer import Aria2InstallError, install_aria2_engine
                from .core.sources.popular import (
                    get_popular_model_url,
                    search_popular_models,
                    reload_databases as reload_popular_databases,
                )
                from .core.sources.model_list import (
                    search_model_list,
                    search_model_list_multiple,
                    get_model_list_update_status,
                    update_model_list_from_remote,
                    reload_model_list,
                )
                from .core.sources.huggingface import (
                    search_huggingface_for_file,
                    get_author_fallback_index_status,
                    refresh_author_fallback_index,
                    check_huggingface_token,
                    check_brave_search_api_key,
                    clear_search_cache as clear_huggingface_search_cache,
                )
                from .core.sources.civitai import (
                    search_civitai_for_file,
                    search_civitai,
                    get_civitai_download_url,
                    get_civitai_model_details,
                    resolve_urn,
                    check_civitai_api_key,
                    check_civitai_session_token,
                    clear_search_cache as clear_civitai_search_cache,
                )
                from .core.sources.civarchive import (
                    CivArchiveSearchError,
                    is_civarchive_available,
                    search_civarchive_for_file,
                    resolve_civarchive_by_hash,
                    resolve_civarchive_model_version,
                    get_civarchive_model_details,
                    clear_search_cache as clear_civarchive_search_cache,
                )
                from .core.sources.lora_manager_archive import (
                    is_lora_manager_archive_available,
                    search_lora_manager_archive_for_file,
                    clear_search_cache as clear_lora_manager_archive_search_cache,
                )

                download_available = True
            except ImportError as e:
                self.logger.warning(
                    f"Model Resolver: Download features not available: {e}"
                )
                download_available = False

            def json_api_endpoint(error_prefix, return_success_on_error=False):
                def decorator(func):
                    from functools import wraps
                    @wraps(func)
                    async def wrapper(request, *args, **kwargs):
                        try:
                            return await func(request, *args, **kwargs)
                        except Exception as e:
                            self.logger.error(
                                f"Model Resolver {error_prefix} error: {e}", exc_info=True
                            )
                            response_data = {"error": str(e)}
                            if return_success_on_error:
                                response_data["success"] = False
                            return web.json_response(response_data, status=500)
                    return wrapper
                return decorator

            # ==================== BASE MODELS CONFIG ROUTE ====================

            @routes.get("/model_resolver/base-models")
            @json_api_endpoint("base-models")
            async def get_base_models(request):
                """Return the base models config from metadata/base-models.json.
                
                Returns {base_models: [{name, aliases}]} so the frontend
                dropdown can populate correctly via baseModels.base_models.
                """
                from .core.sources.popular import get_base_models_config
                data = get_base_models_config()
                return web.json_response(data)

            @routes.get("/model_resolver/base-models/status")
            @json_api_endpoint("base-models status")
            async def get_base_models_status_route(request):
                """Get local and optional remote base models status."""
                check_remote = request.query.get("check_remote") == "1"
                from .core.sources.popular import get_base_models_status
                status = await asyncio.to_thread(get_base_models_status, check_remote)
                return web.json_response(status)

            @routes.post("/model_resolver/base-models/update")
            @json_api_endpoint("base-models update")
            async def update_base_models_route(request):
                """Update base models list from CivitAI."""
                from .core.sources.popular import update_base_models_from_remote
                status = await asyncio.to_thread(update_base_models_from_remote)
                return web.json_response(status)

            # ==================== ANALYZE ROUTES ====================

            @routes.post("/model_resolver/analyze")
            async def analyze_workflow(request):
                """Analyze workflow and return missing models with matches."""
                try:
                    data = await request.json()
                    workflow_json = data.get("workflow")
                    analysis_id = str(data.get("analysis_id") or "").strip()
                    force_rescan = data.get("force_rescan", False)
                    force_rescan = (
                        force_rescan
                        if isinstance(force_rescan, bool)
                        else str(force_rescan).lower() in {"1", "true", "yes"}
                    )

                    if workflow_json is None:
                        return web.json_response(
                            {"error": "Workflow JSON is required"}, status=400
                        )
                    if not isinstance(workflow_json, dict):
                        return web.json_response(
                            {"error": "Workflow JSON must be an object"}, status=400
                        )

                    if analysis_id:
                        self.analysis_progress[analysis_id] = {
                            "status": "starting",
                            "stage": "starting",
                            "message": "Starting analysis...",
                            "current": 0,
                            "total": 0,
                        }

                    def update_analysis_progress(payload):
                        if not analysis_id:
                            return
                        self.analysis_progress[analysis_id] = {
                            **self.analysis_progress.get(analysis_id, {}),
                            **payload,
                            "status": "running"
                            if payload.get("stage") != "completed"
                            else "completed",
                        }

                    # Analyze and find matches
                    result = await asyncio.to_thread(
                        analyze_and_find_matches,
                        workflow_json,
                        0.0,
                        10,
                        update_analysis_progress if analysis_id else None,
                        force_rescan=force_rescan,
                    )

                    # Filter out LoraManager lorAs that already exist locally (exists=True)
                    # These should not appear in missing models at all
                    missing_models = result.get("missing_models", [])
                    filtered_missing = []
                    for missing in missing_models:
                        is_lora = missing.get("is_lora_v2")
                        exists = missing.get("exists")
                        name = missing.get("name") or missing.get("original_path", "")
                        self.logger.debug(
                            f"Filtering: {name} is_lora_v2={is_lora} exists={exists}"
                        )

                        # Skip LoraManager lorAs that already exist locally
                        if is_lora and exists:
                            self.logger.info(
                                f"Filtered out LoraManager lora: {name}"
                            )
                            continue
                        filtered_missing.append(missing)
                    result["missing_models"] = filtered_missing
                    result["total_missing"] = len(filtered_missing)

                    # If download available, check for download sources only from LOCAL sources
                    # (workflow_url, popular, model-list.json) - skip automatic online search
                    # Online search is now only triggered on-demand via search button
                    if download_available:
                        for missing in result.get("missing_models", []):
                            # Check if there's a 100% local match
                            matches = missing.get("matches", [])
                            has_perfect_match = any(
                                m.get("confidence", 0) == 100 for m in matches
                            )

                            if not has_perfect_match:
                                filename = (
                                    missing.get("original_path", "")
                                    .split("/")[-1]
                                    .split("\\")[-1]
                                )

                                # 0. Check workflow URL first (highest priority - directly from workflow)
                                workflow_url = missing.get("workflow_url", "")
                                if workflow_url:
                                    # Determine source from URL
                                    if "huggingface.co" in workflow_url:
                                        source = "huggingface"
                                    elif "civitai.com" in workflow_url:
                                        source = "civitai"
                                    else:
                                        source = "workflow"

                                    # Try to get file size with HEAD request (non-blocking, timeout quickly)
                                    file_size = None
                                    try:
                                        import requests

                                        head_response = requests.head(
                                            workflow_url,
                                            allow_redirects=True,
                                            timeout=5,
                                        )
                                        if head_response.status_code == 200:
                                            file_size = int(
                                                head_response.headers.get(
                                                    "content-length", 0
                                                )
                                            )
                                    except Exception:
                                        pass  # Size unknown is fine

                                    missing["download_source"] = {
                                        "source": source,
                                        "url": workflow_url,
                                        "model_url": missing.get(
                                            "workflow_model_url", workflow_url
                                        ),
                                        "filename": filename,
                                        "directory": missing.get(
                                            "workflow_directory", ""
                                        )
                                        or missing.get("category", "checkpoints"),
                                        "match_type": "exact",
                                        "url_source": "workflow",
                                        "size": file_size,
                                    }
                                    continue

                                # 1. Check popular models (always exact match)
                                popular_info = get_popular_model_url(filename)
                                if popular_info:
                                    popular_model_list_result = search_model_list(
                                        filename, exact_only=True
                                    )
                                    missing["download_source"] = {
                                        "source": "popular",
                                        "url": popular_info.get("url"),
                                        "filename": filename,
                                        "type": popular_info.get("type"),
                                        "directory": popular_info.get("directory"),
                                        "size": (
                                            popular_model_list_result.get("size")
                                            if popular_model_list_result
                                            else None
                                        )
                                        or popular_info.get("size"),
                                        "match_type": "exact",
                                    }
                                    continue

                                # 2. Check model list (ComfyUI Manager database)
                                # Use exact_only=True to avoid confusing fuzzy matches for downloads
                                model_list_result = search_model_list(
                                    filename, exact_only=True
                                )
                                if model_list_result:
                                    missing["download_source"] = {
                                        "source": "model_list",
                                        "url": model_list_result.get("url"),
                                        "filename": model_list_result.get("filename"),
                                        "name": model_list_result.get("name"),
                                        "type": model_list_result.get("type"),
                                        "directory": model_list_result.get("directory"),
                                        "size": model_list_result.get("size"),
                                        "match_type": model_list_result.get(
                                            "match_type"
                                        ),
                                        "confidence": model_list_result.get(
                                            "confidence"
                                        ),
                                    }
                                    continue

                                # NOTE: Search for online sources (HuggingFace, CivitAI) is
                                # now done on-demand via /model_resolver/search endpoint
                                # when user clicks "Search Online" button, not automatically

                    if analysis_id:
                        self.analysis_progress[analysis_id] = {
                            **self.analysis_progress.get(analysis_id, {}),
                            "status": "completed",
                            "stage": "completed",
                            "message": "Analysis complete",
                            "current": result.get("total_missing", 0),
                            "total": result.get("total_missing", 0),
                        }

                    return web.json_response(result)
                except Exception as e:
                    if "analysis_id" in locals() and analysis_id:
                        self.analysis_progress[analysis_id] = {
                            "status": "error",
                            "stage": "error",
                            "message": str(e),
                            "current": 0,
                            "total": 0,
                        }
                    self.logger.error(f"Model Resolver analyze error: {e}", exc_info=True)
                    return web.json_response({"error": str(e)}, status=500)

            @routes.get("/model_resolver/analyze-progress/{analysis_id}")
            @json_api_endpoint("analyze-progress")
            async def get_analyze_progress(request):
                """Get workflow analysis progress."""
                analysis_id = request.match_info.get("analysis_id", "").strip()
                if not analysis_id:
                    return web.json_response(
                        {"error": "Analysis ID is required"}, status=400
                    )

                progress = self.analysis_progress.get(analysis_id)
                if not progress:
                    return web.json_response(
                        {
                            "status": "unknown",
                            "stage": "unknown",
                            "message": "No analysis progress available",
                            "current": 0,
                            "total": 0,
                        }
                    )

                return web.json_response(progress)

            @routes.post("/model_resolver/resolve")
            @json_api_endpoint("resolve", return_success_on_error=True)
            async def resolve_models(request):
                """Apply model resolution and return updated workflow."""
                data = await request.json()
                workflow_json = data.get("workflow")
                resolutions = data.get("resolutions", [])

                if not workflow_json:
                    return web.json_response(
                        {"error": "Workflow JSON is required"}, status=400
                    )

                if not resolutions:
                    return web.json_response(
                        {"error": "Resolutions array is required"}, status=400
                    )

                # Apply resolutions
                updated_workflow = apply_resolution(workflow_json, resolutions)

                return web.json_response(
                    {"workflow": updated_workflow, "success": True}
                )

            @routes.post("/model_resolver/local-matches")
            @json_api_endpoint("local-matches")
            async def local_matches(request):
                """Search local model files by filename/path."""
                data = await request.json()
                filename = data.get("filename", "")
                category = data.get("category", "")
                force_rescan = to_bool(data.get("force_rescan"), False)

                if not filename:
                    return web.json_response(
                        {"error": "filename is required"}, status=400
                    )

                matches = search_local_matches(
                    filename,
                    category=category or None,
                    similarity_threshold=0.0,
                    max_matches_per_model=10,
                    force_rescan=force_rescan,
                )
                return web.json_response({"matches": matches})

            @routes.post("/model_resolver/open-containing-folder")
            @json_api_endpoint("open-containing-folder")
            async def open_containing_folder(request):
                """Open Explorer at the folder containing the selected model."""
                import os
                import subprocess

                data = await request.json()
                target_path = data.get("path", "")

                if not target_path:
                    return web.json_response(
                        {"error": "path is required"}, status=400
                    )

                normalized_path = os.path.normpath(target_path)
                if not os.path.exists(normalized_path):
                    return web.json_response(
                        {"error": "path does not exist"}, status=404
                    )

                if os.path.isfile(normalized_path):
                    absolute_path = os.path.abspath(normalized_path)
                    subprocess.Popen(
                        ["explorer.exe", "/select,", absolute_path],
                        shell=False,
                    )
                else:
                    os.startfile(normalized_path)

                return web.json_response({"success": True})

            def cleanup_hash_progress(max_age_seconds=300):
                cutoff = time.time() - max_age_seconds
                with self.hash_progress_lock:
                    expired = [
                        progress_id
                        for progress_id, progress in self.hash_progress.items()
                        if progress.get("updated_at", progress.get("created_at", 0)) < cutoff
                    ]
                    for progress_id in expired:
                        self.hash_progress.pop(progress_id, None)
                    self.cancelled_hash_progress.difference_update(expired)

            def update_hash_progress(progress_id, **payload):
                if not progress_id:
                    return
                with self.hash_progress_lock:
                    current = self.hash_progress.get(progress_id, {})
                    self.hash_progress[progress_id] = {
                        **current,
                        **payload,
                        "progress_id": progress_id,
                        "updated_at": time.time(),
                    }

            def is_hash_progress_cancelled(progress_id):
                if not progress_id:
                    return False
                with self.hash_progress_lock:
                    return progress_id in self.cancelled_hash_progress

            def mark_hash_progress_cancelled(progress_id):
                if not progress_id:
                    return False
                cleanup_hash_progress()
                with self.hash_progress_lock:
                    current = self.hash_progress.get(progress_id)
                    if not current:
                        return False
                    self.cancelled_hash_progress.add(progress_id)
                    self.hash_progress[progress_id] = {
                        **current,
                        "status": "cancelling",
                        "stage": "cancelling",
                        "message": "Stopping hash calculation...",
                        "updated_at": time.time(),
                    }
                    return True

            class HashCalculationCancelled(Exception):
                pass

            def resolve_hash_file_request(data):
                import os as _os

                file_path = (
                    data.get("file_path")
                    or data.get("resolved_path")
                    or data.get("path")
                    or ""
                )
                if not file_path:
                    return "", "file_path is required"

                normalized_path = _os.path.abspath(_os.path.normpath(file_path))
                if not _os.path.exists(normalized_path) or not _os.path.isfile(normalized_path):
                    return "", "file does not exist"
                return normalized_path, ""

            def write_calculated_hash_metadata(normalized_path, metadata_path, sha256):
                import os as _os

                model_dir = _os.path.abspath(_os.path.dirname(normalized_path))
                resolved_metadata_path = ""
                if metadata_path:
                    candidate_path = _os.path.abspath(_os.path.normpath(metadata_path))
                    try:
                        same_dir = _os.path.commonpath([model_dir, candidate_path]) == model_dir
                    except ValueError:
                        same_dir = False
                    if same_dir:
                        resolved_metadata_path = candidate_path

                if not resolved_metadata_path:
                    resolved_metadata_path = get_metadata_sidecar_path(normalized_path)

                metadata_updated = False
                try:
                    metadata = read_json_safe(resolved_metadata_path, {})
                    if not isinstance(metadata, dict):
                        metadata = {}

                    filename = _os.path.basename(normalized_path)
                    stem, _ext = _os.path.splitext(filename)
                    hashes = metadata.get("hashes")
                    if not isinstance(hashes, dict):
                        hashes = {}
                    hashes["SHA256"] = sha256

                    metadata["sha256"] = sha256
                    metadata["hashes"] = hashes
                    metadata["hash_status"] = "completed"
                    metadata["last_checked_at"] = time.time()
                    metadata.setdefault("file_name", stem)
                    metadata.setdefault("model_name", stem)
                    metadata.setdefault("file_path", normalized_path.replace("\\", "/"))
                    try:
                        metadata.setdefault("size", _os.path.getsize(normalized_path))
                    except Exception:
                        pass

                    write_json_atomic(resolved_metadata_path, metadata, indent=2)
                    metadata_updated = True
                    log_info(
                        f"Calculated SHA256 and updated metadata: {resolved_metadata_path}"
                    )
                except Exception as metadata_error:
                    log_warn(
                        f"Could not update metadata with calculated SHA256 for {normalized_path}: {metadata_error}"
                    )

                return resolved_metadata_path, metadata_updated

            def calculate_sha256_with_progress(normalized_path, progress_id=""):
                import hashlib
                import os as _os

                total_bytes = max(0, _os.path.getsize(normalized_path))
                bytes_read = 0
                sha256_hash = hashlib.sha256()
                last_update = 0.0
                chunk_size = 1024 * 1024 * 4

                update_hash_progress(
                    progress_id,
                    status="running",
                    stage="hashing",
                    message="Calculating SHA256...",
                    percent=0,
                    bytes_read=0,
                    total_bytes=total_bytes,
                )

                with open(normalized_path, "rb") as handle:
                    for chunk in iter(lambda: handle.read(chunk_size), b""):
                        if not chunk:
                            continue
                        sha256_hash.update(chunk)
                        bytes_read += len(chunk)
                        if is_hash_progress_cancelled(progress_id):
                            percent = 0 if total_bytes <= 0 else min(
                                98,
                                (bytes_read / total_bytes) * 98,
                            )
                            update_hash_progress(
                                progress_id,
                                status="cancelled",
                                stage="cancelled",
                                message="Hash calculation cancelled",
                                percent=percent,
                                bytes_read=bytes_read,
                                total_bytes=total_bytes,
                            )
                            raise HashCalculationCancelled()
                        now = time.time()
                        if now - last_update >= 0.15 or bytes_read >= total_bytes:
                            percent = 98 if total_bytes <= 0 else min(
                                98,
                                (bytes_read / total_bytes) * 98,
                            )
                            update_hash_progress(
                                progress_id,
                                status="running",
                                stage="hashing",
                                message="Calculating SHA256...",
                                percent=percent,
                                bytes_read=bytes_read,
                                total_bytes=total_bytes,
                            )
                            last_update = now

                return sha256_hash.hexdigest()

            @routes.post("/model_resolver/calculate-file-hash")
            @json_api_endpoint("calculate-file-hash")
            async def calculate_file_hash_route(request):
                """Calculate SHA256 for a local model and persist it to sidecar metadata."""
                data = await request.json()
                metadata_path = data.get("metadata_path") or ""

                normalized_path, error = resolve_hash_file_request(data)
                if error == "file_path is required":
                    return web.json_response(
                        {"error": "file_path is required"}, status=400
                    )
                if error:
                    return web.json_response(
                        {"error": error}, status=404
                    )

                sha256 = calculate_sha256_with_progress(normalized_path)
                if not sha256:
                    return web.json_response(
                        {"error": "could not calculate hash"}, status=500
                    )
                resolved_metadata_path, metadata_updated = write_calculated_hash_metadata(
                    normalized_path,
                    metadata_path,
                    sha256,
                )

                return web.json_response(
                    {
                        "success": True,
                        "sha256": sha256,
                        "hash": sha256,
                        "file_path": normalized_path,
                        "metadata_path": resolved_metadata_path,
                        "metadata_updated": metadata_updated,
                    }
                )

            @routes.post("/model_resolver/calculate-file-hash/start")
            @json_api_endpoint("calculate-file-hash-start")
            async def calculate_file_hash_start_route(request):
                """Start SHA256 calculation in a background thread."""
                import uuid

                data = await request.json()
                metadata_path = data.get("metadata_path") or ""
                normalized_path, error = resolve_hash_file_request(data)
                if error == "file_path is required":
                    return web.json_response(
                        {"error": "file_path is required"}, status=400
                    )
                if error:
                    return web.json_response(
                        {"error": error}, status=404
                    )

                cleanup_hash_progress()
                progress_id = f"hash_{uuid.uuid4().hex}"
                with self.hash_progress_lock:
                    self.hash_progress[progress_id] = {
                        "progress_id": progress_id,
                        "status": "queued",
                        "stage": "queued",
                        "message": "Preparing hash calculation...",
                        "percent": 0,
                        "file_path": normalized_path,
                        "created_at": time.time(),
                        "updated_at": time.time(),
                    }

                def run_hash_task():
                    try:
                        sha256 = calculate_sha256_with_progress(
                            normalized_path,
                            progress_id=progress_id,
                        )
                        if is_hash_progress_cancelled(progress_id):
                            raise HashCalculationCancelled()
                        update_hash_progress(
                            progress_id,
                            status="running",
                            stage="metadata",
                            message="Saving metadata...",
                            percent=99,
                        )
                        resolved_metadata_path, metadata_updated = write_calculated_hash_metadata(
                            normalized_path,
                            metadata_path,
                            sha256,
                        )
                        update_hash_progress(
                            progress_id,
                            status="done",
                            stage="done",
                            message="Hash calculated",
                            percent=100,
                            sha256=sha256,
                            hash=sha256,
                            file_path=normalized_path,
                            metadata_path=resolved_metadata_path,
                            metadata_updated=metadata_updated,
                        )
                    except HashCalculationCancelled:
                        update_hash_progress(
                            progress_id,
                            status="cancelled",
                            stage="cancelled",
                            message="Hash calculation cancelled",
                        )
                    except Exception as exc:
                        log_exception(f"Hash calculation failed for {normalized_path}: {exc}")
                        update_hash_progress(
                            progress_id,
                            status="error",
                            stage="error",
                            message=str(exc) or "Hash calculation failed",
                            percent=100,
                            error=str(exc) or "Hash calculation failed",
                        )

                threading.Thread(target=run_hash_task, daemon=True).start()
                return web.json_response(
                    {
                        "success": True,
                        "progress_id": progress_id,
                    }
                )

            @routes.get("/model_resolver/calculate-file-hash/progress/{progress_id}")
            @json_api_endpoint("calculate-file-hash-progress")
            async def calculate_file_hash_progress_route(request):
                """Return progress for a background SHA256 calculation."""
                progress_id = request.match_info.get("progress_id", "").strip()
                cleanup_hash_progress()
                with self.hash_progress_lock:
                    progress = dict(self.hash_progress.get(progress_id) or {})
                if not progress:
                    return web.json_response(
                        {"error": "progress not found"}, status=404
                    )
                return web.json_response(progress)

            @routes.post("/model_resolver/calculate-file-hash/cancel/{progress_id}")
            @json_api_endpoint("calculate-file-hash-cancel")
            async def calculate_file_hash_cancel_route(request):
                """Cancel a background SHA256 calculation."""
                progress_id = request.match_info.get("progress_id", "").strip()
                if not progress_id:
                    return web.json_response(
                        {"error": "progress_id is required"}, status=400
                    )
                cancelled = mark_hash_progress_cancelled(progress_id)
                return web.json_response(
                    {
                        "success": True,
                        "cancelled": cancelled,
                        "progress_id": progress_id,
                    }
                )

            @routes.get("/model_resolver/models")
            @json_api_endpoint("get_models")
            async def get_models(request):
                """Get list of all available models."""
                force_rescan = str(
                    request.query.get("force")
                    or request.query.get("force_rescan")
                    or ""
                ).lower() in {"1", "true", "yes"}
                models = get_model_files(force_rescan=force_rescan)
                return web.json_response(models)

            @routes.post("/model_resolver/loaded")
            @json_api_endpoint("get_loaded_models")
            async def get_loaded_models(request):
                """Get all currently loaded models in the workflow."""
                data = await request.json()
                workflow_json = data.get("workflow")

                if not workflow_json:
                    return web.json_response(
                        {"error": "Workflow JSON is required"}, status=400
                    )

                # Import workflow analyzer to extract models
                from .core.workflow_analyzer import (
                    analyze_workflow_models,
                    try_resolve_model_path,
                    is_model_filename,
                    URN_REGEX,
                    URN_TYPE_MAP,
                )

                # Get available models for existence checking
                available_models = get_model_files()
                available_paths = {m.get("path") for m in available_models}
                # Create lookup for full paths by filename (with and without extension)
                path_by_filename = {}
                for m in available_models:
                    rel_path = m.get("relative_path", "")
                    if rel_path:
                        filename = get_filename_from_path(rel_path)
                        path_by_filename[filename] = m.get("path")
                        # Also add without extension for matching (simple approach)
                        if "." in filename:
                            filename_no_ext = filename.rsplit(".", 1)[0]
                            if filename_no_ext not in path_by_filename:
                                path_by_filename[filename_no_ext] = m.get("path")
                        # Add the full relative path as key too
                        path_by_filename[rel_path] = m.get("path")

                # Also use folder_paths.get_full_path() to get paths
                import folder_paths

                for cat in [
                    "loras",
                    "checkpoints",
                    "vae",
                    "controlnet",
                    "upscale_models",
                ]:
                    try:
                        filenames = folder_paths.get_filename_list(cat)
                        for fn in filenames:
                            full_path = folder_paths.get_full_path(cat, fn)
                            if (
                                full_path
                                and full_path not in path_by_filename.values()
                            ):
                                path_by_filename[fn] = full_path
                                fn_no_ext = (
                                    fn.rsplit(".", 1)[0] if "." in fn else fn
                                )
                                if fn_no_ext not in path_by_filename:
                                    path_by_filename[fn_no_ext] = full_path
                    except Exception:
                        pass

                # Analyze workflow to get all model references
                all_model_refs = analyze_workflow_models(
                    workflow_json, available_models=available_models
                )

                # Also extract from node.properties.models
                nodes = list(workflow_json.get("nodes", []))
                definitions = workflow_json.get("definitions", {})
                subgraphs = definitions.get("subgraphs", [])
                for subgraph in subgraphs:
                    nodes.extend(subgraph.get("nodes", []))

                # Collect all loaded models with their values
                loaded_models = []

                # Process each model reference from analyze_workflow_models
                for ref in all_model_refs:
                    original_path = ref.get("original_path", "")
                    node_id = ref.get("node_id")
                    widget_index = ref.get("widget_index")
                    node_type = ref.get("node_type", "")
                    category = ref.get("category", "unknown")

                    # Determine model name and strength
                    model_name = get_filename_from_path(original_path)
                    strength = None

                    # For standard LoraLoader nodes, strength is in next widget_value
                    if node_type in ["LoraLoader", "LoraLoaderModelOnly"]:
                        # Find the node in workflow to get strength value
                        for node in nodes:
                            if str(node.get("id")) == str(node_id):
                                widgets_values = node.get("widgets_values", [])
                                if len(widgets_values) > widget_index + 1:
                                    try:
                                        strength = float(
                                            widgets_values[widget_index + 1]
                                        )
                                    except (ValueError, TypeError):
                                        strength = 1.0
                                break

                    if ref.get("strength") is not None:
                        strength = ref.get("strength")

                    # For text-based lora loaders (LoraLoaderV2, LoraManager), get strength from ref
                    if ref.get("is_lora_v2"):
                        strength = ref.get("strength")
                        model_name = ref.get("name", model_name)

                    # Check if model exists locally
                    exists = ref.get("exists", False)

                    # If URN, resolve to display name
                    if ref.get("is_urn"):
                        urn = ref.get("urn", {})
                        # Use model name from URN as display name
                        model_name = (
                            f"urn:{urn.get('type', 'model')}:{urn.get('model_id')}"
                        )
                        category = urn.get("type", category)
                        if category in URN_TYPE_MAP:
                            category = URN_TYPE_MAP[category]

                    loaded_models.append(
                        {
                            "name": model_name,
                            "category": category,
                            "node_id": node_id,
                            "widget_index": widget_index,
                            "node_type": node_type,
                            "exists": exists,
                            "strength": strength,
                            "original_path": original_path,
                            "is_urn": ref.get("is_urn", False),
                            "is_lora_v2": ref.get("is_lora_v2", False),
                            "active": ref.get("active"),
                            "connected": ref.get("connected", True),
                            "resolved_path": (
                                path_by_filename.get(model_name)
                                or path_by_filename.get(original_path)
                            ),
                        }
                    )

                # Also check node.properties.models for embedded models
                for node in nodes:
                    node_type = node.get("type", "")
                    properties = node.get("properties", {})
                    models_list = properties.get("models", [])

                    for model_info in models_list:
                        if isinstance(model_info, dict):
                            name = model_info.get("name", "")
                            url = model_info.get("url", "")
                            directory = model_info.get("directory", "")

                            if name:
                                # Check if this model is already in loaded_models
                                existing = next(
                                    (
                                        m
                                        for m in loaded_models
                                        if m.get("original_path") == name
                                    ),
                                    None,
                                )
                                if not existing:
                                    loaded_models.append(
                                        {
                                            "name": name.split("/")[-1].split("\\")[
                                                -1
                                            ],
                                            "category": directory or "checkpoints",
                                            "node_id": node.get("id"),
                                            "widget_index": None,
                                            "node_type": node_type,
                                            "exists": True,  # Embedded models are loaded
                                            "strength": None,
                                            "original_path": name,
                                            "is_urn": False,
                                        }
                                    )

                return web.json_response(
                    {"loaded_models": loaded_models, "total": len(loaded_models)}
                )

            # ==================== MODEL METADATA LOOKUP ROUTE ====================

            @routes.post("/model_resolver/civitai-search")
            @json_api_endpoint("civitai-search")
            async def civitai_search(request):
                """Fetch model metadata from trusted exact-match sources."""
                data = await request.json()
                filename = data.get("filename", "")
                category = data.get("category", "")
                resolved_path = data.get("resolved_path", "")
                local_only = to_bool(data.get("local_only"), False)
                force_refresh = to_bool(
                    data.get("force_refresh") or data.get("force"), False
                )
                provided_hash = (
                    data.get("sha256")
                    or data.get("hash")
                    or data.get("file_hash")
                    or ""
                )
                provided_hash = str(provided_hash or "").strip().lower()
                if not (
                    len(provided_hash) == 64
                    and all(ch in "0123456789abcdef" for ch in provided_hash)
                ):
                    provided_hash = ""
                hf_token = data.get("hf_token", "")
                brave_search_api_key = data.get("brave_search_api_key", "")
                hf_use_brave_fallback = to_bool(
                    data.get("hf_use_brave_fallback", True),
                    True,
                )

                if not filename:
                    return web.json_response(
                        {"error": "Filename is required"}, status=400
                    )

                # Clean filename for display
                import os as _os

                clean_name = _os.path.splitext(filename)[0]

                # Get the file path to hash
                file_path = resolved_path if resolved_path else None
                file_location = ""

                if not file_path and category:
                    # Try to find the file in the model directories using folder_paths
                    try:
                        import folder_paths

                        folder_type = normalize_download_category(category)
                        file_path = folder_paths.get_full_path(
                            folder_type, filename
                        )
                    except Exception:
                        pass

                    # If not found, try scanner
                    if not file_path:
                        try:
                            from .core.scanner import get_model_files

                            available_models = get_model_files()
                            for m in available_models:
                                if (
                                    m.get("relative_path", "").endswith(filename)
                                    or m.get("filename", "") == filename
                                ):
                                    file_path = m.get("path")
                                    break
                        except Exception:
                            pass

                if file_path and _os.path.exists(file_path):
                    file_location = _os.path.dirname(file_path).replace("\\", "/")
                    if file_location and not file_location.endswith("/"):
                        file_location += "/"

                def infer_model_type_from_category(value):
                    if not str(value or "").strip():
                        return ""
                    normalized = normalize_download_category(value or "")
                    type_map = {
                        "checkpoints": "checkpoint",
                        "loras": "lora",
                        "vae": "vae",
                        "text_encoders": "text_encoder",
                        "clip": "clip",
                        "clip_vision": "clip_vision",
                        "controlnet": "controlnet",
                        "upscale_models": "upscale",
                        "diffusion_models": "diffusion_model",
                    }
                    return type_map.get(normalized, normalized.rstrip("s"))

                def build_info_response(
                    result=None,
                    *,
                    metadata_path="",
                    metadata_saved=False,
                    civitai_checked=False,
                    local_payload=False,
                ):
                    result = result or {}
                    size_value = result.get("size")
                    if not size_value and file_path and _os.path.exists(file_path):
                        try:
                            size_value = _os.path.getsize(file_path)
                        except Exception:
                            size_value = None

                    model_type = (
                        result.get("model_type")
                        or result.get("type")
                        or infer_model_type_from_category(category)
                    )

                    return {
                        "filename": result.get("filename") or filename,
                        "category": category,
                        "file_path": result.get("file_path") or file_path or "",
                        "resolved_path": result.get("resolved_path") or file_path or "",
                        "metadata_path": metadata_path
                        or result.get("metadata_path")
                        or "",
                        "metadata_saved": bool(metadata_saved),
                        "location": result.get("location") or file_location,
                        "source": result.get("source") or "",
                        "details_source": result.get("details_source")
                        or result.get("source")
                        or "",
                        "url": result.get("url"),
                        "version_url": result.get("version_url"),
                        "download_url": result.get("download_url"),
                        "platform_url": result.get("platform_url"),
                        "repo_id": result.get("repo_id"),
                        "path": result.get("path"),
                        "model_id": result.get("model_id"),
                        "model_name": result.get("model_name") or clean_name,
                        "model_type": model_type,
                        "version_id": result.get("version_id"),
                        "version_name": result.get("version_name", ""),
                        "sha256": result.get("sha256") or provided_hash,
                        "size": size_value,
                        "base_model": result.get("base_model"),
                        "tags": result.get("tags", []),
                        "trained_words": result.get("trained_words", []),
                        "images": result.get("images", []),
                        "clip_skip": result.get("clip_skip"),
                        "description": result.get("description", ""),
                        "model_description": result.get("model_description", ""),
                        "from_metadata": bool(result.get("from_metadata")),
                        "local_only": bool(local_payload),
                        "metadata_checked": bool(civitai_checked),
                        "civitai_checked": bool(civitai_checked),
                    }

                def normalize_sha256_value(value):
                    text = str(value or "").strip().lower()
                    if text.startswith("sha256:"):
                        text = text.split(":", 1)[1].strip()
                    if len(text) == 64 and all(
                        ch in "0123456789abcdef" for ch in text
                    ):
                        return text
                    return ""

                def extract_result_sha256(result):
                    if not isinstance(result, dict):
                        return ""
                    for key in ("sha256", "hash"):
                        normalized = normalize_sha256_value(result.get(key))
                        if normalized:
                            return normalized
                    hashes = result.get("hashes")
                    if isinstance(hashes, dict):
                        for key in ("SHA256", "sha256", "Sha256"):
                            normalized = normalize_sha256_value(hashes.get(key))
                            if normalized:
                                return normalized
                    return ""

                def result_filename_matches(result):
                    if not isinstance(result, dict):
                        return False
                    expected = _os.path.basename(filename or "").lower()
                    candidates = [
                        result.get("filename"),
                        result.get("path"),
                        result.get("file_path"),
                    ]
                    for candidate in candidates:
                        basename = _os.path.basename(str(candidate or "")).lower()
                        if basename and basename == expected:
                            return True
                    return False

                def result_hash_matches(result, *, require_filename=False):
                    if not provided_hash or not isinstance(result, dict):
                        return False
                    result_hash = extract_result_sha256(result)
                    if result_hash != provided_hash:
                        return False
                    if require_filename and not result_filename_matches(result):
                        return False
                    return True

                def huggingface_page_url(result):
                    try:
                        from urllib.parse import quote as _quote
                    except Exception:
                        _quote = None
                    repo_id = str(
                        result.get("repo_id") or result.get("repo") or ""
                    ).strip()
                    hf_path = str(
                        result.get("path") or result.get("filename") or ""
                    ).strip()
                    if not repo_id or not hf_path:
                        return ""
                    if _quote:
                        hf_path = _quote(hf_path.replace("\\", "/"), safe="/")
                    return f"https://huggingface.co/{repo_id}/blob/main/{hf_path}"

                def prepare_remote_result(result, source_name):
                    result = dict(result or {})
                    source_name = str(source_name or result.get("source") or "").lower()
                    if source_name == "huggingface":
                        download_url = result.get("download_url") or result.get("url")
                        page_url = result.get("page_url") or huggingface_page_url(result)
                        if page_url:
                            result["url"] = page_url
                            result["version_url"] = page_url
                        result["download_url"] = download_url
                        result["model_name"] = (
                            result.get("model_name")
                            or result.get("name")
                            or result.get("repo_id")
                            or clean_name
                        )
                        result["model_type"] = (
                            result.get("model_type")
                            or infer_model_type_from_category(category)
                        )
                    else:
                        result["model_name"] = (
                            result.get("model_name")
                            or result.get("name")
                            or clean_name
                        )
                        if result.get("url") and not result.get("version_url"):
                            result["version_url"] = result.get("url")

                    result["source"] = source_name or result.get("source") or ""
                    result["details_source"] = (
                        result.get("details_source")
                        or source_name
                        or result.get("source")
                        or ""
                    )
                    result["file_path"] = file_path or result.get("file_path") or ""
                    result["resolved_path"] = (
                        file_path or result.get("resolved_path") or ""
                    )
                    result["location"] = result.get("location") or file_location
                    result["filename"] = result.get("filename") or filename
                    result["sha256"] = (
                        extract_result_sha256(result)
                        or provided_hash
                        or result.get("sha256")
                    )
                    if not result.get("size") and file_path and _os.path.exists(file_path):
                        try:
                            result["size"] = _os.path.getsize(file_path)
                        except Exception:
                            pass
                    return result

                def remote_link_is_marked_dead(item):
                    if not isinstance(item, dict):
                        return False
                    status = str(item.get("status") or "").lower()
                    return bool(
                        item.get("deletedAt")
                        or item.get("deleted_at")
                        or item.get("is_dead")
                        or item.get("isDead")
                        or item.get("likelyDead")
                        or item.get("likely_dead")
                        or item.get("dead")
                        or status in {"dead", "deleted", "unavailable", "missing"}
                    )

                def result_url_looks_like_model_file(url, expected_filename=""):
                    text = str(url or "").strip()
                    if not text.startswith(("http://", "https://")):
                        return False
                    try:
                        from urllib.parse import unquote as _unquote, urlparse as _urlparse
                        parsed = _urlparse(text)
                        host = parsed.netloc.lower()
                        path = _unquote(parsed.path or "")
                    except Exception:
                        host = ""
                        path = text
                    if host.endswith("huggingface.co") and path.startswith("/spaces/"):
                        return False
                    if (
                        host.endswith("civitai.com")
                        or host.endswith("civitai.red")
                    ) and path.startswith("/api/download/"):
                        return True

                    basename = _os.path.basename(path).lower()
                    expected = _os.path.basename(str(expected_filename or "")).lower()
                    if expected and basename == expected:
                        return True
                    model_extensions = {
                        ".safetensors",
                        ".ckpt",
                        ".pt",
                        ".pth",
                        ".bin",
                        ".gguf",
                        ".onnx",
                        ".pb",
                        ".pkl",
                        ".pickle",
                    }
                    return _os.path.splitext(basename)[1].lower() in model_extensions

                def collect_result_download_urls(result):
                    urls = []
                    if remote_link_is_marked_dead(result):
                        return urls
                    expected_filename = result.get("filename") or filename
                    dead_urls = set()
                    mirrors = result.get("mirrors") or []
                    if not isinstance(mirrors, list):
                        mirrors = [mirrors]
                    for mirror in mirrors:
                        if not isinstance(mirror, dict):
                            continue
                        if remote_link_is_marked_dead(mirror):
                            dead_url = str(mirror.get("url") or "").strip()
                            if dead_url.startswith(("http://", "https://")):
                                dead_urls.add(dead_url)
                            continue
                        url = str(mirror.get("url") or "").strip()
                        mirror_filename = (
                            mirror.get("filename")
                            or mirror.get("name")
                            or expected_filename
                        )
                        if (
                            result_url_looks_like_model_file(url, mirror_filename)
                            and url not in urls
                        ):
                            urls.append(url)
                    raw_urls = result.get("download_urls") or []
                    if not isinstance(raw_urls, list):
                        raw_urls = [raw_urls]
                    for raw_url in raw_urls:
                        url = str(raw_url or "").strip()
                        if (
                            result_url_looks_like_model_file(url, expected_filename)
                            and url not in dead_urls
                            and url not in urls
                        ):
                            urls.append(url)
                    for key in ("download_url", "downloadUrl"):
                        url = str(result.get(key) or "").strip()
                        if (
                            result_url_looks_like_model_file(url, expected_filename)
                            and url not in dead_urls
                            and url not in urls
                        ):
                            urls.append(url)
                    return urls

                def remote_download_url_is_alive(url):
                    try:
                        import requests
                    except Exception:
                        return True

                    headers = {
                        "User-Agent": "ComfyUI-Model-Resolver/1.0",
                        "Accept": "*/*",
                    }
                    try:
                        response = requests.head(
                            url,
                            headers=headers,
                            allow_redirects=True,
                            timeout=8,
                        )
                        try:
                            if response.status_code < 400:
                                return True
                            if response.status_code in {401, 403, 404, 410}:
                                return False
                        finally:
                            response.close()
                    except Exception:
                        pass

                    try:
                        response = requests.get(
                            url,
                            headers={**headers, "Range": "bytes=0-0"},
                            allow_redirects=True,
                            stream=True,
                            timeout=8,
                        )
                        try:
                            return response.status_code < 400
                        finally:
                            response.close()
                    except Exception:
                        return False

                def civarchive_result_has_live_download(result):
                    urls = collect_result_download_urls(result)
                    if not urls:
                        return False
                    for url in urls[:3]:
                        if remote_download_url_is_alive(url):
                            result["download_url"] = url
                            result["download_urls"] = [
                                url,
                                *[other for other in urls if other != url],
                            ]
                            return True
                    return False

                def save_remote_metadata(result, source_name):
                    metadata_path = result.get("metadata_path") or ""
                    metadata_saved = False
                    if (
                        result.get("from_metadata")
                        or not file_path
                        or not _os.path.exists(file_path)
                    ):
                        return metadata_path, metadata_saved
                    try:
                        metadata_payload = {
                            "source": source_name,
                            "details_source": result.get("details_source")
                            or source_name,
                            "filename": filename,
                            "category": category,
                            "model_name": result.get("model_name", clean_name),
                            "name": result.get("model_name", clean_name),
                            "model_type": result.get("model_type", "")
                            or result.get("type", ""),
                            "type": result.get("model_type", "")
                            or result.get("type", ""),
                            "model_id": result.get("model_id"),
                            "version_id": result.get("version_id"),
                            "version_name": result.get("version_name", ""),
                            "sha256": result.get("sha256") or provided_hash,
                            "size": result.get("size"),
                            "base_model": result.get("base_model"),
                            "tags": result.get("tags", []),
                            "trained_words": result.get("trained_words", []),
                            "images": result.get("images", []),
                            "clip_skip": result.get("clip_skip"),
                            "description": result.get("description", ""),
                            "model_description": result.get("model_description", ""),
                            "download_url": result.get("download_url"),
                            "source_url": result.get("version_url") or result.get("url"),
                            "version_url": result.get("version_url") or result.get("url"),
                            "model_url": result.get("url"),
                            "url": result.get("version_url") or result.get("url"),
                            "platform_url": result.get("platform_url"),
                            "repo_id": result.get("repo_id"),
                            "path": result.get("path"),
                            "path_metadata": {
                                "filename": filename,
                                "category": category,
                                "source": source_name,
                                "model_id": result.get("model_id"),
                                "version_id": result.get("version_id"),
                                "repo_id": result.get("repo_id"),
                                "path": result.get("path"),
                            },
                        }
                        metadata_path = write_lora_manager_metadata(
                            file_path,
                            metadata_payload,
                            category,
                            result.get("version_url")
                            or result.get("url")
                            or result.get("platform_url")
                            or result.get("download_url")
                            or "",
                        ) or ""
                        metadata_saved = bool(metadata_path)
                        if metadata_path:
                            result["metadata_path"] = metadata_path
                    except Exception as metadata_error:
                        self.logger.warning(
                            f"{source_name} metadata sidecar save failed: {metadata_error}"
                        )
                    return metadata_path, metadata_saved

                if local_only:
                    result = None
                    metadata_path = ""
                    metadata_saved = False
                    if download_available and file_path and _os.path.exists(file_path):
                        try:
                            from .core.sources.civitai import (
                                get_model_info_for_file,
                            )

                            result = get_model_info_for_file(
                                file_path,
                                local_only=True,
                            )
                            source_metadata_path = (
                                result.get("metadata_path")
                                if isinstance(result, dict)
                                else ""
                            )
                            canonical_metadata_path = get_metadata_sidecar_path(file_path)
                            if (
                                isinstance(result, dict)
                                and result.get("from_metadata")
                                and source_metadata_path
                                and canonical_metadata_path
                                and _os.path.abspath(source_metadata_path)
                                != _os.path.abspath(canonical_metadata_path)
                                and not _os.path.exists(canonical_metadata_path)
                            ):
                                preview_url = result.get("preview_url") or ""
                                if not preview_url:
                                    model_base_path, _model_ext = _os.path.splitext(file_path)
                                    for preview_ext in (
                                        ".preview.png",
                                        ".preview.jpg",
                                        ".preview.jpeg",
                                        ".preview.webp",
                                    ):
                                        preview_path = f"{model_base_path}{preview_ext}"
                                        if _os.path.exists(preview_path):
                                            preview_url = preview_path.replace("\\", "/")
                                            break
                                metadata_payload = {
                                    "source": "metadata_import",
                                    "details_source": result.get("source") or "metadata",
                                    "filename": filename,
                                    "category": category,
                                    "model_name": result.get("model_name", clean_name),
                                    "name": result.get("model_name", clean_name),
                                    "model_type": result.get("model_type", ""),
                                    "type": result.get("model_type", ""),
                                    "model_id": result.get("model_id"),
                                    "version_id": result.get("version_id"),
                                    "version_name": result.get("version_name", ""),
                                    "sha256": result.get("sha256"),
                                    "size": result.get("size"),
                                    "base_model": result.get("base_model"),
                                    "tags": result.get("tags", []),
                                    "trained_words": result.get("trained_words", []),
                                    "images": result.get("images", []),
                                    "clip_skip": result.get("clip_skip"),
                                    "description": result.get("description", ""),
                                    "model_description": result.get("model_description", ""),
                                    "download_url": result.get("download_url"),
                                    "preview_url": preview_url,
                                    "source_url": result.get("version_url")
                                    or result.get("url"),
                                    "version_url": result.get("version_url")
                                    or result.get("url"),
                                    "model_url": result.get("url"),
                                    "url": result.get("version_url") or result.get("url"),
                                    "path_metadata": {
                                        "filename": filename,
                                        "category": category,
                                        "source": "metadata_import",
                                        "model_id": result.get("model_id"),
                                        "version_id": result.get("version_id"),
                                        "imported_from": source_metadata_path,
                                    },
                                }
                                metadata_path = write_lora_manager_metadata(
                                    file_path,
                                    metadata_payload,
                                    category,
                                    result.get("version_url")
                                    or result.get("url")
                                    or result.get("download_url")
                                    or "",
                                ) or ""
                                metadata_saved = bool(metadata_path)
                                if metadata_path:
                                    result["metadata_path"] = metadata_path
                                    result["metadata_imported_from"] = source_metadata_path
                        except Exception as e:
                            self.logger.warning(f"Local model info error: {e}")
                    return web.json_response(
                        build_info_response(
                            result,
                            metadata_path=metadata_path,
                            metadata_saved=metadata_saved,
                            local_payload=True,
                            civitai_checked=False,
                        )
                    )

                # Search remote metadata. CivitAI and CivArchive are hash-only;
                # HuggingFace name results must still confirm the exact SHA.
                if download_available and file_path and _os.path.exists(file_path):
                    try:
                        from .core.sources.civitai import (
                            get_model_info_by_hash,
                            get_model_info_for_file,
                        )

                        if provided_hash:
                            result = get_model_info_by_hash(
                                provided_hash,
                                use_cache=not force_refresh,
                            )
                            if result:
                                result["file_path"] = file_path
                                result["resolved_path"] = file_path
                                result["location"] = file_location
                                if not result.get("size"):
                                    try:
                                        result["size"] = _os.path.getsize(file_path)
                                    except Exception:
                                        pass
                                if not extract_result_sha256(result):
                                    result["sha256"] = provided_hash
                        elif not force_refresh:
                            result = get_model_info_for_file(file_path)
                        else:
                            result = None

                        if result and (
                            result.get("url")
                            or result.get("version_url")
                            or result.get("from_metadata")
                            or result.get("trained_words")
                        ) and (
                            result.get("from_metadata")
                            or not provided_hash
                            or result_hash_matches(result)
                        ):
                            result = prepare_remote_result(result, "civitai")
                            metadata_path, metadata_saved = save_remote_metadata(
                                result,
                                "civitai",
                            )

                            return web.json_response(
                                build_info_response(
                                    result,
                                    metadata_path=metadata_path,
                                    metadata_saved=metadata_saved,
                                    civitai_checked=True,
                                )
                            )
                    except Exception as e:
                        self.logger.warning(f"CivitAI search error: {e}")

                    if provided_hash:
                        try:
                            result = resolve_civarchive_by_hash(
                                provided_hash,
                                query=filename,
                                exact_only=False,
                                model_type=infer_model_type_from_category(category),
                            )
                            if result:
                                if not extract_result_sha256(result):
                                    result["sha256"] = provided_hash
                                result = prepare_remote_result(result, "civarchive")
                                if result_hash_matches(result) and civarchive_result_has_live_download(result):
                                    metadata_path, metadata_saved = save_remote_metadata(
                                        result,
                                        "civarchive",
                                    )
                                    return web.json_response(
                                        build_info_response(
                                            result,
                                            metadata_path=metadata_path,
                                            metadata_saved=metadata_saved,
                                            civitai_checked=True,
                                        )
                                    )
                                if result_hash_matches(result):
                                    self.logger.info(
                                        f"CivArchive metadata candidate rejected: "
                                        f"no live download link for {filename}"
                                    )
                        except Exception as e:
                            self.logger.warning(f"CivArchive hash lookup error: {e}")

                    if provided_hash:
                        hf_attempts = [
                            {
                                "label": "HuggingFace",
                                "use_api_search": True,
                                "use_comfy_org_fallback": True,
                                "use_brave_fallback": False,
                            }
                        ]
                        if hf_use_brave_fallback and brave_search_api_key:
                            hf_attempts.append(
                                {
                                    "label": "HuggingFace Brave",
                                    "use_api_search": False,
                                    "use_comfy_org_fallback": False,
                                    "use_brave_fallback": True,
                                }
                            )

                        for hf_attempt in hf_attempts:
                            try:
                                result = search_huggingface_for_file(
                                    filename,
                                    token=hf_token or None,
                                    exact_only=True,
                                    brave_api_key=brave_search_api_key or None,
                                    use_api_search=hf_attempt["use_api_search"],
                                    use_comfy_org_fallback=hf_attempt[
                                        "use_comfy_org_fallback"
                                    ],
                                    use_brave_fallback=hf_attempt[
                                        "use_brave_fallback"
                                    ],
                                    force_refresh=force_refresh,
                                )
                                if result and result_hash_matches(
                                    result,
                                    require_filename=True,
                                ):
                                    result = prepare_remote_result(
                                        result,
                                        "huggingface",
                                    )
                                    metadata_path, metadata_saved = save_remote_metadata(
                                        result,
                                        "huggingface",
                                    )
                                    return web.json_response(
                                        build_info_response(
                                            result,
                                            metadata_path=metadata_path,
                                            metadata_saved=metadata_saved,
                                            civitai_checked=True,
                                        )
                                )
                                if result:
                                    self.logger.info(
                                        f"{hf_attempt['label']} metadata candidate rejected: "
                                        f"filename/hash mismatch for {filename}"
                                    )
                            except Exception as e:
                                self.logger.warning(
                                    f"{hf_attempt['label']} metadata lookup error: {e}"
                                )

                # No result found
                response = build_info_response(None, civitai_checked=True)
                response["url"] = None
                if force_refresh and file_path and _os.path.exists(file_path):
                    try:
                        metadata_payload = {
                            "filename": filename,
                            "category": category,
                            "model_name": clean_name,
                            "name": clean_name,
                            "model_type": infer_model_type_from_category(category),
                            "sha256": provided_hash,
                            "size": _os.path.getsize(file_path),
                            "civitai_deleted": True,
                            "civitai_checked": True,
                            "remote_metadata_missing": True,
                            "source": "local",
                            "details_source": "",
                        }
                        metadata_path = write_lora_manager_metadata(
                            file_path,
                            metadata_payload,
                            category,
                            "",
                        ) or ""
                        response["metadata_path"] = metadata_path
                        response["metadata_saved"] = bool(metadata_path)
                    except Exception as metadata_error:
                        self.logger.warning(
                            f"Remote metadata no-match sidecar save failed: {metadata_error}"
                        )
                return web.json_response(response)

            @routes.post("/model_resolver/model-details")
            @json_api_endpoint("model-details")
            async def model_details(request):
                """Return normalized full model details for sources that expose model pages."""
                data = await request.json()
                source = str(data.get("source", "")).strip().lower()
                model_id = data.get("model_id")
                version_id = data.get("version_id")
                civitai_key = data.get("civitai_key", "")

                if not download_available:
                    return web.json_response(
                        {"error": "Download providers are not available"}, status=503
                    )

                try:
                    model_id = (
                        int(model_id)
                        if model_id is not None and str(model_id).strip()
                        else None
                    )
                except (TypeError, ValueError):
                    model_id = None

                try:
                    version_id = (
                        int(version_id)
                        if version_id is not None and str(version_id).strip()
                        else None
                    )
                except (TypeError, ValueError):
                    version_id = None

                if source == "lora_manager_archive":
                    source = "civitai"

                if source not in {"civitai", "civarchive"}:
                    return web.json_response(
                        {"error": "Unsupported model details source"}, status=400
                    )
                if not model_id:
                    return web.json_response(
                        {"error": "model_id is required"}, status=400
                    )

                if source == "civitai":
                    details = await asyncio.to_thread(
                        get_civitai_model_details,
                        model_id,
                        version_id,
                        civitai_key or None,
                    )
                else:
                    details = await asyncio.to_thread(
                        get_civarchive_model_details,
                        model_id,
                        version_id,
                    )

                if not details:
                    return web.json_response(
                        {"error": "Model details not found"}, status=404
                    )

                return web.json_response(details)

            # ==================== DOWNLOAD ROUTES ====================

            if download_available:

                from .core.path_utils import (
                    get_path_abs as get_local_path_abs,
                    get_path_key as get_local_path_key,
                    get_path_identity as get_local_path_identity,
                    get_comfy_root_path,
                    is_path_within as is_local_path_within,
                    prefer_local_base_directory,
                    dedupe_local_base_directories,
                )

                def cleanup_search_progress(max_age_seconds=300):
                    now = time.time()
                    with self.search_progress_lock:
                        expired = [
                            progress_id
                            for progress_id, progress in self.search_progress.items()
                            if now - progress.get(
                                "updated_at", progress.get("created_at", now)
                            )
                            > max_age_seconds
                        ]
                        for progress_id in expired:
                            self.search_progress.pop(progress_id, None)
                        self.cancelled_search_progress.difference_update(expired)

                def is_search_progress_cancelled(progress_id):
                    if not progress_id:
                        return False
                    with self.search_progress_lock:
                        return progress_id in self.cancelled_search_progress

                def mark_search_progress_cancelled(progress_id, source=""):
                    if not progress_id:
                        return False
                    cleanup_search_progress()
                    now = time.time()
                    with self.search_progress_lock:
                        current = self.search_progress.get(progress_id, {})
                        self.cancelled_search_progress.add(progress_id)
                        self.search_progress[progress_id] = {
                            **current,
                            "progress_id": progress_id,
                            "source": source or current.get("source", ""),
                            "stage": "cancelled",
                            "message": "Cancelled",
                            "status": "cancelled",
                            "percent": 100,
                            "cancelled": True,
                            "updated_at": now,
                            "created_at": current.get("created_at", now),
                        }
                    return True

                def update_search_progress(
                    progress_id,
                    source="",
                    stage="running",
                    message="Searching...",
                    percent=None,
                    status="running",
                    **extra,
                ):
                    if not progress_id:
                        return
                    cleanup_search_progress()
                    now = time.time()
                    with self.search_progress_lock:
                        current = self.search_progress.get(progress_id, {})
                        if (
                            progress_id in self.cancelled_search_progress
                            and status != "cancelled"
                        ):
                            self.search_progress[progress_id] = {
                                **current,
                                "progress_id": progress_id,
                                "source": source or current.get("source", ""),
                                "stage": "cancelled",
                                "message": "Cancelled",
                                "status": "cancelled",
                                "percent": 100,
                                "cancelled": True,
                                "updated_at": now,
                                "created_at": current.get("created_at", now),
                            }
                            return
                        payload = {
                            **current,
                            "progress_id": progress_id,
                            "source": source or current.get("source", ""),
                            "stage": stage,
                            "message": message,
                            "status": status,
                            "updated_at": now,
                            "created_at": current.get("created_at", now),
                        }
                        if percent is not None:
                            try:
                                payload["percent"] = max(0, min(100, float(percent)))
                            except (TypeError, ValueError):
                                pass
                        payload.update(extra)
                        self.search_progress[progress_id] = payload

                @routes.get("/model_resolver/search-progress/{progress_id}")
                @json_api_endpoint("search-progress")
                async def get_search_progress_route(request):
                    """Return live progress for an in-flight source search."""
                    progress_id = request.match_info.get("progress_id", "")
                    cleanup_search_progress()
                    with self.search_progress_lock:
                        progress = dict(self.search_progress.get(progress_id) or {})
                    if not progress:
                        return web.json_response({"exists": False})
                    return web.json_response({"exists": True, **progress})

                @routes.post("/model_resolver/search-cancel/{progress_id}")
                @json_api_endpoint("search-cancel", return_success_on_error=True)
                async def cancel_search_progress_route(request):
                    """Mark an in-flight source search as cancelled."""
                    progress_id = request.match_info.get("progress_id", "").strip()
                    if not progress_id:
                        return web.json_response(
                            {"error": "Progress ID is required"}, status=400
                        )
                    marked = mark_search_progress_cancelled(progress_id)
                    return web.json_response(
                        {"success": True, "cancelled": marked, "progress_id": progress_id}
                    )

                @routes.post("/model_resolver/search")
                async def search_sources(request):
                    """Search for model download sources."""
                    try:
                        class SearchCancelled(BaseException):
                            # Progress helpers swallow ordinary callback errors; cancellation
                            # must bubble out of source loops and stop follow-up requests.
                            pass

                        def raise_if_search_cancelled(source=""):
                            if is_search_progress_cancelled(progress_id):
                                raise SearchCancelled("Search cancelled")

                        def format_log_value(value):
                            if value is None or value == "":
                                return None
                            if isinstance(value, bool):
                                return "yes" if value else "no"
                            if isinstance(value, (list, tuple, set)):
                                return ",".join(str(item) for item in value)

                            text = str(value)
                            if any(char.isspace() for char in text):
                                return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
                            return text

                        def format_log_size(value):
                            if value is None or value == "":
                                return None
                            if isinstance(value, str):
                                return value
                            try:
                                size = float(value)
                            except (TypeError, ValueError):
                                return str(value)

                            units = ("B", "KB", "MB", "GB", "TB")
                            unit_index = 0
                            while size >= 1024 and unit_index < len(units) - 1:
                                size /= 1024
                                unit_index += 1
                            return f"{size:.1f}{units[unit_index]}"

                        def format_log_fields(**fields):
                            parts = []
                            for key, value in fields.items():
                                formatted = format_log_value(value)
                                if formatted is not None:
                                    parts.append(f"{key}={formatted}")
                            return " ".join(parts)

                        def normalize_result_extra(extra):
                            if not extra:
                                return {}
                            normalized = dict(extra)
                            model_id = normalized.pop("model_id", None)
                            version_id = normalized.pop("version_id", None)
                            if model_id or version_id:
                                normalized["ids"] = (
                                    f"{model_id}@{version_id}"
                                    if model_id and version_id
                                    else model_id or version_id
                                )
                            if "files_count" in normalized:
                                normalized["files"] = normalized.pop("files_count")
                            return normalized

                        def format_result_details(result, extra=None):
                            if isinstance(result, list):
                                return format_log_fields(count=len(result))
                            if not isinstance(result, dict):
                                fields = {"result": "none" if result is None else result}
                                fields.update(normalize_result_extra(extra))
                                return format_log_fields(**fields)

                            model_id = result.get("model_id")
                            version_id = result.get("version_id")
                            ids = (
                                f"{model_id}@{version_id}"
                                if model_id and version_id
                                else model_id or version_id
                            )
                            fields = {
                                "name": result.get("name"),
                                "file": result.get("filename") or result.get("path"),
                                "match": result.get("match_type"),
                                "repo": result.get("repo_id") or result.get("repo"),
                                "ids": ids,
                                "size": format_log_size(result.get("size")),
                                "files": result.get("files_count"),
                            }
                            fields.update(normalize_result_extra(extra))
                            return format_log_fields(**fields)

                        def log_search_result(source_name, result, extra=None):
                            details = format_result_details(result, extra)
                            if result and (
                                not isinstance(result, list) or len(result) > 0
                            ):
                                log_info(f"Search [{source_name}] found {details}")
                            else:
                                log_info(f"Search [{source_name}] miss {details}")

                        data = await request.json()
                        filename = data.get("filename", "")
                        category = data.get("category", "")
                        base_model_context = data.get("base_model_context", "")
                        progress_id = str(data.get("progress_id") or "").strip()
                        progress_source = str(data.get("progress_source") or "").strip()
                        civitai_candidate_limit = to_int(data.get("civitai_candidate_limit"), 5)
                        civitai_candidate_limit = max(
                            1, min(civitai_candidate_limit, 20)
                        )
                        civarchive_candidate_limit = to_int(data.get("civarchive_candidate_limit"), 10)
                        civarchive_candidate_limit = max(
                            1, min(civarchive_candidate_limit, 30)
                        )
                        # Handle both boolean and string forms
                        is_urn_raw = data.get("is_urn", False)
                        civitai_session_token = data.get("civitai_session_token", "")
                        hf_token = data.get("hf_token", "")
                        brave_search_api_key = data.get("brave_search_api_key", "")
                        civitai_use_trpc_search = data.get(
                            "civitai_use_trpc_search", True
                        )
                        civitai_use_html_fallback = data.get(
                            "civitai_use_html_fallback", True
                        )
                        hf_use_api_search = data.get("hf_use_api_search", True)
                        hf_use_comfy_org_fallback = data.get(
                            "hf_use_comfy_org_fallback", True
                        )
                        hf_use_brave_fallback = data.get(
                            "hf_use_brave_fallback", True
                        )
                        is_urn = to_bool(is_urn_raw, False)
                        hf_use_api_search = to_bool(hf_use_api_search, True)
                        civitai_use_trpc_search = to_bool(civitai_use_trpc_search, True)
                        civitai_use_html_fallback = to_bool(civitai_use_html_fallback, True)
                        hf_use_comfy_org_fallback = to_bool(hf_use_comfy_org_fallback, True)
                        hf_use_brave_fallback = to_bool(hf_use_brave_fallback, True)

                        # For URN-only requests, model_id and version_id are required instead of filename
                        model_id = data.get("model_id")
                        version_id = data.get("version_id")
                        if not filename and not (is_urn and model_id and version_id):
                            return web.json_response(
                                {
                                    "error": "Filename is required for non-URN, or model_id+version_id for URN"
                                },
                                status=400,
                            )

                        raw_sources = data.get("sources", ["all"])
                        if isinstance(raw_sources, str):
                            raw_sources = [raw_sources]
                        elif not isinstance(raw_sources, list):
                            raw_sources = ["all"]

                        normalized_sources = {
                            str(source).strip().lower()
                            for source in raw_sources
                            if str(source).strip()
                        }
                        if not normalized_sources:
                            normalized_sources = {"all"}

                        if "all" in normalized_sources:
                            normalized_sources = {
                                "local",
                                "huggingface",
                                "civitai",
                                "civarchive",
                                "lora_manager_archive",
                            }

                        search_local = "local" in normalized_sources
                        search_huggingface_source = "huggingface" in normalized_sources
                        search_civitai_source = "civitai" in normalized_sources
                        search_civarchive_source = "civarchive" in normalized_sources
                        search_lora_manager_archive_source = (
                            "lora_manager_archive" in normalized_sources
                        )
                        if not progress_source:
                            progress_source = (
                                next(iter(normalized_sources))
                                if len(normalized_sources) == 1
                                else "all"
                            )
                        force_search = to_bool(data.get("force_search"), False)

                        update_search_progress(
                            progress_id,
                            progress_source,
                            "starting",
                            "Preparing search",
                            8,
                        )
                        raise_if_search_cancelled(progress_source)

                        if force_search:
                            update_search_progress(
                                progress_id,
                                progress_source,
                                "cache",
                                "Refreshing search caches",
                                12,
                            )
                            if search_local:
                                reload_popular_databases()
                                reload_model_list()
                            if search_huggingface_source:
                                clear_huggingface_search_cache()
                            if search_civitai_source:
                                clear_civitai_search_cache()
                            if search_civarchive_source:
                                clear_civarchive_search_cache()
                            if search_lora_manager_archive_source:
                                clear_lora_manager_archive_search_cache()
                            log_debug(
                                "Force search enabled: cleared cache "
                                + format_log_fields(sources=sorted(normalized_sources))
                            )
                        raise_if_search_cancelled(progress_source)

                        log_info(
                            f"Search [{','.join(sorted(normalized_sources))}] request "
                            + format_log_fields(
                                file=filename,
                                cat=category,
                                urn=is_urn,
                                ids=(
                                    f"{data.get('model_id')}@{data.get('version_id')}"
                                    if data.get("model_id") and data.get("version_id")
                                    else data.get("model_id")
                                    or data.get("version_id")
                                ),
                                base=base_model_context,
                                force=force_search,
                            )
                        )

                        results = {
                            "popular": None,
                            "model_list": None,
                            "huggingface": None,
                            "civitai": None,
                            "civarchive": None,
                            "lora_manager_archive": None,
                            "local_hash_matches": [],
                            "found": False,
                            "searched_sources": sorted(normalized_sources),
                            "source_errors": {},
                        }

                        def current_search_timestamp():
                            from datetime import datetime, timezone

                            return (
                                datetime.now(timezone.utc)
                                .replace(microsecond=0)
                                .isoformat()
                            )

                        def get_search_result_signature(source_key, result):
                            if isinstance(result, list):
                                return "|".join(
                                    get_search_result_signature(source_key, item)
                                    for item in result
                                )
                            if not isinstance(result, dict):
                                return ""

                            parts = [
                                source_key,
                                result.get("download_url")
                                or result.get("url")
                                or result.get("model_url")
                                or "",
                                result.get("filename") or result.get("path") or "",
                                result.get("repo_id") or result.get("repo") or "",
                                result.get("model_id") or "",
                                result.get("version_id") or "",
                                result.get("name") or "",
                            ]
                            return "::".join(str(part).strip() for part in parts)

                        def stamp_search_result(source_key, result):
                            if isinstance(result, list):
                                return [
                                    stamp_search_result(source_key, item)
                                    for item in result
                                ]
                            if not isinstance(result, dict):
                                return result

                            signature = get_search_result_signature(source_key, result)
                            if not signature:
                                return result

                            timestamp = (
                                result.get("searched_at")
                                or result.get("searchedAt")
                                or (
                                    None
                                    if force_search
                                    else self.search_result_timestamps.get(signature)
                                )
                            )
                            if not timestamp:
                                timestamp = current_search_timestamp()
                            if force_search:
                                self.search_result_timestamps[signature] = timestamp
                            else:
                                self.search_result_timestamps.setdefault(
                                    signature, timestamp
                                )
                            result["searched_at"] = timestamp
                            return result

                        def stamp_search_results(payload):
                            for source_key in (
                                "popular",
                                "model_list",
                                "huggingface",
                                "civitai",
                                "civarchive",
                                "lora_manager_archive",
                            ):
                                if payload.get(source_key):
                                    payload[source_key] = stamp_search_result(
                                        source_key, payload[source_key]
                                    )
                            return payload

                        def mark_any_model_fallback(result):
                            if isinstance(result, list):
                                return [
                                    mark_any_model_fallback(item)
                                    for item in result
                                ]
                            if not isinstance(result, dict):
                                return result

                            marked = dict(result)
                            marked["any_model_match"] = True
                            marked["base_model_fallback"] = True
                            marked["requested_base_model"] = base_model_context
                            return marked

                        def iter_result_items(result):
                            if isinstance(result, list):
                                for item in result:
                                    if isinstance(item, dict):
                                        yield item
                            elif isinstance(result, dict):
                                yield result

                        def get_result_sha256(result):
                            if not isinstance(result, dict):
                                return ""
                            hashes = (
                                result.get("hashes")
                                if isinstance(result.get("hashes"), dict)
                                else {}
                            )
                            file_info = (
                                result.get("file_info")
                                if isinstance(result.get("file_info"), dict)
                                else {}
                            )
                            file_hashes = (
                                file_info.get("hashes")
                                if isinstance(file_info.get("hashes"), dict)
                                else {}
                            )
                            for candidate in (
                                result.get("sha256"),
                                result.get("hash"),
                                hashes.get("SHA256"),
                                hashes.get("sha256"),
                                file_info.get("sha256"),
                                file_info.get("hash"),
                                file_hashes.get("SHA256"),
                                file_hashes.get("sha256"),
                            ):
                                normalized = normalize_sha256(candidate)
                                if normalized:
                                    return normalized
                            return ""

                        def is_hash_lookup_candidate(result):
                            if not isinstance(result, dict):
                                return False
                            try:
                                confidence = float(result.get("confidence") or 0)
                            except (TypeError, ValueError):
                                confidence = 0.0
                            if confidence >= 100.0:
                                return True
                            match_type = str(result.get("match_type") or "").lower()
                            if match_type in {"exact", "model_title", "title"}:
                                return True
                            return confidence >= 95.0

                        def collect_local_hash_matches(payload):
                            matches = []
                            seen_match_paths = set()
                            seen_hash_sources = set()
                            for source_key in ("huggingface", "civitai", "civarchive"):
                                for source_result in iter_result_items(payload.get(source_key)):
                                    raise_if_search_cancelled(source_key)
                                    if not is_hash_lookup_candidate(source_result):
                                        continue
                                    sha256 = get_result_sha256(source_result)
                                    if not sha256:
                                        continue

                                    hash_source_key = (source_key, sha256)
                                    if hash_source_key in seen_hash_sources:
                                        continue
                                    seen_hash_sources.add(hash_source_key)

                                    update_search_progress(
                                        progress_id,
                                        progress_source,
                                        "local_hash",
                                        "Checking local metadata hashes",
                                        94,
                                    )
                                    try:
                                        hash_matches = search_local_matches_by_hash(
                                            sha256,
                                            category=category or None,
                                            max_matches=20,
                                            force_rescan=force_search,
                                        )
                                    except Exception as hash_error:
                                        log_warn(
                                            f"Local metadata hash lookup failed for {source_key}:{sha256}: {hash_error}"
                                        )
                                        continue

                                    for match in hash_matches:
                                        model_path = (
                                            match.get("model", {}).get("path")
                                            or match.get("path")
                                            or ""
                                        )
                                        path_key = model_path.lower()
                                        if path_key and path_key in seen_match_paths:
                                            continue
                                        if path_key:
                                            seen_match_paths.add(path_key)
                                        enriched = {
                                            **match,
                                            "hash_lookup_source": source_key,
                                            "hash_lookup_filename": source_result.get("filename")
                                            or source_result.get("path")
                                            or filename,
                                        }
                                        matches.append(enriched)

                            if matches:
                                log_info(
                                    "Search local hash matches "
                                    + format_log_fields(count=len(matches))
                                )
                            return matches

                        def make_source_progress_callback(
                            source_key,
                            percent_min=None,
                            percent_max=None,
                        ):
                            def source_progress_callback(payload):
                                raise_if_search_cancelled(source_key)
                                if not isinstance(payload, dict):
                                    return

                                progress_payload = dict(payload)
                                stage = progress_payload.pop("stage", "running")
                                message = progress_payload.pop(
                                    "message", "Searching..."
                                )
                                percent = progress_payload.pop("percent", None)
                                status = progress_payload.pop("status", "running")
                                progress_payload.pop("source", None)

                                if (
                                    percent is not None
                                    and percent_min is not None
                                    and percent_max is not None
                                ):
                                    try:
                                        normalized_percent = max(
                                            0.0, min(100.0, float(percent))
                                        )
                                        percent = percent_min + (
                                            normalized_percent / 100.0
                                        ) * (percent_max - percent_min)
                                    except (TypeError, ValueError):
                                        percent = None

                                update_search_progress(
                                    progress_id,
                                    source_key,
                                    stage,
                                    message,
                                    percent,
                                    status=status,
                                    **progress_payload,
                                )

                            return source_progress_callback

                        def run_source_search(
                            source_key,
                            search_task_fn,
                            initial_stage="query",
                            initial_message=None,
                            initial_percent=30,
                            log_start_fields=None,
                            error_handlers=None,
                        ):
                            if initial_message is None:
                                initial_message = f"Querying {source_key.capitalize()}"
                            raise_if_search_cancelled(source_key)
                            update_search_progress(
                                progress_id,
                                source_key,
                                initial_stage,
                                initial_message,
                                initial_percent,
                            )
                            start_fields = log_start_fields or {"file": filename}
                            log_info(
                                f"Search [{source_key}] start "
                                + format_log_fields(**start_fields)
                            )
                            try:
                                raise_if_search_cancelled(source_key)
                                source_results, source_found = search_task_fn()
                                raise_if_search_cancelled(source_key)
                                done_messages = {
                                    "local": "Local database checked",
                                    "huggingface": "HuggingFace checked",
                                    "civitai": "CivitAI checked",
                                    "civarchive": "CivArchive checked",
                                    "lora_manager_archive": "LoRA Manager archive checked",
                                }
                                done_msg = done_messages.get(source_key, f"{source_key} checked")
                                update_search_progress(
                                    progress_id,
                                    source_key,
                                    "done",
                                    done_msg,
                                    92,
                                )
                                return source_results, source_found
                            except Exception as e:
                                if error_handlers:
                                    for exc_type, handler_fn in error_handlers.items():
                                        if isinstance(e, exc_type):
                                            return handler_fn(e)
                                raise e

                        def execute_search_with_fallback(
                            source_key,
                            search_fn,
                            any_model_label,
                        ):
                            raise_if_search_cancelled(source_key)
                            res = search_fn(
                                base_model_context or None,
                                make_source_progress_callback(source_key),
                            )
                            raise_if_search_cancelled(source_key)
                            log_search_result(source_key, res)

                            if not res and base_model_context:
                                raise_if_search_cancelled(source_key)
                                update_search_progress(
                                    progress_id,
                                    source_key,
                                    "any_model",
                                    f"Retrying {any_model_label} any model",
                                    72,
                                )
                                log_info(
                                    f"Search [{source_key}] retry any model "
                                    + format_log_fields(
                                        file=filename,
                                        cat=category,
                                        base=base_model_context,
                                    )
                                )
                                res = search_fn(
                                    None,
                                    make_source_progress_callback(source_key, 72, 92),
                                )
                                raise_if_search_cancelled(source_key)
                                log_search_result(f"{source_key}/any_model", res)
                                if res:
                                    res = mark_any_model_fallback(res)
                            return res

                        def search_local_sources():
                            def task():
                                source_results = {"popular": None, "model_list": None}
                                source_found = False

                                popular_info = get_popular_model_url(filename)
                                log_search_result("popular", popular_info)
                                update_search_progress(
                                    progress_id,
                                    "local",
                                    "model_list",
                                    "Checking local model database",
                                    58,
                                )
                                model_list_result = search_model_list(filename)
                                log_search_result(
                                    "model_list",
                                    model_list_result,
                                    {
                                        "confidence": model_list_result.get("confidence")
                                        if model_list_result
                                        else None
                                    },
                                )
                                if popular_info:
                                    popular_result = {
                                        "source": "popular",
                                        "filename": filename,
                                        **popular_info,
                                    }
                                    if (
                                        model_list_result
                                        and model_list_result.get("filename", "").lower()
                                        == filename.lower()
                                        and model_list_result.get("size")
                                    ):
                                        popular_result["size"] = model_list_result.get(
                                            "size"
                                        )
                                    source_results["popular"] = popular_result
                                    source_found = True

                                if model_list_result:
                                    confidence = model_list_result.get("confidence", 0)
                                    if is_urn and confidence >= 70:
                                        source_results["model_list"] = model_list_result
                                        source_found = True
                                    elif not is_urn:
                                        source_results["model_list"] = model_list_result
                                        source_found = True

                                return source_results, source_found

                            return run_source_search(
                                "local",
                                task,
                                initial_stage="popular",
                                initial_message="Checking popular models",
                                initial_percent=28,
                                log_start_fields={"file": filename, "cat": category},
                            )

                        def search_huggingface_source_task():
                            def task():
                                hf_result = search_huggingface_for_file(
                                    filename,
                                    token=hf_token or None,
                                    brave_api_key=brave_search_api_key or None,
                                    use_api_search=hf_use_api_search,
                                    use_comfy_org_fallback=hf_use_comfy_org_fallback,
                                    use_brave_fallback=hf_use_brave_fallback,
                                    force_refresh=force_search,
                                    progress_callback=make_source_progress_callback(
                                        "huggingface"
                                    ),
                                )
                                log_search_result("huggingface", hf_result)
                                return {"huggingface": hf_result}, bool(hf_result)

                            return run_source_search(
                                "huggingface",
                                task,
                                initial_stage="query",
                                initial_message="Querying HuggingFace",
                                initial_percent=32,
                                log_start_fields={"file": filename},
                            )

                        def search_civitai_source_task():
                            def task():
                                source_results = {"civitai": None}
                                source_found = False

                                if is_urn:
                                    model_id_val = data.get("model_id")
                                    version_id_val = data.get("version_id")

                                    if model_id_val and version_id_val:
                                        update_search_progress(
                                            progress_id,
                                            "civitai",
                                            "urn",
                                            "Resolving CivitAI URN",
                                            46,
                                        )
                                        model_info = resolve_urn(model_id_val, version_id_val)
                                        if model_info:
                                            update_search_progress(
                                                progress_id,
                                                "civitai",
                                                "file",
                                                "Selecting CivitAI file",
                                                76,
                                            )
                                            primary_file = None
                                            for file_info in model_info.get("files", []):
                                                if (
                                                    file_info.get("name")
                                                    == model_info.get("expected_filename")
                                                ):
                                                    primary_file = file_info
                                                    break
                                            if primary_file is None:
                                                primary_file = (
                                                    model_info.get("files") or [{}]
                                                )[0]

                                            download_url = get_civitai_download_url(
                                                version_id_val
                                            )
                                            source_results["civitai"] = {
                                                "source": "civitai",
                                                "name": model_info.get("model_name"),
                                                "version_name": model_info.get(
                                                    "version_name"
                                                ),
                                                "filename": model_info.get(
                                                    "expected_filename"
                                                ),
                                                "type": category,
                                                "download_url": download_url,
                                                "url": f"https://civitai.com/models/{model_id_val}?modelVersionId={version_id_val}",
                                                "model_id": model_id_val,
                                                "version_id": version_id_val,
                                                "size": primary_file.get("size"),
                                                "base_model": model_info.get("base_model"),
                                                "tags": model_info.get("tags", []),
                                                "sha256": primary_file.get("sha256")
                                                or (primary_file.get("hashes") or {}).get("SHA256")
                                                or (primary_file.get("hashes") or {}).get("sha256"),
                                                "hashes": primary_file.get("hashes") or {},
                                                "match_type": "exact",
                                                "confidence": 100.0,
                                            }
                                            log_search_result(
                                                "civitai/urn",
                                                source_results["civitai"],
                                                {
                                                    "files_count": len(
                                                        model_info.get("files", [])
                                                    )
                                                },
                                            )
                                            source_found = True
                                        else:
                                            log_search_result(
                                                "civitai/urn",
                                                None,
                                                {
                                                    "model_id": model_id_val,
                                                    "version_id": version_id_val,
                                                },
                                            )
                                    elif category:
                                        update_search_progress(
                                            progress_id,
                                            "civitai",
                                            "fallback",
                                            "Searching CivitAI fallback",
                                            58,
                                        )
                                        log_info(
                                            "Search [civitai] URN ids missing; falling back"
                                        )
                                        civitai_results = search_civitai(
                                            filename,
                                            model_type=category,
                                        )
                                        log_search_result(
                                            "civitai/fallback",
                                            civitai_results[0] if civitai_results else None,
                                            {
                                                "results_count": len(civitai_results),
                                            },
                                        )
                                        if civitai_results:
                                            first_result = civitai_results[0]
                                            source_results["civitai"] = {
                                                "source": "civitai",
                                                "name": first_result.get("name"),
                                                "filename": first_result.get("filename"),
                                                "type": first_result.get("type"),
                                                "download_url": first_result.get(
                                                    "download_url"
                                                ),
                                                "url": first_result.get("url"),
                                                "size": first_result.get("size"),
                                                "base_model": first_result.get("base_model"),
                                                "tags": first_result.get("tags", []),
                                            }
                                            source_found = True
                                else:
                                    civitai_result = execute_search_with_fallback(
                                        "civitai",
                                        lambda base_ctx, cb: search_civitai_for_file(
                                            filename,
                                            model_type=category,
                                            base_model_context=base_ctx,
                                            session_token=civitai_session_token or None,
                                            candidate_limit=civitai_candidate_limit,
                                            use_trpc_search=civitai_use_trpc_search,
                                            use_html_fallback=civitai_use_html_fallback,
                                            progress_callback=cb,
                                        ),
                                        "CivitAI"
                                    )
                                    if civitai_result:
                                        source_results["civitai"] = civitai_result
                                        source_found = True

                                return source_results, source_found

                            return run_source_search(
                                "civitai",
                                task,
                                initial_stage="query",
                                initial_message="Querying CivitAI",
                                initial_percent=30,
                                log_start_fields={
                                    "file": filename,
                                    "cat": category,
                                    "urn": is_urn,
                                },
                            )

                        def search_civarchive_source_task():
                            def task():
                                source_results = {"civarchive": None}
                                source_found = False

                                if is_urn:
                                    model_id_val = data.get("model_id")
                                    version_id_val = data.get("version_id")
                                    if model_id_val and version_id_val:
                                        update_search_progress(
                                            progress_id,
                                            "civarchive",
                                            "urn",
                                            "Resolving CivArchive version",
                                            50,
                                        )
                                        civarchive_result = resolve_civarchive_model_version(
                                            model_id_val,
                                            version_id_val,
                                            query=filename,
                                        )
                                        log_search_result(
                                            "civarchive/urn",
                                            civarchive_result,
                                            {
                                                "model_id": model_id_val,
                                                "version_id": version_id_val,
                                            },
                                        )
                                        if civarchive_result:
                                            source_results["civarchive"] = civarchive_result
                                            source_found = True
                                    else:
                                        log_search_result(
                                            "civarchive/urn",
                                            None,
                                            {
                                                "model_id": model_id_val,
                                                "version_id": version_id_val,
                                            },
                                        )
                                else:
                                    civarchive_result = execute_search_with_fallback(
                                        "civarchive",
                                        lambda base_ctx, cb: search_civarchive_for_file(
                                            filename,
                                            model_type=category,
                                            base_model_context=base_ctx,
                                            limit=civarchive_candidate_limit,
                                            progress_callback=cb,
                                        ),
                                        "CivArchive"
                                    )
                                    if civarchive_result:
                                        source_results["civarchive"] = civarchive_result
                                        source_found = True

                                return source_results, source_found

                            def handle_civarchive_error(e):
                                error_message = f"CivArchive search failed: {e}"
                                log_warn(error_message)
                                update_search_progress(
                                    progress_id,
                                    "civarchive",
                                    "error",
                                    error_message,
                                    100,
                                    status="error",
                                )
                                return {
                                    "civarchive": None,
                                    "source_errors": {"civarchive": error_message},
                                }, False

                            return run_source_search(
                                "civarchive",
                                task,
                                initial_stage="query",
                                initial_message="Querying CivArchive",
                                initial_percent=30,
                                log_start_fields={
                                    "file": filename,
                                    "cat": category,
                                    "urn": is_urn,
                                },
                                error_handlers={CivArchiveSearchError: handle_civarchive_error},
                            )

                        def search_lora_manager_archive_source_task():
                            def task():
                                lora_manager_archive_result = execute_search_with_fallback(
                                    "lora_manager_archive",
                                    lambda base_ctx, cb: search_lora_manager_archive_for_file(
                                        filename,
                                        model_type=category,
                                        base_model_context=base_ctx,
                                        progress_callback=cb,
                                    ),
                                    "LoRA archive"
                                )
                                return (
                                    {
                                        "lora_manager_archive": lora_manager_archive_result
                                    },
                                    bool(lora_manager_archive_result),
                                )

                            return run_source_search(
                                "lora_manager_archive",
                                task,
                                initial_stage="query",
                                initial_message="Searching LoRA Manager archive",
                                initial_percent=36,
                                log_start_fields={"file": filename, "cat": category},
                            )


                        search_tasks = []
                        if search_local:
                            search_tasks.append(
                                asyncio.to_thread(search_local_sources)
                            )
                        if search_huggingface_source:
                            search_tasks.append(
                                asyncio.to_thread(search_huggingface_source_task)
                            )
                        if search_civitai_source:
                            search_tasks.append(
                                asyncio.to_thread(search_civitai_source_task)
                            )
                        if search_civarchive_source and (
                            filename or (is_urn and model_id and version_id)
                        ):
                            search_tasks.append(
                                asyncio.to_thread(search_civarchive_source_task)
                            )
                        if search_lora_manager_archive_source and filename:
                            search_tasks.append(
                                asyncio.to_thread(
                                    search_lora_manager_archive_source_task
                                )
                            )

                        if len(search_tasks) > 1:
                            log_debug(
                                "Search sources async "
                                + format_log_fields(count=len(search_tasks))
                            )
                        update_search_progress(
                            progress_id,
                            progress_source,
                            "running",
                            "Waiting for search sources",
                            18,
                        )
                        raise_if_search_cancelled(progress_source)

                        for source_results, source_found in await asyncio.gather(
                            *search_tasks
                        ):
                            raise_if_search_cancelled(progress_source)
                            for source_key, source_result in source_results.items():
                                if source_key == "source_errors":
                                    results["source_errors"].update(source_result or {})
                                    continue
                                if source_result:
                                    results[source_key] = source_result
                            if source_found:
                                results["found"] = True

                        raise_if_search_cancelled(progress_source)
                        results["local_hash_matches"] = collect_local_hash_matches(results)
                        raise_if_search_cancelled(progress_source)

                        log_info(
                            f"Search [{','.join(results['searched_sources'])}] done "
                            + format_log_fields(
                                found=results["found"],
                            )
                        )
                        update_search_progress(
                            progress_id,
                            progress_source,
                            "completed",
                            "Search complete",
                            100,
                            status="completed",
                        )
                        stamp_search_results(results)
                        return web.json_response(results)

                    except SearchCancelled:
                        update_search_progress(
                            progress_id if "progress_id" in locals() else "",
                            progress_source if "progress_source" in locals() else "",
                            "cancelled",
                            "Cancelled",
                            100,
                            status="cancelled",
                            cancelled=True,
                        )
                        log_info(
                            "Search cancelled "
                            + format_log_fields(
                                source=progress_source if "progress_source" in locals() else "",
                                progress_id=progress_id if "progress_id" in locals() else "",
                            )
                        )
                        return web.json_response(
                            {
                                "cancelled": True,
                                "found": False,
                                "searched_sources": sorted(normalized_sources)
                                if "normalized_sources" in locals()
                                else [],
                                "source_errors": {},
                            }
                        )

                    except Exception as e:
                        update_search_progress(
                            progress_id if "progress_id" in locals() else "",
                            progress_source if "progress_source" in locals() else "",
                            "error",
                            str(e),
                            100,
                            status="error",
                        )
                        log_exception(f"Model Resolver search error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/clear-search-cache")
                @json_api_endpoint("Clear search cache")
                async def clear_search_cache_route(request):
                    """Clear backend search caches after token/settings changes."""
                    clear_huggingface_search_cache()
                    clear_civitai_search_cache()
                    clear_civarchive_search_cache()
                    clear_lora_manager_archive_search_cache()
                    reload_popular_databases()
                    reload_model_list()
                    invalidate_model_files_cache()
                    self.search_result_timestamps.clear()
                    log_info("Cleared backend search caches")
                    return web.json_response({"success": True, "cleared": "all"})

                async def _check_credential_helper(request, payload_key, check_func, log_name):
                    try:
                        data = await request.json()
                        val = data.get(payload_key, "")
                        result = await asyncio.to_thread(check_func, val)
                        return web.json_response(result)
                    except Exception as e:
                        log_exception(f"{log_name} check error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/civitai/session-token/check")
                async def civitai_session_token_check_route(request):
                    """Check whether a CivitAI browser session token is valid."""
                    return await _check_credential_helper(
                        request, "civitai_session_token", check_civitai_session_token, "CivitAI session token"
                    )

                @routes.post("/model_resolver/civitai/api-key/check")
                async def civitai_api_key_check_route(request):
                    """Check whether a CivitAI API key is valid."""
                    return await _check_credential_helper(
                        request, "civitai_key", check_civitai_api_key, "CivitAI API key"
                    )

                @routes.post("/model_resolver/huggingface/token/check")
                async def huggingface_token_check_route(request):
                    """Check whether a HuggingFace token is valid."""
                    return await _check_credential_helper(
                        request, "hf_token", check_huggingface_token, "HuggingFace token"
                    )

                @routes.post("/model_resolver/brave/api-key/check")
                async def brave_api_key_check_route(request):
                    """Check whether a Brave Search API key is valid."""
                    return await _check_credential_helper(
                        request, "brave_search_api_key", check_brave_search_api_key, "Brave Search API key"
                    )

                @routes.get("/model_resolver/huggingface/author-index/status")
                @json_api_endpoint("HuggingFace author index status")
                async def huggingface_author_index_status_route(request):
                    """Return local HuggingFace author fallback index status."""
                    return web.json_response(get_author_fallback_index_status())

                @routes.post("/model_resolver/huggingface/author-index/refresh")
                @json_api_endpoint("HuggingFace author index refresh")
                async def huggingface_author_index_refresh_route(request):
                    """Refresh HuggingFace author fallback index."""
                    data = await request.json()
                    hf_token = data.get("hf_token", "")
                    result = await asyncio.to_thread(
                        refresh_author_fallback_index, hf_token or None
                    )
                    clear_huggingface_search_cache()
                    return web.json_response(result)

                @routes.get("/model_resolver/model-list/status")
                @json_api_endpoint("Model list status")
                async def model_list_status_route(request):
                    """Return local model-list status and optionally compare with GitHub."""
                    check_remote = (
                        str(request.query.get("check_remote", "")).lower()
                        in {"1", "true", "yes"}
                    )
                    return web.json_response(
                        get_model_list_update_status(check_remote=check_remote)
                    )

                @routes.post("/model_resolver/model-list/update")
                @json_api_endpoint("Model list update")
                async def model_list_update_route(request):
                    """Download latest ComfyUI-Manager model-list.json."""
                    result = await asyncio.to_thread(update_model_list_from_remote)
                    clear_huggingface_search_cache()
                    clear_civitai_search_cache()
                    clear_civarchive_search_cache()
                    clear_lora_manager_archive_search_cache()
                    self.search_result_timestamps.clear()
                    return web.json_response(result)

                @routes.post("/model_resolver/download")
                @json_api_endpoint("download", return_success_on_error=True)
                async def download_model(request):
                    """Start downloading a model."""
                    data = await request.json()
                    url = data.get("url", "")
                    filename = data.get("filename", "")
                    category = data.get("category", "checkpoints")
                    category = normalize_download_category(category)
                    subfolder = data.get("subfolder", "")
                    base_directory = data.get("base_directory", "")
                    path_metadata = data.get("path_metadata", {})
                    if not isinstance(path_metadata, dict):
                        path_metadata = {}
                    download_metadata = data.get("download_metadata") or data.get(
                        "metadata", {}
                    )
                    if not isinstance(download_metadata, dict):
                        download_metadata = {}
                    download_metadata = dict(download_metadata)
                    settings = load_resolver_settings()
                    if not base_directory:
                        base_directory = get_default_root_for_category(category, settings)
                    subfolder = resolve_download_subfolder(
                        category,
                        subfolder,
                        path_metadata,
                        settings,
                    )

                    if not url:
                        return web.json_response(
                            {"error": "URL is required"}, status=400
                        )

                    if not filename:
                        # Extract filename from URL
                        from urllib.parse import urlparse, unquote

                        parsed = urlparse(url)
                        filename = unquote(parsed.path.split("/")[-1])

                    if not filename:
                        return web.json_response(
                            {"error": "Could not determine filename"}, status=400
                        )

                    # Build headers if needed
                    headers = {}
                    if "huggingface.co" in url:
                        hf_token = data.get("hf_token", "")
                        if hf_token:
                            headers["Authorization"] = f"Bearer {hf_token}"
                    elif "civitai.com" in url or "civitai.red" in url:
                        civitai_key = data.get("civitai_key", "")
                        if civitai_key and "token=" not in url:
                            url += (
                                f"{'&' if '?' in url else '?'}token={civitai_key}"
                            )
                        civitai_session_token = str(
                            data.get("civitai_session_token", "") or ""
                        ).strip()
                        if civitai_session_token:
                            headers["Cookie"] = (
                                f"__Secure-civitai-token={civitai_session_token}"
                            )

                    def _first_metadata_value(*values):
                        return first_non_empty(*values)

                    def _metadata_int(value):
                        return to_int(value)

                    inferred_source = ""
                    if "civitai.com" in url:
                        inferred_source = "civitai"
                    elif "huggingface.co" in url:
                        inferred_source = "huggingface"

                    download_metadata.setdefault("filename", filename)
                    download_metadata.setdefault("category", category)
                    download_metadata.setdefault("download_url", url)
                    download_metadata.setdefault("source_url", url)
                    download_metadata.setdefault("path_metadata", path_metadata)
                    download_metadata.setdefault(
                        "source",
                        _first_metadata_value(
                            download_metadata.get("details_source"),
                            path_metadata.get("source"),
                            inferred_source,
                        ),
                    )

                    model_id = _metadata_int(
                        _first_metadata_value(
                            download_metadata.get("model_id"),
                            download_metadata.get("modelId"),
                            path_metadata.get("model_id"),
                        )
                    )
                    version_id = _metadata_int(
                        _first_metadata_value(
                            download_metadata.get("version_id"),
                            download_metadata.get("versionId"),
                            path_metadata.get("version_id"),
                        )
                    )
                    source_name = str(
                        _first_metadata_value(
                            download_metadata.get("details_source"),
                            download_metadata.get("source"),
                        )
                    ).lower()
                    try:
                        if (
                            source_name == "civitai"
                            and model_id
                            and not download_metadata.get("civitai_details")
                        ):
                            details = await asyncio.to_thread(
                                get_civitai_model_details,
                                model_id,
                                version_id,
                                data.get("civitai_key", ""),
                            )
                            if details:
                                download_metadata["civitai_details"] = details
                        elif (
                            source_name == "civarchive"
                            and model_id
                            and not download_metadata.get("civitai_details")
                        ):
                            details = await asyncio.to_thread(
                                get_civarchive_model_details,
                                model_id,
                                version_id,
                            )
                            if details:
                                download_metadata["civitai_details"] = details
                    except Exception as metadata_error:
                        self.logger.warning(
                            f"Model metadata lookup failed: {metadata_error}"
                        )

                    target_directory = ""
                    target_path = ""
                    try:
                        import os as _download_os

                        target_directory = (
                            get_download_directory(category, base_directory) or ""
                        )
                        if target_directory and subfolder:
                            target_directory = _download_os.path.join(
                                target_directory, subfolder
                            )
                        if target_directory:
                            target_path = _download_os.path.join(
                                target_directory, filename
                            )
                    except Exception:
                        target_directory = ""
                        target_path = ""

                    # Start background download
                    download_id = start_background_download(
                        url=url,
                        filename=filename,
                        category=category,
                        headers=headers if headers else None,
                        subfolder=subfolder,
                        base_directory=base_directory,
                        metadata=download_metadata,
                    )

                    return web.json_response(
                        {
                            "success": True,
                            "download_id": download_id,
                            "filename": filename,
                            "category": category,
                            "path": target_path,
                            "directory": target_directory,
                            "download_backend": settings.get("download_backend", "python"),
                        }
                    )

                @routes.get("/model_resolver/progress/{download_id}")
                @json_api_endpoint("progress")
                async def get_download_progress(request):
                    """Get progress for a specific download."""
                    download_id = request.match_info["download_id"]
                    progress = get_progress(download_id)

                    if progress:
                        return web.json_response(progress)
                    else:
                        return web.json_response(
                            {"error": "Download not found"}, status=404
                        )

                @routes.get("/model_resolver/progress")
                @json_api_endpoint("progress")
                async def get_all_downloads_progress(request):
                    """Get progress for all downloads."""
                    progress = get_all_progress()
                    return web.json_response(progress)

                @routes.post("/model_resolver/cancel/{download_id}")
                @json_api_endpoint("cancel", return_success_on_error=True)
                async def cancel_download_route(request):
                    """Cancel a download in progress."""
                    download_id = request.match_info["download_id"]
                    cancel_download(download_id)
                    return web.json_response({"success": True})

                @routes.post("/model_resolver/pause/{download_id}")
                @json_api_endpoint("pause", return_success_on_error=True)
                async def pause_download_route(request):
                    """Pause an aria2 download."""
                    download_id = request.match_info["download_id"]
                    result = pause_download(download_id)
                    status = 200 if result.get("success") else 400
                    return web.json_response(result, status=status)

                @routes.post("/model_resolver/resume/{download_id}")
                @json_api_endpoint("resume", return_success_on_error=True)
                async def resume_download_route(request):
                    """Resume an aria2 download."""
                    download_id = request.match_info["download_id"]
                    result = resume_download(download_id)
                    status = 200 if result.get("success") else 400
                    return web.json_response(result, status=status)

                @routes.get("/model_resolver/aria2/status")
                @json_api_endpoint("aria2 status")
                async def aria2_status_route(request):
                    """Report aria2 availability using saved settings."""
                    settings = await asyncio.to_thread(load_resolver_settings)
                    return web.json_response(await asyncio.to_thread(get_aria2_status, settings))

                @routes.post("/model_resolver/aria2/status")
                @json_api_endpoint("aria2 status POST")
                async def aria2_status_check_route(request):
                    """Report aria2 availability using an optional unsaved aria2c path."""
                    payload = await request.json()
                    settings = await asyncio.to_thread(load_resolver_settings)
                    if isinstance(payload, dict) and "aria2c_path" in payload:
                        settings = dict(settings)
                        settings["aria2c_path"] = payload.get("aria2c_path", "")
                    return web.json_response(await asyncio.to_thread(get_aria2_status, settings))

                @routes.post("/model_resolver/aria2/start")
                @json_api_endpoint("aria2 start", return_success_on_error=True)
                async def aria2_start_route(request):
                    """Start the aria2 daemon without starting a download."""
                    try:
                        payload = await request.json()
                    except Exception:
                        payload = {}
                    settings = await asyncio.to_thread(load_resolver_settings)
                    if isinstance(payload, dict) and "aria2c_path" in payload:
                        settings = dict(settings)
                        settings["aria2c_path"] = payload.get("aria2c_path", "")
                    result = await asyncio.to_thread(start_aria2_daemon, settings)
                    status = 200 if result.get("success") else 400
                    return web.json_response(result, status=status)

                @routes.get("/model_resolver/aria2/stop")
                @routes.post("/model_resolver/aria2/stop")
                @json_api_endpoint("aria2 stop", return_success_on_error=True)
                async def aria2_stop_route(request):
                    """Stop the aria2 daemon started by Model Resolver."""
                    result = await asyncio.to_thread(stop_aria2_daemon)
                    status = 200 if result.get("success") else 400
                    return web.json_response(result, status=status)

                @routes.post("/model_resolver/aria2/install")
                @json_api_endpoint("aria2 install")
                async def aria2_install_route(request):
                    """Download official aria2c binary and save its path."""
                    try:
                        payload = await request.json()
                    except Exception:
                        payload = {}
                    force = False
                    if isinstance(payload, dict):
                        force = to_bool(payload.get("force"), False)
                    try:
                        install_result = await asyncio.to_thread(install_aria2_engine, force)
                    except Aria2InstallError as exc:
                        self.logger.warning(f"Model Resolver aria2 install failed: {exc}")
                        return web.json_response({"success": False, "error": str(exc)}, status=500)
                    settings = await asyncio.to_thread(
                        save_resolver_settings,
                        {
                            "aria2c_path": install_result.get("aria2c_path", ""),
                            "download_backend": "aria2",
                        },
                    )
                    install_result["settings"] = settings
                    return web.json_response(install_result)

                @routes.get("/model_resolver/directories")
                @json_api_endpoint("directories")
                async def get_directories(request):
                    """Get available model directories."""
                    import folder_paths

                    preferred_categories = [
                        "checkpoints",
                        "loras",
                        "vae",
                        "controlnet",
                        "clip",
                        "clip_vision",
                        "embeddings",
                        "upscale_models",
                        "diffusion_models",
                        "text_encoders",
                        "ipadapter",
                        "sams",
                        "ultralytics",
                    ]
                    skip_categories = {"custom_nodes", "configs"}
                    categories = []
                    for cat in [
                        *preferred_categories,
                        *folder_paths.folder_names_and_paths.keys(),
                    ]:
                        normalized_cat = normalize_download_category(cat)
                        if (
                            not normalized_cat
                            or normalized_cat in skip_categories
                            or normalized_cat in categories
                        ):
                            continue
                        categories.append(normalized_cat)

                    directories = {}
                    for cat in categories:
                        path = get_download_directory(cat)
                        if path:
                            directories[cat] = path

                    return web.json_response(directories)

                @routes.get("/model_resolver/root-directories")
                @json_api_endpoint("root directories")
                async def get_root_directories(request):
                    """Get configured ComfyUI root directories for path settings."""
                    import os
                    import folder_paths

                    preferred_categories = [
                        "loras",
                        "checkpoints",
                        "diffusion_models",
                        "embeddings",
                        "text_encoders",
                        "vae",
                        "upscale_models",
                        "controlnet",
                        "clip_vision",
                        "ipadapter",
                        "sams",
                        "ultralytics",
                    ]
                    skip_categories = {"custom_nodes", "configs"}
                    known_categories = set(folder_paths.folder_names_and_paths.keys())
                    categories = []
                    category_source_keys = {}
                    for cat in [
                        *preferred_categories,
                        *known_categories,
                    ]:
                        folder_key = normalize_download_category(cat)
                        if (
                            not folder_key
                            or folder_key in skip_categories
                            or folder_key in categories
                        ):
                            if folder_key and folder_key not in skip_categories:
                                category_source_keys.setdefault(folder_key, []).append(cat)
                            continue
                        categories.append(folder_key)
                        category_source_keys.setdefault(folder_key, []).append(cat)

                    roots = {}
                    settings = load_resolver_settings()
                    comfy_root = get_comfy_root_path(folder_paths)
                    for cat in categories:
                        folder_key = normalize_download_category(cat)
                        if folder_key in known_categories:
                            raw_candidate_keys = [folder_key]
                        else:
                            raw_candidate_keys = [
                                folder_key,
                                *TEMPLATE_KEY_ALIASES.get(folder_key, ()),
                                *category_source_keys.get(folder_key, []),
                            ]
                        if folder_key == "ultralytics":
                            raw_candidate_keys = [
                                candidate_key
                                for candidate_key in raw_candidate_keys
                                if str(candidate_key or "").strip().lower() != "yolo"
                            ]

                        candidate_keys = []
                        for candidate_key in raw_candidate_keys:
                            if (
                                candidate_key
                                and candidate_key in known_categories
                                and candidate_key not in candidate_keys
                            ):
                                candidate_keys.append(candidate_key)
                        paths = []
                        for candidate_key in candidate_keys:
                            paths.extend(folder_paths.get_folder_paths(candidate_key) or [])
                        if folder_key == "ultralytics":
                            normalized_ultralytics_paths = []
                            for path in paths:
                                normalized_path = os.path.normpath(str(path or ""))
                                basename = os.path.basename(normalized_path).lower()
                                if basename == "yolo":
                                    continue
                                parent_dir = os.path.dirname(normalized_path)
                                if (
                                    basename in {"bbox", "segm"}
                                    and os.path.basename(parent_dir).lower()
                                    == "ultralytics"
                                ):
                                    normalized_path = parent_dir
                                normalized_ultralytics_paths.append(normalized_path)
                            paths = normalized_ultralytics_paths
                        preferred_directory = get_default_root_for_category(
                            folder_key, settings
                        )
                        normalized_paths = dedupe_local_base_directories(
                            paths,
                            preferred_directory=preferred_directory,
                            comfy_root=comfy_root,
                        )
                        roots[folder_key] = normalized_paths

                    for raw_key in known_categories:
                        if (
                            not raw_key
                            or raw_key in skip_categories
                            or raw_key in roots
                        ):
                            continue
                        raw_paths = folder_paths.get_folder_paths(raw_key) or []
                        roots[raw_key] = dedupe_local_base_directories(
                            raw_paths,
                            comfy_root=comfy_root,
                        )

                    return web.json_response(roots)

                @routes.get("/model_resolver/path-template-suggestions")
                @json_api_endpoint("path template suggestions")
                async def get_path_template_suggestions(request):
                    """Infer path template presets from existing local model folders."""
                    from .core.sources.popular import get_base_models_config

                    force_rescan = request.query.get("force") == "1"
                    models = await asyncio.to_thread(get_model_files, force_rescan)
                    base_models_config = get_base_models_config()
                    suggestions = await asyncio.to_thread(
                        infer_download_path_templates,
                        models,
                        base_models_config,
                    )
                    return web.json_response(suggestions)

                @routes.get("/model_resolver/capabilities")
                @json_api_endpoint("capabilities")
                async def get_capabilities(request):
                    """Get optional source capabilities available in this install."""
                    return web.json_response(
                        {
                            "sources": {
                                "civarchive": is_civarchive_available(),
                                "lora_manager_archive": is_lora_manager_archive_available()
                            }
                        }
                    )

                @routes.get("/model_resolver/subfolders/{category}")
                @json_api_endpoint("subfolders")
                async def get_subfolders(request):
                    """Get known subfolders for a category using ComfyUI folder_paths."""
                    import os
                    import folder_paths

                    raw_category = (request.match_info.get("category") or "").strip()
                    category = normalize_download_category(raw_category)

                    if not category or category == "unknown":
                        return web.json_response([])

                    known_categories = set(folder_paths.folder_names_and_paths.keys())
                    folder_keys = [category]
                    if category == "diffusion_models":
                        folder_keys.append("unet")
                    elif category == "text_encoders":
                        folder_keys.append("clip")
                    available_folder_keys = [
                        folder_key for folder_key in folder_keys if folder_key in known_categories
                    ]
                    if not available_folder_keys:
                        self.logger.debug(
                            f"Model Resolver: skipping subfolder lookup for unknown category '{raw_category}' -> '{category}'"
                        )
                        return web.json_response([])

                    subfolders = {}
                    settings = load_resolver_settings()
                    comfy_root = get_comfy_root_path(folder_paths)
                    preferred_directory = (
                        get_default_root_for_category(category, settings)
                        or get_download_directory(category)
                        or ""
                    )

                    def add_subfolder(rel_path, base_dir=""):
                        rel_path = os.path.normpath(str(rel_path or "")).replace(
                            os.sep, "\\"
                        )
                        if not rel_path or rel_path == ".":
                            return
                        base_dir = os.path.abspath(base_dir) if base_dir else ""
                        base_identity = (
                            get_local_path_identity(base_dir) if base_dir else ""
                        )
                        key = (rel_path.lower(), base_identity)
                        base_label = (
                            os.path.basename(os.path.normpath(base_dir))
                            if base_dir
                            else ""
                        )
                        current = subfolders.get(key)
                        if current and not prefer_local_base_directory(
                            base_dir,
                            current.get("base_directory", ""),
                            preferred_directory,
                            comfy_root,
                        ):
                            return
                        subfolders[key] = {
                            "value": rel_path,
                            "label": rel_path,
                            "base_label": base_label,
                            "base_directory": base_dir,
                        }

                    raw_base_dirs = []
                    for folder_key in available_folder_keys:
                        for base_dir in folder_paths.get_folder_paths(folder_key) or []:
                            if not base_dir or not os.path.isdir(base_dir):
                                continue
                            raw_base_dirs.append(base_dir)
                    base_dirs = dedupe_local_base_directories(
                        raw_base_dirs,
                        preferred_directory=preferred_directory,
                        comfy_root=comfy_root,
                    )

                    def find_base_dir(full_path):
                        if not full_path:
                            return ""
                        full_path_identity = get_local_path_identity(full_path)
                        for base_dir in base_dirs:
                            base_identity = get_local_path_identity(base_dir)
                            try:
                                if (
                                    os.path.commonpath(
                                        [full_path_identity, base_identity]
                                    )
                                    == base_identity
                                ):
                                    return base_dir
                            except Exception:
                                continue
                        return ""

                    for folder_key in available_folder_keys:
                        filenames = folder_paths.get_filename_list(folder_key) or []
                        for rel_path in filenames:
                            if not isinstance(rel_path, str):
                                continue
                            base_dir = ""
                            try:
                                base_dir = find_base_dir(
                                    folder_paths.get_full_path(folder_key, rel_path)
                                )
                            except Exception:
                                base_dir = ""
                            parts = [p for p in rel_path.replace("/", "\\").split("\\") if p]
                            if len(parts) <= 1:
                                continue
                            current = ""
                            for part in parts[:-1]:
                                current = f"{current}\\{part}" if current else part
                                add_subfolder(current, base_dir)

                    for base_dir in base_dirs:
                        for root, dirs, _files in os.walk(base_dir):
                            rel_root = os.path.relpath(root, base_dir)
                            for dirname in dirs:
                                rel_path = (
                                    dirname
                                    if rel_root in ("", ".")
                                    else os.path.join(rel_root, dirname)
                                )
                                add_subfolder(rel_path, base_dir)

                    value_counts = {}
                    for item in subfolders.values():
                        value_key = item.get("value", "").lower()
                        value_counts[value_key] = value_counts.get(value_key, 0) + 1

                    response_items = []
                    for item in subfolders.values():
                        value = item.get("value", "")
                        base_label = item.get("base_label", "")
                        label = (
                            f"{value} ({base_label})"
                            if base_label and value_counts.get(value.lower(), 0) > 1
                            else value
                        )
                        response_items.append(
                            {
                                "value": value,
                                "label": label,
                                "base_directory": item.get("base_directory", ""),
                            }
                        )

                    return web.json_response(
                        sorted(
                            response_items,
                            key=lambda item: (
                                item.get("value", "").lower(),
                                item.get("base_directory", "").lower(),
                            ),
                        )
                    )

            # ==================== SETTINGS (server-side persistence) ====================

            def _log_level_setting(value, default: str = BACKEND_DEFAULT_LOG_LEVEL) -> LogLevel:
                normalized = str(value or default or "INFO").strip().upper()
                if hasattr(LogLevel, normalized):
                    return getattr(LogLevel, normalized)
                fallback = str(default or "INFO").strip().upper()
                return getattr(LogLevel, fallback, LogLevel.INFO)

            def _apply_backend_logging_settings(settings: dict) -> None:
                enabled = resolver_bool_setting(settings.get("backend_logs_enabled"), True)
                level = _log_level_setting(settings.get("backend_log_level"))
                backend_log_controller.set_enabled(enabled)
                backend_log_controller.set_global_level(level)

            _apply_backend_logging_settings(load_resolver_settings())

            @routes.get("/model_resolver/settings")
            @json_api_endpoint("settings GET")
            async def get_settings_route(request):
                """Return persisted settings (API keys, preferences)."""
                data = await asyncio.to_thread(load_resolver_settings)
                return web.json_response(data)

            @routes.post("/model_resolver/settings")
            @json_api_endpoint("settings POST")
            async def save_settings_route(request):
                """Persist settings (API keys, preferences) to disk."""
                payload = await request.json()
                if not isinstance(payload, dict):
                    return web.json_response({"error": "Expected JSON object"}, status=400)
                settings = await asyncio.to_thread(save_resolver_settings, payload)
                _apply_backend_logging_settings(settings)
                return web.json_response({"success": True})

            self.routes_setup = True
            self.logger.info("Model Resolver: API routes registered successfully")
            return True

        except ImportError as e:
            self.logger.warning(
                f"Model Resolver: Could not register routes (missing dependency): {e}"
            )
            return False
        except Exception as e:
            self.logger.error(
                f"Model Resolver: Error setting up routes: {e}", exc_info=True
            )
            return False


# Initialize the extension
try:
    extension = ModelResolverExtension()
    extension.initialize()
except Exception as e:
    log_error(
        f"ComfyUI Model Resolver extension initialization failed: {e}", exc_info=True
    )

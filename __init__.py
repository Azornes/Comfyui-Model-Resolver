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
        self.search_progress_lock = threading.Lock()
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
                from .core.settings import (
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
                    get_download_directory,
                    normalize_download_category,
                )
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

            # ==================== BASE MODELS CONFIG ROUTE ====================

            @routes.get("/model_resolver/base-models")
            async def get_base_models(request):
                """Return the base models config from metadata/base-models.json.
                
                Returns {base_models: [{name, aliases}]} so the frontend
                dropdown can populate correctly via baseModels.base_models.
                """
                try:
                    from .core.sources.popular import get_base_models_config
                    data = get_base_models_config()
                    return web.json_response(data)
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver base-models error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.get("/model_resolver/base-models/status")
            async def get_base_models_status_route(request):
                """Get local and optional remote base models status."""
                try:
                    check_remote = request.query.get("check_remote") == "1"
                    from .core.sources.popular import get_base_models_status
                    status = await asyncio.to_thread(get_base_models_status, check_remote)
                    return web.json_response(status)
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver base-models status error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.post("/model_resolver/base-models/update")
            async def update_base_models_route(request):
                """Update base models list from CivitAI."""
                try:
                    from .core.sources.popular import update_base_models_from_remote
                    status = await asyncio.to_thread(update_base_models_from_remote)
                    return web.json_response(status)
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver base-models update error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

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
            async def resolve_models(request):
                """Apply model resolution and return updated workflow."""
                try:
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
                except Exception as e:
                    self.logger.error(f"Model Resolver resolve error: {e}", exc_info=True)
                    return web.json_response(
                        {"error": str(e), "success": False}, status=500
                    )

            @routes.post("/model_resolver/local-matches")
            async def local_matches(request):
                """Search local model files by filename/path."""
                try:
                    data = await request.json()
                    filename = data.get("filename", "")
                    category = data.get("category", "")
                    force_rescan = data.get("force_rescan", False)
                    force_rescan = (
                        force_rescan
                        if isinstance(force_rescan, bool)
                        else str(force_rescan).lower() == "true"
                    )

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
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver local-matches error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.post("/model_resolver/open-containing-folder")
            async def open_containing_folder(request):
                """Open Explorer at the folder containing the selected model."""
                try:
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
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver open-containing-folder error: {e}",
                        exc_info=True,
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.get("/model_resolver/models")
            async def get_models(request):
                """Get list of all available models."""
                try:
                    force_rescan = str(
                        request.query.get("force")
                        or request.query.get("force_rescan")
                        or ""
                    ).lower() in {"1", "true", "yes"}
                    models = get_model_files(force_rescan=force_rescan)
                    return web.json_response(models)
                except Exception as e:
                    self.logger.error(
                        f"Model Resolver get_models error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.post("/model_resolver/loaded")
            async def get_loaded_models(request):
                """Get all currently loaded models in the workflow."""
                try:
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
                            filename = rel_path.split("/")[-1].split("\\")[-1]
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
                        model_name = original_path.split("/")[-1].split("\\")[-1]
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

                except Exception as e:
                    self.logger.error(
                        f"Model Resolver get_loaded_models error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            # ==================== CIVITAI SEARCH ROUTE ====================

            @routes.post("/model_resolver/civitai-search")
            async def civitai_search(request):
                """Search CivitAI for a model using file hash."""
                try:
                    data = await request.json()
                    filename = data.get("filename", "")
                    category = data.get("category", "")
                    resolved_path = data.get("resolved_path", "")

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

                            # Map category to folder_paths type
                            category_map = {
                                "loras": "loras",
                                "checkpoints": "checkpoints",
                                "vae": "vae",
                                "controlnet": "controlnet",
                                "clip": "text_encoders",
                                "clips": "text_encoders",
                                "text_encoder": "text_encoders",
                                "text_encoders": "text_encoders",
                                "diffusion_model": "diffusion_models",
                                "diffusion_models": "diffusion_models",
                                "unet": "diffusion_models",
                                "upscale_models": "upscale_models",
                                "upscale_model": "upscale_models",
                                "latent_upscale_model": "latent_upscale_models",
                                "latent_upscale_models": "latent_upscale_models",
                                "style_model": "style_models",
                                "style_models": "style_models",
                                "gligen": "gligen",
                                "diffusers": "diffusers",
                                "vae_approx": "vae_approx",
                                "sam": "sams",
                                "sam_model": "sams",
                                "sam_models": "sams",
                                "sams": "sams",
                                "ultralytics": "ultralytics",
                                "ultralytics_bbox": "ultralytics",
                                "ultralytics_segm": "ultralytics",
                                "yolo": "ultralytics",
                                "audio_encoder": "audio_encoders",
                                "audio_encoders": "audio_encoders",
                                "background_removal": "background_removal",
                                "background_removal_model": "background_removal",
                                "frame_interpolation": "frame_interpolation",
                                "frame_interpolation_model": "frame_interpolation",
                                "geometry_estimation": "geometry_estimation",
                                "geometry_estimation_model": "geometry_estimation",
                                "detection": "detection",
                                "model_patch": "model_patches",
                                "model_patches": "model_patches",
                                "photomaker": "photomaker",
                                "optical_flow": "optical_flow",
                                "optical_flow_model": "optical_flow",
                            }
                            folder_type = category_map.get(
                                category.lower(), category.lower()
                            )
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

                    # Search CivitAI for the model using hash
                    if download_available and file_path and _os.path.exists(file_path):
                        file_location = _os.path.dirname(file_path).replace("\\", "/")
                        if file_location and not file_location.endswith("/"):
                            file_location += "/"
                        try:
                            from .core.sources.civitai import (
                                get_model_info_for_file,
                            )

                            result = get_model_info_for_file(file_path)
                            if result and (
                                result.get("url")
                                or result.get("version_url")
                                or result.get("from_metadata")
                                or result.get("trained_words")
                            ):
                                return web.json_response(
                                    {
                                        "filename": filename,
                                        "file_path": file_path,
                                        "resolved_path": file_path,
                                        "location": result.get("location")
                                        or file_location,
                                        "url": result.get("url"),
                                        "version_url": result.get("version_url"),
                                        "model_id": result.get("model_id"),
                                        "model_name": result.get(
                                            "model_name", clean_name
                                        ),
                                        "model_type": result.get("model_type", ""),
                                        "version_id": result.get("version_id"),
                                        "version_name": result.get("version_name", ""),
                                        "sha256": result.get("sha256"),
                                        "size": result.get("size"),
                                        "base_model": result.get("base_model"),
                                        "tags": result.get("tags", []),
                                        "trained_words": result.get(
                                            "trained_words", []
                                        ),
                                        "images": result.get("images", []),
                                        "clip_skip": result.get("clip_skip"),
                                        "description": result.get("description", ""),
                                        "model_description": result.get(
                                            "model_description", ""
                                        ),
                                    }
                                )
                        except Exception as e:
                            self.logger.warning(f"CivitAI search error: {e}")

                    # No result found - try fallback to filename search
                    if download_available:
                        try:
                            from .core.sources.civitai import (
                                search_civitai_for_file,
                            )

                            result = search_civitai_for_file(
                                filename, model_type=category
                            )
                            if result and result.get("url"):
                                return web.json_response(
                                    {
                                        "url": result["url"],
                                        "file_path": file_path,
                                        "resolved_path": file_path,
                                        "location": file_location,
                                        "model_name": result.get("name", clean_name),
                                        "version_id": result.get("version_id"),
                                        "size": result.get("size"),
                                        "tags": result.get("tags", []),
                                    }
                                )
                        except Exception as e:
                            self.logger.warning(f"CivitAI fallback search error: {e}")

                    # No result found
                    return web.json_response({"url": None})

                except Exception as e:
                    self.logger.error(
                        f"Model Resolver civitai-search error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            @routes.post("/model_resolver/model-details")
            async def model_details(request):
                """Return normalized full model details for sources that expose model pages."""
                try:
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

                except Exception as e:
                    self.logger.error(
                        f"Model Resolver model-details error: {e}", exc_info=True
                    )
                    return web.json_response({"error": str(e)}, status=500)

            # ==================== DOWNLOAD ROUTES ====================

            if download_available:

                from .core.path_utils import (
                    get_path_abs as get_local_path_abs,
                    get_path_key as get_local_path_key,
                    get_path_identity as get_local_path_identity,
                )

                def get_comfy_root_path(folder_paths_module):
                    import os

                    try:
                        module_file = getattr(folder_paths_module, "__file__", "")
                        return os.path.dirname(os.path.abspath(module_file))
                    except Exception:
                        return ""

                from .core.path_utils import (
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
                async def get_search_progress_route(request):
                    """Return live progress for an in-flight source search."""
                    progress_id = request.match_info.get("progress_id", "")
                    cleanup_search_progress()
                    with self.search_progress_lock:
                        progress = dict(self.search_progress.get(progress_id) or {})
                    if not progress:
                        return web.json_response({"exists": False})
                    return web.json_response({"exists": True, **progress})

                @routes.post("/model_resolver/search")
                async def search_sources(request):
                    """Search for model download sources."""
                    try:
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
                        civitai_candidate_limit_raw = data.get(
                            "civitai_candidate_limit", 5
                        )
                        try:
                            civitai_candidate_limit = int(
                                civitai_candidate_limit_raw
                            )
                        except (TypeError, ValueError):
                            civitai_candidate_limit = 5
                        civitai_candidate_limit = max(
                            1, min(civitai_candidate_limit, 20)
                        )
                        civarchive_candidate_limit_raw = data.get(
                            "civarchive_candidate_limit", 10
                        )
                        try:
                            civarchive_candidate_limit = int(
                                civarchive_candidate_limit_raw
                            )
                        except (TypeError, ValueError):
                            civarchive_candidate_limit = 10
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
                        is_urn = (
                            is_urn_raw
                            if isinstance(is_urn_raw, bool)
                            else (str(is_urn_raw).lower() == "true")
                        )
                        hf_use_api_search = (
                            hf_use_api_search
                            if isinstance(hf_use_api_search, bool)
                            else str(hf_use_api_search).lower() == "true"
                        )
                        civitai_use_trpc_search = (
                            civitai_use_trpc_search
                            if isinstance(civitai_use_trpc_search, bool)
                            else str(civitai_use_trpc_search).lower() == "true"
                        )
                        civitai_use_html_fallback = (
                            civitai_use_html_fallback
                            if isinstance(civitai_use_html_fallback, bool)
                            else str(civitai_use_html_fallback).lower() == "true"
                        )
                        hf_use_comfy_org_fallback = (
                            hf_use_comfy_org_fallback
                            if isinstance(hf_use_comfy_org_fallback, bool)
                            else str(hf_use_comfy_org_fallback).lower() == "true"
                        )
                        hf_use_brave_fallback = (
                            hf_use_brave_fallback
                            if isinstance(hf_use_brave_fallback, bool)
                            else str(hf_use_brave_fallback).lower() == "true"
                        )

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
                        force_search = data.get("force_search", False)
                        force_search = (
                            force_search
                            if isinstance(force_search, bool)
                            else str(force_search).lower() == "true"
                        )

                        update_search_progress(
                            progress_id,
                            progress_source,
                            "starting",
                            "Preparing search",
                            8,
                        )

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

                        def search_local_sources():
                            source_results = {"popular": None, "model_list": None}
                            source_found = False

                            update_search_progress(
                                progress_id,
                                "local",
                                "popular",
                                "Checking popular models",
                                28,
                            )
                            log_info(
                                "Search [local] start "
                                + format_log_fields(file=filename, cat=category)
                            )
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

                            update_search_progress(
                                progress_id,
                                "local",
                                "done",
                                "Local database checked",
                                92,
                            )
                            return source_results, source_found

                        def search_huggingface_source_task():
                            update_search_progress(
                                progress_id,
                                "huggingface",
                                "query",
                                "Querying HuggingFace",
                                32,
                            )
                            log_info(
                                "Search [huggingface] start "
                                + format_log_fields(file=filename)
                            )
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
                            update_search_progress(
                                progress_id,
                                "huggingface",
                                "done",
                                "HuggingFace checked",
                                92,
                            )
                            log_search_result("huggingface", hf_result)
                            return {"huggingface": hf_result}, bool(hf_result)

                        def search_civitai_source_task():
                            source_results = {"civitai": None}
                            source_found = False

                            update_search_progress(
                                progress_id,
                                "civitai",
                                "query",
                                "Querying CivitAI",
                                30,
                            )
                            log_info(
                                "Search [civitai] start "
                                + format_log_fields(
                                    file=filename,
                                    cat=category,
                                    urn=is_urn,
                                )
                            )
                            # For URNs, use direct model_id/version_id to get download URL
                            if is_urn:
                                # Get model_id and version_id from request data
                                model_id = data.get("model_id")
                                version_id = data.get("version_id")

                                if model_id and version_id:
                                    update_search_progress(
                                        progress_id,
                                        "civitai",
                                        "urn",
                                        "Resolving CivitAI URN",
                                        46,
                                    )
                                    # Use resolve_urn to get model info (cached)
                                    model_info = resolve_urn(model_id, version_id)
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
                                            version_id
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
                                            "url": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}",
                                            "model_id": model_id,
                                            "version_id": version_id,
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
                                                "model_id": model_id,
                                                "version_id": version_id,
                                            },
                                        )
                                elif category:
                                    # Fallback to search if no IDs
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
                                update_search_progress(
                                    progress_id,
                                    "civitai",
                                    "match",
                                    "Matching CivitAI files",
                                    48,
                                )
                                civitai_result = search_civitai_for_file(
                                    filename,
                                    model_type=category,
                                    base_model_context=base_model_context or None,
                                    session_token=civitai_session_token or None,
                                    candidate_limit=civitai_candidate_limit,
                                    use_trpc_search=civitai_use_trpc_search,
                                    use_html_fallback=civitai_use_html_fallback,
                                    progress_callback=make_source_progress_callback(
                                        "civitai"
                                    ),
                                )
                                log_search_result("civitai", civitai_result)
                                if not civitai_result and base_model_context:
                                    update_search_progress(
                                        progress_id,
                                        "civitai",
                                        "any_model",
                                        "Retrying CivitAI any model",
                                        72,
                                    )
                                    log_info(
                                        "Search [civitai] retry any model "
                                        + format_log_fields(
                                            file=filename,
                                            cat=category,
                                            base=base_model_context,
                                        )
                                    )
                                    civitai_result = search_civitai_for_file(
                                        filename,
                                        model_type=category,
                                        base_model_context=None,
                                        session_token=civitai_session_token or None,
                                        candidate_limit=civitai_candidate_limit,
                                        use_trpc_search=civitai_use_trpc_search,
                                        use_html_fallback=civitai_use_html_fallback,
                                        progress_callback=make_source_progress_callback(
                                            "civitai", 72, 92
                                        ),
                                    )
                                    log_search_result(
                                        "civitai/any_model",
                                        civitai_result,
                                    )
                                    if civitai_result:
                                        civitai_result = mark_any_model_fallback(
                                            civitai_result
                                        )
                                if civitai_result:
                                    source_results["civitai"] = civitai_result
                                    source_found = True

                            update_search_progress(
                                progress_id,
                                "civitai",
                                "done",
                                "CivitAI checked",
                                92,
                            )
                            return source_results, source_found

                        def search_civarchive_source_task():
                            source_results = {"civarchive": None}
                            source_found = False

                            update_search_progress(
                                progress_id,
                                "civarchive",
                                "query",
                                "Querying CivArchive",
                                30,
                            )
                            log_info(
                                "Search [civarchive] start "
                                + format_log_fields(
                                    file=filename,
                                    cat=category,
                                    urn=is_urn,
                                )
                            )
                            try:
                                if is_urn:
                                    model_id = data.get("model_id")
                                    version_id = data.get("version_id")
                                    if model_id and version_id:
                                        update_search_progress(
                                            progress_id,
                                            "civarchive",
                                            "urn",
                                            "Resolving CivArchive version",
                                            50,
                                        )
                                        civarchive_result = resolve_civarchive_model_version(
                                            model_id,
                                            version_id,
                                            query=filename,
                                        )
                                        log_search_result(
                                            "civarchive/urn",
                                            civarchive_result,
                                            {
                                                "model_id": model_id,
                                                "version_id": version_id,
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
                                                "model_id": model_id,
                                                "version_id": version_id,
                                            },
                                        )
                                else:
                                    update_search_progress(
                                        progress_id,
                                        "civarchive",
                                        "match",
                                        "Matching CivArchive files",
                                        48,
                                    )
                                    civarchive_result = search_civarchive_for_file(
                                        filename,
                                        model_type=category,
                                        base_model_context=base_model_context or None,
                                        limit=civarchive_candidate_limit,
                                        progress_callback=make_source_progress_callback(
                                            "civarchive"
                                        ),
                                    )
                                    log_search_result("civarchive", civarchive_result)
                                    if not civarchive_result and base_model_context:
                                        update_search_progress(
                                            progress_id,
                                            "civarchive",
                                            "any_model",
                                            "Retrying CivArchive any model",
                                            72,
                                        )
                                        log_info(
                                            "Search [civarchive] retry any model "
                                            + format_log_fields(
                                                file=filename,
                                                cat=category,
                                                base=base_model_context,
                                            )
                                        )
                                        civarchive_result = search_civarchive_for_file(
                                            filename,
                                            model_type=category,
                                            base_model_context=None,
                                            limit=civarchive_candidate_limit,
                                            progress_callback=make_source_progress_callback(
                                                "civarchive", 72, 92
                                            ),
                                        )
                                        log_search_result(
                                            "civarchive/any_model",
                                            civarchive_result,
                                        )
                                        if civarchive_result:
                                            civarchive_result = mark_any_model_fallback(
                                                civarchive_result
                                            )
                                    if civarchive_result:
                                        source_results["civarchive"] = civarchive_result
                                        source_found = True
                            except CivArchiveSearchError as e:
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
                                source_results["source_errors"] = {
                                    "civarchive": error_message
                                }

                            if not source_results.get("source_errors"):
                                update_search_progress(
                                    progress_id,
                                    "civarchive",
                                    "done",
                                    "CivArchive checked",
                                    92,
                                )
                            return source_results, source_found

                        def search_lora_manager_archive_source_task():
                            update_search_progress(
                                progress_id,
                                "lora_manager_archive",
                                "query",
                                "Searching LoRA Manager archive",
                                36,
                            )
                            log_info(
                                "Search [lora_manager_archive] start "
                                + format_log_fields(file=filename, cat=category)
                            )
                            lora_manager_archive_result = (
                                search_lora_manager_archive_for_file(
                                    filename,
                                    model_type=category,
                                    base_model_context=base_model_context or None,
                                    progress_callback=make_source_progress_callback(
                                        "lora_manager_archive"
                                    ),
                                )
                            )
                            log_search_result(
                                "lora_manager_archive",
                                lora_manager_archive_result,
                            )
                            if not lora_manager_archive_result and base_model_context:
                                update_search_progress(
                                    progress_id,
                                    "lora_manager_archive",
                                    "any_model",
                                    "Retrying LoRA archive any model",
                                    72,
                                )
                                log_info(
                                    "Search [lora_manager_archive] retry any model "
                                    + format_log_fields(
                                        file=filename,
                                        cat=category,
                                        base=base_model_context,
                                    )
                                )
                                lora_manager_archive_result = (
                                    search_lora_manager_archive_for_file(
                                        filename,
                                        model_type=category,
                                        base_model_context=None,
                                        progress_callback=make_source_progress_callback(
                                            "lora_manager_archive", 72, 92
                                        ),
                                    )
                                )
                                log_search_result(
                                    "lora_manager_archive/any_model",
                                    lora_manager_archive_result,
                                )
                                if lora_manager_archive_result:
                                    lora_manager_archive_result = (
                                        mark_any_model_fallback(
                                            lora_manager_archive_result
                                        )
                                    )
                            return (
                                {
                                    "lora_manager_archive": lora_manager_archive_result
                                },
                                bool(lora_manager_archive_result),
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

                        for source_results, source_found in await asyncio.gather(
                            *search_tasks
                        ):
                            for source_key, source_result in source_results.items():
                                if source_key == "source_errors":
                                    results["source_errors"].update(source_result or {})
                                    continue
                                if source_result:
                                    results[source_key] = source_result
                            if source_found:
                                results["found"] = True

                        results["local_hash_matches"] = collect_local_hash_matches(results)

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
                async def clear_search_cache_route(request):
                    """Clear backend search caches after token/settings changes."""
                    try:
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
                    except Exception as e:
                        log_exception(f"Clear search cache error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

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
                async def huggingface_author_index_status_route(request):
                    """Return local HuggingFace author fallback index status."""
                    try:
                        return web.json_response(get_author_fallback_index_status())
                    except Exception as e:
                        log_exception(f"HuggingFace author index status error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/huggingface/author-index/refresh")
                async def huggingface_author_index_refresh_route(request):
                    """Refresh HuggingFace author fallback index."""
                    try:
                        data = await request.json()
                        hf_token = data.get("hf_token", "")
                        result = await asyncio.to_thread(
                            refresh_author_fallback_index, hf_token or None
                        )
                        clear_huggingface_search_cache()
                        return web.json_response(result)
                    except Exception as e:
                        log_exception(f"HuggingFace author index refresh error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/model-list/status")
                async def model_list_status_route(request):
                    """Return local model-list status and optionally compare with GitHub."""
                    try:
                        check_remote = (
                            str(request.query.get("check_remote", "")).lower()
                            in {"1", "true", "yes"}
                        )
                        return web.json_response(
                            get_model_list_update_status(check_remote=check_remote)
                        )
                    except Exception as e:
                        log_exception(f"Model list status error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/model-list/update")
                async def model_list_update_route(request):
                    """Download latest ComfyUI-Manager model-list.json."""
                    try:
                        result = await asyncio.to_thread(update_model_list_from_remote)
                        clear_huggingface_search_cache()
                        clear_civitai_search_cache()
                        clear_civarchive_search_cache()
                        clear_lora_manager_archive_search_cache()
                        self.search_result_timestamps.clear()
                        return web.json_response(result)
                    except Exception as e:
                        log_exception(f"Model list update error: {e}")
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/download")
                async def download_model(request):
                    """Start downloading a model."""
                    try:
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
                        elif "civitai.com" in url:
                            civitai_key = data.get("civitai_key", "")
                            if civitai_key and "token=" not in url:
                                url += (
                                    f"{'&' if '?' in url else '?'}token={civitai_key}"
                                )

                        def _first_metadata_value(*values):
                            for value in values:
                                if value is None:
                                    continue
                                if isinstance(value, str) and not value.strip():
                                    continue
                                return value
                            return ""

                        def _metadata_int(value):
                            try:
                                return int(value)
                            except (TypeError, ValueError):
                                return None

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
                            }
                        )

                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver download error: {e}", exc_info=True
                        )
                        return web.json_response(
                            {"error": str(e), "success": False}, status=500
                        )

                @routes.get("/model_resolver/progress/{download_id}")
                async def get_download_progress(request):
                    """Get progress for a specific download."""
                    try:
                        download_id = request.match_info["download_id"]
                        progress = get_progress(download_id)

                        if progress:
                            return web.json_response(progress)
                        else:
                            return web.json_response(
                                {"error": "Download not found"}, status=404
                            )
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver progress error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/progress")
                async def get_all_downloads_progress(request):
                    """Get progress for all downloads."""
                    try:
                        progress = get_all_progress()
                        return web.json_response(progress)
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver progress error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.post("/model_resolver/cancel/{download_id}")
                async def cancel_download_route(request):
                    """Cancel a download in progress."""
                    try:
                        download_id = request.match_info["download_id"]
                        cancel_download(download_id)
                        return web.json_response({"success": True})
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver cancel error: {e}", exc_info=True
                        )
                        return web.json_response(
                            {"error": str(e), "success": False}, status=500
                        )

                @routes.get("/model_resolver/directories")
                async def get_directories(request):
                    """Get available model directories."""
                    try:
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
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver directories error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/root-directories")
                async def get_root_directories(request):
                    """Get configured ComfyUI root directories for path settings."""
                    try:
                        import os
                        import folder_paths

                        categories = [
                            "loras",
                            "checkpoints",
                            "diffusion_models",
                            "embeddings",
                            "text_encoders",
                            "vae",
                            "upscale_models",
                        ]
                        roots = {}
                        settings = load_resolver_settings()
                        comfy_root = get_comfy_root_path(folder_paths)
                        for cat in categories:
                            folder_key = normalize_download_category(cat)
                            candidate_keys = [folder_key]
                            if folder_key == "diffusion_models":
                                candidate_keys.append("unet")
                            elif folder_key == "text_encoders":
                                candidate_keys.append("clip")
                            paths = []
                            for candidate_key in candidate_keys:
                                paths.extend(folder_paths.get_folder_paths(candidate_key) or [])
                            preferred_directory = (
                                get_default_root_for_category(folder_key, settings)
                                or get_download_directory(folder_key)
                                or ""
                            )
                            normalized_paths = dedupe_local_base_directories(
                                paths,
                                preferred_directory=preferred_directory,
                                comfy_root=comfy_root,
                            )
                            roots[folder_key] = normalized_paths

                        return web.json_response(roots)
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver root directories error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/path-template-suggestions")
                async def get_path_template_suggestions(request):
                    """Infer path template presets from existing local model folders."""
                    try:
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
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver path template suggestions error: {e}",
                            exc_info=True,
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/capabilities")
                async def get_capabilities(request):
                    """Get optional source capabilities available in this install."""
                    try:
                        return web.json_response(
                            {
                                "sources": {
                                    "civarchive": is_civarchive_available(),
                                    "lora_manager_archive": is_lora_manager_archive_available()
                                }
                            }
                        )
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver capabilities error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

                @routes.get("/model_resolver/subfolders/{category}")
                async def get_subfolders(request):
                    """Get known subfolders for a category using ComfyUI folder_paths."""
                    try:
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
                    except Exception as e:
                        self.logger.error(
                            f"Model Resolver subfolders error: {e}", exc_info=True
                        )
                        return web.json_response({"error": str(e)}, status=500)

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
            async def get_settings_route(request):
                """Return persisted settings (API keys, preferences)."""
                try:
                    data = await asyncio.to_thread(load_resolver_settings)
                    return web.json_response(data)
                except Exception as e:
                    self.logger.error(f"Model Resolver settings GET error: {e}", exc_info=True)
                    return web.json_response({"error": str(e)}, status=500)

            @routes.post("/model_resolver/settings")
            async def save_settings_route(request):
                """Persist settings (API keys, preferences) to disk."""
                try:
                    payload = await request.json()
                    if not isinstance(payload, dict):
                        return web.json_response({"error": "Expected JSON object"}, status=400)
                    settings = await asyncio.to_thread(save_resolver_settings, payload)
                    _apply_backend_logging_settings(settings)
                    return web.json_response({"success": True})
                except Exception as e:
                    self.logger.error(f"Model Resolver settings POST error: {e}", exc_info=True)
                    return web.json_response({"error": str(e)}, status=500)

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

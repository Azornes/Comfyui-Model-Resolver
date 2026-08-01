"""
@author: Azornes
@title: ComfyUI Model Resolver
@version: 1.1.0
@description: Extension for resolving missing models and downloading from HuggingFace/CivitAI
"""

import asyncio
import os
import sys
import time
from typing import Any, Dict, Optional

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
from .core.file_manager import (
    FileManagerError,
    FileManagerUnavailableError,
    UnsupportedFileManagerPlatformError,
    normalize_file_manager_path,
    open_in_file_manager,
)
from .core.log_system import create_module_logger
from .core.path_utils import (
    MODEL_RESOLVER_METADATA_SCHEMA,
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
    get_filename_from_path,
    get_model_resolver_sidecar_path,
    get_safe_model_resolver_sidecar_path,
)
from .core.progress import JobProgressTracker
from .core.version import (
    PROJECT_GITHUB_PYPROJECT_URL,
    PROJECT_GITHUB_URL,
    PROJECT_VERSION_CACHE_TTL_SECONDS,
    PROJECT_VERSION_FILE,
    _extract_project_version,
    _get_local_project_version,
    _get_project_version_info,
    _project_version_cache,
    _project_version_cache_lock,
    _version_sort_key,
)

# Web directory for JavaScript interface
WEB_DIRECTORY = "./web"

MODEL_RESOLVER_DEPENDENCY_NODE_TYPE = "ModelResolverDependency"
MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME = "Model Resolver Opener"
MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY = "Model Resolver/Workflow"
MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION = (
    "This passive node declares Model Resolver as a workflow dependency and opens "
    "its tools. It does not process images, models, or prompts. To stop adding it "
    "automatically, open Model Resolver, go to Options -> Defaults -> and disable "
    "'Embed opener node'. We recommend keeping it in an unobtrusive part of the "
    "canvas: it helps ComfyUI-Manager identify and offer Model Resolver on other "
    "ComfyUI installations, making the workflow easier to use in the future."
)

try:
    from comfy_api.latest import ComfyExtension, io
except Exception:
    ComfyExtension = None
    io = None


if ComfyExtension is not None and io is not None:

    class ModelResolverDependencyNode(io.ComfyNode):
        """Canvas node that declares Model Resolver and opens its workflow tools."""

        @classmethod
        def define_schema(cls) -> io.Schema:
            return io.Schema(
                node_id=MODEL_RESOLVER_DEPENDENCY_NODE_TYPE,
                display_name=MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME,
                category=MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY,
                description=MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION,
                inputs=[],
                outputs=[],
            )

        @classmethod
        def execute(cls) -> io.NodeOutput:
            return io.NodeOutput()

    class ModelResolverNodeExtension(ComfyExtension):
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [ModelResolverDependencyNode]

    async def comfy_entrypoint() -> ComfyExtension:
        return ModelResolverNodeExtension()

    __all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
else:

    class ModelResolverDependencyNode:
        """Legacy fallback for ComfyUI builds without the v3 custom-node API."""

        DESCRIPTION = MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION
        RETURN_TYPES = ()
        FUNCTION = "noop"
        CATEGORY = MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY

        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {}}

        def noop(self):
            return ()

    NODE_CLASS_MAPPINGS = {
        MODEL_RESOLVER_DEPENDENCY_NODE_TYPE: ModelResolverDependencyNode,
    }
    NODE_DISPLAY_NAME_MAPPINGS = {
        MODEL_RESOLVER_DEPENDENCY_NODE_TYPE: MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME,
    }

    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


class ModelResolverExtension:
    """Main extension class for Model Resolver."""

    def __init__(self):
        self.routes_setup = False
        self.logger = create_module_logger(__name__)
        self.analysis_progress = JobProgressTracker("Analyzing...")
        self.loaded_progress = JobProgressTracker("Loading loaded models...")
        self.search_tracker = JobProgressTracker("Searching...")
        self.hash_tracker = JobProgressTracker("Preparing hash calculation...")
        self.metadata_builder_progress = JobProgressTracker("Building local metadata...")
        self.search_result_timestamps = {}

    def _update_analysis_progress(
        self,
        analysis_id: Optional[str],
        payload: Dict[str, Any],
    ) -> None:
        self.analysis_progress.update_from_payload(analysis_id, payload)

    def _update_metadata_build_progress(
        self,
        progress_id: Optional[str],
        progress_payload: Dict[str, Any]
    ) -> None:
        self.metadata_builder_progress.update_from_payload(progress_id, progress_payload)


    def _update_loaded_progress(
        self,
        loaded_id: Optional[str],
        stage: str,
        message: str,
        percent: Optional[float] = None,
        status: str = "running",
        current: int = 0,
        total: int = 0,
        **payload,
    ) -> None:
        if not loaded_id:
            return
        self.loaded_progress.update_from_payload(
            loaded_id,
            {
                "stage": stage,
                "message": message,
                "percent": percent,
                "status": status,
                "current": current,
                "total": total,
                **payload,
            },
        )

    def _update_workflow_analysis_progress(
        self,
        loaded_id: Optional[str],
        workflow_node_count: int,
        interpolate_percent_fn,
        payload: Dict[str, Any],
        start_percent: float = 35,
        end_percent: float = 78,
    ) -> None:
        progress_payload = dict(payload or {})
        current = progress_payload.pop("current", 0)
        total = progress_payload.pop("total", workflow_node_count)
        stage = progress_payload.pop("stage", "analyzing")
        message = progress_payload.pop("message", "Analyzing workflow nodes...")
        progress_payload.pop("percent", None)
        self._update_loaded_progress(
            loaded_id,
            stage,
            message,
            percent=interpolate_percent_fn(
                start_percent,
                end_percent,
                current,
                total,
            ),
            current=current,
            total=total,
            **progress_payload,
        )

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
        from .core.routes.registry import register_routes

        return register_routes(self)

# Initialize the extension
_module_log = create_module_logger(__name__)
try:
    extension = ModelResolverExtension()
    extension.initialize()
except Exception as e:
    _module_log.error(
        f"ComfyUI Model Resolver extension initialization failed: {e}", exc_info=True
    )

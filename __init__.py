"""
@author: Azornes
@title: ComfyUI Model Resolver
@version: 1.1.0
@description: Extension for resolving missing models and downloading from HuggingFace/CivitAI
"""

import os
import sys

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
from .core import node_definitions as _node_definitions
from .core.extension import ModelResolverExtension
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

ComfyExtension = _node_definitions.ComfyExtension
io = _node_definitions.io
ModelResolverDependencyNode = _node_definitions.ModelResolverDependencyNode
MODEL_RESOLVER_DEPENDENCY_NODE_TYPE = (
    _node_definitions.MODEL_RESOLVER_DEPENDENCY_NODE_TYPE
)
MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME = (
    _node_definitions.MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME
)
MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY = (
    _node_definitions.MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY
)
MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION = (
    _node_definitions.MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION
)

if ComfyExtension is not None and io is not None:
    ModelResolverNodeExtension = _node_definitions.ModelResolverNodeExtension
    comfy_entrypoint = _node_definitions.comfy_entrypoint
    __all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]
else:
    NODE_CLASS_MAPPINGS = _node_definitions.NODE_CLASS_MAPPINGS
    NODE_DISPLAY_NAME_MAPPINGS = _node_definitions.NODE_DISPLAY_NAME_MAPPINGS
    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


# Initialize the extension
_module_log = create_module_logger(__name__)
try:
    extension = ModelResolverExtension()
    extension.initialize()
except Exception as e:
    _module_log.error(
        f"ComfyUI Model Resolver extension initialization failed: {e}", exc_info=True
    )

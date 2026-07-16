"""
Directory Scanner Module

Scans configured model directories and finds available model files.
"""

import os
import time
from typing import Dict, List, Optional, Tuple

from .log_system import create_module_logger

log = create_module_logger(__name__)


from .path_utils import get_filename_from_path, get_path_identity

# Import folder_paths lazily - it may not be available until ComfyUI is initialized
try:
    import folder_paths
except ImportError:
    folder_paths = None
    log.warning("Model Resolver: folder_paths not available yet - will retry later")

_MODEL_FILES_CACHE: Optional[List[Dict[str, str]]] = None
_MODEL_FILES_CACHE_AT: float = 0.0
_MODEL_FILES_CACHE_TTL_SECONDS = 2.0


def _path_identity(path: str) -> str:
    """Return a stable identity for dedupe across symlinks/junctions."""
    return get_path_identity(path)


def _directory_identity(path: str) -> str:
    """Return a stable identity for loop detection across symlinks/junctions."""
    return _path_identity(path)


def _model_identity(model: Dict[str, str]) -> str:
    path = model.get("path", "")
    if not path:
        return ""

    try:
        return _path_identity(path)
    except (OSError, ValueError):
        return os.path.normcase(os.path.abspath(path))


def get_model_directories() -> Dict[str, Tuple[List[str], set]]:
    """
    Get all configured model directories from folder_paths.

    Returns:
        Dictionary mapping category name to a tuple. ComfyUI may provide either:
        - (paths, extensions), or
        - (paths, extensions, recursive_flag)
    """
    global folder_paths

    if folder_paths is None:
        # Try to import again
        try:
            import folder_paths as fp

            folder_paths = fp
        except ImportError:
            log.error("Model Resolver: folder_paths still not available")
            return {}

    return folder_paths.folder_names_and_paths.copy()


def scan_directory(
    directory: str, extensions: set, category: str
) -> List[Dict[str, str]]:
    """
    Recursively scan a single directory for model files.

    Args:
        directory: Absolute path to directory to scan
        extensions: Set of file extensions to look for
        category: Model category name (e.g., 'checkpoints', 'loras')

    Returns:
        List of dictionaries with model information:
        {
            'filename': 'model.safetensors',
            'path': 'absolute/path/to/model.safetensors',
            'relative_path': 'subfolder/model.safetensors' or 'model.safetensors',
            'category': 'checkpoints',
            'base_directory': 'absolute/path/to/base'
        }
    """
    models = []

    if not os.path.exists(directory) or not os.path.isdir(directory):
        # log.debug(f"Directory does not exist or is not accessible: {directory}")
        return models

    try:
        # Get absolute path and normalize
        base_directory = os.path.abspath(directory)
        visited_dirs = set()

        # Walk through directory recursively
        for root, dirs, files in os.walk(base_directory, followlinks=True):
            try:
                root_identity = _directory_identity(root)
            except (OSError, ValueError):
                root_identity = os.path.normcase(os.path.abspath(root))

            if root_identity in visited_dirs:
                dirs[:] = []
                continue

            visited_dirs.add(root_identity)

            # Skip hidden directories and symlink/junction loops.
            filtered_dirs = []
            for dirname in dirs:
                if dirname.startswith("."):
                    continue

                child_path = os.path.join(root, dirname)
                try:
                    child_identity = _directory_identity(child_path)
                except (OSError, ValueError):
                    child_identity = os.path.normcase(os.path.abspath(child_path))

                if child_identity in visited_dirs:
                    continue

                filtered_dirs.append(dirname)

            dirs[:] = filtered_dirs

            if "folder" in (extensions or set()) and root != base_directory:
                if category != "diffusers" or "model_index.json" in files:
                    try:
                        relative_path = os.path.relpath(root, base_directory)
                    except ValueError:
                        relative_path = get_filename_from_path(root)

                    models.append(
                        {
                            "filename": get_filename_from_path(root),
                            "path": root,
                            "relative_path": relative_path,
                            "category": category,
                            "base_directory": base_directory,
                        }
                    )

            for filename in files:
                # Check if file has a model extension
                file_ext = os.path.splitext(filename)[1].lower()

                # Categories with explicit extensions must keep those boundaries.
                # Custom nodes may register aliases such as model_gguf against the
                # diffusion_models roots, but only .gguf files belong to that alias.
                if len(extensions or set()) == 0 or file_ext in extensions:
                    full_path = os.path.join(root, filename)

                    # Calculate relative path from base directory
                    # IMPORTANT: Use OS-native path separators (backslashes on Windows)
                    # This matches ComfyUI's recursive_search format for get_filename_list
                    try:
                        relative_path = os.path.relpath(full_path, base_directory)
                        # DO NOT normalize - keep OS-native separators to match ComfyUI
                        # ComfyUI's get_filename_list uses os.path.relpath which returns
                        # backslashes on Windows, forward slashes on Unix
                    except ValueError:
                        # If paths are on different drives (Windows), use filename only
                        relative_path = filename

                    models.append(
                        {
                            "filename": filename,
                            "path": full_path,
                            "relative_path": relative_path,
                            "category": category,
                            "base_directory": base_directory,
                        }
                    )
    except (OSError, PermissionError) as e:
        log.warning(f"Error scanning directory {directory}: {e}")

    return models


def scan_all_directories() -> List[Dict[str, str]]:
    """
    Scan all configured model directories and return list of available models.

    Returns:
        List of dictionaries with model information (same format as scan_directory)
    """
    all_models = []
    directories = get_model_directories()
    seen_scan_roots = set()
    seen_models = set()

    for category, value in directories.items():
        # Skip categories that aren't typically model directories
        if category in ["custom_nodes", "configs"]:
            continue

        # Unpack folder_paths value flexibly: (paths, extensions) or (paths, extensions, recursive)
        paths = []
        extensions = set()
        try:
            if isinstance(value, (list, tuple)):
                if len(value) >= 2:
                    paths = value[0] or []
                    raw_exts = value[1]
                else:
                    # Unexpected format; treat value as paths
                    paths = list(value)
                    raw_exts = []
            elif isinstance(value, dict):
                paths = value.get("paths") or value.get("path") or []
                raw_exts = value.get("extensions") or []
            else:
                # Unknown format; skip category
                log.debug(
                    f"Unexpected folder_paths format for category {category}: {type(value)}"
                )
                continue

            # Normalize extensions to a set[str]
            if isinstance(raw_exts, (list, tuple, set)):
                extensions = {str(e).lower() for e in raw_exts}
            elif raw_exts:
                extensions = {str(raw_exts).lower()}
        except Exception as e:
            log.warning(f"Error interpreting folder_paths entry for {category}: {e}")
            continue

        for directory_path in paths:
            try:
                try:
                    root_identity = _directory_identity(directory_path)
                except (OSError, ValueError):
                    root_identity = os.path.normcase(os.path.abspath(directory_path))

                root_key = (category, root_identity)
                if root_key in seen_scan_roots:
                    continue
                seen_scan_roots.add(root_key)

                models = scan_directory(directory_path, extensions, category)
                for model in models:
                    identity = _model_identity(model)
                    model_key = (model.get("category", category), identity)
                    if identity and model_key in seen_models:
                        continue
                    if identity:
                        seen_models.add(model_key)
                    all_models.append(model)
                #log.debug(f"Found {len(models)} models in {category}/{directory_path}")
            except Exception as e:
                log.warning(f"Error scanning {category} directory {directory_path}: {e}")

    return all_models


def invalidate_model_files_cache() -> None:
    """Clear the in-memory model file cache."""
    global _MODEL_FILES_CACHE, _MODEL_FILES_CACHE_AT
    _MODEL_FILES_CACHE = None
    _MODEL_FILES_CACHE_AT = 0.0


def get_model_files(force_rescan: bool = False) -> List[Dict[str, str]]:
    """
    Get list of all available model files with metadata.

    This is the main entry point for getting model files.

    Args:
        force_rescan: If True, bypass the short-lived cache and rescan directories

    Returns:
        List of model dictionaries (same format as scan_directory)
    """
    global _MODEL_FILES_CACHE, _MODEL_FILES_CACHE_AT

    now = time.monotonic()
    if (
        not force_rescan
        and _MODEL_FILES_CACHE is not None
        and (now - _MODEL_FILES_CACHE_AT) < _MODEL_FILES_CACHE_TTL_SECONDS
    ):
        return _MODEL_FILES_CACHE

    models = scan_all_directories()
    _MODEL_FILES_CACHE = models
    _MODEL_FILES_CACHE_AT = now
    return models


def find_local_file_path(filename: str, category: Optional[str] = None) -> Optional[str]:
    """
    Tries to find the absolute path of a model file locally using folder_paths or the local scanner.
    """
    if not filename:
        return None

    global folder_paths
    if folder_paths is None:
        try:
            import folder_paths as fp
            folder_paths = fp
        except ImportError:
            pass

    file_path = None
    if category and folder_paths is not None:
        try:
            from .type_utils import normalize_download_category
            folder_type = normalize_download_category(category)
            file_path = folder_paths.get_full_path(folder_type, filename)
        except Exception:
            pass

    if not file_path:
        try:
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

    return file_path

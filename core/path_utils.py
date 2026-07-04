"""
Path Utilities Module

Provides helper functions for path normalization, symlink resolution,
and directory matching to be shared across all modules.
"""

import os
import json
import hashlib
from typing import Any, Tuple, Optional, Callable, Iterable, List


_log = None


def _get_log():
    """Return a lazily-created module logger (avoids circular imports)."""
    global _log
    if _log is None:
        from .log_system import create_module_logger
        _log = create_module_logger(__name__)
    return _log



def get_path_identity(path: str) -> str:
    """Return a stable path identity across symlinks/junctions."""
    if not path:
        return ""

    try:
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))
    except (OSError, ValueError):
        return os.path.normcase(os.path.abspath(path))


def get_path_abs(path_value: Any) -> str:
    """Return absolute path safely, handling OSError/ValueError."""
    try:
        return os.path.abspath(str(path_value or ""))
    except (OSError, ValueError):
        return str(path_value or "")


def get_path_key(path_value: Any) -> str:
    """Return a normalized absolute path key for comparison."""
    if not path_value:
        return ""
    try:
        return os.path.normcase(os.path.abspath(str(path_value)))
    except (OSError, ValueError):
        return os.path.normcase(str(path_value or ""))


def is_path_within(path_value: Any, root_value: Any) -> bool:
    """Check if a path is located within a root directory."""
    if not path_value or not root_value:
        return False
    try:
        path_key = get_path_identity(str(path_value))
        root_key = get_path_identity(str(root_value))
        return os.path.commonpath([path_key, root_key]) == root_key
    except Exception:
        return False


def _get_folder_paths_module(folder_paths_module: Optional[Any] = None) -> Optional[Any]:
    if folder_paths_module is not None:
        return folder_paths_module
    try:
        import folder_paths
        return folder_paths
    except ImportError:
        return None


def _coerce_folder_paths(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if not isinstance(value, (list, tuple)):
        return []
    if value and isinstance(value[0], (list, tuple, set)):
        return [str(path) for path in value[0] if path]
    return [str(path) for path in value if isinstance(path, str) and path]


def get_configured_model_roots(
    folder_paths_module: Optional[Any] = None,
    *,
    skip_keys: Optional[Iterable[str]] = None,
) -> List[str]:
    """Return all configured ComfyUI model roots, including external model folders."""
    fp = _get_folder_paths_module(folder_paths_module)
    if fp is None:
        return []

    skipped = {str(key).strip().lower() for key in (skip_keys or {"custom_nodes", "configs"})}
    names = []
    folder_names_and_paths = getattr(fp, "folder_names_and_paths", None)
    if isinstance(folder_names_and_paths, dict):
        names = list(folder_names_and_paths.keys())
    else:
        try:
            get_folder_names = getattr(fp, "get_folder_names", None)
            if callable(get_folder_names):
                names = list(get_folder_names() or [])
        except Exception:
            names = []

    roots: List[str] = []
    seen = set()
    for raw_name in names:
        name = str(raw_name or "").strip()
        if not name or name.lower() in skipped:
            continue

        paths = []
        try:
            get_folder_paths = getattr(fp, "get_folder_paths", None)
            if callable(get_folder_paths):
                paths = list(get_folder_paths(name) or [])
        except Exception:
            paths = []

        if not paths and isinstance(folder_names_and_paths, dict):
            paths = _coerce_folder_paths(folder_names_and_paths.get(name))

        for path in paths:
            if not path:
                continue
            absolute_path = os.path.abspath(os.path.normpath(str(path)))
            identity = get_path_identity(absolute_path)
            if identity in seen:
                continue
            seen.add(identity)
            roots.append(absolute_path)

    return roots


def is_path_in_configured_model_roots(
    path_value: Any,
    folder_paths_module: Optional[Any] = None,
) -> bool:
    """Return True when a path is inside a configured ComfyUI model root."""
    if not path_value:
        return False
    return any(
        is_path_within(path_value, root)
        for root in get_configured_model_roots(folder_paths_module)
    )


def prefer_local_base_directory(
    candidate: str,
    current: str,
    preferred_directory: str = "",
    comfy_root: str = "",
) -> bool:
    """Determine if candidate directory should be preferred over current directory."""
    if not current:
        return True
    if not candidate:
        return False

    candidate_key = get_path_key(candidate)
    current_key = get_path_key(current)
    preferred_key = get_path_key(preferred_directory)
    if preferred_key:
        if candidate_key == preferred_key and current_key != preferred_key:
            return True
        if current_key == preferred_key and candidate_key != preferred_key:
            return False

    if comfy_root:
        candidate_is_external = not is_path_within(candidate, comfy_root)
        current_is_external = not is_path_within(current, comfy_root)
        if candidate_is_external != current_is_external:
            return candidate_is_external

    candidate_is_canonical = candidate_key == get_path_identity(candidate)
    current_is_canonical = current_key == get_path_identity(current)
    if candidate_is_canonical != current_is_canonical:
        return candidate_is_canonical

    return False


def dedupe_local_base_directories(
    paths: list,
    preferred_directory: str = "",
    comfy_root: str = "",
) -> list:
    """Deduplicate a list of directory paths, resolving symlinks/junctions."""
    by_identity = {}
    ordered_identities = []
    for path in paths or []:
        if not path or not os.path.isdir(path):
            continue
        path_abs = get_path_abs(path)
        path_identity = get_path_identity(path_abs)
        if not path_identity:
            continue

        current = by_identity.get(path_identity)
        if not current:
            by_identity[path_identity] = path_abs
            ordered_identities.append(path_identity)
        elif prefer_local_base_directory(
            path_abs,
            current,
            preferred_directory,
            comfy_root,
        ):
            by_identity[path_identity] = path_abs

    return [by_identity[key] for key in ordered_identities]


def write_json_atomic(
    file_path: str,
    data: Any,
    indent: Optional[int] = None,
    separators: Optional[Tuple[str, str]] = None,
) -> None:
    """Safely write data to a JSON file using a temporary file and atomic replace."""
    import tempfile
    import json
    
    dir_name = os.path.dirname(file_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
        
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(file_path)}.",
        suffix=".tmp",
        dir=dir_name or None,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, separators=separators, ensure_ascii=False)
            if indent is not None:
                f.write("\n")
        os.replace(tmp_path, file_path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def get_filename_from_path(path: Any) -> str:
    """Return the filename/basename of a path, handling both forward and backward slashes."""
    if not path:
        return ""
    return str(path).replace("\\", "/").split("/")[-1]


# Path to metadata directory
METADATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "metadata"
)


class HashCalculationCancelled(Exception):
    """Exception raised when file SHA256 calculation is cancelled by the caller."""
    pass


def calculate_file_sha256(
    file_path: str,
    chunk_size: int = 131072,
    on_progress: Optional[Callable[[int, int], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
) -> Optional[str]:
    """Calculate SHA256 hex digest for an existing local file safely, supporting progress callbacks and cancellation check."""
    if not file_path or not os.path.exists(file_path):
        return None
    sha256_hash = hashlib.sha256()
    try:
        total_bytes = os.path.getsize(file_path) if on_progress else 0
        bytes_read = 0
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(chunk_size), b""):
                if is_cancelled and is_cancelled():
                    raise HashCalculationCancelled("Hash calculation cancelled")
                if byte_block:
                    sha256_hash.update(byte_block)
                    bytes_read += len(byte_block)
                    if on_progress:
                        on_progress(bytes_read, total_bytes)
        return sha256_hash.hexdigest()
    except HashCalculationCancelled:
        raise
    except Exception as e:
        _get_log().error(f"Error computing hash for {file_path}: {e}")
        return None


def save_catalog_with_backup(
    data_path: str, data: Any, meta_path: str, meta: Any, indent: int = 2
) -> None:
    """Backup an existing catalog file to .bak, then atomically write the new data and its metadata."""
    import shutil
    # Ensure directory exists
    dir_name = os.path.dirname(data_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
    
    # Backup existing data file
    if os.path.exists(data_path):
        shutil.copy2(data_path, f"{data_path}.bak")
            
    # Write data file atomically
    write_json_atomic(data_path, data, indent=indent)
    
    # Write metadata file atomically
    write_json_atomic(meta_path, meta, indent=indent)


def read_json_safe(file_path: str, default: Any = None) -> Any:
    """Safely read and parse a JSON file, returning a default value on error."""
    if not file_path or not os.path.exists(file_path):
        return default
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        _get_log().warning(f"Error reading JSON from {os.path.basename(file_path)}: {e}")
        return default


def get_comfy_root_path(folder_paths_module: Optional[Any] = None) -> str:
    """Return the absolute path to the ComfyUI root directory."""
    fp = folder_paths_module
    if fp is None:
        try:
            import folder_paths
            fp = folder_paths
        except ImportError:
            return ""
    try:
        module_file = getattr(fp, "__file__", "")
        if module_file:
            return os.path.dirname(os.path.abspath(module_file))
    except Exception:
        pass
    return ""


def find_metadata_sidecar_path(model_path: str) -> str:
    """
    Find an existing metadata sidecar file (for example .metadata.json,
    .civitai.info, or .json) associated with a model file and return its
    absolute path. Returns an empty string when no sidecar exists.
    """
    if not model_path:
        return ""

    directory = os.path.dirname(model_path)
    filename = get_filename_from_path(model_path)
    normalized_model_path = os.path.normcase(os.path.abspath(model_path))

    # Base name without extension
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

    # Name patterns based on civitai.py and resolver.py.
    possible_names = [
        base_name + ".metadata.json",
        filename + ".metadata.json",
        base_name + ".civitai.info",
        filename + ".civitai.info",
        base_name + ".json",
        filename + ".json",
        filename.replace("_", " ").split()[0] + ".metadata.json" if "_" in base_name else None,
    ]

    for name in possible_names:
        if name:
            path = os.path.join(directory, name)
            if os.path.normcase(os.path.abspath(path)) == normalized_model_path:
                continue
            if os.path.exists(path):
                return path

    return ""

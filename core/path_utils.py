"""
Path Utilities Module

Provides helper functions for path normalization, symlink resolution,
and directory matching to be shared across all modules.
"""

import os
import json
import hashlib
from typing import Any, Tuple, Optional



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
        path_key = get_path_key(path_value)
        root_key = get_path_key(root_value)
        return os.path.commonpath([path_key, root_key]) == root_key
    except Exception:
        return False


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


def calculate_file_sha256(file_path: str, chunk_size: int = 131072) -> Optional[str]:
    """Calculate SHA256 hex digest for an existing local file safely."""
    if not file_path or not os.path.exists(file_path):
        return None
    sha256_hash = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(chunk_size), b""):
                if byte_block:
                    sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
    except Exception as e:
        from .log_system.log_funcs import create_module_logger
        _log = create_module_logger(__name__)
        _log.error(f"Error computing hash for {file_path}: {e}")
        return None


def read_json_safe(file_path: str, default: Any = None) -> Any:
    """Safely read and parse a JSON file, returning a default value on error."""
    if not file_path or not os.path.exists(file_path):
        return default
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        from .log_system.log_funcs import create_module_logger
        _log = create_module_logger(__name__)
        _log.warning(f"Error reading JSON from {os.path.basename(file_path)}: {e}")
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




"""
Path Utilities Module

Provides helper functions for path normalization, symlink resolution,
and directory matching to be shared across all modules.
"""

import os
from typing import Any


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

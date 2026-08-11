"""Download directory resolution used by the downloader facade."""

import os
from typing import Any, List, Optional

from .dependencies import require_download_dependencies


def get_download_directory(
    category: str,
    preferred_base_directory: str = "",
    *,
    dependencies: Any = None,
) -> Optional[str]:
    """Get the appropriate download directory for a model category."""
    facade = require_download_dependencies(dependencies, "download directory")
    folder_paths = facade.folder_paths

    if folder_paths is None:
        # Try to import again - ComfyUI might have initialized since last check.
        try:
            import folder_paths as fp

            folder_paths = fp
            facade.folder_paths = fp
        except ImportError:
            return None

    folder_keys = facade.get_category_folder_keys(category)
    folder_key = folder_keys[0]

    def _normalize(path_value: str) -> str:
        return facade.get_path_identity(path_value)

    def _is_within(path_value: str, root_value: str) -> bool:
        return facade.is_path_within(path_value, root_value)

    def _choose_preferred_path(
        paths: List[str],
        preferred_key: str = "",
    ) -> Optional[str]:
        if not paths:
            return None

        comfy_root = facade.get_comfy_root_path(folder_paths)

        def _basename(path_value: str) -> str:
            return facade.get_filename_from_path(os.path.normpath(path_value)).lower()

        def _prefer_redirected(candidate_paths: List[str]) -> Optional[str]:
            if not candidate_paths:
                return None
            if comfy_root:
                redirected_paths = [
                    path for path in candidate_paths if not _is_within(path, comfy_root)
                ]
                if redirected_paths:
                    return redirected_paths[0]
            return candidate_paths[0]

        if preferred_key == "diffusion_models":
            canonical_paths = [path for path in paths if _basename(path) == "diffusion_models"]
            preferred_path = _prefer_redirected(canonical_paths)
            if preferred_path:
                return preferred_path

            non_legacy_paths = [path for path in paths if _basename(path) != "unet"]
            preferred_path = _prefer_redirected(non_legacy_paths)
            if preferred_path:
                return preferred_path

        if preferred_key == "text_encoders":
            canonical_paths = [path for path in paths if _basename(path) == "text_encoders"]
            preferred_path = _prefer_redirected(canonical_paths)
            if preferred_path:
                return preferred_path

            non_legacy_paths = [path for path in paths if _basename(path) != "clip"]
            preferred_path = _prefer_redirected(non_legacy_paths)
            if preferred_path:
                return preferred_path

        if comfy_root:
            redirected_paths = [path for path in paths if not _is_within(path, comfy_root)]
            if redirected_paths:
                return redirected_paths[0]

        return paths[0]

    def _get_folder_paths(folder_name: str) -> List[str]:
        """Return paths for one key without rejecting the other aliases."""
        try:
            return list(folder_paths.get_folder_paths(folder_name) or [])
        except Exception as exc:
            facade.log.debug(
                f"Could not get folder path for {folder_name}: {exc}"
            )
            return []

    def _get_folder_names() -> List[str]:
        """Read folder names across ComfyUI versions."""
        get_folder_names = getattr(folder_paths, "get_folder_names", None)
        if callable(get_folder_names):
            try:
                return list(get_folder_names() or [])
            except Exception as exc:
                facade.log.debug(f"Could not get folder names: {exc}")

        folder_registry = getattr(folder_paths, "folder_names_and_paths", {})
        if isinstance(folder_registry, dict):
            return list(folder_registry.keys())
        return []

    try:
        paths = []
        seen_paths = set()
        for candidate_key in folder_keys:
            for path in _get_folder_paths(candidate_key):
                path_key = _normalize(path)
                if path_key in seen_paths:
                    continue
                seen_paths.add(path_key)
                paths.append(path)
        if paths:
            if preferred_base_directory:
                preferred_normalized = _normalize(preferred_base_directory)
                for path in paths:
                    if _normalize(path) == preferred_normalized:
                        return path
            return _choose_preferred_path(paths, folder_key)

        # If category not found, try to get any models directory as fallback.
        all_names = _get_folder_names()
        for fallback_key in all_names:
            fallback_paths = _get_folder_paths(fallback_key)
            if fallback_paths:
                return _choose_preferred_path(fallback_paths, fallback_key)
    except Exception as e:
        facade.log.debug(f"Could not get folder path for {folder_key}: {e}")

    return None

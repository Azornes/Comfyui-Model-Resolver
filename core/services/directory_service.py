"""Directory and subfolder discovery used by HTTP route adapters."""

import os

from ..routes.context import RouteContext


class DirectoryService:
    """Coordinate configured model directory and subfolder discovery."""

    def __init__(self, context: RouteContext):
        self.template_key_aliases = context.get("TEMPLATE_KEY_ALIASES")
        self.dedupe_local_base_directories = context.get(
            "dedupe_local_base_directories"
        )
        self.get_category_folder_keys = context.get("get_category_folder_keys")
        self.get_comfy_root_path = context.get("get_comfy_root_path")
        self.get_default_root_for_category = context.get(
            "get_default_root_for_category"
        )
        self.get_download_directory = context.get("get_download_directory")
        self.get_enabled_download_categories = context.get(
            "get_enabled_download_categories"
        )
        self.get_local_path_identity = context.get("get_local_path_identity")
        self.is_civarchive_available = context.get("is_civarchive_available")
        self.is_lora_manager_archive_available = context.get(
            "is_lora_manager_archive_available"
        )
        self.load_resolver_settings = context.get("load_resolver_settings")
        self.normalize_download_category = context.get(
            "normalize_download_category"
        )
        self.prefer_local_base_directory = context.get(
            "prefer_local_base_directory"
        )
        self.extension = context.get("self")
        self.split_path_segments = context.get("split_path_segments")
        self.web = context.get("web")

    async def get_directories(self, request):
        """Get available model directories."""
        import folder_paths

        categories = self.get_enabled_download_categories(
            list(folder_paths.folder_names_and_paths.keys())
        )
        directories = {}
        for category in categories:
            path = self.get_download_directory(category)
            if path:
                directories[category] = path

        return self.web.json_response(directories)

    async def get_root_directories(self, request):
        """Get configured ComfyUI root directories for path settings."""
        import folder_paths

        known_categories = set(folder_paths.folder_names_and_paths.keys())
        skip_categories = {"custom_nodes", "configs"}
        categories = self.get_enabled_download_categories(
            list(known_categories)
        )
        category_source_keys = {}
        for category in [*known_categories]:
            folder_key = self.normalize_download_category(category)
            if folder_key:
                category_source_keys.setdefault(folder_key, []).append(category)

        roots = {}
        settings = self.load_resolver_settings()
        comfy_root = self.get_comfy_root_path(folder_paths)
        for category in categories:
            folder_key = self.normalize_download_category(category)
            if folder_key in known_categories:
                raw_candidate_keys = [folder_key]
            else:
                raw_candidate_keys = [
                    folder_key,
                    *self.template_key_aliases.get(folder_key, ()),
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
            preferred_directory = self.get_default_root_for_category(
                folder_key,
                settings,
            )
            normalized_paths = self.dedupe_local_base_directories(
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
            roots[raw_key] = self.dedupe_local_base_directories(
                raw_paths,
                comfy_root=comfy_root,
            )

        return self.web.json_response(roots)

    async def get_capabilities(self, request):
        """Get optional source capabilities available in this install."""
        from ..workflow_analyzer import NODE_TYPE_MODEL_WIDGET_CATEGORIES

        return self.web.json_response(
            {
                "sources": {
                    "civarchive": self.is_civarchive_available(),
                    "lora_manager_archive": self.is_lora_manager_archive_available(),
                },
                "node_rules": NODE_TYPE_MODEL_WIDGET_CATEGORIES,
            }
        )

    async def get_subfolders(self, request):
        """Get known subfolders for a category using ComfyUI folder_paths."""
        import folder_paths

        raw_category = (request.match_info.get("category") or "").strip()
        category = self.normalize_download_category(raw_category)

        if not category or category == "unknown":
            return self.web.json_response([])

        known_categories = set(folder_paths.folder_names_and_paths.keys())
        folder_keys = self.get_category_folder_keys(category)
        available_folder_keys = [
            folder_key for folder_key in folder_keys if folder_key in known_categories
        ]
        if not available_folder_keys:
            self.extension.logger.debug(
                f"Model Resolver: skipping subfolder lookup for unknown category "
                f"'{raw_category}' -> '{category}'"
            )
            return self.web.json_response([])

        subfolders = {}
        settings = self.load_resolver_settings()
        comfy_root = self.get_comfy_root_path(folder_paths)
        preferred_directory = (
            self.get_default_root_for_category(category, settings)
            or self.get_download_directory(category)
            or ""
        )

        def add_subfolder(rel_path, base_dir=""):
            rel_path = "/".join(self.split_path_segments(rel_path))
            if not rel_path or rel_path == ".":
                return
            base_dir = os.path.abspath(base_dir) if base_dir else ""
            base_identity = (
                self.get_local_path_identity(base_dir) if base_dir else ""
            )
            key = (rel_path.lower(), base_identity)
            base_label = (
                os.path.basename(os.path.normpath(base_dir))
                if base_dir
                else ""
            )
            current = subfolders.get(key)
            if current and not self.prefer_local_base_directory(
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
        base_dirs = self.dedupe_local_base_directories(
            raw_base_dirs,
            preferred_directory=preferred_directory,
            comfy_root=comfy_root,
        )

        def find_base_dir(full_path):
            if not full_path:
                return ""
            full_path_identity = self.get_local_path_identity(full_path)
            for base_dir in base_dirs:
                base_identity = self.get_local_path_identity(base_dir)
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
                parts = self.split_path_segments(rel_path)
                if len(parts) <= 1:
                    continue
                current = ""
                for part in parts[:-1]:
                    current = f"{current}/{part}" if current else part
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

        return self.web.json_response(
            sorted(
                response_items,
                key=lambda item: (
                    item.get("value", "").lower(),
                    item.get("base_directory", "").lower(),
                ),
            )
        )

"""Central route registration for the Model Resolver backend."""

# Route modules receive these optional imports through the registration context.
# ruff: noqa: F401

import asyncio
import os
import time

from ..file_manager import (
    FileManagerError,
    FileManagerUnavailableError,
    UnsupportedFileManagerPlatformError,
    normalize_file_manager_path,
    open_in_file_manager,
)
from ..path_utils import (
    MODEL_RESOLVER_METADATA_SCHEMA,
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
    get_model_resolver_sidecar_path,
    get_safe_model_resolver_sidecar_path,
)


def register_routes(self):
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
            from ..custom_nodes import (
                adapt_custom_node_loaded_model,
                should_skip_existing_custom_node_reference,
            )
            from ..metadata_audit import audit_metadata_sizes
            from ..metadata_builder import (
                build_missing_local_metadata,
                get_metadata_build_capabilities,
                normalize_metadata_build_mode,
            )
            from ..network_utils import (
                UnsafeUrlError,
                host_matches_domain,
                request_public_url,
                validate_public_http_url,
            )
            from ..path_templates import infer_download_path_templates
            from ..path_utils import (
                HashCalculationCancelled,
                dedupe_local_base_directories,
                find_external_metadata_sidecar_path,
                get_comfy_root_path,
                get_filename_from_path,
                is_path_in_configured_model_roots,
                prefer_local_base_directory,
                read_json_safe,
                split_path_segments,
                write_json_atomic,
            )
            from ..path_utils import (
                get_path_identity as get_local_path_identity,
            )
            from ..resolver import (
                analyze_and_find_matches,
                apply_resolution,
                get_local_model_hash_metadata,
                invalidate_local_hash_match_cache,
                search_local_matches,
                search_local_matches_by_hash,
            )
            from ..scanner import find_local_file_path, get_model_files, invalidate_model_files_cache
            from ..settings import (
                TEMPLATE_KEY_ALIASES,
                get_default_root_for_category,
                resolve_download_subfolder,
            )
            from ..settings import (
                bool_setting as resolver_bool_setting,
            )
            from ..settings import (
                load_settings as load_resolver_settings,
            )
            from ..settings import (
                save_settings as save_resolver_settings,
            )
            from ..type_utils import (
                build_search_result,
                extract_sha256_from_metadata,
                fetch_remote_file_size_cached,
                first_non_empty,
                format_size_bytes,
                get_category_folder_keys,
                get_enabled_download_categories,
                looks_like_model_file,
                normalize_category_to_model_type,
                normalize_sha256,
                to_bool,
                to_int,
            )
            from ..workflow_analyzer import (
                get_workflow_model_inventory,
            )
            from .base_models import register_base_model_routes
            from .directories import register_directory_routes
            from .downloads import register_download_routes
            from .helpers import create_route_helpers
            from .metadata import register_metadata_routes
            from .model_info import register_model_info_routes
            from .search import register_search_routes
            from .settings import register_settings_routes
            from .version import register_version_routes
            from .workflow import (
                register_loaded_model_routes,
                register_workflow_routes,
            )
        except ImportError as e:
            self.logger.error(f"Model Resolver: Could not import core modules: {e}")
            return False

        # Import download modules
        try:
            from ..aria2_installer import Aria2InstallError, install_aria2_engine
            from ..downloader import (
                cancel_download,
                clear_completed_downloads,
                get_all_progress,
                get_aria2_status,
                get_download_directory,
                get_existing_model_preview_path,
                get_progress,
                is_allowed_model_download_filename,
                normalize_download_category,
                pause_download,
                resume_download,
                sanitize_download_filename,
                start_aria2_daemon,
                start_background_download,
                stop_aria2_daemon,
                write_model_resolver_metadata,
            )
            from ..sources import clear_all_search_caches
            from ..sources.civarchive import (
                CivArchiveSearchError,
                build_civarchive_custom_result,
                get_civarchive_model_details,
                is_civarchive_available,
                parse_civarchive_url,
                resolve_civarchive_by_hash,
                resolve_civarchive_model_version,
                search_civarchive_for_file,
            )
            from ..sources.civarchive import (
                clear_search_cache as clear_civarchive_search_cache,
            )
            from ..sources.civitai import (
                build_civitai_custom_result,
                check_civitai_api_key,
                check_civitai_session_token,
                get_civitai_download_url,
                get_civitai_model_details,
                parse_civitai_url,
                resolve_civitai_version_custom_result,
                resolve_urn,
                search_civitai,
                search_civitai_for_file,
            )
            from ..sources.civitai import (
                clear_search_cache as clear_civitai_search_cache,
            )
            from ..sources.huggingface import (
                build_huggingface_custom_result,
                check_brave_search_api_key,
                check_huggingface_token,
                get_huggingface_model_details,
                get_known_author_fallback_indexes_status,
                refresh_known_author_fallback_indexes,
                search_huggingface_for_file,
            )
            from ..sources.huggingface import (
                clear_search_cache as clear_huggingface_search_cache,
            )
            from ..sources.lora_manager_archive import (
                clear_search_cache as clear_lora_manager_archive_search_cache,
            )
            from ..sources.lora_manager_archive import (
                is_lora_manager_archive_available,
                search_lora_manager_archive_for_file,
            )
            from ..sources.model_list import (
                get_model_list_update_status,
                reload_model_list,
                search_model_list,
                update_model_list_from_remote,
            )
            from ..sources.popular import (
                get_popular_model_url,
            )
            from ..sources.popular import (
                reload_databases as reload_popular_databases,
            )

            download_available = True
        except ImportError as e:
            self.logger.warning(
                f"Model Resolver: Download features not available: {e}"
            )
            download_available = False

        (
            json_api_endpoint,
            get_progress_response,
            cancel_progress_response,
            run_in_background_thread,
            get_override_settings_from_request,
        ) = create_route_helpers(
            web=web,
            logger=self.logger,
            load_settings=load_resolver_settings,
            hash_calculation_cancelled=HashCalculationCancelled,
        )

        register_base_model_routes(routes, web, json_api_endpoint)
        route_context = {**globals(), **locals()}
        register_workflow_routes(route_context)
        register_metadata_routes(route_context)
        register_loaded_model_routes(route_context)
        register_model_info_routes(route_context)

        if download_available:
            register_search_routes(route_context)
            register_download_routes(route_context)
            register_directory_routes(route_context)

        register_settings_routes(routes, web, json_api_endpoint)
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

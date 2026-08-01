"""Shared dependencies for model-related services."""

from ..routes.context import RouteContext

MODEL_SERVICE_DEPENDENCIES = (
    "UnsafeUrlError",
    "asyncio",
    "build_civarchive_custom_result",
    "build_civitai_custom_result",
    "build_huggingface_custom_result",
    "download_available",
    "extract_sha256_from_metadata",
    "find_external_metadata_sidecar_path",
    "find_local_file_path",
    "get_civarchive_model_details",
    "get_civitai_download_url",
    "get_civitai_model_details",
    "get_existing_model_preview_path",
    "get_filename_from_path",
    "get_huggingface_model_details",
    "get_model_resolver_sidecar_path",
    "host_matches_domain",
    "is_path_in_configured_model_roots",
    "json_api_endpoint",
    "looks_like_model_file",
    "normalize_category_to_model_type",
    "normalize_sha256",
    "parse_civarchive_url",
    "parse_civitai_url",
    "read_json_safe",
    "request_public_url",
    "resolve_civarchive_by_hash",
    "resolve_civarchive_model_version",
    "resolve_civitai_version_custom_result",
    "routes",
    "search_huggingface_for_file",
    "search_local_matches_by_hash",
    "time",
    "to_bool",
    "validate_public_http_url",
    "web",
    "write_model_resolver_metadata",
)


class ModelServiceDependencies:
    """Bind route dependencies for model-related services."""

    def __init__(self, context: RouteContext):
        extension = context.get("self")
        self.logger = extension.logger
        for dependency in MODEL_SERVICE_DEPENDENCIES:
            setattr(self, dependency, context.get(dependency))


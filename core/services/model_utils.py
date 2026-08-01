"""Typed dependency models shared by model-related services."""

from dataclasses import dataclass, fields
from typing import Any, Callable, Optional

from ..routes.context import RouteContext

DependencyCallable = Callable[..., Any]


@dataclass(frozen=True, slots=True)
class CivitAISearchDependencies:
    """Dependencies required by the exact-match CivitAI search service."""

    logger: Any
    download_available: bool
    extract_sha256_from_metadata: DependencyCallable
    find_external_metadata_sidecar_path: DependencyCallable
    find_local_file_path: DependencyCallable
    get_existing_model_preview_path: Optional[DependencyCallable]
    get_filename_from_path: DependencyCallable
    get_model_resolver_sidecar_path: Optional[DependencyCallable]
    is_path_in_configured_model_roots: DependencyCallable
    looks_like_model_file: DependencyCallable
    normalize_category_to_model_type: DependencyCallable
    normalize_sha256: DependencyCallable
    read_json_safe: DependencyCallable
    request_public_url: DependencyCallable
    resolve_civarchive_by_hash: Optional[DependencyCallable]
    search_huggingface_for_file: Optional[DependencyCallable]
    to_bool: DependencyCallable
    web: Any
    write_model_resolver_metadata: Optional[DependencyCallable]

    @classmethod
    def from_context(cls, context: RouteContext) -> "CivitAISearchDependencies":
        extension = context.require("self")
        return cls(
            logger=extension.logger,
            download_available=context.require("download_available"),
            extract_sha256_from_metadata=context.require(
                "extract_sha256_from_metadata"
            ),
            find_external_metadata_sidecar_path=context.require(
                "find_external_metadata_sidecar_path"
            ),
            find_local_file_path=context.require("find_local_file_path"),
            get_existing_model_preview_path=context.get(
                "get_existing_model_preview_path"
            ),
            get_filename_from_path=context.require("get_filename_from_path"),
            get_model_resolver_sidecar_path=context.get(
                "get_model_resolver_sidecar_path"
            ),
            is_path_in_configured_model_roots=context.require(
                "is_path_in_configured_model_roots"
            ),
            looks_like_model_file=context.require("looks_like_model_file"),
            normalize_category_to_model_type=context.require(
                "normalize_category_to_model_type"
            ),
            normalize_sha256=context.require("normalize_sha256"),
            read_json_safe=context.require("read_json_safe"),
            request_public_url=context.require("request_public_url"),
            resolve_civarchive_by_hash=context.get("resolve_civarchive_by_hash"),
            search_huggingface_for_file=context.get(
                "search_huggingface_for_file"
            ),
            to_bool=context.require("to_bool"),
            web=context.require("web"),
            write_model_resolver_metadata=context.get(
                "write_model_resolver_metadata"
            ),
        )


@dataclass(frozen=True, slots=True)
class CustomUrlDependencies:
    """Dependencies required by custom provider URL resolution."""

    logger: Any
    UnsafeUrlError: type[Exception]
    asyncio: Any
    build_civarchive_custom_result: Optional[DependencyCallable]
    build_civitai_custom_result: Optional[DependencyCallable]
    build_huggingface_custom_result: Optional[DependencyCallable]
    extract_sha256_from_metadata: DependencyCallable
    get_civarchive_model_details: Optional[DependencyCallable]
    get_civitai_download_url: Optional[DependencyCallable]
    get_civitai_model_details: Optional[DependencyCallable]
    get_filename_from_path: DependencyCallable
    host_matches_domain: DependencyCallable
    looks_like_model_file: DependencyCallable
    normalize_category_to_model_type: DependencyCallable
    normalize_sha256: DependencyCallable
    parse_civarchive_url: Optional[DependencyCallable]
    parse_civitai_url: Optional[DependencyCallable]
    resolve_civarchive_by_hash: Optional[DependencyCallable]
    resolve_civarchive_model_version: Optional[DependencyCallable]
    resolve_civitai_version_custom_result: Optional[DependencyCallable]
    search_local_matches_by_hash: DependencyCallable
    time: Any
    validate_public_http_url: DependencyCallable
    web: Any

    @classmethod
    def from_context(cls, context: RouteContext) -> "CustomUrlDependencies":
        extension = context.require("self")
        return cls(
            logger=extension.logger,
            UnsafeUrlError=context.require("UnsafeUrlError"),
            asyncio=context.require("asyncio"),
            build_civarchive_custom_result=context.get(
                "build_civarchive_custom_result"
            ),
            build_civitai_custom_result=context.get(
                "build_civitai_custom_result"
            ),
            build_huggingface_custom_result=context.get(
                "build_huggingface_custom_result"
            ),
            extract_sha256_from_metadata=context.require(
                "extract_sha256_from_metadata"
            ),
            get_civarchive_model_details=context.get(
                "get_civarchive_model_details"
            ),
            get_civitai_download_url=context.get("get_civitai_download_url"),
            get_civitai_model_details=context.get("get_civitai_model_details"),
            get_filename_from_path=context.require("get_filename_from_path"),
            host_matches_domain=context.require("host_matches_domain"),
            looks_like_model_file=context.require("looks_like_model_file"),
            normalize_category_to_model_type=context.require(
                "normalize_category_to_model_type"
            ),
            normalize_sha256=context.require("normalize_sha256"),
            parse_civarchive_url=context.get("parse_civarchive_url"),
            parse_civitai_url=context.get("parse_civitai_url"),
            resolve_civarchive_by_hash=context.get("resolve_civarchive_by_hash"),
            resolve_civarchive_model_version=context.get(
                "resolve_civarchive_model_version"
            ),
            resolve_civitai_version_custom_result=context.get(
                "resolve_civitai_version_custom_result"
            ),
            search_local_matches_by_hash=context.require(
                "search_local_matches_by_hash"
            ),
            time=context.require("time"),
            validate_public_http_url=context.require("validate_public_http_url"),
            web=context.require("web"),
        )


@dataclass(frozen=True, slots=True)
class ModelDetailsDependencies:
    """Dependencies required by provider model details loading."""

    logger: Any
    asyncio: Any
    download_available: bool
    get_civarchive_model_details: Optional[DependencyCallable]
    get_civitai_model_details: Optional[DependencyCallable]
    get_huggingface_model_details: Optional[DependencyCallable]
    web: Any

    @classmethod
    def from_context(cls, context: RouteContext) -> "ModelDetailsDependencies":
        extension = context.require("self")
        return cls(
            logger=extension.logger,
            asyncio=context.require("asyncio"),
            download_available=context.require("download_available"),
            get_civarchive_model_details=context.get(
                "get_civarchive_model_details"
            ),
            get_civitai_model_details=context.get("get_civitai_model_details"),
            get_huggingface_model_details=context.get(
                "get_huggingface_model_details"
            ),
            web=context.require("web"),
        )


class ModelServiceDependencies:
    """Expose a typed dependency model as service attributes."""

    def __init__(self, dependencies: Any):
        for field in fields(dependencies):
            setattr(self, field.name, getattr(dependencies, field.name))

"""Typed dependency models shared by model-related services."""

from dataclasses import dataclass, fields
from typing import Any, Dict, Iterable, Optional, Protocol, Tuple

from ..routes.context import RouteContext

ModelResult = Optional[Dict[str, Any]]


class ExtractSha256Protocol(Protocol):
    def __call__(self, metadata: Any) -> str: ...


class FindExternalMetadataProtocol(Protocol):
    def __call__(self, model_path: str) -> str: ...


class FindLocalFileProtocol(Protocol):
    def __call__(
        self, filename: str, category: Optional[str] = None
    ) -> Optional[str]: ...


class GetPreviewProtocol(Protocol):
    def __call__(self, model_path: str) -> str: ...


class GetFilenameProtocol(Protocol):
    def __call__(self, path: Any) -> str: ...


class IsPathInRootsProtocol(Protocol):
    def __call__(self, path_value: Any, folder_paths_module: Any = None) -> bool: ...


class LooksLikeModelFileProtocol(Protocol):
    def __call__(self, url: str, expected_filename: str = "") -> bool: ...


class NormalizeCategoryProtocol(Protocol):
    def __call__(self, category: str) -> str: ...


class NormalizeSha256Protocol(Protocol):
    def __call__(self, value: Any) -> str: ...


class ReadJsonProtocol(Protocol):
    def __call__(self, file_path: str, default: Any = None) -> Any: ...


class RequestPublicUrlProtocol(Protocol):
    def __call__(
        self,
        method: str,
        url: Any,
        *,
        headers: Optional[Dict[str, str]] = None,
        timeout: Any = 30,
        stream: bool = True,
        max_redirects: int = 5,
        trusted_sensitive_redirect_hosts: Optional[Iterable[str]] = None,
        trusted_sensitive_redirect_headers: Optional[Iterable[str]] = None,
    ) -> Tuple[Any, str, Dict[str, str]]: ...


class ResolveCivarchiveByHashProtocol(Protocol):
    def __call__(
        self,
        sha256: str,
        query: str = "",
        exact_only: bool = False,
        model_type: Optional[str] = None,
    ) -> ModelResult: ...


class SearchHuggingFaceProtocol(Protocol):
    def __call__(
        self,
        filename: str,
        token: Optional[str] = None,
        exact_only: bool = False,
        brave_api_key: Optional[str] = None,
        use_api_search: bool = True,
        use_comfy_org_fallback: bool = True,
        use_brave_fallback: bool = True,
        force_refresh: bool = False,
        progress_callback: Any = None,
    ) -> ModelResult: ...


class ToBoolProtocol(Protocol):
    def __call__(self, value: Any, default: bool = False) -> bool: ...


class WriteMetadataProtocol(Protocol):
    def __call__(
        self,
        dest_path: str,
        metadata: Optional[Dict[str, Any]] = None,
        category: str = "",
        source_url: str = "",
        create_preview: bool = False,
    ) -> Optional[str]: ...


class BuildCivarchiveCustomResultProtocol(Protocol):
    def __call__(
        self, details: Dict[str, Any], expected_filename: str = ""
    ) -> ModelResult: ...


class BuildCivitaiCustomResultProtocol(Protocol):
    def __call__(
        self,
        details: Dict[str, Any],
        expected_filename: str = "",
        api_key: Optional[str] = None,
    ) -> ModelResult: ...


class BuildHuggingFaceCustomResultProtocol(Protocol):
    def __call__(
        self,
        url: str,
        expected_filename: str = "",
        token: Optional[str] = None,
    ) -> ModelResult: ...


class GetCivarchiveModelDetailsProtocol(Protocol):
    def __call__(
        self,
        model_id: int,
        version_id: Optional[int] = None,
        prefer_page: bool = False,
    ) -> ModelResult: ...


class GetCivitaiDownloadUrlProtocol(Protocol):
    def __call__(self, version_id: int, api_key: Optional[str] = None) -> str: ...


class GetCivitaiModelDetailsProtocol(Protocol):
    def __call__(
        self,
        model_id: int,
        version_id: Optional[int] = None,
        api_key: Optional[str] = None,
    ) -> ModelResult: ...


class GetHuggingFaceModelDetailsProtocol(Protocol):
    def __call__(
        self,
        repo_id: str,
        file_path: str = "",
        branch: str = "main",
        token: Optional[str] = None,
    ) -> ModelResult: ...


class HostMatchesDomainProtocol(Protocol):
    def __call__(self, host: Any, *domains: str) -> bool: ...


class ParseProviderUrlProtocol(Protocol):
    def __call__(self, url: str) -> Optional[Dict[str, Any]]: ...


class ResolveCivarchiveModelVersionProtocol(Protocol):
    def __call__(
        self,
        model_id: int,
        version_id: Optional[int] = None,
        query: str = "",
        exact_only: bool = False,
        prefer_page: bool = False,
    ) -> ModelResult: ...


class ResolveCivitaiVersionProtocol(Protocol):
    def __call__(
        self,
        version_id: int,
        expected_filename: str = "",
        api_key: Optional[str] = None,
    ) -> ModelResult: ...


class SearchLocalMatchesByHashProtocol(Protocol):
    def __call__(
        self,
        sha256: str,
        category: Optional[str] = None,
        max_matches: int = 20,
        force_rescan: bool = False,
    ) -> list[Dict[str, Any]]: ...


class ValidatePublicHttpUrlProtocol(Protocol):
    def __call__(self, url: Any) -> str: ...


@dataclass(frozen=True, slots=True)
class CivitAISearchDependencies:
    """Dependencies required by the exact-match CivitAI search service."""

    logger: Any
    download_available: bool
    extract_sha256_from_metadata: ExtractSha256Protocol
    find_external_metadata_sidecar_path: FindExternalMetadataProtocol
    find_local_file_path: FindLocalFileProtocol
    get_existing_model_preview_path: Optional[GetPreviewProtocol]
    get_filename_from_path: GetFilenameProtocol
    get_model_resolver_sidecar_path: Optional[GetPreviewProtocol]
    is_path_in_configured_model_roots: IsPathInRootsProtocol
    looks_like_model_file: LooksLikeModelFileProtocol
    normalize_category_to_model_type: NormalizeCategoryProtocol
    normalize_sha256: NormalizeSha256Protocol
    read_json_safe: ReadJsonProtocol
    request_public_url: RequestPublicUrlProtocol
    resolve_civarchive_by_hash: Optional[ResolveCivarchiveByHashProtocol]
    search_huggingface_for_file: Optional[SearchHuggingFaceProtocol]
    to_bool: ToBoolProtocol
    web: Any
    write_model_resolver_metadata: Optional[WriteMetadataProtocol]

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
    build_civarchive_custom_result: Optional[BuildCivarchiveCustomResultProtocol]
    build_civitai_custom_result: Optional[BuildCivitaiCustomResultProtocol]
    build_huggingface_custom_result: Optional[BuildHuggingFaceCustomResultProtocol]
    extract_sha256_from_metadata: ExtractSha256Protocol
    get_civarchive_model_details: Optional[GetCivarchiveModelDetailsProtocol]
    get_civitai_download_url: Optional[GetCivitaiDownloadUrlProtocol]
    get_civitai_model_details: Optional[GetCivitaiModelDetailsProtocol]
    get_filename_from_path: GetFilenameProtocol
    host_matches_domain: HostMatchesDomainProtocol
    looks_like_model_file: LooksLikeModelFileProtocol
    normalize_category_to_model_type: NormalizeCategoryProtocol
    normalize_sha256: NormalizeSha256Protocol
    parse_civarchive_url: Optional[ParseProviderUrlProtocol]
    parse_civitai_url: Optional[ParseProviderUrlProtocol]
    resolve_civarchive_by_hash: Optional[ResolveCivarchiveByHashProtocol]
    resolve_civarchive_model_version: Optional[ResolveCivarchiveModelVersionProtocol]
    resolve_civitai_version_custom_result: Optional[ResolveCivitaiVersionProtocol]
    search_local_matches_by_hash: SearchLocalMatchesByHashProtocol
    time: Any
    validate_public_http_url: ValidatePublicHttpUrlProtocol
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
    get_civarchive_model_details: Optional[GetCivarchiveModelDetailsProtocol]
    get_civitai_model_details: Optional[GetCivitaiModelDetailsProtocol]
    get_huggingface_model_details: Optional[GetHuggingFaceModelDetailsProtocol]
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

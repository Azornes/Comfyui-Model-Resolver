"""Typed dependencies shared by search orchestration and providers."""

from dataclasses import dataclass
from typing import Any, Protocol

from ..routes.context import RouteContext


class LoggerProtocol(Protocol):
    def debug(self, message: str, **kwargs: Any) -> Any: ...

    def info(self, message: str, **kwargs: Any) -> Any: ...

    def warning(self, message: str, **kwargs: Any) -> Any: ...

    def exception(self, message: str, **kwargs: Any) -> Any: ...


class SearchTrackerProtocol(Protocol):
    def is_cancelled(self, progress_id: str) -> bool: ...

    def update(self, *args: Any, **kwargs: Any) -> Any: ...


class BoolParserProtocol(Protocol):
    def __call__(self, value: Any, default: bool = False) -> bool: ...


class IntParserProtocol(Protocol):
    def __call__(self, value: Any, default: int = 0) -> int: ...


class ModelResultBuilderProtocol(Protocol):
    def __call__(self, source: str, **fields: Any) -> dict[str, Any]: ...


class ClearCacheProtocol(Protocol):
    def __call__(self) -> Any: ...


class ReloadProtocol(Protocol):
    def __call__(self) -> Any: ...


class ExtractSha256Protocol(Protocol):
    def __call__(self, metadata: dict[str, Any]) -> str | None: ...


class FormatSizeProtocol(Protocol):
    def __call__(self, value: Any, include_space: bool = True) -> str: ...


class SearchProviderProtocol(Protocol):
    def __call__(self, filename: str, **options: Any) -> Any: ...


class PopularModelUrlProtocol(Protocol):
    def __call__(self, filename: str) -> dict[str, Any] | None: ...


class ModelListSearchProtocol(Protocol):
    def __call__(self, filename: str) -> dict[str, Any] | None: ...


class LocalHashSearchProtocol(Protocol):
    def __call__(
        self,
        sha256: str,
        *,
        category: str | None,
        max_matches: int,
        force_rescan: bool,
    ) -> list[dict[str, Any]]: ...


class ResolveUrnProtocol(Protocol):
    def __call__(self, model_id: Any, version_id: Any) -> dict[str, Any] | None: ...


class ResolveArchiveVersionProtocol(Protocol):
    def __call__(
        self,
        model_id: Any,
        version_id: Any,
        *,
        query: str,
    ) -> dict[str, Any] | None: ...


class GetDownloadUrlProtocol(Protocol):
    def __call__(self, version_id: Any) -> str | None: ...


@dataclass(frozen=True, slots=True)
class SearchDependencies:
    """Validated services and provider functions used by search code."""

    search_tracker: SearchTrackerProtocol
    search_result_timestamps: dict[str, str]
    logger: LoggerProtocol
    civarchive_search_error: type[BaseException]
    asyncio: Any
    build_model_result: ModelResultBuilderProtocol
    clear_civarchive_search_cache: ClearCacheProtocol
    clear_civitai_search_cache: ClearCacheProtocol
    clear_huggingface_search_cache: ClearCacheProtocol
    clear_lora_manager_archive_search_cache: ClearCacheProtocol
    extract_sha256_from_metadata: ExtractSha256Protocol
    format_size_bytes: FormatSizeProtocol
    get_civitai_download_url: GetDownloadUrlProtocol
    get_popular_model_url: PopularModelUrlProtocol
    reload_model_list: ReloadProtocol
    reload_popular_databases: ReloadProtocol
    resolve_civarchive_model_version: ResolveArchiveVersionProtocol
    resolve_urn: ResolveUrnProtocol
    search_civarchive_for_file: SearchProviderProtocol
    search_civitai: SearchProviderProtocol
    search_civitai_for_file: SearchProviderProtocol
    search_huggingface_for_file: SearchProviderProtocol
    search_local_matches_by_hash: LocalHashSearchProtocol
    search_lora_manager_archive_for_file: SearchProviderProtocol
    search_model_list: ModelListSearchProtocol
    to_bool: BoolParserProtocol
    to_int: IntParserProtocol
    web: Any

    @staticmethod
    def _extension_value(extension: Any, name: str) -> Any:
        try:
            return getattr(extension, name)
        except AttributeError as exc:
            raise KeyError(f"Missing route dependency: self.{name}") from exc

    @classmethod
    def from_context(cls, context: RouteContext) -> "SearchDependencies":
        """Build dependencies and fail fast on an incomplete route context."""
        extension = context.require("self")
        return cls(
            search_tracker=cls._extension_value(extension, "search_tracker"),
            search_result_timestamps=cls._extension_value(
                extension,
                "search_result_timestamps",
            ),
            logger=cls._extension_value(extension, "logger"),
            asyncio=context.require("asyncio"),
            civarchive_search_error=context.require("CivArchiveSearchError"),
            build_model_result=context.require("build_model_result"),
            clear_civarchive_search_cache=context.require(
                "clear_civarchive_search_cache"
            ),
            clear_civitai_search_cache=context.require(
                "clear_civitai_search_cache"
            ),
            clear_huggingface_search_cache=context.require(
                "clear_huggingface_search_cache"
            ),
            clear_lora_manager_archive_search_cache=context.require(
                "clear_lora_manager_archive_search_cache"
            ),
            extract_sha256_from_metadata=context.require(
                "extract_sha256_from_metadata"
            ),
            format_size_bytes=context.require("format_size_bytes"),
            get_civitai_download_url=context.require("get_civitai_download_url"),
            get_popular_model_url=context.require("get_popular_model_url"),
            reload_model_list=context.require("reload_model_list"),
            reload_popular_databases=context.require("reload_popular_databases"),
            resolve_civarchive_model_version=context.require(
                "resolve_civarchive_model_version"
            ),
            resolve_urn=context.require("resolve_urn"),
            search_civarchive_for_file=context.require(
                "search_civarchive_for_file"
            ),
            search_civitai=context.require("search_civitai"),
            search_civitai_for_file=context.require("search_civitai_for_file"),
            search_huggingface_for_file=context.require(
                "search_huggingface_for_file"
            ),
            search_local_matches_by_hash=context.require(
                "search_local_matches_by_hash"
            ),
            search_lora_manager_archive_for_file=context.require(
                "search_lora_manager_archive_for_file"
            ),
            search_model_list=context.require("search_model_list"),
            to_bool=context.require("to_bool"),
            to_int=context.require("to_int"),
            web=context.require("web"),
        )

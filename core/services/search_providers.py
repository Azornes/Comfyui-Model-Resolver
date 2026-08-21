"""Provider-specific search execution and progress handling."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..contracts import SearchResult
from ..request_utils import (
    extract_request_sha256,
    read_bool_field,
    read_identifier_field,
    read_int_field,
    read_text_field,
)
from ..sources.civarchive import build_civarchive_failure_status
from ..sources.civitai import build_civitai_result_payload
from ..type_utils import select_primary_model_file


class SearchCancelled(BaseException):
    """Signal cancellation through provider worker boundaries."""


@dataclass(frozen=True, slots=True)
class SearchRequest:
    """Normalized values shared by the provider search tasks."""

    filename: str
    category: str
    base_model_context: str
    progress_id: str
    progress_source: str
    civitai_candidate_limit: int
    civarchive_candidate_limit: int
    is_urn: bool
    civitai_key: str
    civitai_session_token: str
    hf_token: str
    brave_search_api_key: str
    civitai_use_trpc_search: bool
    civitai_use_api_search: bool
    civitai_use_html_fallback: bool
    hf_use_api_search: bool
    hf_use_comfy_org_fallback: bool
    hf_use_brave_fallback: bool
    force_search: bool
    normalized_sources: frozenset[str]
    sha256: str = ""
    model_id: int | str | None = None
    version_id: int | str | None = None

    _TEXT_FIELDS = (
        "filename",
        "category",
        "base_model_context",
        "progress_id",
        "progress_source",
        "civitai_key",
        "civitai_session_token",
        "hf_token",
        "brave_search_api_key",
        "sha256",
    )
    _BOOLEAN_FIELDS = (
        "is_urn",
        "civitai_use_trpc_search",
        "civitai_use_api_search",
        "civitai_use_html_fallback",
        "hf_use_api_search",
        "hf_use_comfy_org_fallback",
        "hf_use_brave_fallback",
        "force_search",
    )

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
    ) -> "SearchRequest":
        """Adapt one HTTP payload into the typed provider request."""
        if not isinstance(value, Mapping):
            raise TypeError("Search request must be an object")
        data = dict(value)

        filename = read_text_field(
            data,
            "filename",
            contract_name="SearchRequest",
        )
        sha256 = extract_request_sha256(
            data,
            keys=("sha256", "hash", "file_hash"),
        )
        category = read_text_field(
            data,
            "category",
            contract_name="SearchRequest",
        )
        base_model_context = read_text_field(
            data,
            "base_model_context",
            contract_name="SearchRequest",
        )
        progress_id = read_text_field(
            data,
            "progress_id",
            contract_name="SearchRequest",
        )
        progress_source = read_text_field(
            data,
            "progress_source",
            contract_name="SearchRequest",
        )

        civitai_candidate_limit = read_int_field(
            data,
            "civitai_candidate_limit",
            default=5,
            contract_name="SearchRequest",
        )
        civarchive_candidate_limit = read_int_field(
            data,
            "civarchive_candidate_limit",
            default=10,
            contract_name="SearchRequest",
        )
        civitai_candidate_limit = max(1, min(civitai_candidate_limit, 20))
        civarchive_candidate_limit = max(1, min(civarchive_candidate_limit, 30))

        def read_request_bool(field_name: str, default: bool) -> bool:
            return read_bool_field(
                data,
                field_name,
                default=default,
                contract_name="SearchRequest",
            )

        is_urn = read_request_bool("is_urn", False)
        raw_sources = data.get("sources", ["all"])
        if isinstance(raw_sources, str):
            raw_sources = [raw_sources]
        elif raw_sources is None or not isinstance(raw_sources, list):
            raise TypeError("SearchRequest sources must be a string or array")
        if any(not isinstance(source, str) for source in raw_sources):
            raise TypeError("SearchRequest sources must contain only strings")

        normalized_sources = frozenset(
            source.strip().lower()
            for source in raw_sources
            if source.strip()
        )
        if not normalized_sources:
            normalized_sources = frozenset({"all"})
        if "all" in normalized_sources:
            normalized_sources = frozenset(
                {
                    "local",
                    "huggingface",
                    "civitai",
                    "civarchive",
                    "lora_manager_archive",
                }
            )

        if not progress_source:
            progress_source = (
                next(iter(normalized_sources))
                if len(normalized_sources) == 1
                else "all"
            )

        return cls(
            filename=filename,
            category=category,
            base_model_context=base_model_context,
            progress_id=progress_id,
            progress_source=progress_source,
            civitai_candidate_limit=civitai_candidate_limit,
            civarchive_candidate_limit=civarchive_candidate_limit,
            is_urn=is_urn,
            civitai_key=read_text_field(
                data,
                "civitai_key",
                contract_name="SearchRequest",
            ),
            civitai_session_token=read_text_field(
                data,
                "civitai_session_token",
                contract_name="SearchRequest",
            ),
            hf_token=read_text_field(
                data,
                "hf_token",
                contract_name="SearchRequest",
            ),
            brave_search_api_key=read_text_field(
                data,
                "brave_search_api_key",
                contract_name="SearchRequest",
            ),
            civitai_use_trpc_search=read_request_bool(
                "civitai_use_trpc_search",
                True,
            ),
            civitai_use_api_search=read_request_bool(
                "civitai_use_api_search",
                True,
            ),
            civitai_use_html_fallback=read_request_bool(
                "civitai_use_html_fallback",
                True,
            ),
            hf_use_api_search=read_request_bool("hf_use_api_search", True),
            hf_use_comfy_org_fallback=read_request_bool(
                "hf_use_comfy_org_fallback",
                True,
            ),
            hf_use_brave_fallback=read_request_bool(
                "hf_use_brave_fallback",
                True,
            ),
            force_search=read_request_bool("force_search", False),
            normalized_sources=normalized_sources,
            sha256=sha256,
            model_id=read_identifier_field(
                data,
                "model_id",
                contract_name="SearchRequest",
            ),
            version_id=read_identifier_field(
                data,
                "version_id",
                contract_name="SearchRequest",
            ),
        )

    def __post_init__(self) -> None:
        """Validate the normalized request before provider execution."""
        for field_name in self._TEXT_FIELDS:
            value = getattr(self, field_name)
            if value is None:
                value = ""
            if not isinstance(value, str):
                raise TypeError(f"SearchRequest {field_name} must be a string")
            object.__setattr__(self, field_name, value)

        for field_name in self._BOOLEAN_FIELDS:
            value = getattr(self, field_name)
            if not isinstance(value, bool):
                raise TypeError(f"SearchRequest {field_name} must be a boolean")

        for field_name in (
            "civitai_candidate_limit",
            "civarchive_candidate_limit",
        ):
            value = getattr(self, field_name)
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError(
                    f"SearchRequest {field_name} must be a positive integer"
                )
            if value < 1:
                raise ValueError(
                    f"SearchRequest {field_name} must be a positive integer"
                )

        for field_name in ("model_id", "version_id"):
            value = getattr(self, field_name)
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, str)):
                raise TypeError(
                    f"SearchRequest {field_name} must be an integer or string"
                )
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)

        if not isinstance(self.normalized_sources, frozenset):
            raise TypeError("SearchRequest normalized_sources must be a frozenset")
        if any(not isinstance(source, str) for source in self.normalized_sources):
            raise TypeError(
                "SearchRequest normalized_sources must contain only strings"
            )

    @property
    def search_local(self):
        return "local" in self.normalized_sources

    @property
    def search_huggingface_source(self):
        return "huggingface" in self.normalized_sources

    @property
    def search_civitai_source(self):
        return "civitai" in self.normalized_sources

    @property
    def search_civarchive_source(self):
        return "civarchive" in self.normalized_sources

    @property
    def search_lora_manager_archive_source(self):
        return "lora_manager_archive" in self.normalized_sources


class SearchProviderRunner:
    """Run source searches while keeping provider concerns out of orchestration."""

    def __init__(self, owner):
        self.owner = owner

    def raise_if_search_cancelled(self, request: SearchRequest, source=""):
        if self.owner.search_tracker.is_cancelled(request.progress_id):
            raise SearchCancelled("Search cancelled")

    def make_source_progress_callback(
        self,
        request: SearchRequest,
        source_key,
        percent_min=None,
        percent_max=None,
    ):
        def source_progress_callback(payload):
            self.raise_if_search_cancelled(request, source_key)
            if not isinstance(payload, dict):
                return

            progress_payload = dict(payload)
            stage = progress_payload.pop("stage", "running")
            message = progress_payload.pop("message", "Searching...")
            percent = progress_payload.pop("percent", None)
            status = progress_payload.pop("status", "running")
            progress_payload.pop("source", None)

            if (
                percent is not None
                and percent_min is not None
                and percent_max is not None
            ):
                try:
                    normalized_percent = max(0.0, min(100.0, float(percent)))
                    percent = percent_min + (
                        normalized_percent / 100.0
                    ) * (percent_max - percent_min)
                except (TypeError, ValueError):
                    percent = None

            self.owner.search_tracker.update(
                request.progress_id,
                source_key,
                stage,
                message,
                percent,
                status=status,
                **progress_payload,
            )

        return source_progress_callback

    def run_source_search(
        self,
        request: SearchRequest,
        source_key,
        search_task_fn,
        initial_stage="query",
        initial_message=None,
        initial_percent=30,
        log_start_fields=None,
        error_handlers=None,
    ):
        if initial_message is None:
            initial_message = f"Querying {source_key.capitalize()}"
        self.raise_if_search_cancelled(request, source_key)
        self.owner.search_tracker.update(
            request.progress_id,
            source_key,
            initial_stage,
            initial_message,
            initial_percent,
        )
        start_fields = log_start_fields or {"file": request.filename}
        self.owner.logger.info(
            f"Search [{source_key}] start "
            + self.owner.format_log_fields(**start_fields)
        )
        try:
            self.raise_if_search_cancelled(request, source_key)
            source_results, source_found = search_task_fn()
            self.raise_if_search_cancelled(request, source_key)
            done_messages = {
                "local": "Local database checked",
                "huggingface": "HuggingFace checked",
                "civitai": "CivitAI checked",
                "civarchive": "CivArchive checked",
                "lora_manager_archive": "LoRA Manager archive checked",
            }
            done_msg = done_messages.get(
                source_key,
                f"{source_key} checked",
            )
            self.owner.search_tracker.update(
                request.progress_id,
                source_key,
                "done",
                done_msg,
                92,
            )
            return source_results, source_found
        except Exception as exc:
            if error_handlers:
                for exc_type, handler_fn in error_handlers.items():
                    if isinstance(exc, exc_type):
                        return handler_fn(exc)
            raise

    def mark_any_model_fallback(self, request: SearchRequest, result):
        if result is None:
            return None
        if isinstance(result, list):
            return [
                self.mark_any_model_fallback(request, item)
                for item in result
            ]
        if isinstance(result, SearchResult):
            return result.with_extra(
                any_model_match=True,
                base_model_fallback=True,
                requested_base_model=request.base_model_context,
            )
        raise TypeError(
            f"{type(result).__name__} is not a typed search result"
        )

    def execute_search_with_fallback(
        self,
        request: SearchRequest,
        source_key,
        search_fn,
        any_model_label,
    ):
        self.raise_if_search_cancelled(request, source_key)
        result = search_fn(
            request.base_model_context or None,
            self.make_source_progress_callback(request, source_key),
        )
        self.raise_if_search_cancelled(request, source_key)
        self.owner.log_search_result(source_key, result)

        if (
            not result
            and request.base_model_context
            and not getattr(request, "sha256", "")
        ):
            self.raise_if_search_cancelled(request, source_key)
            self.owner.search_tracker.update(
                request.progress_id,
                source_key,
                "any_model",
                f"Retrying {any_model_label} any model",
                72,
            )
            self.owner.logger.info(
                f"Search [{source_key}] retry any model "
                + self.owner.format_log_fields(
                    file=request.filename,
                    cat=request.category,
                    base=request.base_model_context,
                )
            )
            result = search_fn(
                None,
                self.make_source_progress_callback(request, source_key, 72, 92),
            )
            self.raise_if_search_cancelled(request, source_key)
            self.owner.log_search_result(f"{source_key}/any_model", result)
            if result:
                result = self.mark_any_model_fallback(request, result)
        return result

    def search_local_sources(self, request: SearchRequest):
        def task():
            source_results = {"popular": None, "model_list": None}
            source_found = False
            request_sha256 = getattr(request, "sha256", "")

            if request_sha256:
                self.owner.search_tracker.update(
                    request.progress_id,
                    "local",
                    "hash",
                    "Searching local models by SHA-256",
                    58,
                )
                return source_results, source_found

            popular_info = self.owner.get_popular_model_url(request.filename)
            self.owner.search_tracker.update(
                request.progress_id,
                "local",
                "model_list",
                "Checking local model database",
                58,
            )
            model_list_result = self.owner.search_model_list(request.filename)
            self.owner.log_search_result(
                "model_list",
                model_list_result,
                {
                    "confidence": (
                        model_list_result.confidence
                        if model_list_result
                        else None
                    )
                },
            )
            if popular_info:
                popular_result = self.owner.build_model_result(
                    "popular",
                    filename=request.filename,
                    name=popular_info.name or request.filename,
                    type=popular_info.model_type,
                    url=(
                        popular_info.url
                        or popular_info.download_url
                        or ""
                    ),
                    download_url=popular_info.download_url,
                    size=popular_info.size,
                    match_type="exact",
                    directory=popular_info.directory,
                    **dict(popular_info.extra),
                )
                if (
                    model_list_result
                    and model_list_result.filename.lower()
                    == request.filename.lower()
                    and model_list_result.size is not None
                ):
                    popular_result = popular_result.with_updates(
                        size=model_list_result.size
                    )
                source_results["popular"] = popular_result
                self.owner.log_search_result("popular", popular_result)
                source_found = True

            if model_list_result:
                confidence = model_list_result.confidence
                if (request.is_urn and confidence >= 70) or not request.is_urn:
                    source_results["model_list"] = model_list_result
                    source_found = True

            return source_results, source_found

        return self.run_source_search(
            request,
            "local",
            task,
            initial_stage="popular",
            initial_message="Checking popular models",
            initial_percent=28,
            log_start_fields={
                "file": request.filename,
                "cat": request.category,
            },
        )

    def search_huggingface_source_task(self, request: SearchRequest):
        def task():
            hf_result = self.owner.search_huggingface_for_file(
                request.filename,
                sha256=getattr(request, "sha256", ""),
                token=request.hf_token or None,
                brave_api_key=request.brave_search_api_key or None,
                use_api_search=request.hf_use_api_search,
                use_comfy_org_fallback=request.hf_use_comfy_org_fallback,
                use_brave_fallback=request.hf_use_brave_fallback,
                force_refresh=request.force_search,
                progress_callback=self.make_source_progress_callback(
                    request,
                    "huggingface",
                ),
            )
            self.owner.log_search_result("huggingface", hf_result)
            return {"huggingface": hf_result}, bool(hf_result)

        return self.run_source_search(
            request,
            "huggingface",
            task,
            initial_stage="query",
            initial_message="Querying HuggingFace",
            initial_percent=32,
            log_start_fields={"file": request.filename},
        )

    def search_civitai_source_task(self, request: SearchRequest):
        def task():
            source_results = {"civitai": None}
            source_found = False

            if request.is_urn:
                model_id = request.model_id
                version_id = request.version_id

                if model_id and version_id:
                    self.owner.search_tracker.update(
                        request.progress_id,
                        "civitai",
                        "urn",
                        "Resolving CivitAI URN",
                        46,
                    )
                    model_info = self.owner.resolve_urn(model_id, version_id)
                    if model_info:
                        self.owner.search_tracker.update(
                            request.progress_id,
                            "civitai",
                            "file",
                            "Selecting CivitAI file",
                            76,
                        )
                        primary_file = select_primary_model_file(
                            model_info.get("files") or [],
                            expected_filename=model_info.get("expected_filename"),
                            fallback_to_first=True,
                        ) or {}

                        download_url = self.owner.get_civitai_download_url(version_id)
                        result_payload = build_civitai_result_payload(
                            model_id=model_id,
                            version_id=version_id,
                            model_name=model_info.get("model_name"),
                            model_type=request.category,
                            file_info=primary_file,
                            filename=model_info.get("expected_filename"),
                            download_url=download_url,
                            size=primary_file.get("size"),
                            base_model=model_info.get("base_model"),
                            tags=model_info.get("tags", []),
                            match_type="exact",
                            version_name=model_info.get("version_name"),
                            confidence=100.0,
                        )
                        source_results["civitai"] = self.owner.build_model_result(
                            "civitai", **result_payload
                        )
                        self.owner.log_search_result(
                            "civitai/urn",
                            source_results["civitai"],
                            {"files_count": len(model_info.get("files", []))},
                        )
                        source_found = True
                    else:
                        self.owner.log_search_result(
                            "civitai/urn",
                            None,
                            {"model_id": model_id, "version_id": version_id},
                        )
                elif request.category:
                    self.owner.search_tracker.update(
                        request.progress_id,
                        "civitai",
                        "fallback",
                        "Searching CivitAI fallback",
                        58,
                    )
                    self.owner.logger.info(
                        "Search [civitai] URN ids missing; falling back"
                    )
                    civitai_results = self.owner.search_civitai(
                        request.filename,
                        model_type=request.category,
                    )
                    self.owner.log_search_result(
                        "civitai/fallback",
                        civitai_results[0] if civitai_results else None,
                        {"results_count": len(civitai_results)},
                    )
                    if civitai_results:
                        source_results["civitai"] = civitai_results[0]
                        source_found = True
            else:
                civitai_result = self.execute_search_with_fallback(
                    request,
                    "civitai",
                    lambda base_ctx, callback: self.owner.search_civitai_for_file(
                        request.filename,
                        sha256=getattr(request, "sha256", ""),
                        api_key=request.civitai_key or None,
                        model_type=request.category,
                        base_model_context=base_ctx,
                        session_token=request.civitai_session_token or None,
                        candidate_limit=request.civitai_candidate_limit,
                        use_trpc_search=request.civitai_use_trpc_search,
                        use_api_search=request.civitai_use_api_search,
                        use_html_fallback=request.civitai_use_html_fallback,
                        progress_callback=callback,
                    ),
                    "CivitAI",
                )
                if civitai_result:
                    source_results["civitai"] = civitai_result
                    source_found = True

            return source_results, source_found

        return self.run_source_search(
            request,
            "civitai",
            task,
            initial_stage="query",
            initial_message="Querying CivitAI",
            initial_percent=30,
            log_start_fields={
                "file": request.filename,
                "cat": request.category,
                "urn": request.is_urn,
            },
        )

    def search_civarchive_source_task(self, request: SearchRequest):
        def task():
            source_results = {"civarchive": None}
            source_found = False

            if request.is_urn:
                model_id = request.model_id
                version_id = request.version_id
                if model_id and version_id:
                    self.owner.search_tracker.update(
                        request.progress_id,
                        "civarchive",
                        "urn",
                        "Resolving CivArchive version",
                        50,
                    )
                    civarchive_result = self.owner.resolve_civarchive_model_version(
                        model_id,
                        version_id,
                        query=request.filename,
                    )
                    self.owner.log_search_result(
                        "civarchive/urn",
                        civarchive_result,
                        {"model_id": model_id, "version_id": version_id},
                    )
                    if civarchive_result:
                        source_results["civarchive"] = civarchive_result
                        source_found = True
                else:
                    self.owner.log_search_result(
                        "civarchive/urn",
                        None,
                        {"model_id": model_id, "version_id": version_id},
                    )
            else:
                civarchive_result = self.execute_search_with_fallback(
                    request,
                    "civarchive",
                    lambda base_ctx, callback: self.owner.search_civarchive_for_file(
                        request.filename,
                        sha256=getattr(request, "sha256", ""),
                        model_type=request.category,
                        base_model_context=base_ctx,
                        limit=request.civarchive_candidate_limit,
                        progress_callback=callback,
                    ),
                    "CivArchive",
                )
                if civarchive_result:
                    source_results["civarchive"] = civarchive_result
                    source_found = True

            return source_results, source_found

        def handle_civarchive_error(error):
            error_message = f"CivArchive search failed: {error}"
            status_factory = getattr(error, "as_status", None)
            if callable(status_factory):
                source_status = status_factory()
            else:
                source_status = build_civarchive_failure_status()
            http_status = source_status.get("http_status") or "none"
            retryable = "yes" if source_status.get("retryable") else "no"
            error_type = type(error).__name__
            self.owner.logger.warning(
                "CivArchive search failed: "
                f"code={source_status.get('code', 'provider_unavailable')} "
                f"http_status={http_status} "
                f"retryable={retryable} "
                f"error_type={error_type} "
                f"message={source_status.get('message', 'CivArchive search failed.')}"
            )
            self.owner.search_tracker.update(
                request.progress_id,
                "civarchive",
                "error",
                source_status.get("message", error_message),
                100,
                status="error",
            )
            return (
                {
                    "civarchive": None,
                    "source_errors": {"civarchive": error_message},
                    "source_status": {"civarchive": source_status},
                },
                False,
            )

        return self.run_source_search(
            request,
            "civarchive",
            task,
            initial_stage="query",
            initial_message="Querying CivArchive",
            initial_percent=30,
            log_start_fields={
                "file": request.filename,
                "cat": request.category,
                "urn": request.is_urn,
            },
            error_handlers={
                self.owner.CivArchiveSearchError: handle_civarchive_error,
            },
        )

    def search_lora_manager_archive_source_task(self, request: SearchRequest):
        def task():
            result = self.execute_search_with_fallback(
                request,
                "lora_manager_archive",
                lambda base_ctx, callback: self.owner.search_lora_manager_archive_for_file(
                    request.filename,
                    sha256=getattr(request, "sha256", ""),
                    model_type=request.category,
                    base_model_context=base_ctx,
                    progress_callback=callback,
                ),
                "LoRA archive",
            )
            return {"lora_manager_archive": result}, bool(result)

        return self.run_source_search(
            request,
            "lora_manager_archive",
            task,
            initial_stage="query",
            initial_message="Searching LoRA Manager archive",
            initial_percent=36,
            log_start_fields={"file": request.filename, "cat": request.category},
        )

    def create_search_tasks(self, request: SearchRequest):
        tasks = []
        if request.search_local:
            tasks.append(self.owner.asyncio.to_thread(self.search_local_sources, request))
        if request.search_huggingface_source:
            tasks.append(
                self.owner.asyncio.to_thread(
                    self.search_huggingface_source_task,
                    request,
                )
            )
        if request.search_civitai_source:
            tasks.append(
                self.owner.asyncio.to_thread(
                    self.search_civitai_source_task,
                    request,
                )
            )
        if request.search_civarchive_source and (
            request.filename
            or getattr(request, "sha256", "")
            or (
                request.is_urn
                and request.model_id
                and request.version_id
            )
        ):
            tasks.append(
                self.owner.asyncio.to_thread(
                    self.search_civarchive_source_task,
                    request,
                )
            )
        if request.search_lora_manager_archive_source and (
            request.filename or getattr(request, "sha256", "")
        ):
            tasks.append(
                self.owner.asyncio.to_thread(
                    self.search_lora_manager_archive_source_task,
                    request,
                )
            )
        return tasks

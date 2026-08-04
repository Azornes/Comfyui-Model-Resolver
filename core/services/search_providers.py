"""Provider-specific search execution and progress handling."""

from dataclasses import dataclass
from typing import Any


class SearchCancelled(BaseException):
    """Signal cancellation through provider worker boundaries."""


@dataclass(frozen=True, slots=True)
class SearchRequest:
    """Normalized values shared by the provider search tasks."""

    data: dict[str, Any]
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
        if isinstance(result, list):
            return [
                self.mark_any_model_fallback(request, item)
                for item in result
            ]
        if not isinstance(result, dict):
            return result

        marked = dict(result)
        marked["any_model_match"] = True
        marked["base_model_fallback"] = True
        marked["requested_base_model"] = request.base_model_context
        return marked

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
            self.owner.log_search_result("popular", popular_info)
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
                        model_list_result.get("confidence")
                        if model_list_result
                        else None
                    )
                },
            )
            if popular_info:
                popular_result = {
                    "source": "popular",
                    "filename": request.filename,
                    **popular_info,
                }
                if (
                    model_list_result
                    and model_list_result.get("filename", "").lower()
                    == request.filename.lower()
                    and model_list_result.get("size")
                ):
                    popular_result["size"] = model_list_result.get("size")
                source_results["popular"] = popular_result
                source_found = True

            if model_list_result:
                confidence = model_list_result.get("confidence", 0)
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
                model_id = request.data.get("model_id")
                version_id = request.data.get("version_id")

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
                        primary_file = None
                        for file_info in model_info.get("files", []):
                            if file_info.get("name") == model_info.get(
                                "expected_filename"
                            ):
                                primary_file = file_info
                                break
                        if primary_file is None:
                            primary_file = (model_info.get("files") or [{}])[0]

                        download_url = self.owner.get_civitai_download_url(
                            version_id
                        )
                        source_results["civitai"] = self.owner.build_search_result(
                            "civitai",
                            model_id=model_id,
                            version_id=version_id,
                            name=model_info.get("model_name"),
                            version_name=model_info.get("version_name"),
                            filename=model_info.get("expected_filename"),
                            type=request.category,
                            download_url=download_url,
                            url=(
                                "https://civitai.com/models/"
                                f"{model_id}?modelVersionId={version_id}"
                            ),
                            size=primary_file.get("size"),
                            base_model=model_info.get("base_model"),
                            tags=model_info.get("tags", []),
                            sha256=(
                                primary_file.get("sha256")
                                or (primary_file.get("hashes") or {}).get(
                                    "SHA256"
                                )
                                or (primary_file.get("hashes") or {}).get(
                                    "sha256"
                                )
                            ),
                            hashes=primary_file.get("hashes") or {},
                            match_type="exact",
                            confidence=100.0,
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
                        first_result = civitai_results[0]
                        source_results["civitai"] = self.owner.build_search_result(
                            "civitai",
                            model_id=first_result.get("model_id"),
                            version_id=first_result.get("version_id"),
                            name=first_result.get("name"),
                            filename=first_result.get("filename"),
                            type=first_result.get("type"),
                            download_url=first_result.get("download_url"),
                            url=first_result.get("url"),
                            size=first_result.get("size"),
                            base_model=first_result.get("base_model"),
                            tags=first_result.get("tags", []),
                        )
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
                model_id = request.data.get("model_id")
                version_id = request.data.get("version_id")
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
                source_status = {
                    "state": "unavailable",
                    "code": "provider_unavailable",
                    "retryable": True,
                    "http_status": None,
                    "message": (
                        "CivArchive may be overloaded or temporarily unavailable. "
                        "Please try again."
                    ),
                }
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
                and request.data.get("model_id")
                and request.data.get("version_id")
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

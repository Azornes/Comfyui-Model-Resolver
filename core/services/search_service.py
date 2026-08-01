"""Search orchestration service for remote model sources."""

from ..routes.context import RouteContext


class SearchService:
    """Execute source searches independently from HTTP route registration."""

    def __init__(self, context: RouteContext):
        extension = context.get("self")
        self.search_tracker = extension.search_tracker
        self.search_result_timestamps = extension.search_result_timestamps
        self.logger = extension.logger
        self.CivArchiveSearchError = context.get("CivArchiveSearchError")
        self.asyncio = context.get("asyncio")
        self.build_search_result = context.get("build_search_result")
        self.cancel_progress_response = context.get("cancel_progress_response")
        self.clear_civarchive_search_cache = context.get("clear_civarchive_search_cache")
        self.clear_civitai_search_cache = context.get("clear_civitai_search_cache")
        self.clear_huggingface_search_cache = context.get("clear_huggingface_search_cache")
        self.clear_lora_manager_archive_search_cache = context.get("clear_lora_manager_archive_search_cache")
        self.extract_sha256_from_metadata = context.get("extract_sha256_from_metadata")
        self.format_size_bytes = context.get("format_size_bytes")
        self.get_civitai_download_url = context.get("get_civitai_download_url")
        self.get_popular_model_url = context.get("get_popular_model_url")
        self.get_progress_response = context.get("get_progress_response")
        self.json_api_endpoint = context.get("json_api_endpoint")
        self.reload_model_list = context.get("reload_model_list")
        self.reload_popular_databases = context.get("reload_popular_databases")
        self.resolve_civarchive_model_version = context.get("resolve_civarchive_model_version")
        self.resolve_urn = context.get("resolve_urn")
        self.routes = context.get("routes")
        self.search_civarchive_for_file = context.get("search_civarchive_for_file")
        self.search_civitai = context.get("search_civitai")
        self.search_civitai_for_file = context.get("search_civitai_for_file")
        self.search_huggingface_for_file = context.get("search_huggingface_for_file")
        self.search_local_matches_by_hash = context.get("search_local_matches_by_hash")
        self.search_lora_manager_archive_for_file = context.get("search_lora_manager_archive_for_file")
        self.search_model_list = context.get("search_model_list")
        self.to_bool = context.get("to_bool")
        self.to_int = context.get("to_int")
        self.web = context.get("web")

    async def search_sources(self, request):
        """Search for model download sources."""
        CivArchiveSearchError = self.CivArchiveSearchError
        asyncio = self.asyncio
        build_search_result = self.build_search_result
        clear_civarchive_search_cache = self.clear_civarchive_search_cache
        clear_civitai_search_cache = self.clear_civitai_search_cache
        clear_huggingface_search_cache = self.clear_huggingface_search_cache
        clear_lora_manager_archive_search_cache = self.clear_lora_manager_archive_search_cache
        extract_sha256_from_metadata = self.extract_sha256_from_metadata
        format_size_bytes = self.format_size_bytes
        get_civitai_download_url = self.get_civitai_download_url
        get_popular_model_url = self.get_popular_model_url
        reload_model_list = self.reload_model_list
        reload_popular_databases = self.reload_popular_databases
        resolve_civarchive_model_version = self.resolve_civarchive_model_version
        resolve_urn = self.resolve_urn
        search_civarchive_for_file = self.search_civarchive_for_file
        search_civitai = self.search_civitai
        search_civitai_for_file = self.search_civitai_for_file
        search_huggingface_for_file = self.search_huggingface_for_file
        search_local_matches_by_hash = self.search_local_matches_by_hash
        search_lora_manager_archive_for_file = self.search_lora_manager_archive_for_file
        search_model_list = self.search_model_list
        to_bool = self.to_bool
        to_int = self.to_int
        web = self.web
        try:
            class SearchCancelled(BaseException):
                # Progress helpers swallow ordinary callback errors; cancellation
                # must bubble out of source loops and stop follow-up requests.
                pass

            def raise_if_search_cancelled(source=""):
                if self.search_tracker.is_cancelled(progress_id):
                    raise SearchCancelled("Search cancelled")

            def format_log_value(value):
                if value is None or value == "":
                    return None
                if isinstance(value, bool):
                    return "yes" if value else "no"
                if isinstance(value, (list, tuple, set)):
                    return ",".join(str(item) for item in value)

                text = str(value)
                if any(char.isspace() for char in text):
                    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
                return text

            def format_log_size(value):
                return format_size_bytes(value, include_space=False)

            def format_log_fields(**fields):
                parts = []
                for key, value in fields.items():
                    formatted = format_log_value(value)
                    if formatted is not None:
                        parts.append(f"{key}={formatted}")
                return " ".join(parts)

            def normalize_result_extra(extra):
                if not extra:
                    return {}
                normalized = dict(extra)
                model_id = normalized.pop("model_id", None)
                version_id = normalized.pop("version_id", None)
                if model_id or version_id:
                    normalized["ids"] = (
                        f"{model_id}@{version_id}"
                        if model_id and version_id
                        else model_id or version_id
                    )
                if "files_count" in normalized:
                    normalized["files"] = normalized.pop("files_count")
                return normalized

            def format_result_details(result, extra=None):
                if isinstance(result, list):
                    return format_log_fields(count=len(result))
                if not isinstance(result, dict):
                    fields = {"result": "none" if result is None else result}
                    fields.update(normalize_result_extra(extra))
                    return format_log_fields(**fields)

                model_id = result.get("model_id")
                version_id = result.get("version_id")
                ids = (
                    f"{model_id}@{version_id}"
                    if model_id and version_id
                    else model_id or version_id
                )
                fields = {
                    "name": result.get("name"),
                    "file": result.get("filename") or result.get("path"),
                    "match": result.get("match_type"),
                    "repo": result.get("repo_id") or result.get("repo"),
                    "ids": ids,
                    "size": format_log_size(result.get("size")),
                    "files": result.get("files_count"),
                }
                fields.update(normalize_result_extra(extra))
                return format_log_fields(**fields)

            def log_search_result(source_name, result, extra=None):
                details = format_result_details(result, extra)
                if result and (
                    not isinstance(result, list) or len(result) > 0
                ):
                    self.logger.info(f"Search [{source_name}] found {details}")
                else:
                    self.logger.info(f"Search [{source_name}] miss {details}")

            data = await request.json()
            filename = data.get("filename", "")
            category = data.get("category", "")
            base_model_context = data.get("base_model_context", "")
            progress_id = str(data.get("progress_id") or "").strip()
            progress_source = str(data.get("progress_source") or "").strip()
            civitai_candidate_limit = to_int(data.get("civitai_candidate_limit"), 5)
            civitai_candidate_limit = max(
                1, min(civitai_candidate_limit, 20)
            )
            civarchive_candidate_limit = to_int(data.get("civarchive_candidate_limit"), 10)
            civarchive_candidate_limit = max(
                1, min(civarchive_candidate_limit, 30)
            )
            # Handle both boolean and string forms
            is_urn_raw = data.get("is_urn", False)
            civitai_key = data.get("civitai_key", "")
            civitai_session_token = data.get("civitai_session_token", "")
            hf_token = data.get("hf_token", "")
            brave_search_api_key = data.get("brave_search_api_key", "")
            civitai_use_trpc_search = data.get(
                "civitai_use_trpc_search", True
            )
            civitai_use_api_search = data.get(
                "civitai_use_api_search", True
            )
            civitai_use_html_fallback = data.get(
                "civitai_use_html_fallback", True
            )
            hf_use_api_search = data.get("hf_use_api_search", True)
            hf_use_comfy_org_fallback = data.get(
                "hf_use_comfy_org_fallback", True
            )
            hf_use_brave_fallback = data.get(
                "hf_use_brave_fallback", True
            )
            is_urn = to_bool(is_urn_raw, False)
            hf_use_api_search = to_bool(hf_use_api_search, True)
            civitai_use_trpc_search = to_bool(civitai_use_trpc_search, True)
            civitai_use_api_search = to_bool(civitai_use_api_search, True)
            civitai_use_html_fallback = to_bool(civitai_use_html_fallback, True)
            hf_use_comfy_org_fallback = to_bool(hf_use_comfy_org_fallback, True)
            hf_use_brave_fallback = to_bool(hf_use_brave_fallback, True)

            # For URN-only requests, model_id and version_id are required instead of filename
            model_id = data.get("model_id")
            version_id = data.get("version_id")
            if not filename and not (is_urn and model_id and version_id):
                return web.json_response(
                    {
                        "error": "Filename is required for non-URN, or model_id+version_id for URN"
                    },
                    status=400,
                )

            raw_sources = data.get("sources", ["all"])
            if isinstance(raw_sources, str):
                raw_sources = [raw_sources]
            elif not isinstance(raw_sources, list):
                raw_sources = ["all"]

            normalized_sources = {
                str(source).strip().lower()
                for source in raw_sources
                if str(source).strip()
            }
            if not normalized_sources:
                normalized_sources = {"all"}

            if "all" in normalized_sources:
                normalized_sources = {
                    "local",
                    "huggingface",
                    "civitai",
                    "civarchive",
                    "lora_manager_archive",
                }

            search_local = "local" in normalized_sources
            search_huggingface_source = "huggingface" in normalized_sources
            search_civitai_source = "civitai" in normalized_sources
            search_civarchive_source = "civarchive" in normalized_sources
            search_lora_manager_archive_source = (
                "lora_manager_archive" in normalized_sources
            )
            if not progress_source:
                progress_source = (
                    next(iter(normalized_sources))
                    if len(normalized_sources) == 1
                    else "all"
                )
            force_search = to_bool(data.get("force_search"), False)

            self.search_tracker.update(
                progress_id,
                progress_source,
                "starting",
                "Preparing search",
                8,
            )
            raise_if_search_cancelled(progress_source)

            if force_search:
                self.search_tracker.update(
                    progress_id,
                    progress_source,
                    "cache",
                    "Refreshing search caches",
                    12,
                )
                if search_local:
                    reload_popular_databases()
                    reload_model_list()
                if search_huggingface_source:
                    clear_huggingface_search_cache()
                if search_civitai_source:
                    clear_civitai_search_cache()
                if search_civarchive_source:
                    clear_civarchive_search_cache()
                if search_lora_manager_archive_source:
                    clear_lora_manager_archive_search_cache()
                self.logger.debug(
                    "Force search enabled: cleared cache "
                    + format_log_fields(sources=sorted(normalized_sources))
                )
            raise_if_search_cancelled(progress_source)

            self.logger.info(
                f"Search [{','.join(sorted(normalized_sources))}] request "
                + format_log_fields(
                    file=filename,
                    cat=category,
                    urn=is_urn,
                    ids=(
                        f"{data.get('model_id')}@{data.get('version_id')}"
                        if data.get("model_id") and data.get("version_id")
                        else data.get("model_id")
                        or data.get("version_id")
                    ),
                    base=base_model_context,
                    force=force_search,
                )
            )

            results = {
                "popular": None,
                "model_list": None,
                "huggingface": None,
                "civitai": None,
                "civarchive": None,
                "lora_manager_archive": None,
                "local_hash_matches": [],
                "found": False,
                "searched_sources": sorted(normalized_sources),
                "source_errors": {},
            }

            def current_search_timestamp():
                from datetime import datetime, timezone

                return (
                    datetime.now(timezone.utc)
                    .replace(microsecond=0)
                    .isoformat()
                )

            def get_search_result_signature(source_key, result):
                if isinstance(result, list):
                    return "|".join(
                        get_search_result_signature(source_key, item)
                        for item in result
                    )
                if not isinstance(result, dict):
                    return ""

                parts = [
                    source_key,
                    result.get("download_url")
                    or result.get("url")
                    or result.get("model_url")
                    or "",
                    result.get("filename") or result.get("path") or "",
                    result.get("repo_id") or result.get("repo") or "",
                    result.get("model_id") or "",
                    result.get("version_id") or "",
                    result.get("name") or "",
                ]
                return "::".join(str(part).strip() for part in parts)

            def stamp_search_result(source_key, result):
                if isinstance(result, list):
                    return [
                        stamp_search_result(source_key, item)
                        for item in result
                    ]
                if not isinstance(result, dict):
                    return result

                signature = get_search_result_signature(source_key, result)
                if not signature:
                    return result

                timestamp = (
                    result.get("searched_at")
                    or result.get("searchedAt")
                    or (
                        None
                        if force_search
                        else self.search_result_timestamps.get(signature)
                    )
                )
                if not timestamp:
                    timestamp = current_search_timestamp()
                if force_search:
                    self.search_result_timestamps[signature] = timestamp
                else:
                    self.search_result_timestamps.setdefault(
                        signature, timestamp
                    )
                result["searched_at"] = timestamp
                return result

            def stamp_search_results(payload):
                for source_key in (
                    "popular",
                    "model_list",
                    "huggingface",
                    "civitai",
                    "civarchive",
                    "lora_manager_archive",
                ):
                    if payload.get(source_key):
                        payload[source_key] = stamp_search_result(
                            source_key, payload[source_key]
                        )
                return payload

            def mark_any_model_fallback(result):
                if isinstance(result, list):
                    return [
                        mark_any_model_fallback(item)
                        for item in result
                    ]
                if not isinstance(result, dict):
                    return result

                marked = dict(result)
                marked["any_model_match"] = True
                marked["base_model_fallback"] = True
                marked["requested_base_model"] = base_model_context
                return marked

            def iter_result_items(result):
                if isinstance(result, list):
                    for item in result:
                        if isinstance(item, dict):
                            yield item
                elif isinstance(result, dict):
                    yield result

            def collect_local_hash_matches(payload):
                matches = []
                seen_match_paths = set()
                seen_hashes = set()
                for source_key in (
                    "huggingface",
                    "civitai",
                    "civarchive",
                    "lora_manager_archive",
                    "popular",
                    "model_list",
                ):
                    for source_result in iter_result_items(payload.get(source_key)):
                        raise_if_search_cancelled(source_key)
                        sha256 = extract_sha256_from_metadata(source_result)
                        if not sha256:
                            continue

                        if sha256 in seen_hashes:
                            continue
                        seen_hashes.add(sha256)

                        self.search_tracker.update(
                            progress_id,
                            progress_source,
                            "local_hash",
                            "Checking local metadata hashes",
                            94,
                        )
                        try:
                            hash_matches = search_local_matches_by_hash(
                                sha256,
                                category=category or None,
                                max_matches=20,
                                force_rescan=force_search,
                            )
                        except Exception as hash_error:
                            self.logger.warning(
                                f"Local metadata hash lookup failed for {source_key}:{sha256}: {hash_error}"
                            )
                            continue

                        for match in hash_matches:
                            model_path = (
                                match.get("model", {}).get("path")
                                or match.get("path")
                                or ""
                            )
                            path_key = model_path.lower()
                            if path_key and path_key in seen_match_paths:
                                continue
                            if path_key:
                                seen_match_paths.add(path_key)
                            enriched = {
                                **match,
                                "hash_lookup_source": source_key,
                                "hash_lookup_filename": source_result.get("filename")
                                or source_result.get("path")
                                or filename,
                                "hash_lookup_sha256": sha256,
                            }
                            matches.append(enriched)

                if matches:
                    self.logger.info(
                        "Search local hash matches "
                        + format_log_fields(count=len(matches))
                    )
                return matches

            def make_source_progress_callback(
                source_key,
                percent_min=None,
                percent_max=None,
            ):
                def source_progress_callback(payload):
                    raise_if_search_cancelled(source_key)
                    if not isinstance(payload, dict):
                        return

                    progress_payload = dict(payload)
                    stage = progress_payload.pop("stage", "running")
                    message = progress_payload.pop(
                        "message", "Searching..."
                    )
                    percent = progress_payload.pop("percent", None)
                    status = progress_payload.pop("status", "running")
                    progress_payload.pop("source", None)

                    if (
                        percent is not None
                        and percent_min is not None
                        and percent_max is not None
                    ):
                        try:
                            normalized_percent = max(
                                0.0, min(100.0, float(percent))
                            )
                            percent = percent_min + (
                                normalized_percent / 100.0
                            ) * (percent_max - percent_min)
                        except (TypeError, ValueError):
                            percent = None

                    self.search_tracker.update(
                        progress_id,
                        source_key,
                        stage,
                        message,
                        percent,
                        status=status,
                        **progress_payload,
                    )

                return source_progress_callback

            def run_source_search(
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
                raise_if_search_cancelled(source_key)
                self.search_tracker.update(
                    progress_id,
                    source_key,
                    initial_stage,
                    initial_message,
                    initial_percent,
                )
                start_fields = log_start_fields or {"file": filename}
                self.logger.info(
                    f"Search [{source_key}] start "
                    + format_log_fields(**start_fields)
                )
                try:
                    raise_if_search_cancelled(source_key)
                    source_results, source_found = search_task_fn()
                    raise_if_search_cancelled(source_key)
                    done_messages = {
                        "local": "Local database checked",
                        "huggingface": "HuggingFace checked",
                        "civitai": "CivitAI checked",
                        "civarchive": "CivArchive checked",
                        "lora_manager_archive": "LoRA Manager archive checked",
                    }
                    done_msg = done_messages.get(source_key, f"{source_key} checked")
                    self.search_tracker.update(
                        progress_id,
                        source_key,
                        "done",
                        done_msg,
                        92,
                    )
                    return source_results, source_found
                except Exception as e:
                    if error_handlers:
                        for exc_type, handler_fn in error_handlers.items():
                            if isinstance(e, exc_type):
                                return handler_fn(e)
                    raise e

            def execute_search_with_fallback(
                source_key,
                search_fn,
                any_model_label,
            ):
                raise_if_search_cancelled(source_key)
                res = search_fn(
                    base_model_context or None,
                    make_source_progress_callback(source_key),
                )
                raise_if_search_cancelled(source_key)
                log_search_result(source_key, res)

                if not res and base_model_context:
                    raise_if_search_cancelled(source_key)
                    self.search_tracker.update(
                        progress_id,
                        source_key,
                        "any_model",
                        f"Retrying {any_model_label} any model",
                        72,
                    )
                    self.logger.info(
                        f"Search [{source_key}] retry any model "
                        + format_log_fields(
                            file=filename,
                            cat=category,
                            base=base_model_context,
                        )
                    )
                    res = search_fn(
                        None,
                        make_source_progress_callback(source_key, 72, 92),
                    )
                    raise_if_search_cancelled(source_key)
                    log_search_result(f"{source_key}/any_model", res)
                    if res:
                        res = mark_any_model_fallback(res)
                return res

            def search_local_sources():
                def task():
                    source_results = {"popular": None, "model_list": None}
                    source_found = False

                    popular_info = get_popular_model_url(filename)
                    log_search_result("popular", popular_info)
                    self.search_tracker.update(
                        progress_id,
                        "local",
                        "model_list",
                        "Checking local model database",
                        58,
                    )
                    model_list_result = search_model_list(filename)
                    log_search_result(
                        "model_list",
                        model_list_result,
                        {
                            "confidence": model_list_result.get("confidence")
                            if model_list_result
                            else None
                        },
                    )
                    if popular_info:
                        popular_result = {
                            "source": "popular",
                            "filename": filename,
                            **popular_info,
                        }
                        if (
                            model_list_result
                            and model_list_result.get("filename", "").lower()
                            == filename.lower()
                            and model_list_result.get("size")
                        ):
                            popular_result["size"] = model_list_result.get(
                                "size"
                            )
                        source_results["popular"] = popular_result
                        source_found = True

                    if model_list_result:
                        confidence = model_list_result.get("confidence", 0)
                        if (is_urn and confidence >= 70) or not is_urn:
                            source_results["model_list"] = model_list_result
                            source_found = True

                    return source_results, source_found

                return run_source_search(
                    "local",
                    task,
                    initial_stage="popular",
                    initial_message="Checking popular models",
                    initial_percent=28,
                    log_start_fields={"file": filename, "cat": category},
                )

            def search_huggingface_source_task():
                def task():
                    hf_result = search_huggingface_for_file(
                        filename,
                        token=hf_token or None,
                        brave_api_key=brave_search_api_key or None,
                        use_api_search=hf_use_api_search,
                        use_comfy_org_fallback=hf_use_comfy_org_fallback,
                        use_brave_fallback=hf_use_brave_fallback,
                        force_refresh=force_search,
                        progress_callback=make_source_progress_callback(
                            "huggingface"
                        ),
                    )
                    log_search_result("huggingface", hf_result)
                    return {"huggingface": hf_result}, bool(hf_result)

                return run_source_search(
                    "huggingface",
                    task,
                    initial_stage="query",
                    initial_message="Querying HuggingFace",
                    initial_percent=32,
                    log_start_fields={"file": filename},
                )

            def search_civitai_source_task():
                def task():
                    source_results = {"civitai": None}
                    source_found = False

                    if is_urn:
                        model_id_val = data.get("model_id")
                        version_id_val = data.get("version_id")

                        if model_id_val and version_id_val:
                            self.search_tracker.update(
                                progress_id,
                                "civitai",
                                "urn",
                                "Resolving CivitAI URN",
                                46,
                            )
                            model_info = resolve_urn(model_id_val, version_id_val)
                            if model_info:
                                self.search_tracker.update(
                                    progress_id,
                                    "civitai",
                                    "file",
                                    "Selecting CivitAI file",
                                    76,
                                )
                                primary_file = None
                                for file_info in model_info.get("files", []):
                                    if (
                                        file_info.get("name")
                                        == model_info.get("expected_filename")
                                    ):
                                        primary_file = file_info
                                        break
                                if primary_file is None:
                                    primary_file = (
                                        model_info.get("files") or [{}]
                                    )[0]

                                download_url = get_civitai_download_url(
                                    version_id_val
                                )
                                source_results["civitai"] = build_search_result(
                                    "civitai",
                                    model_id=model_id_val,
                                    version_id=version_id_val,
                                    name=model_info.get("model_name"),
                                    version_name=model_info.get("version_name"),
                                    filename=model_info.get("expected_filename"),
                                    type=category,
                                    download_url=download_url,
                                    url=f"https://civitai.com/models/{model_id_val}?modelVersionId={version_id_val}",
                                    size=primary_file.get("size"),
                                    base_model=model_info.get("base_model"),
                                    tags=model_info.get("tags", []),
                                    sha256=primary_file.get("sha256")
                                    or (primary_file.get("hashes") or {}).get("SHA256")
                                    or (primary_file.get("hashes") or {}).get("sha256"),
                                    hashes=primary_file.get("hashes") or {},
                                    match_type="exact",
                                    confidence=100.0,
                                )
                                log_search_result(
                                    "civitai/urn",
                                    source_results["civitai"],
                                    {
                                        "files_count": len(
                                            model_info.get("files", [])
                                        )
                                    },
                                )
                                source_found = True
                            else:
                                log_search_result(
                                    "civitai/urn",
                                    None,
                                    {
                                        "model_id": model_id_val,
                                        "version_id": version_id_val,
                                    },
                                )
                        elif category:
                            self.search_tracker.update(
                                progress_id,
                                "civitai",
                                "fallback",
                                "Searching CivitAI fallback",
                                58,
                            )
                            self.logger.info(
                                "Search [civitai] URN ids missing; falling back"
                            )
                            civitai_results = search_civitai(
                                filename,
                                model_type=category,
                            )
                            log_search_result(
                                "civitai/fallback",
                                civitai_results[0] if civitai_results else None,
                                {
                                    "results_count": len(civitai_results),
                                },
                            )
                            if civitai_results:
                                first_result = civitai_results[0]
                                source_results["civitai"] = build_search_result(
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
                        civitai_result = execute_search_with_fallback(
                            "civitai",
                            lambda base_ctx, cb: search_civitai_for_file(
                                filename,
                                api_key=civitai_key or None,
                                model_type=category,
                                base_model_context=base_ctx,
                                session_token=civitai_session_token or None,
                                candidate_limit=civitai_candidate_limit,
                                use_trpc_search=civitai_use_trpc_search,
                                use_api_search=civitai_use_api_search,
                                use_html_fallback=civitai_use_html_fallback,
                                progress_callback=cb,
                            ),
                            "CivitAI"
                        )
                        if civitai_result:
                            source_results["civitai"] = civitai_result
                            source_found = True

                    return source_results, source_found

                return run_source_search(
                    "civitai",
                    task,
                    initial_stage="query",
                    initial_message="Querying CivitAI",
                    initial_percent=30,
                    log_start_fields={
                        "file": filename,
                        "cat": category,
                        "urn": is_urn,
                    },
                )

            def search_civarchive_source_task():
                def task():
                    source_results = {"civarchive": None}
                    source_found = False

                    if is_urn:
                        model_id_val = data.get("model_id")
                        version_id_val = data.get("version_id")
                        if model_id_val and version_id_val:
                            self.search_tracker.update(
                                progress_id,
                                "civarchive",
                                "urn",
                                "Resolving CivArchive version",
                                50,
                            )
                            civarchive_result = resolve_civarchive_model_version(
                                model_id_val,
                                version_id_val,
                                query=filename,
                            )
                            log_search_result(
                                "civarchive/urn",
                                civarchive_result,
                                {
                                    "model_id": model_id_val,
                                    "version_id": version_id_val,
                                },
                            )
                            if civarchive_result:
                                source_results["civarchive"] = civarchive_result
                                source_found = True
                        else:
                            log_search_result(
                                "civarchive/urn",
                                None,
                                {
                                    "model_id": model_id_val,
                                    "version_id": version_id_val,
                                },
                            )
                    else:
                        civarchive_result = execute_search_with_fallback(
                            "civarchive",
                            lambda base_ctx, cb: search_civarchive_for_file(
                                filename,
                                model_type=category,
                                base_model_context=base_ctx,
                                limit=civarchive_candidate_limit,
                                progress_callback=cb,
                            ),
                            "CivArchive"
                        )
                        if civarchive_result:
                            source_results["civarchive"] = civarchive_result
                            source_found = True

                    return source_results, source_found

                def handle_civarchive_error(e):
                    error_message = f"CivArchive search failed: {e}"
                    self.logger.warning(error_message)
                    self.search_tracker.update(
                        progress_id,
                        "civarchive",
                        "error",
                        error_message,
                        100,
                        status="error",
                    )
                    return {
                        "civarchive": None,
                        "source_errors": {"civarchive": error_message},
                    }, False

                return run_source_search(
                    "civarchive",
                    task,
                    initial_stage="query",
                    initial_message="Querying CivArchive",
                    initial_percent=30,
                    log_start_fields={
                        "file": filename,
                        "cat": category,
                        "urn": is_urn,
                    },
                    error_handlers={CivArchiveSearchError: handle_civarchive_error},
                )

            def search_lora_manager_archive_source_task():
                def task():
                    lora_manager_archive_result = execute_search_with_fallback(
                        "lora_manager_archive",
                        lambda base_ctx, cb: search_lora_manager_archive_for_file(
                            filename,
                            model_type=category,
                            base_model_context=base_ctx,
                            progress_callback=cb,
                        ),
                        "LoRA archive"
                    )
                    return (
                        {
                            "lora_manager_archive": lora_manager_archive_result
                        },
                        bool(lora_manager_archive_result),
                    )

                return run_source_search(
                    "lora_manager_archive",
                    task,
                    initial_stage="query",
                    initial_message="Searching LoRA Manager archive",
                    initial_percent=36,
                    log_start_fields={"file": filename, "cat": category},
                )


            search_tasks = []
            if search_local:
                search_tasks.append(
                    asyncio.to_thread(search_local_sources)
                )
            if search_huggingface_source:
                search_tasks.append(
                    asyncio.to_thread(search_huggingface_source_task)
                )
            if search_civitai_source:
                search_tasks.append(
                    asyncio.to_thread(search_civitai_source_task)
                )
            if search_civarchive_source and (
                filename or (is_urn and model_id and version_id)
            ):
                search_tasks.append(
                    asyncio.to_thread(search_civarchive_source_task)
                )
            if search_lora_manager_archive_source and filename:
                search_tasks.append(
                    asyncio.to_thread(
                        search_lora_manager_archive_source_task
                    )
                )

            if len(search_tasks) > 1:
                self.logger.debug(
                    "Search sources async "
                    + format_log_fields(count=len(search_tasks))
                )
            self.search_tracker.update(
                progress_id,
                progress_source,
                "running",
                "Waiting for search sources",
                18,
            )
            raise_if_search_cancelled(progress_source)

            for source_results, source_found in await asyncio.gather(
                *search_tasks
            ):
                raise_if_search_cancelled(progress_source)
                for source_key, source_result in source_results.items():
                    if source_key == "source_errors":
                        results["source_errors"].update(source_result or {})
                        continue
                    if source_result:
                        results[source_key] = source_result
                if source_found:
                    results["found"] = True

            raise_if_search_cancelled(progress_source)
            results["local_hash_matches"] = collect_local_hash_matches(results)
            raise_if_search_cancelled(progress_source)

            self.logger.info(
                f"Search [{','.join(results['searched_sources'])}] done "
                + format_log_fields(
                    found=results["found"],
                )
            )
            self.search_tracker.update(
                progress_id,
                progress_source,
                "completed",
                "Search complete",
                100,
                status="completed",
            )
            stamp_search_results(results)
            return web.json_response(results)

        except SearchCancelled:
            self.search_tracker.update(
                progress_id if "progress_id" in locals() else "",
                progress_source if "progress_source" in locals() else "",
                "cancelled",
                "Cancelled",
                100,
                status="cancelled",
                cancelled=True,
            )
            self.logger.info(
                "Search cancelled "
                + format_log_fields(
                    source=progress_source if "progress_source" in locals() else "",
                    progress_id=progress_id if "progress_id" in locals() else "",
                )
            )
            return web.json_response(
                {
                    "cancelled": True,
                    "found": False,
                    "searched_sources": sorted(normalized_sources)
                    if "normalized_sources" in locals()
                    else [],
                    "source_errors": {},
                }
            )

        except Exception as e:
            self.search_tracker.update(
                progress_id if "progress_id" in locals() else "",
                progress_source if "progress_source" in locals() else "",
                "error",
                str(e),
                100,
                status="error",
            )
            self.logger.exception(f"Model Resolver search error: {e}")
            return web.json_response({"error": str(e)}, status=500)


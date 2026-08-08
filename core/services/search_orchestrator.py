"""Request orchestration for model source searches."""

from ..local_hash_matches import collect_local_hash_matches_for_result
from ..request_utils import extract_request_sha256
from ..routes.context import RouteContext
from .search_cache import SearchResultCache
from .search_dependencies import SearchDependencies
from .search_providers import (
    SearchCancelled,
    SearchProviderRunner,
    SearchRequest,
)


class SearchOrchestrator:
    """Parse search requests, coordinate providers, and build responses."""

    def __init__(self, context: RouteContext):
        dependencies = SearchDependencies.from_context(context)
        self.dependencies = dependencies
        self.search_tracker = dependencies.search_tracker
        self.search_result_timestamps = dependencies.search_result_timestamps
        self.logger = dependencies.logger
        self.CivArchiveSearchError = dependencies.civarchive_search_error
        self.asyncio = dependencies.asyncio
        self.build_model_result = dependencies.build_model_result
        self.clear_civarchive_search_cache = (
            dependencies.clear_civarchive_search_cache
        )
        self.clear_civitai_search_cache = dependencies.clear_civitai_search_cache
        self.clear_huggingface_search_cache = (
            dependencies.clear_huggingface_search_cache
        )
        self.clear_lora_manager_archive_search_cache = (
            dependencies.clear_lora_manager_archive_search_cache
        )
        self.extract_sha256_from_metadata = dependencies.extract_sha256_from_metadata
        self.format_size_bytes = dependencies.format_size_bytes
        self.get_civitai_download_url = dependencies.get_civitai_download_url
        self.get_popular_model_url = dependencies.get_popular_model_url
        self.reload_model_list = dependencies.reload_model_list
        self.reload_popular_databases = dependencies.reload_popular_databases
        self.resolve_civarchive_model_version = (
            dependencies.resolve_civarchive_model_version
        )
        self.resolve_urn = dependencies.resolve_urn
        self.search_civarchive_for_file = dependencies.search_civarchive_for_file
        self.search_civitai = dependencies.search_civitai
        self.search_civitai_for_file = dependencies.search_civitai_for_file
        self.search_huggingface_for_file = dependencies.search_huggingface_for_file
        self.search_local_matches_by_hash = dependencies.search_local_matches_by_hash
        self.search_lora_manager_archive_for_file = (
            dependencies.search_lora_manager_archive_for_file
        )
        self.search_model_list = dependencies.search_model_list
        self.to_bool = dependencies.to_bool
        self.to_int = dependencies.to_int
        self.web = dependencies.web
        self.search_cache = SearchResultCache(self.search_result_timestamps)
        self.provider_runner = SearchProviderRunner(self)

    def format_log_value(self, value):
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

    def format_log_size(self, value):
        return self.format_size_bytes(value, include_space=False)

    def format_log_fields(self, **fields):
        parts = []
        for key, value in fields.items():
            formatted = self.format_log_value(value)
            if formatted is not None:
                parts.append(f"{key}={formatted}")
        return " ".join(parts)

    def normalize_result_extra(self, extra):
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

    def format_result_details(self, result, extra=None):
        if isinstance(result, list):
            return self.format_log_fields(count=len(result))
        if not isinstance(result, dict):
            fields = {"result": "none" if result is None else result}
            fields.update(self.normalize_result_extra(extra))
            return self.format_log_fields(**fields)

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
            "size": self.format_log_size(result.get("size")),
            "files": result.get("files_count"),
        }
        fields.update(self.normalize_result_extra(extra))
        return self.format_log_fields(**fields)

    def log_search_result(self, source_name, result, extra=None):
        details = self.format_result_details(result, extra)
        if result and (not isinstance(result, list) or len(result) > 0):
            self.logger.info(f"Search [{source_name}] found {details}")
        else:
            self.logger.info(f"Search [{source_name}] miss {details}")

    async def search_sources(self, request):
        """Execute all requested sources and return a JSON response."""
        try:
            data = await request.json()
            filename = str(data.get("filename", "") or "").strip()
            sha256 = extract_request_sha256(
                data,
                keys=("sha256", "hash", "file_hash"),
            )
            category = data.get("category", "")
            base_model_context = data.get("base_model_context", "")
            progress_id = str(data.get("progress_id") or "").strip()
            progress_source = str(data.get("progress_source") or "").strip()
            civitai_candidate_limit = self.to_int(
                data.get("civitai_candidate_limit"),
                5,
            )
            civitai_candidate_limit = max(1, min(civitai_candidate_limit, 20))
            civarchive_candidate_limit = self.to_int(
                data.get("civarchive_candidate_limit"),
                10,
            )
            civarchive_candidate_limit = max(
                1,
                min(civarchive_candidate_limit, 30),
            )

            is_urn = self.to_bool(data.get("is_urn", False), False)
            civitai_key = data.get("civitai_key", "")
            civitai_session_token = data.get("civitai_session_token", "")
            hf_token = data.get("hf_token", "")
            brave_search_api_key = data.get("brave_search_api_key", "")
            civitai_use_trpc_search = self.to_bool(
                data.get("civitai_use_trpc_search", True),
                True,
            )
            civitai_use_api_search = self.to_bool(
                data.get("civitai_use_api_search", True),
                True,
            )
            civitai_use_html_fallback = self.to_bool(
                data.get("civitai_use_html_fallback", True),
                True,
            )
            hf_use_api_search = self.to_bool(
                data.get("hf_use_api_search", True),
                True,
            )
            hf_use_comfy_org_fallback = self.to_bool(
                data.get("hf_use_comfy_org_fallback", True),
                True,
            )
            hf_use_brave_fallback = self.to_bool(
                data.get("hf_use_brave_fallback", True),
                True,
            )

            model_id = data.get("model_id")
            version_id = data.get("version_id")
            if not filename and not sha256 and not (is_urn and model_id and version_id):
                return self.web.json_response(
                    {
                        "error": (
                            "Filename is required for non-URN, or "
                            "model_id+version_id for URN"
                        )
                    },
                    status=400,
                )

            raw_sources = data.get("sources", ["all"])
            if isinstance(raw_sources, str):
                raw_sources = [raw_sources]
            elif not isinstance(raw_sources, list):
                raw_sources = ["all"]

            normalized_sources = frozenset(
                str(source).strip().lower()
                for source in raw_sources
                if str(source).strip()
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
            force_search = self.to_bool(data.get("force_search"), False)
            search_request = SearchRequest(
                data=data,
                filename=filename,
                category=category,
                base_model_context=base_model_context,
                progress_id=progress_id,
                progress_source=progress_source,
                civitai_candidate_limit=civitai_candidate_limit,
                civarchive_candidate_limit=civarchive_candidate_limit,
                is_urn=is_urn,
                civitai_key=civitai_key,
                civitai_session_token=civitai_session_token,
                hf_token=hf_token,
                brave_search_api_key=brave_search_api_key,
                civitai_use_trpc_search=civitai_use_trpc_search,
                civitai_use_api_search=civitai_use_api_search,
                civitai_use_html_fallback=civitai_use_html_fallback,
                hf_use_api_search=hf_use_api_search,
                hf_use_comfy_org_fallback=hf_use_comfy_org_fallback,
                hf_use_brave_fallback=hf_use_brave_fallback,
                force_search=force_search,
                normalized_sources=normalized_sources,
                sha256=sha256,
            )
            raise_if_search_cancelled = (
                self.provider_runner.raise_if_search_cancelled
            )

            self.search_tracker.update(
                progress_id,
                progress_source,
                "starting",
                "Preparing search",
                8,
            )
            raise_if_search_cancelled(search_request, progress_source)

            if force_search:
                self.search_tracker.update(
                    progress_id,
                    progress_source,
                    "cache",
                    "Refreshing search caches",
                    12,
                )
                if search_request.search_local:
                    self.reload_popular_databases()
                    self.reload_model_list()
                if search_request.search_huggingface_source:
                    self.clear_huggingface_search_cache()
                if search_request.search_civitai_source:
                    self.clear_civitai_search_cache()
                if search_request.search_civarchive_source:
                    self.clear_civarchive_search_cache()
                if search_request.search_lora_manager_archive_source:
                    self.clear_lora_manager_archive_search_cache()
                self.logger.debug(
                    "Force search enabled: cleared cache "
                    + self.format_log_fields(
                        sources=sorted(normalized_sources),
                    )
                )
            raise_if_search_cancelled(search_request, progress_source)

            self.logger.info(
                f"Search [{','.join(sorted(normalized_sources))}] request "
                + self.format_log_fields(
                    file=filename,
                    cat=category,
                    urn=is_urn,
                    ids=(
                        f"{model_id}@{version_id}"
                        if model_id and version_id
                        else model_id or version_id
                    ),
                    base=base_model_context,
                    sha256=sha256,
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
                "source_status": {},
                "search_mode": "sha256" if sha256 else "name",
                "search_sha256": sha256,
            }

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
                source_entries = []
                if search_request.sha256:
                    source_entries.append(
                        (
                            "sha256_query",
                            {
                                "filename": filename,
                                "sha256": search_request.sha256,
                            },
                        )
                    )
                source_entries.extend(
                    (
                        source_key,
                        source_result,
                    )
                    for source_key in (
                        "huggingface",
                        "civitai",
                        "civarchive",
                        "lora_manager_archive",
                        "popular",
                        "model_list",
                    )
                    for source_result in iter_result_items(payload.get(source_key))
                )
                for source_key, source_result in source_entries:
                    raise_if_search_cancelled(search_request, source_key)
                    sha256 = self.extract_sha256_from_metadata(source_result)
                    if not sha256 or sha256 in seen_hashes:
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
                        hash_matches = collect_local_hash_matches_for_result(
                            sha256,
                            search_local_matches_by_hash=self.search_local_matches_by_hash,
                            category=category or None,
                            max_matches=20,
                            force_rescan=force_search,
                            source=source_key,
                            filename=(
                                source_result.get("filename")
                                or source_result.get("path")
                                or filename
                            ),
                        )
                    except Exception as hash_error:
                        self.logger.warning(
                            "Local metadata hash lookup failed "
                            f"for {source_key}:{sha256}: {hash_error}"
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
                        matches.append(match)

                if matches:
                    self.logger.info(
                        "Search local hash matches "
                        + self.format_log_fields(count=len(matches))
                    )
                return matches

            search_tasks = self.provider_runner.create_search_tasks(
                search_request
            )
            if len(search_tasks) > 1:
                self.logger.debug(
                    "Search sources async "
                    + self.format_log_fields(count=len(search_tasks))
                )
            self.search_tracker.update(
                progress_id,
                progress_source,
                "running",
                "Waiting for search sources",
                18,
            )
            raise_if_search_cancelled(search_request, progress_source)

            for source_results, source_found in await self.asyncio.gather(
                *search_tasks
            ):
                raise_if_search_cancelled(search_request, progress_source)
                for source_key, source_result in source_results.items():
                    if source_key == "source_errors":
                        results["source_errors"].update(source_result or {})
                    elif source_key == "source_status":
                        results["source_status"].update(source_result or {})
                    elif source_result:
                        results[source_key] = source_result
                if source_found:
                    results["found"] = True

            raise_if_search_cancelled(search_request, progress_source)
            results["local_hash_matches"] = collect_local_hash_matches(results)
            if results["local_hash_matches"]:
                results["found"] = True
            raise_if_search_cancelled(search_request, progress_source)

            self.logger.info(
                f"Search [{','.join(results['searched_sources'])}] done "
                + self.format_log_fields(found=results["found"])
            )
            self.search_tracker.update(
                progress_id,
                progress_source,
                "completed",
                "Search complete",
                100,
                status="completed",
            )
            self.search_cache.stamp_results(
                results,
                force_search=force_search,
            )
            return self.web.json_response(results)

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
                + self.format_log_fields(
                    source=(
                        progress_source
                        if "progress_source" in locals()
                        else ""
                    ),
                    progress_id=(
                        progress_id if "progress_id" in locals() else ""
                    ),
                )
            )
            return self.web.json_response(
                {
                    "cancelled": True,
                    "found": False,
                    "searched_sources": (
                        sorted(normalized_sources)
                        if "normalized_sources" in locals()
                        else []
                    ),
                    "source_errors": {},
                    "source_status": {},
                }
            )

        except Exception as exc:
            self.search_tracker.update(
                progress_id if "progress_id" in locals() else "",
                progress_source if "progress_source" in locals() else "",
                "error",
                str(exc),
                100,
                status="error",
            )
            self.logger.exception(f"Model Resolver search error: {exc}")
            return self.web.json_response({"error": str(exc)}, status=500)

"""Custom model URL service."""

from ..contracts import SearchResult
from ..local_hash_matches import collect_local_hash_matches_for_result
from ..request_utils import (
    read_first_text_field,
    read_optional_object_payload,
    read_text_field,
)
from ..routes.context import RouteContext
from .model_utils import CustomUrlDependencies, ModelServiceDependencies


class CustomUrlService(ModelServiceDependencies):
    """Resolve provider URLs into normalized model results."""

    def __init__(self, context: RouteContext):
        super().__init__(CustomUrlDependencies.from_context(context))

    async def custom_url(self, request):
        """Resolve a user-provided provider URL into a normal search result."""
        UnsafeUrlError = self.UnsafeUrlError
        asyncio = self.asyncio
        build_model_result = self.build_model_result
        build_civarchive_custom_result = self.build_civarchive_custom_result
        build_civitai_custom_result = self.build_civitai_custom_result
        build_huggingface_custom_result = self.build_huggingface_custom_result
        extract_sha256_from_metadata = self.extract_sha256_from_metadata
        get_civarchive_model_details = self.get_civarchive_model_details
        get_civitai_download_url = self.get_civitai_download_url
        get_civitai_model_details = self.get_civitai_model_details
        get_filename_from_path = self.get_filename_from_path
        host_matches_domain = self.host_matches_domain
        looks_like_model_file = self.looks_like_model_file
        normalize_category_to_model_type = self.normalize_category_to_model_type
        normalize_sha256 = self.normalize_sha256
        parse_civarchive_url = self.parse_civarchive_url
        parse_civitai_url = self.parse_civitai_url
        resolve_civarchive_by_hash = self.resolve_civarchive_by_hash
        resolve_civarchive_model_version = self.resolve_civarchive_model_version
        resolve_civitai_version_custom_result = self.resolve_civitai_version_custom_result
        search_local_matches_by_hash = self.search_local_matches_by_hash
        time = self.time
        validate_public_http_url = self.validate_public_http_url
        web = self.web
        def _custom_result_timestamp():
            return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        def _as_search_result(value, source=""):
            if isinstance(value, SearchResult):
                return value
            return None






        def _build_direct_custom_download_result(url, source, expected_filename=""):
            from urllib.parse import urlparse

            if not looks_like_model_file(url, expected_filename):
                return None

            parsed = urlparse(url)
            filename = (
                get_filename_from_path(parsed.path)
                or get_filename_from_path(expected_filename)
                or "model"
            )
            if expected_filename and "." in get_filename_from_path(expected_filename):
                filename = get_filename_from_path(expected_filename)
            source = str(source or "custom").strip().lower()
            source_label = {
                "civarchive": "CivArchive",
                "civitai": "CivitAI",
                "huggingface": "HuggingFace",
            }.get(source, "Custom URL")
            return build_model_result(
                source,
                name=source_label,
                filename=filename,
                url=url,
                version_url=url,
                download_url=url,
                match_type="custom_url",
                details_source=source,
                custom_url=True,
                result_mode="compact_custom_url",
            )

        def _collect_custom_url_local_hash_matches(result, category):
            result_mapping = result.to_dict()
            source_key = str(result.source or "custom").strip().lower()
            sha256 = normalize_sha256(
                extract_sha256_from_metadata(result_mapping)
            )
            if not sha256:
                return []

            try:
                return collect_local_hash_matches_for_result(
                    sha256,
                    search_local_matches_by_hash=search_local_matches_by_hash,
                    category=category or None,
                    max_matches=20,
                    source=source_key,
                    filename=result.filename
                    or result.extra_value("path")
                    or "",
                )
            except Exception as hash_error:
                self.logger.warning(
                    f"Custom URL local metadata hash lookup failed for {source_key}:{sha256}: {hash_error}"
                )
                return []

        data = await read_optional_object_payload(request)
        try:
            raw_url = read_first_text_field(
                data,
                ("url", "custom_url"),
                contract_name="Custom URL request",
            )
            category = read_text_field(
                data,
                "category",
                contract_name="Custom URL request",
            )
            filename = read_text_field(
                data,
                "filename",
                contract_name="Custom URL request",
            )
            original_path = read_text_field(
                data,
                "original_path",
                contract_name="Custom URL request",
            )
            civitai_key = read_text_field(
                data,
                "civitai_key",
                contract_name="Custom URL request",
            )
            hf_token = read_text_field(
                data,
                "hf_token",
                contract_name="Custom URL request",
            )
        except TypeError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        if not raw_url:
            return web.json_response(
                {"error": "URL is required"}, status=400
            )

        if raw_url.startswith("hf://"):
            normalized_url = raw_url
        else:
            try:
                normalized_url = await asyncio.to_thread(
                    validate_public_http_url,
                    raw_url,
                )
            except UnsafeUrlError as exc:
                return web.json_response(
                    {"error": str(exc)},
                    status=400,
                )

        expected_filename = (
            filename
            or get_filename_from_path(original_path)
            or ""
        )

        result = None
        source = ""
        try:
            civitai_parsed = parse_civitai_url(normalized_url)
        except Exception:
            civitai_parsed = None
        try:
            civarchive_parsed = parse_civarchive_url(normalized_url)
        except Exception:
            civarchive_parsed = None

        if civitai_parsed:
            source = "civitai"
            model_id = civitai_parsed.model_id
            version_id = civitai_parsed.version_id
            if model_id:
                details = await asyncio.to_thread(
                    get_civitai_model_details,
                    model_id,
                    version_id,
                    civitai_key or None,
                )
                result = build_civitai_custom_result(
                    details,
                    expected_filename=expected_filename,
                    api_key=civitai_key or None,
                )
            elif version_id:
                result = await asyncio.to_thread(
                    resolve_civitai_version_custom_result,
                    version_id,
                    expected_filename,
                    civitai_key or None,
                )
            if not result and version_id:
                result = build_model_result(
                    "civitai",
                    version_id=version_id,
                    name=expected_filename or f"CivitAI version {version_id}",
                    filename=expected_filename or f"civitai-{version_id}",
                    url=normalized_url,
                    version_url=normalized_url,
                    download_url=get_civitai_download_url(
                        version_id,
                        civitai_key or None,
                    ),
                    match_type="custom_url",
                    details_source="civitai",
                    custom_url=True,
                    result_mode="compact_custom_url",
                )
        elif civarchive_parsed:
            source = "civarchive"
            if civarchive_parsed.sha256:
                result = await asyncio.to_thread(
                    resolve_civarchive_by_hash,
                    civarchive_parsed.sha256,
                    expected_filename,
                    False,
                    normalize_category_to_model_type(category),
                )
            else:
                model_id = civarchive_parsed.model_id
                version_id = civarchive_parsed.version_id
                if model_id:
                    result = await asyncio.to_thread(
                        resolve_civarchive_model_version,
                        model_id,
                        version_id,
                        expected_filename or str(model_id),
                        False,
                        True,
                    )
                    if not result:
                        details = await asyncio.to_thread(
                            get_civarchive_model_details,
                            model_id,
                            version_id,
                            True,
                        )
                        result = build_civarchive_custom_result(
                            details,
                            expected_filename=expected_filename,
                        )
            if result:
                result = _as_search_result(result, source="civarchive")
                if result is not None:
                    result = result.with_updates(
                        source="civarchive",
                        details_source="civarchive",
                        match_type="custom_url",
                        custom_url=True,
                    )
        else:
            from urllib.parse import urlparse

            parsed_direct = urlparse(normalized_url)
            direct_host = parsed_direct.hostname
            if (
                host_matches_domain(direct_host, "civarchive.com")
                and "/api/download/" in parsed_direct.path
            ):
                source = "civarchive"
                result = _build_direct_custom_download_result(
                    normalized_url,
                    "civarchive",
                    expected_filename,
                )
            else:
                result = await asyncio.to_thread(
                    build_huggingface_custom_result,
                    normalized_url,
                    expected_filename,
                    hf_token or None,
                )
                if result:
                    source = "huggingface"

        if not result:
            return web.json_response(
                {
                    "error": (
                        "Unsupported or unresolved URL. Use a HuggingFace file URL, "
                        "CivitAI model/download URL, or CivArchive model/hash URL."
                    )
                },
                status=400,
            )

        result = _as_search_result(result, source=source)
        if result is None:
            return web.json_response(
                {"error": "The URL resolved to an invalid model result"},
                status=400,
            )

        result = result.with_extra(
            provided_url=normalized_url,
            url_source="custom",
            searched_at=result.extra_value("searched_at")
            or _custom_result_timestamp(),
            category=result.extra_value("category") or category,
        )
        if expected_filename and not result.filename:
            result = result.with_updates(filename=expected_filename)

        if not (result.download_url or result.url):
            return web.json_response(
                {"error": "The URL resolved, but no download URL was found"},
                status=400,
            )

        source = source or result.source or "custom"
        local_hash_matches = _collect_custom_url_local_hash_matches(
            result,
            category,
        )
        result_mapping = result.to_dict()
        response = {
            "success": True,
            "source": source,
            "result": result_mapping,
            "custom": [result_mapping],
            "searched_sources": ["custom"],
            "local_hash_matches": [
                match.to_dict() for match in local_hash_matches
            ],
        }
        response[source] = result_mapping
        return web.json_response(response)

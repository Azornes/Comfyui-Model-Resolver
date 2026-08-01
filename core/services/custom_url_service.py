"""Custom model URL service."""

from .model_utils import ModelServiceDependencies


class CustomUrlService(ModelServiceDependencies):
    """Resolve provider URLs into normalized model results."""

    async def custom_url(self, request):
        """Resolve a user-provided provider URL into a normal search result."""
        UnsafeUrlError = self.UnsafeUrlError
        asyncio = self.asyncio
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
            return {
                "source": source,
                "details_source": source,
                "name": source_label,
                "filename": filename,
                "url": url,
                "version_url": url,
                "download_url": url,
                "match_type": "custom_url",
                "custom_url": True,
            }

        def _collect_custom_url_local_hash_matches(result, category):
            source_key = str(result.get("source") or "custom").strip().lower()
            sha256 = normalize_sha256(extract_sha256_from_metadata(result))
            if not sha256:
                return []

            try:
                matches = search_local_matches_by_hash(
                    sha256,
                    category=category or None,
                    max_matches=20,
                )
            except Exception as hash_error:
                self.logger.warning(
                    f"Custom URL local metadata hash lookup failed for {source_key}:{sha256}: {hash_error}"
                )
                return []

            return [
                {
                    **match,
                    "hash_lookup_source": source_key,
                    "hash_lookup_filename": result.get("filename")
                    or result.get("path")
                    or "",
                    "hash_lookup_sha256": sha256,
                }
                for match in matches
            ]

        data = await request.json()
        raw_url = str(data.get("url") or data.get("custom_url") or "").strip()
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

        category = data.get("category") or ""
        expected_filename = (
            data.get("filename")
            or get_filename_from_path(data.get("original_path") or "")
            or ""
        )
        civitai_key = data.get("civitai_key", "")
        hf_token = data.get("hf_token", "")

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
            model_id = civitai_parsed.get("model_id")
            version_id = civitai_parsed.get("version_id")
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
                result = {
                    "source": "civitai",
                    "details_source": "civitai",
                    "version_id": version_id,
                    "name": expected_filename or f"CivitAI version {version_id}",
                    "filename": expected_filename or f"civitai-{version_id}",
                    "url": normalized_url,
                    "version_url": normalized_url,
                    "download_url": get_civitai_download_url(
                        version_id,
                        civitai_key or None,
                    ),
                    "match_type": "custom_url",
                    "custom_url": True,
                }
        elif civarchive_parsed:
            source = "civarchive"
            if civarchive_parsed.get("sha256"):
                result = await asyncio.to_thread(
                    resolve_civarchive_by_hash,
                    civarchive_parsed.get("sha256"),
                    expected_filename,
                    False,
                    normalize_category_to_model_type(category),
                )
            else:
                model_id = civarchive_parsed.get("model_id")
                version_id = civarchive_parsed.get("version_id")
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
                result = dict(result)
                result["source"] = "civarchive"
                result["details_source"] = "civarchive"
                result["match_type"] = "custom_url"
                result["custom_url"] = True
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

        result = dict(result)
        result["provided_url"] = normalized_url
        result["url_source"] = "custom"
        result["searched_at"] = result.get("searched_at") or _custom_result_timestamp()
        result.setdefault("category", category)
        if expected_filename and not result.get("filename"):
            result["filename"] = expected_filename

        if not (result.get("download_url") or result.get("url")):
            return web.json_response(
                {"error": "The URL resolved, but no download URL was found"},
                status=400,
            )

        source = source or result.get("source") or "custom"
        local_hash_matches = _collect_custom_url_local_hash_matches(
            result,
            category,
        )
        response = {
            "success": True,
            "source": source,
            "result": result,
            "custom": [result],
            "searched_sources": ["custom"],
            "local_hash_matches": local_hash_matches,
        }
        response[source] = result
        return web.json_response(response)


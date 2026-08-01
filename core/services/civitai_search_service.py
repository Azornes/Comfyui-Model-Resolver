"""CivitAI model search service."""

from .model_utils import ModelServiceDependencies


class CivitAISearchService(ModelServiceDependencies):
    """Execute exact-match CivitAI and model metadata searches."""

    async def civitai_search(self, request):
        """Fetch model metadata from trusted exact-match sources."""

        download_available = self.download_available
        extract_sha256_from_metadata = self.extract_sha256_from_metadata
        find_external_metadata_sidecar_path = self.find_external_metadata_sidecar_path
        find_local_file_path = self.find_local_file_path
        get_existing_model_preview_path = self.get_existing_model_preview_path
        get_filename_from_path = self.get_filename_from_path
        get_model_resolver_sidecar_path = self.get_model_resolver_sidecar_path
        is_path_in_configured_model_roots = self.is_path_in_configured_model_roots
        looks_like_model_file = self.looks_like_model_file
        normalize_category_to_model_type = self.normalize_category_to_model_type
        normalize_sha256 = self.normalize_sha256
        read_json_safe = self.read_json_safe
        request_public_url = self.request_public_url
        resolve_civarchive_by_hash = self.resolve_civarchive_by_hash
        search_huggingface_for_file = self.search_huggingface_for_file
        to_bool = self.to_bool
        web = self.web
        write_model_resolver_metadata = self.write_model_resolver_metadata
        data = await request.json()
        filename = data.get("filename", "")
        category = data.get("category", "")
        resolved_path = data.get("resolved_path", "")
        local_only = to_bool(data.get("local_only"), False)
        force_refresh = to_bool(
            data.get("force_refresh") or data.get("force"), False
        )
        provided_hash = normalize_sha256(
            data.get("sha256")
            or data.get("hash")
            or data.get("file_hash")
            or ""
        )
        hf_token = data.get("hf_token", "")
        brave_search_api_key = data.get("brave_search_api_key", "")
        hf_use_brave_fallback = to_bool(
            data.get("hf_use_brave_fallback", True),
            True,
        )

        if not filename:
            return web.json_response(
                {"error": "Filename is required"}, status=400
            )

        # Clean filename for display
        import os as _os

        clean_name = _os.path.splitext(filename)[0]

        local_metadata_fields = (
            "author",
            "creator",
            "license",
            "usage_hint",
            "usage_tips",
            "preview_url",
            "metadata_source",
            "from_safetensors_header",
            "local_metadata_available",
            "header_metadata_keys",
            "metadata_summary",
            "base_model_raw",
            "sha256_source",
            "hashes",
            "hash_status",
        )

        def add_local_metadata_fields(payload, result):
            if not isinstance(payload, dict) or not isinstance(result, dict):
                return payload
            for key in local_metadata_fields:
                value = result.get(key)
                if value in (None, "", [], {}):
                    continue
                payload[key] = value
            return payload

        # Get the file path to hash
        file_path = resolved_path if resolved_path else None
        file_location = ""

        if not file_path:
            file_path = find_local_file_path(filename, category)

        if file_path:
            file_path = _os.path.realpath(
                _os.path.abspath(_os.path.normpath(str(file_path)))
            )
            if not is_path_in_configured_model_roots(file_path):
                if resolved_path:
                    return web.json_response(
                        {
                            "error": (
                                "resolved_path is outside configured model directories"
                            )
                        },
                        status=403,
                    )
                file_path = None
            elif not _os.path.isfile(file_path):
                if resolved_path:
                    return web.json_response(
                        {"error": "resolved_path is not an existing model file"},
                        status=404,
                    )
                file_path = None

        if file_path and _os.path.exists(file_path):
            file_location = _os.path.dirname(file_path).replace("\\", "/")
            if file_location and not file_location.endswith("/"):
                file_location += "/"

        external_model_description = ""
        if file_path:
            external_metadata_path = find_external_metadata_sidecar_path(
                file_path
            )
            external_metadata = (
                read_json_safe(external_metadata_path, {})
                if external_metadata_path
                else {}
            )
            if isinstance(external_metadata, dict):
                external_model_description = str(
                    external_metadata.get("modelDescription")
                    or external_metadata.get("model_description")
                    or external_metadata.get("description")
                    or ""
                ).strip()

        def infer_model_type_from_category(value):
            return normalize_category_to_model_type(value)

        def split_result_descriptions(result, preferred_model_description=""):
            result = result if isinstance(result, dict) else {}
            explicit_model_description = (
                result.get("model_description")
                or result.get("modelDescription")
                or ""
            )
            generic_description = result.get("description") or ""
            model_description = (
                preferred_model_description
                or explicit_model_description
                or generic_description
            )
            version_description = (
                result.get("version_description")
                or result.get("versionDescription")
                or ""
            )
            if (
                not version_description
                and explicit_model_description
                and generic_description
                and generic_description != explicit_model_description
            ):
                version_description = generic_description
            if version_description == model_description:
                version_description = ""
            return model_description, version_description

        def build_info_response(
            result=None,
            *,
            metadata_path="",
            metadata_saved=False,
            civitai_checked=False,
            local_payload=False,
        ):
            result = result or {}
            model_description, version_description = (
                split_result_descriptions(
                    result,
                    external_model_description,
                )
            )
            size_value = result.get("size")
            if not size_value and file_path and _os.path.exists(file_path):
                try:
                    size_value = _os.path.getsize(file_path)
                except Exception:
                    size_value = None

            model_type = (
                result.get("model_type")
                or result.get("type")
                or infer_model_type_from_category(category)
            )

            response = {
                "filename": result.get("filename") or filename,
                "category": category,
                "file_path": result.get("file_path") or file_path or "",
                "resolved_path": result.get("resolved_path") or file_path or "",
                "metadata_path": metadata_path
                or result.get("metadata_path")
                or "",
                "metadata_saved": bool(metadata_saved),
                "location": result.get("location") or file_location,
                "source": result.get("source") or "",
                "details_source": result.get("details_source")
                or result.get("source")
                or "",
                "url": result.get("url"),
                "version_url": result.get("version_url"),
                "download_url": result.get("download_url"),
                "platform_url": result.get("platform_url"),
                "repo_id": result.get("repo_id"),
                "path": result.get("path"),
                "model_id": result.get("model_id"),
                "model_name": result.get("model_name") or clean_name,
                "model_type": model_type,
                "version_id": result.get("version_id"),
                "version_name": result.get("version_name", ""),
                "sha256": result.get("sha256") or provided_hash,
                "size": size_value,
                "base_model": result.get("base_model"),
                "base_model_source": result.get("base_model_source"),
                "base_model_inferred": bool(result.get("base_model_inferred")),
                "tags": result.get("tags", []),
                "trained_words": result.get("trained_words", []),
                "images": result.get("images", []),
                "clip_skip": result.get("clip_skip"),
                "description": model_description,
                "model_description": model_description,
                "version_description": version_description,
                "from_metadata": bool(result.get("from_metadata")),
                "local_only": bool(local_payload),
                "metadata_checked": bool(civitai_checked),
                "civitai_checked": bool(civitai_checked),
            }
            return add_local_metadata_fields(response, result)
        def extract_result_sha256(result):
            return extract_sha256_from_metadata(result)

        def result_filename_matches(result):
            if not isinstance(result, dict):
                return False
            expected = get_filename_from_path(filename).lower()
            candidates = [
                result.get("filename"),
                result.get("path"),
                result.get("file_path"),
            ]
            for candidate in candidates:
                basename = get_filename_from_path(candidate).lower()
                if basename and basename == expected:
                    return True
            return False

        def result_hash_matches(result, *, require_filename=False):
            if not provided_hash or not isinstance(result, dict):
                return False
            result_hash = extract_result_sha256(result)
            if result_hash != provided_hash:
                return False
            return not require_filename or result_filename_matches(result)

        def huggingface_page_url(result):
            try:
                from urllib.parse import quote as _quote
            except Exception:
                _quote = None
            repo_id = str(
                result.get("repo_id") or result.get("repo") or ""
            ).strip()
            hf_path = str(
                result.get("path") or result.get("filename") or ""
            ).strip()
            if not repo_id or not hf_path:
                return ""
            if _quote:
                hf_path = _quote(hf_path.replace("\\", "/"), safe="/")
            return f"https://huggingface.co/{repo_id}/blob/main/{hf_path}"

        def prepare_remote_result(result, source_name):
            result = dict(result or {})
            source_name = str(source_name or result.get("source") or "").lower()
            if source_name == "huggingface":
                download_url = result.get("download_url") or result.get("url")
                page_url = result.get("page_url") or huggingface_page_url(result)
                if page_url:
                    result["url"] = page_url
                    result["version_url"] = page_url
                result["download_url"] = download_url
                result["model_name"] = (
                    result.get("model_name")
                    or result.get("name")
                    or result.get("repo_id")
                    or clean_name
                )
                result["model_type"] = (
                    result.get("model_type")
                    or infer_model_type_from_category(category)
                )
            else:
                result["model_name"] = (
                    result.get("model_name")
                    or result.get("name")
                    or clean_name
                )
                if result.get("url") and not result.get("version_url"):
                    result["version_url"] = result.get("url")

            result["source"] = source_name or result.get("source") or ""
            result["details_source"] = (
                result.get("details_source")
                or source_name
                or result.get("source")
                or ""
            )
            result["file_path"] = file_path or result.get("file_path") or ""
            result["resolved_path"] = (
                file_path or result.get("resolved_path") or ""
            )
            result["location"] = result.get("location") or file_location
            result["filename"] = result.get("filename") or filename
            result["sha256"] = (
                extract_result_sha256(result)
                or provided_hash
                or result.get("sha256")
            )
            if not result.get("size") and file_path and _os.path.exists(file_path):
                try:
                    result["size"] = _os.path.getsize(file_path)
                except Exception:
                    pass
            return result

        def result_has_remote_identity(result):
            if not isinstance(result, dict):
                return False
            return bool(
                result.get("url")
                or result.get("version_url")
                or result.get("download_url")
                or result.get("platform_url")
                or result.get("repo_id")
                or result.get("model_id")
                or result.get("version_id")
                or result.get("from_metadata")
            )

        def remote_link_is_marked_dead(item):
            if not isinstance(item, dict):
                return False
            status = str(item.get("status") or "").lower()
            return bool(
                item.get("deletedAt")
                or item.get("deleted_at")
                or item.get("is_dead")
                or item.get("isDead")
                or item.get("likelyDead")
                or item.get("likely_dead")
                or item.get("dead")
                or status in {"dead", "deleted", "unavailable", "missing"}
            )

        def collect_result_download_urls(result):
            urls = []
            if remote_link_is_marked_dead(result):
                return urls
            expected_filename = result.get("filename") or filename
            dead_urls = set()
            mirrors = result.get("mirrors") or []
            if not isinstance(mirrors, list):
                mirrors = [mirrors]
            for mirror in mirrors:
                if not isinstance(mirror, dict):
                    continue
                if remote_link_is_marked_dead(mirror):
                    dead_url = str(mirror.get("url") or "").strip()
                    if dead_url.startswith(("http://", "https://")):
                        dead_urls.add(dead_url)
                    continue
                url = str(mirror.get("url") or "").strip()
                mirror_filename = (
                    mirror.get("filename")
                    or mirror.get("name")
                    or expected_filename
                )
                if (
                    looks_like_model_file(url, mirror_filename)
                    and url not in urls
                ):
                    urls.append(url)
            raw_urls = result.get("download_urls") or []
            if not isinstance(raw_urls, list):
                raw_urls = [raw_urls]
            for raw_url in raw_urls:
                url = str(raw_url or "").strip()
                if (
                    looks_like_model_file(url, expected_filename)
                    and url not in dead_urls
                    and url not in urls
                ):
                    urls.append(url)
            for key in ("download_url", "downloadUrl"):
                url = str(result.get(key) or "").strip()
                if (
                    looks_like_model_file(url, expected_filename)
                    and url not in dead_urls
                    and url not in urls
                ):
                    urls.append(url)
            return urls

        def remote_download_url_is_alive(url):
            headers = {
                "User-Agent": "ComfyUI-Model-Resolver/1.0",
                "Accept": "*/*",
            }
            try:
                response, _final_url, _final_headers = request_public_url(
                    "HEAD",
                    url,
                    headers=headers,
                    timeout=8,
                )
                try:
                    if response.status_code < 400:
                        return True
                    if response.status_code in {401, 403, 404, 410}:
                        return False
                finally:
                    response.close()
            except Exception:
                pass

            try:
                response, _final_url, _final_headers = request_public_url(
                    "GET",
                    url,
                    headers={**headers, "Range": "bytes=0-0"},
                    stream=True,
                    timeout=8,
                )
                try:
                    return response.status_code < 400
                finally:
                    response.close()
            except Exception:
                return False

        def civarchive_result_has_live_download(result):
            urls = collect_result_download_urls(result)
            if not urls:
                return False
            for url in urls[:3]:
                if remote_download_url_is_alive(url):
                    result["download_url"] = url
                    result["download_urls"] = [
                        url,
                        *[other for other in urls if other != url],
                    ]
                    return True
            return False

        def save_remote_metadata(result, source_name):
            metadata_path = result.get("metadata_path") or ""
            metadata_saved = False
            if (
                result.get("from_metadata")
                or not file_path
                or not _os.path.exists(file_path)
            ):
                return metadata_path, metadata_saved
            try:
                model_description, version_description = (
                    split_result_descriptions(result)
                )
                metadata_payload = {
                    "source": source_name,
                    "details_source": result.get("details_source")
                    or source_name,
                    "filename": filename,
                    "category": category,
                    "model_name": result.get("model_name", clean_name),
                    "name": result.get("model_name", clean_name),
                    "model_type": result.get("model_type", "")
                    or result.get("type", ""),
                    "type": result.get("model_type", "")
                    or result.get("type", ""),
                    "model_id": result.get("model_id"),
                    "version_id": result.get("version_id"),
                    "version_name": result.get("version_name", ""),
                    "sha256": result.get("sha256") or provided_hash,
                    "size": result.get("size"),
                    "base_model": result.get("base_model"),
                    "base_model_source": result.get("base_model_source"),
                    "base_model_inferred": bool(result.get("base_model_inferred")),
                    "tags": result.get("tags", []),
                    "trained_words": result.get("trained_words", []),
                    "images": result.get("images", []),
                    "clip_skip": result.get("clip_skip"),
                    "description": model_description,
                    "model_description": model_description,
                    "version_description": version_description,
                    "download_url": result.get("download_url"),
                    "source_url": result.get("version_url") or result.get("url"),
                    "version_url": result.get("version_url") or result.get("url"),
                    "model_url": result.get("url"),
                    "url": result.get("version_url") or result.get("url"),
                    "platform_url": result.get("platform_url"),
                    "repo_id": result.get("repo_id"),
                    "path": result.get("path"),
                    "path_metadata": {
                        "filename": filename,
                        "category": category,
                        "source": source_name,
                        "model_id": result.get("model_id"),
                        "version_id": result.get("version_id"),
                        "repo_id": result.get("repo_id"),
                        "path": result.get("path"),
                    },
                }
                add_local_metadata_fields(metadata_payload, result)
                metadata_path = write_model_resolver_metadata(
                    file_path,
                    metadata_payload,
                    category,
                    result.get("version_url")
                    or result.get("url")
                    or result.get("platform_url")
                    or result.get("download_url")
                    or "",
                    create_preview=True,
                ) or ""
                metadata_saved = bool(metadata_path)
                if metadata_path:
                    result["metadata_path"] = metadata_path
            except Exception as metadata_error:
                self.logger.warning(
                    f"{source_name} metadata sidecar save failed: {metadata_error}"
                )
            return metadata_path, metadata_saved

        if local_only:
            result = None
            metadata_path = ""
            metadata_saved = False
            if download_available and file_path and _os.path.exists(file_path):
                try:
                    from ..sources.civitai import (
                        get_model_info_for_file,
                    )

                    result = get_model_info_for_file(
                        file_path,
                        local_only=True,
                    )
                    source_metadata_path = (
                        result.get("metadata_path")
                        if isinstance(result, dict)
                        else ""
                    )
                    canonical_metadata_path = get_model_resolver_sidecar_path(
                        file_path
                    )
                    if (
                        isinstance(result, dict)
                        and result.get("from_metadata")
                        and source_metadata_path
                        and canonical_metadata_path
                        and _os.path.abspath(source_metadata_path)
                        != _os.path.abspath(canonical_metadata_path)
                        and not _os.path.exists(canonical_metadata_path)
                    ):
                        preview_url = result.get("preview_url") or ""
                        if not preview_url:
                            preview_path = get_existing_model_preview_path(file_path)
                            if preview_path:
                                preview_url = preview_path.replace("\\", "/")
                        model_description, version_description = (
                            split_result_descriptions(result)
                        )
                        metadata_payload = {
                            "source": "metadata_import",
                            "details_source": result.get("source") or "metadata",
                            "filename": filename,
                            "category": category,
                            "model_name": result.get("model_name", clean_name),
                            "name": result.get("model_name", clean_name),
                            "model_type": result.get("model_type", ""),
                            "type": result.get("model_type", ""),
                            "model_id": result.get("model_id"),
                            "version_id": result.get("version_id"),
                            "version_name": result.get("version_name", ""),
                            "sha256": result.get("sha256"),
                            "size": result.get("size"),
                            "base_model": result.get("base_model"),
                            "base_model_source": result.get("base_model_source"),
                            "base_model_inferred": bool(result.get("base_model_inferred")),
                            "tags": result.get("tags", []),
                            "trained_words": result.get("trained_words", []),
                            "images": result.get("images", []),
                            "clip_skip": result.get("clip_skip"),
                            "description": model_description,
                            "model_description": model_description,
                            "version_description": version_description,
                            "download_url": result.get("download_url"),
                            "preview_url": preview_url,
                            "source_url": result.get("version_url")
                            or result.get("url"),
                            "version_url": result.get("version_url")
                            or result.get("url"),
                            "model_url": result.get("url"),
                            "url": result.get("version_url") or result.get("url"),
                            "path_metadata": {
                                "filename": filename,
                                "category": category,
                                "source": "metadata_import",
                                "model_id": result.get("model_id"),
                                "version_id": result.get("version_id"),
                                "imported_from": source_metadata_path,
                            },
                        }
                        add_local_metadata_fields(metadata_payload, result)
                        metadata_path = write_model_resolver_metadata(
                            file_path,
                            metadata_payload,
                            category,
                            result.get("version_url")
                            or result.get("url")
                            or result.get("download_url")
                            or "",
                            create_preview=True,
                        ) or ""
                        metadata_saved = bool(metadata_path)
                        if metadata_path:
                            result["metadata_path"] = metadata_path
                            result["metadata_imported_from"] = source_metadata_path
                except Exception as e:
                    self.logger.warning(f"Local model info error: {e}")
            return web.json_response(
                build_info_response(
                    result,
                    metadata_path=metadata_path,
                    metadata_saved=metadata_saved,
                    local_payload=True,
                    civitai_checked=False,
                )
            )

        # Search remote metadata. CivitAI and CivArchive are hash-only;
        # HuggingFace name results must still confirm the exact SHA.
        if download_available and file_path and _os.path.exists(file_path):
            try:
                from ..sources.civitai import (
                    get_model_info_by_hash,
                    get_model_info_for_file,
                )

                if provided_hash:
                    result = get_model_info_by_hash(
                        provided_hash,
                        use_cache=not force_refresh,
                    )
                    if result:
                        result["file_path"] = file_path
                        result["resolved_path"] = file_path
                        result["location"] = file_location
                        if not result.get("size"):
                            try:
                                result["size"] = _os.path.getsize(file_path)
                            except Exception:
                                pass
                        if not extract_result_sha256(result):
                            result["sha256"] = provided_hash
                elif not force_refresh:
                    result = get_model_info_for_file(file_path)
                else:
                    result = None

                if result and (
                    result.get("url")
                    or result.get("version_url")
                    or result.get("from_metadata")
                    or result.get("trained_words")
                    or result.get("base_model_inferred")
                    or result.get("local_metadata_available")
                    or result.get("from_safetensors_header")
                ) and (
                    result.get("from_metadata")
                    or not provided_hash
                    or result_hash_matches(result)
                ):
                    result_source = (
                        "local"
                        if result.get("source") == "local"
                        and not result_has_remote_identity(result)
                        else "civitai"
                    )
                    result = prepare_remote_result(result, result_source)
                    metadata_path, metadata_saved = save_remote_metadata(
                        result,
                        result_source,
                    )

                    return web.json_response(
                        build_info_response(
                            result,
                            metadata_path=metadata_path,
                            metadata_saved=metadata_saved,
                            civitai_checked=True,
                        )
                    )
            except Exception as e:
                self.logger.warning(f"CivitAI search error: {e}")

            if provided_hash:
                try:
                    result = resolve_civarchive_by_hash(
                        provided_hash,
                        query=filename,
                        exact_only=False,
                        model_type=infer_model_type_from_category(category),
                    )
                    if result:
                        if not extract_result_sha256(result):
                            result["sha256"] = provided_hash
                        result = prepare_remote_result(result, "civarchive")
                        if result_hash_matches(result) and civarchive_result_has_live_download(result):
                            metadata_path, metadata_saved = save_remote_metadata(
                                result,
                                "civarchive",
                            )
                            return web.json_response(
                                build_info_response(
                                    result,
                                    metadata_path=metadata_path,
                                    metadata_saved=metadata_saved,
                                    civitai_checked=True,
                                )
                            )
                        if result_hash_matches(result):
                            self.logger.info(
                                f"CivArchive metadata candidate rejected: "
                                f"no live download link for {filename}"
                            )
                except Exception as e:
                    self.logger.warning(f"CivArchive hash lookup error: {e}")

            if provided_hash:
                hf_attempts = [
                    {
                        "label": "HuggingFace",
                        "use_api_search": True,
                        "use_comfy_org_fallback": True,
                        "use_brave_fallback": False,
                    }
                ]
                if hf_use_brave_fallback and brave_search_api_key:
                    hf_attempts.append(
                        {
                            "label": "HuggingFace Brave",
                            "use_api_search": False,
                            "use_comfy_org_fallback": False,
                            "use_brave_fallback": True,
                        }
                    )

                for hf_attempt in hf_attempts:
                    try:
                        result = search_huggingface_for_file(
                            filename,
                            token=hf_token or None,
                            exact_only=True,
                            brave_api_key=brave_search_api_key or None,
                            use_api_search=hf_attempt["use_api_search"],
                            use_comfy_org_fallback=hf_attempt[
                                "use_comfy_org_fallback"
                            ],
                            use_brave_fallback=hf_attempt[
                                "use_brave_fallback"
                            ],
                            force_refresh=force_refresh,
                        )
                        if result and result_hash_matches(
                            result,
                            require_filename=True,
                        ):
                            result = prepare_remote_result(
                                result,
                                "huggingface",
                            )
                            metadata_path, metadata_saved = save_remote_metadata(
                                result,
                                "huggingface",
                            )
                            return web.json_response(
                                build_info_response(
                                    result,
                                    metadata_path=metadata_path,
                                    metadata_saved=metadata_saved,
                                    civitai_checked=True,
                                )
                        )
                        if result:
                            self.logger.info(
                                f"{hf_attempt['label']} metadata candidate rejected: "
                                f"filename/hash mismatch for {filename}"
                            )
                    except Exception as e:
                        self.logger.warning(
                            f"{hf_attempt['label']} metadata lookup error: {e}"
                        )

        # No remote result found. Keep any useful local safetensors
        # header metadata, including base-model fingerprints, model
        # titles, descriptions, tags, trigger words, and author data.
        local_fallback_result = None
        if file_path and _os.path.exists(file_path):
            try:
                from ..sources.civitai import get_model_info_for_file

                local_candidate = get_model_info_for_file(
                    file_path,
                    local_only=True,
                )
                if (
                    isinstance(local_candidate, dict)
                    and (
                        local_candidate.get("base_model")
                        or local_candidate.get("local_metadata_available")
                        or local_candidate.get("from_safetensors_header")
                    )
                ):
                    local_fallback_result = local_candidate
            except Exception as local_fallback_error:
                self.logger.debug(
                    f"Local base model inference fallback failed: {local_fallback_error}"
                )

        response = build_info_response(
            local_fallback_result,
            civitai_checked=True,
            local_payload=bool(local_fallback_result),
        )
        response["url"] = None
        if force_refresh and file_path and _os.path.exists(file_path):
            try:
                metadata_payload = {
                    "filename": filename,
                    "category": category,
                    "model_name": response.get("model_name") or clean_name,
                    "name": response.get("model_name") or clean_name,
                    "model_type": response.get("model_type")
                    or infer_model_type_from_category(category),
                    "sha256": response.get("sha256") or provided_hash,
                    "size": response.get("size") or _os.path.getsize(file_path),
                    "base_model": response.get("base_model"),
                    "base_model_source": response.get("base_model_source"),
                    "base_model_inferred": bool(response.get("base_model_inferred")),
                    "description": response.get("model_description")
                    or response.get("description")
                    or "",
                    "model_description": response.get("model_description")
                    or response.get("description")
                    or "",
                    "version_description": response.get(
                        "version_description"
                    )
                    or "",
                    "civitai_deleted": True,
                    "civitai_checked": True,
                    "remote_metadata_missing": True,
                    "source": "local",
                    "details_source": response.get("details_source") or "",
                }
                add_local_metadata_fields(metadata_payload, response)
                metadata_path = write_model_resolver_metadata(
                    file_path,
                    metadata_payload,
                    category,
                    "",
                ) or ""
                response["metadata_path"] = metadata_path
                response["metadata_saved"] = bool(metadata_path)
            except Exception as metadata_error:
                self.logger.warning(
                    f"Remote metadata no-match sidecar save failed: {metadata_error}"
                )
        return web.json_response(response)


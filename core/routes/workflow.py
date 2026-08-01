"""Workflow and loaded-model route registration."""

from .context import RouteContext


def register_workflow_routes(context: RouteContext):
    FileManagerError = context.get('FileManagerError')
    FileManagerUnavailableError = context.get('FileManagerUnavailableError')
    MODEL_RESOLVER_METADATA_SCHEMA = context.get('MODEL_RESOLVER_METADATA_SCHEMA')
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION = context.get('MODEL_RESOLVER_METADATA_SCHEMA_VERSION')
    UnsupportedFileManagerPlatformError = context.get('UnsupportedFileManagerPlatformError')
    analyze_and_find_matches = context.get('analyze_and_find_matches')
    apply_resolution = context.get('apply_resolution')
    asyncio = context.get('asyncio')
    cancel_progress_response = context.get('cancel_progress_response')
    download_available = context.get('download_available')
    fetch_remote_file_size_cached = context.get('fetch_remote_file_size_cached')
    get_existing_model_preview_path = context.get('get_existing_model_preview_path')
    get_filename_from_path = context.get('get_filename_from_path')
    get_local_model_hash_metadata = context.get('get_local_model_hash_metadata')
    get_popular_model_url = context.get('get_popular_model_url')
    get_progress_response = context.get('get_progress_response')
    get_safe_model_resolver_sidecar_path = context.get('get_safe_model_resolver_sidecar_path')
    get_workflow_model_inventory = context.get('get_workflow_model_inventory')
    invalidate_local_hash_match_cache = context.get('invalidate_local_hash_match_cache')
    is_path_in_configured_model_roots = context.get('is_path_in_configured_model_roots')
    json_api_endpoint = context.get('json_api_endpoint')
    load_resolver_settings = context.get('load_resolver_settings')
    normalize_file_manager_path = context.get('normalize_file_manager_path')
    normalize_sha256 = context.get('normalize_sha256')
    open_in_file_manager = context.get('open_in_file_manager')
    os = context.get('os')
    read_json_safe = context.get('read_json_safe')
    resolver_bool_setting = context.get('resolver_bool_setting')
    routes = context.get('routes')
    run_in_background_thread = context.get('run_in_background_thread')
    search_local_matches = context.get('search_local_matches')
    search_local_matches_by_hash = context.get('search_local_matches_by_hash')
    search_model_list = context.get('search_model_list')
    self = context.get('self')
    should_skip_existing_custom_node_reference = context.get('should_skip_existing_custom_node_reference')
    time = context.get('time')
    to_bool = context.get('to_bool')
    to_int = context.get('to_int')
    web = context.get('web')
    write_json_atomic = context.get('write_json_atomic')

    @routes.post("/model_resolver/analyze")
    async def analyze_workflow(request):
        """Analyze workflow and return missing models with matches."""
        try:
            data = await request.json()
            workflow_json = data.get("workflow")
            analysis_id = str(data.get("analysis_id") or "").strip()
            force_rescan = to_bool(data.get("force_rescan"), False)
            if force_rescan:
                invalidate_local_hash_match_cache()

            if workflow_json is None:
                return web.json_response(
                    {"error": "Workflow JSON is required"}, status=400
                )
            if not isinstance(workflow_json, dict):
                return web.json_response(
                    {"error": "Workflow JSON must be an object"}, status=400
                )

            if analysis_id:
                self._update_analysis_progress(
                    analysis_id,
                    {
                        "status": "starting",
                        "stage": "starting",
                        "message": "Starting analysis...",
                        "current": 0,
                        "total": 0,
                    },
                )

            def update_analysis_progress(payload):
                self._update_analysis_progress(analysis_id, payload)

            # Analyze and find matches
            result = await asyncio.to_thread(
                analyze_and_find_matches,
                workflow_json,
                0.0,
                10,
                update_analysis_progress if analysis_id else None,
                force_rescan=force_rescan,
            )

            missing_models = result.get("missing_models", [])
            filtered_missing = []
            for missing in missing_models:
                name = missing.get("name") or missing.get("original_path", "")
                if should_skip_existing_custom_node_reference(missing):
                    self.logger.info(
                        "Filtered existing custom-node model "
                        f"reference: {name}"
                    )
                    continue
                filtered_missing.append(missing)
            result["missing_models"] = filtered_missing
            result["total_missing"] = len(filtered_missing)

            # If download available, check for download sources only from LOCAL sources
            # (workflow_url, popular, model-list.json) - skip automatic online search
            # Online search is now only triggered on-demand via search button
            if download_available:
                for missing in result.get("missing_models", []):
                    # Check if there's a 100% local match
                    matches = missing.get("matches", [])
                    has_perfect_match = any(
                        m.get("confidence", 0) == 100 for m in matches
                    )

                    if not has_perfect_match:
                        filename = get_filename_from_path(
                            missing.get("original_path", "")
                        )

                        # 0. Check workflow URL first (highest priority - directly from workflow)
                        workflow_url = missing.get("workflow_url", "")
                        if workflow_url:
                            # Determine source from URL
                            if "huggingface.co" in workflow_url:
                                source = "huggingface"
                            elif "civitai.com" in workflow_url:
                                source = "civitai"
                            else:
                                source = "workflow"

                            # Try to get file size using cached remote helper
                            file_size = fetch_remote_file_size_cached(workflow_url, timeout=5)

                            missing["download_source"] = {
                                "source": source,
                                "url": workflow_url,
                                "model_url": missing.get(
                                    "workflow_model_url", workflow_url
                                ),
                                "filename": filename,
                                "directory": missing.get(
                                    "workflow_directory", ""
                                )
                                or missing.get("category", "checkpoints"),
                                "match_type": "exact",
                                "url_source": "workflow",
                                "size": file_size,
                            }
                            continue

                        # 1. Check popular models (always exact match)
                        popular_info = get_popular_model_url(filename)
                        if popular_info:
                            popular_model_list_result = search_model_list(
                                filename, exact_only=True
                            )
                            missing["download_source"] = {
                                "source": "popular",
                                "url": popular_info.get("url"),
                                "filename": filename,
                                "type": popular_info.get("type"),
                                "directory": popular_info.get("directory"),
                                "size": (
                                    popular_model_list_result.get("size")
                                    if popular_model_list_result
                                    else None
                                )
                                or popular_info.get("size"),
                                "match_type": "exact",
                            }
                            continue

                        # 2. Check model list (ComfyUI Manager database)
                        # Use exact_only=True to avoid confusing fuzzy matches for downloads
                        model_list_result = search_model_list(
                            filename, exact_only=True
                        )
                        if model_list_result:
                            missing["download_source"] = {
                                "source": "model_list",
                                "url": model_list_result.get("url"),
                                "filename": model_list_result.get("filename"),
                                "name": model_list_result.get("name"),
                                "type": model_list_result.get("type"),
                                "directory": model_list_result.get("directory"),
                                "size": model_list_result.get("size"),
                                "match_type": model_list_result.get(
                                    "match_type"
                                ),
                                "confidence": model_list_result.get(
                                    "confidence"
                                ),
                            }
                            continue

                        # NOTE: Search for online sources (HuggingFace, CivitAI) is
                        # now done on-demand via /model_resolver/search endpoint
                        # when user clicks "Search Online" button, not automatically

            if analysis_id:
                self.analysis_progress.update(
                    analysis_id,
                    status="completed",
                    stage="completed",
                    message="Analysis complete",
                    current=result.get("total_missing", 0),
                    total=result.get("total_missing", 0),
                )

            return web.json_response(result)
        except Exception as e:
            if "analysis_id" in locals() and analysis_id:
                self.analysis_progress.update(
                    analysis_id,
                    status="error",
                    stage="error",
                    message=str(e),
                    current=0,
                    total=0,
                )
            self.logger.error(f"Model Resolver analyze error: {e}", exc_info=True)
            return web.json_response({"error": str(e)}, status=500)

    @routes.get("/model_resolver/analyze-progress/{analysis_id}")
    @json_api_endpoint("analyze-progress")
    async def get_analyze_progress(request):
        """Get workflow analysis progress."""
        return get_progress_response(
            self.analysis_progress,
            request,
            param_name="analysis_id",
            not_found_payload={
                "status": "unknown",
                "stage": "unknown",
                "message": "No analysis progress available",
                "current": 0,
                "total": 0,
            }
        )

    @routes.post("/model_resolver/resolve")
    @json_api_endpoint("resolve", return_success_on_error=True)
    async def resolve_models(request):
        """Apply model resolution and return updated workflow."""
        data = await request.json()
        workflow_json = data.get("workflow")
        resolutions = data.get("resolutions", [])

        if not workflow_json:
            return web.json_response(
                {"error": "Workflow JSON is required"}, status=400
            )

        if not resolutions:
            return web.json_response(
                {"error": "Resolutions array is required"}, status=400
            )

        # Apply resolutions
        updated_workflow = apply_resolution(workflow_json, resolutions)

        return web.json_response(
            {"workflow": updated_workflow, "success": True}
        )

    @routes.post("/model_resolver/local-matches")
    @json_api_endpoint("local-matches")
    async def local_matches(request):
        """Search local model files by filename/path."""
        data = await request.json()
        filename = data.get("filename", "")
        category = data.get("category", "")
        force_rescan = to_bool(data.get("force_rescan"), False)
        if force_rescan:
            invalidate_local_hash_match_cache()

        if not filename:
            return web.json_response(
                {"error": "filename is required"}, status=400
            )

        matches = search_local_matches(
            filename,
            category=category or None,
            similarity_threshold=0.0,
            max_matches_per_model=10,
            force_rescan=force_rescan,
        )
        return web.json_response({"matches": matches})

    @routes.post("/model_resolver/local-model-hashes")
    @json_api_endpoint("local-model-hashes")
    async def local_model_hashes(request):
        """Return SHA256 hashes already stored in local sidecar metadata."""
        data = await request.json()
        model = data.get("model") if isinstance(data.get("model"), dict) else {}
        path = (
            data.get("path")
            or data.get("file_path")
            or data.get("resolved_path")
            or model.get("path")
            or model.get("resolved_path")
            or ""
        )

        if not path:
            return web.json_response(
                {"error": "path is required"}, status=400
            )

        normalized_path = os.path.realpath(
            os.path.abspath(os.path.normpath(str(path)))
        )
        if not is_path_in_configured_model_roots(normalized_path):
            return web.json_response(
                {"error": "path is outside configured model directories"},
                status=403,
            )

        return web.json_response(
            get_local_model_hash_metadata(normalized_path, model=model)
        )

    @routes.get("/model_resolver/model-preview")
    async def get_model_preview(request):
        """Serve an adjacent model preview from a configured model directory."""
        model_path = str(request.query.get("path") or "").strip()
        if not model_path:
            return web.Response(text="path is required", status=400)

        try:
            normalized_path = os.path.realpath(
                os.path.abspath(os.path.normpath(model_path))
            )
        except (OSError, TypeError, ValueError):
            return web.Response(text="invalid model path", status=400)
        if not os.path.isfile(normalized_path):
            return web.Response(text="model file does not exist", status=404)
        if not is_path_in_configured_model_roots(normalized_path):
            return web.Response(
                text="path is outside configured model directories",
                status=403,
            )

        preview_path = get_existing_model_preview_path(normalized_path)
        if not preview_path:
            return web.Response(text="preview not found", status=404)
        if not is_path_in_configured_model_roots(preview_path):
            return web.Response(
                text="preview is outside configured model directories",
                status=403,
            )

        return web.FileResponse(
            preview_path,
            headers={"Cache-Control": "private, no-cache"},
        )

    @routes.post("/model_resolver/workflow-model-hashes")
    @json_api_endpoint("workflow-model-hashes")
    async def workflow_model_hashes(request):
        """Return hash metadata for existing local models used by a workflow."""
        data = await request.json()
        workflow_json = data.get("workflow")
        if not isinstance(workflow_json, dict):
            return web.json_response(
                {"error": "Workflow JSON must be an object"}, status=400
            )

        settings = await asyncio.to_thread(load_resolver_settings)
        if not resolver_bool_setting(
            settings.get("workflow_hash_metadata_enabled"), True
        ):
            return web.json_response(
                {
                    "success": True,
                    "enabled": False,
                    "models": [],
                    "by_node": {},
                    "by_path": {},
                    "count": 0,
                }
            )

        inventory = await asyncio.to_thread(
            get_workflow_model_inventory,
            workflow_json,
        )
        refs = inventory["model_refs"]

        by_node = {}
        by_path = {}
        models = []
        seen = set()

        for ref in refs:
            if not isinstance(ref, dict) or not ref.get("exists"):
                continue
            full_path = str(ref.get("full_path") or "").strip()
            if not full_path:
                continue
            model_info = {
                "path": full_path,
                "filename": get_filename_from_path(full_path),
                "relative_path": ref.get("original_path") or "",
                "category": ref.get("category") or "",
            }
            metadata = get_local_model_hash_metadata(
                full_path, model=model_info
            )
            sha256 = normalize_sha256(metadata.get("sha256"))
            if not sha256:
                continue

            entry = {
                "node_id": ref.get("node_id"),
                "node_type": ref.get("node_type") or "",
                "widget_index": ref.get("widget_index"),
                "widget_name": ref.get("widget_name") or "",
                "path": ref.get("original_path") or "",
                "filename": get_filename_from_path(
                    ref.get("original_path") or full_path
                ),
                "category": ref.get("category") or "",
                "sha256": sha256,
                "size": metadata.get("size") or 0,
            }
            entry_key = (
                str(entry.get("node_id")),
                str(entry.get("widget_index")),
                entry.get("path"),
                sha256,
            )
            if entry_key in seen:
                continue
            seen.add(entry_key)
            models.append(entry)

            path_key = str(entry.get("path") or entry.get("filename") or "")
            if path_key:
                by_path[path_key] = entry
                by_path[get_filename_from_path(path_key)] = entry
            node_key = f"{entry.get('node_id')}:{entry.get('widget_index')}"
            by_node[node_key] = entry

        return web.json_response(
            {
                "success": True,
                "enabled": True,
                "models": models,
                "by_node": by_node,
                "by_path": by_path,
                "count": len(models),
            }
        )

    @routes.post("/model_resolver/local-matches-by-hash")
    @json_api_endpoint("local-matches-by-hash")
    async def local_matches_by_hash(request):
        """Search local model metadata sidecars for a remote SHA256."""
        data = await request.json()
        sha256 = normalize_sha256(
            data.get("sha256")
            or data.get("hash")
            or data.get("SHA256")
            or ""
        )
        if not sha256:
            return web.json_response(
                {"error": "sha256 is required"}, status=400
            )

        category = data.get("category", "")
        source = str(
            data.get("source")
            or data.get("hash_lookup_source")
            or "download_source"
        ).strip().lower().replace("-", "_")
        filename = (
            data.get("filename")
            or data.get("path")
            or data.get("model_name")
            or ""
        )
        max_matches = to_int(data.get("max_matches"), 20)
        force_rescan = to_bool(data.get("force_rescan"), False)

        matches = search_local_matches_by_hash(
            sha256,
            category=category or None,
            max_matches=max_matches,
            force_rescan=force_rescan,
        )
        enriched_matches = [
            {
                **match,
                "hash_lookup_source": source or "download_source",
                "hash_lookup_filename": filename,
                "hash_lookup_sha256": sha256,
            }
            for match in matches
        ]
        return web.json_response(
            {
                "sha256": sha256,
                "local_hash_matches": enriched_matches,
                "matches": enriched_matches,
            }
        )

    @routes.post("/model_resolver/open-containing-folder")
    @json_api_endpoint("open-containing-folder")
    async def open_containing_folder(request):
        """Reveal a file or open a directory in the host file manager."""
        try:
            data = await request.json()
        except Exception as exc:
            return web.json_response(
                {"success": False, "error": f"invalid JSON body: {exc}"},
                status=400,
            )
        if not isinstance(data, dict):
            return web.json_response(
                {"success": False, "error": "JSON body must be an object"},
                status=400,
            )
        target_path = data.get("path", "")

        try:
            normalized_path = normalize_file_manager_path(target_path)
        except ValueError as exc:
            return web.json_response(
                {"success": False, "error": str(exc)}, status=400
            )

        if not os.path.exists(normalized_path):
            return web.json_response(
                {"success": False, "error": "path does not exist"}, status=404
            )
        if not is_path_in_configured_model_roots(normalized_path):
            return web.json_response(
                {
                    "success": False,
                    "error": "path is outside configured model directories",
                },
                status=403,
            )

        try:
            result = await asyncio.to_thread(
                open_in_file_manager, normalized_path
            )
        except FileNotFoundError:
            return web.json_response(
                {"success": False, "error": "path no longer exists"},
                status=404,
            )
        except UnsupportedFileManagerPlatformError as exc:
            return web.json_response(
                {"success": False, "error": str(exc)}, status=501
            )
        except FileManagerUnavailableError as exc:
            return web.json_response(
                {
                    "success": False,
                    "error": (
                        f"{exc} The ComfyUI host may be running without "
                        "a graphical desktop session."
                    ),
                },
                status=503,
            )
        except FileManagerError as exc:
            return web.json_response(
                {"success": False, "error": str(exc)}, status=500
            )

        return web.json_response({"success": True, **result})

    # cleanup_hash_progress, update_hash_progress, is_hash_progress_cancelled, and mark_hash_progress_cancelled removed

    from ..path_utils import HashCalculationCancelled

    def resolve_hash_file_request(data):
        import os as _os

        file_path = (
            data.get("file_path")
            or data.get("resolved_path")
            or data.get("path")
            or ""
        )
        if not file_path:
            return "", "file_path is required"

        normalized_path = _os.path.realpath(
            _os.path.abspath(_os.path.normpath(file_path))
        )
        if not _os.path.exists(normalized_path) or not _os.path.isfile(normalized_path):
            return "", "file does not exist"
        if not is_path_in_configured_model_roots(normalized_path):
            return "", "file is outside configured model directories"
        return normalized_path, ""

    def write_calculated_hash_metadata(
        normalized_path,
        sha256,
        sha256_source="file",
    ):
        import os as _os

        resolved_metadata_path = get_safe_model_resolver_sidecar_path(
            normalized_path
        )

        metadata_updated = False
        try:
            metadata = read_json_safe(resolved_metadata_path, {})
            if not isinstance(metadata, dict):
                metadata = {}

            filename = get_filename_from_path(normalized_path)
            stem, _ext = _os.path.splitext(filename)
            hashes = metadata.get("hashes")
            if not isinstance(hashes, dict):
                hashes = {}
            hashes["SHA256"] = sha256

            metadata["schema"] = MODEL_RESOLVER_METADATA_SCHEMA
            metadata["schema_version"] = (
                MODEL_RESOLVER_METADATA_SCHEMA_VERSION
            )
            metadata["managed_by"] = MODEL_RESOLVER_METADATA_SCHEMA
            metadata["sha256"] = sha256
            metadata["hashes"] = hashes
            metadata["hash_status"] = "completed"
            metadata["sha256_source"] = sha256_source or "file"
            metadata["last_checked_at"] = time.time()
            metadata.setdefault("file_name", stem)
            metadata.setdefault("model_name", stem)
            metadata.setdefault("file_path", normalized_path.replace("\\", "/"))
            try:
                metadata.setdefault("size", _os.path.getsize(normalized_path))
            except Exception:
                pass

            write_json_atomic(resolved_metadata_path, metadata, indent=2)
            metadata_updated = True
            self.logger.info(
                f"Stored SHA256 and updated metadata: {resolved_metadata_path}"
            )
        except Exception as metadata_error:
            self.logger.warning(
                f"Could not update metadata with calculated SHA256 for {normalized_path}: {metadata_error}"
            )

        return resolved_metadata_path, metadata_updated

    def calculate_sha256_with_progress(normalized_path, progress_id=""):
        import os as _os

        from ..path_utils import calculate_file_sha256 as _calculate_file_sha256_core

        total_bytes = max(0, _os.path.getsize(normalized_path))

        self.hash_tracker.update(
            progress_id,
            status="running",
            stage="header",
            message="Checking safetensors header...",
            percent=0,
            bytes_read=0,
            total_bytes=total_bytes,
        )

        if self.hash_tracker.is_cancelled(progress_id):
            raise HashCalculationCancelled()

        hash_source = ["file"]
        stage_transitioned = [False]
        _bytes_read = [0]
        _last_update = [0.0]

        def on_progress(bytes_read, total_bytes):
            _bytes_read[0] = bytes_read
            if not stage_transitioned[0]:
                stage_transitioned[0] = True
                self.logger.info(
                    "No SHA256 found in safetensors header; calculating full "
                    f"file SHA256: {normalized_path}"
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="hashing",
                    message="Calculating SHA256...",
                    percent=0,
                    bytes_read=0,
                    total_bytes=total_bytes,
                )

            now = time.time()
            if now - _last_update[0] >= 0.15 or bytes_read >= total_bytes:
                percent = 98 if total_bytes <= 0 else min(
                    98,
                    (bytes_read / total_bytes) * 98,
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="hashing",
                    message="Calculating SHA256...",
                    percent=percent,
                    bytes_read=bytes_read,
                    total_bytes=total_bytes,
                )
                _last_update[0] = now

        def is_cancelled():
            if self.hash_tracker.is_cancelled(progress_id):
                percent = 0 if total_bytes <= 0 else min(
                    98,
                    (_bytes_read[0] / total_bytes) * 98,
                )
                self.hash_tracker.update(
                    progress_id,
                    status="cancelled",
                    stage="cancelled",
                    message="Hash calculation cancelled",
                    percent=percent,
                    bytes_read=_bytes_read[0],
                    total_bytes=total_bytes,
                )
                return True
            return False

        def on_hash_source(source_name):
            hash_source[0] = source_name
            if source_name == "safetensors_header":
                self.logger.info(
                    f"Found SHA256 in safetensors header: {normalized_path}"
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="header",
                    message="Found SHA256 in safetensors header",
                    percent=98,
                    bytes_read=0,
                    total_bytes=total_bytes,
                    sha256_source="safetensors_header",
                )

        sha256 = _calculate_file_sha256_core(
            normalized_path,
            chunk_size=1024 * 1024 * 4,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
            use_safetensors_header=True,
            on_hash_source=on_hash_source,
        )

        if is_cancelled():
            raise HashCalculationCancelled()

        return sha256, hash_source[0]

    @routes.post("/model_resolver/calculate-file-hash")
    @json_api_endpoint("calculate-file-hash")
    async def calculate_file_hash_route(request):
        """Calculate SHA256 for a local model and persist it to sidecar metadata."""
        data = await request.json()

        normalized_path, error = resolve_hash_file_request(data)
        if error == "file_path is required":
            return web.json_response(
                {"error": "file_path is required"}, status=400
            )
        if error:
            status = 403 if error == "file is outside configured model directories" else 404
            return web.json_response(
                {"error": error}, status=status
            )

        sha256, sha256_source = calculate_sha256_with_progress(normalized_path)
        if not sha256:
            return web.json_response(
                {"error": "could not calculate hash"}, status=500
            )
        resolved_metadata_path, metadata_updated = write_calculated_hash_metadata(
            normalized_path,
            sha256,
            sha256_source,
        )

        return web.json_response(
            {
                "success": True,
                "sha256": sha256,
                "hash": sha256,
                "sha256_source": sha256_source,
                "file_path": normalized_path,
                "metadata_path": resolved_metadata_path,
                "metadata_updated": metadata_updated,
            }
        )

    @routes.post("/model_resolver/calculate-file-hash/start")
    @json_api_endpoint("calculate-file-hash-start")
    async def calculate_file_hash_start_route(request):
        """Start SHA256 calculation in a background thread."""
        import uuid

        data = await request.json()
        normalized_path, error = resolve_hash_file_request(data)
        if error == "file_path is required":
            return web.json_response(
                {"error": "file_path is required"}, status=400
            )
        if error:
            status = 403 if error == "file is outside configured model directories" else 404
            return web.json_response(
                {"error": error}, status=status
            )

        self.hash_tracker.cleanup()
        progress_id = f"hash_{uuid.uuid4().hex}"
        self.hash_tracker.update(
            progress_id,
            status="queued",
            stage="queued",
            message="Preparing hash calculation...",
            percent=0,
            file_path=normalized_path,
        )

        def run_hash_task():
            sha256, sha256_source = calculate_sha256_with_progress(
                normalized_path,
                progress_id=progress_id,
            )
            if self.hash_tracker.is_cancelled(progress_id):
                raise HashCalculationCancelled()
            self.hash_tracker.update(
                progress_id,
                status="running",
                stage="metadata",
                message="Saving metadata...",
                percent=99,
            )
            resolved_metadata_path, metadata_updated = write_calculated_hash_metadata(
                normalized_path,
                sha256,
                sha256_source,
            )
            return sha256, sha256_source, resolved_metadata_path, metadata_updated

        def on_success(res):
            sha256, sha256_source, resolved_metadata_path, metadata_updated = res
            self.hash_tracker.update(
                progress_id,
                status="done",
                stage="done",
                message="Hash calculated",
                percent=100,
                sha256=sha256,
                hash=sha256,
                sha256_source=sha256_source,
                file_path=normalized_path,
                metadata_path=resolved_metadata_path,
                metadata_updated=metadata_updated,
            )

        def on_cancel(res=None):
            self.hash_tracker.update(
                progress_id,
                status="cancelled",
                stage="cancelled",
                message="Hash calculation cancelled",
            )

        run_in_background_thread(
            self.hash_tracker,
            progress_id,
            run_hash_task,
            on_success,
            on_cancel,
            error_log_msg=f"Hash calculation failed for {normalized_path}",
        )
        return web.json_response(
            {
                "success": True,
                "progress_id": progress_id,
            }
        )

    @routes.get("/model_resolver/calculate-file-hash/progress/{progress_id}")
    @json_api_endpoint("calculate-file-hash-progress")
    async def calculate_file_hash_progress_route(request):
        """Return progress for a background SHA256 calculation."""
        return get_progress_response(
            self.hash_tracker,
            request,
            not_found_status=404
        )

    @routes.post("/model_resolver/calculate-file-hash/cancel/{progress_id}")
    @json_api_endpoint("calculate-file-hash-cancel")
    async def calculate_file_hash_cancel_route(request):
        """Cancel a background SHA256 calculation."""
        return cancel_progress_response(
            self.hash_tracker,
            request,
            cancel_message="Stopping hash calculation..."
        )

def register_loaded_model_routes(context: RouteContext):
    adapt_custom_node_loaded_model = context.get('adapt_custom_node_loaded_model')
    asyncio = context.get('asyncio')
    get_filename_from_path = context.get('get_filename_from_path')
    get_progress_response = context.get('get_progress_response')
    get_workflow_model_inventory = context.get('get_workflow_model_inventory')
    json_api_endpoint = context.get('json_api_endpoint')
    routes = context.get('routes')
    self = context.get('self')
    web = context.get('web')

    @routes.post("/model_resolver/loaded")
    @json_api_endpoint("get_loaded_models")
    async def get_loaded_models(request):
        """Get all currently loaded models in the workflow."""
        data = await request.json()
        workflow_json = data.get("workflow")
        loaded_id = str(
            data.get("loaded_id") or data.get("progress_id") or ""
        ).strip()

        if not workflow_json:
            return web.json_response(
                {"error": "Workflow JSON is required"}, status=400
            )
        if not isinstance(workflow_json, dict):
            return web.json_response(
                {"error": "Workflow JSON must be an object"}, status=400
            )

        def update_loaded_progress(*args, **kwargs):
            self._update_loaded_progress(loaded_id, *args, **kwargs)

        def get_workflow_node_count():
            node_count = 0
            nodes = workflow_json.get("nodes", [])
            if isinstance(nodes, list):
                node_count += len(nodes)

            definitions = workflow_json.get("definitions", {})
            subgraphs = (
                definitions.get("subgraphs", [])
                if isinstance(definitions, dict)
                else []
            )
            if isinstance(subgraphs, list):
                for subgraph in subgraphs:
                    if not isinstance(subgraph, dict):
                        continue
                    subgraph_nodes = subgraph.get("nodes", [])
                    if isinstance(subgraph_nodes, list):
                        node_count += len(subgraph_nodes)
            return node_count

        def interpolate_percent(start, end, current, total):
            if not total:
                return start
            try:
                ratio = max(0.0, min(1.0, float(current) / float(total)))
            except (TypeError, ValueError, ZeroDivisionError):
                ratio = 0.0
            return start + ((end - start) * ratio)

        def build_loaded_models_response():
            from ..workflow_analyzer import (
                URN_TYPE_MAP,
                get_lora_model_strength,
            )

            update_loaded_progress(
                "scanning",
                "Scanning local model index...",
                percent=5,
            )

            workflow_node_count = get_workflow_node_count()

            def update_workflow_analysis_progress(payload):
                self._update_workflow_analysis_progress(
                    loaded_id,
                    workflow_node_count,
                    interpolate_percent,
                    payload,
                    start_percent=5,
                    end_percent=45,
                )

            inventory = get_workflow_model_inventory(
                workflow_json,
                progress_callback=update_workflow_analysis_progress,
            )
            available_models = inventory["available_models"]
            all_model_refs = inventory["model_refs"]

            # Create lookup for full paths by filename (with and without extension)
            path_by_filename = {}
            total_local_models = len(available_models)
            update_loaded_progress(
                "indexing",
                f"Indexing {total_local_models} local models...",
                percent=45,
                current=0,
                total=total_local_models,
            )
            for index, model_info in enumerate(available_models, start=1):
                rel_path = model_info.get("relative_path", "")
                if rel_path:
                    filename = get_filename_from_path(rel_path)
                    path_by_filename[filename] = model_info.get("path")
                    # Also add without extension for matching (simple approach)
                    if "." in filename:
                        filename_no_ext = filename.rsplit(".", 1)[0]
                        if filename_no_ext not in path_by_filename:
                            path_by_filename[filename_no_ext] = model_info.get("path")
                    # Add the full relative path as key too
                    path_by_filename[rel_path] = model_info.get("path")

                if (
                    total_local_models
                    and (index == total_local_models or index % 250 == 0)
                ):
                    update_loaded_progress(
                        "indexing",
                        f"Indexing local model {index} of {total_local_models}",
                        percent=interpolate_percent(
                            45, 55, index, total_local_models
                        ),
                        current=index,
                        total=total_local_models,
                    )

            # Also use folder_paths.get_full_path() to get paths
            try:
                import folder_paths
            except Exception:
                folder_paths = None

            folder_categories = [
                "loras",
                "checkpoints",
                "vae",
                "controlnet",
                "upscale_models",
            ]
            if folder_paths:
                for index, category_name in enumerate(folder_categories, start=1):
                    update_loaded_progress(
                        "indexing",
                        f"Reading {category_name} model list...",
                        percent=interpolate_percent(
                            55, 65, index - 1, len(folder_categories)
                        ),
                        current=index - 1,
                        total=len(folder_categories),
                    )
                    try:
                        filenames = folder_paths.get_filename_list(category_name)
                        for filename in filenames:
                            full_path = folder_paths.get_full_path(
                                category_name, filename
                            )
                            if (
                                full_path
                                and full_path not in path_by_filename.values()
                            ):
                                path_by_filename[filename] = full_path
                                filename_no_ext = (
                                    filename.rsplit(".", 1)[0]
                                    if "." in filename
                                    else filename
                                )
                                if filename_no_ext not in path_by_filename:
                                    path_by_filename[filename_no_ext] = full_path
                    except Exception:
                        pass

            # Also extract from node.properties.models
            workflow_nodes = workflow_json.get("nodes", [])
            nodes = list(workflow_nodes) if isinstance(workflow_nodes, list) else []
            node_scopes = {
                id(node): {
                    "subgraph_id": "",
                    "subgraph_name": "",
                    "is_top_level": True,
                }
                for node in nodes
                if isinstance(node, dict)
            }
            definitions = workflow_json.get("definitions", {})
            subgraphs = (
                definitions.get("subgraphs", [])
                if isinstance(definitions, dict)
                else []
            )
            for subgraph in subgraphs:
                if isinstance(subgraph, dict):
                    subgraph_nodes = subgraph.get("nodes", [])
                    if isinstance(subgraph_nodes, list):
                        nodes.extend(subgraph_nodes)
                        for node in subgraph_nodes:
                            if not isinstance(node, dict):
                                continue
                            node_scopes[id(node)] = {
                                "subgraph_id": subgraph.get("id") or "",
                                "subgraph_name": (
                                    subgraph.get("name")
                                    or subgraph.get("id")
                                    or ""
                                ),
                                "is_top_level": False,
                            }

            def get_node_scope(node):
                return node_scopes.get(
                    id(node),
                    {
                        "subgraph_id": "",
                        "subgraph_name": "",
                        "is_top_level": True,
                    },
                )

            def node_matches_ref(node, ref):
                if not isinstance(node, dict):
                    return False
                if str(node.get("id")) != str(ref.get("node_id")):
                    return False
                scope = get_node_scope(node)
                if scope["is_top_level"] != (
                    ref.get("is_top_level") is not False
                ):
                    return False
                if not scope["is_top_level"]:
                    return str(scope["subgraph_id"]) == str(
                        ref.get("subgraph_id") or ""
                    )
                return True

            # Collect all loaded models with their values
            loaded_models = []
            total_refs = len(all_model_refs)
            update_loaded_progress(
                "building",
                "Building loaded models list...",
                percent=65,
                current=0,
                total=total_refs,
            )

            # Process each model reference from analyze_workflow_models
            for index, ref in enumerate(all_model_refs, start=1):
                if total_refs and (index == total_refs or index % 50 == 0):
                    update_loaded_progress(
                        "building",
                        f"Building loaded model {index} of {total_refs}",
                        percent=interpolate_percent(65, 94, index, total_refs),
                        current=index,
                        total=total_refs,
                    )

                original_path = ref.get("original_path", "")
                node_id = ref.get("node_id")
                widget_index = ref.get("widget_index")
                node_type = ref.get("node_type", "")
                category = ref.get("category", "unknown")

                # Determine model name and strength
                model_name = get_filename_from_path(original_path)
                strength = None

                if (
                    ref.get("strength") is None
                    and category in {"lora", "loras"}
                ):
                    for node in nodes:
                        if node_matches_ref(node, ref):
                            strength = get_lora_model_strength(
                                node,
                                widget_index,
                            )
                            break

                if ref.get("strength") is not None:
                    strength = ref.get("strength")

                model_name, strength = adapt_custom_node_loaded_model(
                    ref,
                    model_name,
                    strength,
                )

                # Check if model exists locally
                exists = ref.get("exists", False)

                # If URN, resolve to display name
                if ref.get("is_urn"):
                    urn = ref.get("urn", {})
                    # Use model name from URN as display name
                    model_name = (
                        f"urn:{urn.get('type', 'model')}:{urn.get('model_id')}"
                    )
                    category = urn.get("type", category)
                    if category in URN_TYPE_MAP:
                        category = URN_TYPE_MAP[category]

                loaded_models.append(
                    {
                        "name": model_name,
                        "category": category,
                        "node_id": node_id,
                        "widget_index": widget_index,
                        "node_type": node_type,
                        "node_title": ref.get("node_title", ""),
                        "subgraph_id": ref.get("subgraph_id") or "",
                        "subgraph_name": ref.get("subgraph_name") or "",
                        "is_top_level": ref.get("is_top_level") is not False,
                        "locate_node_id": ref.get("locate_node_id"),
                        "locate_node_type": ref.get("locate_node_type", ""),
                        "locate_node_title": ref.get("locate_node_title", ""),
                        "locate_subgraph_id": (
                            ref.get("locate_subgraph_id") or ""
                        ),
                        "locate_subgraph_name": (
                            ref.get("locate_subgraph_name") or ""
                        ),
                        "locate_is_top_level": (
                            ref.get("locate_is_top_level") is not False
                        ),
                        "locate_via_promoted_widget": ref.get(
                            "locate_via_promoted_widget", False
                        ),
                        "exists": exists,
                        "strength": strength,
                        "original_path": original_path,
                        "is_urn": ref.get("is_urn", False),
                        "custom_node_adapter": ref.get(
                            "custom_node_adapter"
                        ),
                        "active": ref.get("active"),
                        "connected": ref.get("connected", True),
                        "resolved_path": (
                            path_by_filename.get(model_name)
                            or path_by_filename.get(original_path)
                        ),
                    }
                )

            # Also check node.properties.models for embedded models
            total_nodes = len(nodes)
            for node_index, node in enumerate(nodes, start=1):
                if total_nodes and (
                    node_index == total_nodes or node_index % 50 == 0
                ):
                    update_loaded_progress(
                        "embedded",
                        "Checking embedded model metadata...",
                        percent=interpolate_percent(
                            94, 98, node_index, total_nodes
                        ),
                        current=node_index,
                        total=total_nodes,
                    )

                node_type = node.get("type", "")
                properties = node.get("properties", {})
                if not isinstance(properties, dict):
                    properties = {}
                models_list = properties.get("models", [])
                if not isinstance(models_list, list):
                    models_list = []

                for model_info in models_list:
                    if isinstance(model_info, dict):
                        name = model_info.get("name", "")
                        directory = model_info.get("directory", "")
                        node_scope = get_node_scope(node)

                        if name:
                            # Check if this model is already in loaded_models
                            existing = next(
                                (
                                    model
                                    for model in loaded_models
                                    if model.get("original_path") == name
                                ),
                                None,
                            )
                            if not existing:
                                loaded_models.append(
                                    {
                                        "name": get_filename_from_path(name),
                                        "category": directory or "checkpoints",
                                        "node_id": node.get("id"),
                                        "widget_index": None,
                                        "node_type": node_type,
                                        "node_title": node.get("title", ""),
                                        "subgraph_id": node_scope["subgraph_id"],
                                        "subgraph_name": node_scope[
                                            "subgraph_name"
                                        ],
                                        "is_top_level": node_scope[
                                            "is_top_level"
                                        ],
                                        "exists": True,  # Embedded models are loaded
                                        "strength": None,
                                        "original_path": name,
                                        "is_urn": False,
                                    }
                                )

            update_loaded_progress(
                "finalizing",
                "Loaded models ready",
                percent=99,
                current=len(loaded_models),
                total=len(loaded_models),
            )
            return {
                "loaded_models": loaded_models,
                "total": len(loaded_models),
            }

        update_loaded_progress(
            "starting",
            "Preparing loaded model scan...",
            percent=0,
            status="starting",
            current=0,
            total=0,
        )

        try:
            result = await asyncio.to_thread(build_loaded_models_response)
        except Exception as e:
            update_loaded_progress(
                "error",
                str(e),
                percent=100,
                status="error",
                current=0,
                total=0,
            )
            self.logger.error(
                f"Model Resolver loaded models error: {e}", exc_info=True
            )
            return web.json_response({"error": str(e)}, status=500)

        update_loaded_progress(
            "completed",
            "Loaded models ready",
            percent=100,
            status="completed",
            current=result.get("total", 0),
            total=result.get("total", 0),
        )
        return web.json_response(result)

    @routes.get("/model_resolver/loaded-progress/{loaded_id}")
    @json_api_endpoint("loaded-progress")
    async def get_loaded_models_progress(request):
        """Get loaded models inspection progress."""
        return get_progress_response(
            self.loaded_progress,
            request,
            param_name="loaded_id",
            not_found_payload={
                "status": "unknown",
                "stage": "unknown",
                "message": "No loaded models progress available",
                "percent": 0,
                "current": 0,
                "total": 0,
            }
        )

    # ==================== MODEL METADATA LOOKUP ROUTE ====================

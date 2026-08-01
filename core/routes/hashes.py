"""Local model and hash route registration."""

from .context import RouteContext


def register_hash_routes(context: RouteContext):
    FileManagerError = context.get('FileManagerError')
    FileManagerUnavailableError = context.get('FileManagerUnavailableError')
    MODEL_RESOLVER_METADATA_SCHEMA = context.get('MODEL_RESOLVER_METADATA_SCHEMA')
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION = context.get('MODEL_RESOLVER_METADATA_SCHEMA_VERSION')
    UnsupportedFileManagerPlatformError = context.get('UnsupportedFileManagerPlatformError')
    asyncio = context.get('asyncio')
    cancel_progress_response = context.get('cancel_progress_response')
    get_existing_model_preview_path = context.get('get_existing_model_preview_path')
    get_filename_from_path = context.get('get_filename_from_path')
    get_local_model_hash_metadata = context.get('get_local_model_hash_metadata')
    get_progress_response = context.get('get_progress_response')
    get_safe_model_resolver_sidecar_path = context.get('get_safe_model_resolver_sidecar_path')
    get_workflow_model_inventory = context.get('get_workflow_model_inventory')
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
    search_local_matches_by_hash = context.get('search_local_matches_by_hash')
    self = context.get('self')
    time = context.get('time')
    to_bool = context.get('to_bool')
    to_int = context.get('to_int')
    web = context.get('web')
    write_json_atomic = context.get('write_json_atomic')

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

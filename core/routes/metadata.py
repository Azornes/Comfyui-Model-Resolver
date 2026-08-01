"""Metadata route registration."""

from .context import RouteContext


def register_metadata_routes(context: RouteContext):
    asyncio = context.get('asyncio')
    audit_metadata_sizes = context.get('audit_metadata_sizes')
    build_missing_local_metadata = context.get('build_missing_local_metadata')
    cancel_progress_response = context.get('cancel_progress_response')
    get_metadata_build_capabilities = context.get('get_metadata_build_capabilities')
    get_model_files = context.get('get_model_files')
    get_progress_response = context.get('get_progress_response')
    invalidate_local_hash_match_cache = context.get('invalidate_local_hash_match_cache')
    json_api_endpoint = context.get('json_api_endpoint')
    normalize_metadata_build_mode = context.get('normalize_metadata_build_mode')
    routes = context.get('routes')
    run_in_background_thread = context.get('run_in_background_thread')
    self = context.get('self')
    to_bool = context.get('to_bool')
    to_int = context.get('to_int')
    web = context.get('web')

    @routes.get("/model_resolver/models")
    @json_api_endpoint("get_models")
    async def get_models(request):
        """Get list of all available models."""
        force_rescan = to_bool(
            request.query.get("force") or request.query.get("force_rescan"),
            False
        )
        if force_rescan:
            invalidate_local_hash_match_cache()
        models = get_model_files(force_rescan=force_rescan)
        return web.json_response(models)

    @routes.post("/model_resolver/metadata-size-audit")
    @json_api_endpoint("metadata-size-audit")
    async def metadata_size_audit_route(request):
        """Check local model .metadata.json sidecars for stale size values."""
        payload = {}
        try:
            if request.can_read_body:
                payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        force_rescan = to_bool(payload.get("force_rescan"), True)
        result = await asyncio.to_thread(
            audit_metadata_sizes,
            force_rescan=force_rescan,
            worker_count=payload.get("worker_count"),
            batch_size=payload.get("batch_size"),
        )
        return web.json_response(result)

    @routes.get("/model_resolver/metadata-build/capabilities")
    @json_api_endpoint("metadata-build-capabilities")
    async def metadata_build_capabilities_route(request):
        """Return local CPU and worker limits for the metadata builder."""
        return web.json_response(get_metadata_build_capabilities())

    @routes.post("/model_resolver/metadata-build/start")
    @json_api_endpoint("metadata-build-start")
    async def metadata_build_start_route(request):
        """Create missing local metadata sidecars and fill missing SHA256 values."""
        import uuid

        payload = {}
        try:
            if request.can_read_body:
                payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        force_rescan = to_bool(payload.get("force_rescan"), True)
        worker_count = to_int(payload.get("worker_count"), 0)
        metadata_mode = normalize_metadata_build_mode(
            payload.get("metadata_mode")
        )
        self.metadata_builder_progress.cleanup()
        progress_id = f"metadata_build_{uuid.uuid4().hex}"
        self.metadata_builder_progress.update(
            progress_id,
            status="queued",
            stage="queued",
            message="Preparing local metadata build...",
            percent=0,
            current=0,
            total=0,
            requested_worker_count=worker_count,
            metadata_mode=metadata_mode,
        )

        def update_metadata_build_progress(progress_payload):
            self._update_metadata_build_progress(
                progress_id, progress_payload
            )

        def is_metadata_build_cancelled():
            return self.metadata_builder_progress.is_cancelled(progress_id)

        def run_metadata_build_task():
            result = build_missing_local_metadata(
                force_rescan=force_rescan,
                worker_count=worker_count,
                metadata_mode=metadata_mode,
                progress_callback=update_metadata_build_progress,
                is_cancelled=is_metadata_build_cancelled,
            )
            return result

        def on_success(result):
            self.metadata_builder_progress.update(
                progress_id,
                status="done",
                stage="done",
                message="Local metadata build completed.",
                percent=100,
                active_models=[],
                active_worker_count=0,
                current_model="",
                current_path="",
                bytes_read=0,
                total_bytes=0,
                result=result,
                **result,
            )

        def on_cancel(result=None):
            self.metadata_builder_progress.update(
                progress_id,
                status="cancelled",
                stage="cancelled",
                message="Metadata build cancelled",
                percent=100,
                active_models=[],
                active_worker_count=0,
                current_model="",
                current_path="",
                bytes_read=0,
                total_bytes=0,
                result=result or {},
                **(result or {}),
            )

        def on_error(exc):
            self.metadata_builder_progress.update(
                progress_id,
                status="error",
                stage="error",
                message=str(exc) or "Metadata build failed",
                percent=100,
                active_models=[],
                active_worker_count=0,
                current_model="",
                current_path="",
                bytes_read=0,
                total_bytes=0,
                error=str(exc) or "Metadata build failed",
            )

        run_in_background_thread(
            self.metadata_builder_progress,
            progress_id,
            run_metadata_build_task,
            on_success,
            on_cancel,
            on_error,
            error_log_msg="Metadata build failed",
        )
        return web.json_response(
            {
                "success": True,
                "progress_id": progress_id,
                "metadata_mode": metadata_mode,
            }
        )

    @routes.get("/model_resolver/metadata-build/progress/{progress_id}")
    @json_api_endpoint("metadata-build-progress")
    async def metadata_build_progress_route(request):
        """Return progress for local metadata sidecar creation."""
        return get_progress_response(
            self.metadata_builder_progress,
            request,
            not_found_status=404,
        )

    @routes.post("/model_resolver/metadata-build/cancel/{progress_id}")
    @json_api_endpoint("metadata-build-cancel")
    async def metadata_build_cancel_route(request):
        """Cancel local metadata sidecar creation."""
        return cancel_progress_response(
            self.metadata_builder_progress,
            request,
            cancel_message="Stopping metadata build...",
        )

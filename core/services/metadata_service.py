"""Metadata audit and build orchestration used by HTTP route adapters."""

import uuid

from ..routes.context import RouteContext


class MetadataService:
    """Coordinate local metadata audit and background build operations."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.get("asyncio")
        self.audit_metadata_sizes_fn = context.get("audit_metadata_sizes")
        self.build_missing_local_metadata_fn = context.get(
            "build_missing_local_metadata"
        )
        self.cancel_progress_response_fn = context.get(
            "cancel_progress_response"
        )
        self.get_metadata_build_capabilities_fn = context.get(
            "get_metadata_build_capabilities"
        )
        self.get_progress_response_fn = context.get("get_progress_response")
        self.normalize_metadata_build_mode = context.get(
            "normalize_metadata_build_mode"
        )
        self.run_in_background_thread = context.get("run_in_background_thread")
        self.extension = context.get("self")
        self.to_bool = context.get("to_bool")
        self.to_int = context.get("to_int")
        self.web = context.get("web")

    @property
    def metadata_builder_progress(self):
        return self.extension.metadata_builder_progress

    async def metadata_size_audit(self, request):
        """Check local metadata sidecars for stale file-size values."""
        payload = {}
        try:
            if request.can_read_body:
                payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        force_rescan = self.to_bool(payload.get("force_rescan"), True)
        result = await self.asyncio.to_thread(
            self.audit_metadata_sizes_fn,
            force_rescan=force_rescan,
            worker_count=payload.get("worker_count"),
            batch_size=payload.get("batch_size"),
        )
        return self.web.json_response(result)

    async def metadata_build_capabilities(self, request):
        """Return local CPU and worker limits for the metadata builder."""
        return self.web.json_response(
            self.get_metadata_build_capabilities_fn()
        )

    async def metadata_build_start(self, request):
        """Start building missing local metadata sidecars in the background."""
        payload = {}
        try:
            if request.can_read_body:
                payload = await request.json()
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        force_rescan = self.to_bool(payload.get("force_rescan"), True)
        worker_count = self.to_int(payload.get("worker_count"), 0)
        metadata_mode = self.normalize_metadata_build_mode(
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
            self.extension._update_metadata_build_progress(
                progress_id,
                progress_payload,
            )

        def is_metadata_build_cancelled():
            return self.metadata_builder_progress.is_cancelled(progress_id)

        def run_metadata_build_task():
            return self.build_missing_local_metadata_fn(
                force_rescan=force_rescan,
                worker_count=worker_count,
                metadata_mode=metadata_mode,
                progress_callback=update_metadata_build_progress,
                is_cancelled=is_metadata_build_cancelled,
            )

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

        self.run_in_background_thread(
            self.metadata_builder_progress,
            progress_id,
            run_metadata_build_task,
            on_success,
            on_cancel,
            on_error,
            error_log_msg="Metadata build failed",
        )
        return self.web.json_response(
            {
                "success": True,
                "progress_id": progress_id,
                "metadata_mode": metadata_mode,
            }
        )

    async def metadata_build_progress(self, request):
        """Return progress for local metadata sidecar creation."""
        return self.get_progress_response_fn(
            self.metadata_builder_progress,
            request,
            not_found_status=404,
        )

    async def metadata_build_cancel(self, request):
        """Cancel local metadata sidecar creation."""
        return self.cancel_progress_response_fn(
            self.metadata_builder_progress,
            request,
            cancel_message="Stopping metadata build...",
        )

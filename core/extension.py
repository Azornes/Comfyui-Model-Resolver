"""Runtime extension state and ComfyUI route bootstrap."""

from typing import Any, Dict, Optional

from .log_system import create_module_logger
from .progress import JobProgressTracker


class ModelResolverExtension:
    """Main extension class for Model Resolver."""

    def __init__(self):
        self.routes_setup = False
        self.logger = create_module_logger("comfyui-model-resolver")
        self.analysis_progress = JobProgressTracker("Analyzing...")
        self.loaded_progress = JobProgressTracker("Loading loaded models...")
        self.search_tracker = JobProgressTracker("Searching...")
        self.hash_tracker = JobProgressTracker("Preparing hash calculation...")
        self.metadata_builder_progress = JobProgressTracker(
            "Building local metadata..."
        )
        self.search_result_timestamps = {}

    def _update_analysis_progress(
        self,
        analysis_id: Optional[str],
        payload: Dict[str, Any],
    ) -> None:
        self.analysis_progress.update_from_payload(analysis_id, payload)

    def _update_metadata_build_progress(
        self,
        progress_id: Optional[str],
        progress_payload: Dict[str, Any],
    ) -> None:
        self.metadata_builder_progress.update_from_payload(
            progress_id,
            progress_payload,
        )

    def _update_loaded_progress(
        self,
        loaded_id: Optional[str],
        stage: str,
        message: str,
        percent: Optional[float] = None,
        status: str = "running",
        current: int = 0,
        total: int = 0,
        **payload,
    ) -> None:
        if not loaded_id:
            return
        self.loaded_progress.update_from_payload(
            loaded_id,
            {
                "stage": stage,
                "message": message,
                "percent": percent,
                "status": status,
                "current": current,
                "total": total,
                **payload,
            },
        )

    def _update_workflow_analysis_progress(
        self,
        loaded_id: Optional[str],
        workflow_node_count: int,
        interpolate_percent_fn,
        payload: Dict[str, Any],
        start_percent: float = 35,
        end_percent: float = 78,
    ) -> None:
        progress_payload = dict(payload or {})
        current = progress_payload.pop("current", 0)
        total = progress_payload.pop("total", workflow_node_count)
        stage = progress_payload.pop("stage", "analyzing")
        message = progress_payload.pop("message", "Analyzing workflow nodes...")
        progress_payload.pop("percent", None)
        self._update_loaded_progress(
            loaded_id,
            stage,
            message,
            percent=interpolate_percent_fn(
                start_percent,
                end_percent,
                current,
                total,
            ),
            current=current,
            total=total,
            **progress_payload,
        )

    def initialize(self):
        """Initialize the extension and set up API routes."""
        try:
            self.setup_routes()
            self.logger.info("Model Resolver: Extension initialized successfully")
        except Exception as error:
            self.logger.error(
                f"Model Resolver: Extension initialization failed: {error}",
                exc_info=True,
            )

    def setup_routes(self):
        from .routes.registry import register_routes

        return register_routes(self)

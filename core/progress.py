"""Progress tracking and reporting utilities."""

import threading
import time
from typing import Any, Callable, Dict, Optional

from .log_system import create_module_logger

log = create_module_logger(__name__)


class JobProgressTracker:
    """Helper class for thread-safe job progress tracking and cancellation management."""

    def __init__(self, default_message="Processing..."):
        self.lock = threading.Lock()
        self.progress = {}
        self.cancelled = set()
        self.default_message = default_message

    def cleanup(self, max_age_seconds=300):
        cutoff = time.time() - max_age_seconds
        with self.lock:
            expired = [
                pid
                for pid, data in self.progress.items()
                if data.get("updated_at", data.get("created_at", 0)) < cutoff
            ]
            for pid in expired:
                self.progress.pop(pid, None)
            self.cancelled.difference_update(expired)

    def update(self, progress_id, source=None, stage=None, message=None, percent=None, status=None, **payload):
        if not progress_id:
            return
        if source is not None:
            payload["source"] = source
        if stage is not None:
            payload["stage"] = stage
        if message is not None:
            payload["message"] = message
        if percent is not None:
            payload["percent"] = percent
        if status is not None:
            payload["status"] = status

        now = time.time()
        with self.lock:
            current = self.progress.get(progress_id, {})

            # If the job was cancelled, force it to remain cancelled.
            if progress_id in self.cancelled and payload.get("status") != "cancelled":
                payload["status"] = "cancelled"
                payload["stage"] = "cancelled"
                payload["message"] = "Cancelled"
                payload["percent"] = 100
                payload["cancelled"] = True

            # Normalize percent if present
            if "percent" in payload and payload["percent"] is not None:
                try:
                    payload["percent"] = max(0.0, min(100.0, float(payload["percent"])))
                except (TypeError, ValueError):
                    pass

            self.progress[progress_id] = {
                "created_at": now,
                "message": self.default_message,
                **current,
                **payload,
                "progress_id": progress_id,
                "updated_at": now,
            }

    def update_from_payload(
        self,
        progress_id: Optional[str],
        progress_payload: Dict[str, Any],
        default_stage: str = "running",
    ) -> None:
        if not progress_id or not isinstance(progress_payload, dict):
            return
        data = dict(progress_payload)
        status = data.pop("status", None)
        stage = data.pop("stage", None) or default_stage
        if not status:
            if stage in ("done", "completed"):
                status = "completed"
            elif stage == "cancelled":
                status = "cancelled"
            else:
                status = "running"
        self.update(progress_id, status=status, stage=stage, **data)

    def is_cancelled(self, progress_id) -> bool:
        if not progress_id:
            return False
        with self.lock:
            return progress_id in self.cancelled

    def mark_cancelled(self, progress_id, cancel_message="Cancelled") -> bool:
        self.cleanup()
        with self.lock:
            current = self.progress.get(progress_id, {})
            self.cancelled.add(progress_id)
            self.progress[progress_id] = {
                "created_at": time.time(),
                **current,
                "progress_id": progress_id,
                "status": "cancelled",
                "stage": "cancelled",
                "message": cancel_message,
                "percent": 100,
                "cancelled": True,
                "updated_at": time.time(),
            }
            return True

    def get(self, progress_id):
        with self.lock:
            val = self.progress.get(progress_id)
            return dict(val) if val else None


def report_progress(
    progress_callback: Optional[Callable[[Dict[str, Any]], None]],
    stage: str,
    message: str,
    percent: Optional[float] = None,
    error_context: str = "Progress callback",
    **extra: Any,
) -> None:
    """
    Report progress via callback payload.
    
    Args:
        progress_callback: Callback function to execute
        stage: Progress stage name
        message: Informational message
        percent: Progress percentage (0.0 to 100.0)
        error_context: Source name to use in error logging
        extra: Additional key-value pairs to add to payload
    """
    if not progress_callback:
        return

    payload = {"stage": stage, "message": message}
    if percent is not None:
        payload["percent"] = percent
    if extra:
        payload.update(extra)

    try:
        progress_callback(payload)
    except Exception as e:
        log.debug(f"{error_context} failed: {e}")


def get_progress_reporter(error_context: str) -> Callable[[Optional[Callable[[Dict[str, Any]], None]], str, str, Optional[float]], None]:
    """Return a closure for reporting progress with a pre-configured error context."""
    def reporter(
        progress_callback: Optional[Callable[[Dict[str, Any]], None]],
        stage: str,
        message: str,
        percent: Optional[float] = None,
        **extra: Any,
    ) -> None:
        report_progress(
            progress_callback,
            stage,
            message,
            percent,
            error_context=error_context,
            **extra,
        )
    return reporter



"""
Progress Reporting Module

Unified utility for reporting progress of asynchronous search and download operations.
"""

from typing import Any, Callable, Dict, Optional

from .log_system import create_module_logger

log = create_module_logger(__name__)


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


class ProgressTracker:
    """
    Context manager and state tracker for reporting operational progress to callbacks.
    """
    def __init__(
        self,
        stage: str,
        callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        total: int = 1,
        error_context: str = "Progress callback",
    ):
        self.stage = stage
        self.callback = callback
        self.total = max(1, total)
        self.current = 0
        self.error_context = error_context

    def __enter__(self) -> "ProgressTracker":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        pass

    def update(self, step: int = 1, message: str = "", **extra: Any) -> None:
        self.current += step
        percent = min(100.0, max(0.0, (self.current / self.total) * 100.0))
        report_progress(
            self.callback,
            self.stage,
            message,
            percent=percent,
            error_context=self.error_context,
            current=self.current,
            total=self.total,
            **extra,
        )


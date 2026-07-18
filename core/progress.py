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



"""Download progress and cancellation state operations."""

import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

# Shared mutable download state has a single owner in this module.
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()
aria2_lock = threading.RLock()
aria2_transfers: Dict[str, Dict[str, Any]] = {}
aria2_action_locks: Dict[str, Any] = {}
aria2_desired_states: Dict[str, Dict[str, Any]] = {}
xet_transfers: Dict[str, Dict[str, Any]] = {}
xet_transfers_lock = threading.Lock()
python_download_controls: Dict[str, threading.Event] = {}
python_download_controls_lock = threading.Lock()


def register_python_download_control(
    download_id: str,
    controls: Optional[Dict[str, threading.Event]] = None,
    lock: Optional[Any] = None,
) -> threading.Event:
    """Register a threading.Event control for an active Python download."""
    ctrls = python_download_controls if controls is None else controls
    ctrl_lock = python_download_controls_lock if lock is None else lock
    event = threading.Event()
    event.set()
    with ctrl_lock:
        ctrls[download_id] = event
    return event


def unregister_python_download_control(
    download_id: str,
    controls: Optional[Dict[str, threading.Event]] = None,
    lock: Optional[Any] = None,
) -> None:
    """Unregister the threading.Event control for a completed or cancelled Python download."""
    ctrls = python_download_controls if controls is None else controls
    ctrl_lock = python_download_controls_lock if lock is None else lock
    with ctrl_lock:
        ctrls.pop(download_id, None)


def pause_python_download(
    download_id: str,
    controls: Optional[Dict[str, threading.Event]] = None,
    lock: Optional[Any] = None,
) -> bool:
    """Pause an active Python download by clearing its control event."""
    ctrls = python_download_controls if controls is None else controls
    ctrl_lock = python_download_controls_lock if lock is None else lock
    with ctrl_lock:
        event = ctrls.get(download_id)
        if event is not None:
            event.clear()
            return True
    return False


def resume_python_download(
    download_id: str,
    controls: Optional[Dict[str, threading.Event]] = None,
    lock: Optional[Any] = None,
) -> bool:
    """Resume an active Python download by setting its control event."""
    ctrls = python_download_controls if controls is None else controls
    ctrl_lock = python_download_controls_lock if lock is None else lock
    with ctrl_lock:
        event = ctrls.get(download_id)
        if event is not None:
            event.set()
            return True
    return False


def is_python_download_active(
    download_id: str,
    controls: Optional[Dict[str, threading.Event]] = None,
    lock: Optional[Any] = None,
) -> bool:
    """Return True if the download has an active Python download control."""
    ctrls = python_download_controls if controls is None else controls
    ctrl_lock = python_download_controls_lock if lock is None else lock
    with ctrl_lock:
        return download_id in ctrls


def create_initial_progress(
    *,
    url: str,
    path: str,
    filename: str,
    directory: str,
    download_backend: str,
    start_time: float,
    total_size: int = 0,
) -> Dict[str, Any]:
    """Build the shared initial progress record for a download."""
    return {
        "status": "starting",
        "progress": 0,
        "total_size": total_size,
        "downloaded": 0,
        "filename": filename,
        "path": path,
        "directory": directory,
        "url": url,
        "error": None,
        "speed": 0,
        "start_time": start_time,
        "download_backend": download_backend,
    }


@dataclass(frozen=True)
class DownloadStateDependencies:
    """State and side-effect dependencies supplied by the composition layer."""

    download_progress: Dict[str, Dict[str, Any]]
    download_lock: Any
    cancelled_downloads: set
    aria2_lock: Any
    aria2_transfers: Dict[str, Dict[str, Any]]
    aria2_desired_states: Dict[str, Dict[str, Any]]
    xet_transfers: Dict[str, Dict[str, Any]]
    xet_transfers_lock: Any
    set_download_progress_status: Callable[..., Any]
    force_remove_aria2_transfer: Callable[..., Any]
    thread_factory: Callable[..., Any]
    log: Any
    delete_partial_download_files: Optional[Callable[..., Any]] = None
    remove_persisted_download: Optional[Callable[..., Any]] = None
    clear_completed_persisted_transfers: Optional[Callable[..., Any]] = None
    python_download_controls: Optional[Dict[str, threading.Event]] = None
    python_download_controls_lock: Optional[Any] = None


def get_progress(
    download_id: str,
    state: DownloadStateDependencies,
) -> Optional[Dict[str, Any]]:
    """Get progress for a specific download."""
    with state.download_lock:
        return state.download_progress.get(download_id, {}).copy()


def get_all_progress(state: DownloadStateDependencies) -> Dict[str, Dict[str, Any]]:
    """Get progress for all downloads."""
    with state.download_lock:
        return {key: value.copy() for key, value in state.download_progress.items()}


def cancel_download(download_id: str, state: DownloadStateDependencies) -> bool:
    """Cancel a download in progress."""
    with state.download_lock:
        progress = state.download_progress.get(download_id)
        if not progress or progress.get("status") in {"completed", "error", "cancelled"}:
            return True
        state.cancelled_downloads.add(download_id)
        progress.update(status="cancelling", speed=0)
    with state.aria2_lock:
        state.aria2_desired_states.pop(download_id, None)

    py_controls = getattr(state, "python_download_controls", None)
    if py_controls is None:
        py_controls = python_download_controls
    py_lock = getattr(state, "python_download_controls_lock", None)
    if py_lock is None:
        py_lock = python_download_controls_lock
    with py_lock:
        py_event = py_controls.get(download_id)
        if py_event is not None:
            py_event.set()

    transfer = state.aria2_transfers.get(download_id)
    if transfer and transfer.get("gid"):
        thread_factory = getattr(state, "thread_factory", None) or threading.Thread
        thread_factory(
            target=state.force_remove_aria2_transfer,
            args=(download_id, transfer["gid"]),
            daemon=True,
        ).start()

    with state.xet_transfers_lock:
        xet_transfer = dict(state.xet_transfers.get(download_id) or {})
    xet_handle = xet_transfer.get("handle")
    xet_cancel = getattr(xet_handle, "cancel", None)
    if callable(xet_cancel):
        try:
            xet_cancel()
        except Exception as exc:
            state.log.warning(f"Could not cancel Hugging Face Xet transfer {download_id}: {exc}")

    remove_persisted = getattr(state, "remove_persisted_download", None)
    if callable(remove_persisted):
        remove_persisted(download_id)

    return True


def clear_completed_downloads(state: DownloadStateDependencies):
    """Clear completed/failed downloads from progress tracking."""
    with state.download_lock:
        to_remove = [
            download_id
            for download_id, info in state.download_progress.items()
            if info.get("status") in ("completed", "error", "cancelled")
        ]
        for download_id in to_remove:
            del state.download_progress[download_id]
            state.cancelled_downloads.discard(download_id)

    py_controls = getattr(state, "python_download_controls", None)
    if py_controls is None:
        py_controls = python_download_controls
    py_lock = getattr(state, "python_download_controls_lock", None)
    if py_lock is None:
        py_lock = python_download_controls_lock
    with py_lock:
        for download_id in to_remove:
            py_controls.pop(download_id, None)

    clear_persisted = getattr(state, "clear_completed_persisted_transfers", None)
    if callable(clear_persisted):
        clear_persisted()

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
    state.cancelled_downloads.add(download_id)
    with state.aria2_lock:
        state.aria2_desired_states.pop(download_id, None)
    state.set_download_progress_status(download_id, "cancelling", speed=0)

    transfer = state.aria2_transfers.get(download_id)
    if transfer and transfer.get("gid"):
        state.thread_factory(
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

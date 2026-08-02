"""Download progress and cancellation state operations."""

import importlib
import threading
from typing import Any, Dict, Optional

# Shared mutable download state.  The facade re-exports these same objects
# during the migration, so there is only one owner and no duplicated state.
download_progress: Dict[str, Dict[str, Any]] = {}
download_lock = threading.Lock()
cancelled_downloads: set = set()
aria2_lock = threading.RLock()
aria2_transfers: Dict[str, Dict[str, Any]] = {}
aria2_action_locks: Dict[str, Any] = {}
aria2_desired_states: Dict[str, Dict[str, Any]] = {}
xet_transfers: Dict[str, Dict[str, Any]] = {}
xet_transfers_lock = threading.Lock()


def _downloader_module():
    """Return the facade so runtime patches remain effective."""
    return importlib.import_module("core.downloader")


def get_progress(download_id: str) -> Optional[Dict[str, Any]]:
    """Get progress for a specific download."""
    facade = _downloader_module()
    with facade.download_lock:
        return facade.download_progress.get(download_id, {}).copy()


def get_all_progress() -> Dict[str, Dict[str, Any]]:
    """Get progress for all downloads."""
    facade = _downloader_module()
    with facade.download_lock:
        return {key: value.copy() for key, value in facade.download_progress.items()}


def cancel_download(download_id: str) -> bool:
    """Cancel a download in progress."""
    facade = _downloader_module()
    facade.cancelled_downloads.add(download_id)
    with facade.aria2_lock:
        facade.aria2_desired_states.pop(download_id, None)
    facade._set_download_progress_status(download_id, "cancelling", speed=0)

    transfer = facade.aria2_transfers.get(download_id)
    if transfer and transfer.get("gid"):
        facade.threading.Thread(
            target=facade._force_remove_aria2_transfer,
            args=(download_id, transfer["gid"]),
            daemon=True,
        ).start()

    with facade.xet_transfers_lock:
        xet_transfer = dict(facade.xet_transfers.get(download_id) or {})
    xet_handle = xet_transfer.get("handle")
    xet_cancel = getattr(xet_handle, "cancel", None)
    if callable(xet_cancel):
        try:
            xet_cancel()
        except Exception as exc:
            facade.log.warning(f"Could not cancel Hugging Face Xet transfer {download_id}: {exc}")
    return True


def clear_completed_downloads():
    """Clear completed/failed downloads from progress tracking."""
    facade = _downloader_module()
    with facade.download_lock:
        to_remove = [
            download_id
            for download_id, info in facade.download_progress.items()
            if info.get("status") in ("completed", "error", "cancelled")
        ]
        for download_id in to_remove:
            del facade.download_progress[download_id]
            facade.cancelled_downloads.discard(download_id)

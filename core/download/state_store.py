"""Persistent storage for active and interrupted model downloads."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from ..log_system import create_module_logger
from ..path_utils import read_json_safe, write_json_atomic

log = create_module_logger("core.download.state_store")

CUSTOM_NODE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE_FILE = CUSTOM_NODE_ROOT / "state" / "downloads.json"

_store_lock = threading.Lock()


def get_state_file_path(custom_path: Optional[str] = None) -> Path:
    """Return the resolved Path for downloads.json, ensuring its parent directory exists."""
    path = Path(custom_path) if custom_path else DEFAULT_STATE_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        log.warning(f"Could not create state directory {path.parent}: {exc}")
    return path


def read_persisted_downloads(state_file: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Read all persisted download records from disk."""
    path = state_file or get_state_file_path()
    with _store_lock:
        data = read_json_safe(str(path), {})
        if not isinstance(data, dict):
            return {}
        return {
            str(k): dict(v)
            for k, v in data.items()
            if isinstance(k, str) and isinstance(v, dict)
        }


def save_download_spec(
    download_id: str,
    spec: Dict[str, Any],
    *,
    state_file: Optional[Path] = None,
) -> None:
    """Persist a new or updated download specification to disk."""
    if not download_id:
        return
    path = state_file or get_state_file_path()
    with _store_lock:
        current = read_json_safe(str(path), {})
        if not isinstance(current, dict):
            current = {}
        entry = dict(current.get(download_id) or {})
        entry.update(spec)
        entry["updated_at"] = time.time()
        current[download_id] = entry
        try:
            write_json_atomic(str(path), current, indent=2)
        except Exception as exc:
            log.warning(f"Could not persist download spec {download_id}: {exc}")


def update_download_progress_state(
    download_id: str,
    *,
    status: Optional[str] = None,
    downloaded: Optional[int] = None,
    total_size: Optional[int] = None,
    error: Optional[str] = None,
    path: Optional[str] = None,
    state_file: Optional[Path] = None,
) -> None:
    """Update progress status and byte counters for an existing download in the state store."""
    if not download_id:
        return
    file_path = state_file or get_state_file_path()
    with _store_lock:
        current = read_json_safe(str(file_path), {})
        if not isinstance(current, dict) or download_id not in current:
            return
        entry = current[download_id]
        if status is not None:
            entry["status"] = status
        if downloaded is not None:
            entry["downloaded"] = downloaded
        if total_size is not None:
            entry["total_size"] = total_size
        if error is not None:
            entry["error"] = error
        if path is not None:
            entry["path"] = path
        entry["updated_at"] = time.time()
        try:
            write_json_atomic(str(file_path), current, indent=2)
        except Exception as exc:
            log.debug(f"Could not update persisted download state {download_id}: {exc}")


def remove_persisted_download(
    download_id: str,
    *,
    state_file: Optional[Path] = None,
) -> None:
    """Remove a download from the persistent store (e.g., when completed or cancelled)."""
    if not download_id:
        return
    file_path = state_file or get_state_file_path()
    with _store_lock:
        current = read_json_safe(str(file_path), {})
        if not isinstance(current, dict) or download_id not in current:
            return
        del current[download_id]
        try:
            write_json_atomic(str(file_path), current, indent=2)
        except Exception as exc:
            log.warning(f"Could not remove persisted download {download_id}: {exc}")


def clear_completed_persisted_transfers(
    *,
    state_file: Optional[Path] = None,
) -> None:
    """Remove terminal (completed, cancelled) records from the persistent store."""
    file_path = state_file or get_state_file_path()
    with _store_lock:
        current = read_json_safe(str(file_path), {})
        if not isinstance(current, dict):
            return
        filtered = {
            k: v
            for k, v in current.items()
            if isinstance(v, dict) and v.get("status") not in {"completed", "cancelled"}
        }
        if len(filtered) != len(current):
            try:
                write_json_atomic(str(file_path), filtered, indent=2)
            except Exception as exc:
                log.warning(f"Could not clear completed persisted downloads: {exc}")


def get_persisted_spec(
    download_id: str,
    *,
    state_file: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Retrieve the saved spec for a specific download ID."""
    all_records = read_persisted_downloads(state_file=state_file)
    return all_records.get(download_id)


def restore_persisted_downloads(
    download_progress: Dict[str, Dict[str, Any]],
    download_lock: Any,
    *,
    state_file: Optional[Path] = None,
    log_fn: Any = None,
) -> int:
    """Scan persisted downloads on startup, cleaning completed ones and marking interrupted ones as paused."""
    records = read_persisted_downloads(state_file=state_file)
    if not records:
        return 0

    restored_count = 0
    to_remove = []

    for download_id, record in records.items():
        dest_path = str(record.get("path") or "").strip()
        aria2_control_path = f"{dest_path}.aria2" if dest_path else ""
        total_size = int(record.get("total_size") or 0)

        # Check if the file on disk is already complete
        if (
            dest_path
            and os.path.isfile(dest_path)
            and not (aria2_control_path and os.path.isfile(aria2_control_path))
            and os.path.getsize(dest_path) > 0
            and (total_size == 0 or os.path.getsize(dest_path) >= total_size)
        ):
            # Already completed prior to reboot/shutdown
            to_remove.append(download_id)
            continue

        # Incomplete / interrupted download -> restore to download_progress as paused
        file_bytes = (
            os.path.getsize(dest_path)
            if dest_path and os.path.isfile(dest_path)
            else int(record.get("downloaded") or 0)
        )
        progress_pct = int((file_bytes / total_size) * 100) if total_size > 0 else 0

        with download_lock:
            if download_id not in download_progress:
                filename = record.get("filename") or (
                    os.path.basename(dest_path) if dest_path else "model"
                )
                directory = record.get("directory") or (
                    os.path.dirname(dest_path) if dest_path else ""
                )
                download_progress[download_id] = {
                    "status": "paused",
                    "progress": max(0, min(progress_pct, 100)),
                    "total_size": total_size,
                    "downloaded": file_bytes,
                    "filename": filename,
                    "path": dest_path,
                    "directory": directory,
                    "url": record.get("url") or "",
                    "download_backend": record.get("download_backend", "aria2"),
                    "start_time": record.get("created_at") or time.time(),
                    "speed": 0,
                    "error": None,
                    "interrupted": True,
                }
                restored_count += 1

    for remove_id in to_remove:
        remove_persisted_download(remove_id, state_file=state_file)

    if restored_count > 0:
        logger = log_fn or log
        logger.info(
            f"Restored {restored_count} interrupted download(s) from persistent state."
        )

    return restored_count

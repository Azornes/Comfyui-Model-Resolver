"""
Local metadata sidecar creation and repair helpers.

This module intentionally uses only local model files and safetensors headers.
It does not call remote providers.
"""

import os
import threading
import time
from collections.abc import Iterable
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional, Tuple

from .log_system import create_module_logger
from .metadata_model_utils import dedupe_models, is_model_file_path
from .metadata_utils import build_sidecar_file_identity, merge_counted_payload
from .path_utils import (
    HashCalculationCancelled,
    calculate_file_sha256,
    extract_safetensors_header_metadata,
    find_external_metadata_sidecar_path,
    get_filename_from_path,
    get_model_path_identity,
    get_model_resolver_sidecar_path,
    normalize_metadata_file_path,
    read_json_safe,
    read_safetensors_header,
    write_json_atomic,
)
from .type_utils import (
    extract_sha256_from_metadata,
    format_size_bytes,
    normalize_category_to_model_type,
    normalize_sha256,
)
from .worker_utils import resolve_worker_count

log = create_module_logger(__name__)

ProgressCallback = Callable[[Dict[str, Any]], None]
CancelCallback = Callable[[], bool]

LOCAL_HEADER_MAX_KEYS = 300
LOCAL_HEADER_MAX_LIST_ITEMS = 64
LOCAL_HEADER_MAX_CHARS = 20000
MIN_METADATA_BUILD_WORKERS = 1
MAX_METADATA_BUILD_WORKERS = 64
DEFAULT_METADATA_BUILD_WORKER_LIMIT = 4
METADATA_BUILD_MODE_CALCULATE_FRESH = "calculate_fresh"
METADATA_BUILD_MODE_IMPORT_EXISTING = "import_existing"
METADATA_BUILD_MODES = {
    METADATA_BUILD_MODE_CALCULATE_FRESH,
    METADATA_BUILD_MODE_IMPORT_EXISTING,
}


def _select_metadata_path(model_path: str) -> Tuple[str, str, bool]:
    target_path = get_model_resolver_sidecar_path(model_path)
    target_exists = os.path.isfile(target_path)
    return target_path, target_path if target_exists else "", target_exists


def get_metadata_build_capabilities() -> Dict[str, Any]:
    """Return local concurrency limits for the metadata builder UI."""
    default_worker_count, cpu_count = resolve_worker_count(
        0,
        default_worker_limit=DEFAULT_METADATA_BUILD_WORKER_LIMIT,
        minimum_workers=MIN_METADATA_BUILD_WORKERS,
        maximum_workers=MAX_METADATA_BUILD_WORKERS,
    )
    return {
        "success": True,
        "cpu_count": cpu_count,
        "default_worker_count": default_worker_count,
        "min_worker_count": MIN_METADATA_BUILD_WORKERS,
        "max_worker_count": MAX_METADATA_BUILD_WORKERS,
        "default_metadata_mode": METADATA_BUILD_MODE_CALCULATE_FRESH,
        "metadata_modes": [
            {
                "value": METADATA_BUILD_MODE_CALCULATE_FRESH,
                "label": "Calculate SHA-256 from scratch",
            },
            {
                "value": METADATA_BUILD_MODE_IMPORT_EXISTING,
                "label": "Use existing plugin metadata",
            },
        ],
    }


def normalize_metadata_build_mode(value: Any) -> str:
    """Return a supported metadata builder source mode."""
    normalized = str(value or "").strip().lower()
    if normalized in METADATA_BUILD_MODES:
        return normalized
    return METADATA_BUILD_MODE_CALCULATE_FRESH


def _trusted_external_sha256(metadata: Dict[str, Any]) -> str:
    hash_status = str(metadata.get("hash_status") or "").strip().lower()
    if hash_status and hash_status != "completed":
        return ""
    return normalize_sha256(extract_sha256_from_metadata(metadata))


def _build_external_metadata_seed(
    model_path: str,
    model: Dict[str, Any],
) -> Tuple[Dict[str, Any], str, str]:
    external_path = find_external_metadata_sidecar_path(model_path)
    if not external_path:
        return {}, "", ""

    external_raw = read_json_safe(external_path, {})
    if not isinstance(external_raw, dict) or not external_raw:
        return {}, external_path, ""

    from .download.metadata import build_model_resolver_metadata

    trusted_sha256 = _trusted_external_sha256(external_raw)
    seed = build_model_resolver_metadata(
        model_path,
        external_raw,
        str(model.get("category") or ""),
    )
    if trusted_sha256:
        seed["sha256"] = trusted_sha256
        seed["hash_status"] = "completed"
    else:
        seed.pop("sha256", None)
        seed.pop("hash", None)
        seed.pop("hashes", None)
        seed["hash_status"] = "pending"
    seed["imported_from"] = external_path.replace(os.sep, "/")
    seed["metadata_build_mode"] = METADATA_BUILD_MODE_IMPORT_EXISTING
    return seed, external_path, trusted_sha256


def _limited_local_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 5:
        return str(value)[:LOCAL_HEADER_MAX_CHARS]
    if isinstance(value, str):
        text = value.strip()
        return text[:LOCAL_HEADER_MAX_CHARS].rstrip() if len(text) > LOCAL_HEADER_MAX_CHARS else text
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, dict):
        limited: Dict[str, Any] = {}
        for index, key in enumerate(sorted(value.keys(), key=lambda item: str(item).lower())):
            if index >= LOCAL_HEADER_MAX_KEYS:
                limited["_truncated"] = True
                break
            limited[str(key)] = _limited_local_value(value.get(key), depth=depth + 1)
        return limited
    if isinstance(value, (list, tuple, set)):
        items = list(value)
        limited_list = [
            _limited_local_value(item, depth=depth + 1)
            for item in items[:LOCAL_HEADER_MAX_LIST_ITEMS]
        ]
        if len(items) > LOCAL_HEADER_MAX_LIST_ITEMS:
            limited_list.append({"_truncated": True})
        return limited_list
    return str(value)[:LOCAL_HEADER_MAX_CHARS]


def extract_local_header_snapshot(model_path: str) -> Dict[str, Any]:
    """Return a compact snapshot of safetensors __metadata__ values."""
    header_json = read_safetensors_header(model_path)
    if not isinstance(header_json, dict):
        return {}

    metadata = header_json.get("__metadata__")
    if not isinstance(metadata, dict) or not metadata:
        return {}

    keys = sorted(str(key) for key in metadata)
    limited_metadata = {}
    for key in keys[:LOCAL_HEADER_MAX_KEYS]:
        limited_metadata[key] = _limited_local_value(metadata.get(key))

    snapshot: Dict[str, Any] = {
        "source": "safetensors_header",
        "metadata_keys": keys[:LOCAL_HEADER_MAX_KEYS],
        "metadata": limited_metadata,
    }
    if len(keys) > LOCAL_HEADER_MAX_KEYS:
        snapshot["truncated"] = True
        snapshot["total_metadata_keys"] = len(keys)
    return snapshot


def _is_empty_value(value: Any) -> bool:
    return value in (None, "", [], {})


def _set_if_missing(target: Dict[str, Any], key: str, value: Any) -> bool:
    if _is_empty_value(value) or not _is_empty_value(target.get(key)):
        return False
    target[key] = value
    return True


def _merge_unique_strings(*values: Any) -> List[str]:
    result: List[str] = []
    seen = set()

    def collect(value: Any) -> None:
        if value in (None, ""):
            return
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",")]
        elif isinstance(value, Iterable) and not isinstance(value, (dict, bytes, bytearray)):
            items = list(value)
        else:
            items = [value]
        for item in items:
            text = str(item or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(text)

    for value in values:
        collect(value)
    return result


def _model_type_for_category(category: str) -> str:
    model_type = normalize_category_to_model_type(category)
    return model_type if model_type and model_type != "unknown" else ""


def _build_local_metadata_payload(
    *,
    existing: Dict[str, Any],
    model: Dict[str, Any],
    model_path: str,
    metadata_path: str,
    file_size: int,
    header_metadata: Dict[str, Any],
    header_snapshot: Dict[str, Any],
    sha256: str,
    sha256_source: str,
) -> Tuple[Dict[str, Any], List[str]]:
    filename = get_filename_from_path(model_path)
    stem = os.path.splitext(filename)[0]
    category = str(model.get("category") or "")
    now = time.time()
    payload = dict(existing or {})
    changed_fields: List[str] = []

    def mark_set(key: str, value: Any, *, force: bool = False) -> None:
        if _is_empty_value(value):
            return
        if force or payload.get(key) != value:
            payload[key] = value
            changed_fields.append(key)

    def fill(key: str, value: Any) -> None:
        if _set_if_missing(payload, key, value):
            changed_fields.append(key)

    identity = build_sidecar_file_identity(
        model_path,
        model_name=header_metadata.get("model_name") or stem,
        size=file_size,
        modified_at=now,
        last_checked_at=now,
    )
    mark_set("schema", identity["schema"], force=True)
    mark_set("schema_version", identity["schema_version"], force=True)
    mark_set("managed_by", identity["managed_by"], force=True)
    mark_set("file_name", identity["file_name"], force=_is_empty_value(payload.get("file_name")))
    fill("filename", identity["filename"])
    fill("model_name", identity["model_name"])
    mark_set("file_path", identity["file_path"], force=True)
    mark_set("size", identity["size"], force=True)
    mark_set("modified", identity["modified"], force=True)
    mark_set("last_checked_at", identity["last_checked_at"], force=True)

    if category:
        fill("category", category)
    model_type = str(header_metadata.get("model_type") or _model_type_for_category(category) or "")
    if model_type:
        fill("model_type", model_type)
        fill("sub_type", model_type)

    fill("base_model", header_metadata.get("base_model") or "Unknown")
    for key in (
        "base_model_source",
        "base_model_inferred",
        "base_model_raw",
        "description",
        "model_description",
        "license",
        "usage_hint",
        "usage_tips",
        "preview_url",
        "preview_nsfw_level",
        "clip_skip",
        "metadata_summary",
        "header_metadata_keys",
    ):
        fill(key, header_metadata.get(key))

    if header_metadata.get("description") and _is_empty_value(payload.get("modelDescription")):
        mark_set("modelDescription", str(header_metadata.get("description")))

    if header_metadata.get("creator"):
        fill("creator", header_metadata.get("creator"))
    elif header_metadata.get("author"):
        fill(
            "creator",
            {
                "username": str(header_metadata.get("author")),
                "name": str(header_metadata.get("author")),
            },
        )
    fill("author", header_metadata.get("author"))

    tags = _merge_unique_strings(payload.get("tags"), header_metadata.get("tags"))
    if tags and tags != payload.get("tags"):
        payload["tags"] = tags
        changed_fields.append("tags")

    trained_words = _merge_unique_strings(
        payload.get("trained_words"),
        payload.get("trainedWords"),
        header_metadata.get("trained_words"),
    )
    if trained_words:
        if trained_words != payload.get("trained_words"):
            payload["trained_words"] = trained_words
            changed_fields.append("trained_words")
        if _is_empty_value(payload.get("trainedWords")):
            payload["trainedWords"] = trained_words
            changed_fields.append("trainedWords")

    if header_metadata.get("images") and _is_empty_value(payload.get("images")):
        mark_set("images", header_metadata.get("images"))

    if header_snapshot:
        fill("safetensors_header_metadata", header_snapshot)

    if sha256:
        hashes = payload.get("hashes")
        if not isinstance(hashes, dict):
            hashes = {}
        if hashes.get("SHA256") != sha256:
            hashes["SHA256"] = sha256
            changed_fields.append("hashes")
        mark_set("sha256", sha256, force=True)
        fill("hash", sha256)
        mark_set("hashes", hashes, force=True)
        mark_set("hash_status", "completed", force=True)
        mark_set("sha256_source", sha256_source or "file", force=True)
    else:
        fill("hash_status", "pending")

    fill("source", "local")
    fill("details_source", "local")
    fill("metadata_source", header_metadata.get("metadata_source") or "local_file")
    if header_metadata.get("from_safetensors_header"):
        mark_set("from_safetensors_header", True, force=True)
        mark_set("local_metadata_available", True, force=True)
    elif header_snapshot:
        mark_set("local_metadata_available", True, force=True)

    fill("preview_nsfw_level", 0)
    mark_set("metadata_path", normalize_metadata_file_path(metadata_path), force=True)
    return payload, sorted(set(changed_fields))


def _emit(progress_callback: Optional[ProgressCallback], payload: Dict[str, Any]) -> None:
    if not progress_callback:
        return
    try:
        progress_callback(payload)
    except Exception:
        log.debug("Metadata builder progress callback failed", exc_info=True)


def _progress_percent(current: int, total: int, current_file_ratio: float = 0.0) -> float:
    if total <= 0:
        return 0.0
    current_file_ratio = max(0.0, min(1.0, current_file_ratio))
    return min(99.0, ((max(0, current - 1) + current_file_ratio) / total) * 100.0)


def _empty_build_counts() -> Dict[str, Any]:
    return {
        "scanned_models": 0,
        "created_metadata": 0,
        "updated_metadata": 0,
        "skipped_complete": 0,
        "header_hashes": 0,
        "calculated_hashes": 0,
        "header_metadata_count": 0,
        "invalid_metadata": 0,
        "errors": [],
        "updated": [],
        "history": [],
    }


_BUILD_COUNT_KEYS = (
    "scanned_models",
    "created_metadata",
    "updated_metadata",
    "skipped_complete",
    "header_hashes",
    "calculated_hashes",
    "header_metadata_count",
    "invalid_metadata",
)
_BUILD_LIST_KEYS = ("errors", "updated", "history")


def _build_result_payload(
    counts: Dict[str, Any],
    *,
    success: bool,
    cancelled: bool,
    total_models: int,
    worker_count: int,
    cpu_count: int,
    include_updated_count: bool = True,
) -> Dict[str, Any]:
    errors = counts.get("errors") or []
    updated = counts.get("updated") or []
    history = counts.get("history") or []
    result = {
        "success": success,
        "cancelled": cancelled,
        "scanned_models": counts.get("scanned_models", 0),
        "total_models": total_models,
        "created_metadata": counts.get("created_metadata", 0),
        "updated_metadata": counts.get("updated_metadata", 0),
        "skipped_complete": counts.get("skipped_complete", 0),
        "header_hashes": counts.get("header_hashes", 0),
        "calculated_hashes": counts.get("calculated_hashes", 0),
        "header_metadata_count": counts.get("header_metadata_count", 0),
        "invalid_metadata": counts.get("invalid_metadata", 0),
        "worker_count": worker_count,
        "cpu_count": cpu_count,
        "error_count": len(errors),
        "errors": errors[:50],
        "updated": updated[:200],
        "history": history,
        "history_count": len(history),
    }
    if include_updated_count:
        result["updated_count"] = len(updated)
    return result


def _build_metadata_history_item(
    model: Dict[str, Any],
    *,
    action: str,
    filename: str,
    relative_path: str,
    model_path: str,
    metadata_path: str,
    file_size: int,
    sha256: str,
    sha256_source: str,
    metadata_mode: str,
    message: Optional[str] = None,
    imported_from: Optional[str] = None,
    changed_fields: Optional[List[str]] = None,
) -> Dict[str, Any]:
    item = {
        "action": action,
        "filename": filename,
        "relative_path": relative_path,
        "category": model.get("category") or "",
        "base_directory": model.get("base_directory") or "",
        "model_path": model_path,
        "metadata_path": metadata_path,
        "size": file_size,
        "size_label": format_size_bytes(file_size),
        "sha256": sha256,
        "sha256_source": sha256_source,
        "metadata_mode": metadata_mode,
    }
    if message is not None:
        item["message"] = message
    if imported_from is not None:
        item["imported_from"] = imported_from
    if changed_fields is not None:
        item["changed_fields"] = changed_fields
    return item


def _history_items_for_model(model: Dict[str, Any], result: Dict[str, Any]) -> List[Dict[str, Any]]:
    updated_items = result.get("updated") or []
    if updated_items:
        return [dict(item) for item in updated_items if isinstance(item, dict)]

    filename = get_filename_from_path(str(model.get("path") or "")) or str(model.get("filename") or "Model")
    model_path = str(model.get("path") or "").strip()
    metadata_path = get_model_resolver_sidecar_path(model_path) if model_path else ""
    base_item = {
        "filename": filename,
        "relative_path": model.get("relative_path") or filename,
        "category": model.get("category") or "",
        "base_directory": model.get("base_directory") or "",
        "model_path": model_path,
        "metadata_path": metadata_path,
    }

    errors = result.get("errors") or []
    if errors:
        return [
            {
                **base_item,
                **item,
                "action": "error",
                "message": item.get("message") or "Metadata build failed.",
            }
            for item in errors
            if isinstance(item, dict)
        ]

    if result.get("cancelled"):
        return [{**base_item, "action": "cancelled", "message": "Cancelled"}]

    if int(result.get("skipped_complete") or 0) > 0:
        return [{**base_item, "action": "skipped", "message": "Already had SHA256"}]

    return [{**base_item, "action": "checked", "message": "Checked"}]


def _build_missing_local_metadata_parallel(
    model_items: List[Dict[str, Any]],
    *,
    worker_count: int,
    cpu_count: int,
    metadata_mode: str,
    progress_callback: Optional[ProgressCallback] = None,
    is_cancelled: Optional[CancelCallback] = None,
) -> Dict[str, Any]:
    total = len(model_items)
    counts = _empty_build_counts()
    state_lock = threading.Lock()
    active_models: Dict[str, Dict[str, Any]] = {}
    completed = 0
    cancelled = False

    def progress_percent_unlocked() -> float:
        if total <= 0:
            return 100.0
        active_ratio = sum(float(item.get("ratio") or 0.0) for item in active_models.values())
        return min(99.0, ((completed + active_ratio) / total) * 100.0)

    def emit_parallel_progress(stage: str, message: str, payload: Optional[Dict[str, Any]] = None) -> None:
        data = payload or {}
        with state_lock:
            active_list = [
                {
                    "filename": item.get("filename") or "",
                    "path": item.get("path") or "",
                    "stage": item.get("stage") or "",
                    "percent": max(0.0, min(99.0, float(item.get("ratio") or 0.0) * 100.0)),
                    "bytes_read": item.get("bytes_read") or 0,
                    "total_bytes": item.get("total_bytes") or 0,
                }
                for item in active_models.values()
            ][:worker_count]
            snapshot = {
                "stage": stage,
                "message": message,
                "current": completed,
                "total": total,
                "percent": progress_percent_unlocked(),
                "worker_count": worker_count,
                "cpu_count": cpu_count,
                "active_models": active_list,
                "active_worker_count": len(active_models),
                "created_metadata": counts["created_metadata"],
                "updated_metadata": counts["updated_metadata"],
                "skipped_complete": counts["skipped_complete"],
                "calculated_hashes": counts["calculated_hashes"],
                "header_hashes": counts["header_hashes"],
                "error_count": len(counts["errors"]),
            }
            if active_list:
                first_active = active_list[0]
                snapshot["current_model"] = first_active.get("filename") or ""
                snapshot["current_path"] = first_active.get("path") or ""
                snapshot["bytes_read"] = first_active.get("bytes_read") or 0
                snapshot["total_bytes"] = first_active.get("total_bytes") or 0
            snapshot.update(data)
        _emit(progress_callback, snapshot)

    def run_one_model(model: Dict[str, Any]) -> Dict[str, Any]:
        model_path = str(model.get("path") or "").strip()
        filename = get_filename_from_path(model_path)
        model_key = get_model_path_identity(model.get("path")) or model_path

        def child_progress(data: Dict[str, Any]) -> None:
            if not isinstance(data, dict):
                return
            stage = str(data.get("stage") or "running")
            child_status = str(data.get("status") or "").lower()
            child_percent = max(0.0, min(100.0, float(data.get("percent") or 0.0)))
            with state_lock:
                if stage in {"done", "model_done"} or child_status in {"done", "cancelled"}:
                    active_models.pop(model_key, None)
                else:
                    active_models[model_key] = {
                        "filename": filename,
                        "path": model_path,
                        "stage": stage,
                        "ratio": min(0.99, child_percent / 100.0),
                        "bytes_read": data.get("bytes_read") or 0,
                        "total_bytes": data.get("total_bytes") or 0,
                    }
            if stage == "done" or child_status == "done":
                return
            emit_parallel_progress(stage, data.get("message") or f"Processing {filename}")

        return build_missing_local_metadata(
            models=[model],
            force_rescan=False,
            worker_count=1,
            metadata_mode=metadata_mode,
            progress_callback=child_progress,
            is_cancelled=is_cancelled,
        )

    _emit(
        progress_callback,
        {
            "stage": "scanning",
            "message": f"Found {total} local model files.",
            "current": 0,
            "total": total,
            "percent": 0,
            "worker_count": worker_count,
            "cpu_count": cpu_count,
        },
    )

    executor = ThreadPoolExecutor(max_workers=worker_count)
    futures = {executor.submit(run_one_model, model): model for model in model_items}
    try:
        for future in as_completed(futures):
            model = futures[future]
            model_path = str(model.get("path") or "").strip()
            filename = get_filename_from_path(model_path)
            model_key = get_model_path_identity(model.get("path")) or model_path
            try:
                item_result = future.result()
            except CancelledError:
                item_result = {"success": False, "cancelled": True}
            except Exception as exc:
                log.warning(f"Could not build local metadata for {model_path}: {exc}", exc_info=True)
                item_result = {
                    "success": False,
                    "errors": [
                        {
                            "filename": filename,
                            "relative_path": model.get("relative_path") or filename,
                            "model_path": model_path,
                            "metadata_path": get_model_resolver_sidecar_path(model_path),
                            "message": str(exc) or "Metadata build failed.",
                        }
                    ],
                }
            history_items = item_result.get("history") or _history_items_for_model(model, item_result)
            if "history" not in item_result:
                item_result["history"] = history_items

            with state_lock:
                completed += 1
                active_models.pop(model_key, None)
                if item_result.get("cancelled"):
                    cancelled = True
                merge_counted_payload(
                    counts,
                    item_result,
                    numeric_keys=_BUILD_COUNT_KEYS,
                    list_keys=_BUILD_LIST_KEYS,
                )

            emit_parallel_progress(
                "model_done",
                f"Processed {filename}",
                {
                    "current_model": filename,
                    "current_path": model_path,
                    "current": completed,
                    "history_items": history_items,
                },
            )

            if is_cancelled and is_cancelled():
                cancelled = True
                for pending in futures:
                    if not pending.done():
                        pending.cancel()
    finally:
        executor.shutdown(wait=True, cancel_futures=True)

    result = _build_result_payload(
        counts,
        success=not cancelled,
        cancelled=cancelled,
        total_models=total,
        worker_count=worker_count,
        cpu_count=cpu_count,
    )
    result["metadata_mode"] = metadata_mode
    _emit(
        progress_callback,
        {
            "stage": "cancelled" if cancelled else "done",
            "message": "Metadata build cancelled" if cancelled else "Local metadata build completed.",
            "status": "cancelled" if cancelled else "done",
            "current": completed,
            "total": total,
            "percent": 100,
            "active_models": [],
            "active_worker_count": 0,
            "current_model": "",
            "current_path": "",
            "bytes_read": 0,
            "total_bytes": 0,
            **result,
        },
    )
    return result


def build_missing_local_metadata(
    models: Optional[List[Dict[str, Any]]] = None,
    *,
    force_rescan: bool = True,
    worker_count: Optional[int] = None,
    metadata_mode: str = METADATA_BUILD_MODE_CALCULATE_FRESH,
    progress_callback: Optional[ProgressCallback] = None,
    is_cancelled: Optional[CancelCallback] = None,
) -> Dict[str, Any]:
    """
    Create missing sidecar metadata files and add missing SHA256 values.

    Existing Model Resolver sidecars are preserved and filled with local
    technical values when missing. External sidecars are never modified.
    No remote metadata providers are used.
    """
    metadata_mode = normalize_metadata_build_mode(metadata_mode)

    if models is None:
        from .scanner import get_model_files

        models = get_model_files(force_rescan=force_rescan)

    all_models = dedupe_models(models or [])
    model_items = [
        model for model in all_models
        if is_model_file_path(str(model.get("path") or "").strip())
    ]
    total = len(model_items)
    resolved_worker_count, cpu_count = resolve_worker_count(
        total,
        worker_count,
        default_worker_limit=DEFAULT_METADATA_BUILD_WORKER_LIMIT,
        minimum_workers=MIN_METADATA_BUILD_WORKERS,
        maximum_workers=MAX_METADATA_BUILD_WORKERS,
    )
    if resolved_worker_count > 1:
        return _build_missing_local_metadata_parallel(
            model_items,
            worker_count=resolved_worker_count,
            cpu_count=cpu_count,
            metadata_mode=metadata_mode,
            progress_callback=progress_callback,
            is_cancelled=is_cancelled,
        )

    scanned_models = 0
    created_metadata = 0
    updated_metadata = 0
    skipped_complete = 0
    header_hashes = 0
    calculated_hashes = 0
    header_metadata_count = 0
    invalid_metadata = 0
    errors: List[Dict[str, Any]] = []
    updated: List[Dict[str, Any]] = []
    history: List[Dict[str, Any]] = []

    def build_sequential_result(
        *,
        success: bool,
        cancelled: bool,
        include_updated_count: bool,
        include_metadata_mode: bool = False,
    ) -> Dict[str, Any]:
        result = _build_result_payload(
            {
                "scanned_models": scanned_models,
                "created_metadata": created_metadata,
                "updated_metadata": updated_metadata,
                "skipped_complete": skipped_complete,
                "header_hashes": header_hashes,
                "calculated_hashes": calculated_hashes,
                "header_metadata_count": header_metadata_count,
                "invalid_metadata": invalid_metadata,
                "errors": errors,
                "updated": updated,
                "history": history,
            },
            success=success,
            cancelled=cancelled,
            total_models=total,
            worker_count=resolved_worker_count,
            cpu_count=cpu_count,
            include_updated_count=include_updated_count,
        )
        if include_metadata_mode:
            result["metadata_mode"] = metadata_mode
        return result

    _emit(
        progress_callback,
        {
            "stage": "scanning",
            "message": f"Found {total} local model files.",
            "current": 0,
            "total": total,
            "percent": 0,
            "worker_count": resolved_worker_count,
            "cpu_count": cpu_count,
        },
    )

    for index, model in enumerate(model_items, start=1):
        if is_cancelled and is_cancelled():
            _emit(
                progress_callback,
                {
                    "stage": "cancelled",
                    "message": "Metadata build cancelled",
                    "status": "cancelled",
                    "current": index - 1,
                    "total": total,
                    "percent": _progress_percent(index, total),
                },
            )
            return build_sequential_result(
                success=False,
                cancelled=True,
                include_updated_count=False,
            )

        model_path = str(model.get("path") or "").strip()
        filename = get_filename_from_path(model_path)
        relative_path = model.get("relative_path") or filename
        metadata_path, existing_metadata_path, metadata_exists = _select_metadata_path(model_path)
        scanned_models += 1

        _emit(
            progress_callback,
            {
                "stage": "header",
                "message": f"Reading local metadata: {filename}",
                "current": index,
                "total": total,
                "percent": _progress_percent(index, total, 0.1),
                "current_model": filename,
                "current_path": model_path,
                "metadata_path": metadata_path,
            },
        )

        try:
            file_size = os.path.getsize(model_path)
            existing_raw = (
                read_json_safe(existing_metadata_path, {})
                if existing_metadata_path
                else {}
            )
            if not isinstance(existing_raw, dict):
                existing_raw = {}
                invalid_metadata += 1

            existing_sha256 = normalize_sha256(
                extract_sha256_from_metadata(existing_raw)
            )
            if metadata_exists and existing_sha256:
                skipped_complete += 1
                history_item = _build_metadata_history_item(
                    model,
                    action="skipped",
                    filename=filename,
                    relative_path=relative_path,
                    model_path=model_path,
                    metadata_path=metadata_path,
                    file_size=file_size,
                    sha256=existing_sha256,
                    sha256_source="existing_metadata",
                    metadata_mode=metadata_mode,
                    message="Already had SHA256",
                )
                history.append(history_item)
                _emit(
                    progress_callback,
                    {
                        "stage": "model_done",
                        "message": f"Metadata already has SHA256: {filename}",
                        "current": index,
                        "total": total,
                        "percent": _progress_percent(index, total, 1.0),
                        "current_model": filename,
                        "current_path": model_path,
                        "metadata_path": metadata_path,
                        "created_metadata": created_metadata,
                        "updated_metadata": updated_metadata,
                        "skipped_complete": skipped_complete,
                        "calculated_hashes": calculated_hashes,
                        "header_hashes": header_hashes,
                        "error_count": len(errors),
                        "history_items": [history_item],
                    },
                )
                continue

            external_metadata_path = ""
            external_sha256 = ""
            if metadata_mode == METADATA_BUILD_MODE_IMPORT_EXISTING:
                (
                    external_seed,
                    external_metadata_path,
                    external_sha256,
                ) = _build_external_metadata_seed(model_path, model)
                if external_seed:
                    existing_raw = {**external_seed, **existing_raw}
                    existing_sha256 = normalize_sha256(
                        extract_sha256_from_metadata(existing_raw)
                    )

            header_metadata = extract_safetensors_header_metadata(model_path)
            header_snapshot = extract_local_header_snapshot(model_path)
            if header_metadata or header_snapshot:
                header_metadata_count += 1

            allow_header_sha256 = (
                metadata_mode != METADATA_BUILD_MODE_CALCULATE_FRESH
            )
            header_sha256 = (
                normalize_sha256(header_metadata.get("sha256"))
                if allow_header_sha256
                else ""
            )
            sha256 = existing_sha256 or header_sha256
            if external_sha256 and sha256 == external_sha256:
                sha256_source = "external_metadata"
            else:
                sha256_source = "existing_metadata" if existing_sha256 else ""
            if sha256 and not existing_sha256:
                sha256_source = str(header_metadata.get("sha256_source") or "safetensors_header")
                header_hashes += 1

            if not sha256:
                _emit(
                    progress_callback,
                    {
                        "stage": "hashing",
                        "message": f"Calculating SHA256: {filename}",
                        "current": index,
                        "total": total,
                        "percent": _progress_percent(index, total, 0.35),
                        "current_model": filename,
                        "current_path": model_path,
                        "metadata_path": metadata_path,
                        "bytes_read": 0,
                        "total_bytes": file_size,
                    },
                )
                last_progress_at = [0.0]

                def on_hash_progress(bytes_read: int, total_bytes: int) -> None:
                    now = time.time()
                    if now - last_progress_at[0] < 0.2 and bytes_read < total_bytes:
                        return
                    ratio = 0.35
                    if total_bytes > 0:
                        ratio = 0.35 + (min(1.0, bytes_read / total_bytes) * 0.55)
                    _emit(
                        progress_callback,
                        {
                            "stage": "hashing",
                            "message": f"Calculating SHA256: {filename}",
                            "current": index,
                            "total": total,
                            "percent": _progress_percent(index, total, ratio),
                            "current_model": filename,
                            "current_path": model_path,
                            "metadata_path": metadata_path,
                            "bytes_read": bytes_read,
                            "total_bytes": total_bytes,
                        },
                    )
                    last_progress_at[0] = now

                hash_source = [""]

                def on_hash_source(source: str) -> None:
                    hash_source[0] = source or "file"

                sha256 = calculate_file_sha256(
                    model_path,
                    chunk_size=1024 * 1024 * 4,
                    on_progress=on_hash_progress,
                    is_cancelled=is_cancelled,
                    use_safetensors_header=allow_header_sha256,
                    on_hash_source=on_hash_source,
                ) or ""
                sha256 = normalize_sha256(sha256)
                sha256_source = hash_source[0] or "file"
                if sha256_source == "safetensors_header":
                    header_hashes += 1
                elif sha256:
                    calculated_hashes += 1

            _emit(
                progress_callback,
                {
                    "stage": "writing",
                    "message": f"Writing metadata: {filename}",
                    "current": index,
                    "total": total,
                    "percent": _progress_percent(index, total, 0.95),
                    "current_model": filename,
                    "current_path": model_path,
                    "metadata_path": metadata_path,
                },
            )

            payload, changed_fields = _build_local_metadata_payload(
                existing=existing_raw,
                model=model,
                model_path=model_path,
                metadata_path=metadata_path,
                file_size=file_size,
                header_metadata=header_metadata,
                header_snapshot=header_snapshot,
                sha256=sha256,
                sha256_source=sha256_source,
            )
            if external_metadata_path:
                payload["imported_from"] = external_metadata_path.replace(os.sep, "/")
            payload["metadata_build_mode"] = metadata_mode

            should_write = not metadata_exists or bool(changed_fields) or not existing_sha256
            history_item = None
            if should_write:
                write_json_atomic(metadata_path, payload, indent=2)
                action = "created" if not metadata_exists else "updated"
                if metadata_exists:
                    updated_metadata += 1
                else:
                    created_metadata += 1
                history_item = _build_metadata_history_item(
                    model,
                    action=action,
                    filename=filename,
                    relative_path=relative_path,
                    model_path=model_path,
                    metadata_path=metadata_path,
                    file_size=file_size,
                    sha256=sha256,
                    sha256_source=sha256_source,
                    metadata_mode=metadata_mode,
                    imported_from=external_metadata_path,
                    changed_fields=changed_fields,
                )
                updated.append(history_item)
                history.append(history_item)
            else:
                skipped_complete += 1
                history_item = _build_metadata_history_item(
                    model,
                    action="skipped",
                    filename=filename,
                    relative_path=relative_path,
                    model_path=model_path,
                    metadata_path=metadata_path,
                    file_size=file_size,
                    sha256=sha256,
                    sha256_source=sha256_source,
                    metadata_mode=metadata_mode,
                    message="No changes needed",
                )
                history.append(history_item)

            _emit(
                progress_callback,
                {
                    "stage": "model_done",
                    "message": f"Processed {filename}",
                    "current": index,
                    "total": total,
                    "percent": _progress_percent(index, total, 1.0),
                    "current_model": filename,
                    "current_path": model_path,
                    "metadata_path": metadata_path,
                    "created_metadata": created_metadata,
                    "updated_metadata": updated_metadata,
                    "skipped_complete": skipped_complete,
                    "calculated_hashes": calculated_hashes,
                    "header_hashes": header_hashes,
                    "error_count": len(errors),
                    "history_items": [history_item] if history_item else [],
                },
            )
        except HashCalculationCancelled:
            _emit(
                progress_callback,
                {
                    "stage": "cancelled",
                    "message": "Metadata build cancelled",
                    "status": "cancelled",
                    "current": index - 1,
                    "total": total,
                    "percent": _progress_percent(index, total),
                    "current_model": filename,
                    "current_path": model_path,
                },
            )
            return build_sequential_result(
                success=False,
                cancelled=True,
                include_updated_count=False,
            )
        except Exception as exc:
            log.warning(f"Could not build local metadata for {model_path}: {exc}", exc_info=True)
            error_item = {
                "filename": filename,
                "relative_path": relative_path,
                "model_path": model_path,
                "metadata_path": metadata_path,
                "message": str(exc) or "Metadata build failed.",
            }
            errors.append(error_item)
            history_item = {
                **error_item,
                "action": "error",
                "category": model.get("category") or "",
                "base_directory": model.get("base_directory") or "",
            }
            history.append(history_item)
            _emit(
                progress_callback,
                {
                    "stage": "model_done",
                    "message": f"Error processing {filename}",
                    "current": index,
                    "total": total,
                    "percent": _progress_percent(index, total, 1.0),
                    "current_model": filename,
                    "current_path": model_path,
                    "metadata_path": metadata_path,
                    "error_count": len(errors),
                    "history_items": [history_item],
                },
            )

    result = build_sequential_result(
        success=True,
        cancelled=False,
        include_updated_count=True,
        include_metadata_mode=True,
    )
    _emit(
        progress_callback,
        {
            "stage": "done",
            "message": "Local metadata build completed.",
            "status": "done",
            "current": total,
            "total": total,
            "percent": 100,
            "active_models": [],
            "active_worker_count": 0,
            "current_model": "",
            "current_path": "",
            "bytes_read": 0,
            "total_bytes": 0,
            **result,
        },
    )
    skipped_only_noop = (
        skipped_complete > 0
        and created_metadata == 0
        and updated_metadata == 0
        and header_hashes == 0
        and calculated_hashes == 0
        and not errors
        and scanned_models == skipped_complete
    )
    if not skipped_only_noop:
        log.info(
            "Local metadata build finished: "
            f"models={scanned_models}, created={created_metadata}, updated={updated_metadata}, "
            f"skipped={skipped_complete}, header_hashes={header_hashes}, "
            f"calculated_hashes={calculated_hashes}, errors={len(errors)}"
        )
    return result

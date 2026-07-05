"""
Metadata maintenance helpers.

Provides audits for local model sidecar metadata files.
"""

import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .log_system import create_module_logger
from .path_utils import get_filename_from_path, get_path_identity, read_json_safe
from .type_utils import MODEL_EXTENSIONS, format_size_bytes

log = create_module_logger(__name__)


BYTE_SIZE_KEYS = ("size", "sizeBytes", "size_bytes", "fileSize", "file_size", "bytes")
KIB_SIZE_KEYS = ("sizeKB", "size_kb")
MAX_AUDIT_WORKERS = 64
MIN_AUDIT_WORKERS = 1
MIN_AUDIT_BATCH_SIZE = 16
MAX_AUDIT_BATCH_SIZE = 256


def _empty_audit_counts() -> Dict[str, Any]:
    return {
        "scanned_models": 0,
        "metadata_files": 0,
        "checked_metadata": 0,
        "missing_metadata": 0,
        "missing_size": 0,
        "invalid_metadata": 0,
        "skipped_directories": 0,
        "skipped_non_model_files": 0,
        "errors": [],
        "mismatches": [],
    }


def _coerce_size_bytes(value: Any, multiplier: int = 1) -> Optional[int]:
    if value is None or value == "" or isinstance(value, bool):
        return None

    try:
        if isinstance(value, str):
            text = value.strip().replace(",", "").replace("_", "")
            if not text or text.lower() in {"none", "null", "undefined"}:
                return None
            number = float(text)
        else:
            number = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(number) or number < 0:
        return None

    return int(number * multiplier)


def _iter_size_fields(data: Dict[str, Any], prefix: str = "") -> Iterable[Tuple[str, Any, int]]:
    for key in BYTE_SIZE_KEYS:
        if key in data:
            yield (f"{prefix}{key}", data.get(key), 1)
    for key in KIB_SIZE_KEYS:
        if key in data:
            yield (f"{prefix}{key}", data.get(key), 1024)


def _extract_size_from_object(data: Any, prefix: str = "") -> Optional[Tuple[int, str]]:
    if not isinstance(data, dict):
        return None

    for field_path, value, multiplier in _iter_size_fields(data, prefix):
        size = _coerce_size_bytes(value, multiplier=multiplier)
        if size is not None:
            return size, field_path

    return None


def _file_entry_matches_model(entry: Dict[str, Any], model_filename: str) -> bool:
    entry_name = get_filename_from_path(
        entry.get("name")
        or entry.get("filename")
        or entry.get("file_name")
        or entry.get("fileName")
        or ""
    ).lower()
    return bool(entry_name and entry_name == model_filename.lower())


def _select_file_entry(entries: Any, model_filename: str) -> Optional[Dict[str, Any]]:
    if not isinstance(entries, list):
        return None

    candidates = [entry for entry in entries if isinstance(entry, dict)]
    if not candidates:
        return None

    for entry in candidates:
        if _file_entry_matches_model(entry, model_filename):
            return entry

    for entry in candidates:
        if entry.get("primary") and str(entry.get("type") or "").lower() == "model":
            return entry

    for entry in candidates:
        if entry.get("primary"):
            return entry

    if len(candidates) == 1:
        return candidates[0]

    return None


def extract_metadata_size(metadata: Dict[str, Any], model_filename: str = "") -> Optional[Tuple[int, str]]:
    """
    Return the stored model size and the field path it came from.

    Top-level size is preferred because Model Resolver writes LoRA
    Manager-compatible sidecars with the authoritative value there.
    """
    top_level = _extract_size_from_object(metadata)
    if top_level:
        return top_level

    for key in ("file", "file_info", "selected_file", "selectedFile"):
        nested = metadata.get(key)
        found = _extract_size_from_object(nested, f"{key}.")
        if found:
            return found

    nested_sources = [
        ("files", metadata.get("files")),
        ("selected_version.files", (metadata.get("selected_version") or {}).get("files") if isinstance(metadata.get("selected_version"), dict) else None),
        ("selectedVersion.files", (metadata.get("selectedVersion") or {}).get("files") if isinstance(metadata.get("selectedVersion"), dict) else None),
        ("civitai.files", (metadata.get("civitai") or {}).get("files") if isinstance(metadata.get("civitai"), dict) else None),
    ]
    for prefix, entries in nested_sources:
        entry = _select_file_entry(entries, model_filename)
        found = _extract_size_from_object(entry, f"{prefix}[].")
        if found:
            return found

    return None


def _is_model_file_path(path: str) -> bool:
    if not path or not os.path.isfile(path):
        return False

    filename = get_filename_from_path(path).lower()
    if filename.endswith((".metadata.json", ".civitai.info")):
        return False

    return os.path.splitext(filename)[1].lower() in MODEL_EXTENSIONS


def _metadata_sidecar_paths(model_path: str) -> List[str]:
    directory = os.path.dirname(model_path)
    filename = get_filename_from_path(model_path)
    base_name = os.path.splitext(filename)[0]
    candidates = [
        os.path.join(directory, f"{base_name}.metadata.json"),
        os.path.join(directory, f"{filename}.metadata.json"),
    ]

    result: List[str] = []
    seen = set()
    for candidate in candidates:
        try:
            key = os.path.normcase(os.path.abspath(candidate))
        except (OSError, ValueError):
            key = os.path.normcase(candidate)
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
    return result


def _format_signed_size(bytes_value: int) -> str:
    if bytes_value == 0:
        return "0 B"
    sign = "+" if bytes_value > 0 else "-"
    return f"{sign}{format_size_bytes(abs(bytes_value))}"


def _model_key(model_path: str, metadata_path: str) -> Tuple[str, str]:
    try:
        model_identity = get_path_identity(model_path)
    except (OSError, ValueError):
        model_identity = os.path.normcase(os.path.abspath(model_path))
    try:
        metadata_identity = get_path_identity(metadata_path)
    except (OSError, ValueError):
        metadata_identity = os.path.normcase(os.path.abspath(metadata_path))
    return model_identity, metadata_identity


def _model_identity_key(model: Dict[str, Any]) -> str:
    model_path = str(model.get("path") or "").strip()
    if not model_path:
        return ""
    try:
        return get_path_identity(model_path)
    except (OSError, ValueError):
        try:
            return os.path.normcase(os.path.abspath(model_path))
        except (OSError, ValueError):
            return os.path.normcase(model_path)


def _dedupe_models(models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    seen = set()
    for model in models or []:
        if not isinstance(model, dict):
            continue
        identity = _model_identity_key(model)
        if not identity:
            continue
        if identity in seen:
            continue
        seen.add(identity)
        result.append(model)
    return result


def _get_worker_count(total_models: int, requested_workers: Optional[int] = None) -> Tuple[int, int]:
    cpu_count = os.cpu_count() or 4
    if requested_workers is not None:
        try:
            workers = int(requested_workers)
        except (TypeError, ValueError):
            workers = 0
        if workers > 0:
            return min(total_models or 1, max(MIN_AUDIT_WORKERS, min(workers, MAX_AUDIT_WORKERS))), cpu_count

    # The audit is mostly disk I/O plus small JSON parsing, so a few workers per
    # CPU core keeps the drive busy without creating an unbounded thread swarm.
    workers = max(MIN_AUDIT_WORKERS, min(MAX_AUDIT_WORKERS, cpu_count * 4))
    return min(total_models or 1, workers), cpu_count


def _get_batch_size(
    total_models: int,
    worker_count: int,
    requested_batch_size: Optional[int] = None,
) -> int:
    if requested_batch_size is not None:
        try:
            batch_size = int(requested_batch_size)
        except (TypeError, ValueError):
            batch_size = 0
        if batch_size > 0:
            return max(1, batch_size)

    if total_models <= 0:
        return MIN_AUDIT_BATCH_SIZE

    target_batches = max(1, worker_count * 4)
    batch_size = math.ceil(total_models / target_batches)
    return max(MIN_AUDIT_BATCH_SIZE, min(MAX_AUDIT_BATCH_SIZE, batch_size))


def _make_batches(models: List[Dict[str, Any]], batch_size: int) -> List[List[Dict[str, Any]]]:
    if not models:
        return []
    safe_batch_size = max(1, int(batch_size or 1))
    return [
        models[index:index + safe_batch_size]
        for index in range(0, len(models), safe_batch_size)
    ]


def _audit_one_model(model: Dict[str, Any]) -> Dict[str, Any]:
    result = _empty_audit_counts()
    model_path = str(model.get("path") or "").strip()
    if not model_path:
        return result

    if os.path.isdir(model_path):
        result["skipped_directories"] += 1
        return result

    if not _is_model_file_path(model_path):
        result["skipped_non_model_files"] += 1
        return result

    result["scanned_models"] += 1

    try:
        actual_size = os.path.getsize(model_path)
    except OSError as exc:
        result["errors"].append(
            {
                "model_path": model_path,
                "metadata_path": "",
                "message": str(exc),
            }
        )
        return result

    existing_metadata_paths = [
        metadata_path
        for metadata_path in _metadata_sidecar_paths(model_path)
        if os.path.isfile(metadata_path)
    ]
    if not existing_metadata_paths:
        result["missing_metadata"] += 1
        return result

    model_filename = get_filename_from_path(model_path)
    seen_entries = set()
    for metadata_path in existing_metadata_paths:
        entry_key = _model_key(model_path, metadata_path)
        if entry_key in seen_entries:
            continue
        seen_entries.add(entry_key)
        result["metadata_files"] += 1

        metadata = read_json_safe(metadata_path, None)
        if not isinstance(metadata, dict):
            result["invalid_metadata"] += 1
            result["errors"].append(
                {
                    "model_path": model_path,
                    "metadata_path": metadata_path,
                    "message": "Metadata JSON is missing, invalid, or not an object.",
                }
            )
            continue

        size_info = extract_metadata_size(metadata, model_filename)
        if not size_info:
            result["missing_size"] += 1
            continue

        result["checked_metadata"] += 1
        metadata_size, size_field = size_info
        if metadata_size == actual_size:
            continue

        difference = actual_size - metadata_size
        result["mismatches"].append(
            {
                "filename": model_filename,
                "relative_path": model.get("relative_path") or model_filename,
                "category": model.get("category") or "",
                "base_directory": model.get("base_directory") or "",
                "model_path": model_path,
                "metadata_path": metadata_path,
                "metadata_size": metadata_size,
                "actual_size": actual_size,
                "difference": difference,
                "metadata_size_label": format_size_bytes(metadata_size),
                "actual_size_label": format_size_bytes(actual_size),
                "difference_label": _format_signed_size(difference),
                "size_field": size_field,
            }
        )

    return result


def _merge_audit_counts(target: Dict[str, Any], source: Dict[str, Any]) -> None:
    for key in (
        "scanned_models",
        "metadata_files",
        "checked_metadata",
        "missing_metadata",
        "missing_size",
        "invalid_metadata",
        "skipped_directories",
        "skipped_non_model_files",
    ):
        target[key] += int(source.get(key) or 0)
    target["errors"].extend(source.get("errors") or [])
    target["mismatches"].extend(source.get("mismatches") or [])


def _audit_model_batch(batch: List[Dict[str, Any]]) -> Dict[str, Any]:
    result = _empty_audit_counts()
    for model in batch:
        _merge_audit_counts(result, _audit_one_model(model))
    return result


def audit_metadata_sizes(
    models: Optional[List[Dict[str, Any]]] = None,
    *,
    force_rescan: bool = True,
    worker_count: Optional[int] = None,
    batch_size: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Compare sidecar metadata size values against actual local model file sizes.
    """
    if models is None:
        from .scanner import get_model_files

        models = get_model_files(force_rescan=force_rescan)

    audit_models = _dedupe_models(models or [])
    total_models = len(audit_models)
    resolved_worker_count, cpu_count = _get_worker_count(total_models, worker_count)
    resolved_batch_size = _get_batch_size(total_models, resolved_worker_count, batch_size)
    batches = _make_batches(audit_models, resolved_batch_size)
    active_worker_count = min(resolved_worker_count, len(batches) or 1)
    aggregate = _empty_audit_counts()

    if batches:
        if active_worker_count <= 1:
            for batch in batches:
                _merge_audit_counts(aggregate, _audit_model_batch(batch))
        else:
            with ThreadPoolExecutor(max_workers=active_worker_count) as executor:
                futures = [executor.submit(_audit_model_batch, batch) for batch in batches]
                for future in as_completed(futures):
                    _merge_audit_counts(aggregate, future.result())

    mismatches = aggregate["mismatches"]
    errors = aggregate["errors"]

    mismatches.sort(
        key=lambda item: (
            str(item.get("category") or "").lower(),
            str(item.get("relative_path") or item.get("filename") or "").lower(),
            str(item.get("metadata_path") or "").lower(),
        )
    )

    result = {
        "success": True,
        "cpu_count": cpu_count,
        "worker_count": active_worker_count,
        "batch_size": resolved_batch_size,
        "batch_count": len(batches),
        "scanned_models": aggregate["scanned_models"],
        "metadata_files": aggregate["metadata_files"],
        "checked_metadata": aggregate["checked_metadata"],
        "missing_metadata": aggregate["missing_metadata"],
        "missing_size": aggregate["missing_size"],
        "invalid_metadata": aggregate["invalid_metadata"],
        "skipped_directories": aggregate["skipped_directories"],
        "skipped_non_model_files": aggregate["skipped_non_model_files"],
        "error_count": len(errors),
        "errors": errors[:50],
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }

    log.info(
        "Metadata size audit finished: "
        f"models={aggregate['scanned_models']}, metadata={aggregate['metadata_files']}, "
        f"size_values={aggregate['checked_metadata']}, mismatches={len(mismatches)}, "
        f"missing_size={aggregate['missing_size']}, errors={len(errors)}, "
        f"workers={active_worker_count}, batches={len(batches)}, batch_size={resolved_batch_size}"
    )
    return result

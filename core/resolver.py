"""
Core Resolver Module

Integrates all components to provide high-level API for model linking.
"""

import json
import os
import re
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import unquote

from .custom_nodes import (
    custom_node_has_potential_model_reference,
    get_custom_node_resolution_metadata,
    should_skip_existing_custom_node_reference,
)
from .log_system import create_module_logger

log = create_module_logger(__name__)

from .local_hash_matches import collect_local_hash_matches_for_result
from .matcher import find_matches, strip_known_model_extension
from .scanner import get_model_files
from .type_utils import MODEL_EXTENSIONS as _MODEL_EXTENSIONS
from .type_utils import (
    as_dict,
    as_list,
    extract_sha256_from_metadata,
    normalize_sha256,
    prepare_remote_size_probe_url,
    unique_ordered_strings,
)
from .workflow.analysis import identify_missing_models
from .workflow.inventory import get_workflow_model_inventory
from .workflow.references import (
    get_model_widget_category_hint,
    should_scan_as_model_reference,
)
from .workflow.traversal import (
    iter_active_workflow_nodes_with_scope,
    iter_workflow_nodes_with_scope,
)
from .workflow.widgets import NESTED_MODEL_KEYS, NODE_TYPE_TO_CATEGORY_HINTS
from .workflow_updater import update_workflow_nodes

# Regex patterns for URL extraction (matches HuggingFace and CivitAI URLs)
URL_PATTERN = re.compile(r'(https?://(?:huggingface\.co|civitai\.com)[^\s"\'<>\)\\]+)')

# Model file extensions to look for
MODEL_EXTENSIONS = tuple(_MODEL_EXTENSIONS)


from .path_utils import (
    find_metadata_sidecar_path,
    get_filename_from_path,
    get_path_identity,
    get_path_key,
    read_merged_model_metadata,
)

# Imported from .matcher

_LOCAL_HASH_MATCH_CACHE_LOCK = threading.Lock()
_LOCAL_HASH_MATCH_CACHE: Optional[Dict[str, List[Dict[str, Any]]]] = None
_ACTIVE_DOWNLOAD_STATUSES = {"starting", "downloading", "paused", "cancelling"}


def invalidate_local_hash_match_cache() -> None:
    """Clear the in-memory SHA256 -> local model match index."""
    global _LOCAL_HASH_MATCH_CACHE
    with _LOCAL_HASH_MATCH_CACHE_LOCK:
        _LOCAL_HASH_MATCH_CACHE = None


def _clone_hash_match(match: Dict[str, Any]) -> Dict[str, Any]:
    cloned = dict(match)
    if isinstance(cloned.get("model"), dict):
        cloned["model"] = dict(cloned["model"])
    return cloned


def _get_active_downloads_by_path() -> Dict[str, Dict[str, Any]]:
    try:
        from .download.api import get_all_progress

        progress_items = get_all_progress()
    except Exception:
        return {}

    active: Dict[str, Dict[str, Any]] = {}
    for download_id, progress in progress_items.items():
        if not isinstance(progress, dict):
            continue

        status = str(progress.get("status") or "").strip().lower()
        if status not in _ACTIVE_DOWNLOAD_STATUSES:
            continue

        path = progress.get("path") or ""
        if not path and progress.get("directory") and progress.get("filename"):
            path = os.path.join(str(progress["directory"]), str(progress["filename"]))

        path_key = get_path_key(path)
        if not path_key:
            continue

        active[path_key] = {
            "download_id": download_id,
            "download_status": status,
            "download_progress": progress.get("progress", 0),
            "downloaded": progress.get("downloaded", 0),
            "total_size": progress.get("total_size", 0),
        }

    return active


def annotate_local_matches_with_download_state(
    matches: List[Dict[str, Any]],
    active_downloads_by_path: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    active_downloads = (
        active_downloads_by_path
        if active_downloads_by_path is not None
        else _get_active_downloads_by_path()
    )
    if not active_downloads:
        return matches

    enriched_matches: List[Dict[str, Any]] = []
    for match in matches:
        if not isinstance(match, dict):
            enriched_matches.append(match)
            continue

        model = match.get("model") if isinstance(match.get("model"), dict) else {}
        candidate_paths = [
            model.get("path"),
            model.get("resolved_path"),
            match.get("path"),
            match.get("resolved_path"),
        ]
        download_info = None
        for candidate_path in candidate_paths:
            path_key = get_path_key(candidate_path)
            if path_key and path_key in active_downloads:
                download_info = active_downloads[path_key]
                break

        if not download_info:
            enriched_matches.append(match)
            continue

        enriched_match = dict(match)
        enriched_model = dict(model)
        download_fields = {
            **download_info,
            "is_downloading": True,
            "downloading": True,
        }
        enriched_match.update(download_fields)
        if enriched_model:
            enriched_model.update(download_fields)
            enriched_match["model"] = enriched_model
        enriched_matches.append(enriched_match)

    return enriched_matches


def _is_local_hash_match_candidate(model: Dict[str, Any]) -> bool:
    model_path = str(model.get("path") or "").strip()
    if not model_path:
        return False

    if os.path.isdir(model_path):
        return True

    filename = get_filename_from_path(model_path).lower()
    if filename.endswith((".metadata.json", ".civitai.info")):
        return False

    file_ext = os.path.splitext(filename)[1].lower()
    return file_ext in _MODEL_EXTENSIONS


def _build_local_hash_match_cache(
    available_models: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    index: Dict[str, List[Dict[str, Any]]] = {}
    seen_entries = set()

    for model in available_models:
        if not _is_local_hash_match_candidate(model):
            continue

        model_path = model.get("path", "")
        if not model_path:
            continue

        metadata_path = find_metadata_sidecar_path(model_path)
        if not metadata_path:
            continue

        metadata = read_merged_model_metadata(model_path, None)
        if not isinstance(metadata, dict) or not metadata:
            log.debug(f"Could not read metadata sidecar for hash match: {metadata_path}")
            continue

        metadata_hashes = _extract_model_sha256_from_metadata(metadata, model)
        if not metadata_hashes:
            continue

        model_filename = model.get("filename") or get_filename_from_path(model_path)
        for metadata_hash in metadata_hashes:
            normalized_hash = normalize_sha256(metadata_hash)
            if not normalized_hash:
                continue

            try:
                model_identity = get_path_identity(model_path)
            except (OSError, ValueError):
                model_identity = os.path.normcase(os.path.abspath(model_path))
            entry_key = (normalized_hash, model_identity or model_path)
            if entry_key in seen_entries:
                continue
            seen_entries.add(entry_key)

            model_with_metadata = {
                **model,
                "sha256": normalized_hash,
                "metadata_path": metadata_path,
            }
            index.setdefault(normalized_hash, []).append(
                {
                    "model": model_with_metadata,
                    "filename": model_filename,
                    "similarity": 1.0,
                    "confidence": 100.0,
                    "match_type": "hash",
                    "hash_match": True,
                    "hash_source": "metadata",
                    "sha256": normalized_hash,
                    "metadata_path": metadata_path,
                }
            )

    return index


def _get_local_hash_match_cache(force_rescan: bool = False) -> Dict[str, List[Dict[str, Any]]]:
    global _LOCAL_HASH_MATCH_CACHE
    if force_rescan:
        invalidate_local_hash_match_cache()

    with _LOCAL_HASH_MATCH_CACHE_LOCK:
        if _LOCAL_HASH_MATCH_CACHE is not None:
            return _LOCAL_HASH_MATCH_CACHE

    available_models = get_model_files(force_rescan=force_rescan)
    index = _build_local_hash_match_cache(available_models)

    with _LOCAL_HASH_MATCH_CACHE_LOCK:
        if _LOCAL_HASH_MATCH_CACHE is None:
            _LOCAL_HASH_MATCH_CACHE = index
        return _LOCAL_HASH_MATCH_CACHE


def get_workflow_url_info_for_filename(
    workflow_urls: Dict[str, Dict[str, Any]], filename: str
) -> Optional[Dict[str, Any]]:
    if filename in workflow_urls:
        return workflow_urls[filename]

    filename_stem = strip_known_model_extension(get_filename_from_path(filename)).lower()
    if not filename_stem:
        return None

    for workflow_filename, url_info in workflow_urls.items():
        workflow_stem = strip_known_model_extension(
            get_filename_from_path(workflow_filename)
        ).lower()
        if workflow_stem == filename_stem:
            return url_info

    return None


def _workflow_hash_entry_candidates(entry: Any) -> List[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return []
    sha256 = normalize_sha256(extract_sha256_from_metadata(entry))
    if not sha256:
        return []
    return [{**entry, "sha256": sha256}]


def _collect_workflow_hash_entries(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, dict):
        return []

    entries: List[Dict[str, Any]] = []
    for key in (
        "model_resolver_hashes",
        "anomalous_hashes",
        "model_hashes",
        "hashes",
    ):
        raw = value.get(key)
        if isinstance(raw, dict):
            for nested_key in ("models", "by_path", "by_node"):
                nested = raw.get(nested_key)
                if isinstance(nested, list):
                    for item in nested:
                        entries.extend(_workflow_hash_entry_candidates(item))
                elif isinstance(nested, dict):
                    for item in nested.values():
                        entries.extend(_workflow_hash_entry_candidates(item))
            entries.extend(_workflow_hash_entry_candidates(raw))
        elif isinstance(raw, list):
            for item in raw:
                entries.extend(_workflow_hash_entry_candidates(item))
    return entries


def extract_workflow_hash_metadata(workflow_json: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Return embedded workflow SHA256 metadata indexed by path, filename, and node/widget."""
    if not isinstance(workflow_json, dict):
        return {}

    entries: List[Dict[str, Any]] = []
    entries.extend(_collect_workflow_hash_entries(workflow_json))
    extra = workflow_json.get("extra")
    if isinstance(extra, dict):
        entries.extend(_collect_workflow_hash_entries(extra))

    index: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        sha256 = normalize_sha256(entry.get("sha256"))
        if not sha256:
            continue
        normalized = {**entry, "sha256": sha256}
        for candidate in (
            entry.get("path"),
            entry.get("original_path"),
            entry.get("filename"),
            entry.get("name"),
            entry.get("file_name"),
        ):
            text = str(candidate or "").strip()
            if not text:
                continue
            index[text] = normalized
            index[get_filename_from_path(text)] = normalized
        node_id = entry.get("node_id")
        widget_index = entry.get("widget_index")
        if node_id is not None and widget_index is not None:
            index[f"{node_id}:{widget_index}"] = normalized
    return index


def get_workflow_hash_info_for_ref(
    workflow_hashes: Dict[str, Dict[str, Any]], model_ref: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    if not workflow_hashes:
        return None
    original_path = str(model_ref.get("original_path") or "")
    candidates = [
        f"{model_ref.get('node_id')}:{model_ref.get('widget_index')}",
        original_path,
        get_filename_from_path(original_path),
        model_ref.get("filename") or "",
        model_ref.get("name") or "",
    ]
    for candidate in candidates:
        if candidate and candidate in workflow_hashes:
            return workflow_hashes[candidate]
    return None


def workflow_has_nodes(workflow_json: Dict[str, Any]) -> bool:
    """Return True when the active top-level workflow contains nodes."""
    if not isinstance(workflow_json, dict):
        return False

    nodes = workflow_json.get("nodes")
    return isinstance(nodes, list) and len(nodes) > 0


def node_has_potential_model_reference(node: Dict[str, Any]) -> bool:
    """Detect model-looking widget values without resolving paths or scanning disks."""
    if not isinstance(node, dict):
        return False

    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or not widgets_values:
        return False

    if custom_node_has_potential_model_reference(node):
        return True

    for idx, value in enumerate(widgets_values):
        model_widget_category_hint = get_model_widget_category_hint(node, idx)
        if should_scan_as_model_reference(
            value, declared_model_widget=bool(model_widget_category_hint)
        ):
            return True

        if not isinstance(value, dict):
            continue

        for nested_key in NESTED_MODEL_KEYS:
            nested_value = value.get(nested_key)
            if (
                isinstance(nested_value, str)
                and should_scan_as_model_reference(
                    nested_value, declared_model_widget=True
                )
            ):
                return True

    return False


def workflow_has_potential_model_references(workflow_json: Dict[str, Any]) -> bool:
    """Return True when active workflow nodes contain any model-looking values."""
    return any(
        node_has_potential_model_reference(context.node)
        for context in iter_active_workflow_nodes_with_scope(workflow_json)
    )

def normalize_workflow_download_url(url: str) -> str:
    """Convert workflow file-page URLs into direct download URLs when possible."""
    normalized = prepare_remote_size_probe_url(url)
    return normalized if normalized is not None else url


def workflow_url_points_to_file(url: str, filename: str) -> bool:
    """Return true when a URL appears to reference the specific model file."""
    if not url or not filename:
        return False

    try:
        decoded_url = unquote(url)
    except Exception:
        decoded_url = url

    return filename in decoded_url or unquote(filename) in decoded_url


def _deduplicate_local_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep one highest-confidence match for each local model path."""
    seen_absolute_paths = {}
    deduplicated_matches = []
    for match in matches:
        model_dict = match["model"]
        absolute_path = model_dict.get("path", "")
        path_identity = get_path_identity(absolute_path) if absolute_path else ""
        dedupe_key = path_identity or os.path.normcase(
            model_dict.get("relative_path", "") or match.get("filename", "")
        )

        if dedupe_key not in seen_absolute_paths:
            seen_absolute_paths[dedupe_key] = match
            deduplicated_matches.append(match)
        else:
            existing_match = seen_absolute_paths[dedupe_key]
            if match["confidence"] > existing_match["confidence"]:
                idx = deduplicated_matches.index(existing_match)
                deduplicated_matches[idx] = match
                seen_absolute_paths[dedupe_key] = match

    return deduplicated_matches


def search_local_matches(
    target_for_matching: str,
    category: Optional[str] = None,
    similarity_threshold: float = 0.0,
    max_matches_per_model: int = 10,
    force_rescan: bool = False,
) -> List[Dict[str, Any]]:
    """
    Search local model files using the same matcher as workflow analysis.

    Args:
        target_for_matching: Filename/path to match against local files
        category: Optional category hint to prioritize/filter candidates
        similarity_threshold: Minimum similarity score (0.0 to 1.0)
        max_matches_per_model: Maximum number of matches to return

    Returns:
        Deduplicated list of local matches sorted by similarity
    """
    available_models = get_model_files(force_rescan=force_rescan)

    candidates = available_models
    if category and category != "unknown":
        candidates = [m for m in available_models if m.get("category") == category]
        candidates.extend(
            [m for m in available_models if m.get("category") != category]
        )

    matches = find_matches(
        target_for_matching,
        candidates,
        threshold=similarity_threshold,
        max_results=max_matches_per_model,
    )

    deduplicated_matches = _deduplicate_local_matches(matches)
    return annotate_local_matches_with_download_state(deduplicated_matches)


def _collect_hashes_from_container(value: Any) -> List[str]:
    h = extract_sha256_from_metadata(value)
    return [h] if h else []


def _metadata_file_matches_model(file_info: Dict[str, Any], model: Dict[str, Any]) -> bool:
    model_filename = str(model.get("filename") or get_filename_from_path(model.get("path", ""))).lower()
    model_relative = str(model.get("relative_path") or "").replace("\\", "/").lower()
    model_stem = strip_known_model_extension(get_filename_from_path(model_filename)).lower()

    candidates = [
        file_info.get("name"),
        file_info.get("filename"),
        file_info.get("path"),
        file_info.get("file_path"),
    ]
    for candidate in candidates:
        text = str(candidate or "").replace("\\", "/").lower()
        basename = get_filename_from_path(text)
        stem = strip_known_model_extension(basename).lower()
        if text and model_relative and text == model_relative:
            return True
        if basename and basename == model_filename:
            return True
        if stem and model_stem and stem == model_stem:
            return True
    return False


def _extract_model_sha256_from_metadata(
    metadata: Dict[str, Any], model: Dict[str, Any]
) -> List[str]:
    if not isinstance(metadata, dict):
        return []

    hash_status = str(metadata.get("hash_status") or "").strip().lower()
    if hash_status and hash_status != "completed":
        return []

    values: List[str] = []
    values.extend(_collect_hashes_from_container(metadata))
    values.extend(_collect_hashes_from_container(metadata.get("path_metadata")))
    values.extend(_collect_hashes_from_container(metadata.get("file_info")))
    values.extend(_collect_hashes_from_container(metadata.get("file")))

    nested_file_lists = [
        metadata.get("files"),
        as_dict(metadata.get("selected_version")).get("files"),
        as_dict(metadata.get("civitai")).get("files"),
    ]
    for file_list in nested_file_lists:
        for file_info in as_list(file_list):
            if isinstance(file_info, dict) and _metadata_file_matches_model(file_info, model):
                values.extend(_collect_hashes_from_container(file_info))

    return [value for value in unique_ordered_strings(values) if normalize_sha256(value)]



def search_local_matches_by_hash(
    sha256: str,
    category: Optional[str] = None,
    max_matches: int = 20,
    force_rescan: bool = False,
) -> List[Dict[str, Any]]:
    """
    Find local models whose sidecar .metadata.json contains the given SHA256.

    This intentionally does not hash model files. It only reads metadata sidecars
    next to models already discovered by the scanner.
    """
    normalized_hash = normalize_sha256(sha256)
    if not normalized_hash:
        return []

    index = _get_local_hash_match_cache(force_rescan=force_rescan)
    matches = [_clone_hash_match(match) for match in index.get(normalized_hash, [])]

    if category and category != "unknown":
        matches.sort(
            key=lambda match: 0
            if match.get("model", {}).get("category") == category
            else 1
        )

    annotated_matches = annotate_local_matches_with_download_state(matches)
    if max_matches > 0:
        return annotated_matches[:max_matches]
    return annotated_matches


def get_local_model_hash_metadata(
    model_path: str,
    model: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Return SHA256 hashes already stored in sidecar metadata for a local model.

    This intentionally does not hash model files. It only reads metadata sidecars
    next to the selected local model, so callers can do quick hash comparisons.
    """
    raw_path = str(model_path or "").strip()
    if not raw_path:
        return {"exists": False, "metadata_path": "", "hashes": [], "sha256": ""}

    normalized_path = os.path.abspath(os.path.normpath(raw_path))
    exists = os.path.exists(normalized_path)
    file_size = 0
    if exists and os.path.isfile(normalized_path):
        try:
            file_size = os.path.getsize(normalized_path)
        except OSError:
            file_size = 0
    model_info: Dict[str, Any] = {
        **(model if isinstance(model, dict) else {}),
        "path": normalized_path,
    }
    model_info.setdefault("filename", get_filename_from_path(normalized_path))
    model_info.setdefault("relative_path", model_info.get("filename", ""))

    metadata_path = find_metadata_sidecar_path(normalized_path)
    last_hash_status = ""
    if metadata_path:
        metadata = read_merged_model_metadata(normalized_path, None)
        if isinstance(metadata, dict) and metadata:
            last_hash_status = str(metadata.get("hash_status") or "").strip()
            hashes = _extract_model_sha256_from_metadata(metadata, model_info)
            if hashes:
                return {
                    "exists": exists,
                    "metadata_path": metadata_path,
                    "hash_status": last_hash_status,
                    "hashes": hashes,
                    "sha256": hashes[0],
                    "size": file_size,
                }

    return {
        "exists": exists,
        "metadata_path": metadata_path,
        "hash_status": last_hash_status,
        "hashes": [],
        "sha256": "",
        "size": file_size,
    }


def extract_workflow_urls(workflow_json: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Extract model URLs from workflow JSON.

    Sources:
    1. node.properties.models array - contains {name, url, directory}
    2. Regex extraction from workflow JSON string - finds HuggingFace/CivitAI URLs

    Args:
        workflow_json: Complete workflow JSON dictionary

    Returns:
        Dict mapping model filename -> {url, directory, source}
    """
    url_map = {}

    # Convert to string for regex search
    workflow_str = json.dumps(workflow_json)

    # Collect all serialized nodes, including nodes from subgraphs.
    all_nodes = [
        context.node for context in iter_workflow_nodes_with_scope(workflow_json)
    ]

    # 1. Extract from node.properties.models (authoritative source)
    for node in all_nodes:
        node_type = node.get("type", "")
        properties = node.get("properties", {})
        models_list = properties.get("models", [])

        for model_info in models_list:
            if isinstance(model_info, dict):
                name = model_info.get("name", "")
                url = model_info.get("url", "")
                directory = model_info.get("directory", "")

                if name and name not in url_map:
                    url_map[name] = {
                        "url": normalize_workflow_download_url(url),
                        "model_url": url,
                        "directory": directory,
                        "node_type": node_type,
                        "source": "node_properties",
                    }

    # 2. Extract URLs via regex from workflow JSON
    urls_found = URL_PATTERN.findall(workflow_str)

    # Clean URLs (remove trailing characters that may have been captured)
    cleaned_urls = []
    for url in urls_found:
        url = url.split(")")[0].replace("\\n", "").replace("\n", "").strip()
        if url:
            cleaned_urls.append(url)

    # 3. Extract model filenames via regex
    model_pattern = re.compile(
        r"([\w\-\.%]+\.(?:safetensors|ckpt|pt|pth|bin|onnx|gguf))", re.IGNORECASE
    )
    model_files_raw = model_pattern.findall(workflow_str)

    # Clean and decode filenames
    model_files = set()
    model_name_map = {}  # decoded -> original

    for model in model_files_raw:
        cleaned = model.strip()
        if cleaned and cleaned[0].isalnum():
            try:
                decoded = unquote(cleaned)
            except Exception:
                decoded = cleaned
            model_files.add(decoded)
            model_name_map[decoded] = cleaned

    # 4. Match URLs to model filenames
    for model in model_files:
        # Keep authoritative node.properties URLs only when they point to the file.
        # Some workflows store a repo/model-page URL there and a concrete file URL
        # elsewhere in the JSON; in that case the file URL is the usable download.
        if (
            model in url_map
            and url_map[model].get("url")
            and workflow_url_points_to_file(url_map[model].get("url"), model)
        ):
            continue

        original_name = model_name_map.get(model, model)

        for url in cleaned_urls:
            # Check decoded name in URL
            if model in url:
                if (
                    model not in url_map
                    or not url_map[model].get("url")
                    or not workflow_url_points_to_file(url_map[model].get("url"), model)
                ):
                    url_map[model] = {
                        "url": normalize_workflow_download_url(url),
                        "model_url": url,
                        "directory": url_map.get(model, {}).get("directory", ""),
                        "source": "regex",
                    }
                else:
                    url_map[model]["url"] = normalize_workflow_download_url(url)
                    url_map[model]["model_url"] = url
                    url_map[model]["source"] = "regex"
                break
            # Check original (possibly URL-encoded) name in URL
            if original_name in url:
                if (
                    model not in url_map
                    or not url_map[model].get("url")
                    or not workflow_url_points_to_file(
                        url_map[model].get("url"), original_name
                    )
                ):
                    url_map[model] = {
                        "url": normalize_workflow_download_url(url),
                        "model_url": url,
                        "directory": url_map.get(model, {}).get("directory", ""),
                        "source": "regex",
                    }
                else:
                    url_map[model]["url"] = normalize_workflow_download_url(url)
                    url_map[model]["model_url"] = url
                    url_map[model]["source"] = "regex"
                break
            # Check without extension
            model_base = os.path.splitext(model)[0]
            if model_base in url or unquote(model_base) in url:
                if (
                    model not in url_map
                    or not url_map[model].get("url")
                    or not workflow_url_points_to_file(url_map[model].get("url"), model)
                ):
                    url_map[model] = {
                        "url": normalize_workflow_download_url(url),
                        "model_url": url,
                        "directory": url_map.get(model, {}).get("directory", ""),
                        "source": "regex",
                    }
                else:
                    url_map[model]["url"] = normalize_workflow_download_url(url)
                    url_map[model]["model_url"] = url
                    url_map[model]["source"] = "regex"
                break

    return url_map


def analyze_and_find_matches(
    workflow_json: Dict[str, Any],
    similarity_threshold: float = 0.0,
    max_matches_per_model: int = 10,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    force_rescan: bool = False,
    analysis_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main entry point: analyze workflow and find matches for missing models.

    Args:
        workflow_json: Complete workflow JSON dictionary
        similarity_threshold: Minimum similarity score (0.0 to 1.0) for matches
        max_matches_per_model: Maximum number of matches to return per missing model
        force_rescan: If True, bypass the short-lived local model scan cache
        analysis_id: Optional identifier used to correlate logs for one request

    Returns:
        Dictionary with analysis results:
        {
            'missing_models': [
                {
                    'node_id': node ID,
                    'node_type': node type,
                    'widget_index': widget index,
                    'original_path': original path from workflow,
                    'category': model category,
                    'workflow_url': URL from workflow if found,
                    'workflow_directory': directory from workflow if found,
                    'matches': [
                        {
                            'model': model dict from scanner,
                            'filename': model filename,
                            'similarity': similarity score (0.0-1.0),
                            'confidence': confidence percentage (0-100)
                        },
                        ...
                    ]
                },
                ...
            ],
            'total_missing': count of missing models,
            'total_models_analyzed': count of all models in workflow
        }
    """
    if progress_callback:
        progress_callback(
            {
                "stage": "extracting",
                "message": "Extracting workflow model references...",
                "current": 0,
                "total": 0,
            }
        )

    if (
        not workflow_has_nodes(workflow_json)
        or not workflow_has_potential_model_references(workflow_json)
    ):
        if progress_callback:
            progress_callback(
                {
                    "stage": "completed",
                    "message": "Analysis complete",
                    "current": 0,
                    "total": 0,
                }
            )
        return {
            "missing_models": [],
            "resolved_models": [],
            "total_resolved": 0,
            "total_missing": 0,
            "total_models_analyzed": 0,
        }

    # Extract URLs from workflow (node.properties.models + regex)
    analysis_context = f" (analysis_id={analysis_id})" if analysis_id else ""
    workflow_urls = extract_workflow_urls(workflow_json)
    log.debug(
        f"Extracted {len(workflow_urls)} URLs from workflow{analysis_context}"
    )
    workflow_hashes = extract_workflow_hash_metadata(workflow_json)
    log.debug(
        f"Extracted {len(workflow_hashes)} workflow hash metadata keys"
        f"{analysis_context}"
    )

    if progress_callback:
        progress_callback(
            {
                "stage": "scanning",
                "message": "Scanning local model index...",
                "current": 0,
                "total": 0,
            }
        )

    inventory = get_workflow_model_inventory(
        workflow_json,
        force_rescan=force_rescan,
        progress_callback=progress_callback,
        analysis_id=analysis_id,
    )
    available_models = inventory["available_models"]
    all_model_refs = inventory["model_refs"]
    available_models_by_category = {}
    for model in available_models:
        model_category = model.get("category", "")
        if model_category not in available_models_by_category:
            available_models_by_category[model_category] = []
        available_models_by_category[model_category].append(model)

    ordered_candidates_cache: Dict[str, List[Dict[str, Any]]] = {}

    if progress_callback:
        progress_callback(
            {
                "stage": "identifying",
                "message": "Identifying missing models...",
                "current": 0,
                "total": len(all_model_refs),
            }
        )

    # Identify missing models
    missing_models = identify_missing_models(all_model_refs, available_models)
    resolved_model_refs = [
        model_ref for model_ref in all_model_refs if model_ref.get("exists", False)
    ]

    # Enrich missing models with workflow URLs
    for missing in missing_models:
        original_path = missing.get("original_path", "")
        filename = get_filename_from_path(original_path)

        url_info = get_workflow_url_info_for_filename(workflow_urls, filename)
        if url_info:
            missing["workflow_url"] = url_info.get("url", "")
            missing["workflow_model_url"] = url_info.get("model_url", "")
            missing["workflow_directory"] = url_info.get("directory", "")
            missing["url_source"] = url_info.get("source", "")
        hash_info = get_workflow_hash_info_for_ref(workflow_hashes, missing)
        if hash_info:
            missing["workflow_sha256"] = normalize_sha256(hash_info.get("sha256"))
            missing["hash_lookup_source"] = hash_info.get("source") or "workflow_metadata"

    # Handle URNs: mark for async resolution by frontend
    # No sync CivitAI calls here - frontend will fetch asynchronously
    for missing in missing_models:
        if missing.get("is_urn"):
            missing["needs_urn_resolve"] = True
            urn = missing.get("urn")
            if urn:
                missing["urn_model_id"] = urn.get("model_id")
                missing["urn_version_id"] = urn.get("version_id")
                missing["urn_type"] = urn.get("type", "")

    total_matching_models = len(missing_models)
    if progress_callback:
        progress_callback(
            {
                "stage": "matching",
                "message": "Matching local models...",
                "current": 0,
                "total": total_matching_models,
            }
        )

    local_match_cache: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    active_downloads_by_path = _get_active_downloads_by_path()

    def get_match_target(model_ref: Dict[str, Any]) -> Optional[str]:
        target_for_matching = (
            model_ref.get("original_path")
            or model_ref.get("expected_filename")
            or model_ref.get("name")
            or model_ref.get("filename")
            or model_ref.get("full_path")
            or ""
        )

        # For URNs, prefer expected_filename for matching
        if model_ref.get("is_urn") and model_ref.get("expected_filename"):
            return model_ref["expected_filename"]

        if isinstance(target_for_matching, str) and target_for_matching.startswith(
            "urn:air:"
        ):
            # Don't fuzzy-match the full URN string against every local model.
            # For worker-asset style URNs, try using the filename-like suffix after "@";
            # otherwise skip local matching until the frontend resolves the URN async.
            urn_suffix = (
                target_for_matching.split("@", 1)[1]
                if "@" in target_for_matching
                else ""
            )
            urn_suffix_ext = os.path.splitext(urn_suffix)[1].lower()
            if urn_suffix and urn_suffix_ext in MODEL_EXTENSIONS:
                return urn_suffix
            return None

        return target_for_matching

    def get_match_category(model_ref: Dict[str, Any]) -> str:
        category = model_ref.get("category")
        if not category or category == "unknown":
            node_type = model_ref.get("node_type", "")
            category = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type, "unknown")
        return category or "unknown"

    def get_candidates_for_category(category: str) -> List[Dict[str, Any]]:
        if not category or category == "unknown":
            return available_models

        candidates = ordered_candidates_cache.get(category)
        if candidates is None:
            preferred = available_models_by_category.get(category, [])
            others = [
                m for m in available_models if m.get("category") != category
            ]
            candidates = preferred + others
            ordered_candidates_cache[category] = candidates

        return candidates

    def find_local_matches_for_ref(model_ref: Dict[str, Any]) -> List[Dict[str, Any]]:
        target_for_matching = get_match_target(model_ref)
        category = get_match_category(model_ref)
        workflow_sha256 = normalize_sha256(model_ref.get("workflow_sha256"))
        hash_matches = []
        if workflow_sha256:
            hash_matches = collect_local_hash_matches_for_result(
                workflow_sha256,
                search_local_matches_by_hash=search_local_matches_by_hash,
                category=category,
                max_matches=max_matches_per_model,
                force_rescan=False,
                source=model_ref.get("hash_lookup_source") or "workflow_metadata",
                filename=get_filename_from_path(model_ref.get("original_path") or ""),
            )

        if not target_for_matching:
            return hash_matches

        cache_key = (target_for_matching, category)
        if cache_key in local_match_cache:
            return _deduplicate_local_matches(hash_matches + local_match_cache[cache_key])

        matches = find_matches(
            target_for_matching,
            get_candidates_for_category(category),
            threshold=similarity_threshold,
            max_results=max_matches_per_model,
        )
        deduplicated_matches = annotate_local_matches_with_download_state(
            _deduplicate_local_matches(matches),
            active_downloads_by_path,
        )
        local_match_cache[cache_key] = deduplicated_matches
        return _deduplicate_local_matches(hash_matches + deduplicated_matches)

    # Find matches for each missing model
    missing_with_matches = []
    total_missing = len(missing_models)
    for index, missing in enumerate(missing_models, start=1):
        if progress_callback:
            progress_callback(
                {
                    "stage": "matching",
                    "message": f"Analyzing model {index} of {total_missing}",
                    "current": index,
                    "total": total_matching_models,
                    "model_name": missing.get("name")
                    or missing.get("original_path", ""),
                }
            )

        name = missing.get("name") or missing.get("original_path", "")
        if should_skip_existing_custom_node_reference(missing):
            log.info(
                f"Skipping existing custom-node model reference: {name}"
            )
            continue

        missing_with_matches.append({
            **missing,
            "matches": find_local_matches_for_ref(missing),
        })

    # Existing models already have an exact local path. Fuzzy-matching every
    # resolved reference against the full local model index is redundant and
    # makes small workflow edits unnecessarily expensive.
    resolved_with_matches = [
        {
            **resolved,
            "matches": [],
        }
        for resolved in resolved_model_refs
    ]

    result = {
        "missing_models": missing_with_matches,
        "resolved_models": resolved_with_matches,
        "total_resolved": len(resolved_with_matches),
        "total_missing": len(missing_with_matches),
        "total_models_analyzed": len(all_model_refs),
    }

    if progress_callback:
        progress_callback(
            {
                "stage": "completed",
                "message": "Analysis complete",
                "current": total_matching_models,
                "total": total_matching_models,
            }
        )

    return result


def apply_resolution(
    workflow_json: Dict[str, Any], resolutions: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Apply model resolutions to workflow.

    Args:
        workflow_json: Workflow JSON dictionary (will be modified)
        resolutions: List of resolution dictionaries:
            {
                'node_id': node ID,
                'widget_index': widget index,
                'resolved_path': absolute path to resolved model,
                'category': model category (optional),
                'resolved_model': model dict from scanner (optional),
                'nested_key': nested key for dict-type widgets (optional)
            }

    Returns:
        Updated workflow JSON dictionary
    """
    # Prepare mappings for workflow_updater
    mappings = []
    for resolution in resolutions:
        mapping = {
            "node_id": resolution.get("node_id"),
            "widget_index": resolution.get("widget_index"),
            "resolved_path": resolution.get("resolved_path"),
            "category": resolution.get("category"),
            "resolved_model": resolution.get("resolved_model"),
            "subgraph_id": resolution.get(
                "subgraph_id"
            ),  # Include subgraph_id for subgraph nodes
            "is_top_level": resolution.get(
                "is_top_level"
            ),  # True for top-level nodes, False for nodes in subgraph definitions
            "nested_key": resolution.get(
                "nested_key"
            ),  # For dict-type widget values
            "promoted_widget_name": resolution.get("promoted_widget_name"),
            **get_custom_node_resolution_metadata(resolution),
        }

        # If resolved_model provided, extract path if needed
        if resolution.get("resolved_model"):
            resolved_model = resolution["resolved_model"]
            if "path" in resolved_model and not mapping.get("resolved_path"):
                mapping["resolved_path"] = resolved_model["path"]
            if "base_directory" in resolved_model:
                mapping["base_directory"] = resolved_model["base_directory"]

        mappings.append(mapping)

    # Update workflow
    updated_workflow = update_workflow_nodes(workflow_json, mappings)

    return updated_workflow

"""
Core Resolver Module

Integrates all components to provide high-level API for model linking.
"""

import os
import re
import json
from typing import Dict, Any, List, Optional, Tuple, Callable
from urllib.parse import unquote

from .log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)
from .scanner import get_model_files
from .workflow_analyzer import (
    NESTED_MODEL_KEYS,
    NODE_TYPE_TO_CATEGORY_HINTS,
    analyze_workflow_models,
    get_model_widget_category_hint,
    identify_missing_models,
    should_scan_as_model_reference,
)
from .matcher import find_matches
from .type_utils import as_dict, as_list, MODEL_EXTENSIONS as _MODEL_EXTENSIONS
from .workflow_updater import update_workflow_nodes
from .sources.civitai import resolve_urn
from .sources.huggingface import parse_huggingface_url as parse_hf_url

# Regex patterns for URL extraction (matches HuggingFace and CivitAI URLs)
URL_PATTERN = re.compile(r'(https?://(?:huggingface\.co|civitai\.com)[^\s"\'<>\)\\]+)')

# Model file extensions to look for
MODEL_EXTENSIONS = tuple(_MODEL_EXTENSIONS)


from .path_utils import (
    get_path_identity,
    get_path_abs,
    get_path_key,
    is_path_within,
    prefer_local_base_directory,
    dedupe_local_base_directories,
)


def strip_known_model_extension(filename: str) -> str:
    """Strip only known model extensions, preserving names like v4.0."""
    if not isinstance(filename, str):
        return ""

    lowered = filename.lower()
    for ext in MODEL_EXTENSIONS:
        if lowered.endswith(ext):
            return filename[: -len(ext)]
    return filename


def get_workflow_url_info_for_filename(
    workflow_urls: Dict[str, Dict[str, Any]], filename: str
) -> Optional[Dict[str, Any]]:
    if filename in workflow_urls:
        return workflow_urls[filename]

    filename_stem = strip_known_model_extension(os.path.basename(filename)).lower()
    if not filename_stem:
        return None

    for workflow_filename, url_info in workflow_urls.items():
        workflow_stem = strip_known_model_extension(
            os.path.basename(workflow_filename)
        ).lower()
        if workflow_stem == filename_stem:
            return url_info

    return None


def workflow_has_nodes(workflow_json: Dict[str, Any]) -> bool:
    """Return True when the active top-level workflow contains nodes."""
    if not isinstance(workflow_json, dict):
        return False

    nodes = workflow_json.get("nodes")
    return isinstance(nodes, list) and len(nodes) > 0


def iter_active_workflow_nodes(workflow_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return top-level nodes plus nodes from subgraphs referenced by top-level nodes."""
    if not isinstance(workflow_json, dict):
        return []

    top_level_nodes = workflow_json.get("nodes")
    if not isinstance(top_level_nodes, list):
        return []

    active_nodes = [
        node for node in top_level_nodes if isinstance(node, dict)
    ]

    definitions = workflow_json.get("definitions")
    if not isinstance(definitions, dict):
        return active_nodes

    subgraph_list = definitions.get("subgraphs")
    if not isinstance(subgraph_list, list):
        return active_nodes

    subgraphs = {
        str(subgraph.get("id")): subgraph
        for subgraph in subgraph_list
        if isinstance(subgraph, dict) and subgraph.get("id") is not None
    }
    pending_subgraphs = [
        str(node.get("type"))
        for node in active_nodes
        if str(node.get("type")) in subgraphs
    ]
    seen_subgraphs = set()

    while pending_subgraphs:
        subgraph_id = pending_subgraphs.pop(0)
        if subgraph_id in seen_subgraphs:
            continue
        seen_subgraphs.add(subgraph_id)

        subgraph = subgraphs.get(subgraph_id)
        subgraph_nodes = subgraph.get("nodes") if isinstance(subgraph, dict) else None
        if not isinstance(subgraph_nodes, list):
            continue

        for node in subgraph_nodes:
            if not isinstance(node, dict):
                continue
            active_nodes.append(node)
            nested_subgraph_id = str(node.get("type"))
            if (
                nested_subgraph_id in subgraphs
                and nested_subgraph_id not in seen_subgraphs
            ):
                pending_subgraphs.append(nested_subgraph_id)

    return active_nodes


def node_has_potential_model_reference(node: Dict[str, Any]) -> bool:
    """Detect model-looking widget values without resolving paths or scanning disks."""
    if not isinstance(node, dict):
        return False

    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or not widgets_values:
        return False

    node_type = node.get("type", "")
    if (
        node_type in {
            "LoraLoaderV2",
            "Lora Loader (LoraManager)",
            "Lora Stacker (LoraManager)",
        }
        and len(widgets_values) >= 3
        and isinstance(widgets_values[2], list)
    ):
        for lora_item in widgets_values[2]:
            if isinstance(lora_item, dict) and str(lora_item.get("name") or "").strip():
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
        node_has_potential_model_reference(node)
        for node in iter_active_workflow_nodes(workflow_json)
    )


def normalize_workflow_download_url(url: str) -> str:
    """Convert workflow file-page URLs into direct download URLs when possible."""
    if not isinstance(url, str) or not url:
        return url

    # HuggingFace /blob/ pages return HTML. /resolve/ returns the actual file.
    return re.sub(
        r"(https?://huggingface\.co/[^/]+/[^/]+)/blob/([^/]+)/(.+)",
        r"\1/resolve/\2/\3",
        url,
    )


def workflow_url_points_to_file(url: str, filename: str) -> bool:
    """Return true when a URL appears to reference the specific model file."""
    if not url or not filename:
        return False

    try:
        decoded_url = unquote(url)
    except Exception:
        decoded_url = url

    return filename in decoded_url or unquote(filename) in decoded_url


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


SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")


def normalize_sha256(value: Any) -> str:
    """Return a normalized SHA256 hex string or an empty string."""
    if value is None:
        return ""

    text = str(value).strip()
    for prefix in ("sha256:", "sha256="):
        if text.lower().startswith(prefix):
            text = text[len(prefix):].strip()

    return text.lower() if SHA256_PATTERN.match(text) else ""


def _metadata_sidecar_candidates(model_path: str) -> List[str]:
    if not model_path:
        return []

    directory = os.path.dirname(model_path)
    filename = os.path.basename(model_path)
    stem, _ = os.path.splitext(filename)

    candidates = [
        os.path.join(directory, f"{stem}.metadata.json"),
        f"{model_path}.metadata.json",
        os.path.join(directory, f"{filename}.metadata.json"),
    ]

    seen = set()
    unique = []
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _as_dict(value: Any) -> Dict[str, Any]:
    return as_dict(value)


def _as_list(value: Any) -> List[Any]:
    return as_list(value)


def _collect_hashes_from_container(value: Any) -> List[str]:
    container = _as_dict(value)
    hashes = _as_dict(container.get("hashes"))
    return [
        normalize_sha256(candidate)
        for candidate in (
            container.get("sha256"),
            container.get("hash"),
            container.get("SHA256"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
            hashes.get("hash"),
        )
        if normalize_sha256(candidate)
    ]


def _metadata_file_matches_model(file_info: Dict[str, Any], model: Dict[str, Any]) -> bool:
    model_filename = str(model.get("filename") or os.path.basename(model.get("path", ""))).lower()
    model_relative = str(model.get("relative_path") or "").replace("\\", "/").lower()
    model_stem = strip_known_model_extension(os.path.basename(model_filename)).lower()

    candidates = [
        file_info.get("name"),
        file_info.get("filename"),
        file_info.get("path"),
        file_info.get("file_path"),
    ]
    for candidate in candidates:
        text = str(candidate or "").replace("\\", "/").lower()
        basename = os.path.basename(text)
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
        _as_dict(metadata.get("selected_version")).get("files"),
        _as_dict(metadata.get("civitai")).get("files"),
    ]
    for file_list in nested_file_lists:
        for file_info in _as_list(file_list):
            if isinstance(file_info, dict) and _metadata_file_matches_model(file_info, model):
                values.extend(_collect_hashes_from_container(file_info))

    return [value for value in _unique_ordered_strings(values) if normalize_sha256(value)]


def _unique_ordered_strings(values: List[Any]) -> List[str]:
    seen = set()
    unique = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


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

    available_models = get_model_files(force_rescan=force_rescan)
    if category and category != "unknown":
        preferred_models = [
            model for model in available_models if model.get("category") == category
        ]
        other_models = [
            model for model in available_models if model.get("category") != category
        ]
        available_models = preferred_models + other_models

    matches: List[Dict[str, Any]] = []

    for model in available_models:
        model_path = model.get("path", "")
        if not model_path:
            continue

        metadata_path = next(
            (candidate for candidate in _metadata_sidecar_candidates(model_path) if os.path.exists(candidate)),
            "",
        )
        if not metadata_path:
            continue

        try:
            with open(metadata_path, "r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except Exception as exc:
            log_debug(f"Could not read metadata sidecar for hash match: {metadata_path} ({exc})")
            continue

        metadata_hashes = _extract_model_sha256_from_metadata(metadata, model)
        if normalized_hash not in metadata_hashes:
            continue

        model_with_metadata = {
            **model,
            "sha256": normalized_hash,
            "metadata_path": metadata_path,
        }
        matches.append(
            {
                "model": model_with_metadata,
                "filename": model.get("filename") or os.path.basename(model_path),
                "similarity": 1.0,
                "confidence": 100.0,
                "match_type": "hash",
                "hash_match": True,
                "hash_source": "metadata",
                "sha256": normalized_hash,
                "metadata_path": metadata_path,
            }
        )
        if max_matches > 0 and len(matches) >= max_matches:
            break

    return matches


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

    # Collect all nodes including from subgraphs
    all_nodes = list(workflow_json.get("nodes", []))
    definitions = workflow_json.get("definitions", {})
    subgraphs = definitions.get("subgraphs", [])
    for subgraph in subgraphs:
        subgraph_nodes = subgraph.get("nodes", [])
        all_nodes.extend(subgraph_nodes)

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


def parse_huggingface_url(url: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract HuggingFace repo and path from URL.

    Args:
        url: HuggingFace URL

    Returns:
        Tuple of (repo_id, file_path) or (None, None) if not valid
    """
    parsed = parse_hf_url(url)
    if parsed:
        return parsed.get("repo"), parsed.get("filename")
    return None, None


def analyze_and_find_matches(
    workflow_json: Dict[str, Any],
    similarity_threshold: float = 0.0,
    max_matches_per_model: int = 10,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    force_rescan: bool = False,
) -> Dict[str, Any]:
    """
    Main entry point: analyze workflow and find matches for missing models.

    Args:
        workflow_json: Complete workflow JSON dictionary
        similarity_threshold: Minimum similarity score (0.0 to 1.0) for matches
        max_matches_per_model: Maximum number of matches to return per missing model
        force_rescan: If True, bypass the short-lived local model scan cache

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
    workflow_urls = extract_workflow_urls(workflow_json)
    log_debug(f"Extracted {len(workflow_urls)} URLs from workflow")

    if progress_callback:
        progress_callback(
            {
                "stage": "scanning",
                "message": "Scanning local model index...",
                "current": 0,
                "total": 0,
            }
        )

    # Analyze workflow to find all model references
    # Get available models
    available_models = get_model_files(force_rescan=force_rescan)
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
                "stage": "analyzing",
                "message": "Analyzing workflow nodes...",
                "current": 0,
                "total": 0,
            }
        )

    # Analyze workflow using the same already-scanned model list
    all_model_refs = analyze_workflow_models(
        workflow_json, available_models=available_models
    )

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
        filename = os.path.basename(original_path)

        url_info = get_workflow_url_info_for_filename(workflow_urls, filename)
        if url_info:
            missing["workflow_url"] = url_info.get("url", "")
            missing["workflow_model_url"] = url_info.get("model_url", "")
            missing["workflow_directory"] = url_info.get("directory", "")
            missing["url_source"] = url_info.get("source", "")

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

    total_matching_models = len(missing_models) + len(resolved_model_refs)
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

    def deduplicate_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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

    def find_local_matches_for_ref(model_ref: Dict[str, Any]) -> List[Dict[str, Any]]:
        target_for_matching = get_match_target(model_ref)
        if not target_for_matching:
            return []

        category = get_match_category(model_ref)
        cache_key = (target_for_matching, category)
        if cache_key in local_match_cache:
            return local_match_cache[cache_key]

        matches = find_matches(
            target_for_matching,
            get_candidates_for_category(category),
            threshold=similarity_threshold,
            max_results=max_matches_per_model,
        )
        deduplicated_matches = deduplicate_matches(matches)
        local_match_cache[cache_key] = deduplicated_matches
        return deduplicated_matches

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

        # Skip LoraManager lorAs that already exist locally (exists=True means no linking needed)
        is_lora_v2 = missing.get("is_lora_v2")
        exists = missing.get("exists")
        name = missing.get("name") or missing.get("original_path", "")
        log_debug(f"Checking {name}: is_lora_v2={is_lora_v2}, exists={exists}")

        if is_lora_v2 and exists:
            log_info(f"Skipping LoraManager lora {name} - already exists locally")
            continue

        missing_with_matches.append({
            **missing,
            "matches": find_local_matches_for_ref(missing),
        })

    resolved_with_matches = []
    total_resolved = len(resolved_model_refs)
    for index, resolved in enumerate(resolved_model_refs, start=1):
        if progress_callback:
            progress_callback(
                {
                    "stage": "matching",
                    "message": f"Analyzing resolved model {index} of {total_resolved}",
                    "current": total_missing + index,
                    "total": total_matching_models,
                    "model_name": resolved.get("name")
                    or resolved.get("original_path", ""),
                }
            )

        resolved_with_matches.append({
            **resolved,
            "matches": find_local_matches_for_ref(resolved),
        })

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
            "is_lora_v2": resolution.get("is_lora_v2"),  # Flag for LoraManager nodes
            "original_lora_name": resolution.get(
                "original_lora_name"
            ),  # Original lora name for LoraManager replacement
            "nested_key": resolution.get(
                "nested_key"
            ),  # For dict-type widgets (e.g. Power Lora Loader)
        }

        # If resolved_model provided, extract path if needed
        if "resolved_model" in resolution and resolution["resolved_model"]:
            resolved_model = resolution["resolved_model"]
            if "path" in resolved_model and not mapping.get("resolved_path"):
                mapping["resolved_path"] = resolved_model["path"]
            if "base_directory" in resolved_model:
                mapping["base_directory"] = resolved_model["base_directory"]

        mappings.append(mapping)

    # Update workflow
    updated_workflow = update_workflow_nodes(workflow_json, mappings)

    return updated_workflow


def get_resolution_summary(workflow_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Get summary of missing models and matches without applying resolutions.

    This is a convenience method that calls analyze_and_find_matches with defaults.

    Args:
        workflow_json: Complete workflow JSON dictionary

    Returns:
        Same format as analyze_and_find_matches
    """
    return analyze_and_find_matches(workflow_json)

"""
Workflow Analyzer Module

Extracts model references from workflow JSON and identifies missing models.
"""

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional

from .log_system import create_module_logger

log = create_module_logger(__name__)

_WORKFLOW_MODEL_INVENTORY_CACHE_TTL_SECONDS = 300.0
_WORKFLOW_MODEL_INVENTORY_CACHE_MAX_ENTRIES = 8
_WORKFLOW_MODEL_INVENTORY_CACHE_LOCK = threading.Lock()
_WORKFLOW_MODEL_INVENTORY_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()
from .workflow import analysis


def _build_workflow_node_cache(
    workflow_json: Dict[str, Any],
    model_refs: List[Dict[str, Any]],
) -> Dict[tuple[str, str, str], Dict[str, Any]]:
    fingerprints = analysis._get_workflow_node_fingerprints(workflow_json)
    refs_by_node: Dict[tuple[str, str, str], List[Dict[str, Any]]] = {
        key: [] for key in fingerprints
    }

    for ref in model_refs:
        is_top_level = ref.get("is_top_level") is not False
        key = (
            "top" if is_top_level else "subgraph",
            "" if is_top_level else str(ref.get("subgraph_id") or ""),
            str(ref.get("node_id")),
        )
        if key in refs_by_node:
            refs_by_node[key].append(ref)

    return {
        key: {
            "fingerprint": fingerprint,
            "refs": refs_by_node.get(key, []),
        }
        for key, fingerprint in fingerprints.items()
    }


def _get_workflow_model_inventory_cache_key(
    workflow_json: Dict[str, Any],
) -> str:
    serialized_workflow = json.dumps(
        analysis._normalize_workflow_analysis_value(workflow_json),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized_workflow.encode("utf-8")).hexdigest()


def invalidate_workflow_model_inventory_cache() -> None:
    """Clear shared workflow model analysis snapshots."""
    with _WORKFLOW_MODEL_INVENTORY_CACHE_LOCK:
        _WORKFLOW_MODEL_INVENTORY_CACHE.clear()


def get_workflow_model_inventory(
    workflow_json: Dict[str, Any],
    *,
    force_rescan: bool = False,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Return the shared base model inventory for a workflow.

    Missing Models and Loaded Models use this snapshot so the same unchanged
    workflow is not parsed separately by both endpoints. Callers must treat the
    returned lists as read-only.
    """
    from .scanner import get_model_files

    cache_key = _get_workflow_model_inventory_cache_key(workflow_json)
    promoted_context_key = analysis._get_promoted_widget_context_cache_key(workflow_json)
    current_node_fingerprints = analysis._get_workflow_node_fingerprints(workflow_json)
    now = time.monotonic()
    cached = None
    previous_inventory = None

    if force_rescan:
        invalidate_workflow_model_inventory_cache()
    else:
        with _WORKFLOW_MODEL_INVENTORY_CACHE_LOCK:
            expired_keys = [
                key
                for key, entry in _WORKFLOW_MODEL_INVENTORY_CACHE.items()
                if now - entry["created_at"]
                >= _WORKFLOW_MODEL_INVENTORY_CACHE_TTL_SECONDS
            ]
            for key in expired_keys:
                _WORKFLOW_MODEL_INVENTORY_CACHE.pop(key, None)

            cached = _WORKFLOW_MODEL_INVENTORY_CACHE.get(cache_key)
            if cached is not None:
                _WORKFLOW_MODEL_INVENTORY_CACHE.move_to_end(cache_key)
            else:
                best_score = 0
                for _, entry in reversed(
                    list(_WORKFLOW_MODEL_INVENTORY_CACHE.items())
                ):
                    if entry.get("promoted_context_key") != promoted_context_key:
                        continue
                    node_cache = entry.get("node_cache", {})
                    score = sum(
                        1
                        for key, fingerprint in current_node_fingerprints.items()
                        if node_cache.get(key, {}).get("fingerprint")
                        == fingerprint
                    )
                    if score > best_score:
                        best_score = score
                        previous_inventory = entry

    if cached is not None:
        model_refs = cached["model_refs"]
        if progress_callback:
            progress_callback(
                {
                    "stage": "analyzing",
                    "message": "Reusing shared workflow analysis...",
                    "current": len(cached.get("node_cache", {})),
                    "total": len(cached.get("node_cache", {})),
                    "cached": True,
                }
            )
        log.debug("Reusing shared workflow model analysis")
        return {
            "available_models": cached["available_models"],
            "model_refs": model_refs,
        }

    node_cache = {}
    analysis_stats = {}
    if previous_inventory is not None:
        available_models = previous_inventory["available_models"]
        model_refs = analysis.analyze_workflow_models(
            workflow_json,
            available_models=available_models,
            progress_callback=progress_callback,
            previous_node_cache=previous_inventory.get("node_cache", {}),
            node_cache_out=node_cache,
            analysis_stats=analysis_stats,
        )
    else:
        available_models = get_model_files(force_rescan=force_rescan)
        model_refs = analysis.analyze_workflow_models(
            workflow_json,
            available_models=available_models,
            progress_callback=progress_callback,
        )
        node_cache = _build_workflow_node_cache(workflow_json, model_refs)
        analysis_stats = {
            "total_nodes": len(node_cache),
            "reused_nodes": 0,
            "analyzed_nodes": len(node_cache),
        }

    with _WORKFLOW_MODEL_INVENTORY_CACHE_LOCK:
        expired_keys = [
            key
            for key, entry in _WORKFLOW_MODEL_INVENTORY_CACHE.items()
            if now - entry["created_at"]
            >= _WORKFLOW_MODEL_INVENTORY_CACHE_TTL_SECONDS
        ]
        for key in expired_keys:
            _WORKFLOW_MODEL_INVENTORY_CACHE.pop(key, None)

        _WORKFLOW_MODEL_INVENTORY_CACHE[cache_key] = {
            "created_at": time.monotonic(),
            "available_models": available_models,
            "model_refs": model_refs,
            "node_cache": node_cache,
            "promoted_context_key": promoted_context_key,
            "analysis_stats": analysis_stats,
        }
        _WORKFLOW_MODEL_INVENTORY_CACHE.move_to_end(cache_key)
        while (
            len(_WORKFLOW_MODEL_INVENTORY_CACHE)
            > _WORKFLOW_MODEL_INVENTORY_CACHE_MAX_ENTRIES
        ):
            _WORKFLOW_MODEL_INVENTORY_CACHE.popitem(last=False)

    return {
        "available_models": available_models,
        "model_refs": model_refs,
    }


def identify_missing_models(
    workflow_models: List[Dict[str, Any]], available_models: List[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Identify which models from the workflow are missing.
    Deduplicates by category and filename - same model file only appears once even if
    referenced by multiple nodes.

    Args:
        workflow_models: List of model references from analyze_workflow_models
        available_models: Optional list of available models (if None, checks via folder_paths)

    Returns:
        List of missing model references (deduplicated by category and filename).
        Each entry has 'all_node_refs' containing all node references for that model.
    """
    # Group missing models by category and filename to deduplicate workflow
    # references without merging unrelated model folders that happen to share a name.
    missing_by_model: Dict[tuple[str, str], Dict[str, Any]] = {}

    for model_ref in workflow_models:
        # If exists is False, it's missing
        if not model_ref.get("exists", False):
            filename = model_ref.get("original_path", "")
            category = model_ref.get("category", "")
            group_key = (str(category or ""), str(filename or ""))

            if group_key not in missing_by_model:
                # First occurrence - use this as the primary entry
                missing_by_model[group_key] = {
                    **model_ref,
                    "reference_count": 1,
                    "all_node_refs": [
                        model_ref.copy()
                    ],  # Track all nodes needing this model
                }
            else:
                # Duplicate - just add to the node refs list
                existing = missing_by_model[group_key]
                existing["all_node_refs"].append(model_ref.copy())
                existing["reference_count"] = len(existing["all_node_refs"])
                if model_ref.get("auto_download_capable"):
                    existing["auto_download_capable"] = True
                if model_ref.get("auto_download_candidate"):
                    existing["auto_download_candidate"] = True
                if model_ref.get("input_choice_matches_value"):
                    existing["input_choice_matches_value"] = True
                existing_source = str(existing.get("input_choice_source") or "").lower()
                model_source = str(model_ref.get("input_choice_source") or "").lower()
                if existing_source != "hybrid" and model_source in {
                    "static",
                    "hybrid",
                    "workflow_schema",
                }:
                    existing["input_choice_source"] = model_source

    # Return deduplicated list
    return list(missing_by_model.values())

"""Workflow traversal, incremental analysis, and model reference aggregation."""

import hashlib
import json
from typing import Any, Callable, Dict, List, Optional

from ..log_system import create_module_logger
from . import references
from . import subgraphs as subgraph_utils

log = create_module_logger(__name__)

_WORKFLOW_MODEL_INVENTORY_IGNORED_NODE_KEYS = {
    "bgcolor",
    "color",
    "flags",
    "order",
    "pos",
    "shape",
    "size",
}

def _normalize_workflow_analysis_value(value: Any) -> Any:
    if isinstance(value, dict):
        is_node = "id" in value and "type" in value
        return {
            key: _normalize_workflow_analysis_value(item)
            for key, item in value.items()
            if not (
                is_node
                and key in _WORKFLOW_MODEL_INVENTORY_IGNORED_NODE_KEYS
            )
        }
    if isinstance(value, list):
        return [_normalize_workflow_analysis_value(item) for item in value]
    return value


def _get_workflow_node_cache_key(
    node: Dict[str, Any],
    *,
    subgraph_id: Any = "",
    is_top_level: bool,
) -> tuple[str, str, str]:
    scope = "top" if is_top_level else "subgraph"
    return (scope, "" if is_top_level else str(subgraph_id or ""), str(node.get("id")))


def _get_workflow_node_fingerprint(node: Dict[str, Any]) -> str:
    serialized_node = json.dumps(
        _normalize_workflow_analysis_value(node),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized_node.encode("utf-8")).hexdigest()


def _get_workflow_node_fingerprints(
    workflow_json: Dict[str, Any],
) -> Dict[tuple[str, str, str], str]:
    fingerprints = {}
    nodes = workflow_json.get("nodes", [])
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict):
                continue
            key = _get_workflow_node_cache_key(node, is_top_level=True)
            fingerprints[key] = _get_workflow_node_fingerprint(node)

    definitions = workflow_json.get("definitions", {})
    subgraphs = definitions.get("subgraphs", []) if isinstance(definitions, dict) else []
    if not isinstance(subgraphs, list):
        return fingerprints

    for subgraph in subgraphs:
        if not isinstance(subgraph, dict):
            continue
        subgraph_id = subgraph.get("id")
        subgraph_nodes = subgraph.get("nodes", [])
        if not isinstance(subgraph_nodes, list):
            continue
        for node in subgraph_nodes:
            if not isinstance(node, dict):
                continue
            key = _get_workflow_node_cache_key(
                node,
                subgraph_id=subgraph_id,
                is_top_level=False,
            )
            fingerprints[key] = _get_workflow_node_fingerprint(node)

    return fingerprints


def _order_nodes_for_incremental_analysis(
    nodes: List[Dict[str, Any]],
    previous_node_cache: Optional[
        Dict[tuple[str, str, str], Dict[str, Any]]
    ],
    *,
    subgraph_id: Any = "",
    is_top_level: bool,
) -> List[Dict[str, Any]]:
    """Keep existing nodes in their previous result positions during refreshes."""
    if previous_node_cache is None or len(nodes) < 2:
        return nodes

    previous_positions = {
        key: index for index, key in enumerate(previous_node_cache)
    }
    existing_nodes = []
    new_nodes = []

    for current_index, node in enumerate(nodes):
        if not isinstance(node, dict):
            new_nodes.append((current_index, node))
            continue
        node_key = _get_workflow_node_cache_key(
            node,
            subgraph_id=subgraph_id,
            is_top_level=is_top_level,
        )
        previous_position = previous_positions.get(node_key)
        if previous_position is None:
            new_nodes.append((current_index, node))
        else:
            existing_nodes.append((previous_position, current_index, node))

    existing_nodes.sort(key=lambda item: (item[0], item[1]))
    new_nodes.sort(key=lambda item: item[0])
    return [
        node for _, _, node in existing_nodes
    ] + [
        node for _, node in new_nodes
    ]


def _get_promoted_widget_context_cache_key(
    workflow_json: Dict[str, Any],
) -> str:
    definitions = workflow_json.get("definitions", {})
    subgraphs = definitions.get("subgraphs", []) if isinstance(definitions, dict) else []
    if not isinstance(subgraphs, list):
        subgraphs = []

    subgraph_ids = {
        str(subgraph.get("id"))
        for subgraph in subgraphs
        if isinstance(subgraph, dict) and subgraph.get("id")
    }
    context_subgraphs = []
    for subgraph in subgraphs:
        if not isinstance(subgraph, dict):
            continue
        context_nodes = []
        nodes = subgraph.get("nodes", [])
        if isinstance(nodes, list):
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                widgets_values = node.get("widgets_values", [])
                context_node = {
                    **node,
                    "widgets_values": (
                        list(widgets_values)
                        if isinstance(widgets_values, list)
                        else []
                    ),
                }
                context_nodes.append(
                    _normalize_workflow_analysis_value(context_node)
                )
        context_subgraph = {
            key: value
            for key, value in subgraph.items()
            if key != "nodes"
        }
        context_subgraphs.append(
            _normalize_workflow_analysis_value(
                {
                    **context_subgraph,
                    "nodes": context_nodes,
                }
            )
        )

    context_instances = []
    nodes = workflow_json.get("nodes", [])
    if isinstance(nodes, list):
        for node in nodes:
            if not isinstance(node, dict) or str(node.get("type")) not in subgraph_ids:
                continue
            context_instances.append(
                _normalize_workflow_analysis_value(node)
            )

    serialized_context = json.dumps(
        {
            "subgraphs": context_subgraphs,
            "instances": context_instances,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized_context.encode("utf-8")).hexdigest()


def analyze_workflow_models(
    workflow_json: Dict[str, Any],
    available_models: Optional[List[Dict[str, Any]]] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    *,
    previous_node_cache: Optional[
        Dict[tuple[str, str, str], Dict[str, Any]]
    ] = None,
    node_cache_out: Optional[
        Dict[tuple[str, str, str], Dict[str, Any]]
    ] = None,
    analysis_stats: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    """
    Extract all model references from a workflow, including nested subgraphs.

    Args:
        workflow_json: Complete workflow JSON dictionary
        available_models: Optional list of local model records for existence checks
        progress_callback: Optional callback called while workflow nodes are scanned

    Returns:
        List of model reference dictionaries (same format as get_node_model_info)
        Each dict includes 'subgraph_id' if the model is in a subgraph
    """
    all_model_refs = []
    reused_nodes = 0
    analyzed_nodes = 0

    # Get subgraph definitions first to check if node types are subgraph UUIDs
    definitions = workflow_json.get("definitions", {})
    subgraphs = definitions.get("subgraphs", [])
    if not isinstance(subgraphs, list):
        subgraphs = []
    subgraph_lookup = {
        sg.get("id"): sg.get("name", sg.get("id"))
        for sg in subgraphs
        if isinstance(sg, dict)
    }
    promoted_widget_contexts = subgraph_utils._build_promoted_widget_contexts(
        workflow_json, subgraphs
    )
    promoted_instance_slots = set()

    # Analyze top-level nodes
    nodes = workflow_json.get("nodes", [])
    if not isinstance(nodes, list):
        nodes = []
    nodes = _order_nodes_for_incremental_analysis(
        nodes,
        previous_node_cache,
        is_top_level=True,
    )
    total_nodes = len(nodes) + sum(
        len(subgraph_nodes)
        for subgraph in subgraphs
        if isinstance(subgraph, dict)
        for subgraph_nodes in [subgraph.get("nodes", [])]
        if isinstance(subgraph_nodes, list)
    )
    processed_nodes = 0

    def report_node_progress(
        node: Dict[str, Any],
        subgraph_name: Optional[str] = None,
        *,
        reused: bool = False,
    ) -> None:
        nonlocal processed_nodes
        processed_nodes += 1
        if not progress_callback:
            return

        node_type = node.get("type", "")
        payload = {
            "stage": "analyzing",
            "message": f"Analyzing workflow node {processed_nodes} of {total_nodes}",
            "current": processed_nodes,
            "total": total_nodes,
            "node_id": node.get("id"),
            "node_type": node_type,
        }
        if reused:
            payload["message"] = (
                f"Reusing workflow node {processed_nodes} of {total_nodes}"
            )
            payload["cached"] = True
        if subgraph_name:
            payload["subgraph_name"] = subgraph_name
            payload["message"] = (
                f"{'Reusing' if reused else 'Analyzing'} subgraph node "
                f"{processed_nodes} of {total_nodes}"
            )

        try:
            progress_callback(payload)
        except Exception as e:
            log.debug(f"Workflow analysis progress callback failed: {e}")

    for node in nodes:
        try:
            node_cache_key = _get_workflow_node_cache_key(
                node,
                is_top_level=True,
            )
            node_fingerprint = _get_workflow_node_fingerprint(node)
            cached_node = (
                previous_node_cache.get(node_cache_key)
                if previous_node_cache is not None
                else None
            )
            reused = bool(
                cached_node
                and cached_node.get("fingerprint") == node_fingerprint
            )
            if reused:
                base_model_refs = cached_node.get("refs", [])
                reused_nodes += 1
            else:
                base_model_refs = references.get_node_model_info(
                    node,
                    available_models=available_models,
                )
                analyzed_nodes += 1
            # Keep cached node references as raw extraction results. Subgraph
            # instance context is workflow-level state and must be reapplied
            # when a cached node is reused.
            model_refs = [dict(ref) for ref in base_model_refs]
            node_type = node.get("type", "")

            # Check if node type is a subgraph UUID
            subgraph_name = None
            subgraph_id = None
            if node_type in subgraph_lookup:
                subgraph_name = subgraph_lookup[node_type]
                subgraph_id = node_type

            # Mark with subgraph info if it's a subgraph node
            # For top-level subgraph instance nodes, subgraph_path is None
            # This distinguishes them from nodes within subgraph definitions
            if subgraph_id:
                for ref in model_refs:
                    context = promoted_widget_contexts.get(
                        "instance_widgets", {}
                    ).get((str(node.get("id")), ref.get("widget_index")))
                    if context:
                        promoted_instance_slots.add(
                            (str(node.get("id")), ref.get("widget_index"))
                        )
                        subgraph_utils._apply_instance_promoted_widget_context(
                            ref, context, available_models
                        )
            for ref in model_refs:
                ref["subgraph_id"] = subgraph_id
                ref["subgraph_name"] = subgraph_name
                ref["subgraph_path"] = None
                ref["is_top_level"] = True
            if node_cache_out is not None:
                node_cache_out[node_cache_key] = {
                    "fingerprint": node_fingerprint,
                    "refs": base_model_refs,
                }
            report_node_progress(node, reused=reused)
            all_model_refs.extend(model_refs)
        except Exception as e:
            log.warning(f"Error analyzing node {node.get('id', 'unknown')}: {e}")
            continue

    # Recursively analyze subgraphs
    for subgraph in subgraphs:
        if not isinstance(subgraph, dict):
            continue
        subgraph_id = subgraph.get("id")
        subgraph_name = subgraph.get("name", subgraph_id)
        subgraph_nodes = subgraph.get("nodes", [])
        if not isinstance(subgraph_nodes, list):
            subgraph_nodes = []
        subgraph_nodes = _order_nodes_for_incremental_analysis(
            subgraph_nodes,
            previous_node_cache,
            subgraph_id=subgraph_id,
            is_top_level=False,
        )

        analyzed_subgraph_nodes = 0

        for node in subgraph_nodes:
            try:
                node_cache_key = _get_workflow_node_cache_key(
                    node,
                    subgraph_id=subgraph_id,
                    is_top_level=False,
                )
                node_fingerprint = _get_workflow_node_fingerprint(node)
                cached_node = (
                    previous_node_cache.get(node_cache_key)
                    if previous_node_cache is not None
                    else None
                )
                reused = bool(
                    cached_node
                    and cached_node.get("fingerprint") == node_fingerprint
                )
                if reused:
                    base_model_refs = cached_node.get("refs", [])
                    reused_nodes += 1
                else:
                    base_model_refs = references.get_node_model_info(
                        node,
                        available_models=available_models,
                    )
                    analyzed_nodes += 1
                    analyzed_subgraph_nodes += 1
                model_refs = []
                for base_ref in base_model_refs:
                    scoped_ref = dict(base_ref)
                    scoped_ref["subgraph_id"] = subgraph_id
                    scoped_ref["subgraph_name"] = subgraph_name
                    scoped_ref["subgraph_path"] = [
                        "definitions",
                        "subgraphs",
                        subgraph_id,
                        "nodes",
                    ]
                    scoped_ref["is_top_level"] = False
                    promoted_refs = subgraph_utils._promote_model_reference_to_instances(
                        scoped_ref,
                        promoted_widget_contexts,
                        available_models,
                        promoted_instance_slots,
                    )
                    if promoted_refs is not None:
                        model_refs.extend(promoted_refs)
                        continue

                    ref = scoped_ref
                    subgraph_utils._apply_promoted_widget_locator(
                        ref,
                        promoted_widget_contexts,
                    )
                    model_refs.append(ref)
                if node_cache_out is not None:
                    node_cache_out[node_cache_key] = {
                        "fingerprint": node_fingerprint,
                        "refs": base_model_refs,
                    }
                report_node_progress(
                    node,
                    subgraph_name,
                    reused=reused,
                )
                all_model_refs.extend(model_refs)
            except Exception as e:
                log.warning(
                    f"Error analyzing subgraph node {node.get('id', 'unknown')}: {e}"
                )
                continue

        if analyzed_subgraph_nodes:
            log.debug(
                f"Analyzing subgraph: {subgraph_name} (ID: {subgraph_id}) "
                f"with {analyzed_subgraph_nodes} changed nodes"
            )

    if analysis_stats is not None:
        analysis_stats.update(
            {
                "total_nodes": reused_nodes + analyzed_nodes,
                "reused_nodes": reused_nodes,
                "analyzed_nodes": analyzed_nodes,
            }
        )

    if previous_node_cache is not None:
        log.debug(
            f"Incremental workflow analysis: analyzed {analyzed_nodes} nodes, "
            f"reused {reused_nodes} nodes"
        )

    return all_model_refs

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

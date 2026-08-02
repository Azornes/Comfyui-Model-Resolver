"""
Workflow Analyzer Module

Extracts model references from workflow JSON and identifies missing models.
"""

import hashlib
import json
import os
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
_WORKFLOW_MODEL_INVENTORY_IGNORED_NODE_KEYS = {
    "bgcolor",
    "color",
    "flags",
    "order",
    "pos",
    "shape",
    "size",
}


from .workflow import references
from .workflow.widgets import (
    _has_widget_input,
    _proxy_widget_name,
    _proxy_widget_node_id,
    _widget_item_name_candidates,
    get_widget_name_candidates,
    get_widget_name_hint,
    normalize_widget_name,
)


def _get_node_by_id(nodes: List[Dict[str, Any]], node_id: Any) -> Optional[Dict[str, Any]]:
    node_id_text = str(node_id)
    for node in nodes:
        if str(node.get("id")) == node_id_text:
            return node
    return None


def _get_widget_index_for_input_index(
    node: Dict[str, Any], input_index: int
) -> Optional[int]:
    widget_index = -1
    for idx, item in enumerate(node.get("inputs", [])):
        if _has_widget_input(item):
            widget_index += 1
        if idx == input_index:
            return widget_index if _has_widget_input(item) else None
    return None


def _get_widget_index_by_name(
    node: Dict[str, Any], widget_name: str
) -> Optional[int]:
    target_name = normalize_widget_name(widget_name)
    if not target_name:
        return None

    widgets_values = node.get("widgets_values", [])
    for widget_index in range(len(widgets_values)):
        candidates = get_widget_name_candidates(node, widget_index)
        if any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            return widget_index

    for input_index, item in enumerate(node.get("inputs", [])):
        if not _has_widget_input(item):
            continue
        candidates = _widget_item_name_candidates(item)
        if any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            return _get_widget_index_for_input_index(node, input_index)

    return None


def _get_subgraph_input_link_ids(subgraph: Dict[str, Any], input_name: str) -> set:
    target_name = normalize_widget_name(input_name)
    if not target_name:
        return set()

    link_ids = set()
    for subgraph_input in subgraph.get("inputs", []):
        candidates = _widget_item_name_candidates(subgraph_input)
        if not any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            continue
        for link_id in subgraph_input.get("linkIds", []) or []:
            link_ids.add(str(link_id))
    return link_ids


def _promoted_widget_target_info(
    node: Dict[str, Any], widget_index: int, proxy_widget_name: str = ""
) -> Dict[str, Any]:
    widget_name = get_widget_name_hint(node, widget_index) or proxy_widget_name
    return {
        "node_id": node.get("id"),
        "node_type": node.get("type", ""),
        "node_title": str(node.get("title", "") or "").strip(),
        "widget_index": widget_index,
        "widget_name": widget_name,
        "category": references.get_effective_model_category_hint(node, widget_index),
    }


def _find_promoted_widget_targets(
    subgraph: Dict[str, Any], proxy_node_id: str, proxy_widget_name: str
) -> List[Dict[str, Any]]:
    nodes = subgraph.get("nodes", [])
    targets: List[Dict[str, Any]] = []
    seen = set()

    def add_target(node: Optional[Dict[str, Any]], widget_index: Optional[int]):
        if node is None or widget_index is None:
            return
        key = (str(node.get("id")), int(widget_index))
        if key in seen:
            return
        seen.add(key)
        targets.append(_promoted_widget_target_info(node, widget_index, proxy_widget_name))

    if proxy_node_id and proxy_node_id != "-1":
        target_node = _get_node_by_id(nodes, proxy_node_id)
        add_target(target_node, _get_widget_index_by_name(target_node or {}, proxy_widget_name))
        return targets

    link_ids = _get_subgraph_input_link_ids(subgraph, proxy_widget_name)
    if link_ids:
        for node in nodes:
            for input_index, item in enumerate(node.get("inputs", [])):
                if not _has_widget_input(item):
                    continue
                if str(item.get("link")) not in link_ids:
                    continue
                add_target(node, _get_widget_index_for_input_index(node, input_index))

    if targets:
        return targets

    for node in nodes:
        add_target(node, _get_widget_index_by_name(node, proxy_widget_name))

    return targets


def _build_promoted_widget_contexts(
    workflow_json: Dict[str, Any], subgraphs: List[Dict[str, Any]]
) -> Dict[str, Dict[Any, Any]]:
    subgraphs_by_id = {str(sg.get("id")): sg for sg in subgraphs if sg.get("id")}
    subgraph_names = {
        str(sg.get("id")): sg.get("name", sg.get("id"))
        for sg in subgraphs
        if sg.get("id")
    }
    contexts = {
        "instance_widgets": {},
        "inner_widgets": {},
        "inner_widget_names": {},
    }

    for instance_node in workflow_json.get("nodes", []):
        subgraph_id = str(instance_node.get("type", ""))
        subgraph = subgraphs_by_id.get(subgraph_id)
        if not subgraph:
            continue

        proxy_widgets = instance_node.get("properties", {}).get("proxyWidgets", [])
        if not isinstance(proxy_widgets, list):
            continue

        widgets_values = instance_node.get("widgets_values", [])
        for proxy_index, proxy_entry in enumerate(proxy_widgets):
            proxy_widget_name = _proxy_widget_name(proxy_entry)
            if not proxy_widget_name:
                continue

            targets = _find_promoted_widget_targets(
                subgraph,
                _proxy_widget_node_id(proxy_entry),
                proxy_widget_name,
            )
            if not targets:
                continue

            promoted_value = (
                widgets_values[proxy_index]
                if isinstance(widgets_values, list) and proxy_index < len(widgets_values)
                else None
            )
            instance_context = {
                **targets[0],
                "subgraph_id": subgraph_id,
                "subgraph_name": subgraph_names.get(subgraph_id, subgraph_id),
                "proxy_widget_index": proxy_index,
                "proxy_widget_name": proxy_widget_name,
                "promoted_value": promoted_value,
            }
            contexts["instance_widgets"][(str(instance_node.get("id")), proxy_index)] = (
                instance_context
            )

            locator = {
                "node_id": instance_node.get("id"),
                "node_type": instance_node.get("type", ""),
                "node_title": str(instance_node.get("title", "") or "").strip(),
                "subgraph_id": subgraph_id,
                "subgraph_name": subgraph_names.get(subgraph_id, subgraph_id),
                "is_top_level": True,
                "proxy_widget_index": proxy_index,
                "proxy_widget_name": proxy_widget_name,
                "promoted_value": promoted_value,
            }

            for target in targets:
                exact_key = (
                    subgraph_id,
                    str(target.get("node_id")),
                    target.get("widget_index"),
                )
                contexts["inner_widgets"].setdefault(exact_key, []).append(locator)

                widget_name = normalize_widget_name(target.get("widget_name"))
                if widget_name:
                    name_key = (subgraph_id, str(target.get("node_id")), widget_name)
                    contexts["inner_widget_names"].setdefault(name_key, []).append(locator)

    return contexts


def _apply_instance_promoted_widget_context(
    ref: Dict[str, Any],
    context: Optional[Dict[str, Any]],
    available_models: Optional[List[Dict[str, Any]]],
) -> None:
    if not context:
        return

    ref["promoted_widget_name"] = context.get("proxy_widget_name", "")
    ref["promoted_inner_node_id"] = context.get("node_id")
    ref["promoted_inner_node_type"] = context.get("node_type", "")
    ref["promoted_inner_node_title"] = context.get("node_title", "")
    ref["promoted_inner_widget_index"] = context.get("widget_index")
    ref["promoted_inner_widget_name"] = context.get("widget_name", "")

    category = context.get("category")
    original_path = ref.get("original_path", "")
    if not category or not original_path:
        return

    resolved = references.try_resolve_model_path(
        original_path,
        [category],
        available_models=available_models,
    )
    ref["category"] = category
    if resolved:
        _, full_path = resolved
        ref["full_path"] = full_path
        ref["exists"] = os.path.exists(full_path)
    else:
        ref["full_path"] = None
        ref["exists"] = False


def _select_promoted_locator(
    locators: List[Dict[str, Any]], original_path: str
) -> Optional[Dict[str, Any]]:
    if not locators:
        return None

    for locator in locators:
        if locator.get("promoted_value") == original_path:
            return locator
    return locators[0]


def _apply_promoted_widget_locator(
    ref: Dict[str, Any], contexts: Dict[str, Dict[Any, Any]]
) -> None:
    subgraph_id = str(ref.get("subgraph_id") or "")
    if not subgraph_id:
        return

    exact_key = (subgraph_id, str(ref.get("node_id")), ref.get("widget_index"))
    locators = contexts.get("inner_widgets", {}).get(exact_key, [])
    if not locators and ref.get("widget_name"):
        name_key = (
            subgraph_id,
            str(ref.get("node_id")),
            normalize_widget_name(ref.get("widget_name")),
        )
        locators = contexts.get("inner_widget_names", {}).get(name_key, [])

    locator = _select_promoted_locator(locators, ref.get("original_path", ""))
    if not locator:
        return

    ref["locate_node_id"] = locator.get("node_id")
    ref["locate_node_type"] = locator.get("node_type", "")
    ref["locate_node_title"] = locator.get("node_title", "")
    ref["locate_subgraph_id"] = ""
    ref["locate_subgraph_name"] = locator.get("subgraph_name", "")
    ref["locate_is_top_level"] = True
    ref["locate_via_promoted_widget"] = True


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
                        [None] * len(widgets_values)
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
    promoted_widget_contexts = _build_promoted_widget_contexts(
        workflow_json, subgraphs
    )

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
                model_refs = cached_node.get("refs", [])
                reused_nodes += 1
            else:
                model_refs = references.get_node_model_info(
                    node,
                    available_models=available_models,
                )
                analyzed_nodes += 1
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
            if not reused:
                for ref in model_refs:
                    ref["subgraph_id"] = subgraph_id
                    ref["subgraph_name"] = subgraph_name
                    ref["subgraph_path"] = None
                    ref["is_top_level"] = True
                    if subgraph_id:
                        context = promoted_widget_contexts.get(
                            "instance_widgets", {}
                        ).get((str(node.get("id")), ref.get("widget_index")))
                        _apply_instance_promoted_widget_context(
                            ref, context, available_models
                        )
            if node_cache_out is not None:
                node_cache_out[node_cache_key] = {
                    "fingerprint": node_fingerprint,
                    "refs": model_refs,
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
                    model_refs = cached_node.get("refs", [])
                    reused_nodes += 1
                else:
                    model_refs = references.get_node_model_info(
                        node,
                        available_models=available_models,
                    )
                    analyzed_nodes += 1
                    analyzed_subgraph_nodes += 1
                    for ref in model_refs:
                        ref["subgraph_id"] = subgraph_id
                        ref["subgraph_name"] = subgraph_name
                        ref["subgraph_path"] = [
                            "definitions",
                            "subgraphs",
                            subgraph_id,
                            "nodes",
                        ]
                        ref["is_top_level"] = False
                        _apply_promoted_widget_locator(
                            ref,
                            promoted_widget_contexts,
                        )
                if node_cache_out is not None:
                    node_cache_out[node_cache_key] = {
                        "fingerprint": node_fingerprint,
                        "refs": model_refs,
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


def _build_workflow_node_cache(
    workflow_json: Dict[str, Any],
    model_refs: List[Dict[str, Any]],
) -> Dict[tuple[str, str, str], Dict[str, Any]]:
    fingerprints = _get_workflow_node_fingerprints(workflow_json)
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
        _normalize_workflow_analysis_value(workflow_json),
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
    promoted_context_key = _get_promoted_widget_context_cache_key(workflow_json)
    current_node_fingerprints = _get_workflow_node_fingerprints(workflow_json)
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
        model_refs = analyze_workflow_models(
            workflow_json,
            available_models=available_models,
            progress_callback=progress_callback,
            previous_node_cache=previous_inventory.get("node_cache", {}),
            node_cache_out=node_cache,
            analysis_stats=analysis_stats,
        )
    else:
        available_models = get_model_files(force_rescan=force_rescan)
        model_refs = analyze_workflow_models(
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

"""Subgraph traversal and promoted-widget context handling."""

import os
from typing import Any, Dict, List, Optional

from . import references
from .widgets import (
    _has_widget_input,
    _proxy_widget_name,
    _proxy_widget_node_id,
    _widget_item_name_candidates,
    get_widget_name_candidates,
    get_widget_name_hint,
    normalize_widget_name,
)


def _get_node_by_id(
    nodes: List[Dict[str, Any]], node_id: Any
) -> Optional[Dict[str, Any]]:
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
        if any(
            normalize_widget_name(candidate) == target_name for candidate in candidates
        ):
            return widget_index

    for input_index, item in enumerate(node.get("inputs", [])):
        if not _has_widget_input(item):
            continue
        candidates = _widget_item_name_candidates(item)
        if any(
            normalize_widget_name(candidate) == target_name for candidate in candidates
        ):
            return _get_widget_index_for_input_index(node, input_index)

    return None


def _get_subgraph_input_link_ids(subgraph: Dict[str, Any], input_name: str) -> set:
    target_name = normalize_widget_name(input_name)
    if not target_name:
        return set()

    link_ids = set()
    for subgraph_input in subgraph.get("inputs", []):
        candidates = _widget_item_name_candidates(subgraph_input)
        if not any(
            normalize_widget_name(candidate) == target_name for candidate in candidates
        ):
            continue
        for link_id in subgraph_input.get("linkIds", []) or []:
            link_ids.add(str(link_id))
    return link_ids


def _get_node_input_by_name(
    node: Dict[str, Any], input_name: str
) -> Optional[Dict[str, Any]]:
    target_name = normalize_widget_name(input_name)
    if not target_name:
        return None

    for item in node.get("inputs", []):
        candidates = _widget_item_name_candidates(item)
        if any(
            normalize_widget_name(candidate) == target_name for candidate in candidates
        ):
            return item
    return None


def _get_node_widget_value(node: Dict[str, Any], widget_index: Any) -> Any:
    try:
        widget_index = int(widget_index)
    except (TypeError, ValueError):
        return None

    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list) or widget_index < 0:
        return None
    if widget_index >= len(widgets_values):
        return None
    return widgets_values[widget_index]


def _has_promoted_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


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
        "value": _get_node_widget_value(node, widget_index),
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
        targets.append(
            _promoted_widget_target_info(node, widget_index, proxy_widget_name)
        )

    if proxy_node_id and proxy_node_id != "-1":
        target_node = _get_node_by_id(nodes, proxy_node_id)
        add_target(
            target_node,
            _get_widget_index_by_name(target_node or {}, proxy_widget_name),
        )
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
            proxy_widgets = []

        seen_proxy_indexes = set()
        seen_proxy_names = set()

        def add_instance_context(
            proxy_index: Optional[int],
            proxy_widget_name: str,
            targets: List[Dict[str, Any]],
        ) -> None:
            if proxy_index is None or not proxy_widget_name or not targets:
                return
            if proxy_index in seen_proxy_indexes:
                return

            instance_input = _get_node_input_by_name(
                instance_node, proxy_widget_name
            )
            input_connected = bool(
                instance_input and instance_input.get("link") is not None
            )
            instance_value = _get_node_widget_value(instance_node, proxy_index)
            target_value = targets[0].get("value")
            promoted_value = (
                instance_value
                if _has_promoted_value(instance_value)
                else target_value
            )
            instance_context = {
                **targets[0],
                "subgraph_id": subgraph_id,
                "subgraph_name": subgraph_names.get(subgraph_id, subgraph_id),
                "proxy_widget_index": proxy_index,
                "proxy_widget_name": proxy_widget_name,
                "promoted_value": promoted_value,
                "input_connected": input_connected,
            }
            contexts["instance_widgets"][
                (str(instance_node.get("id")), proxy_index)
            ] = instance_context

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
                "input_connected": input_connected,
            }

            seen_proxy_indexes.add(proxy_index)
            seen_proxy_names.add(normalize_widget_name(proxy_widget_name))
            for target in targets:
                exact_key = (
                    subgraph_id,
                    str(target.get("node_id")),
                    target.get("widget_index"),
                )
                contexts["inner_widgets"].setdefault(exact_key, []).append(locator)

                widget_name = normalize_widget_name(target.get("widget_name"))
                if widget_name:
                    name_key = (
                        subgraph_id,
                        str(target.get("node_id")),
                        widget_name,
                    )
                    contexts["inner_widget_names"].setdefault(name_key, []).append(
                        locator
                    )

        for proxy_index, proxy_entry in enumerate(proxy_widgets):
            proxy_widget_name = _proxy_widget_name(proxy_entry)
            if not proxy_widget_name:
                continue

            targets = _find_promoted_widget_targets(
                subgraph,
                _proxy_widget_node_id(proxy_entry),
                proxy_widget_name,
            )
            add_instance_context(proxy_index, proxy_widget_name, targets)

        # Some serialized workflows omit proxyWidgets even though a subgraph
        # input is connected to a widget inside the definition. Reconstruct the
        # same promotion from the subgraph input/link metadata in that case.
        instance_inputs = instance_node.get("inputs", [])
        if not isinstance(instance_inputs, list):
            instance_inputs = []
        for subgraph_input in subgraph.get("inputs", []):
            input_names = _widget_item_name_candidates(subgraph_input)
            proxy_widget_name = next(
                (name for name in input_names if str(name or "").strip()),
                "",
            )
            if not proxy_widget_name:
                continue
            if normalize_widget_name(proxy_widget_name) in seen_proxy_names:
                continue

            instance_input_index = next(
                (
                    index
                    for index, item in enumerate(instance_inputs)
                    if _get_node_input_by_name(
                        {"inputs": [item]}, proxy_widget_name
                    )
                ),
                None,
            )
            if instance_input_index is None:
                continue
            proxy_index = _get_widget_index_for_input_index(
                instance_node, instance_input_index
            )
            targets = _find_promoted_widget_targets(
                subgraph, "-1", proxy_widget_name
            )
            add_instance_context(proxy_index, proxy_widget_name, targets)

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


def _get_promoted_widget_locators(
    ref: Dict[str, Any], contexts: Dict[str, Dict[Any, Any]]
) -> List[Dict[str, Any]]:
    subgraph_id = str(ref.get("subgraph_id") or "")
    if not subgraph_id:
        return []

    exact_key = (subgraph_id, str(ref.get("node_id")), ref.get("widget_index"))
    locators = contexts.get("inner_widgets", {}).get(exact_key, [])
    if not locators and ref.get("widget_name"):
        name_key = (
            subgraph_id,
            str(ref.get("node_id")),
            normalize_widget_name(ref.get("widget_name")),
        )
        locators = contexts.get("inner_widget_names", {}).get(name_key, [])
    return locators


def _promote_model_reference_to_instances(
    ref: Dict[str, Any],
    contexts: Dict[str, Dict[Any, Any]],
    available_models: Optional[List[Dict[str, Any]]] = None,
    existing_instance_slots: Optional[set] = None,
) -> Optional[List[Dict[str, Any]]]:
    locators = _get_promoted_widget_locators(ref, contexts)
    if not locators:
        return None

    if existing_instance_slots is None:
        existing_instance_slots = set()
    promoted_refs = []
    for locator in locators:
        instance_slot = (
            str(locator.get("node_id")),
            locator.get("proxy_widget_index"),
        )
        if instance_slot in existing_instance_slots:
            continue
        if locator.get("input_connected"):
            continue

        value = locator.get("promoted_value")
        nested_key = ref.get("nested_key")
        if nested_key and isinstance(value, dict):
            value = value.get(nested_key)
        if not _has_promoted_value(value):
            continue

        value_str = str(value).strip()
        promoted = dict(ref)
        promoted.update(
            {
                "node_id": locator.get("node_id"),
                "node_type": locator.get("node_type", ""),
                "node_title": locator.get("node_title", ""),
                "widget_index": locator.get("proxy_widget_index"),
                "widget_name": locator.get("proxy_widget_name", ""),
                "original_path": value_str,
                "subgraph_id": locator.get("subgraph_id", ""),
                "subgraph_name": locator.get("subgraph_name", ""),
                "subgraph_path": None,
                "is_top_level": True,
                "promoted_widget_name": locator.get("proxy_widget_name", ""),
                "promoted_inner_node_id": ref.get("node_id"),
                "promoted_inner_node_type": ref.get("node_type", ""),
                "promoted_inner_node_title": ref.get("node_title", ""),
                "promoted_inner_widget_index": ref.get("widget_index"),
                "promoted_inner_widget_name": ref.get("widget_name", ""),
                "locate_node_id": locator.get("node_id"),
                "locate_node_type": locator.get("node_type", ""),
                "locate_node_title": locator.get("node_title", ""),
                "locate_subgraph_id": "",
                "locate_subgraph_name": locator.get("subgraph_name", ""),
                "locate_is_top_level": True,
                "locate_via_promoted_widget": True,
                "is_urn": bool(references.URN_REGEX.match(value_str)),
            }
        )

        category_hints = promoted.get("category_hints") or []
        if not category_hints and promoted.get("category"):
            category_hints = [promoted["category"]]
        resolved = references.try_resolve_model_path(
            value_str,
            category_hints or None,
            available_models=available_models,
        )
        if resolved:
            category, full_path = resolved
            promoted["category"] = category
            promoted["full_path"] = full_path
            promoted["exists"] = os.path.exists(full_path)
        else:
            promoted["full_path"] = None
            promoted["exists"] = False

        promoted_refs.append(promoted)
        existing_instance_slots.add(instance_slot)

    return promoted_refs


def _apply_promoted_widget_locator(
    ref: Dict[str, Any], contexts: Dict[str, Dict[Any, Any]]
) -> None:
    locators = _get_promoted_widget_locators(ref, contexts)
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

"""Transfer model selections from one workflow metadata source to another."""

import math
import os
import re
from collections import OrderedDict
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any, Dict, List, Optional

from .contracts import ModelReference, Resolution, ResolvedModel
from .custom_nodes import get_custom_node_resolution_metadata
from .path_utils import get_filename_from_path
from .workflow import dynamic_widgets
from .workflow.widgets import get_widget_name_candidates, normalize_widget_name
from .workflow_updater import update_model_path

_CATEGORY_ALIASES = {
    "checkpoint": "checkpoints",
    "checkpoints": "checkpoints",
    "ckpt": "checkpoints",
    "lora": "loras",
    "loras": "loras",
    "text_encoder": "text_encoders",
    "text_encoders": "text_encoders",
    "clip": "text_encoders",
    "vae": "vae",
    "controlnet": "controlnet",
    "control_net": "controlnet",
    "upscale": "upscale_models",
    "upscaler": "upscale_models",
    "upscale_model": "upscale_models",
    "upscale_models": "upscale_models",
    "diffusion_model": "diffusion_models",
    "diffusion_models": "diffusion_models",
    "unet": "diffusion_models",
    "embedding": "embeddings",
    "embeddings": "embeddings",
}

_LORA_MANAGER_NODE_TYPES = {
    "LoraLoaderV2",
    "Lora Loader (LoraManager)",
    "Lora Stacker (LoraManager)",
}
_POWER_LORA_NODE_TYPE = "Power Lora Loader (rgthree)"
_LORA_MODEL_WIDGET_TYPES = {
    "LoraLoader",
    "LoraLoaderModelOnly",
    "LoraLoaderBypass",
    "LoraLoaderBypassModelOnly",
    "CreateHookLora",
    "CreateHookLoraModelOnly",
}
_LORA_STRENGTH_NAMES = {
    "strength",
    "strength_model",
    "lora_strength",
    "lora_model_strength",
    "model_strength",
}


def normalize_transfer_category(value: Any) -> str:
    """Normalize the category names used by workflow and metadata payloads."""
    token = str(value or "").strip().lower().replace("-", "_")
    if not token or token in {"unknown", "none", "null"}:
        return ""
    return _CATEGORY_ALIASES.get(token, token)


def _normalize_identity(value: Any) -> str:
    return str(value or "").strip().replace("\\", "/").casefold()


def _coerce_strength(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _coerce_active(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    return None


def _set_named_lora_strength(
    node: Mapping[str, Any],
    reference: ModelReference,
    strength: float,
) -> None:
    widget_index = reference.widget_index
    if not isinstance(widget_index, int):
        return
    named_values = node.get("widgets_values_named")
    if not isinstance(named_values, dict):
        return
    widget_name = reference.extra_value("widget_name")
    if not widget_name:
        keys = list(named_values)
        if widget_index < 0 or widget_index >= len(keys):
            return
        widget_name = keys[widget_index]
    named_value = named_values.get(widget_name)
    if reference.extra_value("nested_key") == "lora" and isinstance(named_value, dict):
        named_value["strength"] = strength


def _source_model(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, Mapping):
        return None

    path = ""
    for key in ("original_path", "resolved_path", "path", "name", "filename"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            path = candidate.strip()
            break
    category = normalize_transfer_category(value.get("category"))
    if not path or not category:
        return None
    if path.casefold().startswith("urn:") or value.get("is_urn"):
        return None

    return {
        "path": path,
        "category": category,
        "strength": _coerce_strength(value.get("strength")),
        "active": _coerce_active(value.get("active")),
        "name": str(value.get("name") or get_filename_from_path(path)).strip(),
    }


def _scope_key(reference: ModelReference) -> tuple[str, bool, str]:
    return (
        str(reference.node_id),
        reference.is_top_level is not False,
        str(reference.subgraph_id or ""),
    )


def _selector_matches(reference: ModelReference, selector: Mapping[str, Any]) -> bool:
    if str(reference.node_id) != str(selector.get("node_id")):
        return False

    selector_is_top_level = selector.get("is_top_level") is not False
    if (reference.is_top_level is not False) != selector_is_top_level:
        return False
    if not selector_is_top_level and str(reference.subgraph_id or "") != str(
        selector.get("subgraph_id") or ""
    ):
        return False

    widget_index = selector.get("widget_index")
    if isinstance(widget_index, bool) or not isinstance(widget_index, int):
        return False
    if reference.widget_index != widget_index:
        return False

    selector_category = normalize_transfer_category(selector.get("category"))
    reference_category = normalize_transfer_category(reference.category)
    if selector_category and reference_category and selector_category != reference_category:
        return False

    selector_identity = ""
    for key in ("original_path", "name", "filename"):
        value = selector.get(key)
        if isinstance(value, str) and value.strip():
            selector_identity = _normalize_identity(value)
            break
    reference_identity = _normalize_identity(reference.original_path)
    return not (
        selector_identity
        and reference_identity
        and selector_identity != reference_identity
    )


def _find_workflow_node(workflow: Mapping[str, Any], reference: ModelReference) -> Optional[Dict[str, Any]]:
    node_id = str(reference.node_id)
    if reference.is_top_level is not False:
        nodes = workflow.get("nodes", [])
        if isinstance(nodes, list):
            return next(
                (
                    node
                    for node in nodes
                    if isinstance(node, dict) and str(node.get("id")) == node_id
                ),
                None,
            )
        return None

    definitions = workflow.get("definitions", {})
    subgraphs = definitions.get("subgraphs", []) if isinstance(definitions, dict) else []
    if not isinstance(subgraphs, list):
        return None
    for subgraph in subgraphs:
        if not isinstance(subgraph, dict) or str(subgraph.get("id")) != str(
            reference.subgraph_id or ""
        ):
            continue
        nodes = subgraph.get("nodes", [])
        if not isinstance(nodes, list):
            return None
        return next(
            (
                node
                for node in nodes
                if isinstance(node, dict) and str(node.get("id")) == node_id
            ),
            None,
        )
    return None


def _resolved_model(source: Mapping[str, Any]) -> ResolvedModel:
    path = str(source["path"])
    return ResolvedModel(
        path=path if os.path.isabs(path) else "",
        filename=get_filename_from_path(path),
        relative_path=path,
        category=str(source["category"]),
    )


def _build_resolution(reference: ModelReference, source: Mapping[str, Any]) -> Resolution:
    promoted_widget_name = reference.extra_value("promoted_widget_name") or reference.extra_value(
        "widget_name"
    )
    return Resolution(
        node_id=reference.node_id,
        widget_index=reference.widget_index,
        resolved_path=str(source["path"]),
        category=normalize_transfer_category(reference.category) or source["category"],
        resolved_model=_resolved_model(source),
        subgraph_id=reference.subgraph_id,
        is_top_level=reference.is_top_level is not False,
        nested_key=reference.extra_value("nested_key"),
        promoted_widget_name=promoted_widget_name,
        reference=reference,
        custom_node_metadata=get_custom_node_resolution_metadata(reference),
    )


def _resolution_payload(resolution: Resolution) -> Dict[str, Any]:
    payload = {
        "node_id": resolution.node_id,
        "widget_index": resolution.widget_index,
        "resolved_path": resolution.resolved_path,
        "category": resolution.category,
        "subgraph_id": resolution.subgraph_id,
        "is_top_level": resolution.is_top_level,
        "nested_key": resolution.nested_key,
        "promoted_widget_name": resolution.promoted_widget_name,
    }
    metadata = resolution.custom_node_metadata.to_dict()
    if metadata:
        payload["custom_node_metadata"] = metadata
    return payload


def _assign_sources(
    sources: Sequence[Mapping[str, Any]],
    references: Sequence[ModelReference],
) -> List[tuple[ModelReference, Mapping[str, Any]]]:
    if not sources or not references:
        return []
    if len(sources) == 1:
        return [(reference, sources[0]) for reference in references]
    return list(zip(references, sources, strict=False))


def _set_lora_strength(
    node: Dict[str, Any],
    reference: ModelReference,
    strength: Optional[float],
    *,
    fallback_identity: Optional[str] = None,
) -> bool:
    """Copy a source LoRA strength where the target node exposes one."""
    if strength is None or normalize_transfer_category(reference.category) != "loras":
        return False
    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list):
        return False
    widget_index = reference.widget_index
    if not isinstance(widget_index, int) or widget_index < 0 or widget_index >= len(widgets_values):
        return False

    value = widgets_values[widget_index]
    nested_key = reference.extra_value("nested_key")
    if nested_key == "lora" and isinstance(value, dict):
        value["strength"] = strength
        _set_named_lora_strength(node, reference, strength)
        return True

    adapter_id = reference.extra_value("custom_node_adapter")
    if adapter_id == "lora-manager" or node.get("type") in _LORA_MANAGER_NODE_TYPES:
        if len(widgets_values) <= 2 or not isinstance(widgets_values[2], list):
            return False
        target_identities = {
            identity
            for identity in (
                _normalize_identity(reference.original_path),
                _normalize_identity(fallback_identity),
            )
            if identity
        }
        for item in widgets_values[2]:
            if not isinstance(item, dict):
                continue
            if _normalize_identity(item.get("name")) in target_identities:
                item["strength"] = strength
                if len(widgets_values) > 1 and isinstance(widgets_values[1], str):
                    item_name = str(item.get("name") or "").strip()
                    if item_name:
                        widgets_values[1] = re.sub(
                            rf"(<lora:{re.escape(item_name)}:)[^>]+>",
                            rf"\g<1>{strength:g}>",
                            widgets_values[1],
                            count=1,
                            flags=re.IGNORECASE,
                        )
                return True
        return False

    widget_names_by_index: Dict[int, set[str]] = {}
    for index in range(len(widgets_values)):
        names = {
            normalize_widget_name(name)
            for name in [
                *get_widget_name_candidates(node, index),
                dynamic_widgets.get_dynamic_serialized_widget_name(node, index),
            ]
            if name
        }
        widget_names_by_index[index] = names

    target_names = widget_names_by_index.get(widget_index, set())
    strength_indexes: List[int] = []
    indexed_match = next(
        (
            match
            for name in target_names
            for match in [re.fullmatch(r"lora_(\d+)_name", name)]
            if match
        ),
        None,
    )
    if indexed_match:
        number = indexed_match.group(1)
        for index, names in widget_names_by_index.items():
            if names.intersection(
                {
                    f"lora_{number}_model_strength",
                    f"lora_{number}_strength",
                }
            ):
                strength_indexes.append(index)

    if not strength_indexes:
        for index, names in widget_names_by_index.items():
            if names.intersection(_LORA_STRENGTH_NAMES):
                strength_indexes.append(index)

    if not strength_indexes and node.get("type") in _LORA_MODEL_WIDGET_TYPES:
        candidate_index = widget_index + 1
        if candidate_index < len(widgets_values):
            strength_indexes.append(candidate_index)

    for index in strength_indexes:
        if index == widget_index:
            continue
        widgets_values[index] = strength
        return True
    return False


def _lora_name(source: Mapping[str, Any]) -> str:
    filename = get_filename_from_path(str(source["path"]))
    stem, _extension = os.path.splitext(filename)
    return stem or filename


def _sync_lora_manager_named_values(node: Mapping[str, Any]) -> None:
    """Mirror Lora Manager's list and text widgets when named values exist."""
    named_values = node.get("widgets_values_named")
    widgets_values = node.get("widgets_values")
    if not isinstance(named_values, dict) or not isinstance(widgets_values, list):
        return
    if (
        len(widgets_values) > 1
        and "text" in named_values
        and isinstance(widgets_values[1], str)
    ):
        named_values["text"] = widgets_values[1]
    if (
        len(widgets_values) > 2
        and "loras" in named_values
        and isinstance(widgets_values[2], list)
    ):
        named_values["loras"] = deepcopy(widgets_values[2])


def _insert_named_power_lora_values(
    node: Dict[str, Any],
    items: Sequence[Mapping[str, Any]],
) -> None:
    """Keep Power LoRA's named widget mirror aligned with inserted slots."""
    named_values = node.get("widgets_values_named")
    if not isinstance(named_values, dict) or not items:
        return

    lora_key_indexes = [
        index
        for index, key in enumerate(named_values)
        if re.fullmatch(r"lora_\d+", str(key))
    ]
    if lora_key_indexes:
        insert_index = lora_key_indexes[-1] + 1
        numbers = []
        for key in named_values:
            match = re.fullmatch(r"lora_(\d+)", str(key))
            if match:
                numbers.append(int(match.group(1)))
        next_number = max(numbers, default=0) + 1
    else:
        insert_index = len(named_values)
        next_number = 1

    entries = list(named_values.items())
    additions = [
        (f"lora_{next_number + offset}", deepcopy(item))
        for offset, item in enumerate(items)
    ]
    named_values.clear()
    named_values.update(
        entries[:insert_index] + additions + entries[insert_index:]
    )


def _append_lora_manager_models(
    node: Dict[str, Any],
    sources: Sequence[Mapping[str, Any]],
) -> int:
    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list) or len(widgets_values) <= 2:
        return 0
    lora_list = widgets_values[2]
    if not isinstance(lora_list, list):
        return 0

    template = next((item for item in lora_list if isinstance(item, dict)), {})
    appended_names = []
    for source in sources:
        item = deepcopy(template)
        name = _lora_name(source)
        item["name"] = name
        source_strength = source.get("strength")
        item["strength"] = source_strength if source_strength is not None else 1.0
        if "clipStrength" in item:
            item["clipStrength"] = item["strength"]
        source_active = source.get("active")
        item["active"] = source_active if source_active is not None else True
        lora_list.append(item)
        appended_names.append((name, item["strength"]))

    if len(widgets_values) > 1 and isinstance(widgets_values[1], str) and appended_names:
        tokens = " ".join(
            f"<lora:{name}:{strength:g}>"
            for name, strength in appended_names
            if isinstance(strength, (int, float))
        )
        if tokens:
            widgets_values[1] = f"{widgets_values[1]} {tokens}".strip()
    return len(appended_names)


def _append_power_lora_models(
    node: Dict[str, Any],
    sources: Sequence[Mapping[str, Any]],
) -> int:
    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list):
        return 0
    template = next(
        (item for item in reversed(widgets_values) if isinstance(item, dict) and "lora" in item),
        {"on": True, "lora": "", "strength": 1.0},
    )
    appended_items = []
    for source in sources:
        item = deepcopy(template)
        item["lora"] = str(source["path"])
        source_strength = source.get("strength")
        item["strength"] = source_strength if source_strength is not None else 1.0
        source_active = source.get("active")
        item["on"] = source_active if source_active is not None else True
        appended_items.append(item)

    if not appended_items:
        return 0
    last_lora_index = max(
        (
            index
            for index, value in enumerate(widgets_values)
            if isinstance(value, dict) and "lora" in value
        ),
        default=len(widgets_values) - 1,
    )
    insert_index = last_lora_index + 1
    widgets_values[insert_index:insert_index] = appended_items
    _insert_named_power_lora_values(node, appended_items)
    return len(appended_items)


def transfer_models_to_workflow(
    workflow: Dict[str, Any],
    source_models: Sequence[Any],
    target_refs: Sequence[Any],
    *,
    mode: str = "replace",
    inventory: Any = None,
) -> Dict[str, Any]:
    """Apply selected metadata models to selected workflow model slots.

    ``replace`` changes only checked target slots. ``merge``/``add`` keeps the
    current values and appends to the two supported multi-LoRA list formats.
    """
    if not isinstance(workflow, dict):
        raise ValueError("Workflow JSON must be an object")
    normalized_mode = str(mode or "replace").strip().lower().replace("_", "-")
    if normalized_mode in {"merge", "add", "merge-add"}:
        normalized_mode = "merge"
    elif normalized_mode != "replace":
        raise ValueError("Transfer mode must be replace or merge")
    if not isinstance(source_models, Sequence) or isinstance(source_models, (str, bytes)):
        raise ValueError("source_models must be an array")
    if not isinstance(target_refs, Sequence) or isinstance(target_refs, (str, bytes)):
        raise ValueError("target_refs must be an array")

    sources = [normalized for item in source_models if (normalized := _source_model(item))]
    if not sources:
        raise ValueError("No transferable metadata models were selected")
    if not target_refs:
        raise ValueError("No workflow model slots were selected")

    if inventory is None:
        from .workflow.inventory import get_workflow_model_inventory

        inventory = get_workflow_model_inventory(workflow)
    available_refs = [
        item if isinstance(item, ModelReference) else ModelReference.from_mapping(item)
        for item in (getattr(inventory, "model_refs", ()) or ())
    ]

    selected_refs: List[ModelReference] = []
    used_ref_indexes = set()
    skipped: List[Dict[str, Any]] = []
    for selector in target_refs:
        if not isinstance(selector, Mapping):
            skipped.append({"reason": "Invalid target model slot"})
            continue
        match_index = next(
            (
                index
                for index, reference in enumerate(available_refs)
                if index not in used_ref_indexes and _selector_matches(reference, selector)
            ),
            None,
        )
        if match_index is None:
            skipped.append({
                "node_id": selector.get("node_id"),
                "widget_index": selector.get("widget_index"),
                "reason": "The selected workflow model slot is no longer available",
            })
            continue
        used_ref_indexes.add(match_index)
        selected_refs.append(available_refs[match_index])

    if not selected_refs:
        raise ValueError("The selected workflow model slots are no longer available")

    refs_by_scope: OrderedDict[tuple[str, bool, str], List[ModelReference]] = OrderedDict()
    for reference in selected_refs:
        refs_by_scope.setdefault(_scope_key(reference), []).append(reference)
    sources_by_category: OrderedDict[str, List[Dict[str, Any]]] = OrderedDict()
    for source in sources:
        sources_by_category.setdefault(source["category"], []).append(source)

    # Build assignments in selection order across the complete workflow. One
    # source intentionally fans out to every compatible target; multiple
    # sources map one-to-one until either side is exhausted.
    source_by_reference: Dict[int, Mapping[str, Any]] = {}
    selected_refs_by_category: OrderedDict[str, List[ModelReference]] = OrderedDict()
    for reference in selected_refs:
        category = normalize_transfer_category(reference.category)
        if category:
            selected_refs_by_category.setdefault(category, []).append(reference)
    for category, category_refs in selected_refs_by_category.items():
        for reference, source in _assign_sources(
            sources_by_category.get(category, []),
            category_refs,
        ):
            source_by_reference[id(reference)] = source

    resolutions: List[Dict[str, Any]] = []
    updates: List[Dict[str, Any]] = []
    requires_full_reload = normalized_mode == "merge"
    strength_changed = False

    for _scope, scope_refs in refs_by_scope.items():
        node = _find_workflow_node(workflow, scope_refs[0])
        if not node:
            skipped.append({"node_id": scope_refs[0].node_id, "reason": "Workflow node not found"})
            continue
        node_type = str(node.get("type") or "")
        refs_by_category: OrderedDict[str, List[ModelReference]] = OrderedDict()
        for reference in scope_refs:
            category = normalize_transfer_category(reference.category)
            if category:
                refs_by_category.setdefault(category, []).append(reference)

        if normalized_mode == "merge":
            if node_type in _LORA_MANAGER_NODE_TYPES:
                lora_sources = sources_by_category.get("loras", [])
                appended = _append_lora_manager_models(node, lora_sources)
                if appended:
                    _sync_lora_manager_named_values(node)
                    updates.append({
                        "node_id": scope_refs[0].node_id,
                        "node_type": node_type,
                        "category": "loras",
                        "operation": "merge",
                        "count": appended,
                    })
                elif lora_sources:
                    skipped.append({
                        "node_id": scope_refs[0].node_id,
                        "reason": "This LoRA Manager node has no appendable LoRA list",
                    })
                continue

            if node_type == _POWER_LORA_NODE_TYPE:
                lora_sources = sources_by_category.get("loras", [])
                appended = _append_power_lora_models(node, lora_sources)
                if appended:
                    updates.append({
                        "node_id": scope_refs[0].node_id,
                        "node_type": node_type,
                        "category": "loras",
                        "operation": "merge",
                        "count": appended,
                    })
                elif lora_sources:
                    skipped.append({
                        "node_id": scope_refs[0].node_id,
                        "reason": "This Power LoRA node has no appendable LoRA slots",
                    })
                continue

            matching_source_categories = [
                category for category in refs_by_category if sources_by_category.get(category)
            ]
            if matching_source_categories:
                skipped.append({
                    "node_id": scope_refs[0].node_id,
                    "node_type": node_type,
                    "reason": "Merge/Add is available for multi-model LoRA nodes only; the current values were kept",
                })
            continue

        for category, references in refs_by_category.items():
            if not sources_by_category.get(category):
                continue
            for reference in references:
                source = source_by_reference.get(id(reference))
                if source is None:
                    continue
                resolution = _build_resolution(reference, source)
                if not update_model_path(workflow, resolution):
                    skipped.append({
                        "node_id": reference.node_id,
                        "widget_index": reference.widget_index,
                        "reason": "The selected workflow model slot could not be updated",
                    })
                    continue
                if _set_lora_strength(
                    node,
                    reference,
                    source.get("strength"),
                    fallback_identity=_lora_name(source),
                ):
                    strength_changed = True
                if node_type in _LORA_MANAGER_NODE_TYPES:
                    _sync_lora_manager_named_values(node)
                resolutions.append(_resolution_payload(resolution))
                updates.append({
                    "node_id": reference.node_id,
                    "widget_index": reference.widget_index,
                    "node_type": reference.node_type,
                    "category": category,
                    "operation": "replace",
                    "source": source["path"],
                })
                if reference.is_top_level is False:
                    requires_full_reload = True

    if strength_changed:
        requires_full_reload = True

    updated_count = sum(
        int(item.get("count", 0)) if item.get("operation") == "merge" else 1
        for item in updates
    )
    if not updated_count:
        raise ValueError("No selected workflow model slot could accept the metadata model")

    return {
        "success": True,
        "workflow": workflow,
        "mode": normalized_mode,
        "updated": updated_count,
        "updates": updates,
        "skipped": skipped,
        "requires_full_reload": requires_full_reload,
        "resolutions": [] if requires_full_reload else resolutions,
    }


__all__ = ["normalize_transfer_category", "transfer_models_to_workflow"]

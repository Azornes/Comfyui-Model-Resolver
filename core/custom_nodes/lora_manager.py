"""Backend adapter for ComfyUI-Lora-Manager loader nodes."""

import os
from typing import Any, Dict, List, Optional

from ..log_system import create_module_logger
from .base import CustomNodeModelAdapter

log = create_module_logger(__name__)

ADAPTER_ID = "lora-manager"
NODE_TYPES = (
    "LoraLoaderV2",
    "Lora Loader (LoraManager)",
    "Lora Stacker (LoraManager)",
)
LORA_LIST_WIDGET_INDEX = 2
TEXT_WIDGET_INDEX = 1


def analyze_references(
    node: Dict[str, Any],
    available_models: Optional[List[Dict[str, Any]]] = None,
    *,
    is_active: bool,
    get_widget_name_hint: Any,
) -> Optional[List[Dict[str, Any]]]:
    """Extract LoRA references stored in Lora Manager's list widget."""
    widgets_values = node.get("widgets_values", [])
    if len(widgets_values) < 3:
        return None

    from ..scanner import get_model_files

    all_loras = (
        available_models if available_models is not None else get_model_files()
    )
    lora_files = [
        model for model in all_loras if model.get("category") == "loras"
    ]
    lora_lookup: Dict[str, List[Dict[str, Any]]] = {}
    for lora_file in lora_files:
        filename = lora_file.get("filename", "")
        if not filename:
            continue
        base_name = os.path.splitext(filename)[0]
        lora_lookup.setdefault(base_name, []).append(lora_file)

    lora_list = widgets_values[LORA_LIST_WIDGET_INDEX]
    if not isinstance(lora_list, list):
        return []

    node_id = node.get("id")
    node_type = node.get("type", "")
    node_title = str(node.get("title", "") or "").strip()
    model_refs: List[Dict[str, Any]] = []
    for lora_item in lora_list:
        if not isinstance(lora_item, dict):
            continue

        name = lora_item.get("name", "")
        if not name:
            continue

        lora_exists = False
        lora_full_path = None
        if name in lora_lookup:
            lora_full_path = lora_lookup[name][0].get("path")
            lora_exists = (
                os.path.exists(lora_full_path) if lora_full_path else False
            )
        else:
            for extension in [".safetensors", ".ckpt", ".pt", ".pth"]:
                test_name = name + extension
                if test_name not in lora_lookup:
                    continue
                lora_full_path = lora_lookup[test_name][0].get("path")
                lora_exists = (
                    os.path.exists(lora_full_path) if lora_full_path else False
                )
                if lora_exists:
                    break

        log.debug(f"Lora {name}: exists={lora_exists}, path={lora_full_path}")
        model_refs.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "widget_index": LORA_LIST_WIDGET_INDEX,
                "widget_name": get_widget_name_hint(
                    node, LORA_LIST_WIDGET_INDEX
                ),
                "original_path": name,
                "name": name,
                "strength": float(lora_item.get("strength", 1.0)),
                "active": lora_item.get("active", True),
                "node_title": node_title,
                "category": "loras",
                "category_hints": ["loras"],
                "folder_key_hints": ["loras"],
                "full_path": lora_full_path,
                "exists": lora_exists,
                "is_urn": False,
                "custom_node_adapter": ADAPTER_ID,
                "connected": is_active,
            }
        )
    return model_refs


def has_potential_reference(node: Dict[str, Any]) -> bool:
    """Return whether the serialized LoRA list contains a named entry."""
    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or len(widgets_values) < 3:
        return False
    lora_list = widgets_values[LORA_LIST_WIDGET_INDEX]
    if not isinstance(lora_list, list):
        return False
    return any(
        isinstance(item, dict) and str(item.get("name") or "").strip()
        for item in lora_list
    )


def update_model_path(
    node: Dict[str, Any],
    widget_index: int,
    resolved_model: Optional[Dict[str, Any]],
    mapping: Optional[Dict[str, Any]],
) -> Optional[bool]:
    """Update one LoRA name in both the list and formatted text widgets."""
    mapping = mapping or {}
    adapter_id = mapping.get("custom_node_adapter")
    is_legacy_mapping = mapping.get("is_lora_v2") is True
    if adapter_id != ADAPTER_ID and not is_legacy_mapping:
        return None

    original_name = (
        mapping.get("custom_node_original_identity")
        or mapping.get("original_lora_name")
    )
    if not original_name or widget_index != LORA_LIST_WIDGET_INDEX:
        return None

    widgets_values = node.get("widgets_values", [])
    lora_list = widgets_values[LORA_LIST_WIDGET_INDEX]
    if not isinstance(lora_list, list):
        log.warning(
            "Lora Manager list widget is not a list: "
            f"{type(lora_list)}"
        )
        return False

    new_name = None
    if resolved_model:
        new_name = resolved_model.get("filename") or resolved_model.get(
            "name", ""
        )
        if new_name and "." in new_name:
            new_name = new_name.rsplit(".", 1)[0]
    if not new_name:
        return False

    original_stripped = str(original_name).strip()
    updated = False
    for lora_item in lora_list:
        if not isinstance(lora_item, dict):
            continue
        current_name = str(lora_item.get("name", "")).strip()
        if (
            current_name == original_stripped
            or current_name.lower() == original_stripped.lower()
        ):
            lora_item["name"] = new_name
            updated = True
            break

    if not updated:
        available = [
            item.get("name") for item in lora_list if isinstance(item, dict)
        ]
        log.warning(
            f"Lora '{original_name}' not found in Lora Manager list. "
            f"Available: {available}"
        )
        return False

    if (
        len(widgets_values) > TEXT_WIDGET_INDEX
        and isinstance(widgets_values[TEXT_WIDGET_INDEX], str)
    ):
        old_text = widgets_values[TEXT_WIDGET_INDEX]
        new_text = old_text.replace(
            f"<lora:{original_name}:", f"<lora:{new_name}:"
        )
        new_text = new_text.replace(
            f":{original_name}:", f":{new_name}:"
        )
        widgets_values[TEXT_WIDGET_INDEX] = new_text

    log.info(
        f"Updated Lora Manager model: {original_name} -> {new_name}"
    )
    return True


def should_skip_existing(reference: Dict[str, Any]) -> bool:
    """Existing list entries do not require matching or relinking."""
    return reference.get("exists") is True


def adapt_loaded_model(
    reference: Dict[str, Any],
    model_name: str,
    strength: Any,
) -> tuple[str, Any]:
    """Use the list entry's display name and strength."""
    return (
        reference.get("name", model_name),
        reference.get("strength", strength),
    )


ADAPTER = CustomNodeModelAdapter(
    adapter_id=ADAPTER_ID,
    node_types=NODE_TYPES,
    category_hint="loras",
    widget_categories={LORA_LIST_WIDGET_INDEX: "loras"},
    analyze_references=analyze_references,
    has_potential_reference=has_potential_reference,
    update_model_path=update_model_path,
    should_skip_existing=should_skip_existing,
    adapt_loaded_model=adapt_loaded_model,
)

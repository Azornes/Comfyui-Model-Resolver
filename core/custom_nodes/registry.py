"""Registry and dispatch helpers for backend custom-node model adapters."""

from typing import Any, Dict, List, Optional

from .base import CustomNodeModelAdapter
from .lora_manager import ADAPTER as LORA_MANAGER_ADAPTER
from .rgthree_power_lora_loader import (
    ADAPTER as RGTHREE_POWER_LORA_LOADER_ADAPTER,
)

CUSTOM_NODE_MODEL_ADAPTERS = (
    LORA_MANAGER_ADAPTER,
    RGTHREE_POWER_LORA_LOADER_ADAPTER,
)
_ADAPTERS_BY_ID = {
    adapter.adapter_id: adapter for adapter in CUSTOM_NODE_MODEL_ADAPTERS
}
_ADAPTERS_BY_NODE_TYPE = {
    node_type: adapter
    for adapter in CUSTOM_NODE_MODEL_ADAPTERS
    for node_type in adapter.node_types
}


def get_custom_node_model_adapter(
    node_or_type: Any,
) -> Optional[CustomNodeModelAdapter]:
    """Return the adapter registered for a node dictionary or node type."""
    node_type = (
        node_or_type.get("type", "")
        if isinstance(node_or_type, dict)
        else str(node_or_type or "")
    )
    return _ADAPTERS_BY_NODE_TYPE.get(node_type)


def get_custom_node_adapter_for_reference(
    reference: Dict[str, Any],
) -> Optional[CustomNodeModelAdapter]:
    """Resolve an adapter from normalized or legacy reference metadata."""
    adapter_id = reference.get("custom_node_adapter")
    if adapter_id in _ADAPTERS_BY_ID:
        return _ADAPTERS_BY_ID[adapter_id]
    adapter = get_custom_node_model_adapter(reference.get("node_type"))
    if adapter:
        return adapter
    if reference.get("is_lora_v2"):
        return LORA_MANAGER_ADAPTER
    return None


def get_custom_node_category_hints() -> Dict[str, str]:
    """Return node-type category hints contributed by adapters."""
    return {
        node_type: adapter.category_hint
        for adapter in CUSTOM_NODE_MODEL_ADAPTERS
        if adapter.category_hint
        for node_type in adapter.node_types
    }


def get_custom_node_widget_categories() -> Dict[str, Dict[int, str]]:
    """Return fixed serialized widget categories contributed by adapters."""
    return {
        node_type: dict(adapter.widget_categories)
        for adapter in CUSTOM_NODE_MODEL_ADAPTERS
        if adapter.widget_categories
        for node_type in adapter.node_types
    }


def get_custom_node_resolution_metadata(
    reference: Dict[str, Any],
) -> Dict[str, Any]:
    """Normalize adapter metadata carried into workflow update mappings."""
    adapter = get_custom_node_adapter_for_reference(reference)
    if not adapter:
        return {}
    original_identity = (
        reference.get("custom_node_original_identity")
        or reference.get("original_lora_name")
        or reference.get("name")
        or reference.get("original_path")
    )
    return {
        "custom_node_adapter": adapter.adapter_id,
        "custom_node_original_identity": original_identity,
    }


def analyze_custom_node_references(
    node: Dict[str, Any],
    available_models: Optional[List[Dict[str, Any]]] = None,
    **context: Any,
) -> Optional[List[Dict[str, Any]]]:
    """Dispatch custom serialized model extraction when an adapter handles it."""
    adapter = get_custom_node_model_adapter(node)
    if not adapter or not adapter.analyze_references:
        return None
    return adapter.analyze_references(
        node,
        available_models,
        **context,
    )


def custom_node_has_potential_model_reference(
    node: Dict[str, Any],
) -> bool:
    """Return whether a registered adapter finds a model reference."""
    adapter = get_custom_node_model_adapter(node)
    return bool(
        adapter
        and adapter.has_potential_reference
        and adapter.has_potential_reference(node)
    )


def update_custom_node_model_path(
    node: Dict[str, Any],
    widget_index: int,
    resolved_model: Optional[Dict[str, Any]],
    mapping: Optional[Dict[str, Any]],
) -> Optional[bool]:
    """Dispatch a custom workflow update, returning None when not handled."""
    adapter = get_custom_node_model_adapter(node)
    if not adapter or not adapter.update_model_path:
        return None
    return adapter.update_model_path(
        node,
        widget_index,
        resolved_model,
        mapping,
    )


def should_skip_existing_custom_node_reference(
    reference: Dict[str, Any],
) -> bool:
    """Return whether an existing adapter reference needs no resolution."""
    adapter = get_custom_node_adapter_for_reference(reference)
    return bool(
        adapter
        and adapter.should_skip_existing
        and adapter.should_skip_existing(reference)
    )


def adapt_custom_node_loaded_model(
    reference: Dict[str, Any],
    model_name: str,
    strength: Any,
) -> tuple[str, Any]:
    """Apply adapter-specific display data for Loaded Models."""
    adapter = get_custom_node_adapter_for_reference(reference)
    if not adapter or not adapter.adapt_loaded_model:
        return model_name, strength
    return adapter.adapt_loaded_model(reference, model_name, strength)

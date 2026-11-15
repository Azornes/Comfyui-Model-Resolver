"""Backend custom-node model adapter registry."""

from .ast_scanner import (
    clear_node_widget_schema_hints_cache,
    get_node_widget_schema_hints,
    resolve_ast_node_widget_category,
    scan_custom_node_widget_schemas,
)
from .registry import (
    CUSTOM_NODE_MODEL_ADAPTERS,
    adapt_custom_node_loaded_model,
    analyze_custom_node_references,
    custom_node_has_potential_model_reference,
    get_custom_node_adapter_for_reference,
    get_custom_node_category_hints,
    get_custom_node_model_adapter,
    get_custom_node_resolution_metadata,
    get_custom_node_widget_categories,
    should_skip_existing_custom_node_reference,
    update_custom_node_model_path,
)

__all__ = [
    "CUSTOM_NODE_MODEL_ADAPTERS",
    "adapt_custom_node_loaded_model",
    "analyze_custom_node_references",
    "clear_node_widget_schema_hints_cache",
    "custom_node_has_potential_model_reference",
    "get_custom_node_adapter_for_reference",
    "get_custom_node_category_hints",
    "get_custom_node_model_adapter",
    "get_custom_node_resolution_metadata",
    "get_custom_node_widget_categories",
    "get_node_widget_schema_hints",
    "resolve_ast_node_widget_category",
    "scan_custom_node_widget_schemas",
    "should_skip_existing_custom_node_reference",
    "update_custom_node_model_path",
]

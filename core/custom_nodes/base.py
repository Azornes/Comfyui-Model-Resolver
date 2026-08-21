"""Shared contract for backend custom-node model adapters."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Callable, Dict, List, Optional, Protocol, Tuple

from ..contracts import CustomNodeMetadata, ModelReference, ResolvedModel


class AnalyzeReferencesCallback(Protocol):
    """Typed callback used to extract references from a serialized node."""

    def __call__(
        self,
        node: Dict[str, Any],
        available_models: Optional[List[ResolvedModel]] = None,
        *,
        is_active: bool,
        get_widget_name_hint: Callable[[Dict[str, Any], int], str],
    ) -> Optional[List[ModelReference]]: ...


class HasPotentialReferenceCallback(Protocol):
    """Typed callback used for cheap custom-node reference detection."""

    def __call__(self, node: Dict[str, Any]) -> bool: ...


@dataclass(frozen=True)
class CustomNodeModelAdapter:
    """Describe backend behavior supplied by one custom-node integration."""

    adapter_id: str
    node_types: Tuple[str, ...]
    category_hint: Optional[str] = None
    widget_categories: Mapping[int, str] = field(default_factory=dict)
    analyze_references: Optional[AnalyzeReferencesCallback] = None
    has_potential_reference: Optional[HasPotentialReferenceCallback] = None
    update_model_path: Optional[
        Callable[
            [Dict[str, Any], int, Optional[ResolvedModel], CustomNodeMetadata],
            Optional[bool],
        ]
    ] = None
    should_skip_existing: Optional[Callable[[ModelReference], bool]] = None
    adapt_loaded_model: Optional[
        Callable[[ModelReference, str, Any], Tuple[str, Any]]
    ] = None

    def __post_init__(self) -> None:
        if not isinstance(self.adapter_id, str):
            raise TypeError("CustomNodeModelAdapter adapter_id must be a string")
        adapter_id = self.adapter_id.strip()
        if not adapter_id:
            raise ValueError("CustomNodeModelAdapter adapter_id is required")
        object.__setattr__(self, "adapter_id", adapter_id)

        if not isinstance(self.node_types, (list, tuple)):
            raise TypeError("CustomNodeModelAdapter node_types must be an array")
        if any(not isinstance(node_type, str) for node_type in self.node_types):
            raise TypeError(
                "CustomNodeModelAdapter node_types must contain only strings"
            )
        normalized_node_types = tuple(
            node_type.strip() for node_type in self.node_types
        )
        if any(not node_type for node_type in normalized_node_types):
            raise ValueError(
                "CustomNodeModelAdapter node_types cannot contain empty strings"
            )
        object.__setattr__(self, "node_types", normalized_node_types)

        if self.category_hint is not None:
            if not isinstance(self.category_hint, str):
                raise TypeError(
                    "CustomNodeModelAdapter category_hint must be a string"
                )
            object.__setattr__(self, "category_hint", self.category_hint.strip())

        if not isinstance(self.widget_categories, Mapping):
            raise TypeError(
                "CustomNodeModelAdapter widget_categories must be an object"
            )
        normalized_widget_categories = {}
        for widget_index, category in self.widget_categories.items():
            if isinstance(widget_index, bool) or not isinstance(widget_index, int):
                raise TypeError(
                    "CustomNodeModelAdapter widget category keys must be integers"
                )
            if not isinstance(category, str):
                raise TypeError(
                    "CustomNodeModelAdapter widget category values must be strings"
                )
            normalized_widget_categories[widget_index] = category.strip()
        object.__setattr__(
            self,
            "widget_categories",
            MappingProxyType(normalized_widget_categories),
        )

        for field_name in (
            "analyze_references",
            "has_potential_reference",
            "update_model_path",
            "should_skip_existing",
            "adapt_loaded_model",
        ):
            callback = getattr(self, field_name)
            if callback is not None and not callable(callback):
                raise TypeError(
                    f"CustomNodeModelAdapter {field_name} must be callable"
                )

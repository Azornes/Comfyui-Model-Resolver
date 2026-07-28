"""Shared contract for backend custom-node model adapters."""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Tuple


@dataclass(frozen=True)
class CustomNodeModelAdapter:
    """Describe backend behavior supplied by one custom-node integration."""

    adapter_id: str
    node_types: Tuple[str, ...]
    category_hint: Optional[str] = None
    widget_categories: Dict[int, str] = field(default_factory=dict)
    analyze_references: Optional[Callable[..., Any]] = None
    has_potential_reference: Optional[Callable[..., bool]] = None
    update_model_path: Optional[Callable[..., Optional[bool]]] = None
    should_skip_existing: Optional[Callable[..., bool]] = None
    adapt_loaded_model: Optional[Callable[..., Any]] = None

"""Model reference matching, category inference, and path resolution."""

import os
import re
from typing import Any, Dict, List, Optional

from ..custom_nodes import (
    analyze_custom_node_references,
    get_custom_node_model_adapter,
)
from ..log_system import create_module_logger
from ..type_utils import MODEL_EXTENSIONS, URN_TYPE_MAP, normalize_download_category
from . import dynamic_widgets
from .widgets import (
    NESTED_MODEL_KEYS,
    NODE_TYPE_TO_CATEGORY_HINTS,
    _ordered_unique_categories,
    get_node_model_widget_category_hint,
    get_node_output_category_hint,
    get_widget_category_hint,
    get_widget_name_hint,
    is_workflow_model_widget_candidate,
)

log = create_module_logger(__name__)

try:
    import folder_paths
except ImportError:
    folder_paths = None


URN_REGEX = re.compile(r"^urn:air:([^:]+):([^:]+):([^:]+):(\d+)@(\d+)$")


def is_static_or_hybrid_widget_choice(value: Any, choice_info: Dict[str, Any]) -> bool:
    source = str(choice_info.get("source") or "").strip().lower()
    if source not in {"static", "hybrid"}:
        return False

    target = dynamic_widgets._normalize_choice_for_match(value)
    if not target:
        return False

    choices = choice_info.get("choices") or []
    return any(
        dynamic_widgets._normalize_choice_for_match(choice) == target
        for choice in choices
    )


def static_or_hybrid_choice_looks_like_model(
    value: Any, choice_info: Dict[str, Any]
) -> bool:
    if is_model_filename(value):
        return True

    if not isinstance(value, str):
        return False

    value_text = value.strip()
    if not value_text:
        return False

    if "/" in value_text or "\\" in value_text:
        return True

    target = dynamic_widgets._normalize_choice_for_match(value_text)
    choices = choice_info.get("choices") or []
    return any(
        dynamic_widgets._normalize_choice_for_match(choice) == target
        and is_model_filename(choice)
        for choice in choices
    )


MODEL_WIDGET_PLACEHOLDERS = {
    "",
    ".none",
    ".use_ckpt_clip",
    ".use_ckpt_vae",
    "none",
    "[none]",
    "null",
    "undefined",
    "default",
    "auto",
    "baked vae",
    "included",
    "(use same)",
    "select the lora to add to the text",
    "esam",
    "pixel_space",
    "taesd",
    "taesdxl",
    "taesd3",
    "taef1",
    "taef2",
}


def get_model_widget_category_hint(
    node: Dict[str, Any], widget_index: int
) -> Optional[str]:
    category_hints = get_model_widget_category_hints(node, widget_index)
    return category_hints[0] if category_hints else None


def get_model_widget_category_hints(
    node: Dict[str, Any], widget_index: int
) -> List[str]:
    node_type = node.get("type", "")
    indexed_category_hint = get_node_model_widget_category_hint(node_type, widget_index)
    widget_category_hint = get_widget_category_hint(node, widget_index)
    dynamic_category_hints = dynamic_widgets.get_dynamic_widget_category_hints(
        node, widget_index
    )

    output_category_hint = get_node_output_category_hint(node)
    output_widget_category_hint = (
        output_category_hint
        if (
            not dynamic_category_hints
            and (indexed_category_hint or widget_category_hint)
        )
        else None
    )

    hints_list = []
    for hint in dynamic_category_hints:
        if hint:
            hints_list.append(normalize_download_category(hint))

    if dynamic_category_hints:
        return _ordered_unique_categories(hints_list)

    if indexed_category_hint:
        hints_list.append(indexed_category_hint)

    if (
        widget_category_hint == "diffusion_models"
        and output_widget_category_hint
        and output_widget_category_hint != "diffusion_models"
    ):
        hints_list.append(output_widget_category_hint)
        hints_list.append(widget_category_hint)
    else:
        if widget_category_hint:
            hints_list.append(widget_category_hint)
        if output_widget_category_hint:
            hints_list.append(output_widget_category_hint)

    return _ordered_unique_categories(hints_list)


def get_effective_model_category_hint(
    node: Dict[str, Any], widget_index: int
) -> Optional[str]:
    return get_model_widget_category_hint(
        node, widget_index
    ) or NODE_TYPE_TO_CATEGORY_HINTS.get(node.get("type", ""))


def is_placeholder_model_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False

    return value.strip().lower() in MODEL_WIDGET_PLACEHOLDERS


def should_scan_as_model_reference(value: Any, declared_model_widget: bool) -> bool:
    """Detect references only when the value or its widget provides model evidence."""
    if isinstance(value, str) and URN_REGEX.match(value.strip()):
        return True

    if not declared_model_widget or not isinstance(value, str):
        return False

    if is_model_filename(value):
        return True

    return bool(value.strip()) and not is_placeholder_model_value(value)


def is_model_filename(value: Any) -> bool:
    """Return whether a value looks like a model filename or URN."""
    if not isinstance(value, str):
        return False

    _, extension = os.path.splitext(value.lower())
    if extension in MODEL_EXTENSIONS:
        return True

    return bool(URN_REGEX.match(value.strip()))


def _normalize_model_path_for_lookup(value: str) -> str:
    """Normalize separators for comparison while preserving letter case."""
    if not isinstance(value, str):
        return ""

    normalized = os.path.normpath(value.strip())
    if normalized == ".":
        return ""

    return normalized.replace("\\", "/").strip("/")


def _resolve_from_available_models(
    filename: str,
    categories: Optional[List[str]],
    available_models: Optional[List[Dict[str, Any]]],
) -> Optional[tuple[str, str]]:
    """Resolve using scanner data with case-sensitive relative path matching."""
    if not available_models:
        return None

    requested_key = _normalize_model_path_for_lookup(filename)
    if not requested_key:
        return None

    requested_is_absolute = os.path.isabs(filename)
    if requested_is_absolute:
        requested_key = _normalize_model_path_for_lookup(os.path.abspath(filename))

    if categories is None:
        category_order = []
        seen_categories = set()
        for model in available_models:
            category = model.get("category")
            if category and category not in seen_categories:
                seen_categories.add(category)
                category_order.append(category)
    else:
        category_order = categories

    if not category_order:
        return None

    for category in category_order:
        normalized_category = normalize_download_category(category)
        for model in available_models:
            model_category = model.get("category")
            if (
                model_category != category
                and normalize_download_category(model_category) != normalized_category
            ):
                continue

            if requested_is_absolute:
                model_path = model.get("path") or ""
            else:
                model_path = model.get("relative_path") or model.get("filename") or ""

            if _normalize_model_path_for_lookup(model_path) != requested_key:
                continue

            full_path = model.get("path")
            if full_path and os.path.exists(full_path):
                return (category, full_path)

    return None


def _category_has_exact_filename(category: str, filename: str) -> Optional[bool]:
    """Check ComfyUI's filename list for an exact-case relative path match."""
    if os.path.isabs(filename):
        return None

    requested_key = _normalize_model_path_for_lookup(filename)
    if not requested_key:
        return False

    try:
        available_filenames = folder_paths.get_filename_list(category) or []
    except Exception:
        return None

    return any(
        _normalize_model_path_for_lookup(available_filename) == requested_key
        for available_filename in available_filenames
        if isinstance(available_filename, str)
    )


def try_resolve_model_path(
    value: str,
    categories: List[str] = None,
    available_models: Optional[List[Dict[str, Any]]] = None,
) -> Optional[tuple[str, str]]:
    """Resolve a workflow model value using scanner data or ComfyUI paths."""
    if not isinstance(value, str) or not value.strip():
        return None

    filename = value.strip()

    if categories is not None:
        skip_categories = {"custom_nodes", "configs"}
        categories = [category for category in categories if category not in skip_categories]

    resolved = _resolve_from_available_models(filename, categories, available_models)
    if resolved:
        return resolved

    if available_models is not None:
        return None

    global folder_paths
    if folder_paths is None:
        try:
            import folder_paths as folder_paths_module

            folder_paths = folder_paths_module
        except ImportError:
            log.error("Model Resolver: folder_paths not available")
            return None

    if categories is None:
        categories = list(folder_paths.folder_names_and_paths.keys())

    skip_categories = {"custom_nodes", "configs"}
    categories = [category for category in categories if category not in skip_categories]

    for category in categories:
        try:
            exact_filename = _category_has_exact_filename(category, filename)
            if exact_filename is False:
                continue

            full_path = folder_paths.get_full_path(category, filename)
            if full_path and os.path.exists(full_path):
                return (category, full_path)
        except Exception:
            continue

    return None

def get_node_model_info(
    node: Dict[str, Any], available_models: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Extract model references from a single node.

    This scans widget values backed by model metadata or a model-like widget name.
    Explicit model URNs are also accepted without widget metadata.

    Args:
        node: Node dictionary from workflow JSON

    Returns:
        List of model reference dictionaries:
        {
            'node_id': node id,
            'node_type': node type,
            'widget_index': index in widgets_values,
            'original_path': original path from workflow,
            'category': model category (if found),
            'exists': True if model exists,
            'connected': True if node has any connected inputs/outputs
        }
    """
    model_refs = []
    node_id = node.get("id")
    node_type = node.get("type", "")
    node_title = str(node.get("title", "") or "").strip()
    widgets_values = node.get("widgets_values", [])

    # Check if node is connected (has any inputs or outputs with links)
    inputs = node.get("inputs", [])
    outputs = node.get("outputs", [])
    is_connected = any(inp.get("link") is not None for inp in inputs) or any(
        out.get("links") and len(out.get("links", [])) > 0 for out in outputs
    )

    # Check if node is in bypass mode (mode 4)
    node_mode = node.get("mode", 0)
    is_bypassed = node_mode == 4

    # Node is active if connected AND not bypassed
    is_active = is_connected and not is_bypassed

    if not widgets_values:
        return model_refs

    custom_model_refs = analyze_custom_node_references(
        node,
        available_models,
        is_active=is_active,
        get_widget_name_hint=get_widget_name_hint,
    )
    if custom_model_refs is not None:
        return custom_model_refs

    # For each widget value, check if it looks like a model file or URN
    for idx, value in enumerate(widgets_values):
        if dynamic_widgets.is_dynamic_non_model_widget(node, idx):
            continue
        widget_name = (
            dynamic_widgets.get_dynamic_serialized_widget_name(node, idx)
            or get_widget_name_hint(node, idx)
        )
        dynamic_category_hints = dynamic_widgets.get_dynamic_widget_category_hints(
            node, idx
        )
        if dynamic_category_hints and all(
            normalize_download_category(category)
            in dynamic_widgets.NON_MODEL_REFERENCE_CATEGORIES
            for category in dynamic_category_hints
        ):
            continue
        model_widget_folder_key_hints = dynamic_category_hints
        model_widget_choice_info = dynamic_widgets.get_dynamic_widget_choice_info(
            node, idx
        )
        model_widget_category_hints = get_model_widget_category_hints(node, idx)
        model_widget_category_hint = (
            model_widget_category_hints[0] if model_widget_category_hints else None
        )
        input_choice_source = str(
            model_widget_choice_info.get("source") or "unknown"
        ).strip().lower()
        static_input_choice_matches_value = is_static_or_hybrid_widget_choice(
            value,
            model_widget_choice_info,
        )
        static_input_choice_looks_like_model = static_or_hybrid_choice_looks_like_model(
            value,
            model_widget_choice_info,
        )
        if (
            input_choice_source in {"static", "hybrid"}
            and static_input_choice_matches_value
            and not static_input_choice_looks_like_model
        ):
            continue
        output_category_hint = get_node_output_category_hint(node)
        workflow_schema_model_candidate = bool(
            input_choice_source == "unknown"
            and output_category_hint
            and is_workflow_model_widget_candidate(node, idx)
            and is_model_filename(value)
        )
        if workflow_schema_model_candidate:
            input_choice_source = "workflow_schema"
        input_choice_matches_value = bool(
            static_input_choice_matches_value or workflow_schema_model_candidate
        )
        input_choice_looks_like_model = bool(
            static_input_choice_looks_like_model or workflow_schema_model_candidate
        )
        schema_output_category_hint = (
            output_category_hint
            if input_choice_matches_value
            and input_choice_source in {"static", "hybrid", "workflow_schema"}
            and input_choice_looks_like_model
            else None
        )
        effective_category_hint = (
            model_widget_category_hint
            or NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)
            or schema_output_category_hint
        )
        categories_to_try_for_widget = (
            model_widget_category_hints
            if model_widget_category_hints
            else ([effective_category_hint] if effective_category_hint else None)
        )
        # A generic widget name such as ``model_name`` is useful for choosing a
        # category, but it is not proof that an arbitrary STRING value is a local
        # model reference. Some metadata/search nodes use that name for human-
        # readable titles. Only folder-backed schemas, known widget indexes, or a
        # model-typed combo/output pairing are strong enough to admit an
        # extensionless value.
        category_backed_model_widget = bool(
            model_widget_folder_key_hints
            or get_node_model_widget_category_hint(node_type, idx)
            or schema_output_category_hint
        )
        named_model_file_widget = bool(
            is_workflow_model_widget_candidate(node, idx)
            and is_model_filename(value)
        )

        if not should_scan_as_model_reference(
            value,
            declared_model_widget=(
                category_backed_model_widget or named_model_file_widget
            ),
        ):
            # Check for dict-type widget values containing model references.
            if isinstance(value, dict):
                for nested_key, nested_category_hint in NESTED_MODEL_KEYS.items():
                    nested_value = value.get(nested_key)
                    if (
                        not nested_value
                        or not isinstance(nested_value, str)
                        or not should_scan_as_model_reference(
                            nested_value, declared_model_widget=True
                        )
                    ):
                        continue

                    value_str = nested_value.strip()
                    nested_categories = (
                        [nested_category_hint] if nested_category_hint else None
                    )

                    resolved = try_resolve_model_path(
                        value_str,
                        nested_categories,
                        available_models=available_models,
                    )
                    if resolved:
                        category, full_path = resolved
                        exists = os.path.exists(full_path)
                    else:
                        category = nested_category_hint or "unknown"
                        full_path = None
                        exists = False

                    ref = {
                        "node_id": node_id,
                        "node_type": node_type,
                        "widget_index": idx,
                        "widget_name": widget_name,
                        "original_path": value_str,
                        "node_title": node_title,
                        "category": category,
                        "category_hints": nested_categories or ([category] if category else []),
                        "folder_key_hints": nested_categories or ([category] if category else []),
                        "full_path": full_path,
                        "exists": exists,
                        "is_urn": False,
                        "connected": is_active,
                        "nested_key": nested_key,  # Track nested key for updates
                    }
                    custom_adapter = get_custom_node_model_adapter(node)
                    if custom_adapter:
                        ref["custom_node_adapter"] = custom_adapter.adapter_id

                    if nested_key == "lora":
                        strength = value.get("strength")
                        if strength is not None:
                            try:
                                ref["strength"] = float(strength)
                            except (TypeError, ValueError):
                                pass

                        if isinstance(value.get("on"), bool):
                            ref["active"] = value.get("on")

                    model_refs.append(ref)
            continue

        value_str = str(value).strip()

        # Check if URN
        urn_match = URN_REGEX.match(value_str)
        if urn_match:
            base, typ, provider, model_id, version_id = urn_match.groups()
            category = (
                effective_category_hint
                or URN_TYPE_MAP.get(typ.lower(), "unknown")
            )
            urn_category_hints = (
                categories_to_try_for_widget
                if categories_to_try_for_widget
                else ([category] if category else [])
            )
            urn_folder_key_hints = (
                model_widget_folder_key_hints
                if model_widget_folder_key_hints
                else urn_category_hints
            )

            model_refs.append(
                {
                    "node_id": node_id,
                    "node_type": node_type,
                    "widget_index": idx,
                    "widget_name": widget_name,
                    "original_path": value_str,
                    "urn": {
                        "full": value_str,
                        "base": base,
                        "type": typ,
                        "provider": provider,
                        "model_id": int(model_id),
                        "version_id": int(version_id),
                    },
                    "node_title": node_title,
                    "category": category,
                    "category_hints": urn_category_hints,
                    "folder_key_hints": urn_folder_key_hints,
                    "full_path": None,
                    "exists": False,
                    "is_urn": True,
                    "connected": is_active,
                }
            )
            continue

        # Existing logic for local filenames
        resolved = try_resolve_model_path(
            value_str,
            categories_to_try_for_widget,
            available_models=available_models,
        )

        if resolved:
            category, full_path = resolved
            exists = os.path.exists(full_path)
        else:
            category = effective_category_hint or "unknown"
            full_path = None
            exists = False

        auto_download_capable = bool(
            input_choice_matches_value
            and input_choice_source in {"static", "hybrid", "workflow_schema"}
            and input_choice_looks_like_model
        )
        auto_download_candidate = bool(not exists and auto_download_capable)

        model_refs.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "widget_index": idx,
                "widget_name": widget_name,
                "original_path": value_str,
                "node_title": node_title,
                "category": category,
                "category_hints": categories_to_try_for_widget or ([category] if category else []),
                "folder_key_hints": model_widget_folder_key_hints
                or categories_to_try_for_widget
                or ([category] if category else []),
                "full_path": full_path,
                "exists": exists,
                "input_choice_source": input_choice_source,
                "input_choice_matches_value": input_choice_matches_value,
                "auto_download_capable": auto_download_capable,
                "auto_download_candidate": auto_download_candidate,
                "is_urn": False,
                "connected": is_active,
            }
        )

    return model_refs

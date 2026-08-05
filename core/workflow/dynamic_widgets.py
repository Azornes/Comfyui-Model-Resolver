"""Dynamic workflow widget schemas and category inference."""

import re
import threading
from typing import Any, Dict, List, Optional, Set

from ..log_system import create_module_logger
from ..type_utils import unique_ordered_strings
from .widgets import (
    _ordered_unique_categories,
    get_widget_name_candidates,
    normalize_widget_name,
)

try:
    import folder_paths
except ImportError:
    folder_paths = None

log = create_module_logger(__name__)

_DYNAMIC_CATEGORY_SENTINEL_PREFIX = "__model_resolver_folder_category__"
_DYNAMIC_NODE_WIDGET_CATEGORY_CACHE: Dict[str, Dict[str, Any]] = {}
_DYNAMIC_NODE_WIDGET_CATEGORY_LOCK = threading.RLock()
NON_MODEL_REFERENCE_CATEGORIES = {"custom_nodes", "configs"}

# These ComfyUI INPUT_TYPES entries become widgets in widgets_values. Typed graph
# inputs like MODEL or CLIP are links, so they should not shift widget indexes.
_WIDGET_INPUT_TYPES = {"BOOLEAN", "COMBO", "FLOAT", "INT", "STRING"}
def _merge_category_hints(
    target: Dict[Any, List[str]], key: Any, categories: List[str]
) -> None:
    if not categories:
        return

    target[key] = _ordered_unique_categories(target.get(key, []) + categories)


def _merge_choice_info_values(
    current: Dict[str, Any],
    incoming: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not isinstance(incoming, dict):
        return current

    sources = _ordered_unique_categories(
        [
            source
            for source in [current.get("source"), incoming.get("source")]
            if str(source or "").lower() != "unknown"
        ]
    )
    if "hybrid" in sources or ("folder_paths" in sources and "static" in sources):
        source = "hybrid"
    else:
        source = sources[0] if sources else "unknown"

    return {
        "source": source,
        "choices": _ordered_unique_categories(
            list(current.get("choices") or []) + list(incoming.get("choices") or [])
        ),
    }


def _merge_choice_info(
    target: Dict[Any, Dict[str, Any]], key: Any, info: Dict[str, Any]
) -> None:
    if not isinstance(info, dict):
        return

    target[key] = _merge_choice_info_values(target.get(key, {}), info)


def _summarize_choice_info_for_log(info_by_key: Dict[Any, Dict[str, Any]]) -> Dict[Any, Dict[str, Any]]:
    summary: Dict[Any, Dict[str, Any]] = {}
    if not isinstance(info_by_key, dict):
        return summary

    for key, info in info_by_key.items():
        if not isinstance(info, dict):
            continue
        summary[key] = {
            "source": info.get("source", "unknown"),
            "choice_count": len(info.get("choices") or []),
        }
    return summary


def _summarize_dynamic_hints_for_log(hints: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "widget_names": hints.get("widget_names", []),
        "by_name": hints.get("by_name", {}),
        "by_index": hints.get("by_index", {}),
        "serialized_name_by_index": hints.get("serialized_name_by_index", {}),
        "non_model_by_index": hints.get("non_model_by_index", []),
        "has_generated_widgets": hints.get("has_generated_widgets", False),
        "choice_info_by_name": _summarize_choice_info_for_log(
            hints.get("choice_info_by_name", {})
        ),
        "choice_info_by_index": _summarize_choice_info_for_log(
            hints.get("choice_info_by_index", {})
        ),
    }


def _get_folder_paths_module() -> Any:
    global folder_paths
    if folder_paths is not None:
        return folder_paths

    try:
        import folder_paths as fp

        folder_paths = fp
        return folder_paths
    except Exception:
        return None


def _get_comfy_node_class(node_type: str) -> Any:
    if not node_type:
        return None

    try:
        import nodes as comfy_nodes
    except Exception:
        return None

    node_class_mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    if not isinstance(node_class_mappings, dict):
        return None

    return node_class_mappings.get(node_type)


def _extract_categories_from_value(
    value: Any,
    sentinel_to_category: Dict[str, str],
    depth: int = 0,
    seen: Optional[Set[int]] = None,
) -> List[str]:
    if depth > 8 or not sentinel_to_category:
        return []

    if isinstance(value, str):
        return _ordered_unique_categories(
            [
                category
                for sentinel, category in sentinel_to_category.items()
                if category and sentinel in value
            ]
        )

    if not isinstance(value, (dict, list, tuple, set)):
        return []

    if seen is None:
        seen = set()

    value_id = id(value)
    if value_id in seen:
        return []
    seen.add(value_id)

    categories: List[str] = []
    if isinstance(value, dict):
        for key, nested_value in value.items():
            categories.extend(
                _extract_categories_from_value(
                    key, sentinel_to_category, depth + 1, seen
                )
            )
            categories.extend(
                _extract_categories_from_value(
                    nested_value, sentinel_to_category, depth + 1, seen
                )
            )
    else:
        for item in value:
            categories.extend(
                _extract_categories_from_value(
                    item, sentinel_to_category, depth + 1, seen
                )
            )

    return _ordered_unique_categories(categories)


def _flatten_combo_choice_values(
    value: Any,
    depth: int = 0,
    seen: Optional[Set[int]] = None,
) -> List[str]:
    if depth > 6:
        return []

    if isinstance(value, str):
        return [value]

    if not isinstance(value, (list, tuple, set)):
        return []

    if seen is None:
        seen = set()

    value_id = id(value)
    if value_id in seen:
        return []
    seen.add(value_id)

    choices: List[str] = []
    for item in value:
        choices.extend(_flatten_combo_choice_values(item, depth + 1, seen))
    return _ordered_unique_categories(choices)


def _get_combo_choice_values(spec: Any) -> List[str]:
    if not isinstance(spec, (list, tuple)) or not spec:
        return []

    input_type = spec[0]
    if not isinstance(input_type, (list, tuple, set)):
        return []

    return _flatten_combo_choice_values(input_type)


def _choice_contains_category_sentinel(
    value: Any,
    sentinel_to_category: Dict[str, str],
) -> bool:
    text = str(value or "")
    return any(sentinel and sentinel in text for sentinel in sentinel_to_category)


def _get_widget_choice_info_from_spec(
    spec: Any,
    sentinel_to_category: Dict[str, str],
) -> Dict[str, Any]:
    choices = _get_combo_choice_values(spec)
    if not choices:
        return {}

    has_folder_choices = any(
        _choice_contains_category_sentinel(choice, sentinel_to_category)
        for choice in choices
    )
    static_choices = [
        choice
        for choice in choices
        if not _choice_contains_category_sentinel(choice, sentinel_to_category)
    ]

    if has_folder_choices and static_choices:
        source = "hybrid"
    elif has_folder_choices:
        source = "folder_paths"
    else:
        source = "static"

    return {
        "source": source,
        "choices": static_choices,
    }


def _is_input_type_widget_spec(spec: Any) -> bool:
    if not isinstance(spec, (list, tuple)) or not spec:
        return False

    input_type = spec[0]
    if isinstance(input_type, (list, tuple)):
        return True

    if isinstance(input_type, str):
        return input_type.strip().upper() in _WIDGET_INPUT_TYPES

    return False


def _input_type_generates_control_after_widget(spec: Any) -> bool:
    if not isinstance(spec, (list, tuple)) or len(spec) < 2:
        return False

    options = spec[1]
    return isinstance(options, dict) and options.get("control_after_generate") is True


def _iter_widget_input_type_entries(
    input_types: Dict[str, Any],
) -> List[tuple[str, Any]]:
    entries: List[tuple[str, Any]] = []
    if not isinstance(input_types, dict):
        return entries

    for section_name in ("required", "optional"):
        section = input_types.get(section_name, {})
        if not isinstance(section, dict):
            continue
        entries.extend(section.items())

    return entries


def _empty_dynamic_hints() -> Dict[str, Any]:
    return {
        "widget_names": [],
        "by_name": {},
        "by_index": {},
        "serialized_name_by_index": {},
        "non_model_by_index": [],

        "has_generated_widgets": False,
        "choice_info_by_name": {},
        "choice_info_by_index": {},
    }


def _schema_input_name(input_obj: Any) -> str:
    for key in ("id", "name", "display_name"):
        value = getattr(input_obj, key, None)
        if value:
            return str(value).strip()
    return ""


def _schema_input_io_type(input_obj: Any) -> str:
    get_io_type = getattr(input_obj, "get_io_type", None)
    if callable(get_io_type):
        try:
            return str(get_io_type() or "").strip().upper()
        except Exception:
            pass
    return str(getattr(input_obj, "io_type", "") or "").strip().upper()


def _is_schema_input_widget(input_obj: Any) -> bool:
    io_type = _schema_input_io_type(input_obj)
    return io_type in _WIDGET_INPUT_TYPES


def _iter_schema_input_entries(schema: Any) -> List[tuple[str, Any, bool]]:
    inputs = getattr(schema, "inputs", None)
    if not isinstance(inputs, list):
        return []

    entries: List[tuple[str, Any, bool]] = []
    for input_obj in inputs:
        expanded_inputs = []
        get_all = getattr(input_obj, "get_all", None)
        if callable(get_all):
            try:
                expanded_inputs = get_all()
            except Exception:
                expanded_inputs = []
        if not expanded_inputs:
            expanded_inputs = [input_obj]

        for expanded_input in expanded_inputs:
            entries.append(
                (
                    _schema_input_name(expanded_input),
                    expanded_input,
                    _is_schema_input_widget(expanded_input),
                )
            )
    return entries


def _schema_input_choice_info(
    input_obj: Any,
    sentinel_to_category: Dict[str, str],
) -> Dict[str, Any]:
    options = getattr(input_obj, "options", None)
    if not isinstance(options, (list, tuple, set)):
        return {}
    return _get_widget_choice_info_from_spec((list(options),), sentinel_to_category)


def _merge_dynamic_hint_entry(
    hints: Dict[str, Any],
    normalized_name: str,
    widget_index: Optional[int],
    categories: List[str],
    choice_info: Dict[str, Any],
) -> None:
    if normalized_name:
        hints["widget_names"] = _ordered_unique_categories(
            [*list(hints.get("widget_names") or []), normalized_name]
        )
        _merge_category_hints(hints["by_name"], normalized_name, categories)
        if choice_info:
            _merge_choice_info(
                hints["choice_info_by_name"],
                normalized_name,
                choice_info,
            )

    if widget_index is not None:
        if categories:
            _merge_category_hints(hints["by_index"], widget_index, categories)
        if choice_info:
            _merge_choice_info(
                hints["choice_info_by_index"],
                widget_index,
                choice_info,
            )


def _build_dynamic_node_widget_category_hints(node_type: str) -> Dict[str, Any]:
    empty_hints = _empty_dynamic_hints()
    node_class = _get_comfy_node_class(node_type)
    if node_class is None:
        return empty_hints

    input_types_getter = getattr(node_class, "INPUT_TYPES", None)
    schema_getter = getattr(node_class, "define_schema", None)
    if not callable(input_types_getter) and not callable(schema_getter):
        return empty_hints

    folder_paths_module = _get_folder_paths_module()
    get_filename_list = getattr(folder_paths_module, "get_filename_list", None)

    sentinel_to_category: Dict[str, str] = {}

    def traced_get_filename_list(category: Any, *args: Any, **kwargs: Any) -> List[str]:
        category_name = str(category or "").strip()
        sentinel = (
            f"{_DYNAMIC_CATEGORY_SENTINEL_PREFIX}"
            f"{len(sentinel_to_category)}.safetensors"
        )
        sentinel_to_category[sentinel] = category_name
        return [sentinel]

    input_types_func = getattr(input_types_getter, "__func__", input_types_getter)
    schema_func = getattr(schema_getter, "__func__", schema_getter)
    patched_globals: List[tuple[Dict[str, Any], str, Any]] = []
    patched_folder_paths = False

    def patch_get_filename_list_global(callable_obj: Any) -> None:
        if not callable(callable_obj) or not callable(get_filename_list):
            return

        globals_dict = getattr(callable_obj, "__globals__", {})
        if not isinstance(globals_dict, dict):
            return

        for global_name, global_value in list(globals_dict.items()):
            if global_value is get_filename_list:
                globals_dict[global_name] = traced_get_filename_list
                patched_globals.append((globals_dict, global_name, global_value))

    try:
        if folder_paths_module is not None and callable(get_filename_list):
            folder_paths_module.get_filename_list = traced_get_filename_list
            patched_folder_paths = True
            patch_get_filename_list_global(input_types_func)
            patch_get_filename_list_global(schema_func)

        input_types = input_types_getter() if callable(input_types_getter) else None
        schema = schema_getter() if callable(schema_getter) else None
    except Exception as exc:
        log.debug(
            f"Could not infer dynamic model widget categories for {node_type}: {exc}"
        )
        return empty_hints
    finally:
        for global_scope, global_name, global_value in patched_globals:
            global_scope[global_name] = global_value
        if patched_folder_paths:
            folder_paths_module.get_filename_list = get_filename_list

    if not isinstance(input_types, dict) and schema is None:
        return empty_hints

    hints = _empty_dynamic_hints()
    widget_index = 0

    for input_name, spec in _iter_widget_input_type_entries(input_types):
        categories = _extract_categories_from_value(spec, sentinel_to_category)
        choice_info = _get_widget_choice_info_from_spec(spec, sentinel_to_category)
        normalized_name = normalize_widget_name(input_name)
        is_widget = _is_input_type_widget_spec(spec)
        entry_widget_index = widget_index if is_widget else None
        if is_widget:
            hints["serialized_name_by_index"][widget_index] = normalized_name
        _merge_dynamic_hint_entry(
            hints,
            normalized_name,
            entry_widget_index,
            categories,
            choice_info,
        )
        if is_widget:
            widget_index += 1
            if _input_type_generates_control_after_widget(spec):
                hints["has_generated_widgets"] = True
                hints["serialized_name_by_index"][
                    widget_index
                ] = "control_after_generate"
                hints["non_model_by_index"].append(widget_index)
                widget_index += 1

    for input_name, input_obj, is_widget in _iter_schema_input_entries(schema):
        categories = _extract_categories_from_value(
            getattr(input_obj, "options", None),
            sentinel_to_category,
        )
        choice_info = _schema_input_choice_info(input_obj, sentinel_to_category)
        normalized_name = normalize_widget_name(input_name)
        _merge_dynamic_hint_entry(
            hints,
            normalized_name,
            widget_index if is_widget else None,
            categories,
            choice_info,
        )
        if is_widget:
            widget_index += 1

    if (
        hints["by_name"]
        or hints["by_index"]
        or hints["choice_info_by_name"]
        or hints["choice_info_by_index"]
    ):
        log.debug(
            "Inferred dynamic model widget categories for "
            f"{node_type}: {_summarize_dynamic_hints_for_log(hints)}"
        )

    return hints


def get_dynamic_node_widget_category_hints(node_type: str) -> Dict[str, Any]:
    if not node_type:
        return _empty_dynamic_hints()

    with _DYNAMIC_NODE_WIDGET_CATEGORY_LOCK:
        cached = _DYNAMIC_NODE_WIDGET_CATEGORY_CACHE.get(node_type)
        if cached is not None:
            return cached

        hints = _build_dynamic_node_widget_category_hints(node_type)

        # Only cache after ComfyUI has exposed the node class and folder_paths. If
        # analysis runs unusually early, a later call can still infer the hints.
        if _get_comfy_node_class(node_type) is not None and _get_folder_paths_module():
            _DYNAMIC_NODE_WIDGET_CATEGORY_CACHE[node_type] = hints

        return hints


CONTROL_AFTER_GENERATE_VALUES = {
    "fixed",
    "increment",
    "decrement",
    "randomize",
}


def _normalized_index_mapping(value: Any) -> Dict[int, str]:
    if not isinstance(value, dict):
        return {}

    normalized: Dict[int, str] = {}
    for raw_index, raw_name in value.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if index < 0:
            continue
        normalized[index] = str(raw_name or "").strip()
    return normalized


def _dynamic_serialized_widget_layout(
    node: Dict[str, Any], hints: Dict[str, Any]
) -> tuple[Dict[int, str], Set[int]]:
    names_by_index = _normalized_index_mapping(
        hints.get("serialized_name_by_index", {})
    )
    non_model_indices = {
        int(index)
        for index in hints.get("non_model_by_index", [])
        if str(index).isdigit()
    }
    if hints.get("has_generated_widgets"):
        return names_by_index, non_model_indices

    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list) or not names_by_index:
        return {}, set()

    expected_widget_count = max(names_by_index) + 1
    remaining_extra_widgets = len(widgets_values) - expected_widget_count
    if remaining_extra_widgets <= 0:
        return {}, set()

    effective_names: Dict[int, str] = {}
    effective_non_model_indices: Set[int] = set()
    inserted_widget_count = 0

    for base_index in sorted(names_by_index):
        widget_name = names_by_index[base_index]
        actual_index = base_index + inserted_widget_count
        effective_names[actual_index] = widget_name

        normalized_name = normalize_widget_name(widget_name)
        control_index = actual_index + 1
        seed_value = (

            widgets_values[actual_index]
            if actual_index < len(widgets_values)
            else None
        )
        control_value = (
            str(widgets_values[control_index] or "").strip().lower()
            if control_index < len(widgets_values)
            else ""
        )
        is_seed_widget = normalized_name == "seed" or normalized_name.endswith(
            "_seed"
        )
        if (
            remaining_extra_widgets > 0
            and is_seed_widget
            and isinstance(seed_value, int)
            and not isinstance(seed_value, bool)
            and control_value in CONTROL_AFTER_GENERATE_VALUES
        ):
            effective_names[control_index] = "control_after_generate"
            effective_non_model_indices.add(control_index)
            inserted_widget_count += 1
            remaining_extra_widgets -= 1

    if not effective_non_model_indices:
        return {}, set()
    return effective_names, effective_non_model_indices


def get_dynamic_serialized_widget_name(
    node: Dict[str, Any], widget_index: int
) -> str:
    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))
    names_by_index, _non_model_indices = _dynamic_serialized_widget_layout(
        node, hints
    )
    return names_by_index.get(widget_index, "")


LORA_MODEL_STRENGTH_WIDGET_NAMES = (
    "strength_model",
    "lora_model_strength",
    "model_strength",
    "lora_strength",
    "strength",
)

LEGACY_LORA_STRENGTH_NEXT_WIDGET_TYPES = {
    "LoraLoader",
    "LoraLoaderModelOnly",
    "LoraLoaderBypass",
    "LoraLoaderBypassModelOnly",
    "CreateHookLora",
    "CreateHookLoraModelOnly",
}


def _coerce_lora_strength(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def get_lora_model_strength(
    node: Dict[str, Any], lora_widget_index: Optional[int] = None
) -> Optional[float]:
    """Return the model strength associated with a LoRA widget in a workflow node."""
    widgets_values = node.get("widgets_values", [])
    if not isinstance(widgets_values, list):
        return None

    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))
    schema_names = _normalized_index_mapping(
        hints.get("serialized_name_by_index", {})
    )
    effective_names, _non_model_indices = _dynamic_serialized_widget_layout(
        node, hints
    )
    if effective_names:
        schema_names = effective_names

    values_by_name: Dict[str, Any] = {}
    names_by_index: Dict[int, List[str]] = {}
    for widget_index, value in enumerate(widgets_values):
        names = []
        schema_name = schema_names.get(widget_index)
        if schema_name:
            names.append(schema_name)
        names.extend(get_widget_name_candidates(node, widget_index))
        normalized_names = unique_ordered_strings(
            [normalize_widget_name(name) for name in names]
        )
        names_by_index[widget_index] = normalized_names
        for normalized_name in normalized_names:
            if normalized_name and normalized_name not in values_by_name:
                values_by_name[normalized_name] = value

    if isinstance(lora_widget_index, int):
        for widget_name in names_by_index.get(lora_widget_index, []):
            indexed_match = re.fullmatch(r"lora_(\d+)_name", widget_name)
            if not indexed_match:
                continue

            lora_number = indexed_match.group(1)
            mode = str(values_by_name.get("mode") or "").strip().lower()
            if mode == "simple":
                indexed_strength_names = [
                    f"lora_{lora_number}_strength",
                    f"lora_{lora_number}_model_strength",
                ]
            else:
                indexed_strength_names = [
                    f"lora_{lora_number}_model_strength",
                    f"lora_{lora_number}_strength",
                ]

            for strength_name in indexed_strength_names:
                strength = _coerce_lora_strength(
                    values_by_name.get(strength_name)
                )
                if strength is not None:
                    return strength

    for strength_name in LORA_MODEL_STRENGTH_WIDGET_NAMES:
        if strength_name not in values_by_name:
            continue
        strength = _coerce_lora_strength(values_by_name[strength_name])
        if strength is not None:
            return strength

    node_type = str(node.get("type", "") or "")
    if (
        node_type in LEGACY_LORA_STRENGTH_NEXT_WIDGET_TYPES
        and isinstance(lora_widget_index, int)
        and 0 <= lora_widget_index + 1 < len(widgets_values)
    ):
        return _coerce_lora_strength(widgets_values[lora_widget_index + 1])

    return None


def is_dynamic_non_model_widget(node: Dict[str, Any], widget_index: int) -> bool:
    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))
    _names_by_index, non_model_indices = _dynamic_serialized_widget_layout(
        node, hints
    )
    return widget_index in non_model_indices


def get_dynamic_widget_category_hints(
    node: Dict[str, Any], widget_index: int
) -> List[str]:
    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))

    if is_dynamic_non_model_widget(node, widget_index):
        return []

    categories: List[str] = []
    by_name = hints.get("by_name", {})
    serialized_name = get_dynamic_serialized_widget_name(node, widget_index)
    normalized_candidates = (
        [normalize_widget_name(serialized_name)]
        if serialized_name
        else [
            normalize_widget_name(candidate)
            for candidate in get_widget_name_candidates(node, widget_index)
        ]
    )
    if isinstance(by_name, dict):
        for candidate in normalized_candidates:
            categories.extend(by_name.get(candidate, []))

    known_widget_names = set(hints.get("widget_names") or [])
    if any(candidate in known_widget_names for candidate in normalized_candidates):
        return _ordered_unique_categories(categories)

    by_index = hints.get("by_index", {})
    if isinstance(by_index, dict):
        categories.extend(by_index.get(widget_index, []))

    return _ordered_unique_categories(categories)


def _normalize_choice_for_match(value: Any) -> str:
    return (
        str(value or "")
        .strip()
        .replace("\\", "/")
        .lower()
    )


def get_dynamic_widget_choice_info(
    node: Dict[str, Any], widget_index: int
) -> Dict[str, Any]:
    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))
    info: Dict[str, Any] = {"source": "unknown", "choices": []}

    if is_dynamic_non_model_widget(node, widget_index):
        return info

    by_name = hints.get("choice_info_by_name", {})
    serialized_name = get_dynamic_serialized_widget_name(node, widget_index)
    normalized_candidates = (
        [normalize_widget_name(serialized_name)]
        if serialized_name
        else [
            normalize_widget_name(candidate)
            for candidate in get_widget_name_candidates(node, widget_index)
        ]
    )
    if isinstance(by_name, dict):
        for candidate in normalized_candidates:
            candidate_info = by_name.get(candidate, {})
            if isinstance(candidate_info, dict):
                info = _merge_choice_info_values(info, candidate_info)

    known_widget_names = set(hints.get("widget_names") or [])
    if any(candidate in known_widget_names for candidate in normalized_candidates):
        return info

    by_index = hints.get("choice_info_by_index", {})
    if isinstance(by_index, dict):
        candidate_info = by_index.get(widget_index, {})
        if isinstance(candidate_info, dict):
            info = _merge_choice_info_values(info, candidate_info)

    return info

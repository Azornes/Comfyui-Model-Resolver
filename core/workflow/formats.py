"""Helpers for recognizing and normalizing ComfyUI workflow formats."""

from collections.abc import Mapping
from typing import Any, Dict, Optional, Tuple

UI_WORKFLOW_FORMAT = "ui"
API_WORKFLOW_FORMAT = "api"

_WORKFLOW_CONTAINER_KEYS = (
    "workflow",
    "prompt",
    "comfy",
    "comfyui",
    "extra_pnginfo",
    "extra_metadata",
    "graph",
)


def _is_api_link(value: Any) -> bool:
    """Return whether a value has ComfyUI API link shape: [node_id, output]."""
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and not isinstance(value[1], bool)
        and isinstance(value[1], int)
        and not isinstance(value[0], bool)
        and isinstance(value[0], (str, int))
    )


def _is_api_node(value: Any) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("class_type"), str)
        and bool(value.get("class_type", "").strip())
        and isinstance(value.get("inputs"), Mapping)
    )


def detect_workflow_format(workflow: Any) -> Optional[str]:
    """Identify a ComfyUI editor workflow or API prompt graph."""
    if not isinstance(workflow, Mapping):
        return None
    if isinstance(workflow.get("nodes"), list):
        return UI_WORKFLOW_FORMAT
    if any(_is_api_node(value) for value in workflow.values()):
        return API_WORKFLOW_FORMAT
    return None


def _parse_json_string(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value

    import json

    try:
        return json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def find_workflow_payload(value: Any, *, max_depth: int = 6) -> Tuple[Any, Optional[str]]:
    """Find a workflow nested in common ComfyUI metadata containers."""
    current = _parse_json_string(value)
    if not isinstance(current, Mapping):
        return None, None

    detected = detect_workflow_format(current)
    if detected:
        return current, detected
    if max_depth <= 0:
        return None, None

    for key in _WORKFLOW_CONTAINER_KEYS:
        if key not in current:
            continue
        nested, detected = find_workflow_payload(
            current.get(key),
            max_depth=max_depth - 1,
        )
        if detected:
            return nested, detected
    return None, None


def _build_api_workflow(api_workflow: Mapping[str, Any]) -> Dict[str, Any]:
    """Convert an API prompt graph into a read-only editor-like workflow.

    The analyzer consumes editor nodes, while API prompts store widget values
    by input name and connections as ``[source_node, output_index]``. The
    generated nodes retain input names so the existing category and custom-node
    rules can inspect them without executing or mutating the prompt.
    """
    entries = [
        (str(node_id), node)
        for node_id, node in api_workflow.items()
        if _is_api_node(node)
    ]

    link_ids: Dict[Tuple[str, int, str], int] = {}
    output_links: Dict[Tuple[str, int], list[int]] = {}
    next_link_id = 1
    for target_node_id, node in entries:
        inputs = node.get("inputs", {})
        for _input_name, value in inputs.items():
            if not _is_api_link(value):
                continue
            source_node_id = str(value[0])
            output_index = int(value[1])
            connection_key = (source_node_id, output_index, target_node_id)
            link_id = link_ids.get(connection_key)
            if link_id is None:
                link_id = next_link_id
                next_link_id += 1
                link_ids[connection_key] = link_id
                output_links.setdefault((source_node_id, output_index), []).append(
                    link_id
                )

    nodes = []
    for node_id, node in entries:
        inputs = node.get("inputs", {})
        widgets_values = []
        widget_items = []
        input_items = []
        for input_name, value in inputs.items():
            input_name = str(input_name)
            if _is_api_link(value):
                connection_key = (str(value[0]), int(value[1]), node_id)
                input_items.append(
                    {
                        "name": input_name,
                        "link": link_ids[connection_key],
                    }
                )
                continue

            widgets_values.append(value)
            widget_items.append({"name": input_name})
            input_items.append(
                {
                    "name": input_name,
                    "widget": {"name": input_name},
                }
            )

        meta = node.get("_meta", {})
        meta = meta if isinstance(meta, Mapping) else {}
        title = str(meta.get("title", "") or "").strip()

        output_indexes = [
            output_index
            for source_node_id, output_index in output_links
            if source_node_id == node_id
        ]
        outputs = []
        if output_indexes:
            for output_index in range(max(output_indexes) + 1):
                outputs.append(
                    {
                        "links": output_links.get((node_id, output_index), []),
                    }
                )

        normalized_node = {
            "id": node_id,
            "type": str(node.get("class_type", "")),
            "widgets_values": widgets_values,
            "widgets": widget_items,
            "inputs": input_items,
            "outputs": outputs,
            "mode": node.get("mode", 0),
        }
        if title:
            normalized_node["title"] = title
        if isinstance(node.get("properties"), Mapping):
            normalized_node["properties"] = dict(node["properties"])
        nodes.append(normalized_node)

    return {"nodes": nodes}


def normalize_workflow_payload(workflow: Any) -> Tuple[Dict[str, Any], str]:
    """Return an analyzer-compatible workflow and its original format."""
    payload, detected = find_workflow_payload(workflow)
    if not detected or not isinstance(payload, Mapping):
        raise ValueError(
            "Unsupported workflow JSON. Expected a ComfyUI UI workflow "
            "with a nodes array or an API prompt graph."
        )
    if detected == UI_WORKFLOW_FORMAT:
        return dict(payload), detected
    return _build_api_workflow(payload), detected


__all__ = [
    "API_WORKFLOW_FORMAT",
    "UI_WORKFLOW_FORMAT",
    "detect_workflow_format",
    "find_workflow_payload",
    "normalize_workflow_payload",
]

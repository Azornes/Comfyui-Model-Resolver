"""Shared workflow node traversal helpers."""

from dataclasses import dataclass
from typing import Any, Dict, Iterator, Optional


@dataclass(frozen=True)
class WorkflowNodeContext:
    """A workflow node together with the scope where it is defined."""

    node: Any
    subgraph_id: Optional[Any] = ""
    subgraph_name: Optional[Any] = ""
    is_top_level: bool = True


def iter_workflow_nodes_with_scope(
    workflow_json: Dict[str, Any],
) -> Iterator[WorkflowNodeContext]:
    """Yield top-level and subgraph nodes in serialized workflow order."""
    nodes = workflow_json.get("nodes", [])
    if isinstance(nodes, list):
        for node in nodes:
            yield WorkflowNodeContext(node=node)

    definitions = workflow_json.get("definitions", {})
    subgraphs = (
        definitions.get("subgraphs", [])
        if isinstance(definitions, dict)
        else []
    )
    if not isinstance(subgraphs, list):
        return

    for subgraph in subgraphs:
        if not isinstance(subgraph, dict):
            continue
        subgraph_nodes = subgraph.get("nodes", [])
        if not isinstance(subgraph_nodes, list):
            continue

        subgraph_id = subgraph.get("id") or ""
        subgraph_name = subgraph.get("name") or subgraph_id or ""
        for node in subgraph_nodes:
            yield WorkflowNodeContext(
                node=node,
                subgraph_id=subgraph_id,
                subgraph_name=subgraph_name,
                is_top_level=False,
            )


def iter_active_workflow_nodes_with_scope(
    workflow_json: Dict[str, Any],
) -> Iterator[WorkflowNodeContext]:
    """Yield top-level nodes and recursively referenced subgraph nodes."""
    if not isinstance(workflow_json, dict):
        return

    top_level_nodes = workflow_json.get("nodes")
    if not isinstance(top_level_nodes, list):
        return

    active_nodes = [node for node in top_level_nodes if isinstance(node, dict)]
    for node in active_nodes:
        yield WorkflowNodeContext(node=node)

    definitions = workflow_json.get("definitions")
    if not isinstance(definitions, dict):
        return

    subgraph_list = definitions.get("subgraphs")
    if not isinstance(subgraph_list, list):
        return

    subgraphs = {
        str(subgraph.get("id")): subgraph
        for subgraph in subgraph_list
        if isinstance(subgraph, dict) and subgraph.get("id") is not None
    }
    pending_subgraphs = [
        str(node.get("type"))
        for node in active_nodes
        if str(node.get("type")) in subgraphs
    ]
    seen_subgraphs = set()

    while pending_subgraphs:
        subgraph_id = pending_subgraphs.pop(0)
        if subgraph_id in seen_subgraphs:
            continue
        seen_subgraphs.add(subgraph_id)

        subgraph = subgraphs.get(subgraph_id)
        subgraph_nodes = subgraph.get("nodes") if isinstance(subgraph, dict) else None
        if not isinstance(subgraph_nodes, list):
            continue

        subgraph_name = subgraph.get("name") or subgraph_id or ""
        for node in subgraph_nodes:
            if not isinstance(node, dict):
                continue
            yield WorkflowNodeContext(
                node=node,
                subgraph_id=subgraph_id,
                subgraph_name=subgraph_name,
                is_top_level=False,
            )
            nested_subgraph_id = str(node.get("type"))
            if (
                nested_subgraph_id in subgraphs
                and nested_subgraph_id not in seen_subgraphs
            ):
                pending_subgraphs.append(nested_subgraph_id)

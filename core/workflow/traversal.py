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

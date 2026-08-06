"""Helpers for validating common request payload fields."""

from typing import Any, Optional, Tuple


def validate_workflow_payload(
    workflow: Any,
    *,
    none_is_missing: bool = True,
    empty_is_missing: bool = False,
    require_object: bool = True,
) -> Tuple[Any, Optional[str]]:
    """Validate a workflow value while allowing endpoint-specific semantics."""
    if (none_is_missing and workflow is None) or (
        empty_is_missing and not workflow
    ):
        return None, "Workflow JSON is required"
    if require_object and not isinstance(workflow, dict):
        return None, "Workflow JSON must be an object"
    return workflow, None

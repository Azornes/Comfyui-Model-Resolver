"""Helpers for validating and reading common request payload fields."""

from collections.abc import Mapping
from typing import Any, Optional, Tuple

from .type_utils import normalize_sha256


def extract_request_sha256(
    payload: Mapping[str, Any],
    *,
    keys: Tuple[str, ...],
) -> str:
    """Normalize the first non-empty SHA256 alias found in a request payload."""
    value = ""
    for key in keys:
        value = payload.get(key)
        if value:
            break
    return normalize_sha256(value)


async def read_optional_object_payload(request: Any) -> dict[str, Any]:
    """Read an optional JSON object, returning an empty dict on invalid input."""
    if not getattr(request, "can_read_body", True):
        return {}
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


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

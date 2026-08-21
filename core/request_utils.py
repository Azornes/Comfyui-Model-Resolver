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
        if value is None or value == "":
            continue
        if not isinstance(value, str):
            raise TypeError(f"Request {key} must be a string")
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


def read_text_field(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    default: str = "",
    contract_name: str = "Request",
) -> str:
    """Read a request text field without silently stringifying invalid values."""
    value = payload.get(field_name, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise TypeError(f"{contract_name} {field_name} must be a string")
    return value.strip()


def read_optional_text_field(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    default: str | None = None,
    contract_name: str = "Request",
) -> str | None:
    """Read an optional request text field without stringifying bad values."""
    value = payload.get(field_name, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise TypeError(f"{contract_name} {field_name} must be a string")
    return value.strip() or default


def read_first_text_field(
    payload: Mapping[str, Any],
    field_names: Tuple[str, ...],
    *,
    default: str = "",
    contract_name: str = "Request",
) -> str:
    """Read the first non-empty text alias without bypassing invalid values."""
    for field_name in field_names:
        if field_name not in payload:
            continue
        value = payload[field_name]
        if value is None:
            continue
        if not isinstance(value, str):
            raise TypeError(f"{contract_name} {field_name} must be a string")
        value = value.strip()
        if value:
            return value
    return default


def read_first_identifier_field(
    payload: Mapping[str, Any],
    field_names: Tuple[str, ...],
    *,
    default: int | str | None = None,
    contract_name: str = "Request",
) -> int | str | None:
    """Read the first non-empty integer/string identifier alias."""
    for field_name in field_names:
        if field_name not in payload:
            continue
        value = payload[field_name]
        if value is None or value == "":
            continue
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise TypeError(
                f"{contract_name} {field_name} must be an integer or string"
            )
        if isinstance(value, str):
            value = value.strip()
            if not value:
                continue
        return value
    return default


def read_identifier_field(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    default: int | str | None = None,
    contract_name: str = "Request",
) -> int | str | None:
    """Read an optional integer/string identifier without accepting booleans."""
    value = payload.get(field_name, default)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise TypeError(
            f"{contract_name} {field_name} must be an integer or string"
        )
    if isinstance(value, str):
        return value.strip() or default
    return value


def coerce_integer_identifier(
    value: int | str | None,
    field_name: str,
    *,
    contract_name: str = "Request",
) -> int | None:
    """Convert a validated identifier to an integer without hiding bad values."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise TypeError(f"{contract_name} {field_name} must be an integer")
    if isinstance(value, int):
        return value
    text = value.strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise ValueError(
            f"{contract_name} {field_name} must be an integer"
        ) from exc


def read_bool_field(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    default: bool = False,
    contract_name: str = "Request",
) -> bool:
    """Read a request boolean using only the supported JSON representations."""
    value = payload.get(field_name, default)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise TypeError(f"{contract_name} {field_name} must be a boolean")


def read_first_bool_field(
    payload: Mapping[str, Any],
    field_names: Tuple[str, ...],
    *,
    default: bool = False,
    contract_name: str = "Request",
) -> bool:
    """Read the first non-empty boolean alias without coercing bad values."""
    for field_name in field_names:
        if field_name not in payload:
            continue
        value = payload[field_name]
        if value is None or value == "":
            continue
        return read_bool_field(
            payload,
            field_name,
            default=default,
            contract_name=contract_name,
        )
    return default


def read_int_field(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    default: int | None = None,
    contract_name: str = "Request",
) -> int | None:
    """Read an optional integer without accepting booleans or float truncation."""
    value = payload.get(field_name, default)
    if value is None or value == "":
        return default
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise TypeError(f"{contract_name} {field_name} must be an integer")
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError as exc:
            raise ValueError(
                f"{contract_name} {field_name} must be an integer"
            ) from exc
    return value


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

"""Read-only workflow metadata inspection for images and JSON files."""

import base64
import binascii
import io
import json
from collections.abc import Mapping
from typing import Any, Optional

from ..request_utils import (
    read_optional_object_payload,
    read_optional_text_field,
    read_text_field,
)
from ..routes.context import RouteContext
from ..workflow.formats import normalize_workflow_payload

MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_WORKFLOW_JSON_BYTES = 16 * 1024 * 1024
MAX_PARAMETERS_LENGTH = 12_000


def _decode_metadata_value(value: Any) -> Any:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("utf-8", errors="replace")
    return value


def _metadata_json_value(value: Any) -> Any:
    value = _decode_metadata_value(value)
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return value
    if text[0] not in "[{":
        prefix, separator, remainder = text.partition(":")
        if separator and prefix.strip().lower() in {
            "prompt",
            "workflow",
            "comfy",
            "comfyui",
        }:
            text = remainder.strip()
        else:
            return value
    if not text or text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def _safe_metadata_value(value: Any) -> Any:
    value = _decode_metadata_value(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _read_image_bytes(data_url: str) -> bytes:
    encoded = data_url.strip()
    if encoded.startswith("data:"):
        header, separator, encoded = encoded.partition(",")
        if not separator or ";base64" not in header.lower():
            raise ValueError("Image payload must be a base64 data URL")
    encoded = "".join(encoded.split())
    if not encoded:
        raise ValueError("Image payload is empty")
    if len(encoded) > ((MAX_IMAGE_BYTES + 2) * 4 // 3) + 16:
        raise ValueError("Image payload is too large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Image payload is not valid base64") from exc
    if not raw:
        raise ValueError("Image payload is empty")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("Image payload is too large")
    return raw


def _image_metadata(image: Any) -> dict[str, Any]:
    metadata = {
        str(key): _safe_metadata_value(value)
        for key, value in (image.info or {}).items()
    }

    try:
        from PIL.ExifTags import TAGS

        for tag_id, value in image.getexif().items():
            key = TAGS.get(tag_id, str(tag_id))
            metadata.setdefault(f"EXIF:{key}", _safe_metadata_value(value))
    except Exception:
        # EXIF is optional and malformed EXIF must not hide valid PNG/WebP info.
        pass
    return metadata


def _find_embedded_workflow(metadata: Mapping[str, Any]):
    priority_keys = (
        "workflow",
        "prompt",
        "comfyui",
        "comfy",
        "extra_pnginfo",
        "extra_metadata",
    )
    candidates = []
    seen = set()
    for key in priority_keys:
        if key in metadata:
            candidates.append((key, metadata[key]))
            seen.add(key)
    candidates.extend(
        (key, value)
        for key, value in metadata.items()
        if key not in seen
    )

    for key, value in candidates:
        candidate = _metadata_json_value(value)
        try:
            normalized, workflow_format = normalize_workflow_payload(candidate)
        except ValueError:
            continue
        return normalized, workflow_format, key
    return None, None, ""


def _metadata_summary(
    metadata: Mapping[str, Any],
    *,
    workflow_format: Optional[str],
    workflow_source: str,
) -> dict[str, Any]:
    parameters = next(
        (
            value
            for key, value in metadata.items()
            if str(key).strip().lower() == "parameters"
        ),
        None,
    )
    parameters = _decode_metadata_value(parameters)
    if parameters is not None and not isinstance(parameters, str):
        parameters = str(parameters)
    if isinstance(parameters, str):
        parameters = parameters[:MAX_PARAMETERS_LENGTH]
    else:
        parameters = ""
    return {
        "keys": list(metadata.keys()),
        "has_workflow": bool(workflow_format),
        "workflow_source": workflow_source,
        "parameters": parameters,
    }


def inspect_image_bytes(raw: bytes, filename: str = "") -> dict[str, Any]:
    """Inspect a supported image without writing it or executing its workflow."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            metadata = _image_metadata(image)
            workflow, workflow_format, workflow_source = _find_embedded_workflow(
                metadata
            )
            return {
                "source_type": "image",
                "filename": filename or "Dropped image",
                "image": {
                    "format": str(image.format or "").upper(),
                    "width": int(image.width),
                    "height": int(image.height),
                    "mode": str(image.mode or ""),
                },
                "metadata": _metadata_summary(
                    metadata,
                    workflow_format=workflow_format,
                    workflow_source=workflow_source,
                ),
                "workflow": workflow,
                "workflow_format": workflow_format or "",
                "workflow_source": workflow_source,
                "workflow_node_count": len(workflow.get("nodes", []))
                if isinstance(workflow, Mapping)
                else 0,
            }
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Could not read image metadata: {exc}") from exc


def _parse_workflow_json_text(value: str) -> Any:
    if len(value.encode("utf-8")) > MAX_WORKFLOW_JSON_BYTES:
        raise ValueError("Workflow JSON is too large")
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Workflow JSON is not valid JSON") from exc


def inspect_workflow_json(
    workflow: Any,
    *,
    filename: str = "",
    source_type: str = "workflow",
) -> dict[str, Any]:
    """Normalize a UI/API workflow for the read-only inspector."""
    if isinstance(workflow, str):
        workflow = _parse_workflow_json_text(workflow)
    try:
        normalized, workflow_format = normalize_workflow_payload(workflow)
    except ValueError:
        raise
    return {
        "source_type": source_type,
        "filename": filename or "Pasted workflow",
        "image": None,
        "metadata": {
            "keys": [],
            "has_workflow": True,
            "workflow_source": "json",
            "parameters": "",
        },
        "workflow": normalized,
        "workflow_format": workflow_format,
        "workflow_source": "json",
        "workflow_node_count": len(normalized.get("nodes", [])),
    }


class ImageMetadataService:
    """HTTP service for dropped images, workflow JSON files, and pasted JSON."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.require("asyncio")
        self.web = context.require("web")

    async def inspect_metadata(self, request):
        data = await read_optional_object_payload(request)
        try:
            source_type = read_text_field(
                data,
                "source_type",
                contract_name="Metadata inspection request",
            ).lower()
            filename = read_optional_text_field(
                data,
                "filename",
                contract_name="Metadata inspection request",
            ) or ""
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        try:
            if source_type == "image":
                data_url = data.get("data_url")
                if not isinstance(data_url, str):
                    raise ValueError("Image data is required")
                raw = _read_image_bytes(data_url)
                result = await self.asyncio.to_thread(
                    inspect_image_bytes,
                    raw,
                    filename,
                )
            elif source_type in {"workflow", "json"}:
                workflow = data.get("workflow")
                if workflow is None:
                    workflow = data.get("json_text")
                if workflow is None:
                    raise ValueError("Workflow JSON is required")
                result = await self.asyncio.to_thread(
                    inspect_workflow_json,
                    workflow,
                    filename=filename,
                    source_type="workflow",
                )
            else:
                raise ValueError("Metadata source type must be image or workflow")
        except (TypeError, ValueError) as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        except Exception as exc:
            return self.web.json_response(
                {"error": f"Metadata inspection failed: {exc}"},
                status=500,
            )

        return self.web.json_response(result)

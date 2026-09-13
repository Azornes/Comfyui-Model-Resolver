"""Read-only workflow metadata inspection for images and JSON files."""

import base64
import binascii
import io
import json
import re
from collections.abc import Mapping
from typing import Any, Optional

from ..request_utils import (
    read_optional_object_payload,
    read_optional_text_field,
    read_text_field,
)
from ..routes.context import RouteContext
from ..type_utils import CATEGORY_MAP, normalize_category_token
from ..workflow.formats import normalize_workflow_payload

MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_WORKFLOW_JSON_BYTES = 16 * 1024 * 1024
MAX_PARAMETERS_LENGTH = 12_000
EXIF_IFD_TAG = 34665

_CIVITAI_JSON_LABELS = (
    "Civitai metadata",
    "Civitai resources",
)
def _decode_exif_user_comment(value: bytes) -> str:
    """Decode the standard EXIF UserComment prefix and payload."""
    if value.startswith(b"UNICODE"):
        payload = value[7:].lstrip(b"\x00")
        if len(payload) % 2:
            payload += b"\x00"
        for encoding in ("utf-16le", "utf-16be"):
            try:
                return payload.decode(encoding).rstrip("\x00")
            except UnicodeDecodeError:
                continue
        return payload.decode("utf-8", errors="replace").rstrip("\x00")
    if value.startswith(b"ASCII"):
        return value[5:].lstrip(b"\x00").rstrip(b"\x00").decode(
            "ascii", errors="replace"
        )
    if value.startswith(b"JIS"):
        return value[3:].lstrip(b"\x00").rstrip(b"\x00").decode(
            "shift_jis", errors="replace"
        )
    return value.decode("utf-8", errors="replace").rstrip("\x00")


def _decode_metadata_value(value: Any, *, tag_name: str = "") -> Any:
    if isinstance(value, bytes):
        if str(tag_name).strip().lower().endswith("usercomment"):
            return _decode_exif_user_comment(value)
        try:
            return value.decode("utf-8").rstrip("\x00")
        except UnicodeDecodeError:
            return value.decode("utf-8", errors="replace").rstrip("\x00")
    return value


def _metadata_json_value(value: Any) -> Any:
    current = _decode_metadata_value(value)
    for _ in range(3):
        if not isinstance(current, str):
            return current
        text = current.strip()
        if not text:
            return current
        if text[0] not in "[{\"":
            prefix, separator, remainder = text.partition(":")
            if separator and prefix.strip().lower() in {
                "prompt",
                "workflow",
                "comfy",
                "comfyui",
            }:
                text = remainder.strip()
            else:
                return current
        if not text:
            return current
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError, json.JSONDecodeError):
            return current
        if not isinstance(parsed, str):
            return parsed
        current = parsed
    return current


def _extract_labeled_json(value: Any, label: str) -> Any:
    """Read a JSON value following a label inside free-form metadata text."""
    value = _decode_metadata_value(value)
    if not isinstance(value, str):
        return None
    match = re.search(
        rf"{re.escape(label)}\s*:\s*",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    payload = value[match.end() :].lstrip()
    if not payload or payload[0] not in "[{":
        return None
    try:
        parsed, _end = json.JSONDecoder().raw_decode(payload)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return parsed


def _iter_metadata_payloads(value: Any):
    """Yield direct, decoded, and labeled JSON payloads from one field."""
    yield value
    decoded = _metadata_json_value(value)
    if decoded is not value:
        yield decoded
    for label in _CIVITAI_JSON_LABELS:
        labeled = _extract_labeled_json(value, label)
        if labeled is not None:
            yield labeled


def _safe_metadata_value(value: Any, *, tag_name: str = "") -> Any:
    value = _decode_metadata_value(value, tag_name=tag_name)
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
        str(key): _safe_metadata_value(value, tag_name=str(key))
        for key, value in (image.info or {}).items()
    }

    try:
        from PIL import ExifTags

        tags = ExifTags.TAGS
        exif = image.getexif()

        def add_exif_fields(fields):
            for tag_id, value in fields.items():
                tag_name = tags.get(tag_id, str(tag_id))
                metadata.setdefault(
                    f"EXIF:{tag_name}",
                    _safe_metadata_value(value, tag_name=tag_name),
                )

        add_exif_fields(exif)
        try:
            exif_ifd = exif.get_ifd(
                getattr(getattr(ExifTags, "IFD", None), "Exif", EXIF_IFD_TAG)
            )
            add_exif_fields(exif_ifd)
        except Exception:
            # Some Pillow versions cannot traverse malformed nested IFDs.
            pass
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
        for candidate in _iter_metadata_payloads(value):
            try:
                normalized, workflow_format = normalize_workflow_payload(candidate)
            except ValueError:
                continue
            return normalized, workflow_format, key
    return None, None, ""


def _coerce_number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_identifier(value: Any) -> Any:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return str(value).strip() or None


def _first_mapping_value(mapping: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value is not None and value != "":
            return value
    return None


def _normalize_civitai_resource(value: Any, index: int) -> Optional[dict[str, Any]]:
    if not isinstance(value, Mapping):
        return None

    resource_type = str(
        _first_mapping_value(value, ("type", "model_type", "modelType")) or ""
    ).strip()
    category_key = normalize_category_token(resource_type)
    category = CATEGORY_MAP.get(category_key, category_key or "unknown")
    model_version_id = _coerce_identifier(
        _first_mapping_value(
            value,
            ("modelVersionId", "model_version_id", "versionId", "version_id"),
        )
    )
    model_id = _coerce_identifier(
        _first_mapping_value(value, ("modelId", "model_id"))
    )
    name = str(
        _first_mapping_value(
            value,
            ("modelName", "model_name", "name", "model"),
        )
        or ""
    ).strip()
    version_name = str(
        _first_mapping_value(
            value,
            ("modelVersionName", "model_version_name", "versionName", "version_name"),
        )
        or ""
    ).strip()
    if not name:
        name = version_name
    if not name and model_version_id is not None:
        name = f"Civitai model {model_version_id}"
    if not name:
        return None

    strength = _coerce_number(
        _first_mapping_value(value, ("strength", "weight", "intensity"))
    )
    return {
        "name": name,
        "version_name": version_name,
        "category": category,
        "type": resource_type,
        "strength": strength,
        "model_id": model_id,
        "model_version_id": model_version_id,
        "source": "civitai_metadata",
        "active": strength is None or strength != 0,
        "connected": True,
        "resource_index": index,
    }


def _merge_civitai_resources(values: list[Any]) -> list[dict[str, Any]]:
    result = []
    by_identity = {}
    for index, value in enumerate(values):
        resource = _normalize_civitai_resource(value, index)
        if not resource:
            continue
        identity = (
            resource["model_version_id"]
            if resource["model_version_id"] is not None
            else f"{resource['category']}:{resource['name'].lower()}"
        )
        existing = by_identity.get(identity)
        if existing is None:
            by_identity[identity] = resource
            result.append(resource)
            continue
        for key, candidate in resource.items():
            if existing.get(key) in (None, "") and candidate not in (None, ""):
                existing[key] = candidate
    return result


def _extract_civitai_metadata(
    metadata: Mapping[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Extract Civitai's labeled generation metadata from EXIF text."""
    civitai_metadata: dict[str, Any] = {}
    resource_values = []

    for key, value in metadata.items():
        key_token = re.sub(r"[^a-z0-9]+", "", str(key).lower())
        decoded = _metadata_json_value(value)
        if key_token == "civitaimetadata" and isinstance(
            decoded, Mapping
        ):
            civitai_metadata.update(decoded)
        if "civitairesource" in key_token and isinstance(decoded, list):
            resource_values.extend(decoded)

        labeled_metadata = _extract_labeled_json(value, "Civitai metadata")
        if isinstance(labeled_metadata, Mapping):
            civitai_metadata.update(labeled_metadata)
        labeled_resources = _extract_labeled_json(value, "Civitai resources")
        if isinstance(labeled_resources, list):
            resource_values.extend(labeled_resources)

    nested_resources = civitai_metadata.get("resources")
    if isinstance(nested_resources, list):
        resource_values.extend(nested_resources)

    return civitai_metadata, _merge_civitai_resources(resource_values)


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
    if parameters is None:
        parameters = next(
            (
                value
                for key, value in metadata.items()
                if str(key).strip().lower().endswith("usercomment")
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
            civitai_metadata, civitai_resources = _extract_civitai_metadata(metadata)
            if civitai_metadata:
                metadata.setdefault(
                    "Civitai metadata",
                    json.dumps(civitai_metadata, ensure_ascii=False),
                )
            if civitai_resources:
                metadata.setdefault(
                    "Civitai resources",
                    json.dumps(civitai_resources, ensure_ascii=False),
                )
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
                "civitai_metadata": civitai_metadata,
                "civitai_resources": civitai_resources,
                "civitai_workflow": (
                    str(civitai_metadata.get("workflow", ""))
                    if isinstance(civitai_metadata.get("workflow"), str)
                    else ""
                ),
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
        "civitai_metadata": {},
        "civitai_resources": [],
        "civitai_workflow": "",
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

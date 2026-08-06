"""Metadata normalization and sidecar payload helpers for downloads."""

import os
import time
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from ..log_system import create_module_logger
from ..network_utils import host_matches_domain
from ..path_utils import (
    MODEL_RESOLVER_METADATA_SCHEMA,
    MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
    find_metadata_sidecar_path,
    get_filename_from_path,
    normalize_metadata_file_path,
    read_merged_model_metadata,
)
from ..resolver import normalize_sha256
from ..settings import normalize_download_category
from ..type_utils import (
    as_dict,
    as_list,
    first_non_empty,
    normalize_category_to_model_type,
)
from .dependencies import require_download_dependencies
from .validation import _is_sensitive_metadata_key, _strip_sensitive_url_params

log = create_module_logger("core.downloader")

_as_dict = as_dict
_as_list = as_list
_first_present = first_non_empty


def write_model_resolver_metadata(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    source_url: str = "",
    create_preview: bool = False,
    *,
    dependencies: Any = None,
) -> Optional[str]:
    """Write metadata only to the sidecar owned by Model Resolver."""
    facade = require_download_dependencies(dependencies, "metadata sidecar")
    metadata_path = facade.get_model_resolver_sidecar_path(dest_path)

    try:
        payload = facade.build_model_resolver_metadata(
            dest_path,
            metadata,
            category,
            source_url,
        )
        if create_preview:
            preview_source = {
                **payload,
                **(metadata if isinstance(metadata, dict) else {}),
            }
            preview_path = facade.create_model_preview(dest_path, preview_source)
            if preview_path:
                payload["preview_url"] = facade.normalize_metadata_file_path(
                    preview_path
                )
        facade.write_json_atomic(metadata_path, payload, indent=2)
        facade.log.info(f"Metadata saved: {metadata_path}")
        return metadata_path
    except Exception as e:
        facade.log.warning(f"Could not save metadata sidecar for {dest_path}: {e}")
        return None


def _json_safe_metadata(value: Any, depth: int = 0) -> Any:
    if depth > 10:
        return str(value)

    if isinstance(value, dict):
        cleaned = {}
        for key, item_value in value.items():
            if _is_sensitive_metadata_key(key):
                continue
            cleaned[str(key)] = _json_safe_metadata(item_value, depth + 1)
        return cleaned

    if isinstance(value, (list, tuple, set)):
        return [_json_safe_metadata(item, depth + 1) for item in value]

    if isinstance(value, str):
        return _strip_sensitive_url_params(value)

    if value is None or isinstance(value, (bool, int, float)):
        return value

    return str(value)


def _coerce_int_or_value(value: Any) -> Any:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _coerce_size(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _resolve_lora_manager_model_type(category: str, source_type: Any = "") -> str:
    result = normalize_category_to_model_type(category)
    if result in ("checkpoint", "diffusion_model", "embedding"):
        return result

    source_token = (
        str(source_type or "")
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
    )
    if "checkpoint" in source_token:
        return "checkpoint"
    if "diffusion" in source_token or source_token == "unet":
        return "diffusion_model"
    if "textual" in source_token or "embedding" in source_token:
        return "embedding"
    return ""


def _metadata_source_value(source_name: str, existing: Any = None) -> Optional[str]:
    if existing:
        return str(existing)

    source_token = str(source_name or "").strip().lower()
    if source_token == "civitai":
        return "civitai_api"
    if source_token == "civarchive":
        return "civarchive"
    if source_token == "lora_manager_archive":
        return "archive_db"
    return None


def _find_metadata_file_info(
    source: Dict[str, Any],
    selected_version: Dict[str, Any],
    filename: str,
) -> Dict[str, Any]:
    # A selected file is the most specific provenance available.  It must be
    # checked before the source-level hash because the latter can still belong
    # to the workflow's original model after the user chooses another variant.
    for key in ("selected_file", "selectedFile", "file_info", "file"):
        value = source.get(key)
        if isinstance(value, dict):
            return value

    filename_lower = get_filename_from_path(str(filename or "")).lower()
    file_lists = [
        source.get("files"),
        selected_version.get("files"),
    ]
    for file_list in file_lists:
        if not isinstance(file_list, list):
            continue
        first_file = None
        for file_info in file_list:
            if not isinstance(file_info, dict):
                continue
            if first_file is None:
                first_file = file_info
            candidate = str(
                file_info.get("name")
                or file_info.get("filename")
                or file_info.get("fileName")
                or ""
            ).lower()
            if filename_lower and candidate == filename_lower:
                return file_info
        if first_file:
            return first_file
    return {}


def _extract_expected_sha256(metadata: Optional[Dict[str, Any]]) -> str:
    source = metadata if isinstance(metadata, dict) else {}
    details = _as_dict(source.get("civitai_details") or source.get("details"))
    selected_version = _as_dict(
        source.get("selected_version") or details.get("selected_version")
    )
    path_metadata = _as_dict(source.get("path_metadata"))
    filename = _first_present(
        source.get("filename"),
        path_metadata.get("filename"),
    )
    file_info = _find_metadata_file_info(source, selected_version, str(filename))
    file_hashes = _as_dict(file_info.get("hashes"))
    file_sha256 = normalize_sha256(
        _first_present(
            file_info.get("sha256"),
            file_info.get("hash"),
            file_hashes.get("SHA256"),
            file_hashes.get("sha256"),
        )
    )
    if file_info:
        # An explicit file entry without a hash means this provider did not
        # declare a checksum for the selected URL.  Do not fall back to a
        # stale source/workflow hash and reject a user-selected download.
        return file_sha256

    # Keep the source-level fallback for providers that expose one hash but no
    # file object.
    hashes = _as_dict(source.get("hashes"))
    return normalize_sha256(
        _first_present(
            source.get("sha256"),
            source.get("hash"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
        )
    )


def read_completed_metadata_sha256(file_path: str) -> str:
    """Read a trusted SHA256 from merged local metadata when available."""
    metadata_path = find_metadata_sidecar_path(file_path)
    payload = read_merged_model_metadata(file_path, {})
    if not isinstance(payload, dict) or not payload:
        return ""

    hash_status = str(payload.get("hash_status") or "completed").strip().lower()
    if hash_status != "completed":
        log.debug(
            f"Skipping metadata SHA256 for {metadata_path}: hash_status={hash_status}"
        )
        return ""

    return normalize_sha256(payload.get("sha256") or payload.get("hash"))


def build_model_resolver_metadata(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    source_url: str = "",
) -> Dict[str, Any]:
    """Build the LoRA Manager-shaped payload stored in our own sidecar."""
    source = _json_safe_metadata(metadata or {})
    if not isinstance(source, dict):
        source = {}

    path_metadata = _as_dict(source.get("path_metadata"))
    details = _as_dict(source.get("civitai_details") or source.get("details"))
    selected_version = _as_dict(
        source.get("selected_version") or details.get("selected_version")
    )

    basename = get_filename_from_path(dest_path)
    file_name = os.path.splitext(basename)[0]
    filename = _first_present(
        source.get("filename"),
        path_metadata.get("filename"),
        basename,
    )
    model_name = _first_present(
        source.get("model_name"),
        source.get("model"),
        source.get("name"),
        details.get("name"),
        path_metadata.get("model_name"),
        path_metadata.get("name"),
        os.path.splitext(str(filename))[0],
        file_name,
    )
    version_name = _first_present(
        source.get("version_name"),
        source.get("versionName"),
        source.get("version"),
        selected_version.get("name"),
        path_metadata.get("version_name"),
    )
    base_model = _first_present(
        source.get("base_model"),
        source.get("baseModel"),
        selected_version.get("base_model"),
        selected_version.get("baseModel"),
        path_metadata.get("base_model"),
        "Unknown",
    )
    source_name = str(
        _first_present(source.get("details_source"), source.get("source"), details.get("source"))
        or ""
    ).lower()

    model_id = _first_present(
        source.get("model_id"),
        source.get("modelId"),
        details.get("model_id"),
        path_metadata.get("model_id"),
    )
    version_id = _first_present(
        source.get("version_id"),
        source.get("versionId"),
        details.get("version_id"),
        selected_version.get("id"),
        path_metadata.get("version_id"),
    )

    tags = _as_list(
        _first_present(
            source.get("tags"),
            details.get("tags"),
            path_metadata.get("tags"),
        )
    )
    trained_words = _as_list(
        _first_present(
            source.get("trained_words"),
            source.get("trainedWords"),
            selected_version.get("trained_words"),
            selected_version.get("trainedWords"),
        )
    )
    images = _as_list(
        _first_present(
            source.get("images"),
            selected_version.get("images"),
            details.get("images"),
        )
    )
    creator = _as_dict(
        _first_present(source.get("creator"), details.get("creator"), path_metadata.get("creator"))
    )
    file_info = _find_metadata_file_info(source, selected_version, str(filename))
    hashes = _as_dict(file_info.get("hashes") if file_info else source.get("hashes"))
    hash_values = (
        (
            file_info.get("sha256"),
            file_info.get("hash"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
        )
        if file_info
        else (
            source.get("sha256"),
            source.get("hash"),
            hashes.get("SHA256"),
            hashes.get("sha256"),
        )
    )
    sha256 = str(_first_present(*hash_values) or "").lower()
    direct_url = _first_present(
        source.get("download_url"),
        source.get("downloadUrl"),
        source.get("source_url"),
        source_url,
        source.get("url"),
    )
    source_page_url = _first_present(
        source.get("version_url"),
        source.get("model_url"),
        source.get("page_url"),
        source.get("source_url"),
        source.get("url"),
        source.get("platform_url"),
        source_url,
    )
    if source_name == "civarchive":
        civarchive_page_url = next(
            (
                str(value).strip()
                for value in (
                    source.get("version_url"),
                    source.get("model_url"),
                    source.get("page_url"),
                    source.get("source_url"),
                    source.get("url"),
                )
                if value
                and host_matches_domain(urlparse(str(value)).hostname, "civarchive.com")
            ),
            "",
        )
        if not civarchive_page_url and model_id:
            civarchive_page_url = f"https://civarchive.com/models/{model_id}"
            if version_id:
                civarchive_page_url += f"?modelVersionId={version_id}"
        if not civarchive_page_url and sha256:
            civarchive_page_url = f"https://civarchive.com/sha256/{sha256}"
        source_page_url = civarchive_page_url
    platform_url = _first_present(source.get("platform_url"), source.get("platformUrl"))
    preview_url = _first_present(
        source.get("preview_url"),
        source.get("previewUrl"),
        source.get("preview"),
        source.get("thumbnail_url"),
        source.get("thumbnailUrl"),
    )
    explicit_model_description = _first_present(
        source.get("modelDescription"),
        source.get("model_description"),
        details.get("description"),
        _as_dict(source.get("model")).get("description"),
    )
    model_description = _first_present(
        explicit_model_description,
        source.get("description"),
    )
    version_description = _first_present(
        source.get("versionDescription"),
        source.get("version_description"),
        selected_version.get("description"),
        (
            source.get("description")
            if explicit_model_description
            and source.get("description") != explicit_model_description
            else None
        ),
    )

    is_civitai_source = source_name in {
        "civitai",
        "civarchive",
        "lora_manager_archive",
    } or (
        not source_name
        and bool(source.get("civitai") or source.get("civitai_details"))
    )
    civitai_payload = (
        dict(
            _as_dict(
                _first_present(
                    source.get("civitai"),
                    details.get("civitai"),
                )
            )
        )
        if is_civitai_source
        else {}
    )
    if is_civitai_source:
        if model_id and "modelId" not in civitai_payload:
            civitai_payload["modelId"] = _coerce_int_or_value(model_id)
        if version_id and "id" not in civitai_payload:
            civitai_payload["id"] = _coerce_int_or_value(version_id)
        if version_name and "name" not in civitai_payload:
            civitai_payload["name"] = str(version_name)
        if base_model and "baseModel" not in civitai_payload:
            civitai_payload["baseModel"] = str(base_model)
        if trained_words and "trainedWords" not in civitai_payload:
            civitai_payload["trainedWords"] = trained_words
        if images and "images" not in civitai_payload:
            civitai_payload["images"] = images
        if direct_url and "downloadUrl" not in civitai_payload:
            civitai_payload["downloadUrl"] = _strip_sensitive_url_params(str(direct_url))
        if version_description and "description" not in civitai_payload:
            civitai_payload["description"] = str(version_description)

    files = _as_list(_first_present(selected_version.get("files"), source.get("files")))
    if is_civitai_source and files and "files" not in civitai_payload:
        civitai_payload["files"] = files

    model_payload = dict(_as_dict(civitai_payload.get("model")))
    if model_name and "name" not in model_payload:
        model_payload["name"] = str(model_name)
    model_type = _first_present(source.get("type"), source.get("model_type"), details.get("type"))
    if model_type and "type" not in model_payload:
        model_payload["type"] = str(model_type)
    if model_description and "description" not in model_payload:
        model_payload["description"] = str(model_description)
    if tags and "tags" not in model_payload:
        model_payload["tags"] = tags
    if is_civitai_source and model_payload:
        civitai_payload["model"] = model_payload
    if is_civitai_source and creator and "creator" not in civitai_payload:
        civitai_payload["creator"] = creator

    metadata_source = _metadata_source_value(source_name, source.get("metadata_source"))
    if os.path.exists(dest_path):
        size = os.path.getsize(dest_path)
    else:
        size = _coerce_size(_first_present(source.get("size"), file_info.get("size")))

    payload: Dict[str, Any] = {
        "schema": MODEL_RESOLVER_METADATA_SCHEMA,
        "schema_version": MODEL_RESOLVER_METADATA_SCHEMA_VERSION,
        "managed_by": MODEL_RESOLVER_METADATA_SCHEMA,
        "file_name": file_name,
        "filename": basename,
        "model_name": str(model_name or file_name),
        "file_path": normalize_metadata_file_path(dest_path),
        "size": size,
        "modified": time.time(),
        "sha256": sha256,
        "base_model": str(base_model or "Unknown"),
        "preview_url": str(preview_url or ""),
        "preview_nsfw_level": 0,
        "from_civitai": bool(
            is_civitai_source
            and (metadata_source or model_id or version_id or civitai_payload)
        ),
        "civitai": civitai_payload,
        "tags": tags,
        "modelDescription": str(model_description or ""),
        "version_description": str(version_description or ""),
        "civitai_deleted": bool(source.get("is_deleted") or source.get("civitai_deleted")),
        "source": source_name,
        "details_source": source_name,
        "source_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "model_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "version_url": _strip_sensitive_url_params(str(source_page_url or "")),
        "download_url": _strip_sensitive_url_params(str(direct_url or "")),
        "platform_url": _strip_sensitive_url_params(str(platform_url or "")),
        "metadata_source": metadata_source,
        "last_checked_at": time.time(),
        "hash_status": "completed" if sha256 else "pending",
    }

    lora_manager_type = _resolve_lora_manager_model_type(category, model_type)
    if normalize_download_category(category) == "loras":
        payload["usage_tips"] = str(source.get("usage_tips") or "{}")
    elif lora_manager_type:
        payload["model_type"] = lora_manager_type
        payload["sub_type"] = lora_manager_type

    return payload

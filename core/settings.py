"""Shared settings helpers for Model Resolver."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, Optional
from .path_utils import write_json_atomic, read_json_safe


SETTINGS_FILE = Path(__file__).resolve().parents[1] / "model_resolver_settings.json"

from .type_utils import to_bool, CATEGORY_MAP, normalize_download_category

DOWNLOAD_PATH_MODES = {"suggested", "template", "manual"}
DOWNLOAD_BACKENDS = {"python", "aria2"}

DEFAULT_DOWNLOAD_PATH_TEMPLATES: Dict[str, str] = {
    "loras": "{base_model}/{first_tag}",
    "checkpoints": "{base_model}",
    "embeddings": "{base_model}",
    "diffusion_models": "{base_model}",
    "text_encoders": "",
    "controlnet": "{base_model}",
    "vae": "",
    "upscale_models": "",
    "sams": "",
    "ultralytics": "",
}

DEFAULT_ROOT_KEYS = {
    "loras": "default_lora_root",
    "checkpoints": "default_checkpoint_root",
    "diffusion_models": "default_unet_root",
    "embeddings": "default_embedding_root",
    "text_encoders": "default_text_encoder_root",
    "vae": "default_vae_root",
    "upscale_models": "default_upscale_model_root",
}

TEMPLATE_KEY_ALIASES = {
    "loras": ("loras", "lora"),
    "checkpoints": ("checkpoints", "checkpoint"),
    "embeddings": ("embeddings", "embedding"),
    "diffusion_models": ("diffusion_models", "diffusion_model", "unet"),
    "text_encoders": ("text_encoders", "text_encoder", "clip", "clips", "clip_gguf"),
    "controlnet": ("controlnet", "control_net"),
    "vae": ("vae",),
    "upscale_models": ("upscale_models", "upscale_model", "upscaler"),
    "sams": ("sams", "sam", "sam_model", "sam_models"),
    "ultralytics": ("ultralytics", "ultralytics_bbox", "ultralytics_segm", "yolo"),
}

PRIORITY_TAGS = (
    "concept",
    "style",
    "character",
    "clothing",
    "pose",
    "object",
    "vehicle",
    "artist",
    "celebrity",
)

_INVALID_SEGMENT_CHARS_RE = re.compile(r'[<>:"|?*\x00-\x1f]+')
_UNKNOWN_PLACEHOLDER_RE = re.compile(r"\{[^{}]+\}")


def bool_setting(value: Any, default: bool = True) -> bool:
    return to_bool(value, default)


def sanitize_folder_name(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    if not text:
        text = fallback
    text = text.replace("/", "_").replace("\\", "_")
    text = _INVALID_SEGMENT_CHARS_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if text in {"", ".", ".."}:
        text = fallback
    return text.strip(" .")


def normalize_relative_subfolder(path_value: Any) -> str:
    text = str(path_value or "").replace("\\", "/").strip()
    if not text:
        return ""
    parts = []
    for raw_part in text.split("/"):
        part = sanitize_folder_name(raw_part)
        if part and part not in {".", ".."}:
            parts.append(part)
    return "/".join(parts)


def normalize_download_path_template(template: Any) -> str:
    text = str(template or "").replace("\\", "/").strip()
    if not text:
        return ""
    parts = []
    for raw_part in text.split("/"):
        part = raw_part.strip()
        if not part or part in {".", ".."}:
            continue
        parts.append(part)
    return "/".join(parts)


def _read_settings_file() -> Dict[str, Any]:
    data = read_json_safe(str(SETTINGS_FILE), {})
    return data if isinstance(data, dict) else {}


def _coerce_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return dict(parsed)
    return {}


def normalize_download_path_templates(value: Any) -> Dict[str, str]:
    raw_templates = _coerce_dict(value)
    normalized = dict(DEFAULT_DOWNLOAD_PATH_TEMPLATES)
    for raw_key, raw_template in raw_templates.items():
        key = normalize_download_category(str(raw_key))
        normalized[key] = normalize_download_path_template(raw_template)
    return normalized


def normalize_base_model_path_mappings(value: Any) -> Dict[str, str]:
    raw_mappings = _coerce_dict(value)
    mappings: Dict[str, str] = {}
    for raw_key, raw_value in raw_mappings.items():
        key = str(raw_key or "").strip()
        value = str(raw_value or "").strip()
        if key and value:
            mappings[key] = value
    return mappings


def normalize_download_path_mode(value: Any, auto_fill_subfolder: Any = None) -> str:
    mode = str(value or "").strip().lower()
    if mode in DOWNLOAD_PATH_MODES:
        return mode
    if auto_fill_subfolder is False:
        return "manual"
    return "suggested"


def normalize_download_backend(value: Any) -> str:
    backend = str(value or "").strip().lower()
    return backend if backend in DOWNLOAD_BACKENDS else "python"


def normalize_settings(settings: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    data = dict(settings or {})
    data["download_backend"] = normalize_download_backend(data.get("download_backend"))
    data["aria2c_path"] = str(data.get("aria2c_path") or "").strip()
    data["auto_refresh_comfy_models_after_apply"] = bool_setting(
        data.get("auto_refresh_comfy_models_after_apply"), True
    )
    data["download_path_mode"] = normalize_download_path_mode(
        data.get("download_path_mode"), data.get("auto_fill_subfolder")
    )
    data["download_path_templates"] = normalize_download_path_templates(
        data.get("download_path_templates")
    )
    data["base_model_path_mappings"] = normalize_base_model_path_mappings(
        data.get("base_model_path_mappings")
    )
    for key in DEFAULT_ROOT_KEYS.values():
        data[key] = str(data.get(key) or "").strip()
    return data


def load_settings() -> Dict[str, Any]:
    return normalize_settings(_read_settings_file())


def save_settings(payload: Mapping[str, Any]) -> Dict[str, Any]:
    current = _read_settings_file()
    current.update({str(key): value for key, value in payload.items() if key})
    normalized = normalize_settings(current)
    write_json_atomic(str(SETTINGS_FILE), normalized, indent=2)
    return normalized


def _template_for_category(settings: Mapping[str, Any], category: str) -> str:
    templates = normalize_download_path_templates(settings.get("download_path_templates"))
    category_key = normalize_download_category(category)
    aliases = TEMPLATE_KEY_ALIASES.get(category_key, (category_key,))
    for alias in aliases:
        if alias in templates:
            return templates.get(alias, "")
    return templates.get(category_key, "")


def _listify_tags(value: Any) -> Iterable[str]:
    if isinstance(value, (list, tuple, set)):
        for item in value:
            text = str(item or "").strip()
            if text:
                yield text
        return
    if isinstance(value, str):
        for item in re.split(r"[,;]+", value):
            text = item.strip()
            if text:
                yield text


def _normalize_tag(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _resolve_base_model_mapping(mappings: Mapping[str, str], base_model: Any) -> str:
    base_text = str(base_model or "")
    if base_text in mappings:
        return mappings[base_text]

    base_token = _normalize_tag(base_text)
    if not base_token:
        return base_text

    normalized_mappings = {
        _normalize_tag(key): value
        for key, value in mappings.items()
        if _normalize_tag(key)
    }
    if base_token in normalized_mappings:
        return normalized_mappings[base_token]

    for key_token, value in sorted(
        normalized_mappings.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    ):
        if len(key_token) < 4:
            continue
        if base_token.startswith(key_token) or key_token in base_token or base_token in key_token:
            return value

    return base_text


def _first_tag(tags: Any) -> str:
    tag_list = list(_listify_tags(tags))
    if not tag_list:
        return "no tags"
    normalized_tags = {tag: _normalize_tag(tag) for tag in tag_list}
    for priority in PRIORITY_TAGS:
        priority_token = _normalize_tag(priority)
        for tag, normalized in normalized_tags.items():
            if normalized == priority_token:
                return tag
    return tag_list[0]


def _creator_name(metadata: Mapping[str, Any]) -> str:
    creator = metadata.get("creator")
    if isinstance(creator, Mapping):
        name = creator.get("username") or creator.get("name")
        if name:
            return str(name)
    if isinstance(creator, str) and creator.strip():
        return creator
    for key in ("author", "username", "creator_username", "creator_name"):
        value = metadata.get(key)
        if value:
            return str(value)
    repo_id = metadata.get("repo_id") or metadata.get("repo")
    if isinstance(repo_id, str) and "/" in repo_id:
        return repo_id.split("/", 1)[0]
    return "Anonymous"


def _filename_stem(metadata: Mapping[str, Any]) -> str:
    filename = str(metadata.get("filename") or metadata.get("file_name") or "").strip()
    if not filename:
        return ""
    return Path(filename).stem


def calculate_template_subfolder(
    category: str,
    metadata: Optional[Mapping[str, Any]] = None,
    settings: Optional[Mapping[str, Any]] = None,
) -> str:
    active_settings = normalize_settings(settings if settings is not None else load_settings())
    template = _template_for_category(active_settings, category)
    if not template:
        return ""

    model_metadata = dict(metadata or {})
    base_model = (
        model_metadata.get("base_model")
        or model_metadata.get("baseModel")
        or model_metadata.get("base_model_context")
        or "Unknown Base Model"
    )
    mappings = normalize_base_model_path_mappings(
        active_settings.get("base_model_path_mappings")
    )
    mapped_base_model = _resolve_base_model_mapping(mappings, base_model)
    model_name = (
        model_metadata.get("model_name")
        or model_metadata.get("name")
        or _filename_stem(model_metadata)
        or "Model"
    )
    version_name = (
        model_metadata.get("version_name")
        or model_metadata.get("versionName")
        or model_metadata.get("version")
        or ""
    )

    replacements = {
        "{base_model}": (
            normalize_relative_subfolder(mapped_base_model)
            or sanitize_folder_name(mapped_base_model, "Unknown Base Model")
        ),
        "{author}": sanitize_folder_name(_creator_name(model_metadata), "Anonymous"),
        "{first_tag}": sanitize_folder_name(
            _first_tag(model_metadata.get("tags")), "no tags"
        ),
        "{model_name}": sanitize_folder_name(model_name, "Model"),
        "{version_name}": sanitize_folder_name(version_name, ""),
    }

    formatted = template
    for token, replacement in replacements.items():
        formatted = formatted.replace(token, replacement)
    formatted = _UNKNOWN_PLACEHOLDER_RE.sub("", formatted)
    return normalize_relative_subfolder(formatted)


def resolve_download_subfolder(
    category: str,
    requested_subfolder: Any = "",
    metadata: Optional[Mapping[str, Any]] = None,
    settings: Optional[Mapping[str, Any]] = None,
) -> str:
    requested = str(requested_subfolder or "").strip()
    if requested:
        return requested

    active_settings = normalize_settings(settings if settings is not None else load_settings())
    if active_settings.get("download_path_mode") != "template":
        return ""

    return calculate_template_subfolder(category, metadata, active_settings)


def get_default_root_for_category(
    category: str,
    settings: Optional[Mapping[str, Any]] = None,
) -> str:
    active_settings = normalize_settings(settings if settings is not None else load_settings())
    key = DEFAULT_ROOT_KEYS.get(normalize_download_category(category))
    if not key:
        return ""
    return str(active_settings.get(key) or "").strip()

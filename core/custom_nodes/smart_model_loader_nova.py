"""Backend adapter for ComfyUI Smart Model Loader Nova ([SML2]) loader nodes.

These nodes keep every model choice inside one JSON "configuration" widget
(a canonical, key-sorted JSON string), for example::

    {"model": {"kind": "unet", "resource": {"name": "...", "sha256": "..."}},
     "clip": {"source": "external", "encoders": [{"id": "...", "resource": {...}}]},
     "vae": {"source": "external", "resource": {...}},
     "loras": {"entries": [{"id": "...", "resource": {...}, "strength": 1}]}, ...}

The CLIP Loader and LoRA Stack variants use the same resource objects under
``clip.encoders`` and ``entries``. Each resource becomes one reference on
widget 0; updates rewrite the matching resource name and keep the string
canonical so the node's own editor reads it back unchanged.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from ..contracts import CustomNodeMetadata, ModelReference, ResolvedModel
from ..log_system import create_module_logger
from ..type_utils import normalize_sha256
from .base import CustomNodeModelAdapter

log = create_module_logger(__name__)

ADAPTER_ID = "smart-model-loader-nova"
NODE_TYPES = (
    "Smart Model Loader [SML2]",
    "CLIP Loader [SML2]",
    "LoRA Stack [SML2]",
)
CONFIG_WIDGET_INDEX = 0

# model.kind -> Smart Model Loader folder role (core/model_loader/configuration.py MODES)
MODEL_KIND_ROLES = {
    "checkpoint": "checkpoints",
    "unet": "diffusion_models",
    "gguf": "diffusion_models_gguf",
    "nunchaku-flux": "diffusion_models",
    "nunchaku-qwen": "diffusion_models",
    "nunchaku-zimage": "diffusion_models",
}
# role -> (resolver category, ComfyUI folder keys searched for the file)
ROLE_FOLDERS = {
    "checkpoints": ("checkpoints", ("checkpoints",)),
    "diffusion_models": ("diffusion_models", ("diffusion_models", "unet")),
    "diffusion_models_gguf": (
        "diffusion_models",
        ("diffusion_models_gguf", "unet_gguf", "diffusion_models", "unet"),
    ),
    "text_encoders": ("text_encoders", ("text_encoders", "clip")),
    "vae": ("vae", ("vae",)),
    "loras": ("loras", ("loras",)),
}
CATEGORY_ALIASES = {
    "unet": "diffusion_models",
    "clip": "text_encoders",
    "diffusion_models_gguf": "diffusion_models",
    "unet_gguf": "diffusion_models",
}


def _load_configuration(value: Any) -> Tuple[Optional[Dict[str, Any]], bool]:
    """Return (configuration, stored_as_string)."""
    if isinstance(value, dict):
        return value, False
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            parsed = json.loads(value)
        except ValueError:
            return None, True
        return (parsed if isinstance(parsed, dict) else None), True
    return None, False


def _dump_configuration(config: Dict[str, Any]) -> str:
    # Same canonical form as the node editor (sorted keys, no whitespace).
    return json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _resource_name(resource: Any) -> str:
    if not isinstance(resource, dict):
        return ""
    name = str(resource.get("name") or "").strip()
    return "" if name == "None" else name


def _iter_resources(config: Dict[str, Any]) -> Iterator[Tuple[Dict[str, Any], str, Dict[str, Any]]]:
    """Yield (resource, role, entry) for every model file the configuration names."""
    model = config.get("model")
    if isinstance(model, dict) and isinstance(model.get("resource"), dict):
        role = MODEL_KIND_ROLES.get(str(model.get("kind") or ""), "diffusion_models")
        yield model["resource"], role, model

    for key in ("vae", "audioVae"):
        section = config.get(key)
        if (
            isinstance(section, dict)
            and section.get("source") == "external"
            and isinstance(section.get("resource"), dict)
        ):
            yield section["resource"], "vae", section

    clip = config.get("clip")
    if isinstance(clip, dict) and clip.get("source") != "baked":
        if isinstance(clip.get("resource"), dict):
            yield clip["resource"], "text_encoders", clip
        for entry in clip.get("encoders") or []:
            if isinstance(entry, dict) and isinstance(entry.get("resource"), dict):
                yield entry["resource"], "text_encoders", entry

    loras = config.get("loras")
    lora_entries = (
        loras.get("entries")
        if isinstance(loras, dict)
        else (loras if isinstance(loras, list) else config.get("entries"))
    )
    for entry in lora_entries or []:
        if isinstance(entry, dict) and isinstance(entry.get("resource"), dict):
            yield entry["resource"], "loras", entry


def _find_full_path(
    role: str,
    name: str,
    available_models: Optional[List[ResolvedModel]] = None,
) -> Optional[str]:
    try:
        import folder_paths
    except ImportError:
        folder_paths = None

    if folder_paths is not None:
        for folder in ROLE_FOLDERS.get(role, ("", ()))[1]:
            try:
                full_path = folder_paths.get_full_path(folder, name)
            except Exception:
                full_path = None
            if full_path and os.path.exists(full_path):
                return full_path

    if available_models:
        category = ROLE_FOLDERS.get(role, ("diffusion_models", ()))[0]
        norm_name = name.replace("\\", "/").lower()
        for model in available_models:
            if model.category == category:
                model_rel = (model.relative_path or "").replace("\\", "/").lower()
                model_fn = (model.filename or "").replace("\\", "/").lower()
                if norm_name in (model_rel, model_fn):
                    return model.path

    return None


def analyze_references(
    node: Dict[str, Any],
    available_models: Optional[List[ResolvedModel]] = None,
    *,
    is_active: bool,
    get_widget_name_hint: Callable[[Dict[str, Any], int], str],
) -> Optional[List[ModelReference]]:
    """Extract every model file named inside the configuration widget."""
    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or not widgets_values:
        return None
    config, _ = _load_configuration(widgets_values[CONFIG_WIDGET_INDEX])
    if config is None:
        return None

    node_title = str(node.get("title", "") or "").strip()
    references: List[ModelReference] = []
    for resource, role, entry in _iter_resources(config):
        name = _resource_name(resource)
        if not name:
            continue
        category, folder_keys = ROLE_FOLDERS.get(role, ("diffusion_models", ()))
        full_path = _find_full_path(role, name, available_models=available_models)
        reference = {
            "node_id": node.get("id"),
            "node_type": node.get("type", ""),
            "widget_index": CONFIG_WIDGET_INDEX,
            "widget_name": get_widget_name_hint(node, CONFIG_WIDGET_INDEX),
            "original_path": name,
            "name": name,
            "node_title": node_title,
            "category": category,
            "category_hints": [category],
            "folder_key_hints": list(folder_keys),
            "full_path": full_path,
            "exists": bool(full_path),
            "is_urn": False,
            "custom_node_adapter": ADAPTER_ID,
            "custom_node_original_identity": name,
            "sml2_role": role,
            "connected": bool(is_active),
        }
        sha256 = normalize_sha256(resource.get("sha256"))
        if sha256:
            # Lets the resolver find the same file by hash under any name or folder.
            reference["workflow_sha256"] = sha256
            reference["hash_lookup_source"] = "sml2_configuration"
        if role == "loras":
            try:
                reference["strength"] = float(entry.get("strength", 1.0))
            except (TypeError, ValueError):
                reference["strength"] = 1.0
            reference["active"] = entry.get("enabled", entry.get("active", True)) is not False
        references.append(ModelReference.from_mapping(reference))
    return references


def has_potential_reference(node: Dict[str, Any]) -> bool:
    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or not widgets_values:
        return False
    config, _ = _load_configuration(widgets_values[CONFIG_WIDGET_INDEX])
    if config is None:
        return False
    return any(_resource_name(resource) for resource, _, _ in _iter_resources(config))


def _category_matches(role: str, resolved_category: str) -> bool:
    if not resolved_category:
        return True
    wanted = CATEGORY_ALIASES.get(resolved_category, resolved_category)
    return ROLE_FOLDERS.get(role, ("",))[0] == wanted


def update_model_path(
    node: Dict[str, Any],
    widget_index: int,
    resolved_model: Optional[ResolvedModel],
    metadata: CustomNodeMetadata,
) -> Optional[bool]:
    """Point the matching resource at the resolved file, keeping the JSON canonical."""
    if metadata.adapter_id != ADAPTER_ID or widget_index != CONFIG_WIDGET_INDEX:
        return None
    original_name = str(metadata.original_identity or "").strip()
    if not original_name or resolved_model is None:
        return False
    new_name = resolved_model.relative_path or resolved_model.filename
    if not new_name:
        return False

    widgets_values = node.get("widgets_values")
    if not isinstance(widgets_values, list) or not widgets_values:
        return False
    config, stored_as_string = _load_configuration(widgets_values[CONFIG_WIDGET_INDEX])
    if config is None:
        log.warning("Smart Model Loader Nova configuration could not be parsed")
        return False

    resolved_sha = normalize_sha256((resolved_model.extra or {}).get("sha256"))
    updated = 0
    for resource, role, _ in _iter_resources(config):
        current = _resource_name(resource)
        if current.replace("\\", "/").lower() != original_name.replace("\\", "/").lower():
            continue
        if not _category_matches(role, resolved_model.category):
            continue
        resource["name"] = new_name
        if resolved_sha:
            resource["sha256"] = resolved_sha
        else:
            # A different file may have been chosen; a stale hash would fail integrity checks.
            resource.pop("sha256", None)
        updated += 1

    if not updated:
        log.warning(f"'{original_name}' was not found in the Smart Model Loader Nova configuration")
        return False

    widgets_values[CONFIG_WIDGET_INDEX] = (
        _dump_configuration(config) if stored_as_string else config
    )
    log.info(f"Updated Smart Model Loader Nova model: {original_name} -> {new_name}")
    return True


def should_skip_existing(reference: ModelReference) -> bool:
    return reference.exists is True


def adapt_loaded_model(
    reference: ModelReference,
    model_name: str,
    strength: Any,
) -> Tuple[str, Any]:
    return (
        reference.extra_value("name", model_name),
        reference.extra_value("strength", strength),
    )


ADAPTER = CustomNodeModelAdapter(
    adapter_id=ADAPTER_ID,
    node_types=NODE_TYPES,
    analyze_references=analyze_references,
    has_potential_reference=has_potential_reference,
    update_model_path=update_model_path,
    should_skip_existing=should_skip_existing,
    adapt_loaded_model=adapt_loaded_model,
)

"""
Workflow Analyzer Module

Extracts model references from workflow JSON and identifies missing models.
"""

import os
import re
import threading
from typing import List, Dict, Any, Optional, Set

from .log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)

# Import folder_paths lazily - it may not be available until ComfyUI is initialized
try:
    import folder_paths
except ImportError:
    folder_paths = None
    log_warn("Model Resolver: folder_paths not available yet - will retry later")


# Common model file extensions
MODEL_EXTENSIONS = {
    ".ckpt",
    ".pt",
    ".pt2",
    ".bin",
    ".pth",
    ".safetensors",
    ".pkl",
    ".sft",
    ".onnx",
    ".gguf",
}

# URN Type to ComfyUI category mapping
URN_TYPE_MAP = {
    "checkpoint": "checkpoints",
    "lora": "loras",
    "vae": "vae",
    "upscaler": "upscale_models",
    "upscale_model": "upscale_models",
    "latent_upscale_model": "latent_upscale_models",
    "embedding": "embeddings",
    "hypernetwork": "hypernetworks",
    "controlnet": "controlnet",
    "clip": "text_encoders",
    "clip_vision": "clip_vision",
    "diffusers": "diffusers",
}

URN_REGEX = re.compile(r"^urn:air:([^:]+):([^:]+):([^:]+):(\d+)@(\d+)$")

# Mapping of common node types to their expected model category
# This is used as hints but we don't rely solely on this
# UNETLoader uses 'diffusion_models' category (folder_paths maps 'unet' to 'diffusion_models')
NODE_TYPE_TO_CATEGORY_HINTS = {
    "CheckpointLoaderSimple": "checkpoints",
    "CheckpointLoader": "checkpoints",
    "DiffusersLoader": "diffusers",
    "unCLIPCheckpointLoader": "checkpoints",
    "ImageOnlyCheckpointLoader": "checkpoints",
    "VAELoader": "vae",
    "VAELoaderKJ": "vae",
    "LoraLoader": "loras",
    "LoraLoaderModelOnly": "loras",
    "LoraLoaderBypass": "loras",
    "LoraLoaderBypassModelOnly": "loras",
    "LoraLoaderV2": "loras",
    "Lora Loader (LoraManager)": "loras",  # LoraManager custom node
    "Lora Stacker (LoraManager)": "loras",  # LoraManager Stacker node
    "Power Lora Loader (rgthree)": "loras",  # rgthree's Power Lora Loader
    "CreateHookLora": "loras",
    "CreateHookLoraModelOnly": "loras",
    "CreateHookModelAsLora": "checkpoints",
    "CreateHookModelAsLoraModelOnly": "checkpoints",
    "UNETLoader": "diffusion_models",
    "LoaderGGUF": "diffusion_models",
    "LoaderGGUFAdvanced": "diffusion_models",
    "UnetLoaderGGUF": "diffusion_models",
    "UnetLoaderGGUFAdvanced": "diffusion_models",
    "LatentUpscaleModelLoader": "latent_upscale_models",
    "CLIPLoader": "text_encoders",
    "DualCLIPLoader": "text_encoders",
    "CLIPLoaderGGUF": "text_encoders",
    "ClipLoaderGGUF": "text_encoders",
    "DualCLIPLoaderGGUF": "text_encoders",
    "DualClipLoaderGGUF": "text_encoders",
    "TripleCLIPLoader": "text_encoders",
    "TripleClipLoader": "text_encoders",
    "TripleCLIPLoaderGGUF": "text_encoders",
    "TripleClipLoaderGGUF": "text_encoders",
    "QuadrupleCLIPLoader": "text_encoders",
    "QuadrupleClipLoader": "text_encoders",
    "QuadrupleCLIPLoaderGGUF": "text_encoders",
    "QuadrupleClipLoaderGGUF": "text_encoders",
    "ControlNetLoader": "controlnet",
    "DiffControlNetLoader": "controlnet",
    "ControlNetLoaderAdvanced": "controlnet",
    "ACN_ControlNetLoaderAdvanced": "controlnet",
    "ACN_DiffControlNetLoaderAdvanced": "controlnet",
    "CLIPVisionLoader": "clip_vision",
    "StyleModelLoader": "style_models",
    "GLIGENLoader": "gligen",
    "UpscaleModelLoader": "upscale_models",
    "SAMLoader": "sams",
    "UltralyticsDetectorProvider": "ultralytics",
    "AudioEncoderLoader": "audio_encoders",
    "LoadBackgroundRemovalModel": "background_removal",
    "LoadDA3Model": "geometry_estimation",
    "FrameInterpolationModelLoader": "frame_interpolation",
    "LoadMediaPipeFaceLandmarker": "detection",
    "ModelPatchLoader": "model_patches",
    "LoadMoGeModel": "geometry_estimation",
    "PhotoMakerLoader": "photomaker",
    "OpticalFlowLoader": "optical_flow",
    "HypernetworkLoader": "hypernetworks",
    "EmbeddingLoader": "embeddings",
    # LTX-Video nodes
    "LTXVAudioVAELoader": "checkpoints",
    "LowVRAMAudioVAELoader": "checkpoints",
    "LTXVGemmaCLIPModelLoader": "text_encoders",
    "LTXAVTextEncoderLoader": "text_encoders",
}

# Workflow widget_values do not always include file extensions. ComfyUI still
# validates these combo widgets against folder_paths by exact value at queue time.
NODE_TYPE_MODEL_WIDGET_CATEGORIES = {
    "CheckpointLoaderSimple": {0: "checkpoints"},
    "CheckpointLoader": {1: "checkpoints"},
    "DiffusersLoader": {0: "diffusers"},
    "unCLIPCheckpointLoader": {0: "checkpoints"},
    "ImageOnlyCheckpointLoader": {0: "checkpoints"},
    "VAELoader": {0: "vae"},
    "VAELoaderKJ": {0: "vae"},
    "LoraLoader": {0: "loras"},
    "LoraLoaderModelOnly": {0: "loras"},
    "LoraLoaderBypass": {0: "loras"},
    "LoraLoaderBypassModelOnly": {0: "loras"},
    "CreateHookLora": {0: "loras"},
    "CreateHookLoraModelOnly": {0: "loras"},
    "CreateHookModelAsLora": {0: "checkpoints"},
    "CreateHookModelAsLoraModelOnly": {0: "checkpoints"},
    "UNETLoader": {0: "diffusion_models"},
    "LoaderGGUF": {0: "diffusion_models"},
    "LoaderGGUFAdvanced": {0: "diffusion_models"},
    "UnetLoaderGGUF": {0: "diffusion_models"},
    "UnetLoaderGGUFAdvanced": {0: "diffusion_models"},
    "LatentUpscaleModelLoader": {0: "latent_upscale_models"},
    "CLIPLoader": {0: "text_encoders"},
    "DualCLIPLoader": {0: "text_encoders", 1: "text_encoders"},
    "CLIPLoaderGGUF": {0: "text_encoders"},
    "ClipLoaderGGUF": {0: "text_encoders"},
    "DualCLIPLoaderGGUF": {0: "text_encoders", 1: "text_encoders"},
    "DualClipLoaderGGUF": {0: "text_encoders", 1: "text_encoders"},
    "TripleCLIPLoader": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
    },
    "TripleClipLoader": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
    },
    "TripleCLIPLoaderGGUF": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
    },
    "TripleClipLoaderGGUF": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
    },
    "QuadrupleCLIPLoader": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
        3: "text_encoders",
    },
    "QuadrupleClipLoader": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
        3: "text_encoders",
    },
    "QuadrupleCLIPLoaderGGUF": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
        3: "text_encoders",
    },
    "QuadrupleClipLoaderGGUF": {
        0: "text_encoders",
        1: "text_encoders",
        2: "text_encoders",
        3: "text_encoders",
    },
    "ControlNetLoader": {0: "controlnet"},
    "DiffControlNetLoader": {0: "controlnet"},
    "ControlNetLoaderAdvanced": {0: "controlnet"},
    "ACN_ControlNetLoaderAdvanced": {0: "controlnet"},
    "ACN_DiffControlNetLoaderAdvanced": {0: "controlnet"},
    "CLIPVisionLoader": {0: "clip_vision"},
    "StyleModelLoader": {0: "style_models"},
    "GLIGENLoader": {0: "gligen"},
    "UpscaleModelLoader": {0: "upscale_models"},
    "SAMLoader": {0: "sams"},
    "UltralyticsDetectorProvider": {0: "ultralytics"},
    "AudioEncoderLoader": {0: "audio_encoders"},
    "LoadBackgroundRemovalModel": {0: "background_removal"},
    "LoadDA3Model": {0: "geometry_estimation"},
    "FrameInterpolationModelLoader": {0: "frame_interpolation"},
    "LoadMediaPipeFaceLandmarker": {0: "detection"},
    "ModelPatchLoader": {0: "model_patches"},
    "LoadMoGeModel": {0: "geometry_estimation"},
    "PhotoMakerLoader": {0: "photomaker"},
    "OpticalFlowLoader": {0: "optical_flow"},
    "HypernetworkLoader": {0: "hypernetworks"},
    "EmbeddingLoader": {0: "embeddings"},
    "LTXVAudioVAELoader": {0: "checkpoints"},
    "LowVRAMAudioVAELoader": {0: "checkpoints"},
    "LTXVGemmaCLIPModelLoader": {0: "text_encoders"},
    "LTXAVTextEncoderLoader": {0: "text_encoders", 1: "checkpoints"},
}

# Model category hints by widget/input name. Workflow JSON does not always preserve
# widget names, but when it does this catches custom loaders without a node-type entry.
MODEL_WIDGET_NAME_TO_CATEGORY = {
    "ckpt_name": "checkpoints",
    "checkpoint": "checkpoints",
    "model_name": "diffusion_models",
    "unet_name": "diffusion_models",
    "gguf_name": "diffusion_models",
    "vae_name": "vae",
    "clip_name": "text_encoders",
    "clip_name1": "text_encoders",
    "clip_name2": "text_encoders",
    "clip_name3": "text_encoders",
    "clip_name4": "text_encoders",
    "clip_vision_name": "clip_vision",
    "lora_name": "loras",
    "existing_lora": "loras",
    "control_net_name": "controlnet",
    "cnet": "controlnet",
    "style_model_name": "style_models",
    "upscale_model_name": "upscale_models",
    "gligen_name": "gligen",
    "audio_encoder_name": "audio_encoders",
    "bg_removal_name": "background_removal",
    "photomaker_model_name": "photomaker",
    "sam_model_name": "sams",
    "text_encoder": "text_encoders",
    "hypernetwork_name": "hypernetworks",
}

MODEL_OUTPUT_TYPE_TO_CATEGORY = {
    "UPSCALE_MODEL": "upscale_models",
    "LATENT_UPSCALE_MODEL": "latent_upscale_models",
    "CONTROL_NET": "controlnet",
    "CLIP_VISION": "clip_vision",
    "STYLE_MODEL": "style_models",
    "GLIGEN": "gligen",
    "AUDIO_ENCODER": "audio_encoders",
    "BACKGROUND_REMOVAL": "background_removal",
    "DA3_MODEL": "geometry_estimation",
    "MOGE_MODEL": "geometry_estimation",
    "INTERP_MODEL": "frame_interpolation",
    "FACE_DETECTION_MODEL": "detection",
    "MODEL_PATCH": "model_patches",
    "PHOTOMAKER": "photomaker",
    "OPTICAL_FLOW": "optical_flow",
}

# Keys within dict-type widget values that contain model file references.
# Some nodes (e.g. rgthree Power Lora Loader) store model info as objects like
# {"on": true, "lora": "name.safetensors", "strength": 1.0} inside widgets_values.
# Maps nested key name -> category hint.
NESTED_MODEL_KEYS = {
    "lora": "loras",
    "ckpt_name": "checkpoints",
    "checkpoint": "checkpoints",
    "vae_name": "vae",
    "clip_name": "text_encoders",
    "clip_name1": "text_encoders",
    "clip_name2": "text_encoders",
    "clip_name3": "text_encoders",
    "clip_name4": "text_encoders",
    "control_net_name": "controlnet",
    "cnet": "controlnet",
    "model_name": "diffusion_models",
    "unet_name": "diffusion_models",
    "gguf_name": "diffusion_models",
    "gligen_name": "gligen",
    "audio_encoder_name": "audio_encoders",
    "bg_removal_name": "background_removal",
    "photomaker_model_name": "photomaker",
    "text_encoder": "text_encoders",
}

_DYNAMIC_CATEGORY_SENTINEL_PREFIX = "__model_resolver_folder_category__"
_DYNAMIC_NODE_WIDGET_CATEGORY_CACHE: Dict[str, Dict[str, Any]] = {}
_DYNAMIC_NODE_WIDGET_CATEGORY_LOCK = threading.RLock()

# These ComfyUI INPUT_TYPES entries become widgets in widgets_values. Typed graph
# inputs like MODEL or CLIP are links, so they should not shift widget indexes.
_WIDGET_INPUT_TYPES = {"BOOLEAN", "COMBO", "FLOAT", "INT", "STRING"}


def normalize_widget_name(value: Any) -> str:
    return re.sub(r"[_\s-]+", "_", str(value or "").strip().lower()).strip("_")


def _unique_strings(values: List[Any]) -> List[str]:
    seen = set()
    unique = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def _widget_item_name_candidates(item: Any) -> List[str]:
    if not isinstance(item, dict):
        return []

    candidates = []
    for key in ("name", "label", "localized_name"):
        if item.get(key):
            candidates.append(item.get(key))

    widget = item.get("widget")
    if isinstance(widget, dict):
        for key in ("name", "label"):
            if widget.get(key):
                candidates.append(widget.get(key))
    elif widget:
        candidates.append(widget)

    return _unique_strings(candidates)


def _has_widget_input(item: Any) -> bool:
    return isinstance(item, dict) and item.get("widget") is not None


def _get_widget_inputs(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        item
        for item in node.get("inputs", [])
        if _has_widget_input(item)
    ]


def _get_proxy_widget_entry(node: Dict[str, Any], widget_index: int) -> Any:
    properties = node.get("properties", {})
    proxy_widgets = properties.get("proxyWidgets", [])
    if isinstance(proxy_widgets, list) and widget_index < len(proxy_widgets):
        return proxy_widgets[widget_index]
    return None


def _proxy_widget_name(proxy_entry: Any) -> str:
    if isinstance(proxy_entry, (list, tuple)) and len(proxy_entry) >= 2:
        return str(proxy_entry[1] or "").strip()
    if isinstance(proxy_entry, dict):
        for key in ("name", "widget_name", "widgetName", "targetWidgetName", "inputName"):
            if proxy_entry.get(key):
                return str(proxy_entry.get(key)).strip()
    return ""


def _proxy_widget_node_id(proxy_entry: Any) -> str:
    if isinstance(proxy_entry, (list, tuple)) and proxy_entry:
        return str(proxy_entry[0] or "").strip()
    if isinstance(proxy_entry, dict):
        for key in ("node_id", "nodeId", "target_node_id", "targetNodeId"):
            if proxy_entry.get(key) is not None:
                return str(proxy_entry.get(key)).strip()
    return ""


def get_widget_name_candidates(node: Dict[str, Any], widget_index: int) -> List[str]:
    candidates = []

    proxy_name = _proxy_widget_name(_get_proxy_widget_entry(node, widget_index))
    if proxy_name:
        candidates.append(proxy_name)

    widgets = node.get("widgets", [])
    if isinstance(widgets, list) and widget_index < len(widgets):
        candidates.extend(_widget_item_name_candidates(widgets[widget_index]))

    widget_inputs = _get_widget_inputs(node)
    if widget_index < len(widget_inputs):
        candidates.extend(_widget_item_name_candidates(widget_inputs[widget_index]))

    inputs = node.get("inputs", [])
    if isinstance(inputs, list) and widget_index < len(inputs):
        candidates.extend(_widget_item_name_candidates(inputs[widget_index]))

    return _unique_strings(candidates)


def get_widget_name_hint(node: Dict[str, Any], widget_index: int) -> str:
    candidates = get_widget_name_candidates(node, widget_index)
    return candidates[0] if candidates else ""


def _ordered_unique_categories(values: List[Any]) -> List[str]:
    return _unique_strings([value for value in values if value])


def _merge_category_hints(
    target: Dict[Any, List[str]], key: Any, categories: List[str]
) -> None:
    if not categories:
        return

    target[key] = _ordered_unique_categories(target.get(key, []) + categories)


def _get_folder_paths_module() -> Any:
    global folder_paths
    if folder_paths is not None:
        return folder_paths

    try:
        import folder_paths as fp

        folder_paths = fp
        return folder_paths
    except Exception:
        return None


def _get_comfy_node_class(node_type: str) -> Any:
    if not node_type:
        return None

    try:
        import nodes as comfy_nodes
    except Exception:
        return None

    node_class_mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {}) or {}
    if not isinstance(node_class_mappings, dict):
        return None

    return node_class_mappings.get(node_type)


def _extract_categories_from_value(
    value: Any,
    sentinel_to_category: Dict[str, str],
    depth: int = 0,
    seen: Optional[Set[int]] = None,
) -> List[str]:
    if depth > 8 or not sentinel_to_category:
        return []

    if isinstance(value, str):
        return _ordered_unique_categories(
            [
                category
                for sentinel, category in sentinel_to_category.items()
                if category and sentinel in value
            ]
        )

    if not isinstance(value, (dict, list, tuple, set)):
        return []

    if seen is None:
        seen = set()

    value_id = id(value)
    if value_id in seen:
        return []
    seen.add(value_id)

    categories: List[str] = []
    if isinstance(value, dict):
        for key, nested_value in value.items():
            categories.extend(
                _extract_categories_from_value(
                    key, sentinel_to_category, depth + 1, seen
                )
            )
            categories.extend(
                _extract_categories_from_value(
                    nested_value, sentinel_to_category, depth + 1, seen
                )
            )
    else:
        for item in value:
            categories.extend(
                _extract_categories_from_value(
                    item, sentinel_to_category, depth + 1, seen
                )
            )

    return _ordered_unique_categories(categories)


def _is_input_type_widget_spec(spec: Any) -> bool:
    if not isinstance(spec, (list, tuple)) or not spec:
        return False

    input_type = spec[0]
    if isinstance(input_type, (list, tuple)):
        return True

    if isinstance(input_type, str):
        return input_type.strip().upper() in _WIDGET_INPUT_TYPES

    return False


def _iter_widget_input_type_entries(
    input_types: Dict[str, Any],
) -> List[tuple[str, Any]]:
    entries: List[tuple[str, Any]] = []
    if not isinstance(input_types, dict):
        return entries

    for section_name in ("required", "optional"):
        section = input_types.get(section_name, {})
        if not isinstance(section, dict):
            continue
        entries.extend(section.items())

    return entries


def _build_dynamic_node_widget_category_hints(node_type: str) -> Dict[str, Any]:
    empty_hints = {"by_name": {}, "by_index": {}}
    node_class = _get_comfy_node_class(node_type)
    if node_class is None:
        return empty_hints

    input_types_getter = getattr(node_class, "INPUT_TYPES", None)
    if not callable(input_types_getter):
        return empty_hints

    folder_paths_module = _get_folder_paths_module()
    get_filename_list = getattr(folder_paths_module, "get_filename_list", None)
    if folder_paths_module is None or not callable(get_filename_list):
        return empty_hints

    sentinel_to_category: Dict[str, str] = {}

    def traced_get_filename_list(category: Any, *args: Any, **kwargs: Any) -> List[str]:
        category_name = str(category or "").strip()
        sentinel = f"{_DYNAMIC_CATEGORY_SENTINEL_PREFIX}{len(sentinel_to_category)}"
        sentinel_to_category[sentinel] = category_name
        return [sentinel]

    input_types_func = getattr(input_types_getter, "__func__", input_types_getter)
    input_types_globals = getattr(input_types_func, "__globals__", {})
    patched_globals: List[tuple[Dict[str, Any], str, Any]] = []

    try:
        setattr(folder_paths_module, "get_filename_list", traced_get_filename_list)
        if isinstance(input_types_globals, dict):
            for global_name, global_value in list(input_types_globals.items()):
                if global_value is get_filename_list:
                    input_types_globals[global_name] = traced_get_filename_list
                    patched_globals.append(
                        (input_types_globals, global_name, global_value)
                    )
        input_types = input_types_getter()
    except Exception as exc:
        log_debug(
            f"Could not infer dynamic model widget categories for {node_type}: {exc}"
        )
        return empty_hints
    finally:
        for global_scope, global_name, global_value in patched_globals:
            global_scope[global_name] = global_value
        setattr(folder_paths_module, "get_filename_list", get_filename_list)

    if not sentinel_to_category or not isinstance(input_types, dict):
        return empty_hints

    hints = {"by_name": {}, "by_index": {}}
    widget_index = 0

    for input_name, spec in _iter_widget_input_type_entries(input_types):
        categories = _extract_categories_from_value(spec, sentinel_to_category)
        normalized_name = normalize_widget_name(input_name)

        if normalized_name:
            _merge_category_hints(hints["by_name"], normalized_name, categories)

        if _is_input_type_widget_spec(spec):
            if categories:
                _merge_category_hints(hints["by_index"], widget_index, categories)
            widget_index += 1

    if hints["by_name"] or hints["by_index"]:
        log_debug(
            f"Inferred dynamic model widget categories for {node_type}: {hints}"
        )

    return hints


def get_dynamic_node_widget_category_hints(node_type: str) -> Dict[str, Any]:
    if not node_type:
        return {"by_name": {}, "by_index": {}}

    with _DYNAMIC_NODE_WIDGET_CATEGORY_LOCK:
        cached = _DYNAMIC_NODE_WIDGET_CATEGORY_CACHE.get(node_type)
        if cached is not None:
            return cached

        hints = _build_dynamic_node_widget_category_hints(node_type)

        # Only cache after ComfyUI has exposed the node class and folder_paths. If
        # analysis runs unusually early, a later call can still infer the hints.
        if _get_comfy_node_class(node_type) is not None and _get_folder_paths_module():
            _DYNAMIC_NODE_WIDGET_CATEGORY_CACHE[node_type] = hints

        return hints


def get_dynamic_widget_category_hints(
    node: Dict[str, Any], widget_index: int
) -> List[str]:
    hints = get_dynamic_node_widget_category_hints(str(node.get("type", "") or ""))

    categories: List[str] = []
    by_name = hints.get("by_name", {})
    if isinstance(by_name, dict):
        for candidate in get_widget_name_candidates(node, widget_index):
            categories.extend(by_name.get(normalize_widget_name(candidate), []))

    by_index = hints.get("by_index", {})
    if isinstance(by_index, dict):
        categories.extend(by_index.get(widget_index, []))

    return _ordered_unique_categories(categories)


MODEL_WIDGET_PLACEHOLDERS = {
    "",
    "none",
    "[none]",
    "null",
    "undefined",
    "default",
    "auto",
    "baked vae",
    "included",
    "(use same)",
    "select the lora to add to the text",
    "esam",
    "pixel_space",
    "taesd",
    "taesdxl",
    "taesd3",
    "taef1",
    "taef2",
}


def get_widget_category_hint(node: Dict[str, Any], widget_index: int) -> Optional[str]:
    """
    Best-effort category hint for a widget index based on saved input/widget names.

    ComfyUI workflows usually store only widget values, but some node/workflow formats
    include input/widget metadata. Use it when present; otherwise callers fall back to
    node-type hints and folder_paths resolution.
    """
    for candidate in get_widget_name_candidates(node, widget_index):
        category = MODEL_WIDGET_NAME_TO_CATEGORY.get(normalize_widget_name(candidate))
        if category:
            return category

    return None


def get_node_model_widget_category_hint(
    node_type: str, widget_index: int
) -> Optional[str]:
    """Return the model category for known model selector widget indices."""
    return NODE_TYPE_MODEL_WIDGET_CATEGORIES.get(node_type, {}).get(widget_index)


def get_node_output_category_hint(node: Dict[str, Any]) -> Optional[str]:
    """Return a model category hint from strongly typed loader outputs."""
    outputs = node.get("outputs", [])
    if not isinstance(outputs, list):
        return None

    for output in outputs:
        if not isinstance(output, dict):
            continue
        for key in ("type", "name", "label"):
            token = str(output.get(key, "") or "").strip().upper()
            category = MODEL_OUTPUT_TYPE_TO_CATEGORY.get(token)
            if category:
                return category
    return None


def get_model_widget_category_hint(
    node: Dict[str, Any], widget_index: int
) -> Optional[str]:
    category_hints = get_model_widget_category_hints(node, widget_index)
    return category_hints[0] if category_hints else None


def get_model_widget_category_hints(
    node: Dict[str, Any], widget_index: int
) -> List[str]:
    node_type = node.get("type", "")
    indexed_category_hint = get_node_model_widget_category_hint(node_type, widget_index)
    widget_category_hint = get_widget_category_hint(node, widget_index)
    dynamic_category_hints: List[str] = []
    if not indexed_category_hint and not widget_category_hint:
        dynamic_category_hints = get_dynamic_widget_category_hints(node, widget_index)

    output_category_hint = get_node_output_category_hint(node)
    widgets_values = node.get("widgets_values", [])
    has_single_widget_value = len(widgets_values) == 1
    output_widget_category_hint = (
        output_category_hint
        if (
            indexed_category_hint
            or widget_category_hint
            or dynamic_category_hints
            or has_single_widget_value
        )
        else None
    )

    return _ordered_unique_categories(
        [
            indexed_category_hint,
            widget_category_hint,
            *dynamic_category_hints,
            output_widget_category_hint,
        ]
    )


def get_effective_model_category_hint(
    node: Dict[str, Any], widget_index: int
) -> Optional[str]:
    return get_model_widget_category_hint(
        node, widget_index
    ) or NODE_TYPE_TO_CATEGORY_HINTS.get(node.get("type", ""))


def is_placeholder_model_value(value: Any) -> bool:
    if not isinstance(value, str):
        return False

    return value.strip().lower() in MODEL_WIDGET_PLACEHOLDERS


def should_scan_as_model_reference(value: Any, declared_model_widget: bool) -> bool:
    """Detect model references, including extensionless known model widgets."""
    if is_model_filename(value):
        return True

    if not declared_model_widget or not isinstance(value, str):
        return False

    return bool(value.strip()) and not is_placeholder_model_value(value)


def is_model_filename(value: Any) -> bool:
    """
    Check if a value looks like a model filename or URN.

    Args:
        value: The value to check

    Returns:
        True if it looks like a model filename or URN
    """
    if not isinstance(value, str):
        return False

    # Check model extension
    _, ext = os.path.splitext(value.lower())
    if ext in MODEL_EXTENSIONS:
        return True

    # Check URN format
    return bool(URN_REGEX.match(value.strip()))


def _normalize_model_path_for_lookup(value: str) -> str:
    """Normalize separators for comparison while preserving letter case."""
    if not isinstance(value, str):
        return ""

    normalized = os.path.normpath(value.strip())
    if normalized == ".":
        return ""

    return normalized.replace("\\", "/").strip("/")


def _resolve_from_available_models(
    filename: str,
    categories: Optional[List[str]],
    available_models: Optional[List[Dict[str, Any]]],
) -> Optional[tuple[str, str]]:
    """
    Resolve using scanner data with case-sensitive relative path matching.

    Windows accepts case-mismatched paths in os.path.exists(), but ComfyUI workflow
    values need to match the actual folder/file casing to be safely reusable.
    """
    if not available_models:
        return None

    requested_key = _normalize_model_path_for_lookup(filename)
    if not requested_key:
        return None

    requested_is_absolute = os.path.isabs(filename)
    if requested_is_absolute:
        requested_key = _normalize_model_path_for_lookup(os.path.abspath(filename))

    if categories is None:
        category_order = []
        seen_categories = set()
        for model in available_models:
            category = model.get("category")
            if category and category not in seen_categories:
                seen_categories.add(category)
                category_order.append(category)
    else:
        category_order = categories

    if not category_order:
        return None

    for category in category_order:
        for model in available_models:
            if model.get("category") != category:
                continue

            if requested_is_absolute:
                model_path = model.get("path") or ""
            else:
                model_path = model.get("relative_path") or model.get("filename") or ""

            if _normalize_model_path_for_lookup(model_path) != requested_key:
                continue

            full_path = model.get("path")
            if full_path and os.path.exists(full_path):
                return (category, full_path)

    return None


def _category_has_exact_filename(category: str, filename: str) -> Optional[bool]:
    """
    Check ComfyUI's filename list for an exact-case relative path match.

    Returns None when the filename list is unavailable, allowing callers to fall
    back to the older filesystem existence path.
    """
    if os.path.isabs(filename):
        return None

    requested_key = _normalize_model_path_for_lookup(filename)
    if not requested_key:
        return False

    try:
        available_filenames = folder_paths.get_filename_list(category) or []
    except Exception:
        return None

    return any(
        _normalize_model_path_for_lookup(available_filename) == requested_key
        for available_filename in available_filenames
        if isinstance(available_filename, str)
    )


def try_resolve_model_path(
    value: str,
    categories: List[str] = None,
    available_models: Optional[List[Dict[str, Any]]] = None,
) -> Optional[tuple[str, str]]:
    """
    Try to resolve a model path using folder_paths.

    Args:
        value: The model filename/path to resolve
        categories: Optional list of categories to try (if None, tries all)
        available_models: Optional scanner results used for exact-case matching

    Returns:
        Tuple of (category, full_path) if found, None otherwise
    """
    if not isinstance(value, str) or not value.strip():
        return None

    # Remove any path separators that might indicate an absolute path prefix
    # Workflows should store relative paths, but handle both cases
    filename = value.strip()

    if categories is not None:
        skip_categories = {"custom_nodes", "configs"}
        categories = [c for c in categories if c not in skip_categories]

    resolved = _resolve_from_available_models(filename, categories, available_models)
    if resolved:
        return resolved

    if available_models is not None:
        return None

    # Ensure folder_paths is available
    global folder_paths
    if folder_paths is None:
        try:
            import folder_paths as fp

            folder_paths = fp
        except ImportError:
            log_error("Model Resolver: folder_paths not available")
            return None

    # If categories not provided, try all categories
    if categories is None:
        categories = list(folder_paths.folder_names_and_paths.keys())

    # Skip non-model categories
    skip_categories = {"custom_nodes", "configs"}
    categories = [c for c in categories if c not in skip_categories]

    for category in categories:
        try:
            exact_filename = _category_has_exact_filename(category, filename)
            if exact_filename is False:
                continue

            full_path = folder_paths.get_full_path(category, filename)
            if full_path and os.path.exists(full_path):
                return (category, full_path)
        except Exception:
            continue

    return None


def get_node_model_info(
    node: Dict[str, Any], available_models: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Extract model references from a single node.

    This scans all widgets_values entries and tries to identify which ones
    are model file references by attempting to resolve them.

    Args:
        node: Node dictionary from workflow JSON

    Returns:
        List of model reference dictionaries:
        {
            'node_id': node id,
            'node_type': node type,
            'widget_index': index in widgets_values,
            'original_path': original path from workflow,
            'category': model category (if found),
            'exists': True if model exists,
            'connected': True if node has any connected inputs/outputs
        }
    """
    model_refs = []
    node_id = node.get("id")
    node_type = node.get("type", "")
    node_title = str(node.get("title", "") or "").strip()
    widgets_values = node.get("widgets_values", [])

    # Check if node is connected (has any inputs or outputs with links)
    inputs = node.get("inputs", [])
    outputs = node.get("outputs", [])
    is_connected = any(inp.get("link") is not None for inp in inputs) or any(
        out.get("links") and len(out.get("links", [])) > 0 for out in outputs
    )

    # Check if node is in bypass mode (mode 4)
    node_mode = node.get("mode", 0)
    is_bypassed = node_mode == 4

    # Node is active if connected AND not bypassed
    is_active = is_connected and not is_bypassed

    if not widgets_values:
        return model_refs

    # Special handling for text-based lora loaders (LoraLoaderV2, LoraManager, etc.)
    lora_text_types = [
        "LoraLoaderV2",
        "Lora Loader (LoraManager)",
        "Lora Stacker (LoraManager)",
    ]
    is_lora_text = node_type in lora_text_types
    if is_lora_text and len(widgets_values) >= 3:
        # widgets_values[0] = {"version": 1, "textWidgetName": "text"}
        # widgets_values[1] = "<lora:name1:strength> <lora:name2:strength>"
        # widgets_values[2] = [{"name": "...", "strength": 1, "active": true}, ...]

        # Get all lora files using scanner for recursive search
        from .scanner import get_model_files

        all_loras = available_models if available_models is not None else get_model_files()
        lora_files = [m for m in all_loras if m.get("category") == "loras"]

        # Build a lookup by filename (without extension)
        lora_lookup = {}
        for lf in lora_files:
            fname = lf.get("filename", "")
            if fname:
                # Get name without extension for matching
                base_name = os.path.splitext(fname)[0]
                if base_name not in lora_lookup:
                    lora_lookup[base_name] = []
                lora_lookup[base_name].append(lf)

        lora_list = widgets_values[2]
        if isinstance(lora_list, list):
            for lora_item in lora_list:
                if isinstance(lora_item, dict):
                    name = lora_item.get("name", "")
                    strength = lora_item.get("strength", 1.0)
                    active = lora_item.get("active", True)

                    if name:
                        # Check if lora exists locally using scanner data (recursive search)
                        lora_exists = False
                        lora_full_path = None

                        # Try exact name first (without extension)
                        if name in lora_lookup:
                            lora_full_path = lora_lookup[name][0].get("path")
                            lora_exists = (
                                os.path.exists(lora_full_path)
                                if lora_full_path
                                else False
                            )
                        else:
                            # Try with common extensions
                            for ext in [".safetensors", ".ckpt", ".pt", ".pth"]:
                                test_name = name + ext
                                if test_name in lora_lookup:
                                    lora_full_path = lora_lookup[test_name][0].get(
                                        "path"
                                    )
                                    lora_exists = (
                                        os.path.exists(lora_full_path)
                                        if lora_full_path
                                        else False
                                    )
                                    if lora_exists:
                                        break

                        log_debug(
                            f"Lora {name}: exists={lora_exists}, path={lora_full_path}"
                        )

                        model_refs.append(
                            {
                                "node_id": node_id,
                                "node_type": node_type,
                                "widget_index": 2,  # Index in lora list
                                "widget_name": get_widget_name_hint(node, 2),
                                "original_path": name,
                                "name": name,
                                "strength": float(strength),
                                "active": active,
                                "node_title": node_title,
                                "category": "loras",
                                "full_path": lora_full_path,
                                "exists": lora_exists,
                                "is_urn": False,
                                "is_lora_v2": is_lora_text,
                                "connected": is_active,
                            }
                        )
        return model_refs

    # For each widget value, check if it looks like a model file or URN
    for idx, value in enumerate(widgets_values):
        widget_name = get_widget_name_hint(node, idx)
        model_widget_category_hints = get_model_widget_category_hints(node, idx)
        model_widget_category_hint = (
            model_widget_category_hints[0] if model_widget_category_hints else None
        )
        effective_category_hint = (
            model_widget_category_hint
            or NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)
        )
        categories_to_try_for_widget = (
            model_widget_category_hints
            if model_widget_category_hints
            else ([effective_category_hint] if effective_category_hint else None)
        )

        if not should_scan_as_model_reference(
            value, declared_model_widget=bool(model_widget_category_hint)
        ):
            # Check for dict-type widget values containing model references (e.g. Power Lora Loader)
            # Some nodes store model info as objects like {"on": true, "lora": "name.safetensors", "strength": 1.0}
            if isinstance(value, dict):
                for nested_key, nested_category_hint in NESTED_MODEL_KEYS.items():
                    nested_value = value.get(nested_key)
                    if (
                        not nested_value
                        or not isinstance(nested_value, str)
                        or not should_scan_as_model_reference(
                            nested_value, declared_model_widget=True
                        )
                    ):
                        continue

                    value_str = nested_value.strip()
                    nested_categories = (
                        [nested_category_hint] if nested_category_hint else None
                    )

                    resolved = try_resolve_model_path(
                        value_str,
                        nested_categories,
                        available_models=available_models,
                    )
                    if resolved:
                        category, full_path = resolved
                        exists = os.path.exists(full_path)
                    else:
                        category = nested_category_hint or "unknown"
                        full_path = None
                        exists = False

                    ref = {
                        "node_id": node_id,
                        "node_type": node_type,
                        "widget_index": idx,
                        "widget_name": widget_name,
                        "original_path": value_str,
                        "node_title": node_title,
                        "category": category,
                        "full_path": full_path,
                        "exists": exists,
                        "is_urn": False,
                        "connected": is_active,
                        "nested_key": nested_key,  # Track nested key for updates
                    }

                    if nested_key == "lora":
                        strength = value.get("strength")
                        if strength is not None:
                            try:
                                ref["strength"] = float(strength)
                            except (TypeError, ValueError):
                                pass

                        if isinstance(value.get("on"), bool):
                            ref["active"] = value.get("on")

                    model_refs.append(ref)
            continue

        value_str = str(value).strip()

        # Check if URN
        urn_match = URN_REGEX.match(value_str)
        if urn_match:
            base, typ, provider, model_id, version_id = urn_match.groups()
            category = (
                effective_category_hint
                or URN_TYPE_MAP.get(typ.lower(), "unknown")
            )

            model_refs.append(
                {
                    "node_id": node_id,
                    "node_type": node_type,
                    "widget_index": idx,
                    "widget_name": widget_name,
                    "original_path": value_str,
                    "urn": {
                        "full": value_str,
                        "base": base,
                        "type": typ,
                        "provider": provider,
                        "model_id": int(model_id),
                        "version_id": int(version_id),
                    },
                    "node_title": node_title,
                    "category": category,
                    "full_path": None,
                    "exists": False,
                    "is_urn": True,
                    "connected": is_active,
                }
            )
            continue

        # Existing logic for local filenames
        resolved = try_resolve_model_path(
            value_str,
            categories_to_try_for_widget,
            available_models=available_models,
        )

        if resolved:
            category, full_path = resolved
            exists = os.path.exists(full_path)
        else:
            category = effective_category_hint or "unknown"
            full_path = None
            exists = False

        model_refs.append(
            {
                "node_id": node_id,
                "node_type": node_type,
                "widget_index": idx,
                "widget_name": widget_name,
                "original_path": value_str,
                "node_title": node_title,
                "category": category,
                "full_path": full_path,
                "exists": exists,
                "is_urn": False,
                "connected": is_active,
            }
        )

    return model_refs


def _get_node_by_id(nodes: List[Dict[str, Any]], node_id: Any) -> Optional[Dict[str, Any]]:
    node_id_text = str(node_id)
    for node in nodes:
        if str(node.get("id")) == node_id_text:
            return node
    return None


def _get_widget_index_for_input_index(
    node: Dict[str, Any], input_index: int
) -> Optional[int]:
    widget_index = -1
    for idx, item in enumerate(node.get("inputs", [])):
        if _has_widget_input(item):
            widget_index += 1
        if idx == input_index:
            return widget_index if _has_widget_input(item) else None
    return None


def _get_widget_index_by_name(
    node: Dict[str, Any], widget_name: str
) -> Optional[int]:
    target_name = normalize_widget_name(widget_name)
    if not target_name:
        return None

    widgets_values = node.get("widgets_values", [])
    for widget_index in range(len(widgets_values)):
        candidates = get_widget_name_candidates(node, widget_index)
        if any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            return widget_index

    for input_index, item in enumerate(node.get("inputs", [])):
        if not _has_widget_input(item):
            continue
        candidates = _widget_item_name_candidates(item)
        if any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            return _get_widget_index_for_input_index(node, input_index)

    return None


def _get_subgraph_input_link_ids(subgraph: Dict[str, Any], input_name: str) -> set:
    target_name = normalize_widget_name(input_name)
    if not target_name:
        return set()

    link_ids = set()
    for subgraph_input in subgraph.get("inputs", []):
        candidates = _widget_item_name_candidates(subgraph_input)
        if not any(normalize_widget_name(candidate) == target_name for candidate in candidates):
            continue
        for link_id in subgraph_input.get("linkIds", []) or []:
            link_ids.add(str(link_id))
    return link_ids


def _promoted_widget_target_info(
    node: Dict[str, Any], widget_index: int, proxy_widget_name: str = ""
) -> Dict[str, Any]:
    widget_name = get_widget_name_hint(node, widget_index) or proxy_widget_name
    return {
        "node_id": node.get("id"),
        "node_type": node.get("type", ""),
        "node_title": str(node.get("title", "") or "").strip(),
        "widget_index": widget_index,
        "widget_name": widget_name,
        "category": get_effective_model_category_hint(node, widget_index),
    }


def _find_promoted_widget_targets(
    subgraph: Dict[str, Any], proxy_node_id: str, proxy_widget_name: str
) -> List[Dict[str, Any]]:
    nodes = subgraph.get("nodes", [])
    targets: List[Dict[str, Any]] = []
    seen = set()

    def add_target(node: Optional[Dict[str, Any]], widget_index: Optional[int]):
        if node is None or widget_index is None:
            return
        key = (str(node.get("id")), int(widget_index))
        if key in seen:
            return
        seen.add(key)
        targets.append(_promoted_widget_target_info(node, widget_index, proxy_widget_name))

    if proxy_node_id and proxy_node_id != "-1":
        target_node = _get_node_by_id(nodes, proxy_node_id)
        add_target(target_node, _get_widget_index_by_name(target_node or {}, proxy_widget_name))
        return targets

    link_ids = _get_subgraph_input_link_ids(subgraph, proxy_widget_name)
    if link_ids:
        for node in nodes:
            for input_index, item in enumerate(node.get("inputs", [])):
                if not _has_widget_input(item):
                    continue
                if str(item.get("link")) not in link_ids:
                    continue
                add_target(node, _get_widget_index_for_input_index(node, input_index))

    if targets:
        return targets

    for node in nodes:
        add_target(node, _get_widget_index_by_name(node, proxy_widget_name))

    return targets


def _build_promoted_widget_contexts(
    workflow_json: Dict[str, Any], subgraphs: List[Dict[str, Any]]
) -> Dict[str, Dict[Any, Any]]:
    subgraphs_by_id = {str(sg.get("id")): sg for sg in subgraphs if sg.get("id")}
    subgraph_names = {
        str(sg.get("id")): sg.get("name", sg.get("id"))
        for sg in subgraphs
        if sg.get("id")
    }
    contexts = {
        "instance_widgets": {},
        "inner_widgets": {},
        "inner_widget_names": {},
    }

    for instance_node in workflow_json.get("nodes", []):
        subgraph_id = str(instance_node.get("type", ""))
        subgraph = subgraphs_by_id.get(subgraph_id)
        if not subgraph:
            continue

        proxy_widgets = instance_node.get("properties", {}).get("proxyWidgets", [])
        if not isinstance(proxy_widgets, list):
            continue

        widgets_values = instance_node.get("widgets_values", [])
        for proxy_index, proxy_entry in enumerate(proxy_widgets):
            proxy_widget_name = _proxy_widget_name(proxy_entry)
            if not proxy_widget_name:
                continue

            targets = _find_promoted_widget_targets(
                subgraph,
                _proxy_widget_node_id(proxy_entry),
                proxy_widget_name,
            )
            if not targets:
                continue

            promoted_value = (
                widgets_values[proxy_index]
                if isinstance(widgets_values, list) and proxy_index < len(widgets_values)
                else None
            )
            instance_context = {
                **targets[0],
                "subgraph_id": subgraph_id,
                "subgraph_name": subgraph_names.get(subgraph_id, subgraph_id),
                "proxy_widget_index": proxy_index,
                "proxy_widget_name": proxy_widget_name,
                "promoted_value": promoted_value,
            }
            contexts["instance_widgets"][(str(instance_node.get("id")), proxy_index)] = (
                instance_context
            )

            locator = {
                "node_id": instance_node.get("id"),
                "node_type": instance_node.get("type", ""),
                "node_title": str(instance_node.get("title", "") or "").strip(),
                "subgraph_id": subgraph_id,
                "subgraph_name": subgraph_names.get(subgraph_id, subgraph_id),
                "is_top_level": True,
                "proxy_widget_index": proxy_index,
                "proxy_widget_name": proxy_widget_name,
                "promoted_value": promoted_value,
            }

            for target in targets:
                exact_key = (
                    subgraph_id,
                    str(target.get("node_id")),
                    target.get("widget_index"),
                )
                contexts["inner_widgets"].setdefault(exact_key, []).append(locator)

                widget_name = normalize_widget_name(target.get("widget_name"))
                if widget_name:
                    name_key = (subgraph_id, str(target.get("node_id")), widget_name)
                    contexts["inner_widget_names"].setdefault(name_key, []).append(locator)

    return contexts


def _apply_instance_promoted_widget_context(
    ref: Dict[str, Any],
    context: Optional[Dict[str, Any]],
    available_models: Optional[List[Dict[str, Any]]],
) -> None:
    if not context:
        return

    ref["promoted_widget_name"] = context.get("proxy_widget_name", "")
    ref["promoted_inner_node_id"] = context.get("node_id")
    ref["promoted_inner_node_type"] = context.get("node_type", "")
    ref["promoted_inner_node_title"] = context.get("node_title", "")
    ref["promoted_inner_widget_index"] = context.get("widget_index")
    ref["promoted_inner_widget_name"] = context.get("widget_name", "")

    category = context.get("category")
    original_path = ref.get("original_path", "")
    if not category or not original_path:
        return

    resolved = try_resolve_model_path(
        original_path,
        [category],
        available_models=available_models,
    )
    ref["category"] = category
    if resolved:
        _, full_path = resolved
        ref["full_path"] = full_path
        ref["exists"] = os.path.exists(full_path)
    else:
        ref["full_path"] = None
        ref["exists"] = False


def _select_promoted_locator(
    locators: List[Dict[str, Any]], original_path: str
) -> Optional[Dict[str, Any]]:
    if not locators:
        return None

    for locator in locators:
        if locator.get("promoted_value") == original_path:
            return locator
    return locators[0]


def _apply_promoted_widget_locator(
    ref: Dict[str, Any], contexts: Dict[str, Dict[Any, Any]]
) -> None:
    subgraph_id = str(ref.get("subgraph_id") or "")
    if not subgraph_id:
        return

    exact_key = (subgraph_id, str(ref.get("node_id")), ref.get("widget_index"))
    locators = contexts.get("inner_widgets", {}).get(exact_key, [])
    if not locators and ref.get("widget_name"):
        name_key = (
            subgraph_id,
            str(ref.get("node_id")),
            normalize_widget_name(ref.get("widget_name")),
        )
        locators = contexts.get("inner_widget_names", {}).get(name_key, [])

    locator = _select_promoted_locator(locators, ref.get("original_path", ""))
    if not locator:
        return

    ref["locate_node_id"] = locator.get("node_id")
    ref["locate_node_type"] = locator.get("node_type", "")
    ref["locate_node_title"] = locator.get("node_title", "")
    ref["locate_subgraph_id"] = ""
    ref["locate_subgraph_name"] = locator.get("subgraph_name", "")
    ref["locate_is_top_level"] = True
    ref["locate_via_promoted_widget"] = True


def analyze_workflow_models(
    workflow_json: Dict[str, Any],
    available_models: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Extract all model references from a workflow, including nested subgraphs.

    Args:
        workflow_json: Complete workflow JSON dictionary

    Returns:
        List of model reference dictionaries (same format as get_node_model_info)
        Each dict includes 'subgraph_id' if the model is in a subgraph
    """
    all_model_refs = []

    # Get subgraph definitions first to check if node types are subgraph UUIDs
    definitions = workflow_json.get("definitions", {})
    subgraphs = definitions.get("subgraphs", [])
    subgraph_lookup = {sg.get("id"): sg.get("name", sg.get("id")) for sg in subgraphs}
    promoted_widget_contexts = _build_promoted_widget_contexts(
        workflow_json, subgraphs
    )

    # Analyze top-level nodes
    nodes = workflow_json.get("nodes", [])
    for node in nodes:
        try:
            model_refs = get_node_model_info(node, available_models=available_models)
            node_type = node.get("type", "")

            # Check if node type is a subgraph UUID
            subgraph_name = None
            subgraph_id = None
            if node_type in subgraph_lookup:
                subgraph_name = subgraph_lookup[node_type]
                subgraph_id = node_type

            # Mark with subgraph info if it's a subgraph node
            # For top-level subgraph instance nodes, subgraph_path is None
            # This distinguishes them from nodes within subgraph definitions
            for ref in model_refs:
                ref["subgraph_id"] = subgraph_id
                ref["subgraph_name"] = subgraph_name
                ref["subgraph_path"] = None  # Top-level, not in definitions.subgraphs
                ref["is_top_level"] = True  # Flag to indicate this is a top-level node
                if subgraph_id:
                    context = promoted_widget_contexts.get(
                        "instance_widgets", {}
                    ).get((str(node.get("id")), ref.get("widget_index")))
                    _apply_instance_promoted_widget_context(
                        ref, context, available_models
                    )
            all_model_refs.extend(model_refs)
        except Exception as e:
            log_warn(f"Error analyzing node {node.get('id', 'unknown')}: {e}")
            continue

    # Recursively analyze subgraphs (definitions already loaded above)
    if not subgraphs:  # Re-get if not loaded above
        subgraphs = definitions.get("subgraphs", [])

    for subgraph in subgraphs:
        subgraph_id = subgraph.get("id")
        subgraph_name = subgraph.get("name", subgraph_id)
        subgraph_nodes = subgraph.get("nodes", [])

        log_debug(
            f"Analyzing subgraph: {subgraph_name} (ID: {subgraph_id}) with {len(subgraph_nodes)} nodes"
        )

        for node in subgraph_nodes:
            try:
                model_refs = get_node_model_info(node, available_models=available_models)
                # Mark as belonging to this subgraph definition
                for ref in model_refs:
                    ref["subgraph_id"] = subgraph_id
                    ref["subgraph_name"] = subgraph_name
                    ref["subgraph_path"] = [
                        "definitions",
                        "subgraphs",
                        subgraph_id,
                        "nodes",
                    ]
                    ref["is_top_level"] = False  # This is inside a subgraph definition
                    _apply_promoted_widget_locator(ref, promoted_widget_contexts)
                all_model_refs.extend(model_refs)
            except Exception as e:
                log_warn(
                    f"Error analyzing subgraph node {node.get('id', 'unknown')}: {e}"
                )
                continue

    return all_model_refs


def identify_missing_models(
    workflow_models: List[Dict[str, Any]], available_models: List[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Identify which models from the workflow are missing.
    Deduplicates by filename - same model file only appears once even if
    referenced by multiple nodes.

    Args:
        workflow_models: List of model references from analyze_workflow_models
        available_models: Optional list of available models (if None, checks via folder_paths)

    Returns:
        List of missing model references (deduplicated by filename).
        Each entry has 'all_node_refs' containing all node references for that model.
    """
    # Group missing models by filename to deduplicate
    missing_by_filename: Dict[str, Dict[str, Any]] = {}

    for model_ref in workflow_models:
        # If exists is False, it's missing
        if not model_ref.get("exists", False):
            filename = model_ref.get("original_path", "")

            if filename not in missing_by_filename:
                # First occurrence - use this as the primary entry
                missing_by_filename[filename] = {
                    **model_ref,
                    "all_node_refs": [
                        model_ref.copy()
                    ],  # Track all nodes needing this model
                }
            else:
                # Duplicate - just add to the node refs list
                missing_by_filename[filename]["all_node_refs"].append(model_ref.copy())

    # Return deduplicated list
    return list(missing_by_filename.values())

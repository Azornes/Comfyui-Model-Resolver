"""Static workflow widget metadata and category hints."""

import re
from typing import Any, Dict, List, Optional

from ..custom_nodes import (
    get_custom_node_category_hints,
    get_custom_node_widget_categories,
)
from ..type_utils import unique_ordered_strings

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
NODE_TYPE_MODEL_WIDGET_CATEGORIES.update(get_custom_node_widget_categories())

# Derived dynamically from NODE_TYPE_MODEL_WIDGET_CATEGORIES.
NODE_TYPE_TO_CATEGORY_HINTS = {
    node_type: widget_map[min(widget_map.keys())]
    for node_type, widget_map in NODE_TYPE_MODEL_WIDGET_CATEGORIES.items()
    if widget_map
}
NODE_TYPE_TO_CATEGORY_HINTS.update(get_custom_node_category_hints())

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
    "SEEDVR2_DIT": "seedvr2",
    "SEEDVR2_VAE": "seedvr2",
}

# Keys within dict-type widget values that contain model file references.
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

WORKFLOW_MODEL_WIDGET_NAMES = {
    "model",
    "model_name",
    "model_file",
    "file_name",
    "filename",
}


def normalize_widget_name(value: Any) -> str:
    return re.sub(r"[_\s-]+", "_", str(value or "").strip().lower()).strip("_")


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

    return unique_ordered_strings(candidates)


def _has_widget_input(item: Any) -> bool:
    return isinstance(item, dict) and item.get("widget") is not None


def _get_widget_inputs(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [item for item in node.get("inputs", []) if _has_widget_input(item)]


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
        for key in (
            "name",
            "widget_name",
            "widgetName",
            "targetWidgetName",
            "inputName",
        ):
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
    elif not widget_inputs:
        inputs = node.get("inputs", [])
        if isinstance(inputs, list) and widget_index < len(inputs):
            candidates.extend(_widget_item_name_candidates(inputs[widget_index]))

    return unique_ordered_strings(candidates)


def get_widget_name_hint(node: Dict[str, Any], widget_index: int) -> str:
    candidates = get_widget_name_candidates(node, widget_index)
    return candidates[0] if candidates else ""


def is_workflow_model_widget_candidate(node: Dict[str, Any], widget_index: int) -> bool:
    return any(
        normalize_widget_name(candidate) in WORKFLOW_MODEL_WIDGET_NAMES
        for candidate in get_widget_name_candidates(node, widget_index)
    )


def _ordered_unique_categories(values: List[Any]) -> List[str]:
    return unique_ordered_strings([value for value in values if value])


def get_widget_category_hint(
    node: Dict[str, Any], widget_index: int
) -> Optional[str]:
    """Return a category inferred from saved widget or input names."""
    for candidate in get_widget_name_candidates(node, widget_index):
        category = MODEL_WIDGET_NAME_TO_CATEGORY.get(normalize_widget_name(candidate))
        if category:
            return category
    return None


def get_node_model_widget_category_hint(
    node_type: str, widget_index: int
) -> Optional[str]:
    """Return the model category for a known model selector widget."""
    return NODE_TYPE_MODEL_WIDGET_CATEGORIES.get(node_type, {}).get(widget_index)


def get_node_output_category_hint(node: Dict[str, Any]) -> Optional[str]:
    """Return a category only when strongly typed model outputs are unambiguous."""
    outputs = node.get("outputs", [])
    if not isinstance(outputs, list):
        return None

    categories: List[str] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue
        for key in ("type", "name", "label"):
            token = str(output.get(key, "") or "").strip().upper()
            category = MODEL_OUTPUT_TYPE_TO_CATEGORY.get(token)
            if category:
                categories.append(category)

    unique_categories = _ordered_unique_categories(categories)
    return unique_categories[0] if len(unique_categories) == 1 else None


__all__ = [
    "MODEL_OUTPUT_TYPE_TO_CATEGORY",
    "MODEL_WIDGET_NAME_TO_CATEGORY",
    "NESTED_MODEL_KEYS",
    "NODE_TYPE_MODEL_WIDGET_CATEGORIES",
    "NODE_TYPE_TO_CATEGORY_HINTS",
    "get_node_model_widget_category_hint",
    "get_node_output_category_hint",
    "get_widget_category_hint",
    "get_widget_name_candidates",
    "get_widget_name_hint",
    "is_workflow_model_widget_candidate",
    "normalize_widget_name",
]

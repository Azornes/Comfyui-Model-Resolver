"""
Workflow Analyzer Module

Extracts model references from workflow JSON and identifies missing models.
"""

import os
import re
from typing import List, Dict, Any, Optional

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


def normalize_widget_name(value: Any) -> str:
    return re.sub(r"[_\s-]+", "_", str(value or "").strip().lower()).strip("_")


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
    candidates = []

    for key in ("widgets", "inputs"):
        items = node.get(key)
        if isinstance(items, list) and widget_index < len(items):
            item = items[widget_index]
            if isinstance(item, dict):
                for name in ("name", "label"):
                    if item.get(name):
                        candidates.append(str(item.get(name, "")).strip())

                widget = item.get("widget")
                if isinstance(widget, dict):
                    widget_name = widget.get("name")
                    if widget_name:
                        candidates.append(str(widget_name).strip())
                elif widget:
                    candidates.append(str(widget).strip())

    for candidate in candidates:
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

    # Get category hints for this node type
    category_hint = NODE_TYPE_TO_CATEGORY_HINTS.get(node_type)
    output_category_hint = get_node_output_category_hint(node)
    has_single_widget_value = len(widgets_values) == 1

    # For each widget value, check if it looks like a model file or URN
    for idx, value in enumerate(widgets_values):
        widget_category_hint = get_widget_category_hint(node, idx)
        indexed_category_hint = get_node_model_widget_category_hint(node_type, idx)
        output_widget_category_hint = (
            output_category_hint
            if (indexed_category_hint or widget_category_hint or has_single_widget_value)
            else None
        )
        model_widget_category_hint = (
            indexed_category_hint or output_widget_category_hint or widget_category_hint
        )
        effective_category_hint = model_widget_category_hint or category_hint
        categories_to_try_for_widget = (
            [effective_category_hint] if effective_category_hint else None
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

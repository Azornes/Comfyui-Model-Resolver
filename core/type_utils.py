"""
Type Utilities Module

Unified helper functions for safe data type casting and normalization.
"""

from typing import Any, Dict, List


def as_dict(value: Any) -> Dict[str, Any]:
    """
    Safely cast value to a dictionary.
    
    Args:
        value: Value to cast
        
    Returns:
        The dictionary if input is a dict, empty dict otherwise.
    """
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> List[Any]:
    """
    Safely cast value to a list.
    
    Supports:
        - lists (returns list filtered of None/empty strings)
        - tuples and sets (casts to list and filters)
        - comma-separated strings (splits, strips, and filters)
        
    Args:
        value: Value to cast
        
    Returns:
        A list of elements.
    """
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    if isinstance(value, (tuple, set)):
        return [item for item in value if item not in (None, "")]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


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


def first_non_empty(*values: Any, default: Any = "") -> Any:
    """
    Return the first value that is not None, not an empty/whitespace-only string,
    and not an empty collection.
    """
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, tuple, dict, set)) and not value:
            continue
        return value
    return default


def to_int(value: Any, default: Any = None) -> Any:
    """
    Safely cast a value to an integer, returning a default value on failure.
    """
    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def to_bool(value: Any, default: bool = False) -> bool:
    """
    Safely cast a value to a boolean, converting string "true", "yes", "1" etc.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return bool(value)


# Map of AIR URN type strings to internal ComfyUI folder_paths categories
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

# General mapping of raw/unnormalized keys to canonical categories
CATEGORY_MAP = {
    "checkpoints": "checkpoints",
    "checkpoint": "checkpoints",
    "loras": "loras",
    "lora": "loras",
    "embeddings": "embeddings",
    "embedding": "embeddings",
    "hypernetworks": "hypernetworks",
    "hypernetwork": "hypernetworks",
    "controlnet": "controlnet",
    "control_net": "controlnet",
    "vae": "vae",
    "upscaler": "upscale_models",
    "upscale_model": "upscale_models",
    "upscale_models": "upscale_models",
    "latent_upscale_model": "latent_upscale_models",
    "latent_upscale_models": "latent_upscale_models",
    "style_model": "style_models",
    "style_models": "style_models",
    "gligen": "gligen",
    "diffusers": "diffusers",
    "vae_approx": "vae_approx",
    "sam": "sams",
    "sam_model": "sams",
    "sam_models": "sams",
    "sams": "sams",
    "ultralytics": "ultralytics",
    "ultralytics_bbox": "ultralytics",
    "ultralytics_segm": "ultralytics",
    "yolo": "ultralytics",
    "audio_encoder": "audio_encoders",
    "audio_encoders": "audio_encoders",
    "background_removal": "background_removal",
    "background_removal_model": "background_removal",
    "frame_interpolation": "frame_interpolation",
    "frame_interpolation_model": "frame_interpolation",
    "geometry_estimation": "geometry_estimation",
    "geometry_estimation_model": "geometry_estimation",
    "detection": "detection",
    "model_patch": "model_patches",
    "model_patches": "model_patches",
    "photomaker": "photomaker",
    "optical_flow": "optical_flow",
    "optical_flow_model": "optical_flow",
    "clip_vision": "clip_vision",
    "ipadapter": "ipadapter",
    "ip_adapter": "ipadapter",
    "default": "upscale_models",
}

# Strict case-sensitive types for CivitAI search API (HTTP 400 on lowercase/mismatch)
CIVITAI_API_TYPE_MAP = {
    "checkpoint": "Checkpoint",
    "checkpoints": "Checkpoint",
    "lora": "LORA",
    "loras": "LORA",
    "vae": "VAE",
    "controlnet": "Controlnet",
    "embedding": "TextualInversion",
    "embeddings": "TextualInversion",
    "upscaler": "Upscaler",
    "upscale_models": "Upscaler",
}

# Case-sensitive types for CivArchive search API (mapping filter support)
CIVARCHIVE_API_TYPE_MAP = {
    "checkpoint": "Checkpoint",
    "checkpoints": "Checkpoint",
    "lora": "LORA",
    "loras": "LORA",
    "locon": "LoCon",
    "lycoris": "LoCon",
    "vae": "VAE",
    "controlnet": "Controlnet",
    "embedding": "TextualInversion",
    "embeddings": "TextualInversion",
    "textualinversion": "TextualInversion",
    "upscaler": "Upscaler",
    "upscale_models": "Upscaler",
    "workflow": "Workflows",
    "workflows": "Workflows",
}

def normalize_download_category(category: str) -> str:
    """Return the canonical ComfyUI folder_paths key for a download category."""
    token = (
        str(category or "")
        .strip()
        .lower()
        .replace("\\", "_")
        .replace("/", "_")
        .replace("-", "_")
        .replace(" ", "_")
    )
    while "__" in token:
        token = token.replace("__", "_")
    token = token.strip("_")
    return CATEGORY_MAP.get(token, token or "checkpoints")




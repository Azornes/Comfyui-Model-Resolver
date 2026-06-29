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
    "unet": "diffusion_models",
    "diffusion_model": "diffusion_models",
    "diffusion_models": "diffusion_models",
    "clip": "text_encoders",
    "clips": "text_encoders",
    "clip_gguf": "text_encoders",
    "text_encoder": "text_encoders",
    "text_encoders": "text_encoders",
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
    "seedvr2": "seedvr2",
    "seedvr2_dit": "seedvr2",
    "seedvr2_vae": "seedvr2",
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
    "hypernetwork": "Hypernetwork",
    "hypernetworks": "Hypernetwork",
    "poses": "Poses",
    "wildcards": "Wildcards",
    "motion_module": "MotionModule",
    "motion_modules": "MotionModule",
    "aesthetic_gradient": "AestheticGradient",
    "aesthetic_gradients": "AestheticGradient",
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
    "hypernetwork": "Hypernetwork",
    "hypernetworks": "Hypernetwork",
    "unet": "UNet",
    "diffusion_models": "UNet",
    "text_encoder": "TextEncoder",
    "text_encoders": "TextEncoder",
    "clip": "TextEncoder",
    "detection": "Detection",
    "wildcards": "Wildcards",
    "aesthetic_gradient": "AestheticGradient",
    "aesthetic_gradients": "AestheticGradient",
    "poses": "Poses",
    "motion_module": "MotionModule",
    "motion_modules": "MotionModule",
}

from typing import Any, Dict, List, Optional, Tuple, Callable
import re

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


def select_primary_model_file(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Selects the primary file from a list of model version files.
    """
    valid_files = [f for f in files if isinstance(f, dict) and (f.get("name") or f.get("filename"))]
    if not valid_files:
        return None

    # 1. Look for file marked primary and of type Model
    for file_info in valid_files:
        if file_info.get("primary") and str(file_info.get("type") or "").lower() == "model":
            return file_info

    # 2. Look for any file marked primary
    for file_info in valid_files:
        if file_info.get("primary"):
            return file_info

    # 3. Look for any file of type Model
    for file_info in valid_files:
        if str(file_info.get("type") or "").lower() == "model":
            return file_info

    # 4. Fallback to the first file
    return valid_files[0]


def parse_size_to_bytes(value: Any) -> Optional[int]:
    """
    Parses a size value to bytes.
    Supports integers, floats, and strings with units (e.g. "1.5 GB", "500 KB").
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    # Check if it's a plain number (e.g., "123456")
    try:
        return int(float(text))
    except ValueError:
        pass

    match = re.search(r"([\d.,]+)\s*(tb|gb|mb|kb|b)?", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        number = float(match.group(1).replace(",", ""))
    except ValueError:
        return None
    unit = (match.group(2) or "b").lower()
    multipliers = {
        "tb": 1024 ** 4,
        "gb": 1024 ** 3,
        "mb": 1024 ** 2,
        "kb": 1024,
        "b": 1,
    }
    return int(number * multipliers.get(unit, 1))


def get_version_sort_key(version: Dict[str, Any]) -> Tuple[str, int]:
    """Helper to get a sorting key tuple (timestamp, version_id) for model versions."""
    if not isinstance(version, dict):
        return ("", 0)
    timestamp = (
        version.get("published_at")
        or version.get("publishedAt")
        or version.get("updated_at")
        or version.get("updatedAt")
        or version.get("created_at")
        or version.get("createdAt")
        or ""
    )
    try:
        version_id = int(version.get("id") or 0)
    except (TypeError, ValueError):
        version_id = 0
    return (str(timestamp), version_id)


def check_credential_http(
    url: str,
    headers: Dict[str, str],
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 10,
    success_message: str = "Credential is valid.",
    get_username: Optional[Callable[[Dict[str, Any]], str]] = None,
    error_msg_401_403: str = "Credential is not accepted.",
    custom_429_handler: Optional[Callable[[Any], Dict[str, Any]]] = None,
    on_success: Optional[Callable[[Any], None]] = None,
    http_method: str = "GET",
) -> Dict[str, Any]:
    """Helper to perform HTTP requests to validate external API credentials."""
    import requests
    try:
        if http_method == "POST":
            response = requests.post(url, headers=headers, json=params, timeout=timeout)
        else:
            response = requests.get(url, headers=headers, params=params, timeout=timeout)

        if response.status_code == 200:
            username = ""
            if get_username:
                try:
                    data = response.json()
                    username = get_username(data)
                except Exception:
                    pass
            message = success_message
            if username:
                message = f"{success_message.rstrip('.')} for {username}."

            result = {
                "success": True,
                "valid": True,
                "status": "valid",
                "message": message,
            }
            if username:
                result["username"] = username
            if on_success:
                on_success(response)
            return result

        if response.status_code in {401, 403}:
            return {
                "success": True,
                "valid": False,
                "status": "invalid",
                "message": error_msg_401_403,
                "status_code": response.status_code,
            }

        if response.status_code == 429 and custom_429_handler:
            return custom_429_handler(response)

        return {
            "success": False,
            "valid": False,
            "status": "error",
            "message": f"Server returned HTTP {response.status_code}.",
            "status_code": response.status_code,
        }
    except requests.exceptions.Timeout:
        return {
            "success": False,
            "valid": False,
            "status": "timeout",
            "message": "Server did not respond before the timeout.",
        }
    except Exception as e:
        return {
            "success": False,
            "valid": False,
            "status": "error",
            "message": str(e),
        }





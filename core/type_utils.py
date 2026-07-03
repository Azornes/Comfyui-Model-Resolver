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
    ".pb",
    ".pickle",
}


PRECISION_FORMAT_SUFFIXES = [
    "fp16",
    "fp32",
    "fp8",
    "fp4",
    "bf16",
    "e4m3fn",
    "mixed",
    "scaled",
    "pruned",
    "emaonly",
    "q4",
    "q8",
]


def get_generic_filename_tokens() -> set:
    """Return a set of generic filename tokens (extensions and suffixes) in lowercase."""
    dotless_extensions = {ext.lstrip(".") for ext in MODEL_EXTENSIONS}
    return dotless_extensions | set(PRECISION_FORMAT_SUFFIXES)



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


def format_size_bytes(bytes_value: Any, include_space: bool = True) -> Optional[str]:
    """Format bytes to human readable string (e.g., 1.5 GB or 1.5GB)."""
    if bytes_value is None or bytes_value == "":
        return None
    if isinstance(bytes_value, str) and not bytes_value.strip().replace(".", "", 1).isdigit():
        return bytes_value
    try:
        val = float(bytes_value)
    except (TypeError, ValueError):
        return str(bytes_value)

    if val <= 0:
        return f"0{ ' B' if include_space else 'B' }"

    k = 1024
    sizes = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while val >= k and i < len(sizes) - 1:
        val /= k
        i += 1

    space = " " if include_space else ""
    return f"{val:.1f}{space}{sizes[i]}"


DEFAULT_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/147.0.0.0 Safari/537.36"
)


def parse_size_header(value: Any) -> Optional[int]:
    """Safely parse a size value (like a header) to bytes with fallback."""
    if value is None or value == "":
        return None
    try:
        size = int(str(value).strip())
        return size if size > 0 else None
    except (TypeError, ValueError):
        size = parse_size_to_bytes(value)
        return size if size and size > 0 else None


def parse_content_range_size(value: Any) -> Optional[int]:
    """Extract total size from a Content-Range header value."""
    if not value:
        return None
    match = re.search(r"/(\d+)\s*$", str(value))
    if not match:
        return None
    return parse_size_header(match.group(1))


def extract_response_file_size(response: Any) -> Optional[int]:
    """Extract file size from various HTTP response headers."""
    if response is None:
        return None

    # Check Content-Range first
    size = parse_content_range_size(response.headers.get("Content-Range"))
    if size:
        return size

    # Try other common size headers
    for key in (
        "x-linked-size",
        "x-file-size",
        "x-goog-stored-content-length",
        "content-length",
    ):
        size = parse_size_header(response.headers.get(key))
        if size:
            content_type = (response.headers.get("content-type") or "").lower()
            if key == "content-length" and "text/html" in content_type:
                continue
            return size

    return None


def parse_civitai_model_path(path: str, query_string: str) -> Optional[Dict[str, int]]:
    """
    Common helper to parse `/models/{model_id}?modelVersionId={version_id}` URLs
    for CivitAI and CivArchive.
    """
    import re
    from urllib.parse import parse_qs

    model_match = re.search(r"/models/(\d+)", path)
    if model_match:
        result = {"model_id": int(model_match.group(1))}
        query = parse_qs(query_string)
        version_id_list = query.get("modelVersionId")
        if version_id_list:
            try:
                result["version_id"] = int(version_id_list[0])
            except (ValueError, TypeError):
                pass
        return result
    return None


def fetch_remote_file_size(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 15,
) -> Optional[int]:
    """
    Sprawdza rozmiar zdalnego pliku wykonując zapytanie HEAD i opcjonalnie GET Range=bytes=0-0.
    """
    import requests
    request_headers = {**(headers or {}), "Accept-Encoding": "identity"}
    
    size = None
    try:
        response = requests.head(
            url,
            headers=request_headers,
            allow_redirects=True,
            timeout=timeout,
        )
        try:
            if response.status_code < 400:
                size = extract_response_file_size(response)
        finally:
            response.close()
    except Exception:
        pass

    if not size:
        try:
            response = requests.get(
                url,
                headers={**request_headers, "Range": "bytes=0-0"},
                allow_redirects=True,
                stream=True,
                timeout=timeout,
            )
            try:
                if response.status_code < 400:
                    size = extract_response_file_size(response)
            finally:
                response.close()
        except Exception:
            pass

    return size


def looks_like_model_file(url: str, expected_filename: str = "") -> bool:
    """
    Walidacja, czy dany link URL wygląda na poprawny plik modelu.
    """
    import os
    from urllib.parse import unquote, urlparse

    text = str(url or "").strip()
    if not text.startswith(("http://", "https://", "hf://")):
        return False
    try:
        parsed = urlparse(text)
        host = parsed.netloc.lower()
        path = unquote(parsed.path or "")
    except Exception:
        host = ""
        path = text

    if host.endswith("huggingface.co") and path.startswith("/spaces/"):
        return False
    
    # Civitai/CivArchive api/download url prefix check
    if (
        host.endswith("civitai.com")
        or host.endswith("civitai.red")
        or host.endswith("civarchive.com")
    ) and "/api/download/" in path:
        return True

    basename = os.path.basename(path).lower()
    expected = os.path.basename(str(expected_filename or "")).lower()
    if expected and basename == expected:
        return True

    ext = os.path.splitext(basename)[1].lower()
    return ext in MODEL_EXTENSIONS


def normalize_model_image(image_data: Dict[str, Any], default_civitai_url: str = "") -> Dict[str, Any]:
    """
    Normalizuje metadane obrazu pochodzące z różnych API do jednolitego słownika.
    """
    if not isinstance(image_data, dict):
        return {}

    meta = image_data.get("meta")
    if not isinstance(meta, dict):
        meta = {}

    url = image_data.get("url") or image_data.get("imageUrl") or image_data.get("src") or ""
    
    civitai_url = image_data.get("civitaiUrl") or image_data.get("postUrl") or default_civitai_url
    if not civitai_url and isinstance(image_data.get("id"), (int, str)):
        civitai_url = f"https://civitai.com/images/{image_data.get('id')}"

    if not civitai_url and url:
        import re
        match = re.search(r"/(\d+)(?:\.[A-Za-z0-9]+)?(?:[?#].*)?$", str(url))
        if match:
            civitai_url = f"https://civitai.com/images/{match.group(1)}"


    return {
        "url": url,
        "civitaiUrl": civitai_url,
        "seed": image_data.get("seed") or meta.get("seed"),
        "steps": image_data.get("steps") or meta.get("steps"),
        "cfg": image_data.get("cfg") or meta.get("cfg") or meta.get("cfgScale"),
        "denoise": image_data.get("denoise") or meta.get("denoise"),
        "scheduler": image_data.get("scheduler") or meta.get("scheduler"),
        "sampler": image_data.get("sampler") or meta.get("sampler"),
        "model": image_data.get("model") or meta.get("model") or meta.get("Model"),
        "positive": image_data.get("positive") or image_data.get("prompt") or meta.get("prompt"),
        "negative": (
            image_data.get("negative")
            or meta.get("negative_prompt")
            or meta.get("negativePrompt")
            or meta.get("Negative prompt")
        ),
        "clip_skip": image_data.get("clipSkip") or meta.get("Clip skip") or meta.get("clipSkip"),
        "width": image_data.get("width") or meta.get("width"),
        "height": image_data.get("height") or meta.get("height"),
        "resources": (
            image_data.get("resources")
            or image_data.get("additionalResources")
            or meta.get("resources")
            or meta.get("additionalResources")
            or []
        ),
        "metadata": meta,
    }


import re
SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")


def normalize_sha256(value: Any) -> str:
    """Return a normalized SHA256 hex string or an empty string."""
    if value is None:
        return ""

    text = str(value).strip()
    for prefix in ("sha256:", "sha256="):
        if text.lower().startswith(prefix):
            text = text[len(prefix):].strip()

    return text.lower() if SHA256_PATTERN.match(text) else ""


def unique_ordered_strings(values: List[Any]) -> List[str]:
    """Zwraca unikalne, niepuste ciągi znaków z zachowaniem oryginalnej kolejności."""
    seen = set()
    unique = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


def extract_sha256_from_metadata(metadata: Any) -> str:
    """
    Wyciąga i zwraca pierwszy poprawny znormalizowany hash SHA256 z metadanych.
    """
    if not isinstance(metadata, dict):
        return ""

    for key in ("sha256", "hash", "SHA256", "Sha256"):
        val = metadata.get(key)
        if val:
            normalized = normalize_sha256(val)
            if normalized:
                return normalized

    hashes = metadata.get("hashes")
    if isinstance(hashes, dict):
        for key in ("SHA256", "sha256", "Sha256", "hash"):
            val = hashes.get(key)
            if val:
                normalized = normalize_sha256(val)
                if normalized:
                    return normalized

    # Obsługa słownika file_info (np. z popular/model_list)
    file_info = metadata.get("file_info")
    if isinstance(file_info, dict):
        for key in ("sha256", "hash", "SHA256", "Sha256"):
            val = file_info.get(key)
            if val:
                normalized = normalize_sha256(val)
                if normalized:
                    return normalized
        f_hashes = file_info.get("hashes")
        if isinstance(f_hashes, dict):
            for key in ("SHA256", "sha256", "Sha256", "hash"):
                val = f_hashes.get(key)
                if val:
                    normalized = normalize_sha256(val)
                    if normalized:
                        return normalized

    # Obsługa zagnieżdżonej listy plików w metadanych Civitai
    files = metadata.get("files")
    if isinstance(files, list):
        for file_info_item in files:
            if isinstance(file_info_item, dict):
                f_hashes = file_info_item.get("hashes")
                if isinstance(f_hashes, dict):
                    for key in ("SHA256", "sha256", "Sha256", "hash"):
                        val = f_hashes.get(key)
                        if val:
                            normalized = normalize_sha256(val)
                            if normalized:
                                return normalized

    return ""


def extract_trained_words(*values: Any) -> List[str]:
    """
    Parsuje i zwraca znormalizowaną listę unikalnych słów kluczowych 
    i tagów z przekazanych wartości (słowników wersji, list lub ciągów znaków).
    """
    words: List[str] = []
    seen = set()

    def process_item(item: Any):
        if isinstance(item, dict):
            if "trainedWords" in item or "trigger" in item or "model" in item:
                for sub_val in (item.get("trainedWords"), item.get("trigger")):
                    if sub_val:
                        process_item(sub_val)
                model = item.get("model")
                if isinstance(model, dict) and "tags" in model:
                    process_item(model.get("tags"))
                return
            else:
                val = (
                    item.get("word")
                    or item.get("name")
                    or item.get("text")
                    or item.get("value")
                )
                process_item(val)
                return
        if isinstance(item, (list, tuple, set)):
            for sub in item:
                process_item(sub)
            return

        text = str(item or "").strip()
        if not text:
            return
        key = text.lower()
        if key not in seen:
            seen.add(key)
            words.append(text)

    for value in values:
        process_item(value)

    return words


_remote_size_cache: Dict[tuple[str, Optional[str]], Optional[int]] = {}


def fetch_remote_file_size_cached(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 15,
) -> Optional[int]:
    """
    Sprawdza rozmiar zdalnego pliku, korzystając ze wspólnej pamięci podręcznej.
    """
    auth = headers.get("Authorization") if headers else None
    cache_key = (url, auth)
    if cache_key in _remote_size_cache:
        return _remote_size_cache[cache_key]

    size = fetch_remote_file_size(url, headers=headers, timeout=timeout)
    _remote_size_cache[cache_key] = size
    return size


def clear_remote_size_cache() -> None:
    """Czyści cache rozmiarów plików zdalnych."""
    _remote_size_cache.clear()


def extract_file_size(file_info: Dict[str, Any]) -> Optional[int]:
    """
    Extracts file size in bytes from various metadata formats (HuggingFace, CivitAI, CivArchive).
    """
    if not isinstance(file_info, dict):
        return None

    # 1. Check direct sizeKB or size_kb keys (e.g. from CivArchive or CivitAI)
    for key in ("sizeKB", "size_kb"):
        val = file_info.get(key)
        if val is not None and val != "":
            try:
                return int(float(val) * 1024)
            except (TypeError, ValueError):
                pass

    # 2. Check direct size bytes keys
    for key in ("sizeBytes", "size_bytes", "fileSize", "file_size", "bytes", "size"):
        val = file_info.get(key)
        if val is not None and val != "":
            size = parse_size_header(val)
            if size:
                return size

    # 3. Check nested LFS info (common in HuggingFace API metadata)
    lfs_info = file_info.get("lfs")
    if isinstance(lfs_info, dict):
        for key in ("size", "sizeBytes", "size_bytes"):
            size = parse_size_header(lfs_info.get(key))
            if size:
                return size

    # 4. Check nested CivArchive mirrors list
    mirrors = file_info.get("mirrors")
    if mirrors:
        if not isinstance(mirrors, list):
            mirrors = [mirrors]
        for mirror in mirrors:
            if isinstance(mirror, dict):
                size = extract_file_size(mirror)
                if size:
                    return size

    return None


def normalize_category_to_model_type(category: str) -> str:
    """
    Mapuje nazwę kategorii pobierania/ComfyUI (np. 'checkpoints') na znormalizowany typ modelu (np. 'checkpoint').
    """
    if not category:
        return ""
    normalized = normalize_download_category(category)
    type_map = {
        "checkpoints": "checkpoint",
        "loras": "lora",
        "vae": "vae",
        "text_encoders": "text_encoder",
        "clip": "clip",
        "clip_vision": "clip_vision",
        "controlnet": "controlnet",
        "upscale_models": "upscale",
        "diffusion_models": "diffusion_model",
        "embeddings": "embedding",
    }
    return type_map.get(normalized, normalized.rstrip("s"))


def check_credential_preconditions(value: Optional[str], token_name: str) -> Optional[Dict[str, Any]]:
    """
    Sprawdza, czy poświadczenie (np. token, klucz) nie jest puste.
    Zwraca standardowy słownik błędu, jeśli poświadczenie jest puste, w przeciwnym razie None.
    """
    clean_val = (value or "").strip()
    if not clean_val:
        return {
            "success": False,
            "valid": False,
            "status": "missing",
            "message": f"Paste a {token_name} first.",
        }
    return None





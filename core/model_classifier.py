"""
Model Classifier & Misplaced Models (Tidy) Service

Inspects model file headers (.safetensors, .gguf) without loading tensor weights,
classifies the model category and base model, detects misplaced models, and
provides safe relocation with sidecar preservation.
"""

import os
import shutil
import threading
from typing import Any, Dict, List, Optional, Set, Tuple

from .contracts import ResolvedModel
from .log_system import create_module_logger
from .path_utils import (
    HIDDEN_SIDECAR_DIRS,
    PRIMARY_HIDDEN_DIR,
    _get_folder_paths_module,
    ensure_hidden_directory,
    get_configured_model_roots,
    infer_category_from_path,
    is_path_in_configured_model_roots,
    is_path_within,
    parse_gguf_metadata,
    read_safetensors_header,
)
from .type_utils import MODEL_EXTENSIONS, normalize_category_token, resolve_model_category

log = create_module_logger(__name__)

# Constants for inspection and classification
MAX_HEADER_BYTES = 100 * 1024 * 1024
GGUF_READ_BYTES = 16 * 1024 * 1024

# Cross-attention context width -> base model
CONTEXT_WIDTH: Dict[int, str] = {768: "SD 1.5", 1024: "SD 2.1", 2048: "SDXL"}

# GGUF architectures -> diffusion / text encoders
GGUF_DIFFUSION: Dict[str, str] = {
    "flux": "Flux.1 D",
    "sd1": "SD 1.5",
    "sdxl": "SDXL",
    "sd3": "SD3",
    "aura": "AuraFlow",
    "hidream": "HiDream",
    "cosmos": "Cosmos",
    "ltxv": "LTXV",
    "hyvid": "Hunyuan Video",
    "wan": "Wan Video",
    "lumina2": "Lumina",
    "qwen_image": "Qwen",
    "chroma": "Chroma",
}

GGUF_TEXT_PREFIXES: Tuple[str, ...] = (
    "t5",
    "t5encoder",
    "umt5",
    "llama",
    "qwen2",
    "qwen2vl",
    "qwen3",
    "gemma",
    "clip",
    "mistral",
)

EMBEDDING_KEYS: Set[str] = {
    "emb_params",
    "clip_l",
    "clip_g",
    "string_to_param",
    "string_to_token",
    "name",
    "step",
    "sd_checkpoint",
    "sd_checkpoint_name",
}

LORA_MARKS: Tuple[str, ...] = (
    "lora_up.",
    "lora_down.",
    "lora_a.",
    "lora_b.",
    "lora.up.",
    "lora.down.",
    "hada_w1_a",
    "lokr_w1",
    ".lora_linear_layer.",
    "dora_scale",
    "oft_blocks",
    "oft_diag",
    "boft_blocks",
    ".proj_lora",
    ".qkv_lora",
)

LORA_PREFIXES: Tuple[str, ...] = (
    "lora_unet_",
    "lora_te_",
    "lora_te1_",
    "lora_te2_",
    "lora_te3_",
)

LORA_ENDS: Tuple[str, ...] = (".diff", ".diff_b")

CONTROL_MARKS: Tuple[str, ...] = (
    "control_model_",
    "input_hint_block",
    "controlnet_cond_embedding",
    "controlnet_blocks",
    "controlnet_x_embedder",
    "zero_convs",
    "controlnet_mid_block",
)

PATCH_KEYS: Set[str] = {
    "lllite_conditioning1.conv1.weight",
    "controlnet_blocks.0.y_rms.weight",
    "feature_embedder.mid_layer_norm.bias",
    "control_all_x_embedder.2-1.weight",
    "controlnet_patch_embedding.weight",
}

IPADAPTER_MARKS: Tuple[str, ...] = (".ip_k_proj.", ".adaln_ip.", "ip_adapter_")

VAE_PARTS: Tuple[str, ...] = ("first_stage_model.", "vae.")
TEXT_PARTS: Tuple[str, ...] = ("cond_stage_model.", "conditioner.", "text_encoders.")
DIFFUSION_PREFIXES: Tuple[str, ...] = (
    "model.diffusion_model.",
    "diffusion_model.",
    "model.model.",
)
DIFFUSION_STARTS: Tuple[str, ...] = (
    "double_blocks.",
    "single_blocks.",
    "joint_blocks.",
    "transformer_blocks.",
    "single_transformer_blocks.",
    "input_blocks.",
    "blocks.0.self_attn",
    "net.blocks.",
    "net.x_embedder.",
    "noise_refiner.",
    "context_refiner.",
    "double_stream_blocks.",
    "down_downscalers.",
)

# Legitimate category pairs that standard ComfyUI loaders can read
WORKS_ANYWAY: Set[Tuple[str, str]] = {
    ("diffusion_models", "checkpoints"),
    ("checkpoints", "diffusion_models"),
    ("diffusion_models", "unet"),
    ("unet", "diffusion_models"),
    ("text_encoders", "clip"),
    ("clip", "text_encoders"),
}

# Standard preview, metadata, and note suffixes to migrate with a model
PREVIEW_SUFFIXES: Tuple[str, ...] = (
    ".preview.png",
    ".preview.jpg",
    ".preview.jpeg",
    ".preview.webp",
    ".preview.mp4",
    ".preview.webm",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".mp4",
    ".webm",
)

METADATA_SUFFIXES: Tuple[str, ...] = (
    ".cmr.json",
    ".json",
    ".civitai.info",
    ".info",
    ".metadata.json",
    ".anomalous.json",
    ".notes.txt",
    ".prompt.txt",
    ".txt",
    ".yaml",
)

ALL_SIDECAR_SUFFIXES: Tuple[str, ...] = PREVIEW_SUFFIXES + METADATA_SUFFIXES

# Cache for inspected file headers
_CACHE_LOCK = threading.Lock()
_HEADER_CACHE: Dict[str, Tuple[int, int, Dict[str, Any]]] = {}
_CACHE_MAX_ENTRIES = 5000


def clear_classifier_cache() -> None:
    """Clear in-memory header inspection cache."""
    with _CACHE_LOCK:
        _HEADER_CACHE.clear()


def normalize_category_for_placement(cat: Optional[str]) -> str:
    """Normalize a category to a canonical folder name."""
    if not cat:
        return ""
    token = normalize_category_token(cat)
    resolved = resolve_model_category(token, target_format="folder", default="")
    canonical = resolved or token
    if canonical == "unet":
        return "diffusion_models"
    if canonical == "clip":
        return "text_encoders"
    return canonical


def is_category_compatible(current_category: str, detected_category: str) -> bool:
    """Check whether a model loads legitimately in its current category."""
    norm_cur = normalize_category_for_placement(current_category)
    norm_det = normalize_category_for_placement(detected_category)
    if not norm_cur or not norm_det:
        return True
    if norm_cur == norm_det:
        return True
    return (norm_cur, norm_det) in WORKS_ANYWAY or (norm_det, norm_cur) in WORKS_ANYWAY


def classify_safetensors_kind(keys: List[str], raw: str, text: str) -> Tuple[str, bool]:
    """
    Classify model kind from safetensors header keys.
    Returns (kind, sure).
    """
    names = set(keys)
    if names and names <= EMBEDDING_KEYS and names & {"emb_params", "clip_l", "clip_g", "string_to_param"}:
        return "embeddings", True
    if names & PATCH_KEYS:
        return "model_patches", True
    if any(key.startswith("model.control_model.") for key in keys):
        return "model_patches", False
    if any(mark in text for mark in CONTROL_MARKS):
        return "controlnet", True

    diffusion = any(key.startswith(DIFFUSION_PREFIXES + DIFFUSION_STARTS) for key in keys)
    vae = any(key.startswith(VAE_PARTS) for key in keys)
    encoders = any(key.startswith(TEXT_PARTS) for key in keys)

    # Whole checkpoint with VAE
    if vae and (diffusion or encoders):
        return "checkpoints", True

    if any(key.startswith("id_encoder.") for key in keys):
        return "photomaker", False

    # IPAdapter
    if any(key.startswith(("image_proj.", "ip_adapter.")) for key in keys) or any(mark in raw for mark in IPADAPTER_MARKS):
        return "ipadapter", True

    # LoRA
    if any(mark in raw for mark in LORA_MARKS) or any(key.startswith(LORA_PREFIXES) or key.endswith(LORA_ENDS) for key in keys):
        return "loras", True

    # Checkpoint saved without VAE
    if diffusion and encoders:
        return "checkpoints", True

    # Standalone diffusion model (UNet / DiT)
    if diffusion:
        return "diffusion_models", True

    # T2I-Adapter
    if any(key.startswith("adapter.body.") for key in keys):
        return "controlnet", True

    # Diffusers UNet
    if "motion_modules" not in raw and any(key.startswith("mid_block.") for key in keys) and any(key.startswith(("time_embedding.", "class_embedding.")) for key in keys):
        return "diffusion_models", True

    if vae and any(not key.startswith(VAE_PARTS) for key in keys):
        return "", False

    if any(mark in text for mark in ("encoder_down_0_block", "decoder_up_0_block", "encoder_down_blocks_0", "encoder_downsamples", "first_stage_model_encoder")):
        return "vae", True

    if "vision_model_encoder_layers" in text:
        return "clip_vision", "text_model" not in text

    if "text_model_encoder_layers" in text or "encoder_block_0_layer_0_selfattention" in text or ("model_layers_0_self_attn" in text and "embed_tokens" in text):
        return "text_encoders", True

    if "conv_first_weight" in text or "body_0_rdb1" in text or ("model_0_weight" in text and "model_1_sub" in text) or "body_0_body_0_body_0" in text or "block_1_c1_r" in text or (keys and all(key.startswith("body.") and key.count(".") == 2 for key in keys)):
        return "upscale_models", False

    return "", False


def classify_safetensors_base(
    header: Dict[str, Any],
    meta: Dict[str, Any],
    text: str,
    kind: str,
) -> Tuple[str, bool]:
    """
    Classify base model from safetensors header and metadata.
    Returns (base_model, sure).
    """
    if kind in ("vae", "text_encoders", "clip_vision", "upscale_models", "ipadapter", "model_patches"):
        return "", True

    if kind == "embeddings":
        if "clip_g" in header:
            return "SDXL", True
        shape = (header.get("emb_params") or {}).get("shape") or []
        width = shape[-1] if shape else 0
        return CONTEXT_WIDTH.get(width, ""), True

    arch = str(meta.get("modelspec.architecture", "")).lower()
    trained = str(meta.get("ss_base_model_version", "")).lower()
    candidates = (
        ("flux", "Flux.1 D"),
        ("chroma", "Chroma"),
        ("stable-diffusion-xl", "SDXL"),
        ("sdxl", "SDXL"),
        ("stable-diffusion-v1", "SD 1.5"),
        ("sd_v1", "SD 1.5"),
        ("stable-diffusion-v2", "SD 2.1"),
        ("sd_v2", "SD 2.1"),
        ("stable-diffusion-3", "SD3"),
        ("sd3", "SD3"),
        ("wan", "Wan Video"),
        ("qwen", "Qwen"),
        ("hunyuan", "Hunyuan Video"),
        ("cosmos", "Cosmos"),
    )
    for mark, name in candidates:
        if (arch and mark in arch) or (trained and trained.startswith(mark)):
            base = name
            if base == "SDXL":
                trained_on = " ".join(
                    str(meta.get(k, ""))
                    for k in ("ss_sd_model_name", "ss_base_model", "modelspec.title")
                ).lower()
                for submark, subname in (("pony", "Pony"), ("illustrious", "Illustrious"), ("noob", "NoobAI")):
                    if submark in trained_on:
                        return subname, True
            return base, True

    # Tensor name signatures
    if "individual_token_refiner" in text:
        return "Hunyuan Video", True
    if "llm_adapter" in text:
        return "Anima", True
    if "adaln_modulation_self_attn" in text:
        return "Cosmos", True
    if "distilled_guidance_layer" in text:
        return "Chroma", True
    if "img_mod_1" in text or "txt_norm" in text or "img_mlp_net" in text:
        return "Qwen", True
    if "double_blocks_0_img_attn" in text or "single_blocks_0_linear1" in text:
        return "Flux.1 D", True
    if "single_transformer_blocks_0_attn" in text or ("single_transformer_blocks" in text and "x_embedder" in text):
        return "Flux.1 D", False
    if "joint_blocks_0_x_block" in text:
        return "SD3", True
    if "blocks_0_self_attn_q" in text and "blocks_0_cross_attn_k" in text:
        return "Wan Video", True
    if any(
        mark in text
        for mark in (
            "conditioner_embedders_1",
            "label_emb_0_0",
            "lora_te1_",
            "lora_te2_",
            "lora_unet_input_blocks",
            "lora_unet_output_blocks",
        )
    ):
        return "SDXL", True

    # Cross-attention context width
    for key, value in header.items():
        low = key.lower().replace(".", "_")
        if "attn2_to_k" not in low or not isinstance(value, dict):
            continue
        shape = value.get("shape") or []
        if len(shape) == 2 and ("lora_down" in low or "lora_a" in low or low.endswith("to_k_weight")):
            w = shape[1]
            if w in CONTEXT_WIDTH:
                return CONTEXT_WIDTH[w], True

    if "cond_stage_model_transformer_text_model" in text:
        return "SD 1.5", True
    if "input_blocks_1_1_transformer_blocks" in text or "lora_unet_down_blocks" in text:
        return "SD 1.5", False

    return "", False


def classify_safetensors_header(header: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Classify a parsed safetensors JSON header."""
    if not isinstance(header, dict) or not header:
        return {"kind": "", "base": "", "sure": False, "form": ""}

    meta = header.get("__metadata__") if isinstance(header.get("__metadata__"), dict) else {}
    keys = [k for k in header if k != "__metadata__"]
    raw = "\n".join(keys).lower()
    text = raw.replace(".", "_")

    kind, kind_sure = classify_safetensors_kind(keys, raw, text)
    base, base_sure = classify_safetensors_base(header, meta, text, kind)
    form = "lllite" if kind == "model_patches" and any(k.startswith("lllite_") for k in keys) else ""

    sure = bool(kind) and kind_sure and (base_sure or not base)
    return {"kind": kind, "base": base, "sure": sure, "form": form}


def classify_gguf_metadata(meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Classify model kind and base model from GGUF metadata."""
    if not isinstance(meta, dict) or not meta:
        return {"kind": "", "base": "", "sure": False, "form": ""}

    arch = str(meta.get("general.architecture", "")).strip().lower()
    if arch in GGUF_DIFFUSION:
        return {
            "kind": "diffusion_models",
            "base": GGUF_DIFFUSION[arch],
            "sure": True,
            "form": "",
        }
    if any(arch.startswith(prefix) for prefix in GGUF_TEXT_PREFIXES):
        return {
            "kind": "text_encoders",
            "base": "",
            "sure": True,
            "form": "",
        }
    return {"kind": "", "base": "", "sure": False, "form": ""}


def classify_model_file(file_path: str) -> Dict[str, Any]:
    """
    Classify a model file from its header alone (safetensors or gguf).
    Cached by (st_size, st_mtime_ns).
    """
    if not file_path or not os.path.isfile(file_path):
        return {"kind": "", "base": "", "sure": False, "format": None, "form": ""}

    try:
        stat = os.stat(file_path)
    except OSError:
        return {"kind": "", "base": "", "sure": False, "format": None, "form": ""}

    cache_key = (stat.st_size, stat.st_mtime_ns)
    with _CACHE_LOCK:
        hit = _HEADER_CACHE.get(file_path)
        if hit and hit[:2] == cache_key:
            return dict(hit[2])

    lower = file_path.lower()
    fmt: Optional[str] = None
    result: Dict[str, Any] = {"kind": "", "base": "", "sure": False, "form": ""}

    if lower.endswith((".safetensors", ".sft")):
        fmt = "safetensors"
        header = read_safetensors_header(file_path, max_header_size=MAX_HEADER_BYTES)
        result = classify_safetensors_header(header)
    elif lower.endswith(".gguf"):
        fmt = "gguf"
        try:
            with open(file_path, "rb") as f:
                data = f.read(GGUF_READ_BYTES)
            meta = parse_gguf_metadata(data)
            result = classify_gguf_metadata(meta)
        except OSError:
            result = {"kind": "", "base": "", "sure": False, "form": ""}

    result["format"] = fmt if result["kind"] or fmt else None

    with _CACHE_LOCK:
        if len(_HEADER_CACHE) >= _CACHE_MAX_ENTRIES:
            _HEADER_CACHE.clear()
        _HEADER_CACHE[file_path] = (*cache_key, dict(result))

    return result


def get_target_root_for_category(
    target_category: str,
    source_path: str,
    folder_paths_module: Optional[Any] = None,
) -> Optional[str]:
    """
    Find the best destination root for target_category, prioritizing
    roots on the same filesystem/drive as source_path.
    """
    fp = _get_folder_paths_module(folder_paths_module)
    if fp is None:
        return None

    norm_target = normalize_category_for_placement(target_category)
    candidates_to_try = [norm_target]
    if norm_target == "diffusion_models":
        candidates_to_try.append("unet")
    elif norm_target == "text_encoders":
        candidates_to_try.append("clip")

    roots: List[str] = []
    get_folder_paths = getattr(fp, "get_folder_paths", None)
    if callable(get_folder_paths):
        for candidate_key in candidates_to_try:
            found = get_folder_paths(candidate_key) or []
            roots.extend([os.path.abspath(r) for r in found if os.path.isdir(r)])
            if roots:
                break

    if not roots:
        # Fallback to configured model roots matching category name
        for root in get_configured_model_roots(fp):
            if os.path.basename(root).lower() == norm_target.lower():
                roots.append(root)

    if not roots:
        return None

    try:
        src_dev = os.stat(source_path).st_dev
        for root in roots:
            if os.stat(root).st_dev == src_dev:
                return root
    except OSError:
        pass

    return roots[0]


def check_model_misplacement(
    file_path: str,
    current_category: Optional[str] = None,
    folder_paths_module: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """
    Check if a model file is placed in the wrong category folder.
    Returns misplacement information if misplaced, else None.
    """
    if not file_path or not os.path.isfile(file_path):
        return None

    classification = classify_model_file(file_path)
    if not classification.get("sure"):
        return None

    detected_kind = classification.get("kind") or ""
    if not detected_kind:
        return None

    inferred_current = current_category or infer_category_from_path(
        file_path, folder_paths_module
    )
    if not inferred_current:
        return None

    norm_current = normalize_category_for_placement(inferred_current)
    norm_detected = normalize_category_for_placement(detected_kind)

    is_compatible = is_category_compatible(norm_current, norm_detected)
    works_anyway = (
        (norm_current, norm_detected) in WORKS_ANYWAY
        or (norm_detected, norm_current) in WORKS_ANYWAY
    )

    if is_compatible and not works_anyway:
        return None

    target_root = get_target_root_for_category(
        norm_detected, file_path, folder_paths_module
    )
    if not target_root:
        return None

    # Derive relative subfolder within category root
    filename = os.path.basename(file_path)
    subfolder = ""
    configured_roots = get_configured_model_roots(folder_paths_module)
    for root in configured_roots:
        if is_path_within(file_path, root):
            rel_dir = os.path.dirname(os.path.relpath(file_path, root))
            if rel_dir and rel_dir != ".":
                subfolder = rel_dir
            break

    target_path = os.path.join(target_root, subfolder, filename) if subfolder else os.path.join(target_root, filename)

    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        file_size = 0

    return {
        "path": file_path,
        "filename": filename,
        "current_category": norm_current,
        "detected_category": norm_detected,
        "base_model": classification.get("base") or "",
        "sure": True,
        "format": classification.get("format"),
        "works_anyway": works_anyway,
        "is_misplaced": not is_compatible,
        "target_category": norm_detected,
        "target_root": target_root,
        "subfolder": subfolder,
        "target_path": target_path,
        "size": file_size,
    }


def scan_misplaced_models(
    models: Optional[List[ResolvedModel]] = None,
    force_rescan: bool = False,
    include_works_anyway: bool = False,
    folder_paths_module: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Scan local models and return all misplaced models.
    """
    from .scanner import get_model_files

    if models is None:
        models = get_model_files(force_rescan=force_rescan)

    misplaced: List[Dict[str, Any]] = []
    seen_paths: Set[str] = set()

    for item in models:
        path = getattr(item, "path", None)
        if not path or path in seen_paths:
            continue
        seen_paths.add(path)

        current_category = getattr(item, "category", None)
        check = check_model_misplacement(path, current_category, folder_paths_module)
        if not check:
            continue

        if check["is_misplaced"] or (include_works_anyway and check["works_anyway"]):
            misplaced.append(check)

    return {
        "misplaced": misplaced,
        "total_scanned": len(seen_paths),
        "misplaced_count": len(misplaced),
    }


def find_model_sidecars(model_path: str) -> List[Tuple[str, str, bool]]:
    """
    Find sidecar files for a model.
    Returns [(file_path, suffix, is_hidden)].
    If another model in the same folder shares the model's stem, beside sidecars
    are not returned (to prevent removing shared files).
    """
    if not model_path:
        return []

    folder, name = os.path.split(model_path)
    stem, _ = os.path.splitext(name)

    # Check if another model in the same directory shares the same stem
    has_other_model_with_stem = any(
        os.path.isfile(os.path.join(folder, stem + ext))
        for ext in MODEL_EXTENSIONS
        if (stem + ext) != name
    )

    sidecars: List[Tuple[str, str, bool]] = []

    # Beside sidecars
    if not has_other_model_with_stem:
        for suffix in ALL_SIDECAR_SUFFIXES:
            candidate = os.path.join(folder, stem + suffix)
            if os.path.isfile(candidate):
                sidecars.append((candidate, suffix, False))

    # Hidden sidecars in .cmr or .amb
    for hidden_dir in HIDDEN_SIDECAR_DIRS:
        h_dir_path = os.path.join(folder, hidden_dir)
        if os.path.isdir(h_dir_path):
            for suffix in ALL_SIDECAR_SUFFIXES:
                candidate = os.path.join(h_dir_path, stem + suffix)
                if os.path.isfile(candidate):
                    sidecars.append((candidate, suffix, True))

    return sidecars


def get_unique_destination_path(target_dir: str, filename: str) -> Tuple[str, str]:
    """
    Generate a non-colliding destination path in target_dir.
    Returns (dest_full_path, dest_stem).
    """
    stem, ext = os.path.splitext(filename)
    dest_path = os.path.join(target_dir, filename)
    if not os.path.exists(dest_path):
        return dest_path, stem

    counter = 2
    while True:
        new_filename = f"{stem} ({counter}){ext}"
        new_path = os.path.join(target_dir, new_filename)
        if not os.path.exists(new_path):
            return new_path, f"{stem} ({counter})"
        counter += 1


def drop_empty_hidden_dir(folder: str) -> None:
    """Remove hidden sidecar folder if empty."""
    for hidden_dir in HIDDEN_SIDECAR_DIRS:
        target = os.path.join(folder, hidden_dir)
        if os.path.isdir(target):
            try:
                os.rmdir(target)
            except OSError:
                pass


def move_misplaced_model(
    source_path: str,
    target_category: str,
    subfolder: Optional[str] = None,
    folder_paths_module: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Safely move a misplaced model and its sidecars to target_category.
    Handles filename collisions without overwriting, cleans empty hidden dirs,
    and invalidates model caches.
    """
    if not source_path or not os.path.isfile(source_path):
        raise FileNotFoundError(f"Model file not found: {source_path}")

    norm_source = os.path.abspath(source_path)
    if not is_path_in_configured_model_roots(norm_source, folder_paths_module):
        raise PermissionError(f"Model path is outside configured model roots: {norm_source}")

    norm_target_cat = normalize_category_for_placement(target_category)
    target_root = get_target_root_for_category(
        norm_target_cat, norm_source, folder_paths_module
    )
    if not target_root or not os.path.isdir(target_root):
        raise ValueError(f"Could not resolve destination root for category: {target_category}")

    # Determine relative subfolder if not provided
    if subfolder is None:
        subfolder = ""
        configured_roots = get_configured_model_roots(folder_paths_module)
        for root in configured_roots:
            if is_path_within(norm_source, root):
                rel_dir = os.path.dirname(os.path.relpath(norm_source, root))
                if rel_dir and rel_dir != ".":
                    subfolder = rel_dir
                break

    target_dir = os.path.join(target_root, subfolder) if subfolder else target_root
    os.makedirs(target_dir, exist_ok=True)

    filename = os.path.basename(norm_source)
    dest_path, dest_stem = get_unique_destination_path(target_dir, filename)

    sidecars = find_model_sidecars(norm_source)

    # Perform model move
    shutil.move(norm_source, dest_path)
    moved_files = [os.path.basename(dest_path)]
    left_behind = []

    # Move sidecars
    for sidecar_path, suffix, is_hidden in sidecars:
        try:
            if is_hidden:
                target_hidden_dir = ensure_hidden_directory(
                    os.path.join(target_dir, PRIMARY_HIDDEN_DIR)
                )
                target_sidecar = os.path.join(target_hidden_dir, f"{dest_stem}{suffix}")
            else:
                target_sidecar = os.path.join(target_dir, f"{dest_stem}{suffix}")

            if os.path.exists(target_sidecar):
                left_behind.append(os.path.basename(sidecar_path))
            else:
                shutil.move(sidecar_path, target_sidecar)
                moved_files.append(os.path.basename(target_sidecar))
        except OSError as e:
            log.warning(f"Could not move sidecar {sidecar_path}: {e}")
            left_behind.append(os.path.basename(sidecar_path))

    # Clean up empty source hidden directories
    source_dir = os.path.dirname(norm_source)
    drop_empty_hidden_dir(source_dir)

    # Invalidate model caches across the system
    from .resolver import invalidate_model_caches

    invalidate_model_caches()

    # Clear ComfyUI's internal filename caches if present
    fp = _get_folder_paths_module(folder_paths_module)
    if fp is not None:
        for cache in (
            getattr(fp, "filename_list_cache", None),
            getattr(fp, "cache_helper", None),
        ):
            if hasattr(cache, "clear") and callable(cache.clear):
                try:
                    cache.clear()
                except Exception:
                    pass

    return {
        "success": True,
        "source_path": norm_source,
        "target_path": dest_path,
        "target_category": norm_target_cat,
        "moved_files": moved_files,
        "left_behind": left_behind,
    }

"""
Path Utilities Module

Provides helper functions for path normalization, symlink resolution,
and directory matching to be shared across all modules.
"""

import os
import json
import hashlib
import re
from typing import Any, Tuple, Optional, Callable, Iterable, List, Dict


_log = None


def _get_log():
    """Return a lazily-created module logger (avoids circular imports)."""
    global _log
    if _log is None:
        from .log_system import create_module_logger
        _log = create_module_logger(__name__)
    return _log



def get_path_identity(path: str) -> str:
    """Return a stable path identity across symlinks/junctions."""
    if not path:
        return ""

    try:
        return os.path.normcase(os.path.realpath(os.path.abspath(path)))
    except (OSError, ValueError):
        return os.path.normcase(os.path.abspath(path))


def get_path_abs(path_value: Any) -> str:
    """Return absolute path safely, handling OSError/ValueError."""
    try:
        return os.path.abspath(str(path_value or ""))
    except (OSError, ValueError):
        return str(path_value or "")


def get_path_key(path_value: Any) -> str:
    """Return a normalized absolute path key for comparison."""
    if not path_value:
        return ""
    try:
        return os.path.normcase(os.path.abspath(str(path_value)))
    except (OSError, ValueError):
        return os.path.normcase(str(path_value or ""))


def is_path_within(path_value: Any, root_value: Any) -> bool:
    """Check if a path is located within a root directory."""
    if not path_value or not root_value:
        return False
    try:
        path_key = get_path_identity(str(path_value))
        root_key = get_path_identity(str(root_value))
        return os.path.commonpath([path_key, root_key]) == root_key
    except Exception:
        return False


def _get_folder_paths_module(folder_paths_module: Optional[Any] = None) -> Optional[Any]:
    if folder_paths_module is not None:
        return folder_paths_module
    try:
        import folder_paths
        return folder_paths
    except ImportError:
        return None


def _coerce_folder_paths(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if not isinstance(value, (list, tuple)):
        return []
    if value and isinstance(value[0], (list, tuple, set)):
        return [str(path) for path in value[0] if path]
    return [str(path) for path in value if isinstance(path, str) and path]


def get_configured_model_roots(
    folder_paths_module: Optional[Any] = None,
    *,
    skip_keys: Optional[Iterable[str]] = None,
) -> List[str]:
    """Return all configured ComfyUI model roots, including external model folders."""
    fp = _get_folder_paths_module(folder_paths_module)
    if fp is None:
        return []

    skipped = {str(key).strip().lower() for key in (skip_keys or {"custom_nodes", "configs"})}
    names = []
    folder_names_and_paths = getattr(fp, "folder_names_and_paths", None)
    if isinstance(folder_names_and_paths, dict):
        names = list(folder_names_and_paths.keys())
    else:
        try:
            get_folder_names = getattr(fp, "get_folder_names", None)
            if callable(get_folder_names):
                names = list(get_folder_names() or [])
        except Exception:
            names = []

    roots: List[str] = []
    seen = set()
    for raw_name in names:
        name = str(raw_name or "").strip()
        if not name or name.lower() in skipped:
            continue

        paths = []
        try:
            get_folder_paths = getattr(fp, "get_folder_paths", None)
            if callable(get_folder_paths):
                paths = list(get_folder_paths(name) or [])
        except Exception:
            paths = []

        if not paths and isinstance(folder_names_and_paths, dict):
            paths = _coerce_folder_paths(folder_names_and_paths.get(name))

        for path in paths:
            if not path:
                continue
            absolute_path = os.path.abspath(os.path.normpath(str(path)))
            identity = get_path_identity(absolute_path)
            if identity in seen:
                continue
            seen.add(identity)
            roots.append(absolute_path)

    return roots


def is_path_in_configured_model_roots(
    path_value: Any,
    folder_paths_module: Optional[Any] = None,
) -> bool:
    """Return True when a path is inside a configured ComfyUI model root."""
    if not path_value:
        return False
    return any(
        is_path_within(path_value, root)
        for root in get_configured_model_roots(folder_paths_module)
    )


def prefer_local_base_directory(
    candidate: str,
    current: str,
    preferred_directory: str = "",
    comfy_root: str = "",
) -> bool:
    """Determine if candidate directory should be preferred over current directory."""
    if not current:
        return True
    if not candidate:
        return False

    candidate_key = get_path_key(candidate)
    current_key = get_path_key(current)
    preferred_key = get_path_key(preferred_directory)
    if preferred_key:
        if candidate_key == preferred_key and current_key != preferred_key:
            return True
        if current_key == preferred_key and candidate_key != preferred_key:
            return False

    if comfy_root:
        candidate_is_external = not is_path_within(candidate, comfy_root)
        current_is_external = not is_path_within(current, comfy_root)
        if candidate_is_external != current_is_external:
            return candidate_is_external

    candidate_is_canonical = candidate_key == get_path_identity(candidate)
    current_is_canonical = current_key == get_path_identity(current)
    if candidate_is_canonical != current_is_canonical:
        return candidate_is_canonical

    return False


def dedupe_local_base_directories(
    paths: list,
    preferred_directory: str = "",
    comfy_root: str = "",
) -> list:
    """Deduplicate a list of directory paths, resolving symlinks/junctions."""
    by_identity = {}
    ordered_identities = []
    for path in paths or []:
        if not path or not os.path.isdir(path):
            continue
        path_abs = get_path_abs(path)
        path_identity = get_path_identity(path_abs)
        if not path_identity:
            continue

        current = by_identity.get(path_identity)
        if not current:
            by_identity[path_identity] = path_abs
            ordered_identities.append(path_identity)
        elif prefer_local_base_directory(
            path_abs,
            current,
            preferred_directory,
            comfy_root,
        ):
            by_identity[path_identity] = path_abs

    return [by_identity[key] for key in ordered_identities]


def write_json_atomic(
    file_path: str,
    data: Any,
    indent: Optional[int] = None,
    separators: Optional[Tuple[str, str]] = None,
) -> None:
    """Safely write data to a JSON file using a temporary file and atomic replace."""
    import tempfile
    import json
    
    dir_name = os.path.dirname(file_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
        
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(file_path)}.",
        suffix=".tmp",
        dir=dir_name or None,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, separators=separators, ensure_ascii=False)
            if indent is not None:
                f.write("\n")
        os.replace(tmp_path, file_path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise


def get_filename_from_path(path: Any) -> str:
    """Return the filename/basename of a path, handling both forward and backward slashes."""
    if not path:
        return ""
    return str(path).replace("\\", "/").split("/")[-1]


# Path to metadata directory
METADATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "metadata"
)


class HashCalculationCancelled(Exception):
    """Exception raised when file SHA256 calculation is cancelled by the caller."""
    pass


SAFETENSORS_HEADER_MAX_BYTES = 100 * 1024 * 1024
_SHA256_HEX_CHARS = frozenset("0123456789abcdefABCDEF")
_NON_SHA256_HASH_KEY_PARTS = (
    "blake3",
    "crc32",
    "md5",
    "sha1",
    "ss_new_sd_model_hash",
    "ss_sd_model_hash",
    "sshs_model_hash",
    "sshs_legacy_hash",
    "autov3",
    "autov1",
    "autov2",
)
_BASE_MODEL_ALIAS_CACHE: Optional[List[Tuple[str, str]]] = None
SAFETENSORS_METADATA_TAG_LIMIT = 40
SAFETENSORS_METADATA_KEY_LIMIT = 80
SAFETENSORS_METADATA_TEXT_MAX_CHARS = 20000
SAFETENSORS_METADATA_THUMBNAIL_MAX_CHARS = 512 * 1024


def _normalize_header_sha256(value: Any) -> str:
    if not isinstance(value, str):
        return ""

    candidate = value.strip()
    lower_candidate = candidate.lower()
    if lower_candidate.startswith("sha256:") or lower_candidate.startswith("sha256="):
        if ":" in candidate:
            candidate = candidate.split(":", 1)[-1]
        else:
            candidate = candidate.split("=", 1)[-1]
        candidate = candidate.strip()
        lower_candidate = candidate.lower()

    if lower_candidate.startswith("0x"):
        candidate = candidate[2:].strip()

    if len(candidate) != 64:
        return ""
    if any(char not in _SHA256_HEX_CHARS for char in candidate):
        return ""
    return candidate.lower()


def read_safetensors_header(
    file_path: str,
    max_header_size: int = SAFETENSORS_HEADER_MAX_BYTES,
) -> Optional[Dict[str, Any]]:
    """Read and parse a safetensors JSON header without touching tensor payloads."""
    if not file_path or not str(file_path).lower().endswith(".safetensors"):
        return None

    try:
        file_size = os.path.getsize(file_path)
    except (OSError, ValueError):
        return None

    if file_size < 8:
        return None

    try:
        with open(file_path, "rb") as f:
            header_size_bytes = f.read(8)
            if len(header_size_bytes) != 8:
                return None

            header_size = int.from_bytes(
                header_size_bytes,
                byteorder="little",
                signed=False,
            )
            if (
                header_size <= 0
                or header_size > max_header_size
                or header_size > file_size - 8
            ):
                return None

            header_bytes = f.read(header_size)
            if len(header_bytes) != header_size:
                return None

        header_json = json.loads(header_bytes.decode("utf-8"))
        if isinstance(header_json, dict):
            return header_json
    except Exception as e:
        _get_log().debug(f"Could not read safetensors header for {file_path}: {e}")

    return None


def extract_safetensors_header_sha256(
    file_path: str,
    max_header_size: int = SAFETENSORS_HEADER_MAX_BYTES,
) -> Optional[str]:
    """Return an embedded SHA256 from a safetensors metadata header when present."""
    header_json = read_safetensors_header(file_path, max_header_size=max_header_size)
    if not isinstance(header_json, dict):
        return None

    metadata = header_json.get("__metadata__")
    if not isinstance(metadata, dict):
        return None

    for key in (
        "modelspec.hash.sha256",
        "modelspec.hash_sha256",
        "sha256",
        "SHA256",
    ):
        sha256 = _normalize_header_sha256(metadata.get(key))
        if sha256:
            return sha256

    for key, value in metadata.items():
        key_lower = str(key).lower()
        if not (
            "sha256" in key_lower
            or "hash" in key_lower
            or "civitai" in key_lower
        ):
            continue
        if any(part in key_lower for part in _NON_SHA256_HASH_KEY_PARTS):
            continue
        sha256 = _normalize_header_sha256(value)
        if sha256:
            return sha256

    return None


def _normalize_base_model_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _load_base_model_aliases() -> List[Tuple[str, str]]:
    """Return normalized base-model aliases ordered from most specific first."""
    global _BASE_MODEL_ALIAS_CACHE
    if _BASE_MODEL_ALIAS_CACHE is not None:
        return _BASE_MODEL_ALIAS_CACHE

    aliases: List[Tuple[str, str]] = []
    try:
        data = read_json_safe(os.path.join(METADATA_DIR, "base-models.json"), {})
        for entry in data.get("base_models", []) if isinstance(data, dict) else []:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            raw_aliases = entry.get("aliases") or []
            if isinstance(raw_aliases, str):
                raw_aliases = [raw_aliases]
            if not isinstance(raw_aliases, (list, tuple, set)):
                raw_aliases = []
            for raw_alias in [name, *raw_aliases]:
                alias = _normalize_base_model_token(raw_alias)
                if alias:
                    aliases.append((alias, name))
    except Exception as e:
        _get_log().debug(f"Could not load base model aliases: {e}")

    aliases.sort(key=lambda item: len(item[0]), reverse=True)
    _BASE_MODEL_ALIAS_CACHE = aliases
    return aliases


def _canonical_base_model_from_text(value: Any) -> str:
    normalized = _normalize_base_model_token(value)
    if not normalized:
        return ""

    for alias, name in _load_base_model_aliases():
        if normalized == alias or (len(alias) >= 4 and alias in normalized):
            return name
    return ""


def infer_safetensors_base_model(
    file_path: str,
    max_tensor_keys: int = 500,
) -> str:
    """Infer a likely base model from safetensors metadata and tensor names."""
    header_json = read_safetensors_header(file_path)
    if not isinstance(header_json, dict):
        return ""

    metadata = header_json.get("__metadata__")
    if not isinstance(metadata, dict):
        metadata = {}

    architecture = str(
        metadata.get("modelspec.architecture")
        or metadata.get("architecture")
        or metadata.get("ss_base_model_version")
        or ""
    ).lower()

    if architecture:
        if "stable-diffusion-xl" in architecture or "sdxl" in architecture:
            return "SDXL 1.0"
        if (
            "stable-diffusion-v1" in architecture
            or "stable-diffusion-1" in architecture
            or "runwayml/stable-diffusion-v1-5" in architecture
            or "sd1.5" in architecture
            or "sd 1.5" in architecture
        ):
            return "SD 1.5"
        if "stable-diffusion-v2" in architecture or "sd2" in architecture:
            return "SD 2.1"
        if (
            "stable-diffusion-3" in architecture
            or "stable-diffusion-v3" in architecture
            or "sd3" in architecture
        ):
            return "SD 3"
        if "flux" in architecture:
            if "krea" in architecture:
                return "Flux.1 Krea"
            if "schnell" in architecture:
                return "Flux.1 S"
            if "kontext" in architecture:
                return "Flux.1 Kontext"
            return "Flux.1 D"
        alias_match = _canonical_base_model_from_text(architecture)
        if alias_match:
            return alias_match

    tensor_keys = [
        str(key)
        for key in header_json.keys()
        if key != "__metadata__"
    ][:max_tensor_keys]
    keys_text = " ".join(tensor_keys)

    if "double_blocks.0.img_attn" in keys_text or "img_in.weight" in keys_text:
        return "Flux.1 D"
    if "joint_blocks.0.x_block" in keys_text:
        return "SD 3"
    if (
        "conditioner.embedders.1.model" in keys_text
        or "label_emb.0.0.weight" in keys_text
    ):
        return "SDXL 1.0"
    if (
        "cond_stage_model.transformer.text_model" in keys_text
        or "model.diffusion_model.input_blocks.0.0.weight" in keys_text
    ):
        return "SD 1.5"

    return ""


def _parse_safetensors_metadata_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return ""
    if text[:1] in {"{", "["}:
        try:
            return json.loads(text)
        except Exception:
            return text
    return text


def _metadata_get(metadata: Dict[str, Any], *keys: str) -> Any:
    if not isinstance(metadata, dict):
        return None

    for key in keys:
        if key in metadata:
            return metadata.get(key)

    lowered = {str(key).lower(): key for key in metadata.keys()}
    for key in keys:
        original_key = lowered.get(str(key).lower())
        if original_key is not None:
            return metadata.get(original_key)
    return None


def _metadata_text(
    metadata: Dict[str, Any],
    *keys: str,
    max_chars: int = SAFETENSORS_METADATA_TEXT_MAX_CHARS,
) -> str:
    value = _parse_safetensors_metadata_value(_metadata_get(metadata, *keys))
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return ""

    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "undefined"}:
        return ""
    if max_chars and len(text) > max_chars:
        return text[:max_chars].rstrip()
    return text


def _dedupe_strings(values: Iterable[Any], limit: int = 0) -> List[str]:
    result: List[str] = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
        if limit and len(result) >= limit:
            break
    return result


def _metadata_string_list(value: Any, limit: int = SAFETENSORS_METADATA_TAG_LIMIT) -> List[str]:
    parsed = _parse_safetensors_metadata_value(value)
    items: List[Any] = []

    def collect(item: Any) -> None:
        item = _parse_safetensors_metadata_value(item)
        if item is None:
            return
        if isinstance(item, dict):
            for key in (
                "tags",
                "model_tags",
                "modelTags",
                "trained_words",
                "trainedWords",
                "trigger",
                "trigger_phrase",
                "values",
                "words",
            ):
                if key in item:
                    collect(item.get(key))
                    return
            for value_item in item.values():
                collect(value_item)
            return
        if isinstance(item, (list, tuple, set)):
            for value_item in item:
                collect(value_item)
            return
        if isinstance(item, str):
            parts = re.split(r"[\n,|;]+", item)
            items.extend(part.strip() for part in parts if part.strip())
            return
        items.append(item)

    collect(parsed)
    return _dedupe_strings(items, limit=limit)


def _collect_tag_frequency_tags(value: Any, limit: int = 20) -> List[str]:
    parsed = _parse_safetensors_metadata_value(value)
    counts: Dict[str, float] = {}

    def add_tag(tag: Any, count: Any) -> None:
        text = str(tag or "").strip()
        if (
            not text
            or len(text) > 80
            or "/" in text
            or "\\" in text
            or text.lower().endswith((".safetensors", ".ckpt", ".pt"))
        ):
            return
        try:
            amount = float(count)
        except (TypeError, ValueError):
            amount = 1.0
        counts[text] = counts.get(text, 0.0) + max(amount, 0.0)

    def walk(item: Any) -> None:
        item = _parse_safetensors_metadata_value(item)
        if isinstance(item, dict):
            numeric_values = True
            for value_item in item.values():
                try:
                    float(value_item)
                except (TypeError, ValueError):
                    numeric_values = False
                    break
            if numeric_values:
                for key, value_item in item.items():
                    add_tag(key, value_item)
                return
            for value_item in item.values():
                walk(value_item)
        elif isinstance(item, (list, tuple, set)):
            for value_item in item:
                walk(value_item)

    walk(parsed)
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0].lower()))
    return [tag for tag, _count in ordered[:limit]]


def _limited_metadata_value(value: Any, *, max_chars: int = 1000, max_items: int = 8) -> Any:
    parsed = _parse_safetensors_metadata_value(value)
    if isinstance(parsed, str):
        text = parsed.strip()
        return text[:max_chars].rstrip() if len(text) > max_chars else text
    if isinstance(parsed, (bool, int, float)) or parsed is None:
        return parsed
    if isinstance(parsed, dict):
        limited: Dict[str, Any] = {}
        for index, (key, item_value) in enumerate(parsed.items()):
            if index >= max_items:
                limited["_truncated"] = True
                break
            limited[str(key)] = _limited_metadata_value(
                item_value,
                max_chars=max_chars,
                max_items=max_items,
            )
        return limited
    if isinstance(parsed, (list, tuple, set)):
        values = list(parsed)
        limited_list = [
            _limited_metadata_value(item, max_chars=max_chars, max_items=max_items)
            for item in values[:max_items]
        ]
        if len(values) > max_items:
            limited_list.append({"_truncated": True})
        return limited_list
    return str(parsed)


def _metadata_preview_url(metadata: Dict[str, Any]) -> str:
    value = _metadata_get(
        metadata,
        "modelspec.thumbnail",
        "thumbnail",
        "thumbnail_url",
        "thumbnailUrl",
        "preview_url",
        "previewUrl",
        "ssmd_cover_images",
    )
    parsed = _parse_safetensors_metadata_value(value)

    def extract(item: Any) -> str:
        item = _parse_safetensors_metadata_value(item)
        if isinstance(item, str):
            text = item.strip()
            if not text or len(text) > SAFETENSORS_METADATA_THUMBNAIL_MAX_CHARS:
                return ""
            if text.startswith(("http://", "https://", "data:image/")):
                return text
            return ""
        if isinstance(item, dict):
            for key in ("url", "src", "image", "thumbnail", "preview", "data"):
                preview = extract(item.get(key))
                if preview:
                    return preview
        if isinstance(item, (list, tuple)):
            for value_item in item:
                preview = extract(value_item)
                if preview:
                    return preview
        return ""

    return extract(parsed)


def _metadata_number_or_text(metadata: Dict[str, Any], *keys: str) -> Any:
    value = _metadata_text(metadata, *keys, max_chars=100)
    if not value:
        return None
    try:
        number = int(value)
        if str(number) == value:
            return number
    except (TypeError, ValueError):
        pass
    return value


def extract_safetensors_header_metadata(file_path: str) -> Dict[str, Any]:
    """Extract displayable local model metadata from a safetensors header."""
    header_json = read_safetensors_header(file_path)
    if not isinstance(header_json, dict):
        return {}

    metadata = header_json.get("__metadata__")
    if not isinstance(metadata, dict):
        metadata = {}

    result: Dict[str, Any] = {}
    metadata_keys = sorted(str(key) for key in metadata.keys())
    if metadata_keys:
        result["header_metadata_keys"] = metadata_keys[:SAFETENSORS_METADATA_KEY_LIMIT]

    title = _metadata_text(
        metadata,
        "modelspec.title",
        "ssmd_display_name",
        "ss_output_name",
        "title",
        "name",
        "model_name",
        max_chars=300,
    )
    if title:
        result["model_name"] = title

    description = _metadata_text(
        metadata,
        "modelspec.description",
        "ssmd_description",
        "description",
        "model_description",
        "ss_training_comment",
    )
    if description:
        result["description"] = description
        result["model_description"] = description

    author = _metadata_text(
        metadata,
        "modelspec.author",
        "ssmd_author",
        "author",
        "creator",
        max_chars=200,
    )
    if author:
        result["author"] = author
        result["creator"] = {"username": author, "name": author}

    license_value = _metadata_text(metadata, "modelspec.license", "license", max_chars=200)
    if license_value:
        result["license"] = license_value

    usage_hint = _metadata_text(
        metadata,
        "modelspec.usage_hint",
        "usage_hint",
        "usage_tips",
        max_chars=2000,
    )
    if usage_hint:
        result["usage_hint"] = usage_hint
        result["usage_tips"] = usage_hint

    explicit_tags: List[str] = []
    for key in ("modelspec.tags", "ssmd_tags", "tags", "model_tags"):
        explicit_tags.extend(_metadata_string_list(_metadata_get(metadata, key)))
    explicit_tags.extend(_collect_tag_frequency_tags(_metadata_get(metadata, "ss_tag_frequency")))
    tags = _dedupe_strings(explicit_tags, limit=SAFETENSORS_METADATA_TAG_LIMIT)
    if tags:
        result["tags"] = tags

    trained_words: List[str] = []
    for key in (
        "modelspec.trigger_phrase",
        "modelspec.trigger_phrases",
        "trigger_phrase",
        "trigger_phrases",
        "trigger",
        "trained_words",
        "trainedWords",
        "ssmd_trained_words",
    ):
        trained_words.extend(_metadata_string_list(_metadata_get(metadata, key), limit=20))
    trained_words = _dedupe_strings(trained_words, limit=20)
    if trained_words:
        result["trained_words"] = trained_words

    preview_url = _metadata_preview_url(metadata)
    if preview_url:
        result["preview_url"] = preview_url
        result["images"] = [
            {
                "url": preview_url,
                "metadata": {"source": "safetensors_header"},
            }
        ]

    clip_skip = _metadata_number_or_text(metadata, "ss_clip_skip", "clip_skip", "clipSkip")
    if clip_skip not in (None, ""):
        result["clip_skip"] = clip_skip

    sha256 = extract_safetensors_header_sha256(file_path)
    if sha256:
        result["sha256"] = sha256
        result["hash"] = sha256
        result["hashes"] = {"SHA256": sha256}
        result["sha256_source"] = "safetensors_header"
        result["hash_status"] = "completed"

    base_model = infer_safetensors_base_model(file_path)
    if base_model:
        result["base_model"] = base_model
        result["base_model_source"] = "safetensors_header"
        result["base_model_inferred"] = True

    raw_base = _metadata_text(
        metadata,
        "ss_base_model_version",
        "modelspec.architecture",
        "architecture",
        max_chars=300,
    )
    if raw_base:
        result["base_model_raw"] = raw_base

    if _metadata_get(metadata, "ss_network_module"):
        result["model_type"] = "LORA"

    summary_fields = {
        "architecture": ("modelspec.architecture", "architecture"),
        "base_model_version": ("ss_base_model_version",),
        "resolution": ("modelspec.resolution", "ss_resolution"),
        "prediction_type": ("modelspec.prediction_type", "prediction_type"),
        "date": ("modelspec.date", "date"),
        "implementation": ("modelspec.implementation",),
        "network_module": ("ss_network_module",),
        "network_dim": ("ss_network_dim",),
        "network_alpha": ("ss_network_alpha",),
        "model_hash": ("sshs_model_hash",),
        "legacy_model_hash": ("sshs_legacy_hash",),
        "training_model": ("ss_sd_model_name", "ss_new_sd_model_name"),
        "vae": ("ss_vae_name",),
        "encoder_layer": ("modelspec.encoder_layer",),
        "merged_from": ("modelspec.merged_from",),
        "merge_recipe": ("sd_merge_recipe",),
        "merge_models": ("sd_merge_models",),
    }
    metadata_summary: Dict[str, Any] = {}
    for output_key, source_keys in summary_fields.items():
        value = _metadata_get(metadata, *source_keys)
        if value in (None, ""):
            continue
        limited_value = _limited_metadata_value(value)
        if limited_value not in (None, "", [], {}):
            metadata_summary[output_key] = limited_value

    if _metadata_get(metadata, "workflow") not in (None, ""):
        metadata_summary["has_embedded_workflow"] = True
    if _metadata_get(metadata, "prompt") not in (None, ""):
        metadata_summary["has_embedded_prompt"] = True

    if metadata_summary:
        result["metadata_summary"] = metadata_summary

    meaningful_keys = (
        "model_name",
        "description",
        "author",
        "license",
        "usage_hint",
        "tags",
        "trained_words",
        "preview_url",
        "sha256",
        "base_model",
        "metadata_summary",
    )
    if any(result.get(key) for key in meaningful_keys):
        result["from_safetensors_header"] = True
        result["metadata_source"] = "safetensors_header"
        result["details_source"] = "safetensors_header"
        result["local_metadata_available"] = True
        return result

    return {}


def calculate_file_sha256(
    file_path: str,
    chunk_size: int = 131072,
    on_progress: Optional[Callable[[int, int], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
    *,
    use_safetensors_header: bool = True,
    on_hash_source: Optional[Callable[[str], None]] = None,
) -> Optional[str]:
    """Return a SHA256 for a local file, preferring safetensors header metadata."""
    if not file_path or not os.path.exists(file_path):
        return None

    if use_safetensors_header:
        embedded_sha256 = extract_safetensors_header_sha256(file_path)
        if embedded_sha256:
            if on_hash_source:
                on_hash_source("safetensors_header")
            return embedded_sha256

    sha256_hash = hashlib.sha256()
    try:
        total_bytes = os.path.getsize(file_path) if on_progress else 0
        bytes_read = 0
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(chunk_size), b""):
                if is_cancelled and is_cancelled():
                    raise HashCalculationCancelled("Hash calculation cancelled")
                if byte_block:
                    sha256_hash.update(byte_block)
                    bytes_read += len(byte_block)
                    if on_progress:
                        on_progress(bytes_read, total_bytes)
        if on_hash_source:
            on_hash_source("file")
        return sha256_hash.hexdigest()
    except HashCalculationCancelled:
        raise
    except Exception as e:
        _get_log().error(f"Error computing hash for {file_path}: {e}")
        return None


def save_catalog_with_backup(
    data_path: str, data: Any, meta_path: str, meta: Any, indent: int = 2
) -> None:
    """Backup an existing catalog file to .bak, then atomically write the new data and its metadata."""
    import shutil
    # Ensure directory exists
    dir_name = os.path.dirname(data_path)
    if dir_name:
        os.makedirs(dir_name, exist_ok=True)
    
    # Backup existing data file
    if os.path.exists(data_path):
        shutil.copy2(data_path, f"{data_path}.bak")
            
    # Write data file atomically
    write_json_atomic(data_path, data, indent=indent)
    
    # Write metadata file atomically
    write_json_atomic(meta_path, meta, indent=indent)


def read_json_safe(file_path: str, default: Any = None) -> Any:
    """Safely read and parse a JSON file, returning a default value on error."""
    if not file_path or not os.path.exists(file_path):
        return default
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        _get_log().warning(f"Error reading JSON from {os.path.basename(file_path)}: {e}")
        return default


def get_comfy_root_path(folder_paths_module: Optional[Any] = None) -> str:
    """Return the absolute path to the ComfyUI root directory."""
    fp = folder_paths_module
    if fp is None:
        try:
            import folder_paths
            fp = folder_paths
        except ImportError:
            return ""
    try:
        module_file = getattr(fp, "__file__", "")
        if module_file:
            return os.path.dirname(os.path.abspath(module_file))
    except Exception:
        pass
    return ""


def find_metadata_sidecar_path(model_path: str) -> str:
    """
    Find an existing metadata sidecar file (for example .metadata.json,
    .civitai.info, or .json) associated with a model file and return its
    absolute path. Returns an empty string when no sidecar exists.
    """
    if not model_path:
        return ""

    directory = os.path.dirname(model_path)
    filename = get_filename_from_path(model_path)
    normalized_model_path = os.path.normcase(os.path.abspath(model_path))

    # Base name without extension
    base_name = filename.rsplit(".", 1)[0] if "." in filename else filename

    # Name patterns based on civitai.py and resolver.py.
    possible_names = [
        base_name + ".metadata.json",
        filename + ".metadata.json",
        base_name + ".civitai.info",
        filename + ".civitai.info",
        base_name + ".json",
        filename + ".json",
        filename.replace("_", " ").split()[0] + ".metadata.json" if "_" in base_name else None,
    ]

    for name in possible_names:
        if name:
            path = os.path.join(directory, name)
            if os.path.normcase(os.path.abspath(path)) == normalized_model_path:
                continue
            if os.path.exists(path):
                return path

    return ""

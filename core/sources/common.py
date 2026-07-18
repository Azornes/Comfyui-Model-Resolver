"""
Common utilities and result builder functions for external model metadata sources.
"""

from typing import Any, Dict, List, Optional

from ..type_utils import build_search_result, normalize_sha256, resolve_model_category


def map_category_to_provider_type(category: Any, provider: str = "civitai") -> str:
    """Map a generic model category or folder name to provider API type string."""
    return resolve_model_category(category, target_format=provider)


def normalize_hashes_dict(hashes: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """
    Normalize a hashes dictionary (e.g. from CivitAI API or CivArchive) so that
    hash algorithm keys are standardized and SHA256 values are uppercase.
    """
    if not isinstance(hashes, dict):
        return {}

    normalized: Dict[str, str] = {}
    for k, v in hashes.items():
        if not k or not v:
            continue
        key_str = str(k).strip()
        val_str = str(v).strip()
        if key_str.lower() in ("sha256", "sha-256"):
            normalized["sha256"] = normalize_sha256(val_str)
        elif key_str.lower() in ("autov2", "auto_v2"):
            normalized["autoV2"] = val_str
        elif key_str.lower() in ("autov1", "auto_v1"):
            normalized["autoV1"] = val_str
        elif key_str.lower() == "blake3":
            normalized["blake3"] = val_str
        else:
            normalized[key_str] = val_str

    return normalized


def build_unified_search_result(
    source: str,
    *,
    model_id: Any,
    version_id: Any,
    name: str = "",
    version_name: str = "",
    type: str = "",
    filename: str = "",
    url: str = "",
    download_url: Optional[str] = None,
    size: Optional[int] = None,
    base_model: Optional[str] = None,
    tags: Optional[List[str]] = None,
    match_type: str = "similar",
    confidence: float = 0.0,
    sha256: Optional[str] = None,
    hashes: Optional[Dict[str, Any]] = None,
    trained_words: Optional[List[str]] = None,
    images: Optional[List[Dict[str, Any]]] = None,
    **extra: Any,
) -> Dict[str, Any]:
    """
    Unified result builder for all model metadata sources.
    Normalizes hash dictionaries and formats a standard model search result.
    """
    norm_hashes = normalize_hashes_dict(hashes)
    if not sha256 and "sha256" in norm_hashes:
        sha256 = norm_hashes["sha256"]

    return build_search_result(
        source,
        model_id=model_id,
        version_id=version_id,
        name=name,
        version_name=version_name,
        type=type,
        filename=filename,
        url=url,
        download_url=download_url,
        size=size,
        base_model=base_model,
        tags=tags,
        match_type=match_type,
        confidence=confidence,
        sha256=sha256,
        hashes=norm_hashes,
        trained_words=trained_words,
        images=images,
        **extra,
    )

"""Infer download path templates from existing local model folders."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from .settings import (
    normalize_download_category,
    normalize_relative_subfolder,
    sanitize_folder_name,
)

TEMPLATE_CATEGORIES = (
    "loras",
    "checkpoints",
    "embeddings",
    "diffusion_models",
    "text_encoders",
    "controlnet",
    "vae",
    "upscale_models",
)

TAG_FOLDER_TOKENS = {
    "concept",
    "concepts",
    "style",
    "styles",
    "character",
    "characters",
    "clothing",
    "clothes",
    "pose",
    "poses",
    "object",
    "objects",
    "vehicle",
    "vehicles",
    "artist",
    "artists",
    "celebrity",
    "celebrities",
}


def _normalize_token(value: Any) -> str:
    from .type_utils import normalize_alphanumeric_key
    return normalize_alphanumeric_key(value)


def _base_model_token_variants(value: Any) -> List[str]:
    token = _normalize_token(value)
    if not token:
        return []

    variants = [token]
    if token.startswith("flux1") and len(token) > len("flux1"):
        variants.append(f"flux{token[len('flux1'):]}")
    if token.endswith("10") and len(token) > 2:
        variants.append(token[:-1])
    return list(dict.fromkeys(variants))


def _split_relative_folder_segments(relative_path: Any) -> List[str]:
    from .path_utils import split_path_segments
    parts = split_path_segments(relative_path)
    return parts[:-1] if len(parts) > 1 else []


def _get_base_models(base_models_config: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(base_models_config, Mapping):
        base_models = base_models_config.get("base_models", [])
    else:
        base_models = base_models_config
    if isinstance(base_models, Sequence) and not isinstance(base_models, (str, bytes)):
        for item in base_models:
            if isinstance(item, Mapping):
                yield item


def _build_base_model_alias_index(base_models_config: Any) -> Dict[str, Dict[str, str]]:
    index: Dict[str, Dict[str, str]] = {}
    for item in _get_base_models(base_models_config):
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        aliases = item.get("aliases") or []
        values = [name, *aliases] if isinstance(aliases, list) else [name]
        for value in values:
            for token in _base_model_token_variants(value):
                if token and token not in index:
                    index[token] = {"name": name, "alias": str(value or "")}
    return index


def _match_base_model_segment(
    segment: str,
    base_alias_index: Mapping[str, Dict[str, str]],
    *,
    allow_partial: bool = True,
) -> Optional[Dict[str, str]]:
    token = _normalize_token(segment)
    if not token:
        return None
    if token in base_alias_index:
        return dict(base_alias_index[token])
    if not allow_partial:
        return None

    for alias_token, match in sorted(
        base_alias_index.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    ):
        if len(alias_token) < 4:
            continue
        remainder = token[len(alias_token) :] if token.startswith(alias_token) else ""
        has_version_suffix = bool(re.fullmatch(r"v?\d+[a-z0-9]*", remainder))
        is_plural = token in {f"{alias_token}s", f"{alias_token}es"}
        if has_version_suffix or is_plural:
            return dict(match)
    return None


def _join_mapping_segments(segments: Sequence[str]) -> str:
    return normalize_relative_subfolder("/".join(str(segment or "") for segment in segments))


def _match_base_model_path(
    segments: Sequence[str],
    base_alias_index: Mapping[str, Dict[str, str]],
) -> Optional[Dict[str, Any]]:
    """Find the deepest recognized base-model segment in a folder prefix."""

    best_match: Optional[Dict[str, Any]] = None
    for start_index in range(len(segments)):
        for end_index in range(start_index, len(segments)):
            span = segments[start_index : end_index + 1]
            span_length = end_index - start_index + 1
            match = _match_base_model_segment(
                " ".join(span),
                base_alias_index,
                # A single folder may append a version or plural suffix to an
                # alias (for example IDEOGRAM4 or Upscalers). Multi-folder spans
                # remain exact to avoid guessing across unrelated path parts.
                allow_partial=span_length == 1,
            )
            if not match:
                continue

            current_span_length = int(best_match.get("span_length", 0)) if best_match else 0
            current_index = int(best_match.get("index", -1)) if best_match else -1
            if end_index < current_index:
                continue
            if end_index == current_index and span_length <= current_span_length:
                continue

            best_match = {
                **match,
                "segment": "/".join(span),
                "index": end_index,
                "start_index": start_index,
                "span_length": span_length,
                "path": _join_mapping_segments(segments[: end_index + 1]),
            }
    return best_match


def _is_tag_like_segment(segment: str) -> bool:
    return _normalize_token(segment) in TAG_FOLDER_TOKENS


def _reason_for_template(template: str, confidence: float) -> str:
    percent = round(confidence * 100)
    if template == "{base_model}/{first_tag}":
        return f"{percent}% foldered models use a base-model folder with a second-level grouping."
    if template == "{base_model}":
        return f"{percent}% foldered models use a recognized base-model folder path."
    if template == "{first_tag}":
        return f"{percent}% foldered models start with a tag-like folder."
    if template == "":
        return f"{percent}% models are stored directly in the root folder."
    return f"{percent}% confidence."


def _infer_category_template(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    total = len(records)
    if total == 0:
        return {
            "template": "",
            "confidence": 0.0,
            "apply": False,
            "model_count": 0,
            "foldered_count": 0,
            "reason": "No local models found for this category.",
            "samples": [],
        }

    foldered_count = sum(1 for record in records if record["segments"])
    flat_count = total - foldered_count
    foldered_denominator = max(foldered_count, 1)
    flat_ratio = flat_count / total
    base_first_count = sum(1 for record in records if record["base_model"])
    base_flat_count = sum(
        1
        for record in records
        if record["base_model"] and record.get("segments_after_base", 0) == 0
    )
    base_grouped_count = sum(
        1
        for record in records
        if record["base_model"] and record.get("segments_after_base", 0) >= 1
    )
    tag_first_count = sum(1 for record in records if record["tag_like_first"])

    base_first_ratio = base_first_count / foldered_denominator
    base_flat_ratio = base_flat_count / foldered_denominator
    base_grouped_ratio = base_grouped_count / foldered_denominator
    tag_first_ratio = tag_first_count / foldered_denominator

    template = ""
    confidence = flat_ratio
    if flat_ratio >= 0.65:
        template = ""
        confidence = flat_ratio
    elif base_grouped_ratio >= 0.45 and base_first_ratio >= 0.5:
        template = "{base_model}/{first_tag}"
        confidence = min(1.0, (base_grouped_ratio * 0.75) + (base_first_ratio * 0.25))
    elif base_first_ratio >= 0.45:
        template = "{base_model}"
        confidence = max(base_first_ratio, base_flat_ratio)
    elif tag_first_ratio >= 0.45:
        template = "{first_tag}"
        confidence = tag_first_ratio

    apply = total >= 2 and confidence >= 0.45
    samples = [record["relative_path"] for record in records if record["segments"]][:5]

    return {
        "template": template,
        "confidence": round(confidence, 3),
        "apply": apply,
        "model_count": total,
        "foldered_count": foldered_count,
        "flat_count": flat_count,
        "base_model_count": base_first_count,
        "base_model_folder_count": base_flat_count,
        "base_model_tag_count": base_grouped_count,
        "tag_like_count": tag_first_count,
        "reason": _reason_for_template(template, confidence),
        "samples": samples,
    }


def infer_download_path_templates(
    models: Iterable[Mapping[str, Any]],
    base_models_config: Any,
) -> Dict[str, Any]:
    """Return template and base-model mapping suggestions for local model folders."""

    base_alias_index = _build_base_model_alias_index(base_models_config)
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    mapping_votes: Dict[str, Counter] = defaultdict(Counter)
    seen = set()

    for model in models or []:
        category = normalize_download_category(str(model.get("category") or ""))
        if category not in TEMPLATE_CATEGORIES:
            continue

        relative_path = str(model.get("relative_path") or model.get("filename") or "")
        model_key = (
            category,
            str(model.get("path") or ""),
            relative_path,
        )
        if model_key in seen:
            continue
        seen.add(model_key)

        segments = _split_relative_folder_segments(relative_path)
        base_match = _match_base_model_path(segments, base_alias_index) if segments else None
        segments_after_base = (
            len(segments) - int(base_match.get("index", 0)) - 1
            if base_match
            else 0
        )
        tag_like_first = _is_tag_like_segment(segments[0]) if segments else False
        grouped[category].append(
            {
                "relative_path": relative_path,
                "segments": segments,
                "base_model": base_match,
                "base_model_path": base_match.get("path", "") if base_match else "",
                "segments_after_base": segments_after_base,
                "tag_like_first": tag_like_first,
            }
        )

        if base_match and segments:
            base_name = base_match.get("name") or ""
            base_path = str(base_match.get("path") or "")
            if base_name and base_path and sanitize_folder_name(base_name, base_name) != base_path:
                mapping_votes[base_name][base_path] += 1

    categories = {
        category: _infer_category_template(grouped.get(category, []))
        for category in TEMPLATE_CATEGORIES
    }
    templates = {
        category: suggestion["template"]
        for category, suggestion in categories.items()
        if suggestion.get("apply")
    }
    base_model_path_mappings = {
        base_name: votes.most_common(1)[0][0]
        for base_name, votes in mapping_votes.items()
        if votes
    }

    return {
        "templates": templates,
        "base_model_path_mappings": base_model_path_mappings,
        "categories": categories,
        "total_models": sum(item.get("model_count", 0) for item in categories.values()),
    }

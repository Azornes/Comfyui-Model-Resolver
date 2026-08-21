"""Shared helpers for collections of local model metadata entries."""

import os
from collections.abc import Iterable, Mapping
from typing import Any, List

from .contracts import ResolvedModel
from .path_utils import get_filename_from_path, get_model_path_identity
from .type_utils import MODEL_EXTENSIONS


def is_model_file_path(path: str) -> bool:
    """Return whether ``path`` points to an existing supported model file."""
    if not path or not os.path.isfile(path):
        return False

    filename = get_filename_from_path(path).lower()
    if filename.endswith((".metadata.json", ".civitai.info")):
        return False

    return os.path.splitext(filename)[1].lower() in MODEL_EXTENSIONS


ModelRecord = ResolvedModel | Mapping[str, Any]


def normalize_models(models: Iterable[ModelRecord] | None) -> List[ResolvedModel]:
    """Normalize local model inputs once at the metadata boundary."""
    result: List[ResolvedModel] = []
    if models is None:
        return result
    if isinstance(models, (str, bytes, Mapping)) or not isinstance(models, Iterable):
        raise TypeError("models must be an iterable of model records")

    for model in models:
        if isinstance(model, ResolvedModel):
            result.append(model)
            continue
        if not isinstance(model, Mapping):
            continue
        try:
            result.append(ResolvedModel.from_mapping(model))
        except (TypeError, ValueError):
            continue
    return result


def dedupe_models(models: Iterable[ModelRecord] | None) -> List[ResolvedModel]:
    """Keep the first normalized local model for every filesystem identity."""
    result: List[ResolvedModel] = []
    seen = set()
    for model in normalize_models(models):
        identity = get_model_path_identity(model.path)
        if not identity or identity in seen:
            continue
        seen.add(identity)
        result.append(model)
    return result

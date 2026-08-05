"""Shared helpers for collections of local model metadata entries."""

import os
from typing import Any, Dict, List

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


def dedupe_models(models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep the first valid model entry for every filesystem identity."""
    result: List[Dict[str, Any]] = []
    seen = set()
    for model in models or []:
        if not isinstance(model, dict):
            continue
        identity = get_model_path_identity(model.get("path"))
        if not identity or identity in seen:
            continue
        seen.add(identity)
        result.append(model)
    return result

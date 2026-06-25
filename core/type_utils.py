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

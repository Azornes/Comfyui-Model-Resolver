"""Shared dependency validation for download components."""

from typing import Any


def require_download_dependencies(dependencies: Any, component: str) -> Any:
    """Return explicitly supplied services for a download component."""
    if dependencies is None:
        raise RuntimeError(f"{component} dependencies were not provided")
    return dependencies

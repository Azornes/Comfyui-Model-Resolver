"""
Model Sources Module

Provides search functionality for finding models from various sources.
"""

from .civarchive import (
    clear_search_cache as clear_civarchive_search_cache,
)
from .civitai import (
    clear_search_cache as clear_civitai_search_cache,
)
from .huggingface import (
    clear_search_cache as clear_huggingface_search_cache,
)
from .lora_manager_archive import (
    clear_search_cache as clear_lora_manager_archive_search_cache,
)


def clear_all_search_caches() -> None:
    """Clear search caches for all external sources."""
    clear_huggingface_search_cache()
    clear_civitai_search_cache()
    clear_civarchive_search_cache()
    clear_lora_manager_archive_search_cache()

__all__ = ["clear_all_search_caches"]

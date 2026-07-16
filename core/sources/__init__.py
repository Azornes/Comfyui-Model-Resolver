"""
Model Sources Module

Provides search functionality for finding models from various sources.
"""

from ..log_system import create_module_logger
from .civarchive import (
    clear_search_cache as clear_civarchive_search_cache,
)
from .civarchive import (
    is_civarchive_available,
    resolve_civarchive_by_hash,
    resolve_civarchive_model_version,
    search_civarchive,
    search_civarchive_for_file,
)
from .civitai import (
    clear_search_cache as clear_civitai_search_cache,
)
from .civitai import (
    get_civitai_download_url,
    search_civitai,
    search_civitai_for_file,
)
from .huggingface import (
    clear_search_cache as clear_huggingface_search_cache,
)
from .huggingface import (
    get_huggingface_download_url,
    search_huggingface,
    search_huggingface_for_file,
)
from .lora_manager_archive import (
    clear_search_cache as clear_lora_manager_archive_search_cache,
)
from .lora_manager_archive import (
    get_lora_manager_archive_db_path,
    is_lora_manager_archive_available,
    search_lora_manager_archive,
    search_lora_manager_archive_for_file,
)
from .model_list import search_model_list, search_model_list_multiple
from .popular import get_popular_model_url, search_popular_models


def clear_all_search_caches() -> None:
    """Clear search caches for all external sources."""
    clear_huggingface_search_cache()
    clear_civitai_search_cache()
    clear_civarchive_search_cache()
    clear_lora_manager_archive_search_cache()

__all__ = [
    "clear_all_search_caches",
    "clear_civarchive_search_cache",
    "clear_lora_manager_archive_search_cache",
    "get_civitai_download_url",
    "get_huggingface_download_url",
    "get_lora_manager_archive_db_path",
    "get_popular_model_url",
    "is_civarchive_available",
    "is_lora_manager_archive_available",
    "resolve_civarchive_by_hash",
    "resolve_civarchive_model_version",
    "search_civarchive",
    "search_civarchive_for_file",
    "search_civitai",
    "search_civitai_for_file",
    "search_huggingface",
    "search_huggingface_for_file",
    "search_lora_manager_archive",
    "search_lora_manager_archive_for_file",
    "search_model_list",
    "search_model_list_multiple",
    "search_popular_models",
]

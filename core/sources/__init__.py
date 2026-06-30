"""
Model Sources Module

Provides search functionality for finding models from various sources.
"""

from ..log_system.log_funcs import create_module_logger  # noqa: F401

from .popular import search_popular_models, get_popular_model_url
from .model_list import search_model_list, search_model_list_multiple
from .huggingface import (
    search_huggingface,
    search_huggingface_for_file,
    get_huggingface_download_url,
)
from .civitai import search_civitai, search_civitai_for_file, get_civitai_download_url
from .civarchive import (
    clear_search_cache as clear_civarchive_search_cache,
    is_civarchive_available,
    resolve_civarchive_by_hash,
    resolve_civarchive_model_version,
    search_civarchive,
    search_civarchive_for_file,
)
from .lora_manager_archive import (
    clear_search_cache as clear_lora_manager_archive_search_cache,
    get_lora_manager_archive_db_path,
    is_lora_manager_archive_available,
    search_lora_manager_archive,
    search_lora_manager_archive_for_file,
)

__all__ = [
    "search_popular_models",
    "get_popular_model_url",
    "search_model_list",
    "search_model_list_multiple",
    "search_huggingface",
    "search_huggingface_for_file",
    "get_huggingface_download_url",
    "search_civitai",
    "search_civitai_for_file",
    "get_civitai_download_url",
    "clear_civarchive_search_cache",
    "is_civarchive_available",
    "resolve_civarchive_by_hash",
    "resolve_civarchive_model_version",
    "search_civarchive",
    "search_civarchive_for_file",
    "clear_lora_manager_archive_search_cache",
    "get_lora_manager_archive_db_path",
    "is_lora_manager_archive_available",
    "search_lora_manager_archive",
    "search_lora_manager_archive_for_file",
]

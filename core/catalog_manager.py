"""Unified manager for metadata catalog files (JSON data and metadata sidecars)."""

from typing import Any, Dict

from .path_utils import read_json_safe, save_catalog_with_backup


class CatalogManager:
    """Encapsulates reading, writing, status auditing, and backup logic for catalog files."""

    def __init__(self, data_file: str, meta_file: str, root_key: str):
        self.data_file = data_file
        self.meta_file = meta_file
        self.root_key = root_key

    def read_data(self) -> Any:
        return read_json_safe(self.data_file, {self.root_key: []})

    def read_meta(self) -> Dict[str, Any]:
        return read_json_safe(self.meta_file, {})

    def save(self, data: Any, meta: Any, indent: int = 2) -> None:
        save_catalog_with_backup(self.data_file, data, self.meta_file, meta, indent=indent)

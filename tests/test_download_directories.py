import os
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.download.directories import get_download_directory
from core.type_utils import get_category_folder_keys


class _FolderPaths:
    def __init__(self, category, path):
        self.folder_names_and_paths = {category: ([path], set())}

    def get_folder_paths(self, category):
        if category not in self.folder_names_and_paths:
            raise KeyError(category)
        return self.folder_names_and_paths[category][0]


@pytest.mark.parametrize("registered_category", ["diffusion_models", "unet"])
def test_download_directory_skips_unavailable_category_aliases(
    tmp_path, registered_category
):
    model_directory = str(tmp_path / registered_category)
    folder_paths = _FolderPaths(registered_category, model_directory)
    dependencies = SimpleNamespace(
        folder_paths=folder_paths,
        get_category_folder_keys=get_category_folder_keys,
        get_path_identity=lambda value: os.path.normcase(os.path.abspath(value)),
        is_path_within=lambda _path, _root: False,
        get_comfy_root_path=lambda _folder_paths: "",
        get_filename_from_path=os.path.basename,
        log=MagicMock(),
    )

    assert get_download_directory("diffusion_models", dependencies=dependencies) == (
        model_directory
    )

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web

from core.routes.context import RouteContext
from core.routes.directories import register_directory_routes
from core.type_utils import to_bool


class _Routes:
    def __init__(self):
        self.handlers = {}

    def get(self, path):
        def decorator(handler):
            self.handlers[("GET", path)] = handler
            return handler

        return decorator

    def post(self, path):
        def decorator(handler):
            self.handlers[("POST", path)] = handler
            return handler

        return decorator


def _json_api_endpoint(_name, **_kwargs):
    return lambda handler: handler


def _dedupe(paths, **_kwargs):
    return list(dict.fromkeys(paths))


def _build_routes(**overrides):
    routes = _Routes()
    values = {
        "TEMPLATE_KEY_ALIASES": {"diffusion_models": ("unet",)},
        "asyncio": asyncio,
        "dedupe_local_base_directories": _dedupe,
        "get_category_folder_keys": lambda category: [category],
        "get_comfy_root_path": MagicMock(return_value=r"C:\ComfyUI"),
        "get_default_root_for_category": MagicMock(return_value=None),
        "get_download_directory": MagicMock(return_value=r"C:\models"),
        "get_enabled_download_categories": MagicMock(
            side_effect=lambda categories: list(categories)
        ),
        "get_local_path_identity": lambda path: os.path.normcase(
            os.path.abspath(path)
        ),
        "get_model_files": MagicMock(return_value=[]),
        "infer_download_path_templates": MagicMock(return_value=[]),
        "invalidate_local_hash_match_cache": MagicMock(),
        "is_civarchive_available": MagicMock(return_value=False),
        "is_lora_manager_archive_available": MagicMock(return_value=False),
        "json_api_endpoint": _json_api_endpoint,
        "load_resolver_settings": MagicMock(return_value={}),
        "normalize_download_category": lambda category: str(category).lower(),
        "prefer_local_base_directory": MagicMock(return_value=True),
        "register_version_routes": MagicMock(),
        "routes": routes,
        "self": SimpleNamespace(logger=MagicMock()),
        "split_path_segments": lambda value: [
            part for part in str(value).replace("\\", "/").split("/") if part
        ],
        "to_bool": to_bool,
        "web": web,
    }
    values.update(overrides)
    register_directory_routes(RouteContext(values))
    return routes.handlers, values


def _request(category="checkpoints"):
    return SimpleNamespace(
        match_info={"category": category},
        query={},
    )


@pytest.mark.asyncio
async def test_directories_route_returns_only_configured_download_directories():
    handlers, values = _build_routes(
        get_download_directory=MagicMock(
            side_effect=lambda category: {
                "checkpoints": r"C:\models\checkpoints",
                "loras": "",
            }.get(category)
        )
    )
    folder_paths = SimpleNamespace(
        folder_names_and_paths={
            "checkpoints": ([], set()),
            "loras": ([], set()),
        }
    )

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[("GET", "/model_resolver/directories")](
            _request()
        )

    assert json.loads(response.text) == {
        "checkpoints": r"C:\models\checkpoints"
    }
    values["get_enabled_download_categories"].assert_called_once_with(
        ["checkpoints", "loras"]
    )


@pytest.mark.asyncio
async def test_root_directories_normalizes_ultralytics_paths_and_skips_yolo():
    handlers, values = _build_routes(
        get_enabled_download_categories=MagicMock(
            return_value=["ultralytics"]
        ),
        get_default_root_for_category=MagicMock(
            return_value=r"C:\models\ultralytics"
        ),
    )
    folder_paths = MagicMock()
    folder_paths.__file__ = r"C:\ComfyUI\folder_paths.py"
    folder_paths.folder_names_and_paths = {
        "ultralytics": (
            [
                r"C:\models\ultralytics\bbox",
                r"C:\models\ultralytics\segm",
                r"C:\models\ultralytics\yolo",
            ],
            set(),
        )
    }
    folder_paths.get_folder_paths.side_effect = lambda category: (
        folder_paths.folder_names_and_paths.get(category, ([], set()))[0]
    )

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/root-directories")
        ](_request())

    roots = json.loads(response.text)
    assert roots["ultralytics"] == [r"C:\models\ultralytics"]
    values["get_default_root_for_category"].assert_called_once_with(
        "ultralytics",
        {},
    )


@pytest.mark.asyncio
async def test_root_directories_resolves_aliases_and_preserves_extra_categories():
    checkpoint_directory = r"C:\models\checkpoints"
    extra_directory = r"C:\models\extra"
    handlers, _ = _build_routes(
        TEMPLATE_KEY_ALIASES={"custom_category": ("checkpoints",)},
        get_enabled_download_categories=MagicMock(
            return_value=["custom_category"]
        ),
    )
    folder_paths = MagicMock()
    folder_paths.folder_names_and_paths = {
        "checkpoints": ([checkpoint_directory], set()),
        "extra": ([extra_directory], set()),
    }
    folder_paths.get_folder_paths.side_effect = lambda category: (
        folder_paths.folder_names_and_paths.get(category, ([], set()))[0]
    )

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/root-directories")
        ](_request())

    roots = json.loads(response.text)
    assert roots["custom_category"] == [checkpoint_directory]
    assert roots["extra"] == [extra_directory]



@pytest.mark.asyncio
async def test_capabilities_route_returns_optional_sources_and_node_rules():
    handlers, values = _build_routes()

    with patch(
        "core.workflow_analyzer.NODE_TYPE_MODEL_WIDGET_CATEGORIES",
        {"CheckpointLoaderSimple": ["checkpoints"]},
    ):
        response = await handlers[("GET", "/model_resolver/capabilities")](
            _request()
        )

    body = json.loads(response.text)
    assert body == {
        "sources": {
            "civarchive": False,
            "lora_manager_archive": False,
        },
        "node_rules": {"CheckpointLoaderSimple": ["checkpoints"]},
    }
    values["is_civarchive_available"].assert_called_once_with()
    values["is_lora_manager_archive_available"].assert_called_once_with()


@pytest.mark.asyncio
async def test_subfolders_route_returns_empty_for_unknown_category(tmp_path):
    handlers, values = _build_routes(
        get_category_folder_keys=MagicMock(),
        normalize_download_category=lambda category: "unknown",
    )
    folder_paths = SimpleNamespace(folder_names_and_paths={})

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/subfolders/{category}")
        ](_request("not-a-category"))

    assert json.loads(response.text) == []
    values["get_category_folder_keys"].assert_not_called()


@pytest.mark.asyncio
async def test_subfolders_route_logs_and_returns_empty_for_unavailable_category():
    get_category_folder_keys = MagicMock(return_value=["checkpoints"])
    handlers, values = _build_routes(
        get_category_folder_keys=get_category_folder_keys
    )
    folder_paths = SimpleNamespace(folder_names_and_paths={"loras": ([], set())})

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/subfolders/{category}")
        ](_request("checkpoints"))

    assert json.loads(response.text) == []
    values["self"].logger.debug.assert_called_once()


@pytest.mark.asyncio
async def test_subfolders_route_ignores_invalid_and_unresolvable_entries(tmp_path):
    base_directory = Path(tmp_path) / "checkpoints"
    base_directory.mkdir()
    missing_directory = Path(tmp_path) / "missing"
    folder_paths = MagicMock()
    folder_paths.folder_names_and_paths = {
        "checkpoints": (
            [str(base_directory), "", str(missing_directory)],
            set(),
        )
    }
    folder_paths.get_folder_paths.side_effect = lambda category: (
        folder_paths.folder_names_and_paths.get(category, ([], set()))[0]
    )
    folder_paths.get_filename_list.return_value = [
        None,
        "model.safetensors",
        "nested/model.safetensors",
    ]
    folder_paths.get_full_path.side_effect = RuntimeError("not indexed")
    handlers, _ = _build_routes()

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/subfolders/{category}")
        ](_request())

    assert json.loads(response.text) == [
        {
            "value": "nested",
            "label": "nested",
            "base_directory": "",
        }
    ]


@pytest.mark.asyncio
async def test_subfolders_route_discovers_nested_directories(tmp_path):
    base_directory = Path(tmp_path) / "checkpoints"
    nested_directory = base_directory / "character" / "pony"
    nested_directory.mkdir(parents=True)
    (base_directory / "character" / "model.safetensors").touch()

    folder_paths = MagicMock()
    folder_paths.folder_names_and_paths = {
        "checkpoints": ([str(base_directory)], set())
    }
    folder_paths.get_folder_paths.side_effect = lambda category: (
        folder_paths.folder_names_and_paths.get(category, ([], set()))[0]
    )
    folder_paths.get_filename_list.return_value = [
        "character/model.safetensors"
    ]
    folder_paths.get_full_path.side_effect = (
        lambda _category, relative_path: str(base_directory / relative_path)
    )
    values = {
        "get_category_folder_keys": MagicMock(return_value=["checkpoints"]),
        "get_comfy_root_path": MagicMock(return_value=str(tmp_path)),
        "get_default_root_for_category": MagicMock(return_value=None),
        "get_download_directory": MagicMock(return_value=str(base_directory)),
    }
    handlers, _ = _build_routes(**values)

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[
            ("GET", "/model_resolver/subfolders/{category}")
        ](_request())

    items = json.loads(response.text)
    assert [item["value"] for item in items] == [
        "character",
        "character/pony",
    ]
    assert all(item["base_directory"] == str(base_directory) for item in items)

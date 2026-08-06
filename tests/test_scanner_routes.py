import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web

from core.path_utils import is_path_within
from core.routes.context import RouteContext
from core.routes.directories import register_directory_routes
from core.routes.metadata import register_metadata_routes
from core.type_utils import to_bool, to_int


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


def _build_metadata_routes():
    routes = _Routes()
    values = {
        "asyncio": asyncio,
        "audit_metadata_sizes": MagicMock(return_value={}),
        "build_missing_local_metadata": MagicMock(return_value={}),
        "cancel_progress_response": MagicMock(),
        "get_metadata_build_capabilities": MagicMock(return_value={}),
        "get_model_files": MagicMock(
            return_value=[{"filename": "model.safetensors"}]
        ),
        "infer_download_path_templates": MagicMock(return_value=[]),
        "get_progress_response": MagicMock(),
        "invalidate_local_hash_match_cache": MagicMock(),
        "json_api_endpoint": _json_api_endpoint,
        "normalize_metadata_build_mode": MagicMock(return_value="fresh"),
        "routes": routes,
        "run_in_background_thread": MagicMock(),
        "self": SimpleNamespace(
            metadata_builder_progress=MagicMock(),
            _update_metadata_build_progress=MagicMock(),
        ),
        "to_bool": to_bool,
        "to_int": to_int,
        "web": web,
    }
    register_metadata_routes(RouteContext(values))
    return routes.handlers, values


def _build_directory_routes():
    routes = _Routes()
    values = {
        "TEMPLATE_KEY_ALIASES": {},
        "asyncio": asyncio,
        "dedupe_local_base_directories": MagicMock(
            side_effect=lambda paths, **_kwargs: paths
        ),
        "get_category_folder_keys": MagicMock(return_value=["checkpoints"]),
        "get_comfy_root_path": MagicMock(return_value=r"C:\ComfyUI"),
        "get_default_root_for_category": MagicMock(return_value=None),
        "get_download_directory": MagicMock(return_value=r"C:\models"),
        "get_enabled_download_categories": MagicMock(
            side_effect=lambda categories: categories
        ),
        "get_local_path_identity": MagicMock(),
        "is_path_within": is_path_within,
        "get_model_files": MagicMock(
            return_value=[{"filename": "model.safetensors"}]
        ),
        "infer_download_path_templates": MagicMock(
            return_value=[{"category": "checkpoints"}]
        ),
        "invalidate_local_hash_match_cache": MagicMock(),
        "is_civarchive_available": MagicMock(return_value=False),
        "is_lora_manager_archive_available": MagicMock(return_value=False),
        "json_api_endpoint": _json_api_endpoint,
        "load_resolver_settings": MagicMock(return_value={}),
        "normalize_download_category": MagicMock(
            side_effect=lambda category: category
        ),
        "prefer_local_base_directory": MagicMock(),
        "register_version_routes": MagicMock(),
        "routes": routes,
        "self": SimpleNamespace(logger=MagicMock()),
        "split_path_segments": MagicMock(return_value=[]),
        "to_bool": to_bool,
        "web": web,
    }
    register_directory_routes(RouteContext(values))
    return routes.handlers, values


def _request(query=None):
    return SimpleNamespace(query=query or {}, match_info={})


@pytest.mark.asyncio
async def test_models_route_forwards_force_rescan_and_invalidates_hash_cache():
    handlers, values = _build_metadata_routes()
    handler = handlers[("GET", "/model_resolver/models")]

    response = await handler(_request({"force": "1"}))

    assert json.loads(response.text) == [{"filename": "model.safetensors"}]
    values["invalidate_local_hash_match_cache"].assert_called_once_with()
    values["get_model_files"].assert_called_once_with(force_rescan=True)


@pytest.mark.asyncio
async def test_path_suggestions_route_scans_and_infers_in_background():
    handlers, values = _build_directory_routes()
    handler = handlers[("GET", "/model_resolver/path-template-suggestions")]
    base_models = [{"name": "SDXL"}]

    with patch(
        "core.sources.popular.get_base_models_config",
        return_value=base_models,
    ):
        response = await handler(_request({"force": "1"}))

    assert json.loads(response.text) == [{"category": "checkpoints"}]
    values["get_model_files"].assert_called_once_with(True)
    values["infer_download_path_templates"].assert_called_once_with(
        [{"filename": "model.safetensors"}],
        base_models,
    )

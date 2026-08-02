import asyncio
import importlib.util
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from aiohttp import web

from core.routes import base_models


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


def _identity_endpoint(_name, **_kwargs):
    return lambda handler: handler


@pytest.mark.asyncio
async def test_base_model_routes_return_configured_data_and_status(monkeypatch):
    routes = _Routes()
    config = {"base_models": [{"name": "SDXL"}]}
    status = {"is_up_to_date": True}
    monkeypatch.setattr(base_models, "get_base_models_config", lambda: config)
    monkeypatch.setattr(base_models, "get_base_models_status", lambda check: status)
    base_models.register_base_model_routes(routes, web, _identity_endpoint)

    config_response = await routes.handlers[("GET", "/model_resolver/base-models")](
        SimpleNamespace(query={})
    )
    status_response = await routes.handlers[
        ("GET", "/model_resolver/base-models/status")
    ](SimpleNamespace(query={"check_remote": "1"}))

    assert config_response.status == 200
    assert config_response.text == '{"base_models": [{"name": "SDXL"}]}'
    assert status_response.status == 200
    assert status_response.text == '{"is_up_to_date": true}'


@pytest.mark.asyncio
async def test_base_model_update_route_runs_in_background_thread(monkeypatch):
    routes = _Routes()
    update_result = {"updated": True}
    monkeypatch.setattr(
        base_models,
        "update_base_models_from_remote",
        lambda: update_result,
    )
    monkeypatch.setattr(
        asyncio,
        "to_thread",
        AsyncMock(return_value=update_result),
    )
    base_models.register_base_model_routes(routes, web, _identity_endpoint)

    response = await routes.handlers[("POST", "/model_resolver/base-models/update")](
        SimpleNamespace()
    )

    assert response.status == 200
    assert response.text == '{"updated": true}'


def test_node_definitions_support_the_comfyui_v3_api_branch():
    class FakeComfyNode:
        pass

    class FakeComfyExtension:
        pass

    class FakeNodeOutput:
        pass

    class FakeSchema:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    fake_io = SimpleNamespace(
        ComfyNode=FakeComfyNode,
        NodeOutput=FakeNodeOutput,
        Schema=FakeSchema,
    )
    fake_comfy_api = ModuleType("comfy_api")
    fake_comfy_api.__path__ = []
    fake_latest = ModuleType("comfy_api.latest")
    fake_latest.ComfyExtension = FakeComfyExtension
    fake_latest.io = fake_io
    fake_comfy_api.latest = fake_latest

    module_name = "core.node_definitions_v3_test"
    module_path = "core/node_definitions.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(
        sys.modules,
        {"comfy_api": fake_comfy_api, "comfy_api.latest": fake_latest},
    ):
        spec.loader.exec_module(module)

    assert issubclass(module.ModelResolverDependencyNode, FakeComfyNode)
    assert issubclass(module.ModelResolverNodeExtension, FakeComfyExtension)
    assert module.ModelResolverDependencyNode.define_schema().kwargs["node_id"] == (
        "ModelResolverDependency"
    )
    assert isinstance(module.ModelResolverDependencyNode.execute(), FakeNodeOutput)

import importlib
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

PACKAGE_NAME = "comfyui-model-resolver"
registry_module = importlib.import_module(
    f"{PACKAGE_NAME}.core.routes.registry"
)
base_models_module = importlib.import_module(
    f"{PACKAGE_NAME}.core.routes.base_models"
)


class RecordingRoutes:
    """Minimal PromptServer route registry for integration tests."""

    def __init__(self):
        self.registered = {}

    def _decorator(self, method, path):
        def register(handler):
            self.registered[(method, path)] = handler
            return handler

        return register

    def get(self, path):
        return self._decorator("GET", path)

    def post(self, path):
        return self._decorator("POST", path)


def _make_extension():
    return SimpleNamespace(
        routes_setup=False,
        logger=MagicMock(),
        analysis_progress=MagicMock(),
        hash_tracker=MagicMock(),
        loaded_progress=MagicMock(),
        metadata_builder_progress=MagicMock(),
        search_tracker=MagicMock(),
        search_result_timestamps={},
        _update_analysis_progress=MagicMock(),
        _update_loaded_progress=MagicMock(),
        _update_metadata_build_progress=MagicMock(),
    )


def _install_prompt_server(monkeypatch, routes, instance=True):
    server_module = ModuleType("server")
    server_module.PromptServer = SimpleNamespace(
        instance=SimpleNamespace(routes=routes) if instance else None
    )
    monkeypatch.setitem(sys.modules, "server", server_module)


@pytest.fixture
def route_environment(monkeypatch):
    routes = RecordingRoutes()
    _install_prompt_server(monkeypatch, routes)
    return _make_extension(), routes


def test_register_routes_registers_each_route_family(route_environment):
    extension, routes = route_environment

    result = registry_module.register_routes(extension)

    assert result is True
    assert extension.routes_setup is True
    assert {
        ("GET", "/model_resolver/base-models"),
        ("POST", "/model_resolver/analyze"),
        ("POST", "/model_resolver/local-model-hashes"),
        ("POST", "/model_resolver/civitai-search"),
        ("POST", "/model_resolver/search"),
        ("POST", "/model_resolver/download"),
        ("GET", "/model_resolver/directories"),
        ("GET", "/model_resolver/settings"),
        ("GET", "/model_resolver/version"),
    }.issubset(routes.registered)


def test_register_routes_is_idempotent(route_environment):
    extension, routes = route_environment

    assert registry_module.register_routes(extension) is True
    registered_once = dict(routes.registered)

    assert registry_module.register_routes(extension) is None

    assert routes.registered == registered_once
    extension.logger.info.assert_called_once_with(
        "Model Resolver: API routes registered successfully"
    )


def test_register_routes_returns_false_when_prompt_server_is_not_ready(
    monkeypatch,
):
    routes = RecordingRoutes()
    _install_prompt_server(monkeypatch, routes, instance=False)
    extension = _make_extension()

    result = registry_module.register_routes(extension)

    assert result is False
    assert extension.routes_setup is False
    assert routes.registered == {}
    extension.logger.debug.assert_called_once_with(
        "Model Resolver: PromptServer not available yet"
    )


def test_register_routes_keeps_setup_flag_false_when_registration_fails(
    monkeypatch,
    route_environment,
):
    extension, _ = route_environment
    monkeypatch.setattr(
        base_models_module,
        "register_base_model_routes",
        MagicMock(side_effect=RuntimeError("route registration failed")),
    )

    result = registry_module.register_routes(extension)

    assert result is False
    assert extension.routes_setup is False
    extension.logger.error.assert_called_once()


def test_register_routes_skips_optional_download_routes_when_unavailable(
    monkeypatch,
    route_environment,
):
    extension, routes = route_environment
    download_api_module_name = f"{PACKAGE_NAME}.core.download.api"
    monkeypatch.setitem(sys.modules, download_api_module_name, None)

    result = registry_module.register_routes(extension)

    assert result is True
    assert extension.routes_setup is True
    assert ("POST", "/model_resolver/analyze") in routes.registered
    assert ("POST", "/model_resolver/civitai-search") in routes.registered
    assert ("GET", "/model_resolver/settings") in routes.registered
    assert ("POST", "/model_resolver/search") not in routes.registered
    assert ("POST", "/model_resolver/download") not in routes.registered
    assert (
        "POST",
        "/model_resolver/clear-search-cache",
    ) not in routes.registered

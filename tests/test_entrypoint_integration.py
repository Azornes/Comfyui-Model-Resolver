import json
import sys
from types import ModuleType, SimpleNamespace

import pytest

from core import version as version_service
from core.extension import ModelResolverExtension


class _RecordingRoutes:
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


@pytest.mark.asyncio
async def test_extension_entrypoint_registers_routes_and_serves_version(monkeypatch):
    routes = _RecordingRoutes()
    server_module = ModuleType("server")
    server_module.PromptServer = SimpleNamespace(
        instance=SimpleNamespace(routes=routes)
    )
    monkeypatch.setitem(sys.modules, "server", server_module)
    monkeypatch.setattr(
        version_service,
        "_get_project_version_info",
        lambda: {"version": "1.1.0", "latest_version": "1.1.0"},
    )

    extension = ModelResolverExtension()
    assert extension.setup_routes() is True
    assert extension.routes_setup is True
    assert ("GET", "/model_resolver/version") in routes.registered
    assert ("POST", "/model_resolver/analyze") in routes.registered

    response = await routes.registered[("GET", "/model_resolver/version")](
        SimpleNamespace()
    )

    assert response.status == 200
    assert json.loads(response.text) == {
        "version": "1.1.0",
        "latest_version": "1.1.0",
    }

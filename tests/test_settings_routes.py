import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.log_system import LogLevel
from core.routes import settings as settings_routes
from core.services.settings_service import (
    _backend_log_sort_key,
    _collect_backend_log_files,
    _log_level_setting,
    build_backend_log_export,
)


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


def _request(payload):
    return SimpleNamespace(json=AsyncMock(return_value=payload))


def _register(monkeypatch, loaded=None, saved=None):
    routes = _Routes()
    load_settings = MagicMock(
        return_value=loaded or {"backend_logs_enabled": True}
    )
    save_settings = MagicMock(
        return_value=saved or {"backend_logs_enabled": True}
    )
    apply_logging = MagicMock()
    monkeypatch.setattr(settings_routes, "load_resolver_settings", load_settings)
    monkeypatch.setattr(settings_routes, "save_resolver_settings", save_settings)
    monkeypatch.setattr(
        settings_routes,
        "_apply_backend_logging_settings",
        apply_logging,
    )
    settings_routes.register_settings_routes(routes, web, _json_api_endpoint)
    return routes.handlers, load_settings, save_settings, apply_logging


@pytest.mark.asyncio
async def test_settings_routes_return_schema_and_persist_valid_payload(monkeypatch):
    handlers, load_settings, save_settings, apply_logging = _register(
        monkeypatch,
        loaded={"download_backend": "python"},
        saved={"download_backend": "aria2"},
    )

    get_response = await handlers[("GET", "/model_resolver/settings")](
        SimpleNamespace()
    )
    post_response = await handlers[("POST", "/model_resolver/settings")](
        _request({"download_backend": "aria2"})
    )

    assert json.loads(get_response.text)["settings"] == {
        "download_backend": "python"
    }
    assert json.loads(get_response.text)["schema"]
    assert post_response.status == 200
    assert json.loads(post_response.text) == {"success": True}
    save_settings.assert_called_once_with({"download_backend": "aria2"})
    assert load_settings.call_count == 2
    assert apply_logging.call_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [None, [], "settings"])
async def test_settings_route_rejects_non_object_payload(monkeypatch, payload):
    handlers, _, save_settings, _ = _register(monkeypatch)

    response = await handlers[("POST", "/model_resolver/settings")](
        _request(payload)
    )

    assert response.status == 400
    assert json.loads(response.text) == {"error": "Expected JSON object"}
    save_settings.assert_not_called()


@pytest.mark.asyncio
async def test_backend_log_export_includes_rotated_files_and_skips_unrelated_files(
    monkeypatch,
    tmp_path,
):
    (tmp_path / "azlogs_MResolver.log").write_text("current log", encoding="utf-8")
    (tmp_path / "azlogs_MResolver.1.log").write_text(
        "rotated log", encoding="utf-8"
    )
    (tmp_path / "azlogs_MResolver.log.1").write_text(
        "legacy log", encoding="utf-8"
    )
    (tmp_path / "other.txt").write_text("ignored", encoding="utf-8")
    backend_controller = SimpleNamespace(
        config={"log_dir": str(tmp_path), "log_to_file": True},
        file_handlers={},
    )
    monkeypatch.setattr(
        settings_routes,
        "backend_log_controller",
        backend_controller,
    )
    handlers, _, _, _ = _register(monkeypatch)

    response = await handlers[("GET", "/model_resolver/logs/backend/export")](
        SimpleNamespace()
    )

    assert response.status == 200
    assert response.content_type == "text/plain"
    assert "current log" in response.text
    assert "rotated log" in response.text
    assert "legacy log" not in response.text
    assert "ignored" not in response.text
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_backend_log_export_reports_missing_directory(monkeypatch, tmp_path):
    backend_controller = SimpleNamespace(
        config={
            "log_dir": os.path.join(str(tmp_path), "missing"),
            "log_to_file": False,
        },
        file_handlers={},
    )
    monkeypatch.setattr(
        settings_routes,
        "backend_log_controller",
        backend_controller,
    )
    handlers, _, _, _ = _register(monkeypatch)

    response = await handlers[("GET", "/model_resolver/logs/backend/export")](
        SimpleNamespace()
    )

    assert "No backend log files found." in response.text
    assert "File logging: False" in response.text


def test_settings_service_handles_flush_read_and_sorting_edge_cases(
    monkeypatch,
    tmp_path,
):
    (tmp_path / "azlogs_MResolver.log").write_text("current", encoding="utf-8")
    (tmp_path / "azlogs_Directory.log").mkdir()
    handler = MagicMock()
    handler.flush.side_effect = OSError("flush failed")
    backend_controller = SimpleNamespace(
        config={"log_dir": str(tmp_path), "log_to_file": True},
        file_handlers={"main": handler},
    )

    files = _collect_backend_log_files(str(tmp_path))
    assert files == [os.path.abspath(tmp_path / "azlogs_MResolver.log")]
    assert _backend_log_sort_key("unrelated.txt") == ("unrelated.txt", 999)
    assert _log_level_setting("not-a-level", default="INFO") == LogLevel.INFO

    with monkeypatch.context() as patcher:
        patcher.setattr(
            "core.services.settings_service._collect_backend_log_files",
            lambda _log_dir: files,
        )
        patcher.setattr(
            "core.services.settings_service.os",
            SimpleNamespace(
                path=os.path,
                stat=MagicMock(side_effect=OSError("read failed")),
                listdir=os.listdir,
            ),
        )
        content = build_backend_log_export(backend_controller)

    handler.flush.assert_called_once_with()
    assert "Could not read log file: read failed" in content

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.path_utils import get_filename_from_path
from core.routes.context import RouteContext
from core.routes.downloads import register_download_routes
from core.type_utils import to_bool, to_int


class _UnsafeUrlError(Exception):
    pass


class _Aria2InstallError(Exception):
    pass


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


def _build_download_routes(overrides=None):
    routes = _Routes()
    extension = SimpleNamespace(logger=MagicMock())
    sanitize_download_filename = MagicMock(
        side_effect=lambda filename: str(filename).strip()
    )

    def host_matches_domain(host, *domains):
        return any(host == domain or host.endswith(f".{domain}") for domain in domains)

    def first_non_empty(*values):
        return next((value for value in values if value not in (None, "")), "")

    values = {
        "Aria2InstallError": _Aria2InstallError,
        "UnsafeUrlError": _UnsafeUrlError,
        "asyncio": asyncio,
        "cancel_download": MagicMock(),
        "clear_completed_downloads": MagicMock(),
        "first_non_empty": first_non_empty,
        "get_all_progress": MagicMock(return_value={"one": {"status": "done"}}),
        "get_aria2_status": MagicMock(return_value={"status": "running"}),
        "get_civarchive_model_details": MagicMock(
            return_value={"name": "Archive model"}
        ),
        "get_civitai_model_details": MagicMock(
            return_value={"name": "CivitAI model"}
        ),
        "get_default_root_for_category": MagicMock(return_value=r"C:\base"),
        "get_download_directory": MagicMock(return_value=r"C:\models"),
        "get_filename_from_path": get_filename_from_path,
        "get_override_settings_from_request": AsyncMock(
            return_value={"aria2c_path": "aria2c"}
        ),
        "get_progress": MagicMock(return_value=None),
        "host_matches_domain": host_matches_domain,
        "install_aria2_engine": MagicMock(
            return_value={"success": True, "aria2c_path": r"C:\tools\aria2c.exe"}
        ),
        "is_allowed_model_download_filename": lambda filename: filename.endswith(
            ".safetensors"
        ),
        "json_api_endpoint": lambda _name, **_kwargs: lambda handler: handler,
        "load_resolver_settings": MagicMock(
            return_value={"download_backend": "aria2"}
        ),
        "normalize_download_category": lambda category: str(category).lower(),
        "pause_download": MagicMock(return_value={"success": True}),
        "resolve_download_subfolder": MagicMock(
            side_effect=lambda category, subfolder, metadata, settings: subfolder
        ),
        "resume_download": MagicMock(return_value={"success": True}),
        "routes": routes,
        "sanitize_download_filename": sanitize_download_filename,
        "save_resolver_settings": MagicMock(return_value={"saved": True}),
        "self": extension,
        "split_path_segments": lambda value: [
            part for part in str(value).replace("\\", "/").split("/") if part
        ],
        "start_aria2_daemon": MagicMock(return_value={"success": True}),
        "start_background_download": MagicMock(return_value="download-1"),
        "stop_aria2_daemon": MagicMock(return_value={"success": True}),
        "to_bool": to_bool,
        "to_int": to_int,
        "validate_public_http_url": MagicMock(
            side_effect=lambda url: url
        ),
        "web": web,
    }
    if overrides:
        values.update(overrides)

    register_download_routes(RouteContext(values))
    return routes.handlers, values


def _request(payload=None, *, download_id="download-1", method="POST"):
    return SimpleNamespace(
        json=AsyncMock(return_value=payload),
        match_info={"download_id": download_id},
        method=method,
    )


@pytest.mark.asyncio
async def test_download_route_builds_metadata_headers_and_target_path():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]
    payload = {
        "url": "https://civitai.com/api/download/models/123",
        "filename": "model.safetensors",
        "category": "Checkpoints",
        "subfolder": "character/pony",
        "path_metadata": {
            "source": "civitai",
            "model_id": 123,
            "version_id": 456,
        },
        "civitai_key": "api-key",
        "civitai_session_token": "session-token",
    }

    response = await handler(_request(payload))

    body = json.loads(response.text)
    assert response.status == 200
    assert body["success"] is True
    assert body["download_id"] == "download-1"
    assert body["category"] == "checkpoints"
    assert body["directory"] == r"C:\models\character\pony"
    assert body["path"] == r"C:\models\character\pony\model.safetensors"
    values["start_background_download"].assert_called_once()
    download_call = values["start_background_download"].call_args.kwargs
    assert "token=api-key" in download_call["url"]
    assert download_call["headers"] == {
        "Cookie": "__Secure-civitai-token=session-token"
    }
    assert download_call["metadata"]["civitai_details"] == {
        "name": "CivitAI model"
    }
    values["get_civitai_model_details"].assert_called_once_with(
        123,
        456,
        "api-key",
    )


@pytest.mark.asyncio
async def test_download_route_rejects_missing_unsafe_and_unsupported_inputs():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]

    response = await handler(_request({}))
    assert response.status == 400
    assert json.loads(response.text) == {"error": "URL is required"}

    values["validate_public_http_url"].side_effect = _UnsafeUrlError("blocked")
    response = await handler(_request({"url": "http://127.0.0.1/model.safetensors"}))
    assert response.status == 400
    assert json.loads(response.text) == {"error": "blocked"}

    values["validate_public_http_url"].side_effect = lambda url: url
    values["sanitize_download_filename"].side_effect = lambda filename: ""
    response = await handler(
        _request({"url": "https://example.com/download/model.safetensors"})
    )
    assert response.status == 400
    assert json.loads(response.text) == {"error": "Could not determine filename"}

    values["sanitize_download_filename"].side_effect = lambda filename: "model.ckpt"
    response = await handler(
        _request(
            {
                "url": "https://example.com/download/model.ckpt",
                "filename": "model.ckpt",
            }
        )
    )
    assert response.status == 400
    assert json.loads(response.text) == {
        "error": "Unsupported model file extension"
    }


@pytest.mark.asyncio
async def test_download_route_supports_huggingface_headers_and_optional_inputs():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]

    response = await handler(
        _request(
            {
                "url": "https://huggingface.co/org/repo/resolve/main/model.safetensors",
                "path_metadata": ["invalid"],
                "metadata": ["invalid"],
                "base_directory": r"C:\custom",
                "hf_token": "hf-token",
            }
        )
    )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["filename"] == "model.safetensors"
    assert body["directory"] == r"C:\models"
    download_call = values["start_background_download"].call_args.kwargs
    assert download_call["headers"] == {"Authorization": "Bearer hf-token"}
    assert download_call["metadata"]["source"] == "huggingface"
    values["get_default_root_for_category"].assert_not_called()


@pytest.mark.asyncio
async def test_download_route_derives_encoded_filename_from_url_path():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]

    response = await handler(
        _request(
            {
                "url": "https://example.com/download/model%20name.safetensors",
            }
        )
    )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["filename"] == "model name.safetensors"
    assert values["start_background_download"].call_args.kwargs["filename"] == (
        "model name.safetensors"
    )


@pytest.mark.asyncio
async def test_download_route_handles_existing_civitai_token_and_path_errors():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]
    values["get_civitai_model_details"].return_value = None
    values["get_download_directory"].side_effect = RuntimeError("path failure")

    response = await handler(
        _request(
            {
                "url": "https://civitai.com/api/download/models/123?token=existing",
                "filename": "model.safetensors",
                "path_metadata": {"source": "civitai", "model_id": 123},
                "civitai_key": "unused-key",
            }
        )
    )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["directory"] == ""
    assert body["path"] == ""
    download_call = values["start_background_download"].call_args.kwargs
    assert download_call["url"].endswith("token=existing")
    assert download_call["headers"] is None
    values["get_civitai_model_details"].assert_called_once_with(
        123,
        None,
        "unused-key",
    )


@pytest.mark.asyncio
async def test_download_route_handles_civarchive_metadata_and_lookup_failures():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/download")]
    payload = {
        "url": "https://example.com/model.safetensors",
        "filename": "model.safetensors",
        "download_metadata": {
            "details_source": "civarchive",
            "model_id": 321,
            "version_id": 654,
        },
    }

    response = await handler(_request(payload))
    body = json.loads(response.text)
    assert response.status == 200
    assert body["success"] is True
    assert values["get_civarchive_model_details"].call_args.args == (321, 654)
    first_call_metadata = values["start_background_download"].call_args.kwargs[
        "metadata"
    ]
    assert first_call_metadata["civitai_details"] == {"name": "Archive model"}

    values["get_civarchive_model_details"].side_effect = RuntimeError(
        "archive unavailable"
    )
    response = await handler(_request(payload))
    assert response.status == 200
    assert values["self"].logger.warning.call_count == 1


@pytest.mark.asyncio
async def test_aria2_install_handles_invalid_and_non_mapping_payloads():
    handlers, values = _build_download_routes()
    handler = handlers[("POST", "/model_resolver/aria2/install")]

    invalid_json_request = _request()
    invalid_json_request.json = AsyncMock(side_effect=ValueError("invalid json"))
    response = await handler(invalid_json_request)
    assert response.status == 200

    response = await handler(_request(["not", "a", "mapping"]))
    assert response.status == 200
    assert values["install_aria2_engine"].call_args_list[-2].args == (False,)
    assert values["install_aria2_engine"].call_args_list[-1].args == (False,)


@pytest.mark.asyncio
async def test_download_control_routes_preserve_progress_and_status_codes():
    handlers, values = _build_download_routes()
    values["get_progress"].return_value = {"status": "downloading", "progress": 50}

    progress_handler = handlers[("GET", "/model_resolver/progress/{download_id}")]
    response = await progress_handler(_request(download_id="progress-1", method="GET"))
    assert json.loads(response.text) == {"status": "downloading", "progress": 50}
    values["get_progress"].assert_called_once_with("progress-1")

    all_progress_handler = handlers[("GET", "/model_resolver/progress")]
    response = await all_progress_handler(_request(method="GET"))
    assert json.loads(response.text) == {"one": {"status": "done"}}

    cancel_handler = handlers[("POST", "/model_resolver/cancel/{download_id}")]
    response = await cancel_handler(_request(download_id="cancel-1"))
    assert json.loads(response.text) == {"success": True}
    values["cancel_download"].assert_called_once_with("cancel-1")

    pause_handler = handlers[("POST", "/model_resolver/pause/{download_id}")]
    response = await pause_handler(_request(download_id="pause-1"))
    assert response.status == 200
    assert json.loads(response.text) == {"success": True}
    values["pause_download"].assert_called_once_with("pause-1")

    values["pause_download"].return_value = {"success": False, "error": "not aria2"}
    response = await pause_handler(_request(download_id="pause-2"))
    assert response.status == 400

    resume_handler = handlers[("POST", "/model_resolver/resume/{download_id}")]
    response = await resume_handler(_request(download_id="resume-1"))
    assert response.status == 200
    assert json.loads(response.text) == {"success": True}
    values["resume_download"].assert_called_once_with("resume-1")

    values["resume_download"].return_value = {"success": False, "error": "not aria2"}
    response = await resume_handler(_request(download_id="resume-2"))
    assert response.status == 400
    assert json.loads(response.text) == {"success": False, "error": "not aria2"}

    clear_handler = handlers[("POST", "/model_resolver/clear_completed_downloads")]
    response = await clear_handler(_request())
    assert json.loads(response.text) == {"success": True}
    values["clear_completed_downloads"].assert_called_once_with()


@pytest.mark.asyncio
async def test_aria2_routes_use_override_settings_and_map_failures():
    handlers, values = _build_download_routes()
    status_get = handlers[("GET", "/model_resolver/aria2/status")]
    status_post = handlers[("POST", "/model_resolver/aria2/status")]
    start_handler = handlers[("POST", "/model_resolver/aria2/start")]
    stop_get = handlers[("GET", "/model_resolver/aria2/stop")]
    install_handler = handlers[("POST", "/model_resolver/aria2/install")]

    response = await status_get(_request(method="GET"))
    assert json.loads(response.text) == {"status": "running"}
    response = await status_post(_request({}, method="POST"))
    assert json.loads(response.text) == {"status": "running"}
    assert values["get_aria2_status"].call_count == 2

    values["start_aria2_daemon"].return_value = {
        "success": True,
        "message": "started",
    }
    response = await start_handler(_request())
    assert response.status == 200
    assert json.loads(response.text) == {"success": True, "message": "started"}

    values["start_aria2_daemon"].return_value = {
        "success": False,
        "error": "cannot start",
    }
    response = await start_handler(_request())
    assert response.status == 400
    assert json.loads(response.text) == {"success": False, "error": "cannot start"}

    values["stop_aria2_daemon"].return_value = {
        "success": True,
        "message": "stopped",
    }
    response = await stop_get(_request(method="GET"))
    assert response.status == 200
    assert json.loads(response.text) == {"success": True, "message": "stopped"}

    values["stop_aria2_daemon"].return_value = {
        "success": False,
        "error": "not running",
    }
    response = await stop_get(_request(method="GET"))
    assert response.status == 400
    assert json.loads(response.text) == {"success": False, "error": "not running"}

    response = await install_handler(_request({"force": True}))
    assert json.loads(response.text)["success"] is True
    values["install_aria2_engine"].assert_called_once_with(True)
    values["save_resolver_settings"].assert_called_once_with(
        {
            "aria2c_path": r"C:\tools\aria2c.exe",
            "download_backend": "aria2",
        }
    )

    values["install_aria2_engine"].side_effect = _Aria2InstallError("install failed")
    response = await install_handler(_request({}))
    assert response.status == 500
    assert json.loads(response.text) == {
        "success": False,
        "error": "install failed",
    }
    values["self"].logger.warning.assert_called_once()

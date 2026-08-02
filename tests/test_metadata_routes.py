import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.routes.context import RouteContext
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


def _build_routes():
    routes = _Routes()
    metadata_progress = MagicMock()
    metadata_progress.is_cancelled.return_value = False
    extension = SimpleNamespace(
        metadata_builder_progress=metadata_progress,
        _update_metadata_build_progress=MagicMock(),
    )
    values = {
        "asyncio": asyncio,
        "audit_metadata_sizes": MagicMock(
            return_value={"stale": 1, "checked": 3}
        ),
        "build_missing_local_metadata": MagicMock(
            return_value={"created_metadata": 1}
        ),
        "cancel_progress_response": MagicMock(
            return_value={"success": True, "cancelled": True}
        ),
        "get_metadata_build_capabilities": MagicMock(
            return_value={"max_workers": 4}
        ),
        "get_model_files": MagicMock(return_value=[]),
        "get_progress_response": MagicMock(
            return_value={"status": "running"}
        ),
        "invalidate_local_hash_match_cache": MagicMock(),
        "infer_download_path_templates": MagicMock(),
        "json_api_endpoint": _json_api_endpoint,
        "normalize_metadata_build_mode": MagicMock(
            return_value="import_existing"
        ),
        "routes": routes,
        "run_in_background_thread": MagicMock(),
        "self": extension,
        "to_bool": to_bool,
        "to_int": to_int,
        "web": web,
    }
    register_metadata_routes(RouteContext(values))
    return routes.handlers, values


def _request(payload=None, *, can_read_body=True, progress_id="build-1"):
    return SimpleNamespace(
        can_read_body=can_read_body,
        json=AsyncMock(return_value=payload),
        match_info={"progress_id": progress_id},
        query={},
    )


@pytest.mark.asyncio
async def test_metadata_size_audit_forwards_payload_options():
    handlers, values = _build_routes()
    handler = handlers[("POST", "/model_resolver/metadata-size-audit")]

    response = await handler(
        _request(
            {
                "force_rescan": False,
                "worker_count": 2,
                "batch_size": 25,
            }
        )
    )

    assert json.loads(response.text) == {"stale": 1, "checked": 3}
    values["audit_metadata_sizes"].assert_called_once_with(
        force_rescan=False,
        worker_count=2,
        batch_size=25,
    )


@pytest.mark.asyncio
async def test_metadata_size_audit_uses_defaults_for_unreadable_body():
    handlers, values = _build_routes()
    handler = handlers[("POST", "/model_resolver/metadata-size-audit")]
    request = _request(can_read_body=False)

    await handler(request)

    request.json.assert_not_awaited()
    values["audit_metadata_sizes"].assert_called_once_with(
        force_rescan=True,
        worker_count=None,
        batch_size=None,
    )


@pytest.mark.asyncio
async def test_metadata_routes_handle_json_parse_failures():
    handlers, values = _build_routes()

    audit_request = _request()
    audit_request.json = AsyncMock(side_effect=ValueError("invalid json"))
    await handlers[("POST", "/model_resolver/metadata-size-audit")](
        audit_request
    )
    values["audit_metadata_sizes"].assert_called_once_with(
        force_rescan=True,
        worker_count=None,
        batch_size=None,
    )

    empty_body_request = _request(can_read_body=False)
    await handlers[("POST", "/model_resolver/metadata-build/start")](
        empty_body_request
    )
    values["normalize_metadata_build_mode"].assert_called_once_with(None)

    build_request = _request()
    build_request.json = AsyncMock(side_effect=ValueError("invalid json"))
    await handlers[("POST", "/model_resolver/metadata-build/start")](
        build_request
    )
    assert values["normalize_metadata_build_mode"].call_count == 2


@pytest.mark.asyncio
async def test_metadata_build_capabilities_progress_and_cancel_routes():
    handlers, values = _build_routes()

    capabilities = await handlers[
        ("GET", "/model_resolver/metadata-build/capabilities")
    ](_request())
    assert json.loads(capabilities.text) == {"max_workers": 4}

    progress_request = _request(progress_id="progress-1")
    progress = await handlers[
        ("GET", "/model_resolver/metadata-build/progress/{progress_id}")
    ](progress_request)
    assert progress == {"status": "running"}
    values["get_progress_response"].assert_called_once_with(
        values["self"].metadata_builder_progress,
        progress_request,
        not_found_status=404,
    )

    cancel_request = _request(progress_id="cancel-1")
    cancel = await handlers[
        ("POST", "/model_resolver/metadata-build/cancel/{progress_id}")
    ](cancel_request)
    assert cancel == {"success": True, "cancelled": True}
    values["cancel_progress_response"].assert_called_once_with(
        values["self"].metadata_builder_progress,
        cancel_request,
        cancel_message="Stopping metadata build...",
    )


@pytest.mark.asyncio
async def test_metadata_build_start_registers_task_and_updates_callbacks():
    handlers, values = _build_routes()
    captured = {}

    def capture_background_task(
        progress,
        progress_id,
        task,
        on_success,
        on_cancel,
        on_error,
        **kwargs,
    ):
        captured.update(
            progress=progress,
            progress_id=progress_id,
            task=task,
            on_success=on_success,
            on_cancel=on_cancel,
            on_error=on_error,
            kwargs=kwargs,
        )

    values["run_in_background_thread"].side_effect = capture_background_task
    handler = handlers[("POST", "/model_resolver/metadata-build/start")]

    response = await handler(
        _request(
            {
                "force_rescan": False,
                "worker_count": "3",
                "metadata_mode": "import_existing",
            }
        )
    )

    body = json.loads(response.text)
    progress_id = body["progress_id"]
    assert body == {
        "success": True,
        "progress_id": progress_id,
        "metadata_mode": "import_existing",
    }
    assert progress_id.startswith("metadata_build_")
    values["self"].metadata_builder_progress.cleanup.assert_called_once_with()
    assert captured["progress_id"] == progress_id
    assert captured["kwargs"] == {"error_log_msg": "Metadata build failed"}

    task_result = captured["task"]()
    assert task_result == {"created_metadata": 1}
    build_call = values["build_missing_local_metadata"].call_args.kwargs
    assert build_call["force_rescan"] is False
    assert build_call["worker_count"] == 3
    assert build_call["metadata_mode"] == "import_existing"
    assert captured["progress"] is values["self"].metadata_builder_progress

    progress_callback = build_call["progress_callback"]
    progress_callback({"percent": 45})
    values["self"]._update_metadata_build_progress.assert_called_once_with(
        progress_id,
        {"percent": 45},
    )
    assert build_call["is_cancelled"]() is False

    captured["on_success"]({"created_metadata": 2})
    captured["on_cancel"]({"cancelled": True})
    captured["on_error"](ValueError())
    updates = values["self"].metadata_builder_progress.update.call_args_list
    statuses = [call.kwargs["status"] for call in updates]
    assert statuses == ["queued", "done", "cancelled", "error"]
    assert updates[-1].kwargs["message"] == "Metadata build failed"


@pytest.mark.asyncio
async def test_metadata_build_start_normalizes_invalid_payload():
    handlers, values = _build_routes()
    handler = handlers[("POST", "/model_resolver/metadata-build/start")]

    response = await handler(_request(["not", "a", "mapping"]))

    assert json.loads(response.text)["success"] is True
    values["normalize_metadata_build_mode"].assert_called_once_with(None)
    build_call = values["build_missing_local_metadata"].call_args
    assert build_call is None

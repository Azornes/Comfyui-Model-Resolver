import asyncio
import json
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web

from core.path_utils import HashCalculationCancelled, normalize_absolute_path
from core.routes.context import RouteContext
from core.routes.hashes import register_hash_routes
from core.services.hash_service import HashService
from core.type_utils import normalize_sha256, to_bool, to_int


class _Routes:
    def __init__(self):
        self.handlers = {}

    def post(self, path):
        def decorator(handler):
            self.handlers[("POST", path)] = handler
            return handler

        return decorator

    def get(self, path):
        def decorator(handler):
            self.handlers[("GET", path)] = handler
            return handler

        return decorator


class _UnsupportedFileManagerPlatformError(Exception):
    pass


class _FileManagerUnavailableError(Exception):
    pass


class _FileManagerError(Exception):
    pass


def _build_hash_routes(overrides=None):
    routes = _Routes()
    hash_tracker = MagicMock()
    hash_tracker.is_cancelled.return_value = False
    extension = SimpleNamespace(
        hash_tracker=hash_tracker,
        logger=MagicMock(),
    )

    def run_in_background_thread(tracker, progress_id, task, on_success, on_cancel, **kwargs):
        try:
            on_success(task())
        except HashCalculationCancelled:
            on_cancel()

    values = {
        "FileManagerError": _FileManagerError,
        "FileManagerUnavailableError": _FileManagerUnavailableError,
        "MODEL_RESOLVER_METADATA_SCHEMA": "comfyui-model-resolver",
        "MODEL_RESOLVER_METADATA_SCHEMA_VERSION": 2,
        "UnsupportedFileManagerPlatformError": _UnsupportedFileManagerPlatformError,
        "asyncio": asyncio,
        "cancel_progress_response": MagicMock(
            return_value=web.json_response({"cancelled": True})
        ),
        "get_existing_model_preview_path": MagicMock(return_value=None),
        "get_filename_from_path": os.path.basename,
        "get_local_model_hash_metadata": MagicMock(
            return_value={"sha256": "a" * 64, "size": 123}
        ),
        "get_progress_response": MagicMock(
            return_value=web.json_response({"status": "running"})
        ),
        "get_safe_model_resolver_sidecar_path": lambda path: (
            f"{path}.modelresolver.json"
        ),
        "get_workflow_model_inventory": MagicMock(
            return_value={"model_refs": []}
        ),
        "is_path_in_configured_model_roots": MagicMock(return_value=True),
        "json_api_endpoint": lambda _name: lambda handler: handler,
        "load_resolver_settings": MagicMock(return_value={}),
        "normalize_file_manager_path": lambda path: str(path),
        "normalize_sha256": normalize_sha256,
        "open_in_file_manager": MagicMock(return_value={"opened": True}),
        "os": os,
        "read_json_safe": MagicMock(return_value={}),
        "resolver_bool_setting": lambda value, default=True: (
            default if value is None else bool(value)
        ),
        "routes": routes,
        "run_in_background_thread": run_in_background_thread,
        "search_local_matches_by_hash": MagicMock(return_value=[]),
        "self": extension,
        "time": __import__("time"),
        "to_bool": to_bool,
        "to_int": to_int,
        "web": web,
        "write_json_atomic": MagicMock(),
    }
    if overrides:
        values.update(overrides)

    register_hash_routes(RouteContext(values))
    return routes.handlers, values


def _request(payload):
    request = SimpleNamespace(json=AsyncMock(return_value=payload))
    return request


@pytest.mark.asyncio
async def test_local_model_hashes_uses_model_path_and_returns_metadata():
    handlers, values = _build_hash_routes()
    handler = handlers[("POST", "/model_resolver/local-model-hashes")]
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        response = await handler(_request({"model": {"path": model_path}}))

    assert response.status == 200
    assert json.loads(response.text) == {"sha256": "a" * 64, "size": 123}
    values["get_local_model_hash_metadata"].assert_called_once_with(
        os.path.realpath(os.path.abspath(os.path.normpath(model_path))),
        model={"path": model_path},
    )


def test_hash_service_path_normalization_uses_shared_helper_and_injected_path_module():
    _, values = _build_hash_routes()
    service = HashService(RouteContext(values))
    model_path = "models/checkpoints/../loras/model.safetensors"

    with patch(
        "core.path_utils.normalize_absolute_path",
        wraps=normalize_absolute_path,
    ) as normalize_path:
        result = service._normalize_path(model_path)

    assert result == normalize_absolute_path(model_path)
    normalize_path.assert_called_once_with(model_path, path_module=os.path)


@pytest.mark.asyncio
async def test_hash_routes_validate_local_metadata_and_preview_paths():
    handlers, values = _build_hash_routes()
    local_handler = handlers[("POST", "/model_resolver/local-model-hashes")]
    preview_handler = handlers[("GET", "/model_resolver/model-preview")]

    response = await local_handler(_request({}))
    assert response.status == 400

    values["is_path_in_configured_model_roots"].return_value = False
    response = await local_handler(_request({"path": "model.safetensors"}))
    assert response.status == 403

    response = await preview_handler(SimpleNamespace(query={}))
    assert response.status == 400

    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        preview_path = os.path.join(temp_dir, "model.png")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        with open(preview_path, "wb") as preview_file:
            preview_file.write(b"preview")

        values["is_path_in_configured_model_roots"].return_value = True
        response = await preview_handler(
            SimpleNamespace(query={"path": os.path.join(temp_dir, "missing.safetensors")})
        )
        assert response.status == 404

        response = await preview_handler(
            SimpleNamespace(
                method="HEAD",
                query={"path": os.path.join(temp_dir, "missing.safetensors")},
            )
        )
        assert response.status == 204

        values["get_existing_model_preview_path"].return_value = None
        response = await preview_handler(SimpleNamespace(query={"path": model_path}))
        assert response.status == 404

        response = await preview_handler(
            SimpleNamespace(method="HEAD", query={"path": model_path})
        )
        assert response.status == 204

        values["get_existing_model_preview_path"].return_value = preview_path
        values["is_path_in_configured_model_roots"].side_effect = [True, False]
        response = await preview_handler(SimpleNamespace(query={"path": model_path}))
        assert response.status == 403


@pytest.mark.asyncio
async def test_workflow_hashes_can_be_disabled_and_local_matches_require_hash():
    handlers, values = _build_hash_routes()
    workflow_handler = handlers[("POST", "/model_resolver/workflow-model-hashes")]
    matches_handler = handlers[("POST", "/model_resolver/local-matches-by-hash")]

    response = await workflow_handler(_request({"workflow": []}))
    assert response.status == 400

    values["load_resolver_settings"].return_value = {
        "workflow_hash_metadata_enabled": False
    }
    response = await workflow_handler(_request({"workflow": {}}))
    assert json.loads(response.text) == {
        "success": True,
        "enabled": False,
        "models": [],
        "by_node": {},
        "by_path": {},
        "count": 0,
    }

    response = await matches_handler(_request({"filename": "model.safetensors"}))
    assert response.status == 400


@pytest.mark.asyncio
async def test_workflow_model_hashes_skips_invalid_refs_and_deduplicates_models():
    refs = [
        {"exists": False, "full_path": "ignored.safetensors"},
        {
            "exists": True,
            "full_path": r"C:\models\one.safetensors",
            "original_path": "one.safetensors",
            "category": "checkpoints",
            "node_id": 1,
            "widget_index": 0,
            "node_type": "CheckpointLoaderSimple",
        },
        {
            "exists": True,
            "full_path": r"C:\models\one.safetensors",
            "original_path": "one.safetensors",
            "category": "checkpoints",
            "node_id": 1,
            "widget_index": 0,
            "node_type": "CheckpointLoaderSimple",
        },
        {"exists": True, "full_path": ""},
        {
            "exists": True,
            "full_path": r"C:\models\without-hash.safetensors",
            "original_path": "without-hash.safetensors",
        },
    ]
    get_metadata = MagicMock(
        side_effect=[
            {"sha256": "a" * 64, "size": 456},
            {"sha256": "a" * 64, "size": 456},
            {},
        ]
    )
    handlers, values = _build_hash_routes(
        {
            "get_workflow_model_inventory": MagicMock(
                return_value={"model_refs": refs}
            ),
            "get_local_model_hash_metadata": get_metadata,
        }
    )
    handler = handlers[("POST", "/model_resolver/workflow-model-hashes")]

    response = await handler(_request({"workflow": {"nodes": []}}))

    body = json.loads(response.text)
    assert response.status == 200
    assert body["count"] == 1
    assert body["models"][0]["sha256"] == "a" * 64
    assert body["by_node"]["1:0"]["filename"] == "one.safetensors"
    assert body["by_path"]["one.safetensors"]["size"] == 456
    assert values["get_workflow_model_inventory"].called


@pytest.mark.asyncio
async def test_local_matches_by_hash_normalizes_and_enriches_results():
    matches = [{"path": r"C:\models\local.safetensors"}]
    search_matches = MagicMock(return_value=matches)
    handlers, values = _build_hash_routes(
        {"search_local_matches_by_hash": search_matches}
    )
    handler = handlers[("POST", "/model_resolver/local-matches-by-hash")]
    sha256 = "b" * 64

    response = await handler(
        _request(
            {
                "hash": "sha256:" + sha256.upper(),
                "category": "checkpoints",
                "source": "Civit-AI",
                "filename": "remote.safetensors",
                "max_matches": "3",
                "force_rescan": "true",
            }
        )
    )

    body = json.loads(response.text)
    assert body["sha256"] == sha256
    assert body["local_hash_matches"] == [
        {
            "path": r"C:\models\local.safetensors",
            "hash_lookup_source": "civit_ai",
            "hash_lookup_filename": "remote.safetensors",
            "hash_lookup_sha256": sha256,
        }
    ]
    values["search_local_matches_by_hash"].assert_called_once_with(
        sha256,
        category="checkpoints",
        max_matches=3,
        force_rescan=True,
    )


@pytest.mark.asyncio
async def test_open_containing_folder_maps_file_manager_errors():
    handlers, values = _build_hash_routes()
    handler = handlers[("POST", "/model_resolver/open-containing-folder")]
    with tempfile.TemporaryDirectory() as temp_dir:
        target = os.path.join(temp_dir, "model.safetensors")
        with open(target, "wb") as model_file:
            model_file.write(b"model")

        error_cases = [
            (FileNotFoundError("gone"), 404),
            (_UnsupportedFileManagerPlatformError("unsupported"), 501),
            (_FileManagerUnavailableError("unavailable"), 503),
            (_FileManagerError("failed"), 500),
        ]
        for error, expected_status in error_cases:
            values["open_in_file_manager"].side_effect = error
            response = await handler(_request({"path": target}))
            assert response.status == expected_status

        values["open_in_file_manager"].side_effect = None
        values["open_in_file_manager"].return_value = {"opened": True}
        response = await handler(_request({"path": target}))

    assert response.status == 200
    assert json.loads(response.text) == {"success": True, "opened": True}


@pytest.mark.asyncio
async def test_open_containing_folder_validates_request_and_path():
    normalizer = MagicMock(side_effect=ValueError("invalid path"))
    handlers, values = _build_hash_routes(
        {"normalize_file_manager_path": normalizer}
    )
    handler = handlers[("POST", "/model_resolver/open-containing-folder")]

    invalid_json_request = SimpleNamespace(
        json=AsyncMock(side_effect=ValueError("malformed"))
    )
    response = await handler(invalid_json_request)
    assert response.status == 400

    response = await handler(_request([]))
    assert response.status == 400

    response = await handler(_request({"path": "bad"}))
    assert response.status == 400

    normalizer.side_effect = lambda path: path
    values["is_path_in_configured_model_roots"].return_value = False
    response = await handler(_request({"path": "missing"}))
    assert response.status == 404

    with tempfile.TemporaryDirectory() as temp_dir:
        target = os.path.join(temp_dir, "model.safetensors")
        with open(target, "wb") as model_file:
            model_file.write(b"model")
        response = await handler(_request({"path": target}))
        assert response.status == 403


@pytest.mark.asyncio
async def test_calculate_file_hash_writes_metadata_and_reports_source():
    sha256 = "c" * 64
    written = {}

    def write_metadata(path, metadata, indent=2):
        written["path"] = path
        written["metadata"] = metadata
        written["indent"] = indent

    handlers, values = _build_hash_routes(
        {
            "read_json_safe": MagicMock(return_value={"file_name": "old"}),
            "write_json_atomic": write_metadata,
        }
    )
    handler = handlers[("POST", "/model_resolver/calculate-file-hash")]
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        with patch(
            "core.path_utils.calculate_file_sha256",
            return_value=sha256,
        ):
            response = await handler(_request({"file_path": model_path}))

    body = json.loads(response.text)
    assert body["success"] is True
    assert body["sha256"] == sha256
    assert body["sha256_source"] == "file"
    assert body["metadata_updated"] is True
    assert written["metadata"]["sha256"] == sha256
    assert written["metadata"]["hashes"]["SHA256"] == sha256
    assert written["metadata"]["file_name"] == "old"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "route",
    [
        "/model_resolver/calculate-file-hash",
        "/model_resolver/calculate-file-hash/start",
    ],
)
async def test_hash_calculation_routes_share_file_request_validation(route):
    handlers, values = _build_hash_routes()
    handler = handlers[("POST", route)]

    response = await handler(_request({}))
    assert response.status == 400
    assert json.loads(response.text) == {"error": "file_path is required"}

    with tempfile.TemporaryDirectory() as temp_dir:
        missing_path = os.path.join(temp_dir, "missing.safetensors")
        response = await handler(_request({"file_path": missing_path}))
        assert response.status == 404
        assert json.loads(response.text) == {"error": "file does not exist"}

        outside_path = os.path.join(temp_dir, "outside.safetensors")
        with open(outside_path, "wb") as model_file:
            model_file.write(b"model")
        values["is_path_in_configured_model_roots"].return_value = False
        response = await handler(_request({"file_path": outside_path}))

    assert response.status == 403
    assert json.loads(response.text) == {
        "error": "file is outside configured model directories"
    }


def test_hash_service_reports_header_source_and_cancellation():
    sha256 = "e" * 64
    _, values = _build_hash_routes()
    service = HashService(RouteContext(values))

    def calculate_with_header(path, **callbacks):
        callbacks["on_hash_source"]("safetensors_header")
        callbacks["on_progress"](1, 1)
        return sha256

    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        with patch(
            "core.path_utils.calculate_file_sha256",
            side_effect=calculate_with_header,
        ):
            calculated_hash, source = service.calculate_sha256_with_progress(
                model_path,
                progress_id="header-test",
            )

    assert calculated_hash == sha256
    assert source == "safetensors_header"
    assert any(
        call.kwargs.get("sha256_source") == "safetensors_header"
        for call in values["self"].hash_tracker.update.call_args_list
    )

    values["self"].hash_tracker.reset_mock()
    values["self"].hash_tracker.is_cancelled.side_effect = [False, True]
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        with (
            patch(
                "core.path_utils.calculate_file_sha256",
                return_value=sha256,
            ),
            pytest.raises(HashCalculationCancelled),
        ):
            service.calculate_sha256_with_progress(model_path, "cancel-test")

    assert any(
        call.kwargs.get("status") == "cancelled"
        for call in values["self"].hash_tracker.update.call_args_list
    )


def test_hash_service_returns_false_when_metadata_write_fails():
    _, values = _build_hash_routes(
        {"read_json_safe": MagicMock(side_effect=OSError("read failed"))}
    )
    service = HashService(RouteContext(values))

    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        metadata_path, updated = service.write_calculated_hash_metadata(
            model_path,
            "f" * 64,
        )

    assert metadata_path.endswith(".modelresolver.json")
    assert updated is False
    values["self"].logger.warning.assert_called_once()


@pytest.mark.asyncio
async def test_calculate_file_hash_start_runs_background_success_callback():
    sha256 = "d" * 64
    handlers, values = _build_hash_routes()
    handler = handlers[("POST", "/model_resolver/calculate-file-hash/start")]
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, "model.safetensors")
        with open(model_path, "wb") as model_file:
            model_file.write(b"model")
        with patch(
            "core.path_utils.calculate_file_sha256",
            return_value=sha256,
        ):
            response = await handler(_request({"file_path": model_path}))

    body = json.loads(response.text)
    assert response.status == 200
    assert body["success"] is True
    assert body["progress_id"].startswith("hash_")
    progress_calls = values["self"].hash_tracker.update.call_args_list
    assert any(
        call.kwargs.get("status") == "done"
        and call.kwargs.get("sha256") == sha256
        for call in progress_calls
    )


@pytest.mark.asyncio
async def test_hash_progress_and_cancel_routes_delegate_to_helpers():
    handlers, values = _build_hash_routes()
    progress_handler = handlers[
        ("GET", "/model_resolver/calculate-file-hash/progress/{progress_id}")
    ]
    cancel_handler = handlers[
        ("POST", "/model_resolver/calculate-file-hash/cancel/{progress_id}")
    ]
    request = SimpleNamespace()

    progress_response = await progress_handler(request)
    cancel_response = await cancel_handler(request)

    assert progress_response.status == 200
    assert cancel_response.status == 200
    values["get_progress_response"].assert_called_once_with(
        values["self"].hash_tracker,
        request,
        not_found_status=404,
    )
    values["cancel_progress_response"].assert_called_once_with(
        values["self"].hash_tracker,
        request,
        cancel_message="Stopping hash calculation...",
    )

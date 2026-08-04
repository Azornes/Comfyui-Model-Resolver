import asyncio
import json
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web

from core.path_utils import get_filename_from_path
from core.routes.context import RouteContext
from core.routes.loaded_models import register_loaded_model_routes


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


def _build_routes(inventory=None):
    routes = _Routes()
    extension = SimpleNamespace(
        loaded_progress=MagicMock(),
        logger=MagicMock(),
        _update_loaded_progress=MagicMock(),
        _update_workflow_analysis_progress=MagicMock(),
    )
    values = {
        "adapt_custom_node_loaded_model": MagicMock(
            side_effect=lambda _ref, name, strength: (name, strength)
        ),
        "asyncio": asyncio,
        "get_filename_from_path": get_filename_from_path,
        "get_progress_response": MagicMock(
            return_value={"status": "running"}
        ),
        "get_workflow_model_inventory": MagicMock(
            return_value=inventory
            or {"available_models": [], "model_refs": []}
        ),
        "json_api_endpoint": _json_api_endpoint,
        "routes": routes,
        "self": extension,
        "web": web,
    }
    register_loaded_model_routes(RouteContext(values))
    return routes.handlers, values


def _request(payload=None, loaded_id="loaded-1"):
    return SimpleNamespace(
        json=AsyncMock(return_value=payload),
        match_info={"loaded_id": loaded_id},
    )


def _folder_paths():
    folder_paths = MagicMock()
    folder_paths.get_filename_list.return_value = []
    folder_paths.get_full_path.return_value = None
    return folder_paths


@pytest.mark.asyncio
async def test_loaded_models_route_returns_resolved_local_model():
    inventory = {
        "available_models": [
            {
                "relative_path": "checkpoints/model.safetensors",
                "path": r"C:\models\checkpoints\model.safetensors",
            }
        ],
        "model_refs": [
            {
                "original_path": "checkpoints/model.safetensors",
                "node_id": 1,
                "widget_index": 0,
                "node_type": "CheckpointLoaderSimple",
                "category": "checkpoints",
                "exists": True,
            }
        ],
    }
    handlers, values = _build_routes(inventory)
    handler = handlers[("POST", "/model_resolver/loaded")]
    workflow = {"nodes": [{"id": 1, "type": "CheckpointLoaderSimple"}]}

    with patch.dict(sys.modules, {"folder_paths": _folder_paths()}):
        response = await handler(_request({"workflow": workflow}))

    body = json.loads(response.text)
    assert response.status == 200
    assert body["total"] == 1
    assert body["loaded_models"][0]["name"] == "model.safetensors"
    assert (
        body["loaded_models"][0]["resolved_path"]
        == r"C:\models\checkpoints\model.safetensors"
    )
    values["get_workflow_model_inventory"].assert_called_once()
    values["self"]._update_loaded_progress.assert_any_call(
        "",
        "completed",
        "Loaded models ready",
        percent=100,
        status="completed",
        current=1,
        total=1,
    )


@pytest.mark.asyncio
async def test_loaded_models_route_includes_urn_and_embedded_models():
    handlers, _ = _build_routes(
        {"available_models": [], "model_refs": [
            {
                "original_path": "urn:checkpoint:123",
                "node_id": 2,
                "widget_index": 1,
                "node_type": "CustomLoader",
                "category": "unknown",
                "is_urn": True,
                "urn": {"type": "checkpoint", "model_id": 123},
            }
        ]}
    )
    handler = handlers[("POST", "/model_resolver/loaded")]
    workflow = {
        "nodes": [
            {
                "id": 2,
                "type": "CustomLoader",
                "properties": {
                    "models": [
                        {"name": "embedded.safetensors", "directory": "loras"}
                    ]
                },
            }
        ]
    }

    with patch.dict(sys.modules, {"folder_paths": _folder_paths()}):
        response = await handler(_request({"workflow": workflow}, "job-2"))

    body = json.loads(response.text)
    names = {model["name"] for model in body["loaded_models"]}
    assert response.status == 200
    assert "urn:checkpoint:123" in names
    assert "embedded.safetensors" in names
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_loaded_models_route_returns_error_when_inventory_fails():
    handlers, values = _build_routes()
    values["get_workflow_model_inventory"].side_effect = RuntimeError(
        "inventory failed"
    )
    handler = handlers[("POST", "/model_resolver/loaded")]

    response = await handler(
        _request({"workflow": {"nodes": []}, "loaded_id": "failed-job"})
    )

    assert response.status == 500
    assert json.loads(response.text) == {"error": "inventory failed"}
    values["self"].logger.error.assert_called_once()
    values["self"]._update_loaded_progress.assert_any_call(
        "failed-job",
        "error",
        "inventory failed",
        percent=100,
        status="error",
        current=0,
        total=0,
    )


@pytest.mark.asyncio
async def test_loaded_models_progress_route_uses_loaded_id_and_fallback_payload():
    handlers, values = _build_routes()
    handler = handlers[("GET", "/model_resolver/loaded-progress/{loaded_id}")]
    request = _request(loaded_id="progress-42")

    response = await handler(request)

    assert response == {"status": "running"}
    values["get_progress_response"].assert_called_once_with(
        values["self"].loaded_progress,
        request,
        param_name="loaded_id",
        not_found_payload={
            "status": "unknown",
            "stage": "unknown",
            "message": "No loaded models progress available",
            "percent": 0,
            "current": 0,
            "total": 0,
        },
    )


@pytest.mark.asyncio
async def test_loaded_models_route_handles_invalid_node_collections_without_folder_paths():
    handlers, _ = _build_routes({"available_models": [], "model_refs": []})
    handler = handlers[("POST", "/model_resolver/loaded")]
    workflow = {
        "nodes": "not-a-list",
        "definitions": {
            "subgraphs": [None, {"nodes": "not-a-list"}],
        },
    }

    with patch.dict(sys.modules, {"folder_paths": None}):
        response = await handler(_request({"workflow": workflow}))

    assert response.status == 200
    assert json.loads(response.text) == {"loaded_models": [], "total": 0}


@pytest.mark.asyncio
async def test_loaded_models_progress_counts_top_level_and_subgraph_nodes():
    handlers, values = _build_routes()

    def inventory_with_progress(_workflow, progress_callback):
        progress_callback(
            {
                "stage": "analyzing",
                "current": 1,
                "total": 5,
            }
        )
        return {"available_models": [], "model_refs": []}

    values["get_workflow_model_inventory"].side_effect = inventory_with_progress
    workflow = {
        "nodes": [{"id": 1}, {"id": 2}],
        "definitions": {
            "subgraphs": [
                {
                    "id": "group-1",
                    "nodes": [{"id": 3}, {"id": 4}, {"id": 5}],
                }
            ]
        },
    }

    with patch.dict(sys.modules, {"folder_paths": None}):
        response = await handlers[("POST", "/model_resolver/loaded")](
            _request({"workflow": workflow})
        )

    assert response.status == 200
    values["self"]._update_workflow_analysis_progress.assert_called_once()
    assert values["self"]._update_workflow_analysis_progress.call_args.args[1] == 5


@pytest.mark.asyncio
async def test_loaded_models_route_reads_folder_paths_and_ignores_category_errors():
    folder_paths = MagicMock()
    folder_paths.get_filename_list.side_effect = [
        ["folder/model.safetensors"],
        RuntimeError("folder list failed"),
        [],
        [],
        [],
    ]
    folder_paths.get_full_path.return_value = (
        r"C:\models\folder\model.safetensors"
    )
    handlers, _ = _build_routes(
        {
            "available_models": [],
            "model_refs": [
                {
                    "original_path": "folder/model.safetensors",
                    "node_id": 1,
                    "category": "checkpoints",
                }
            ],
        }
    )

    with patch.dict(sys.modules, {"folder_paths": folder_paths}):
        response = await handlers[("POST", "/model_resolver/loaded")](
            _request({"workflow": {"nodes": []}})
        )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["loaded_models"][0]["resolved_path"] == (
        r"C:\models\folder\model.safetensors"
    )
    assert folder_paths.get_filename_list.call_count == 5


@pytest.mark.asyncio
async def test_loaded_models_route_matches_top_level_and_subgraph_lora_refs():
    inventory = {
        "available_models": [],
        "model_refs": [
            {
                "original_path": "top-style.safetensors",
                "node_id": 2,
                "widget_index": 0,
                "node_type": "LoraLoader",
                "category": "loras",
            },
            {
                "original_path": "inner-style.safetensors",
                "node_id": 3,
                "widget_index": 0,
                "node_type": "LoraLoader",
                "category": "loras",
                "is_top_level": False,
                "subgraph_id": "group-1",
                "strength": 1.25,
            },
        ],
    }
    handlers, _ = _build_routes(inventory)
    workflow = {
        "nodes": [
            {"id": 1, "type": "Other"},
            {
                "id": 2,
                "type": "LoraLoader",
                "widgets_values": ["top-style.safetensors", 0.7],
            },
        ],
        "definitions": {
            "subgraphs": [
                None,
                {"id": "invalid-group", "nodes": "not-a-list"},
                {
                    "id": "group-1",
                    "name": "Group one",
                    "nodes": [
                        {
                            "id": 3,
                            "type": "LoraLoader",
                            "widgets_values": [
                                "inner-style.safetensors",
                                0.8,
                            ],
                        }
                    ],
                },
            ]
        },
    }

    with (
        patch.dict(sys.modules, {"folder_paths": None}),
        patch(
            "core.workflow.dynamic_widgets.get_lora_model_strength",
            return_value=0.7,
        ) as get_strength,
    ):
        response = await handlers[("POST", "/model_resolver/loaded")](
            _request({"workflow": workflow, "progress_id": "lora-job"})
        )

    body = json.loads(response.text)
    assert response.status == 200
    assert [model["strength"] for model in body["loaded_models"]] == [
        0.7,
        1.25,
    ]
    assert body["loaded_models"][1]["subgraph_id"] == "group-1"
    assert body["loaded_models"][1]["is_top_level"] is False
    assert get_strength.call_count == 1


@pytest.mark.asyncio
async def test_loaded_models_route_uses_adapter_name_and_original_path_fallback():
    inventory = {
        "available_models": [
            {
                "relative_path": "folder/actual.safetensors",
                "path": r"C:\models\actual.safetensors",
            }
        ],
        "model_refs": [
            {
                "original_path": "folder/actual.safetensors",
                "node_id": 1,
                "category": "checkpoints",
            }
        ],
    }
    handlers, values = _build_routes(inventory)
    values["adapt_custom_node_loaded_model"].side_effect = (
        lambda _ref, _name, _strength: ("display-name.safetensors", 0.5)
    )

    progress_payload = {"processed": 1, "total": 1}

    def inventory_with_progress(_workflow, progress_callback):
        progress_callback(progress_payload)
        return inventory

    values["get_workflow_model_inventory"].side_effect = inventory_with_progress

    with patch.dict(sys.modules, {"folder_paths": None}):
        response = await handlers[("POST", "/model_resolver/loaded")](
            _request({"workflow": {"nodes": [{"id": 1}]}})
        )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["loaded_models"][0]["name"] == "display-name.safetensors"
    assert body["loaded_models"][0]["resolved_path"] == (
        r"C:\models\actual.safetensors"
    )
    values["self"]._update_workflow_analysis_progress.assert_called_once()


@pytest.mark.asyncio
async def test_loaded_models_route_handles_embedded_metadata_edge_cases():
    handlers, _ = _build_routes({"available_models": [], "model_refs": []})
    workflow = {
        "nodes": [
            {"id": 1, "type": "NoProperties", "properties": "invalid"},
            {
                "id": 2,
                "type": "EmbeddedLoader",
                "properties": {
                    "models": [
                        "not-a-model",
                        {"name": ""},
                        {"name": "embedded.safetensors"},
                        {"name": "embedded.safetensors"},
                    ]
                },
            },
        ]
    }

    with patch.dict(sys.modules, {"folder_paths": None}):
        response = await handlers[("POST", "/model_resolver/loaded")](
            _request({"workflow": workflow})
        )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["total"] == 1
    assert body["loaded_models"][0]["name"] == "embedded.safetensors"

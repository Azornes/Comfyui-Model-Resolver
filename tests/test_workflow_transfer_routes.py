import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.contracts import ModelReference
from core.routes.context import RouteContext
from core.routes.workflow_transfer import register_workflow_transfer_routes


class _Routes:
    def __init__(self):
        self.handlers = {}

    def post(self, path):
        def register(handler):
            self.handlers[("POST", path)] = handler
            return handler

        return register


def _reference(
    node_id=1,
    original_path="old.safetensors",
    *,
    category="checkpoints",
    node_type="CheckpointLoaderSimple",
):
    return ModelReference.from_mapping(
        {
            "node_id": node_id,
            "node_type": node_type,
            "widget_index": 0,
            "original_path": original_path,
            "category": category,
            "exists": False,
            "widget_name": "ckpt_name",
        }
    )


def _request(payload):
    return SimpleNamespace(json=AsyncMock(return_value=payload))


def _build_routes(inventory):
    routes = _Routes()
    get_inventory = MagicMock(return_value=inventory)
    context = RouteContext(
        {
            "asyncio": asyncio,
            "get_workflow_model_inventory": get_inventory,
            "json_api_endpoint": lambda _prefix: lambda handler: handler,
            "routes": routes,
            "web": web,
        }
    )
    register_workflow_transfer_routes(context)
    return routes.handlers, get_inventory


@pytest.mark.asyncio
async def test_transfer_route_returns_updated_workflow():
    reference = _reference()
    handlers, get_inventory = _build_routes(
        SimpleNamespace(model_refs=(reference,))
    )
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["old.safetensors"],
            }
        ]
    }

    response = await handlers[("POST", "/model_resolver/transfer-models")](
        _request(
            {
                "workflow": workflow,
                "source_models": [
                    {"original_path": "new.safetensors", "category": "checkpoints"}
                ],
                "target_refs": [reference.to_dict()],
            }
        )
    )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["success"] is True
    assert body["updated"] == 1
    assert body["workflow"]["nodes"][0]["widgets_values"] == [
        "new.safetensors"
    ]
    get_inventory.assert_called_once()


@pytest.mark.asyncio
async def test_transfer_route_normalizes_api_prompt_before_scanning_and_updating():
    reference = _reference(node_id="1")
    handlers, get_inventory = _build_routes(
        SimpleNamespace(model_refs=(reference,))
    )
    api_workflow = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "old.safetensors"},
        }
    }

    response = await handlers[("POST", "/model_resolver/transfer-models")](
        _request(
            {
                "workflow": api_workflow,
                "source_models": [
                    {"original_path": "new.safetensors", "category": "checkpoints"}
                ],
                "target_refs": [reference.to_dict()],
            }
        )
    )

    body = json.loads(response.text)
    scanned_workflow = get_inventory.call_args.args[0]
    assert response.status == 200
    assert scanned_workflow["nodes"][0]["id"] == "1"
    assert body["workflow"]["nodes"][0]["widgets_values"] == [
        "new.safetensors"
    ]


@pytest.mark.asyncio
async def test_transfer_route_rejects_malformed_selection():
    handlers, get_inventory = _build_routes(SimpleNamespace(model_refs=()))

    response = await handlers[("POST", "/model_resolver/transfer-models")](
        _request(
            {
                "workflow": {"nodes": []},
                "source_models": {},
                "target_refs": [],
            }
        )
    )

    assert response.status == 400
    assert json.loads(response.text) == {"error": "source_models must be an array"}
    get_inventory.assert_not_called()


@pytest.mark.asyncio
async def test_transfer_route_rejects_malformed_target_selector():
    reference = _reference()
    handlers, get_inventory = _build_routes(
        SimpleNamespace(model_refs=(reference,))
    )

    response = await handlers[("POST", "/model_resolver/transfer-models")](
        _request(
            {
                "workflow": {
                    "nodes": [
                        {
                            "id": 1,
                            "type": "CheckpointLoaderSimple",
                            "widgets_values": ["old.safetensors"],
                        }
                    ]
                },
                "source_models": [
                    {"original_path": "new.safetensors", "category": "checkpoints"}
                ],
                "target_refs": [{"node_id": 1, "widget_index": "not-an-index"}],
            }
        )
    )

    assert response.status == 400
    assert json.loads(response.text) == {
        "error": "The selected workflow model slots are no longer available"
    }
    get_inventory.assert_called_once()

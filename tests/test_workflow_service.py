import asyncio
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.contracts import (
    MissingModel,
    ModelCatalogEntry,
    ModelMatch,
    Resolution,
    SearchResult,
    WorkflowAnalysisResult,
)
from core.path_utils import get_filename_from_path
from core.routes.context import RouteContext
from core.routes.workflow_analysis import register_workflow_analysis_routes
from core.type_utils import to_bool


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


def _analysis_result(missing_models=(), **counts):
    typed_missing = tuple(
        item
        if isinstance(item, MissingModel)
        else MissingModel.from_mapping(item)
        for item in missing_models
    )
    return WorkflowAnalysisResult(
        missing_models=typed_missing,
        total_resolved=counts.get("total_resolved", 0),
        total_missing=counts.get("total_missing", len(typed_missing)),
        total_models_analyzed=counts.get("total_models_analyzed", len(typed_missing)),
    )


def _build_routes(overrides=None):
    routes = _Routes()
    extension = SimpleNamespace(
        analysis_progress=MagicMock(),
        _update_analysis_progress=MagicMock(),
        logger=MagicMock(),
    )
    values = {
        "analyze_and_find_matches": MagicMock(
            return_value=WorkflowAnalysisResult()
        ),
        "apply_resolution": MagicMock(side_effect=lambda workflow, _resolutions: workflow),
        "asyncio": asyncio,
        "download_available": False,
        "fetch_remote_file_size_cached": MagicMock(return_value=123),
        "get_filename_from_path": get_filename_from_path,
        "get_popular_model_url": MagicMock(return_value=None),
        "get_progress_response": MagicMock(return_value={"status": "running"}),
        "invalidate_local_hash_match_cache": MagicMock(),
        "json_api_endpoint": _json_api_endpoint,
        "routes": routes,
        "search_local_matches": MagicMock(return_value=[]),
        "search_model_list": MagicMock(return_value=None),
        "should_skip_existing_custom_node_reference": MagicMock(
            return_value=False
        ),
        "self": extension,
        "to_bool": to_bool,
        "web": web,
    }
    if overrides:
        values.update(overrides)
    register_workflow_analysis_routes(RouteContext(values))
    return routes.handlers, values


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({}, "Workflow JSON is required"),
        ({"workflow": []}, "Workflow JSON must be an object"),
    ],
)
async def test_analyze_route_validates_workflow_payload(payload, message):
    handlers, _ = _build_routes()
    response = await handlers[("POST", "/model_resolver/analyze")](
        _request(payload)
    )

    assert response.status == 400
    assert json.loads(response.text) == {"error": message}


@pytest.mark.asyncio
async def test_analyze_route_rejects_non_text_analysis_id():
    handlers, values = _build_routes()
    response = await handlers[("POST", "/model_resolver/analyze")](
        _request({"workflow": {"nodes": []}, "analysis_id": 123})
    )

    assert response.status == 400
    assert "Workflow analysis request analysis_id must be a string" in (
        json.loads(response.text)["error"]
    )
    values["analyze_and_find_matches"].assert_not_called()


@pytest.mark.asyncio
async def test_analyze_route_filters_references_and_uses_local_download_sources():
    missing_models = [
        {
            "original_path": "hf/model.safetensors",
            "matches": [],
            "workflow_url": "https://huggingface.co/example/model.safetensors",
            "workflow_model_url": "https://huggingface.co/example/model",
            "workflow_directory": "checkpoints",
        },
        {
            "original_path": "popular.safetensors",
            "matches": [],
        },
        {
            "original_path": "listed.safetensors",
            "matches": [],
        },
        {
            "original_path": "already-local.safetensors",
            "matches": [
                {
                    "model": {
                        "path": "models/already-local.safetensors",
                        "filename": "already-local.safetensors",
                        "category": "checkpoints",
                    },
                    "confidence": 100,
                }
            ],
        },
        {
            "original_path": "installed-custom-node.safetensors",
            "matches": [],
        },
    ]

    def analyze(_workflow, _threshold, _limit, progress_callback, **_kwargs):
        progress_callback({"stage": "matching", "current": 1, "total": 5})
        return _analysis_result(missing_models)

    def popular_url(filename):
        if filename == "popular.safetensors":
            return ModelCatalogEntry(
                filename=filename,
                url="https://example.com/popular.safetensors",
                model_type="checkpoint",
                directory="checkpoints",
                size=100,
            )
        return None

    def model_list(filename, exact_only=False):
        assert exact_only is True
        if filename == "popular.safetensors":
            return SearchResult(
                source="model_list",
                filename=filename,
                size=200,
            )
        if filename == "listed.safetensors":
            return SearchResult(
                source="model_list",
                url="https://example.com/listed.safetensors",
                filename="listed.safetensors",
                name="Listed model",
                model_type="checkpoint",
                size=300,
                match_type="exact",
                confidence=100,
                extra={"directory": "checkpoints"},
            )
        return None

    handlers, values = _build_routes(
        {
            "analyze_and_find_matches": MagicMock(side_effect=analyze),
            "download_available": True,
            "get_popular_model_url": MagicMock(side_effect=popular_url),
            "search_model_list": MagicMock(side_effect=model_list),
            "should_skip_existing_custom_node_reference": MagicMock(
                side_effect=lambda item: item.original_path.startswith(
                    "installed-custom"
                )
            ),
        }
    )
    response = await handlers[("POST", "/model_resolver/analyze")](
        _request(
            {
                "workflow": {"nodes": []},
                "analysis_id": "analysis-1",
                "force_rescan": "true",
            }
        )
    )

    body = json.loads(response.text)
    assert response.status == 200
    assert body["total_missing"] == 4
    assert all(
        item["original_path"] != "installed-custom-node.safetensors"
        for item in body["missing_models"]
    )
    sources = {
        item["original_path"]: item["download_source"]
        for item in body["missing_models"]
        if "download_source" in item
    }
    assert sources["hf/model.safetensors"]["source"] == "huggingface"
    assert sources["hf/model.safetensors"]["size"] == 123
    assert sources["popular.safetensors"]["source"] == "popular"
    assert sources["popular.safetensors"]["size"] == 200
    assert sources["listed.safetensors"]["source"] == "model_list"
    values["invalidate_local_hash_match_cache"].assert_called_once_with()
    assert values["analyze_and_find_matches"].call_args.kwargs["analysis_id"] == (
        "analysis-1"
    )
    values["self"]._update_analysis_progress.assert_any_call(
        "analysis-1",
        {"stage": "matching", "current": 1, "total": 5},
    )
    values["self"].analysis_progress.update.assert_called_once_with(
        "analysis-1",
        status="completed",
        stage="completed",
        message="Analysis complete",
        current=4,
        total=4,
    )


@pytest.mark.asyncio
async def test_analyze_route_returns_error_and_updates_progress_on_failure():
    handlers, values = _build_routes(
        {"analyze_and_find_matches": MagicMock(side_effect=RuntimeError("boom"))}
    )
    response = await handlers[("POST", "/model_resolver/analyze")](
        _request({"workflow": {"nodes": []}, "analysis_id": "failed-analysis"})
    )

    assert response.status == 500
    assert json.loads(response.text) == {"error": "boom"}
    values["self"].analysis_progress.update.assert_called_once_with(
        "failed-analysis",
        status="error",
        stage="error",
        message="boom",
        current=0,
        total=0,
    )
    values["self"].logger.error.assert_called_once()


@pytest.mark.asyncio
async def test_workflow_resolution_route_returns_updated_workflow():
    updated = {"nodes": [{"id": 1, "widgets_values": ["resolved.safetensors"]}]}
    handlers, values = _build_routes(
        {"apply_resolution": MagicMock(return_value=updated)}
    )
    workflow = {"nodes": []}
    response = await handlers[("POST", "/model_resolver/resolve")](
        _request(
            {
                "workflow": workflow,
                "resolutions": [
                    {
                        "node_id": 1,
                        "widget_index": 0,
                        "resolved_path": "resolved.safetensors",
                        "category": "checkpoints",
                    }
                ],
            }
        )
    )

    assert response.status == 200
    assert json.loads(response.text) == {"workflow": updated, "success": True}
    values["apply_resolution"].assert_called_once_with(
        workflow,
        [
            Resolution.from_mapping(
                {
                    "node_id": 1,
                    "widget_index": 0,
                    "resolved_path": "resolved.safetensors",
                    "category": "checkpoints",
                }
            )
        ],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "resolution",
    [
        {
            "node_id": 1,
            "widget_index": "0",
            "resolved_path": "resolved.safetensors",
        },
        {
            "node_id": 1,
            "widget_index": -1,
            "resolved_path": "resolved.safetensors",
        },
        {
            "node_id": 1,
            "widget_index": 0,
            "resolved_path": 123,
        },
    ],
)
async def test_workflow_resolution_route_rejects_invalid_resolution_types(resolution):
    handlers, values = _build_routes()
    response = await handlers[("POST", "/model_resolver/resolve")](
        _request(
            {
                "workflow": {"nodes": []},
                "resolutions": [resolution],
            }
        )
    )

    assert response.status == 400
    assert json.loads(response.text)["error"].startswith("Invalid resolution:")
    values["apply_resolution"].assert_not_called()


@pytest.mark.asyncio
async def test_local_matches_route_rescans_and_passes_search_options():
    matches = [
        ModelMatch.from_mapping(
            {
                "model": {
                    "path": os.path.join("models", "model.safetensors")
                }
            }
        )
    ]
    handlers, values = _build_routes(
        {"search_local_matches": MagicMock(return_value=matches)}
    )
    response = await handlers[("POST", "/model_resolver/local-matches")](
        _request(
            {
                "filename": "model.safetensors",
                "category": "loras",
                "force_rescan": "true",
            }
        )
    )

    assert response.status == 200
    assert json.loads(response.text) == {
        "matches": [match.to_dict() for match in matches]
    }
    values["invalidate_local_hash_match_cache"].assert_called_once_with()
    values["search_local_matches"].assert_called_once_with(
        "model.safetensors",
        category="loras",
        similarity_threshold=0.0,
        max_matches_per_model=10,
        force_rescan=True,
    )


@pytest.mark.asyncio
async def test_local_matches_route_rejects_non_text_fields():
    handlers, values = _build_routes()
    response = await handlers[("POST", "/model_resolver/local-matches")](
        _request({"filename": 123, "category": "checkpoints"})
    )

    assert response.status == 400
    assert json.loads(response.text) == {
        "error": "Local matches request filename must be a string"
    }
    values["search_local_matches"].assert_not_called()


@pytest.mark.asyncio
async def test_workflow_progress_route_delegates_analysis_tracker():
    handlers, values = _build_routes()
    request = SimpleNamespace()
    response = await handlers[("GET", "/model_resolver/analyze-progress/{analysis_id}")](
        request
    )

    assert response == {"status": "running"}
    values["get_progress_response"].assert_called_once_with(
        values["self"].analysis_progress,
        request,
        param_name="analysis_id",
        not_found_payload={
            "status": "unknown",
            "stage": "unknown",
            "message": "No analysis progress available",
            "current": 0,
            "total": 0,
        },
    )

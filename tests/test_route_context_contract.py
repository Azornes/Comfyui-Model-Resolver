import pytest

from core.routes.context import RouteContext
from core.services.directory_service import DirectoryService
from core.services.download_service import DownloadService
from core.services.hash_service import HashService
from core.services.loaded_models_service import LoadedModelsService
from core.services.metadata_service import MetadataService
from core.services.scanner_service import ScannerService
from core.services.search_support_service import SearchSupportService
from core.services.workflow_service import WorkflowService


def test_route_context_remains_immutable_after_construction():
    values = {"dependency": "original"}
    context = RouteContext(values)
    values["dependency"] = "changed"

    assert context.get("dependency") == "original"
    with pytest.raises(KeyError, match="Missing route dependency: absent"):
        context.require("absent")


def test_scanner_service_requires_mandatory_route_dependencies():
    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        ScannerService(RouteContext({}))


def test_directory_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: TEMPLATE_KEY_ALIASES",
    ):
        DirectoryService(RouteContext({}))


def test_workflow_service_requires_mandatory_route_dependencies():
    extension = type(
        "Extension",
        (),
        {
            "analysis_progress": object(),
            "_update_analysis_progress": object(),
            "logger": object(),
        },
    )()

    with pytest.raises(
        KeyError,
        match="Missing route dependency: analyze_and_find_matches",
    ):
        WorkflowService(RouteContext({"self": extension}))


def test_loaded_models_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: adapt_custom_node_loaded_model",
    ):
        LoadedModelsService(RouteContext({}))


def test_metadata_service_requires_mandatory_route_dependencies():
    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        MetadataService(RouteContext({}))


def test_hash_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: FileManagerError",
    ):
        HashService(RouteContext({}))


def test_download_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: Aria2InstallError",
    ):
        DownloadService(RouteContext({}))


def test_search_support_service_requires_mandatory_route_dependencies():
    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        SearchSupportService(RouteContext({}))


def test_workflow_service_normalizes_api_prompt_format():
    import asyncio
    from core.contracts import WorkflowAnalysisResult

    captured = {}

    class DummyWeb:
        @staticmethod
        def json_response(payload, status=200):
            return {"status": status, "payload": payload}

    class DummyRequest:
        async def json(self):
            return {
                "workflow": {
                    "1": {
                        "class_type": "CheckpointLoaderSimple",
                        "inputs": {"ckpt_name": "missing_api_ckpt.safetensors"},
                    },
                    "2": {
                        "class_type": "LoraLoader",
                        "inputs": {
                            "model": ["1", 0],
                            "lora_name": "missing_api_lora.safetensors",
                            "strength_model": 0.8,
                        },
                    },
                }
            }

    def fake_analyze(workflow_json, *args, **kwargs):
        captured["workflow"] = workflow_json
        return WorkflowAnalysisResult(
            missing_models=(),
            resolved_models=(),
            total_resolved=0,
            total_missing=0,
            total_models_analyzed=len(workflow_json.get("nodes", [])),
        )

    extension = type(
        "Extension",
        (),
        {
            "analysis_progress": object(),
            "_update_analysis_progress": lambda *a, **k: None,
            "logger": type("L", (), {"info": lambda *a, **k: None, "error": lambda *a, **k: None})(),
        },
    )()

    service = WorkflowService(
        RouteContext(
            {
                "self": extension,
                "analyze_and_find_matches": fake_analyze,
                "apply_resolution": lambda *a, **k: {},
                "asyncio": asyncio,
                "download_available": False,
                "fetch_remote_file_size_cached": lambda *a, **k: None,
                "get_filename_from_path": lambda p: str(p).split("/")[-1],
                "invalidate_local_hash_match_cache": lambda: None,
                "search_local_matches": lambda *a, **k: [],
                "should_skip_existing_custom_node_reference": lambda *a, **k: False,
                "web": DummyWeb,
            }
        )
    )

    resp = asyncio.run(service.analyze_workflow(DummyRequest()))
    assert resp["status"] == 200
    assert isinstance(captured.get("workflow", {}).get("nodes"), list)
    assert len(captured["workflow"]["nodes"]) == 2
    assert {n["type"] for n in captured["workflow"]["nodes"]} == {
        "CheckpointLoaderSimple",
        "LoraLoader",
    }


def test_loaded_models_service_preserves_swap_metadata_fields():
    import asyncio
    from core.contracts import ModelReference, WorkflowModelInventory

    class DummyWeb:
        @staticmethod
        def json_response(payload, status=200):
            return {"status": status, "payload": payload}

    class DummyRequest:
        async def json(self):
            return {
                "workflow": {
                    "nodes": [
                        {
                            "id": 2,
                            "type": "Power Lora Loader (rgthree)",
                            "widgets_values": [
                                None,
                                {"type": "PowerLoraLoaderHeaderWidget"},
                                {"on": True, "lora": "SDXL/detail.safetensors", "strength": 0.65},
                            ],
                        }
                    ]
                }
            }

    ref = ModelReference.from_mapping(
        {
            "node_id": 2,
            "node_type": "Power Lora Loader (rgthree)",
            "widget_index": 2,
            "original_path": "SDXL/detail.safetensors",
            "category": "loras",
            "exists": True,
            "nested_key": "lora",
            "promoted_widget_name": "lora_1",
            "custom_node_adapter": "rgthree-power-lora-loader",
            "custom_node_original_identity": "SDXL/detail.safetensors",
        }
    )

    extension = type(
        "Extension",
        (),
        {
            "_update_loaded_progress": lambda *a, **k: None,
            "logger": type("L", (), {"info": lambda *a, **k: None, "error": lambda *a, **k: None})(),
        },
    )()

    from core.custom_nodes import adapt_custom_node_loaded_model

    service = LoadedModelsService(
        RouteContext(
            {
                "self": extension,
                "adapt_custom_node_loaded_model": adapt_custom_node_loaded_model,
                "asyncio": asyncio,
                "extract_urn_from_node": lambda n: None,
                "get_filename_from_path": lambda p: str(p).split("/")[-1],
                "get_progress_response": lambda *a, **k: None,
                "get_workflow_model_inventory": lambda wf, **kw: WorkflowModelInventory(
                    model_refs=(ref,),
                    available_models=(),
                ),
                "web": DummyWeb,
            }
        )
    )

    resp = asyncio.run(service.get_loaded_models(DummyRequest()))
    assert resp["status"] == 200
    loaded = resp["payload"]["loaded_models"]
    assert len(loaded) == 1
    assert loaded[0]["nested_key"] == "lora"
    assert loaded[0]["promoted_widget_name"] == "lora_1"
    assert loaded[0]["custom_node_original_identity"] == "SDXL/detail.safetensors"



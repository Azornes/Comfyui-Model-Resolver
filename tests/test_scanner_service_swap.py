import asyncio
import pytest
from core.contracts import ResolvedModel
from core.routes.context import RouteContext
from core.services.scanner_service import ScannerService


class DummyWeb:
    def json_response(self, data, status=200):
        return {"data": data, "status": status}


class DummyRequest:
    def __init__(self, query=None):
        self.query = query or {}


def test_scanner_service_get_models_category_and_current_ranking():
    models = [
        ResolvedModel(filename="v1-5-pruned.safetensors", path="/models/checkpoints/v1-5-pruned.safetensors", category="checkpoints"),
        ResolvedModel(filename="v2-1.safetensors", path="/models/checkpoints/v2-1.safetensors", category="checkpoints"),
        ResolvedModel(filename="lora1.safetensors", path="/models/loras/lora1.safetensors", category="loras"),
        ResolvedModel(filename="v1-5-pruned-emaonly.safetensors", path="/models/checkpoints/v1-5-pruned-emaonly.safetensors", category="checkpoints"),
    ]

    context = RouteContext(
        {
            "web": DummyWeb(),
            "asyncio": asyncio,
            "get_model_files": lambda force_rescan=False: models,
            "infer_download_path_templates": lambda *args, **kwargs: [],
            "invalidate_local_hash_match_cache": lambda: None,
        }
    )

    service = ScannerService(context)

    # 1. Test filtering by category
    req = DummyRequest({"category": "checkpoints"})
    res = asyncio.run(service.get_models(req))
    data = res["data"]
    assert len(data) == 3
    assert all(m["category"] == "checkpoints" for m in data)

    # 2. Test ranking by current model similarity
    req2 = DummyRequest({"category": "checkpoints", "current": "v1-5-pruned.safetensors"})
    res2 = asyncio.run(service.get_models(req2))
    data2 = res2["data"]
    assert len(data2) == 3
    # Exact match should be first
    assert data2[0]["filename"] == "v1-5-pruned.safetensors"
    # Close similarity next
    assert data2[1]["filename"] == "v1-5-pruned-emaonly.safetensors"
    # Unrelated last
    assert data2[2]["filename"] == "v2-1.safetensors"

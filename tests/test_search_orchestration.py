import sys
import os
import unittest
import importlib
import json
import tempfile
from contextlib import contextmanager
from unittest.mock import MagicMock, patch, AsyncMock

# Set up mock server modules before importing the custom node
mock_server = MagicMock()
mock_prompt_server = MagicMock()
mock_prompt_server.instance = MagicMock()
mock_routes = MagicMock()
mock_prompt_server.instance.routes = mock_routes
sys.modules['server'] = mock_server
mock_server.PromptServer = mock_prompt_server

# Capture registered handlers
search_handler = None
civitai_search_handler = None
local_matches_by_hash_handler = None
custom_url_handler = None

def post_decorator(path):
    def decorator(func):
        global search_handler, civitai_search_handler, local_matches_by_hash_handler, custom_url_handler
        if path == "/model_resolver/search":
            search_handler = func
        elif path == "/model_resolver/civitai-search":
            civitai_search_handler = func
        elif path == "/model_resolver/local-matches-by-hash":
            local_matches_by_hash_handler = func
        elif path == "/model_resolver/custom-url":
            custom_url_handler = func
        return func
    return decorator

mock_routes.post = post_decorator

# Make sure the parent package directory is in sys.path
parent_dir = r"e:\AI\AI\ComfyUI\ComfyUI_Windows_portable\ComfyUI\custom_nodes"
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Import the module
node_mod = importlib.import_module("comfyui-model-resolver")
from aiohttp import web

# Import source modules dynamically for patching (handles hyphenated package name)
civitai_sources = importlib.import_module("comfyui-model-resolver.core.sources.civitai")
huggingface_sources = importlib.import_module("comfyui-model-resolver.core.sources.huggingface")
civarchive_sources = importlib.import_module("comfyui-model-resolver.core.sources.civarchive")
resolver_core = importlib.import_module("comfyui-model-resolver.core.resolver")


@contextmanager
def without_top_level_core_imports():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    previous_path = list(sys.path)
    removed_modules = {
        name: module
        for name, module in list(sys.modules.items())
        if name == "core" or name.startswith("core.")
    }
    try:
        sys.path[:] = [path for path in sys.path if os.path.abspath(path or os.getcwd()) != repo_root]
        for name in removed_modules:
            sys.modules.pop(name, None)
        yield
    finally:
        sys.path[:] = previous_path
        sys.modules.update(removed_modules)

class SearchOrchestrationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.civitai_patcher = patch.object(civitai_sources, "search_civitai_for_file")
        self.civitai_details_patcher = patch.object(civitai_sources, "get_civitai_model_details")
        self.hf_patcher = patch.object(huggingface_sources, "search_huggingface_for_file")
        self.civarchive_hash_patcher = patch.object(civarchive_sources, "resolve_civarchive_by_hash")
        self.mock_civitai_search = self.civitai_patcher.start()
        self.mock_civitai_details = self.civitai_details_patcher.start()
        self.mock_hf_search = self.hf_patcher.start()
        self.mock_civarchive_hash = self.civarchive_hash_patcher.start()
        self.mock_civarchive_hash.return_value = None
        self.mock_civitai_details.return_value = None

        self.ext = node_mod.ModelResolverExtension()
        self.ext.setup_routes()
        resolver_core.invalidate_local_hash_match_cache()

    def tearDown(self):
        resolver_core.invalidate_local_hash_match_cache()
        self.civarchive_hash_patcher.stop()
        self.civitai_details_patcher.stop()
        self.civitai_patcher.stop()
        self.hf_patcher.stop()

    async def test_search_sources_orchestrator_success(self):
        # Setup mocks
        self.mock_civitai_search.return_value = {"name": "CivitAI Match", "confidence": 100.0}
        self.mock_hf_search.return_value = {"name": "HF Match"}

        # Construct a mock request
        payload = {
            "filename": "test_model.safetensors",
            "sources": ["huggingface", "civitai"],
            "progress_id": "test_progress_123",
            "progress_source": "all",
            "civitai_candidate_limit": 5,
        }
        
        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value=payload)

        # Call the search handler
        response = await search_handler(mock_request)
        
        # Verify response structure and status
        self.assertIsInstance(response, web.Response)

    async def test_custom_url_route_resolves_civitai_model_link(self):
        self.mock_civitai_details.return_value = {
            "source": "civitai",
            "model_id": 123,
            "version_id": 456,
            "name": "Custom Model",
            "type": "Checkpoint",
            "tags": ["tag"],
            "url": "https://civitai.com/models/123",
            "version_url": "https://civitai.com/models/123?modelVersionId=456",
            "selected_version": {
                "id": 456,
                "name": "v1",
                "base_model": "SDXL 1.0",
                "files": [
                    {
                        "name": "custom.safetensors",
                        "type": "Model",
                        "download_url": "https://civitai.com/api/download/models/456",
                        "size": 1234,
                        "primary": True,
                        "sha256": "f" * 64,
                        "hashes": {"SHA256": "f" * 64},
                    }
                ],
            },
        }
        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value={
            "url": "https://civitai.com/models/123?modelVersionId=456",
            "filename": "custom.safetensors",
            "category": "checkpoints",
        })

        response = await custom_url_handler(mock_request)

        self.assertIsInstance(response, web.Response)
        body = json.loads(response.text)
        self.assertTrue(body["success"])
        self.assertEqual(body["source"], "civitai")
        self.assertEqual(body["result"]["download_url"], "https://civitai.com/api/download/models/456")
        self.assertEqual(body["result"]["match_type"], "custom_url")
        self.assertEqual(body["custom"][0]["filename"], "custom.safetensors")

    async def test_custom_url_route_resolves_civitai_red_model_link(self):
        self.mock_civitai_details.return_value = {
            "source": "civitai",
            "model_id": 123,
            "version_id": 456,
            "name": "Custom Model",
            "type": "Checkpoint",
            "tags": ["tag"],
            "url": "https://civitai.com/models/123",
            "version_url": "https://civitai.com/models/123?modelVersionId=456",
            "selected_version": {
                "id": 456,
                "name": "v1",
                "base_model": "SDXL 1.0",
                "files": [
                    {
                        "name": "custom.safetensors",
                        "type": "Model",
                        "download_url": "https://civitai.com/api/download/models/456",
                        "size": 1234,
                        "primary": True,
                        "sha256": "f" * 64,
                        "hashes": {"SHA256": "f" * 64},
                    }
                ],
            },
        }
        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value={
            "url": "https://civitai.red/models/123?modelVersionId=456",
            "filename": "custom.safetensors",
            "category": "checkpoints",
        })

        response = await custom_url_handler(mock_request)

        self.assertIsInstance(response, web.Response)
        body = json.loads(response.text)
        self.assertTrue(body["success"])
        self.assertEqual(body["source"], "civitai")
        self.assertEqual(body["result"]["download_url"], "https://civitai.com/api/download/models/456")
        self.assertEqual(body["result"]["provided_url"], "https://civitai.red/models/123?modelVersionId=456")
        
    async def test_fallback_logic_runs_on_missing_model_context(self):
        # Mock search to fail first and then succeed on retry without base model context
        def side_effect(filename, base_model_context=None, **kwargs):
            if base_model_context is not None:
                return None
            return {"name": "Fallback Match", "confidence": 90.0}
        
        self.mock_civitai_search.side_effect = side_effect

        payload = {
            "filename": "test_model.safetensors",
            "sources": ["civitai"],
            "progress_id": "test_progress_456",
            "base_model_context": "SD 1.5",
        }
        
        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value=payload)

        # Call the search handler
        response = await search_handler(mock_request)
        self.assertIsNotNone(response)

    async def test_civarchive_hash_lookup_does_not_require_top_level_core_import(self):
        file_hash = "a" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "model.safetensors")
            with open(model_path, "wb") as temp_model:
                temp_model.write(b"model")
            payload = {
                "filename": os.path.basename(model_path),
                "category": "checkpoints",
                "resolved_path": model_path,
                "sha256": file_hash,
            }
            civarchive_result = {
                "source": "civarchive",
                "filename": os.path.basename(model_path),
                "model_name": "Archive Match",
                "name": "Archive Match",
                "sha256": file_hash,
                "hashes": {"SHA256": file_hash},
                "download_url": "https://civarchive.com/api/download/models/123.safetensors",
                "url": "https://civarchive.com/models/123",
                "version_url": "https://civarchive.com/models/123?modelVersionId=456",
            }

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.close = MagicMock()

            mock_request = MagicMock()
            mock_request.json = AsyncMock(return_value=payload)

            self.mock_civarchive_hash.return_value = civarchive_result
            with patch.object(civitai_sources, "get_model_info_by_hash", return_value=None), \
                 patch("folder_paths.get_folder_paths", return_value=[temp_dir]), \
                 patch("requests.head", return_value=mock_response), \
                 without_top_level_core_imports():
                response = await civitai_search_handler(mock_request)

        self.assertIsInstance(response, web.Response)
        body = json.loads(response.text)
        self.assertEqual(body["source"], "civarchive")
        self.assertEqual(body["sha256"], file_hash)

    async def test_local_matches_by_hash_route_returns_enriched_hash_matches(self):
        file_hash = "b" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "model.safetensors")
            metadata_path = os.path.join(temp_dir, "model.metadata.json")
            with open(model_path, "wb") as temp_model:
                temp_model.write(b"model")
            with open(metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump({"sha256": file_hash, "hashes": {"SHA256": file_hash}}, metadata_file)

            mock_request = MagicMock()
            mock_request.json = AsyncMock(return_value={
                "sha256": file_hash,
                "category": "checkpoints",
                "source": "civitai",
                "filename": "model.safetensors",
            })

            with patch.object(resolver_core, "get_model_files", return_value=[{
                "path": model_path,
                "filename": "model.safetensors",
                "relative_path": "model.safetensors",
                "category": "checkpoints",
            }]):
                response = await local_matches_by_hash_handler(mock_request)

        self.assertIsInstance(response, web.Response)
        body = json.loads(response.text)
        self.assertEqual(body["sha256"], file_hash)
        self.assertEqual(len(body["local_hash_matches"]), 1)
        self.assertEqual(body["local_hash_matches"][0]["hash_lookup_source"], "civitai")
        self.assertEqual(body["local_hash_matches"][0]["hash_lookup_sha256"], file_hash)

    async def test_search_collects_local_hash_matches_for_any_remote_result_with_hash(self):
        file_hash = "c" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "downloaded.safetensors")
            metadata_path = os.path.join(temp_dir, "downloaded.metadata.json")
            with open(model_path, "wb") as temp_model:
                temp_model.write(b"model")
            with open(metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump({"hashes": {"SHA256": file_hash}}, metadata_file)

            self.mock_civitai_search.return_value = {
                "source": "civitai",
                "name": "Remote Match",
                "filename": "remote.safetensors",
                "download_url": "https://example.test/remote.safetensors",
                "confidence": 52.0,
                "hashes": {"SHA256": file_hash},
            }
            mock_request = MagicMock()
            mock_request.json = AsyncMock(return_value={
                "filename": "remote.safetensors",
                "category": "checkpoints",
                "sources": ["civitai"],
                "progress_id": "hash_lookup_any_result",
            })

            with patch.object(resolver_core, "get_model_files", return_value=[{
                "path": model_path,
                "filename": "downloaded.safetensors",
                "relative_path": "downloaded.safetensors",
                "category": "checkpoints",
            }]):
                response = await search_handler(mock_request)

        self.assertIsInstance(response, web.Response)
        body = json.loads(response.text)
        self.assertEqual(len(body["local_hash_matches"]), 1)
        self.assertEqual(body["local_hash_matches"][0]["hash_lookup_source"], "civitai")
        self.assertEqual(body["local_hash_matches"][0]["hash_lookup_sha256"], file_hash)

    async def test_local_hash_match_lookup_reuses_cache_until_force_rescan(self):
        file_hash = "d" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "cached.safetensors")
            metadata_path = os.path.join(temp_dir, "cached.metadata.json")
            with open(model_path, "wb") as temp_model:
                temp_model.write(b"model")
            with open(metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump({"hashes": {"SHA256": file_hash}}, metadata_file)

            models = [{
                "path": model_path,
                "filename": "cached.safetensors",
                "relative_path": "cached.safetensors",
                "category": "checkpoints",
            }]
            with patch.object(resolver_core, "get_model_files", return_value=models) as get_models:
                first = resolver_core.search_local_matches_by_hash(file_hash, category="checkpoints")
                second = resolver_core.search_local_matches_by_hash(file_hash, category="checkpoints")
                forced = resolver_core.search_local_matches_by_hash(
                    file_hash,
                    category="checkpoints",
                    force_rescan=True,
                )

        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertEqual(len(forced), 1)
        self.assertEqual(get_models.call_count, 2)
        self.assertEqual(get_models.call_args_list[0].kwargs, {"force_rescan": False})
        self.assertEqual(get_models.call_args_list[1].kwargs, {"force_rescan": True})

    async def test_local_hash_match_lookup_ignores_metadata_json_candidates(self):
        file_hash = "e" * 64
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "cached.safetensors")
            metadata_path = os.path.join(temp_dir, "cached.metadata.json")
            with open(model_path, "wb") as temp_model:
                temp_model.write(b"model")
            with open(metadata_path, "w", encoding="utf-8") as metadata_file:
                json.dump({"hashes": {"SHA256": file_hash}}, metadata_file)

            models = [
                {
                    "path": metadata_path,
                    "filename": "cached.metadata.json",
                    "relative_path": "cached.metadata.json",
                    "category": "checkpoints",
                },
                {
                    "path": model_path,
                    "filename": "cached.safetensors",
                    "relative_path": "cached.safetensors",
                    "category": "checkpoints",
                },
            ]
            with patch.object(resolver_core, "get_model_files", return_value=models):
                matches = resolver_core.search_local_matches_by_hash(
                    file_hash,
                    category="checkpoints",
                )

        self.assertEqual([match["filename"] for match in matches], ["cached.safetensors"])

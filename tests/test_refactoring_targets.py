import importlib
import json
import os
import sys
import unittest
from typing import ClassVar
from unittest.mock import AsyncMock, MagicMock, patch

# Make sure parent package directory is in sys.path
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Import submodules dynamically to patch them before any higher level modules run setup_routes
settings_mod = importlib.import_module("comfyui-model-resolver.core.settings")
downloader_mod = importlib.import_module("comfyui-model-resolver.core.downloader")

mock_load_settings = MagicMock(return_value={"aria2c_path": "default_path"})
mock_get_aria2_status = MagicMock(return_value={"status": "running"})

patch_load_settings = patch.object(settings_mod, "load_settings", mock_load_settings)
patch_get_aria2_status = patch.object(downloader_mod, "get_aria2_status", mock_get_aria2_status)

patch_load_settings.start()
patch_get_aria2_status.start()

# Mock PromptServer to capture routes
mock_server = MagicMock()
mock_prompt_server = MagicMock()
mock_prompt_server.instance = MagicMock()
mock_routes = MagicMock()
mock_prompt_server.instance.routes = mock_routes
sys.modules['server'] = mock_server
mock_server.PromptServer = mock_prompt_server

# Capture registered GET and POST handlers
routes_registered = {}

def get_decorator(path):
    def decorator(func):
        routes_registered[("GET", path)] = func
        return func
    return decorator

def post_decorator(path):
    def decorator(func):
        routes_registered[("POST", path)] = func
        return func
    return decorator

mock_routes.get = get_decorator
mock_routes.post = post_decorator

# Import the module so that routes register
node_mod = importlib.import_module("comfyui-model-resolver")

# Force setup_routes to run to populate routes_registered mock registry
node_mod.extension.routes_setup = False
node_mod.extension.setup_routes()

extension = node_mod.extension


def _find_bound_extension(handler):
    pending = [handler]
    visited = set()
    while pending:
        current = pending.pop()
        if id(current) in visited:
            continue
        visited.add(id(current))
        for cell in getattr(current, "__closure__", ()) or ():
            value = cell.cell_contents
            if hasattr(value, "search_tracker"):
                return value
            if callable(value):
                pending.append(value)
    return None



class TestRefactoringTargets(unittest.IsolatedAsyncioTestCase):

    ROUTE_GROUPS: ClassVar = {
        "workflow": {
            ("POST", "/model_resolver/analyze"),
            ("GET", "/model_resolver/analyze-progress/{analysis_id}"),
            ("POST", "/model_resolver/resolve"),
            ("POST", "/model_resolver/local-matches"),
            ("POST", "/model_resolver/local-model-hashes"),
            ("GET", "/model_resolver/model-preview"),
            ("POST", "/model_resolver/workflow-model-hashes"),
            ("POST", "/model_resolver/local-matches-by-hash"),
            ("POST", "/model_resolver/open-containing-folder"),
            ("POST", "/model_resolver/calculate-file-hash"),
            ("POST", "/model_resolver/calculate-file-hash/start"),
            ("GET", "/model_resolver/calculate-file-hash/progress/{progress_id}"),
            ("POST", "/model_resolver/calculate-file-hash/cancel/{progress_id}"),
        },
        "metadata": {
            ("GET", "/model_resolver/models"),
            ("POST", "/model_resolver/metadata-size-audit"),
            ("GET", "/model_resolver/metadata-build/capabilities"),
            ("POST", "/model_resolver/metadata-build/start"),
            ("GET", "/model_resolver/metadata-build/progress/{progress_id}"),
            ("POST", "/model_resolver/metadata-build/cancel/{progress_id}"),
        },
        "loaded": {
            ("POST", "/model_resolver/loaded"),
            ("GET", "/model_resolver/loaded-progress/{loaded_id}"),
        },
        "model_info": {
            ("POST", "/model_resolver/civitai-search"),
            ("POST", "/model_resolver/custom-url"),
            ("POST", "/model_resolver/model-details"),
        },
        "search": {
            ("GET", "/model_resolver/search-progress/{progress_id}"),
            ("POST", "/model_resolver/search-cancel/{progress_id}"),
            ("POST", "/model_resolver/search"),
            ("POST", "/model_resolver/clear-search-cache"),
            ("POST", "/model_resolver/civitai/session-token/check"),
            ("POST", "/model_resolver/civitai/api-key/check"),
            ("POST", "/model_resolver/huggingface/token/check"),
            ("POST", "/model_resolver/brave/api-key/check"),
            ("GET", "/model_resolver/huggingface/author-index/status"),
            ("POST", "/model_resolver/huggingface/author-index/refresh"),
            ("GET", "/model_resolver/model-list/status"),
            ("POST", "/model_resolver/model-list/update"),
        },
        "downloads": {
            ("POST", "/model_resolver/download"),
            ("GET", "/model_resolver/progress/{download_id}"),
            ("GET", "/model_resolver/progress"),
            ("POST", "/model_resolver/cancel/{download_id}"),
            ("POST", "/model_resolver/pause/{download_id}"),
            ("POST", "/model_resolver/resume/{download_id}"),
            ("POST", "/model_resolver/clear_completed_downloads"),
            ("GET", "/model_resolver/aria2/status"),
            ("POST", "/model_resolver/aria2/status"),
            ("POST", "/model_resolver/aria2/start"),
            ("GET", "/model_resolver/aria2/stop"),
            ("POST", "/model_resolver/aria2/stop"),
            ("POST", "/model_resolver/aria2/install"),
        },
        "directories": {
            ("GET", "/model_resolver/directories"),
            ("GET", "/model_resolver/root-directories"),
            ("GET", "/model_resolver/path-template-suggestions"),
            ("GET", "/model_resolver/capabilities"),
            ("GET", "/model_resolver/subfolders/{category}"),
        },
    }

    ROUTE_SUBGROUPS: ClassVar = {
        "workflow_analysis": {
            ("POST", "/model_resolver/analyze"),
            ("GET", "/model_resolver/analyze-progress/{analysis_id}"),
            ("POST", "/model_resolver/resolve"),
            ("POST", "/model_resolver/local-matches"),
        },
        "workflow_hashes": {
            ("POST", "/model_resolver/local-model-hashes"),
            ("GET", "/model_resolver/model-preview"),
            ("POST", "/model_resolver/workflow-model-hashes"),
            ("POST", "/model_resolver/local-matches-by-hash"),
            ("POST", "/model_resolver/open-containing-folder"),
            ("POST", "/model_resolver/calculate-file-hash"),
            ("POST", "/model_resolver/calculate-file-hash/start"),
            ("GET", "/model_resolver/calculate-file-hash/progress/{progress_id}"),
            ("POST", "/model_resolver/calculate-file-hash/cancel/{progress_id}"),
        },
        "loaded_models": {
            ("POST", "/model_resolver/loaded"),
            ("GET", "/model_resolver/loaded-progress/{loaded_id}"),
        },
        "civitai_search": {
            ("POST", "/model_resolver/civitai-search"),
        },
        "custom_url": {
            ("POST", "/model_resolver/custom-url"),
        },
        "model_details": {
            ("POST", "/model_resolver/model-details"),
        },
        "source_search": {
            ("GET", "/model_resolver/search-progress/{progress_id}"),
            ("POST", "/model_resolver/search-cancel/{progress_id}"),
            ("POST", "/model_resolver/search"),
        },
        "search_support": {
            ("POST", "/model_resolver/clear-search-cache"),
            ("POST", "/model_resolver/civitai/session-token/check"),
            ("POST", "/model_resolver/civitai/api-key/check"),
            ("POST", "/model_resolver/huggingface/token/check"),
            ("POST", "/model_resolver/brave/api-key/check"),
            ("GET", "/model_resolver/huggingface/author-index/status"),
            ("POST", "/model_resolver/huggingface/author-index/refresh"),
            ("GET", "/model_resolver/model-list/status"),
            ("POST", "/model_resolver/model-list/update"),
        },
    }

    def test_all_api_routes_are_registered(self):
        expected_routes = {
            ("GET", "/model_resolver/base-models"),
            ("GET", "/model_resolver/base-models/status"),
            ("POST", "/model_resolver/base-models/update"),
            ("POST", "/model_resolver/analyze"),
            ("GET", "/model_resolver/analyze-progress/{analysis_id}"),
            ("POST", "/model_resolver/resolve"),
            ("POST", "/model_resolver/local-matches"),
            ("POST", "/model_resolver/local-model-hashes"),
            ("GET", "/model_resolver/model-preview"),
            ("POST", "/model_resolver/workflow-model-hashes"),
            ("POST", "/model_resolver/local-matches-by-hash"),
            ("POST", "/model_resolver/open-containing-folder"),
            ("POST", "/model_resolver/calculate-file-hash"),
            ("POST", "/model_resolver/calculate-file-hash/start"),
            ("GET", "/model_resolver/calculate-file-hash/progress/{progress_id}"),
            ("POST", "/model_resolver/calculate-file-hash/cancel/{progress_id}"),
            ("GET", "/model_resolver/models"),
            ("POST", "/model_resolver/metadata-size-audit"),
            ("GET", "/model_resolver/metadata-build/capabilities"),
            ("POST", "/model_resolver/metadata-build/start"),
            ("GET", "/model_resolver/metadata-build/progress/{progress_id}"),
            ("POST", "/model_resolver/metadata-build/cancel/{progress_id}"),
            ("POST", "/model_resolver/loaded"),
            ("GET", "/model_resolver/loaded-progress/{loaded_id}"),
            ("POST", "/model_resolver/civitai-search"),
            ("POST", "/model_resolver/custom-url"),
            ("POST", "/model_resolver/model-details"),
            ("GET", "/model_resolver/search-progress/{progress_id}"),
            ("POST", "/model_resolver/search-cancel/{progress_id}"),
            ("POST", "/model_resolver/search"),
            ("POST", "/model_resolver/clear-search-cache"),
            ("POST", "/model_resolver/civitai/session-token/check"),
            ("POST", "/model_resolver/civitai/api-key/check"),
            ("POST", "/model_resolver/huggingface/token/check"),
            ("POST", "/model_resolver/brave/api-key/check"),
            ("GET", "/model_resolver/huggingface/author-index/status"),
            ("POST", "/model_resolver/huggingface/author-index/refresh"),
            ("GET", "/model_resolver/model-list/status"),
            ("POST", "/model_resolver/model-list/update"),
            ("POST", "/model_resolver/download"),
            ("GET", "/model_resolver/progress/{download_id}"),
            ("GET", "/model_resolver/progress"),
            ("POST", "/model_resolver/cancel/{download_id}"),
            ("POST", "/model_resolver/pause/{download_id}"),
            ("POST", "/model_resolver/resume/{download_id}"),
            ("POST", "/model_resolver/clear_completed_downloads"),
            ("GET", "/model_resolver/aria2/status"),
            ("POST", "/model_resolver/aria2/status"),
            ("POST", "/model_resolver/aria2/start"),
            ("GET", "/model_resolver/aria2/stop"),
            ("POST", "/model_resolver/aria2/stop"),
            ("POST", "/model_resolver/aria2/install"),
            ("GET", "/model_resolver/directories"),
            ("GET", "/model_resolver/root-directories"),
            ("GET", "/model_resolver/path-template-suggestions"),
            ("GET", "/model_resolver/capabilities"),
            ("GET", "/model_resolver/version"),
            ("GET", "/model_resolver/subfolders/{category}"),
            ("GET", "/model_resolver/logs/backend/export"),
            ("GET", "/model_resolver/settings"),
            ("POST", "/model_resolver/settings"),
        }
        self.assertEqual(expected_routes, set(routes_registered))

    def test_route_groups_cover_the_registered_feature_routes(self):
        grouped_routes = set().union(*self.ROUTE_GROUPS.values())
        self.assertEqual(
            grouped_routes,
            set(routes_registered)
            - {
                ("GET", "/model_resolver/base-models"),
                ("GET", "/model_resolver/base-models/status"),
                ("POST", "/model_resolver/base-models/update"),
                ("GET", "/model_resolver/version"),
                ("GET", "/model_resolver/logs/backend/export"),
                ("GET", "/model_resolver/settings"),
                ("POST", "/model_resolver/settings"),
            },
        )
        self.assertEqual(
            sum(len(routes) for routes in self.ROUTE_GROUPS.values()),
            len(grouped_routes),
        )

    def test_large_route_groups_are_partitioned_without_gaps_or_overlaps(self):
        partitioned_routes = set().union(*self.ROUTE_SUBGROUPS.values())
        expected_routes = (
            self.ROUTE_GROUPS["workflow"]
            | self.ROUTE_GROUPS["loaded"]
            | self.ROUTE_GROUPS["model_info"]
            | self.ROUTE_GROUPS["search"]
        )
        self.assertEqual(partitioned_routes, expected_routes)
        self.assertEqual(
            sum(len(routes) for routes in self.ROUTE_SUBGROUPS.values()),
            len(partitioned_routes),
        )

    def test_project_version_helpers_preserve_version_comparison_behavior(self):
        version_module = importlib.import_module("comfyui-model-resolver.core.version")
        self.assertEqual(
            version_module._extract_project_version('version = "1.2.3"'),
            "1.2.3",
        )
        self.assertEqual(version_module._extract_project_version("name = 'resolver'"), "")
        self.assertEqual(version_module._version_sort_key("v1.10.2-beta"), (1, 10, 2))
        self.assertEqual(version_module._version_sort_key("unknown"), ())

    def test_route_context_merges_namespaces_and_validates_required_values(self):
        context_module = importlib.import_module(
            "comfyui-model-resolver.core.routes.context"
        )
        values = {"shared": "first", "left": 1}
        context = context_module.RouteContext.from_namespaces(
            values,
            {"shared": "second", "right": 2},
        )
        values["left"] = 99

        self.assertEqual(context.get("shared"), "second")
        self.assertEqual(context.get("left"), 1)
        self.assertEqual(context.get("missing"), None)
        self.assertEqual(context.get("missing", "fallback"), "fallback")
        self.assertEqual(context.require("right"), 2)
        self.assertIn("right", context)
        self.assertEqual(len(context), 3)
        with self.assertRaisesRegex(KeyError, "Missing route dependency: missing"):
            context.require("missing")

    def test_project_version_info_reports_remote_update(self):
        version_module = importlib.import_module("comfyui-model-resolver.core.version")
        network_module = importlib.import_module("comfyui-model-resolver.core.network_utils")
        response = MagicMock(status_code=200, text='version = "2.0.0"')
        with (
            patch.object(version_module, "_get_local_project_version", return_value="1.0.0"),
            patch.object(network_module, "request_source_response", return_value=response),
        ):
            version_module._project_version_cache.update(
                {"checked_at": 0.0, "latest_version": None}
            )
            result = version_module._get_project_version_info()

        self.assertEqual(result["current_version"], "1.0.0")
        self.assertEqual(result["latest_version"], "2.0.0")
        self.assertEqual(result["status"], "update_available")
        self.assertEqual(result["github_url"], version_module.PROJECT_GITHUB_URL)

    def test_project_version_info_retries_github_and_uses_registry_fallback(self):
        version_module = importlib.import_module("comfyui-model-resolver.core.version")
        network_module = importlib.import_module("comfyui-model-resolver.core.network_utils")
        github_failures = [MagicMock(status_code=503) for _ in range(3)]
        registry_response = MagicMock(status_code=200)
        registry_response.json.return_value = {"version": "1.1.0"}
        request_source_response = MagicMock(
            side_effect=[*github_failures, registry_response]
        )
        with (
            patch.object(version_module, "_get_local_project_version", return_value="1.0.0"),
            patch.object(
                network_module,
                "request_source_response",
                request_source_response,
            ),
            patch.object(version_module.log, "debug") as debug_log,
        ):
            version_module._project_version_cache.update(
                {"checked_at": 0.0, "latest_version": None}
            )
            result = version_module._get_project_version_info()

        self.assertEqual(request_source_response.call_count, 4)
        self.assertEqual(
            [call.args[0] for call in request_source_response.call_args_list[:3]],
            [version_module.PROJECT_GITHUB_PYPROJECT_URL] * 3,
        )
        self.assertEqual(
            request_source_response.call_args_list[3].args[0],
            version_module.PROJECT_REGISTRY_INSTALL_URL,
        )
        self.assertEqual(result["latest_version"], "1.1.0")
        self.assertEqual(result["status"], "update_available")
        self.assertGreater(version_module._project_version_cache["checked_at"], 0.0)
        debug_log.assert_any_call("Comfy Registry install version check succeeded: v1.1.0")

    def test_project_version_info_does_not_cache_failed_checks(self):
        version_module = importlib.import_module("comfyui-model-resolver.core.version")
        network_module = importlib.import_module("comfyui-model-resolver.core.network_utils")
        request_source_response = MagicMock(return_value=None)
        with (
            patch.object(version_module, "_get_local_project_version", return_value="1.0.0"),
            patch.object(
                network_module,
                "request_source_response",
                request_source_response,
            ),
        ):
            version_module._project_version_cache.update(
                {"checked_at": 0.0, "latest_version": None}
            )
            first_result = version_module._get_project_version_info()
            first_call_count = request_source_response.call_count
            second_result = version_module._get_project_version_info()

        self.assertEqual(first_call_count, 4)
        self.assertEqual(request_source_response.call_count, 8)
        self.assertEqual(first_result["status"], "unavailable")
        self.assertEqual(second_result["status"], "unavailable")
        self.assertEqual(
            version_module._project_version_cache,
            {"checked_at": 0.0, "latest_version": None},
        )

    async def test_version_route_returns_version_payload(self):
        get_handler = routes_registered[("GET", "/model_resolver/version")]
        request = MagicMock()
        expected = {
            "current_version": "1.0.0",
            "latest_version": "1.1.0",
            "status": "update_available",
        }
        version_module = importlib.import_module("comfyui-model-resolver.core.version")
        with (
            patch.object(version_module, "_get_project_version_info", return_value=expected),
            patch("aiohttp.web.json_response") as mock_json_response,
        ):
            await get_handler(request)

        mock_json_response.assert_called_once_with(expected)

    async def test_settings_route_returns_settings_and_schema(self):
        get_handler = routes_registered[("GET", "/model_resolver/settings")]
        with patch("aiohttp.web.json_response") as mock_json_response:
            await get_handler(MagicMock())

        mock_json_response.assert_called_once()
        payload = mock_json_response.call_args.args[0]
        self.assertIn("settings", payload)
        self.assertIn("schema", payload)

    async def test_metadata_capabilities_route_returns_capabilities(self):
        get_handler = routes_registered[("GET", "/model_resolver/metadata-build/capabilities")]
        with patch("aiohttp.web.json_response") as mock_json_response:
            await get_handler(MagicMock())

        payload = mock_json_response.call_args.args[0]
        self.assertIn("metadata_modes", payload)
        self.assertIn("default_metadata_mode", payload)

    async def test_custom_url_route_rejects_missing_url(self):
        post_handler = routes_registered[("POST", "/model_resolver/custom-url")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "URL is required"},
            status=400,
        )

    async def test_custom_url_route_returns_mocked_huggingface_result(self):
        post_handler = routes_registered[("POST", "/model_resolver/custom-url")]
        url = "https://example.com/model.safetensors"
        request = AsyncMock()
        request.json.return_value = {
            "url": url,
            "filename": "model.safetensors",
            "category": "checkpoints",
        }

        async def fake_to_thread(func, *args, **kwargs):
            function_name = getattr(func, "__name__", "")
            if function_name == "validate_public_http_url":
                return args[0]
            if function_name == "build_huggingface_custom_result":
                self.assertEqual(args, (url, "model.safetensors", None))
                self.assertEqual(kwargs, {})
                return {
                    "source": "huggingface",
                    "filename": "model.safetensors",
                    "url": url,
                    "download_url": url,
                }
            self.fail(f"Unexpected threaded function: {function_name}")

        with (
            patch("asyncio.to_thread", side_effect=fake_to_thread),
            patch("aiohttp.web.json_response") as mock_json_response,
        ):
            await post_handler(request)

        payload = mock_json_response.call_args.args[0]
        self.assertTrue(payload["success"])
        self.assertEqual(payload["source"], "huggingface")
        self.assertEqual(payload["result"]["provided_url"], url)

    async def test_analyze_route_rejects_missing_workflow(self):
        post_handler = routes_registered[("POST", "/model_resolver/analyze")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Workflow JSON is required"},
            status=400,
        )

    async def test_analyze_route_returns_threaded_result(self):
        post_handler = routes_registered[("POST", "/model_resolver/analyze")]
        workflow = {"nodes": []}
        request = AsyncMock()
        request.json.return_value = {
            "workflow": workflow,
            "analysis_id": "analysis-test",
        }

        async def fake_to_thread(func, *args, **kwargs):
            self.assertEqual(getattr(func, "__name__", ""), "analyze_and_find_matches")
            self.assertEqual(args[:3], (workflow, 0.0, 10))
            self.assertEqual(kwargs["force_rescan"], False)
            return {
                "missing_models": [
                    {
                        "name": "already-matched.safetensors",
                        "matches": [{"confidence": 100}],
                    }
                ]
            }

        with (
            patch("asyncio.to_thread", side_effect=fake_to_thread),
            patch("aiohttp.web.json_response") as mock_json_response,
        ):
            await post_handler(request)

        payload = mock_json_response.call_args.args[0]
        self.assertEqual(payload["total_missing"], 1)
        self.assertEqual(payload["missing_models"][0]["name"], "already-matched.safetensors")

    async def test_analyze_route_rejects_non_object_workflow(self):
        post_handler = routes_registered[("POST", "/model_resolver/analyze")]
        request = AsyncMock()
        request.json.return_value = {"workflow": ["invalid-workflow"]}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Workflow JSON must be an object"},
            status=400,
        )

    async def test_resolve_route_rejects_missing_resolutions(self):
        post_handler = routes_registered[("POST", "/model_resolver/resolve")]
        request = AsyncMock()
        request.json.return_value = {"workflow": {"nodes": []}}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Resolutions array is required"},
            status=400,
        )

    async def test_resolve_route_returns_updated_workflow(self):
        post_handler = routes_registered[("POST", "/model_resolver/resolve")]
        workflow = {"nodes": []}
        request = AsyncMock()
        request.json.return_value = {
            "workflow": workflow,
            "resolutions": [{"node_id": 1, "widget_index": 0}],
        }

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"workflow": workflow, "success": True}
        )

    async def test_loaded_models_route_rejects_missing_workflow(self):
        post_handler = routes_registered[("POST", "/model_resolver/loaded")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Workflow JSON is required"},
            status=400,
        )

    async def test_loaded_models_route_returns_threaded_result(self):
        post_handler = routes_registered[("POST", "/model_resolver/loaded")]
        workflow = {"nodes": []}
        request = AsyncMock()
        request.json.return_value = {
            "workflow": workflow,
            "loaded_id": "loaded-test",
        }

        async def fake_to_thread(func, *args, **kwargs):
            self.assertEqual(getattr(func, "__name__", ""), "build_loaded_models_response")
            self.assertEqual(args, ())
            self.assertEqual(kwargs, {})
            return {"loaded_models": [], "total": 0}

        with (
            patch("asyncio.to_thread", side_effect=fake_to_thread),
            patch("aiohttp.web.json_response") as mock_json_response,
        ):
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"loaded_models": [], "total": 0}
        )

    async def test_loaded_models_route_rejects_non_object_workflow(self):
        post_handler = routes_registered[("POST", "/model_resolver/loaded")]
        request = AsyncMock()
        request.json.return_value = {"workflow": ["invalid-workflow"]}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Workflow JSON must be an object"},
            status=400,
        )

    async def test_local_matches_by_hash_route_rejects_missing_hash(self):
        post_handler = routes_registered[("POST", "/model_resolver/local-matches-by-hash")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "sha256 is required"},
            status=400,
        )

    async def test_download_progress_route_returns_not_found(self):
        get_handler = routes_registered[("GET", "/model_resolver/progress/{download_id}")]
        request = MagicMock()
        request.match_info = {"download_id": "missing-download"}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await get_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Download not found"},
            status=404,
        )

    async def test_source_search_route_rejects_missing_filename(self):
        post_handler = routes_registered[("POST", "/model_resolver/search")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {
                "error": (
                    "Filename is required for non-URN, or model_id+version_id for URN"
                )
            },
            status=400,
        )

    async def test_source_search_route_returns_empty_result_for_unknown_source(self):
        post_handler = routes_registered[("POST", "/model_resolver/search")]
        request = AsyncMock()
        request.json.return_value = {
            "filename": "model.safetensors",
            "sources": ["unknown"],
            "progress_id": "empty-search-test",
        }

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        payload = mock_json_response.call_args.args[0]
        self.assertFalse(payload["found"])
        self.assertEqual(payload["searched_sources"], ["unknown"])
        self.assertEqual(payload["local_hash_matches"], [])

    async def test_directories_capabilities_route_returns_source_capabilities(self):
        get_handler = routes_registered[("GET", "/model_resolver/capabilities")]

        with patch("aiohttp.web.json_response") as mock_json_response:
            await get_handler(MagicMock())

        payload = mock_json_response.call_args.args[0]
        self.assertIn("sources", payload)
        self.assertIn("node_rules", payload)

    async def test_local_model_hashes_route_rejects_missing_path(self):
        post_handler = routes_registered[("POST", "/model_resolver/local-model-hashes")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "path is required"},
            status=400,
        )

    async def test_model_details_route_rejects_unsupported_source(self):
        post_handler = routes_registered[("POST", "/model_resolver/model-details")]
        request = AsyncMock()
        request.json.return_value = {"source": "unknown", "model_id": 1}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Unsupported model details source"},
            status=400,
        )

    async def test_model_details_route_returns_threaded_provider_result(self):
        post_handler = routes_registered[("POST", "/model_resolver/model-details")]
        request = AsyncMock()
        request.json.return_value = {
            "source": "civitai",
            "model_id": "123",
            "version_id": "456",
        }
        expected = {"source": "civitai", "model_id": 123, "version_id": 456}

        async def fake_to_thread(func, *args, **kwargs):
            self.assertEqual(getattr(func, "__name__", ""), "get_civitai_model_details")
            self.assertEqual(args, (123, 456, None))
            self.assertEqual(kwargs, {})
            return expected

        with (
            patch("asyncio.to_thread", side_effect=fake_to_thread),
            patch("aiohttp.web.json_response") as mock_json_response,
        ):
            await post_handler(request)

        mock_json_response.assert_called_once_with(expected)

    async def test_model_details_route_rejects_missing_supported_model_id(self):
        post_handler = routes_registered[("POST", "/model_resolver/model-details")]
        request = AsyncMock()
        request.json.return_value = {"source": "civitai"}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "model_id is required"},
            status=400,
        )

    async def test_civitai_search_route_rejects_missing_filename(self):
        post_handler = routes_registered[("POST", "/model_resolver/civitai-search")]
        request = AsyncMock()
        request.json.return_value = {}

        with patch("aiohttp.web.json_response") as mock_json_response:
            await post_handler(request)

        mock_json_response.assert_called_once_with(
            {"error": "Filename is required"},
            status=400,
        )
    
    @classmethod
    def tearDownClass(cls):
        patch_load_settings.stop()
        patch_get_aria2_status.stop()

    def test_downloader_calculate_file_sha256(self):
        import tempfile

        from core.downloader import calculate_file_sha256
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "test.txt")
            with open(file_path, "wb") as f:
                f.write(b"hello world")
            # SHA256 of "hello world" is:
            # b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
            expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
            self.assertEqual(calculate_file_sha256(file_path), expected)

    def test_model_list_normalize_filename(self):
        from core.matcher import normalize_filename
        self.assertEqual(normalize_filename("My_Model-File.safetensors"), "my model file")

    def test_model_list_similarity(self):
        from core.matcher import calculate_similarity
        self.assertAlmostEqual(calculate_similarity("model_a", "model_a"), 1.0)
        self.assertLess(calculate_similarity("model_a", "model_b"), 1.0)

    @patch("requests.get")
    def test_model_list_fetch_json_url_requests(self, mock_get):
        from core.sources.model_list import _fetch_json_url
        
        mock_response = MagicMock()
        mock_response.json.return_value = {"hello": "world"}
        mock_response.status_code = 200
        mock_get.return_value = mock_response
        
        result = _fetch_json_url("http://example.com/test.json")
        mock_get.assert_called_once()
        self.assertEqual(result, {"hello": "world"})

    def test_civarchive_normalize_archive_image(self):
        from core.type_utils import normalize_model_image
        raw_image = {
            "url": "https://image.civitai.com/x/width=1200/12345.jpeg",
            "id": 12345,
        }
        normalized = normalize_model_image(raw_image)
        self.assertEqual(normalized["url"], "https://image.civitai.com/x/width=1200/12345.jpeg")
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/images/12345")

    async def test_aria2_status_routes(self):
        mock_load_settings.reset_mock()
        mock_get_aria2_status.reset_mock()
        
        mock_load_settings.return_value = {"aria2c_path": "default_path"}
        mock_get_aria2_status.return_value = {"status": "running"}
        
        # Test GET route
        get_handler = routes_registered.get(("GET", "/model_resolver/aria2/status"))
        self.assertIsNotNone(get_handler)
        
        mock_request = MagicMock()
        mock_request.method = "GET"
        
        with patch("aiohttp.web.json_response") as mock_json_res:
            await get_handler(mock_request)
            mock_json_res.assert_called_once_with({"status": "running"})
            mock_get_aria2_status.assert_called_once_with({"aria2c_path": "default_path"})
            
        mock_get_aria2_status.reset_mock()
        
        # Test POST route
        post_handler = routes_registered.get(("POST", "/model_resolver/aria2/status"))
        self.assertIsNotNone(post_handler)
        
        mock_request_post = AsyncMock()
        mock_request_post.method = "POST"
        mock_request_post.json.return_value = {"aria2c_path": "custom_path"}
        
        with patch("aiohttp.web.json_response") as mock_json_res:
            await post_handler(mock_request_post)
            mock_json_res.assert_called_once_with({"status": "running"})
            mock_get_aria2_status.assert_called_once_with({"aria2c_path": "custom_path"})

    async def test_workflow_model_hashes_reuses_shared_inventory(self):
        post_handler = routes_registered.get(
            ("POST", "/model_resolver/workflow-model-hashes")
        )
        self.assertIsNotNone(post_handler)

        workflow = {"nodes": []}
        mock_request = AsyncMock()
        mock_request.json.return_value = {"workflow": workflow}
        threaded_functions = []

        async def fake_to_thread(func, *args, **kwargs):
            function_name = getattr(func, "__name__", "")
            threaded_functions.append(function_name or "<settings>")
            if len(threaded_functions) == 1:
                return {"workflow_hash_metadata_enabled": True}
            if function_name == "get_workflow_model_inventory":
                self.assertEqual((workflow,), args)
                self.assertEqual({}, kwargs)
                return {"available_models": [], "model_refs": []}
            self.fail(f"Unexpected threaded function: {function_name}")

        with (
            patch("asyncio.to_thread", side_effect=fake_to_thread),
            patch("aiohttp.web.json_response") as mock_json_res,
        ):
            await post_handler(mock_request)

        self.assertEqual(
            ["<settings>", "get_workflow_model_inventory"],
            threaded_functions,
        )
        response_data = mock_json_res.call_args.args[0]
        self.assertTrue(response_data["success"])
        self.assertEqual(0, response_data["count"])

    async def test_search_progress_route(self):
        progress_id = "test_search_job"
        
        get_handler = routes_registered.get(("GET", "/model_resolver/search-progress/{progress_id}"))
        self.assertIsNotNone(get_handler)
        
        target_extension = _find_bound_extension(get_handler) or extension
        target_extension.search_tracker.update(progress_id, status="running", stage="civitai", message="Searching Civitai", percent=50)
        
        mock_request = MagicMock()
        mock_request.match_info = {"progress_id": progress_id}
        
        with patch("aiohttp.web.json_response") as mock_json_res:
            await get_handler(mock_request)
            mock_json_res.assert_called_once()
            response_data = mock_json_res.call_args[0][0]
            self.assertTrue(response_data.get("exists"))
            self.assertEqual(response_data.get("status"), "running")
            self.assertEqual(response_data.get("percent"), 50.0)

    async def test_search_progress_route_rejects_missing_id(self):
        get_handler = routes_registered[("GET", "/model_resolver/search-progress/{progress_id}")]
        request = MagicMock()
        request.match_info = {"progress_id": ""}

        with patch("aiohttp.web.json_response") as mock_json_res:
            await get_handler(request)

        mock_json_res.assert_called_once_with(
            {"error": "progress_id is required"},
            status=400,
        )

    async def test_search_cancel_route(self):
        progress_id = "test_cancel_job"
        
        cancel_handler = routes_registered.get(("POST", "/model_resolver/search-cancel/{progress_id}"))
        self.assertIsNotNone(cancel_handler)
        
        target_extension = _find_bound_extension(cancel_handler) or extension
        target_extension.search_tracker.update(progress_id, status="running")
        
        mock_request = MagicMock()
        mock_request.match_info = {"progress_id": progress_id}
        
        with patch("aiohttp.web.json_response") as mock_json_res:
            await cancel_handler(mock_request)
            mock_json_res.assert_called_once()
            response_data = mock_json_res.call_args[0][0]
            self.assertTrue(response_data.get("success"))
            self.assertTrue(response_data.get("cancelled"))
            self.assertTrue(target_extension.search_tracker.is_cancelled(progress_id))


    async def test_root_directories_route_skips_non_model_categories(self):
        import tempfile

        get_handler = routes_registered.get(("GET", "/model_resolver/root-directories"))
        self.assertIsNotNone(get_handler)

        with tempfile.TemporaryDirectory() as tmpdir:
            checkpoints_dir = os.path.join(tmpdir, "models", "checkpoints")
            custom_nodes_dir = os.path.join(tmpdir, "custom_nodes")
            configs_dir = os.path.join(tmpdir, "configs")
            os.makedirs(checkpoints_dir)
            os.makedirs(custom_nodes_dir)
            os.makedirs(configs_dir)

            mock_folder_paths = MagicMock()
            mock_folder_paths.__file__ = os.path.join(tmpdir, "folder_paths.py")
            mock_folder_paths.folder_names_and_paths = {
                "checkpoints": ([checkpoints_dir], set()),
                "custom_nodes": ([custom_nodes_dir], set()),
                "configs": ([configs_dir], set()),
            }
            mock_folder_paths.get_folder_paths.side_effect = (
                lambda category: mock_folder_paths.folder_names_and_paths.get(
                    category, ([], set())
                )[0]
            )

            mock_request = MagicMock()
            with (
                patch.dict(sys.modules, {"folder_paths": mock_folder_paths}),
                patch("aiohttp.web.json_response") as mock_json_res,
            ):
                await get_handler(mock_request)

            mock_json_res.assert_called_once()
            response_data = mock_json_res.call_args[0][0]
            response_kwargs = mock_json_res.call_args.kwargs
            self.assertNotIn("error", response_data)
            self.assertNotEqual(response_kwargs.get("status"), 500)
            self.assertIn("checkpoints", response_data)
            self.assertNotIn("custom_nodes", response_data)
            self.assertNotIn("configs", response_data)

    def test_category_folder_keys_mapping(self):
        from core.type_utils import get_category_folder_keys
        expected_diffusion_keys = [
            "diffusion_models",
            "unet",
            "unet_gguf",
            "model_gguf",
        ]
        self.assertEqual(get_category_folder_keys("diffusion_models"), expected_diffusion_keys)
        self.assertEqual(get_category_folder_keys("model_gguf"), expected_diffusion_keys)
        self.assertEqual(get_category_folder_keys("unet_gguf"), expected_diffusion_keys)
        self.assertEqual(get_category_folder_keys("text_encoders"), ["text_encoders", "clip"])
        self.assertEqual(get_category_folder_keys("checkpoints"), ["checkpoints"])

    def test_get_enabled_download_categories(self):
        from core.type_utils import get_enabled_download_categories
        folders = ["checkpoints", "custom_nodes", "unet", "my_new_cat"]
        categories = get_enabled_download_categories(folders)
        self.assertIn("checkpoints", categories)
        self.assertIn("diffusion_models", categories)
        self.assertIn("my_new_cat", categories)
        self.assertNotIn("custom_nodes", categories)
        self.assertNotIn("unet", categories)

    def test_metadata_sidecar_paths_behavior(self):
        from core.path_utils import (
            _metadata_sidecar_paths,
            get_metadata_sidecar_path,
            get_model_resolver_sidecar_path,
            get_safe_metadata_sidecar_path,
            get_safe_model_resolver_sidecar_path,
        )

        model_path = os.path.abspath("e:/models/checkpoints/sd15.safetensors")
        expected_sidecar = os.path.abspath("e:/models/checkpoints/sd15.metadata.json")
        expected_resolver_sidecar = os.path.abspath(
            "e:/models/checkpoints/sd15.safetensors.modelresolver.json"
        )

        self.assertEqual(get_metadata_sidecar_path(model_path), expected_sidecar)
        self.assertEqual(
            get_model_resolver_sidecar_path(model_path),
            expected_resolver_sidecar,
        )
        
        # Safe sidecar path checks
        safe_path = get_safe_metadata_sidecar_path(model_path)
        self.assertEqual(os.path.normcase(safe_path), os.path.normcase(expected_sidecar))
        safe_resolver_path = get_safe_model_resolver_sidecar_path(model_path)
        self.assertEqual(
            os.path.normcase(safe_resolver_path),
            os.path.normcase(expected_resolver_sidecar),
        )
        
        # Test MB and MA sidecar candidates
        candidates = _metadata_sidecar_paths(model_path)
        self.assertIn(expected_sidecar, candidates)

    def test_select_primary_model_file_extended(self):
        from core.type_utils import select_primary_model_file
        
        files = [
            {"id": 1, "name": "other.safetensors", "primary": False, "type": "model", "url": "http://x"},
            {"id": 2, "name": "main.safetensors", "primary": True, "type": "model"},
            {"id": 3, "name": "config.json", "primary": False, "type": "config"}
        ]
        
        # Original logic matches primary: True
        self.assertEqual(select_primary_model_file(files)["id"], 2)

        # Expected filename matches by name
        self.assertEqual(select_primary_model_file(files, expected_filename="other.safetensors")["id"], 1)

        # Require download excludes main.safetensors because it has no download url
        self.assertEqual(select_primary_model_file(files, require_download=True)["id"], 1)

    def _build_model_service_for_unit_test(
        self,
        service_module="model_service",
        service_class="ModelService",
        **dependencies,
    ):
        from dataclasses import fields

        from aiohttp import web

        RouteContext = importlib.import_module(
            "comfyui-model-resolver.core.routes.context"
        ).RouteContext
        service_type = getattr(
            importlib.import_module(
                f"comfyui-model-resolver.core.services.{service_module}"
            ),
            service_class,
        )
        dependency_class_name = {
            "civitai_search_service": "CivitAISearchDependencies",
            "custom_url_service": "CustomUrlDependencies",
            "model_details_service": "ModelDetailsDependencies",
        }.get(service_module)
        if dependency_class_name:
            dependency_type = getattr(
                importlib.import_module(
                    "comfyui-model-resolver.core.services.model_utils"
                ),
                dependency_class_name,
            )
            for field in fields(dependency_type):
                if field.name not in {"logger", "web"}:
                    dependencies.setdefault(field.name, MagicMock())

        extension = MagicMock()
        extension.logger = MagicMock()
        values = {
            "self": extension,
            "download_available": True,
            "web": web,
        }
        values.update(dependencies)
        return service_type(RouteContext(values))

    async def test_model_service_civitai_search_validates_filename(self):
        def to_bool(value, default=False):
            return default if value is None else bool(value)

        service = self._build_model_service_for_unit_test(
            service_module="civitai_search_service",
            service_class="CivitAISearchService",
            to_bool=to_bool,
            normalize_sha256=lambda value: value,
        )
        request = AsyncMock()
        request.json.return_value = {}

        response = await service.civitai_search(request)

        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.text)["error"], "Filename is required")

    async def test_model_service_custom_url_validates_url(self):
        service = self._build_model_service_for_unit_test(
            service_module="custom_url_service",
            service_class="CustomUrlService",
        )
        request = AsyncMock()
        request.json.return_value = {}

        response = await service.custom_url(request)

        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.text)["error"], "URL is required")

    async def test_model_service_model_details_validates_source(self):
        service = self._build_model_service_for_unit_test(
            service_module="model_details_service",
            service_class="ModelDetailsService",
        )
        request = AsyncMock()
        request.json.return_value = {"source": "unsupported", "model_id": 1}

        response = await service.model_details(request)

        self.assertEqual(response.status, 400)
        self.assertEqual(
            json.loads(response.text)["error"],
            "Unsupported model details source",
        )

    def test_model_service_dependencies_are_minimal_dataclasses(self):
        from dataclasses import fields, is_dataclass

        dependencies_module = importlib.import_module(
            "comfyui-model-resolver.core.services.model_utils"
        )
        expected_fields = {
            "CivitAISearchDependencies": {
                "logger",
                "download_available",
                "extract_sha256_from_metadata",
                "find_external_metadata_sidecar_path",
                "find_local_file_path",
                "get_existing_model_preview_path",
                "get_filename_from_path",
                "get_model_resolver_sidecar_path",
                "is_path_in_configured_model_roots",
                "looks_like_model_file",
                "normalize_category_to_model_type",
                "normalize_sha256",
                "read_json_safe",
                "request_public_url",
                "resolve_civarchive_by_hash",
                "search_huggingface_for_file",
                "to_bool",
                "web",
                "write_model_resolver_metadata",
            },
            "CustomUrlDependencies": {
                "logger",
                "UnsafeUrlError",
                "asyncio",
                "build_civarchive_custom_result",
                "build_civitai_custom_result",
                "build_huggingface_custom_result",
                "extract_sha256_from_metadata",
                "get_civarchive_model_details",
                "get_civitai_download_url",
                "get_civitai_model_details",
                "get_filename_from_path",
                "host_matches_domain",
                "looks_like_model_file",
                "normalize_category_to_model_type",
                "normalize_sha256",
                "parse_civarchive_url",
                "parse_civitai_url",
                "resolve_civarchive_by_hash",
                "resolve_civarchive_model_version",
                "resolve_civitai_version_custom_result",
                "search_local_matches_by_hash",
                "time",
                "validate_public_http_url",
                "web",
            },
            "ModelDetailsDependencies": {
                "logger",
                "asyncio",
                "download_available",
                "get_civarchive_model_details",
                "get_civitai_model_details",
                "get_huggingface_model_details",
                "web",
            },
        }

        for class_name, expected in expected_fields.items():
            dependency_type = getattr(dependencies_module, class_name)
            self.assertTrue(is_dataclass(dependency_type))
            self.assertEqual(
                {field.name for field in fields(dependency_type)},
                expected,
            )

    def test_model_service_dependencies_require_route_context_values(self):
        dependencies_module = importlib.import_module(
            "comfyui-model-resolver.core.services.model_utils"
        )
        RouteContext = importlib.import_module(
            "comfyui-model-resolver.core.routes.context"
        ).RouteContext
        extension = MagicMock()
        extension.logger = MagicMock()

        for class_name in (
            "CivitAISearchDependencies",
            "CustomUrlDependencies",
            "ModelDetailsDependencies",
        ):
            dependency_type = getattr(dependencies_module, class_name)
            with self.assertRaises(KeyError):
                dependency_type.from_context(RouteContext({"self": extension}))

    async def test_civitai_service_rejects_resolved_path_outside_model_roots(self):
        def to_bool(value, default=False):
            return default if value is None else bool(value)

        service = self._build_model_service_for_unit_test(
            service_module="civitai_search_service",
            service_class="CivitAISearchService",
            to_bool=to_bool,
            normalize_sha256=lambda value: "",
            is_path_in_configured_model_roots=lambda path: False,
        )
        request = AsyncMock()
        request.json.return_value = {
            "filename": "model.safetensors",
            "resolved_path": "E:/outside/model.safetensors",
        }

        response = await service.civitai_search(request)

        self.assertEqual(response.status, 403)
        self.assertEqual(
            json.loads(response.text)["error"],
            "resolved_path is outside configured model directories",
        )

    async def test_custom_url_service_rejects_unsafe_url(self):
        class TestUnsafeUrlError(Exception):
            pass

        async def to_thread(function, *args, **kwargs):
            return function(*args, **kwargs)

        def validate_public_http_url(url):
            raise TestUnsafeUrlError("Unsafe URL")

        service = self._build_model_service_for_unit_test(
            service_module="custom_url_service",
            service_class="CustomUrlService",
            UnsafeUrlError=TestUnsafeUrlError,
            asyncio=type("TestAsyncio", (), {"to_thread": staticmethod(to_thread)}),
            validate_public_http_url=validate_public_http_url,
        )
        request = AsyncMock()
        request.json.return_value = {"url": "http://localhost/model.safetensors"}

        response = await service.custom_url(request)

        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.text)["error"], "Unsafe URL")

    async def test_model_details_service_returns_unavailable_when_providers_are_missing(self):
        service = self._build_model_service_for_unit_test(
            service_module="model_details_service",
            service_class="ModelDetailsService",
            download_available=False,
        )
        request = AsyncMock()
        request.json.return_value = {"source": "civitai", "model_id": 1}

        response = await service.model_details(request)

        self.assertEqual(response.status, 503)
        self.assertEqual(
            json.loads(response.text)["error"],
            "Download providers are not available",
        )

    async def test_model_details_service_returns_not_found_for_empty_provider_result(self):
        async def to_thread(function, *args, **kwargs):
            return None

        service = self._build_model_service_for_unit_test(
            service_module="model_details_service",
            service_class="ModelDetailsService",
            asyncio=type("TestAsyncio", (), {"to_thread": staticmethod(to_thread)}),
        )
        request = AsyncMock()
        request.json.return_value = {"source": "civitai", "model_id": 1}

        response = await service.model_details(request)

        self.assertEqual(response.status, 404)
        self.assertEqual(
            json.loads(response.text)["error"],
            "Model details not found",
        )

import importlib
import os
import sys
import unittest
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



class TestRefactoringTargets(unittest.IsolatedAsyncioTestCase):
    
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

    async def test_search_progress_route(self):
        progress_id = "test_search_job"
        
        get_handler = routes_registered.get(("GET", "/model_resolver/search-progress/{progress_id}"))
        self.assertIsNotNone(get_handler)
        
        bound_extension = None
        if hasattr(get_handler, "__closure__") and get_handler.__closure__:
            for cell in get_handler.__closure__:
                val = cell.cell_contents
                if hasattr(val, "search_tracker"):
                    bound_extension = val
                    break
                    
        target_extension = bound_extension or extension
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

    async def test_search_cancel_route(self):
        progress_id = "test_cancel_job"
        
        cancel_handler = routes_registered.get(("POST", "/model_resolver/search-cancel/{progress_id}"))
        self.assertIsNotNone(cancel_handler)
        
        bound_extension = None
        if hasattr(cancel_handler, "__closure__") and cancel_handler.__closure__:
            for cell in cancel_handler.__closure__:
                val = cell.cell_contents
                if hasattr(val, "search_tracker"):
                    bound_extension = val
                    break
                    
        target_extension = bound_extension or extension
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
            with patch.dict(sys.modules, {"folder_paths": mock_folder_paths}):
                with patch("aiohttp.web.json_response") as mock_json_res:
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
        from core.metadata_audit import _metadata_sidecar_paths as ma_sidecars
        from core.metadata_builder import _metadata_sidecar_paths as mb_sidecars
        from core.path_utils import get_metadata_sidecar_path, get_safe_metadata_sidecar_path

        model_path = os.path.abspath("e:/models/checkpoints/sd15.safetensors")
        expected_sidecar = os.path.abspath("e:/models/checkpoints/sd15.metadata.json")

        self.assertEqual(get_metadata_sidecar_path(model_path), expected_sidecar)
        
        # Safe sidecar path checks
        safe_path = get_safe_metadata_sidecar_path(model_path)
        self.assertEqual(os.path.normcase(safe_path), os.path.normcase(expected_sidecar))
        
        # Test MB and MA sidecar candidates
        mb_candidates = mb_sidecars(model_path)
        ma_candidates = ma_sidecars(model_path)
        self.assertEqual(mb_candidates, ma_candidates)
        self.assertIn(expected_sidecar, mb_candidates)

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

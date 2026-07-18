import sys
import os
import unittest
from unittest.mock import MagicMock, patch

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from core.matcher import MODEL_TITLE_MATCH_THRESHOLD
from core.sources.lora_manager_archive import _normalize_model_type
from core.type_utils import (
    normalize_lora_manager_type,
    normalize_model_file_info,
    build_search_result,
)


class TestRefactoringUnification(unittest.TestCase):

    def tearDown(self):
        from core.sources.popular import reload_databases
        reload_databases()

    def test_thresholds(self):
        self.assertEqual(MODEL_TITLE_MATCH_THRESHOLD, 82.0)

    def test_normalize_lora_manager_type(self):
        self.assertEqual(normalize_lora_manager_type("loras"), "lora")
        self.assertEqual(normalize_lora_manager_type("checkpoints"), "checkpoint")
        self.assertEqual(normalize_lora_manager_type("embedding"), "textualinversion")
        self.assertEqual(normalize_lora_manager_type("unknown"), "unknown")

    def test_normalize_model_file_info(self):
        raw_file = {
            "id": 1,
            "name": "test.safetensors",
            "sizeKB": 100,
            "primary": True,
            "hashes": {"sha256": "abc"},
        }
        res = normalize_model_file_info(raw_file, model_id=10, version_id=20)
        self.assertEqual(res["id"], 1)
        self.assertEqual(res["name"], "test.safetensors")
        self.assertEqual(res["size"], 100 * 1024)
        self.assertTrue(res["primary"])
        self.assertEqual(res["sha256"], "abc")
        self.assertEqual(res["model_id"], 10)
        self.assertEqual(res["version_id"], 20)

    def test_build_search_result(self):
        res = build_search_result(
            source="civitai",
            model_id=100,
            version_id=200,
            name="Test Model",
            filename="test.safetensors",
            extra_field="hello_world",
        )
        self.assertEqual(res["source"], "civitai")
        self.assertEqual(res["model_id"], 100)
        self.assertEqual(res["version_id"], 200)
        self.assertEqual(res["name"], "Test Model")
        self.assertEqual(res["filename"], "test.safetensors")
        self.assertEqual(res["extra_field"], "hello_world")

    @patch("requests.get")
    def test_request_page_text_success(self, mock_get):
        from core.sources.civarchive import _request_page_text
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html>content</html>"
        mock_get.return_value = mock_response

        res = _request_page_text("test_path")
        self.assertEqual(res, "<html>content</html>")
        mock_get.assert_called_once()

    @patch("requests.get")
    def test_request_page_text_fail(self, mock_get):
        from core.sources.civarchive import _request_page_text
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_get.return_value = mock_response

        res = _request_page_text("test_path")
        self.assertIsNone(res)

        mock_get.side_effect = Exception("network error")
        res2 = _request_page_text("test_path")
        self.assertIsNone(res2)

    @patch("requests.get")
    def test_get_base_models_status_remote(self, mock_get):
        from core.sources.popular import get_base_models_status
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"BaseModel": ["SD 1.5", "SDXL 1.0"]}
        mock_get.return_value = mock_response

        res = get_base_models_status(check_remote=True)
        self.assertIn("local_count", res)
        self.assertIn("update_available", res)
        mock_get.assert_called_once_with("https://civitai.com/api/v1/enums", params={}, headers=None, timeout=15)

    @patch("core.sources.popular.base_models_mgr")
    @patch("requests.get")
    def test_update_base_models_from_remote_success(self, mock_get, mock_base_models_mgr):
        from core.sources.popular import update_base_models_from_remote
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"BaseModel": ["SD 1.5", "SDXL 1.0", "NewModel"]}
        mock_get.return_value = mock_response

        # Mock reading base-models.json
        mock_base_models_mgr.read_data.return_value = {
            "base_models": [
                {"name": "SD 1.5", "aliases": ["sd1.5"]},
                {"name": "SDXL 1.0", "aliases": ["sdxl"]},
            ]
        }
        mock_base_models_mgr.read_meta.return_value = {}

        res = update_base_models_from_remote()
        self.assertTrue(res.get("updated"))
        self.assertEqual(res.get("new_models_added"), 1)
        self.assertIn("NewModel", res.get("new_models_added_list", []))
        
        # Verify it saved the updated catalog
        mock_base_models_mgr.save.assert_called_once()
        saved_data = mock_base_models_mgr.save.call_args[0][0]
        self.assertEqual(len(saved_data["base_models"]), 3)


    @patch("core.sources.model_list.catalog_mgr")
    @patch("core.sources.model_list._get_remote_model_list_info")
    @patch("core.sources.model_list._fetch_json_url")
    def test_model_list_lifecycle_status_and_update(self, mock_fetch_json, mock_get_remote, mock_catalog_mgr):
        from core.sources.model_list import get_model_list_update_status, update_model_list_from_remote
        
        # Mock responses
        mock_catalog_mgr.read_data.side_effect = [
            {"models": [{"name": "ModelA"}]},  # Data file read
            {"models": [{"name": "ModelA"}]},  # Reset update
            {"models": [{"name": "ModelA"}, {"name": "ModelB"}]}  # updated check
        ]
        mock_catalog_mgr.read_meta.side_effect = [
            {"sha": "123", "updated_at": "2026"},  # Meta file read
            {"sha": "123"},  # Reset update
            {"sha": "456"}
        ]
        
        mock_get_remote.return_value = {
            "sha": "123",
            "size": 100,
            "download_url": "https://dummy",
            "html_url": "https://dummy_html"
        }
        
        status = get_model_list_update_status(check_remote=True)
        self.assertEqual(status["local_count"], 1)
        self.assertTrue(status["can_compare"])
        
        # Reset mock
        mock_get_remote.return_value = {
            "sha": "456",
            "size": 100,
            "download_url": "https://dummy",
            "html_url": "https://dummy_html"
        }
        mock_fetch_json.return_value = {"models": [{"name": "ModelA"}, {"name": "ModelB"}]}
        res = update_model_list_from_remote()
        self.assertTrue(res.get("updated"))
        self.assertTrue(mock_catalog_mgr.save.called)


    def test_tracker_progress_updates(self):
        import importlib
        node_mod = importlib.import_module("comfyui-model-resolver")
        JobProgressTracker = node_mod.JobProgressTracker
        
        tracker = JobProgressTracker("Test Tracker")
        tracker.update("job123", status="running", percent=50)
        state = tracker.get("job123")
        self.assertEqual(state["status"], "running")
        self.assertEqual(state["percent"], 50)

    def test_get_filename_from_path(self):
        from core.path_utils import get_filename_from_path
        self.assertEqual(get_filename_from_path("some/path/to/model.safetensors"), "model.safetensors")
        self.assertEqual(get_filename_from_path("some\\path\\to\\model.safetensors"), "model.safetensors")
        self.assertEqual(get_filename_from_path("model.safetensors"), "model.safetensors")
        self.assertEqual(get_filename_from_path(""), "")
        self.assertEqual(get_filename_from_path(None), "")

    def test_alphanumeric_normalizers(self):
        from core.matcher import normalize_base_model
        from core.path_utils import _normalize_base_model_token
        from core.path_templates import _normalize_token
        from core.settings import _normalize_tag

        inputs = ["SD 1.5", "sd-xl_1.0!!", "Flux.1-dev", "", None]
        for val in inputs:
            res_matcher = normalize_base_model(val)
            res_path = _normalize_base_model_token(val)
            res_temp = _normalize_token(val)
            res_set = _normalize_tag(val)

            # verify they all behave identically
            self.assertEqual(res_matcher, res_path)
            self.assertEqual(res_matcher, res_temp)
            self.assertEqual(res_matcher, res_set)

            # verify correct regex behavior
            import re
            expected = re.sub(r"[^a-z0-9]+", "", str(val or "").lower())
            self.assertEqual(res_matcher, expected)

    def test_utc_now_iso(self):
        from core.sources.model_list import _utc_now_iso
        res = _utc_now_iso()
        self.assertTrue(isinstance(res, str))
        self.assertEqual(len(res), 25)  # YYYY-MM-DDTHH:MM:SS+00:00
        self.assertIn("T", res)
        self.assertTrue(res.endswith("+00:00"))
        # Check no microsecond
        self.assertNotIn(".", res)

    def test_listification(self):
        from core.type_utils import as_list
        from core.settings import _listify_tags

        self.assertEqual(as_list("a,b, c"), ["a", "b", "c"])
        self.assertEqual(list(_listify_tags("a,b; c")), ["a", "b", "c"])
        self.assertEqual(as_list(["a", "", None, "b"]), ["a", "b"])
        self.assertEqual(list(_listify_tags(["a", "", None, "b"])), ["a", "b"])

    def test_build_unified_search_result(self):
        from core.sources.common import build_unified_search_result, normalize_hashes_dict
        
        valid_sha = "a" * 64
        norm_hashes = normalize_hashes_dict({"sha256": valid_sha, "autoV2": "1234567890"})
        self.assertEqual(norm_hashes["sha256"], valid_sha.lower())
        self.assertEqual(norm_hashes["autoV2"], "1234567890")

        res = build_unified_search_result(
            "civitai",
            model_id=123,
            version_id=456,
            name="Test Model",
            hashes={"sha256": valid_sha},
            download_url="https://civitai.com/api/download/123",
        )
        self.assertEqual(res["source"], "civitai")
        self.assertEqual(res["model_id"], 123)
        self.assertEqual(res["version_id"], 456)
        self.assertEqual(res["sha256"], valid_sha.lower())
        self.assertEqual(res["hashes"]["sha256"], valid_sha.lower())

    def test_job_progress_tracker_update_from_payload(self):
        import importlib
        node_mod = importlib.import_module("comfyui-model-resolver")
        JobProgressTracker = node_mod.JobProgressTracker

        tracker = JobProgressTracker("Test Job")
        tracker.update_from_payload("job99", {"stage": "processing", "current": 5, "total": 10, "message": "Working..."})
        data = tracker.get("job99")
        self.assertEqual(data["status"], "running")
        self.assertEqual(data["stage"], "processing")
        self.assertEqual(data["current"], 5)
        self.assertEqual(data["message"], "Working...")

        tracker.update_from_payload("job99", {"stage": "completed", "message": "Done!"})
        data_done = tracker.get("job99")
        self.assertEqual(data_done["status"], "completed")

    @patch("core.network_utils.request_source_json")
    def test_fetch_json_from_public_url(self, mock_request_source_json):
        from core.network_utils import fetch_json_from_public_url
        mock_request_source_json.return_value = {"key": "value"}

        data = fetch_json_from_public_url("https://example.com/api.json")
        self.assertEqual(data, {"key": "value"})
        mock_request_source_json.assert_called_once()

    def test_prepare_remote_size_probe_url_with_allowed_domains(self):
        from core.type_utils import prepare_remote_size_probe_url
        
        # Test default behavior
        self.assertEqual(
            prepare_remote_size_probe_url("https://huggingface.co/user/repo/blob/main/model.safetensors"),
            "https://huggingface.co/user/repo/resolve/main/model.safetensors"
        )
        
        # Test allowed domains filtering
        self.assertEqual(
            prepare_remote_size_probe_url("https://civitai.com/api/download/models/123", ["civitai.com", "civitai.red"]),
            "https://civitai.com/api/download/models/123"
        )
        
        self.assertIsNone(
            prepare_remote_size_probe_url("https://otherdomain.com/model.safetensors", ["civitai.com", "civitai.red"])
        )

    @patch("core.network_utils.request_source_json")
    def test_execute_provider_json_request(self, mock_request_source_json):
        from core.network_utils import execute_provider_json_request
        mock_request_source_json.return_value = {"response": "ok"}
        
        # Test Bearer Authorization and Cookie header injection
        res = execute_provider_json_request(
            "Test Provider",
            "https://example.com/api",
            api_key="my_secret_token",
            session_token="my_session"
        )
        
        self.assertEqual(res, {"response": "ok"})
        mock_request_source_json.assert_called_once()
        call_args = mock_request_source_json.call_args
        headers = call_args[1]["headers"]
        self.assertEqual(headers["Authorization"], "Bearer my_secret_token")
        self.assertIn("__Secure-civ-token=my_session", headers["Cookie"])


if __name__ == "__main__":
    unittest.main()







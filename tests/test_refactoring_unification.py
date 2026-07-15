import sys
import os
import unittest
from unittest.mock import MagicMock, patch

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from core.matcher import MODEL_TITLE_MATCH_THRESHOLD
from core.sources.civitai import search_civitai_by_hash
from core.sources.lora_manager_archive import _normalize_model_type
from core.type_utils import (
    normalize_lora_manager_type,
    normalize_model_file_info,
    build_search_result,
)


class TestRefactoringUnification(unittest.TestCase):

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

    @patch("core.sources.civitai.get_model_info_by_hash")
    def test_search_civitai_by_hash(self, mock_get_info):
        mock_get_info.return_value = {
            "source": "civitai",
            "model_id": 500,
            "version_id": 600,
            "model_name": "My Civitai Model",
            "url": "http://civitai/model",
            "download_url": "http://civitai/download",
            "filename": "my_model.safetensors",
            "size": 9999,
        }
        res = search_civitai_by_hash("fake_hash", "fake_key")
        mock_get_info.assert_called_once_with("fake_hash", api_key="fake_key", use_cache=False)
        self.assertIsNotNone(res)
        self.assertEqual(res["source"], "civitai")
        self.assertEqual(res["model_id"], 500)
        self.assertEqual(res["version_id"], 600)
        self.assertEqual(res["name"], "My Civitai Model")
        self.assertEqual(res["url"], "http://civitai/model")
        self.assertEqual(res["download_url"], "http://civitai/download")
        self.assertEqual(res["filename"], "my_model.safetensors")
        self.assertEqual(res["size"], 9999)

    @patch("core.sources.civitai.get_model_info_by_hash")
    def test_search_civitai_by_hash_not_found(self, mock_get_info):
        mock_get_info.return_value = None
        res = search_civitai_by_hash("fake_hash")
        self.assertIsNone(res)

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

    @patch("core.sources.popular.save_catalog_with_backup")
    @patch("core.sources.popular.read_json_safe")
    @patch("requests.get")
    def test_update_base_models_from_remote_success(self, mock_get, mock_read_json, mock_save_catalog):
        from core.sources.popular import update_base_models_from_remote
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"BaseModel": ["SD 1.5", "SDXL 1.0", "NewModel"]}
        mock_get.return_value = mock_response

        # Mock reading base-models.json
        mock_read_json.return_value = {
            "base_models": [
                {"name": "SD 1.5", "aliases": ["sd1.5"]},
                {"name": "SDXL 1.0", "aliases": ["sdxl"]},
            ]
        }

        res = update_base_models_from_remote()
        self.assertTrue(res.get("updated"))
        self.assertEqual(res.get("new_models_added"), 1)
        self.assertIn("NewModel", res.get("new_models_added_list", []))
        
        # Verify it saved the updated catalog
        mock_save_catalog.assert_called_once()
        saved_data = mock_save_catalog.call_args[0][1]
        self.assertEqual(len(saved_data["base_models"]), 3)


if __name__ == "__main__":
    unittest.main()

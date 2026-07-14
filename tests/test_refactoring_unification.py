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


if __name__ == "__main__":
    unittest.main()

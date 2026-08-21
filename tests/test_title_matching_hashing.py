import os
import sys
import unittest
from unittest.mock import MagicMock

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from core.path_utils import calculate_file_sha256
from core.sources.civarchive import _find_model_title_match_in_model_details
from core.sources.civitai import _find_model_title_match_in_model


class TestTitleMatchingAndHashing(unittest.IsolatedAsyncioTestCase):

    def test_civitai_find_model_title_match_success(self):
        model_data = {
            "name": "SDXL Base Model",
            "type": "checkpoint",
            "tags": ["anime", "stylized"],
            "modelVersions": [
                {
                    "id": 123,
                    "name": "v1.0",
                    "baseModel": "SDXL 1.0",
                    "files": [
                        {
                            "id": 456,
                            "name": "sdxl_base.safetensors",
                            "sizeKB": 2048,
                            "primary": True,
                            "hashes": {"sha256": "abcdef123456"},
                        }
                    ]
                }
            ]
        }
        
        # SDXL Base Model vs sdxl base model should be a high confidence match
        result = _find_model_title_match_in_model(
            model_id=1,
            model_data=model_data,
            title_query="sdxl base model",
            base_model_context="SDXL 1.0"
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.model_id, 1)
        self.assertEqual(result.version_id, 123)
        self.assertEqual(result.filename, "sdxl_base.safetensors")
        self.assertEqual(result.base_model, "SDXL 1.0")
        self.assertIn("anime", result.tags)

    def test_civitai_find_model_title_match_rejected_confidence(self):
        model_data = {
            "name": "Totally Different Model Name",
            "modelVersions": [{"id": 123, "name": "v1.0"}]
        }
        result = _find_model_title_match_in_model(
            model_id=1,
            model_data=model_data,
            title_query="sdxl base model"
        )
        self.assertIsNone(result)

    def test_civarchive_find_model_title_match_success(self):
        model_details = {
            "model_id": 10,
            "name": "SD 1.5 Pruned",
            "type": "checkpoint",
            "tags": ["base"],
            "versions": [
                {
                    "id": 999,
                    "name": "v1.5 pruned",
                    "base_model": "SD 1.5",
                    "files": [
                        {
                            "name": "v1-5-pruned.safetensors",
                            "size": 10240,
                            "download_url": "https://civarchive.com/api/download/models/999",
                            "primary": True,
                        }
                    ]
                }
            ]
        }

        result = _find_model_title_match_in_model_details(
            model_id=10,
            model_details=model_details,
            title_query="SD 1.5 Pruned",
            base_model_context="SD 1.5"
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.model_id, 10)
        self.assertEqual(result.version_id, 999)
        self.assertEqual(result.filename, "v1-5-pruned.safetensors")
        self.assertEqual(result.base_model, "SD 1.5")

    async def test_calculate_file_sha256_with_mock_progress(self):
        import tempfile
        on_progress = MagicMock()
        on_source = MagicMock()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "dummy.safetensors")
            with open(file_path, "wb") as f:
                f.write(b"a" * 1024 * 512) # 512 KB
            
            # Non-safetensors or empty header safetensors
            sha256 = calculate_file_sha256(
                file_path,
                chunk_size=65536,
                on_progress=on_progress,
                use_safetensors_header=True,
                on_hash_source=on_source
            )
            self.assertIsNotNone(sha256)
            on_progress.assert_called()
            on_source.assert_called_with("file")

if __name__ == "__main__":
    unittest.main()

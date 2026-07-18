import os
import sys
import unittest
from unittest.mock import MagicMock, patch

parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from core.metadata_audit import extract_metadata_size
from core.settings import load_settings, get_settings_schema
from core.workflow_analyzer import NODE_TYPE_MODEL_WIDGET_CATEGORIES


class TestUnificationRefactoring(unittest.TestCase):

    def test_extract_metadata_size_top_level(self):
        # 1. Top-level size check
        meta = {"size": 1000}
        res = extract_metadata_size(meta, "model.safetensors")
        self.assertIsNotNone(res)
        self.assertEqual(res[0], 1000)
        self.assertEqual(res[1], "size")

    def test_extract_metadata_size_nested(self):
        # 2. Nested file/file_info check
        meta = {
            "file": {
                "sizeBytes": 2000
            }
        }
        res = extract_metadata_size(meta, "model.safetensors")
        self.assertIsNotNone(res)
        self.assertEqual(res[0], 2000)
        self.assertEqual(res[1], "file.sizeBytes")

    def test_extract_metadata_size_files_list(self):
        # 3. Files list check
        meta = {
            "files": [
                {"name": "other.safetensors", "size_bytes": 500},
                {"name": "model.safetensors", "size_kb": 2.0}
            ]
        }
        res = extract_metadata_size(meta, "model.safetensors")
        self.assertIsNotNone(res)
        self.assertEqual(res[0], 2048)  # 2.0 * 1024
        self.assertEqual(res[1], "files[].size_kb")

    def test_settings_schema_structure(self):
        schema = get_settings_schema()
        self.assertIsInstance(schema, list)
        self.assertTrue(len(schema) > 0)
        for item in schema:
            self.assertIn("serverKey", item)
            self.assertIn("type", item)
            self.assertIn("default", item)
            self.assertIn("localKey", item)

    def test_node_rules_categories_match(self):
        self.assertIn("CheckpointLoaderSimple", NODE_TYPE_MODEL_WIDGET_CATEGORIES)
        self.assertEqual(NODE_TYPE_MODEL_WIDGET_CATEGORIES["CheckpointLoaderSimple"], {0: "checkpoints"})


if __name__ == "__main__":
    unittest.main()

import os
import tempfile
import unittest
from unittest.mock import patch

from core.metadata_model_utils import dedupe_models, is_model_file_path, model_identity_key
from core.scanner import _model_identity


class MetadataModelHelperTests(unittest.TestCase):
    def test_model_file_path_validation_matches_between_metadata_flows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            metadata_path = os.path.join(tmpdir, "model.metadata.json")
            civitai_path = os.path.join(tmpdir, "model.civitai.info")
            text_path = os.path.join(tmpdir, "notes.txt")
            for path in (model_path, metadata_path, civitai_path, text_path):
                with open(path, "wb") as handle:
                    handle.write(b"data")

            expected = {
                model_path: True,
                metadata_path: False,
                civitai_path: False,
                text_path: False,
                os.path.join(tmpdir, "missing.safetensors"): False,
                "": False,
            }

            for path, is_model in expected.items():
                self.assertEqual(is_model, is_model_file_path(path))

    def test_model_identity_and_dedupe_match_between_metadata_flows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "models", "model.safetensors")
            os.makedirs(os.path.dirname(model_path))
            with open(model_path, "wb") as handle:
                handle.write(b"data")

            equivalent_path = os.path.join(tmpdir, "models", ".", "model.safetensors")
            first = {"path": model_path, "name": "first"}
            duplicate = {"path": equivalent_path, "name": "duplicate"}
            empty = {"path": ""}
            models = [first, duplicate, empty, "not a model"]

            self.assertEqual(model_identity_key(first), model_identity_key(duplicate))
            self.assertEqual("", model_identity_key(empty))
            self.assertEqual([first], dedupe_models(models))

    def test_scanner_and_metadata_identity_share_path_fallback(self):
        model_path = os.path.join("models", "model.safetensors")
        expected = os.path.normcase(os.path.abspath(model_path))

        with patch("core.path_utils.os.path.realpath", side_effect=OSError):
            self.assertEqual(expected, _model_identity({"path": model_path}))
            self.assertEqual(expected, model_identity_key({"path": model_path}))


if __name__ == "__main__":
    unittest.main()

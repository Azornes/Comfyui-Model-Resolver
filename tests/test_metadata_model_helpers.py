import os
import tempfile
import unittest
from unittest.mock import patch

from core.metadata_audit import _model_key
from core.metadata_model_utils import dedupe_models, is_model_file_path
from core.path_utils import get_model_path_identity
from core.resolver import _build_local_hash_match_cache
from core.scanner import scan_directory


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

            self.assertEqual(
                get_model_path_identity(first["path"]),
                get_model_path_identity(duplicate["path"]),
            )
            self.assertEqual("", get_model_path_identity(empty["path"]))
            self.assertEqual([first], dedupe_models(models))

    def test_scanner_and_metadata_identity_share_path_fallback(self):
        model_path = os.path.join("models", "model.safetensors")
        expected = os.path.normcase(os.path.abspath(model_path))

        with patch("core.path_utils.os.path.realpath", side_effect=OSError):
            self.assertEqual(expected, get_model_path_identity(model_path))

    def test_scanner_audit_and_resolver_share_path_identity_fallback(self):
        model_path = os.path.join("models", "model.safetensors")
        metadata_path = os.path.join("models", "model.metadata.json")
        expected_model = os.path.normcase(os.path.abspath(model_path))
        expected_metadata = os.path.normcase(os.path.abspath(metadata_path))

        with patch("core.path_utils.os.path.realpath", side_effect=OSError):
            self.assertEqual(
                (expected_model, expected_metadata),
                _model_key(model_path, metadata_path),
            )

            with patch("core.scanner.os.path.exists", return_value=True), patch(
                "core.scanner.os.path.isdir", return_value=True
            ), patch(
                "core.scanner.os.walk",
                return_value=[
                    ("models", [], ["model.safetensors"]),
                ],
            ):
                models = scan_directory("models", {".safetensors"}, "checkpoints")

        self.assertEqual(["model.safetensors"], [model["filename"] for model in models])

        with patch("core.resolver.os.path.isdir", return_value=False), patch(
                "core.resolver.find_metadata_sidecar_path",
                return_value=metadata_path,
            ), patch(
                "core.resolver.read_merged_model_metadata",
                return_value={"sha256": "a" * 64},
            ), patch(
                "core.resolver._extract_model_sha256_from_metadata",
                return_value=["a" * 64],
        ):
            index = _build_local_hash_match_cache(
                [{"path": model_path, "filename": "model.safetensors"}]
            )

        self.assertEqual(1, len(index["a" * 64]))
        self.assertEqual(model_path, index["a" * 64][0]["model"]["path"])

    def test_model_path_identity_rejects_empty_and_whitespace_paths(self):
        self.assertEqual("", get_model_path_identity(None))
        self.assertEqual("", get_model_path_identity(""))
        self.assertEqual("", get_model_path_identity("   "))


if __name__ == "__main__":
    unittest.main()

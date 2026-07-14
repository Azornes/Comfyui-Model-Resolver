import json
import os
import tempfile
import unittest

from core.metadata_audit import audit_metadata_sizes


class MetadataSizeAuditTests(unittest.TestCase):
    def _write_model(self, directory, filename, content):
        path = os.path.join(directory, filename)
        with open(path, "wb") as handle:
            handle.write(content)
        return path

    def _write_metadata(self, model_path, payload):
        base_path, _extension = os.path.splitext(model_path)
        metadata_path = f"{base_path}.metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        return metadata_path

    def _model_info(self, model_path, category="checkpoints"):
        return {
            "filename": os.path.basename(model_path),
            "relative_path": os.path.basename(model_path),
            "path": model_path,
            "category": category,
            "base_directory": os.path.dirname(model_path),
        }

    def test_reports_top_level_size_mismatch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = self._write_model(tmpdir, "mismatch.safetensors", b"12345")
            metadata_path = self._write_metadata(model_path, {"size": 3})

            result = audit_metadata_sizes(models=[self._model_info(model_path)])

        self.assertTrue(result["success"])
        self.assertEqual(1, result["scanned_models"])
        self.assertEqual(1, result["checked_metadata"])
        self.assertEqual(1, result["mismatch_count"])
        mismatch = result["mismatches"][0]
        self.assertEqual(metadata_path, mismatch["metadata_path"])
        self.assertEqual(3, mismatch["metadata_size"])
        self.assertEqual(5, mismatch["actual_size"])
        self.assertEqual(2, mismatch["difference"])
        self.assertEqual("size", mismatch["size_field"])

    def test_ignores_matching_size_and_counts_missing_size(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            matching_path = self._write_model(tmpdir, "matching.safetensors", b"abc")
            missing_size_path = self._write_model(tmpdir, "missing.safetensors", b"abcd")
            self._write_metadata(matching_path, {"size": 3})
            self._write_metadata(missing_size_path, {"model_name": "Missing Size"})

            result = audit_metadata_sizes(
                models=[
                    self._model_info(matching_path),
                    self._model_info(missing_size_path),
                ]
            )

        self.assertEqual(2, result["scanned_models"])
        self.assertEqual(1, result["checked_metadata"])
        self.assertEqual(1, result["missing_size"])
        self.assertEqual(0, result["mismatch_count"])

    def test_uses_matching_nested_file_size_when_top_level_size_is_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = self._write_model(tmpdir, "nested.safetensors", b"abcdef")
            self._write_metadata(
                model_path,
                {
                    "files": [
                        {"name": "other.safetensors", "size": 6},
                        {"name": "nested.safetensors", "sizeKB": 1},
                    ]
                },
            )

            result = audit_metadata_sizes(models=[self._model_info(model_path)])

        self.assertEqual(1, result["checked_metadata"])
        self.assertEqual(1, result["mismatch_count"])
        mismatch = result["mismatches"][0]
        self.assertEqual(1024, mismatch["metadata_size"])
        self.assertEqual(6, mismatch["actual_size"])
        self.assertEqual("files[].sizeKB", mismatch["size_field"])

    def test_skips_metadata_files_returned_by_scanner(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            metadata_path = os.path.join(tmpdir, "orphan.metadata.json")
            with open(metadata_path, "w", encoding="utf-8") as handle:
                json.dump({"size": 3}, handle)

            result = audit_metadata_sizes(models=[self._model_info(metadata_path)])

        self.assertEqual(0, result["scanned_models"])
        self.assertEqual(1, result["skipped_non_model_files"])
        self.assertEqual(0, result["mismatch_count"])

    def test_parallel_batches_process_all_models(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            models = []
            for index in range(5):
                model_path = self._write_model(
                    tmpdir,
                    f"model_{index}.safetensors",
                    b"x" * (index + 1),
                )
                stored_size = index + 1
                if index == 3:
                    stored_size = 999
                self._write_metadata(model_path, {"size": stored_size})
                models.append(self._model_info(model_path))

            result = audit_metadata_sizes(
                models=models,
                worker_count=2,
                batch_size=2,
            )

        self.assertEqual(2, result["worker_count"])
        self.assertEqual(2, result["batch_size"])
        self.assertEqual(3, result["batch_count"])
        self.assertEqual(5, result["scanned_models"])
        self.assertEqual(5, result["checked_metadata"])
        self.assertEqual(1, result["mismatch_count"])
        self.assertEqual("model_3.safetensors", result["mismatches"][0]["filename"])


if __name__ == "__main__":
    unittest.main()

import hashlib
import json
import os
import tempfile
import unittest

from core.metadata_builder import build_missing_local_metadata


class MetadataBuilderTests(unittest.TestCase):
    def _write_model(self, directory, filename, content):
        path = os.path.join(directory, filename)
        with open(path, "wb") as handle:
            handle.write(content)
        return path

    def _write_fake_safetensors(self, directory, filename, metadata):
        header = json.dumps({"__metadata__": metadata}).encode("utf-8")
        content = len(header).to_bytes(8, "little") + header
        return self._write_model(directory, filename, content)

    def _write_metadata(self, model_path, payload):
        base_path, _extension = os.path.splitext(model_path)
        metadata_path = f"{base_path}.metadata.json"
        with open(metadata_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        return metadata_path

    def _read_metadata(self, model_path):
        base_path, _extension = os.path.splitext(model_path)
        metadata_path = f"{base_path}.metadata.json"
        with open(metadata_path, "r", encoding="utf-8") as handle:
            return metadata_path, json.load(handle)

    def _model_info(self, model_path, category="loras"):
        return {
            "filename": os.path.basename(model_path),
            "relative_path": os.path.basename(model_path),
            "path": model_path,
            "category": category,
            "base_directory": os.path.dirname(model_path),
        }

    def test_creates_missing_metadata_from_local_safetensors_header(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            header_sha = "a" * 64
            model_path = self._write_fake_safetensors(
                tmpdir,
                "header_model.safetensors",
                {
                    "modelspec.title": "Header Model",
                    "modelspec.description": "Local description",
                    "modelspec.tags": "tag-a, tag-b",
                    "modelspec.trigger_phrase": "trigger-a",
                    "sha256": header_sha,
                },
            )

            result = build_missing_local_metadata(models=[self._model_info(model_path)])
            metadata_path, metadata = self._read_metadata(model_path)

        self.assertTrue(result["success"])
        self.assertEqual(1, result["created_metadata"])
        self.assertEqual(0, result["calculated_hashes"])
        self.assertEqual(1, result["header_hashes"])
        self.assertEqual(metadata_path, result["updated"][0]["metadata_path"])
        self.assertEqual("Header Model", metadata["model_name"])
        self.assertEqual(header_sha, metadata["sha256"])
        self.assertEqual("safetensors_header", metadata["sha256_source"])
        self.assertIn("tag-a", metadata["tags"])
        self.assertIn("trigger-a", metadata["trained_words"])
        self.assertIn("safetensors_header_metadata", metadata)
        self.assertIn("modelspec.title", metadata["safetensors_header_metadata"]["metadata"])

    def test_updates_existing_metadata_without_sha256_and_preserves_user_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            content = b"local model bytes"
            expected_sha = hashlib.sha256(content).hexdigest()
            model_path = self._write_model(tmpdir, "needs_hash.ckpt", content)
            self._write_metadata(
                model_path,
                {
                    "model_name": "Existing Name",
                    "notes": "keep me",
                    "favorite": True,
                },
            )

            events = []
            result = build_missing_local_metadata(
                models=[self._model_info(model_path, "checkpoints")],
                progress_callback=events.append,
            )
            _metadata_path, metadata = self._read_metadata(model_path)

        self.assertTrue(result["success"])
        self.assertEqual(1, result["updated_metadata"])
        self.assertEqual(1, result["calculated_hashes"])
        self.assertEqual(expected_sha, metadata["sha256"])
        self.assertEqual("file", metadata["sha256_source"])
        self.assertEqual("Existing Name", metadata["model_name"])
        self.assertEqual("keep me", metadata["notes"])
        self.assertTrue(metadata["favorite"])
        self.assertTrue(any(event.get("stage") == "hashing" for event in events))
        self.assertTrue(any(event.get("current_model") == "needs_hash.ckpt" for event in events))

    def test_skips_existing_metadata_that_already_has_sha256(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = self._write_model(tmpdir, "complete.safetensors", b"abc")
            existing = {
                "model_name": "Complete",
                "sha256": "b" * 64,
                "notes": "do not rewrite",
            }
            self._write_metadata(model_path, existing)

            result = build_missing_local_metadata(models=[self._model_info(model_path)])
            _metadata_path, metadata = self._read_metadata(model_path)

        self.assertTrue(result["success"])
        self.assertEqual(0, result["created_metadata"])
        self.assertEqual(0, result["updated_metadata"])
        self.assertEqual(1, result["skipped_complete"])
        self.assertEqual(existing, metadata)

    def test_builds_missing_metadata_with_multiple_workers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_paths = [
                self._write_model(tmpdir, f"parallel_{index}.ckpt", f"model-{index}".encode("utf-8"))
                for index in range(4)
            ]
            events = []

            result = build_missing_local_metadata(
                models=[self._model_info(path, "checkpoints") for path in model_paths],
                worker_count=2,
                progress_callback=events.append,
            )

            metadata_payloads = [self._read_metadata(path)[1] for path in model_paths]

        self.assertTrue(result["success"])
        self.assertEqual(2, result["worker_count"])
        self.assertGreaterEqual(result["cpu_count"], 1)
        self.assertEqual(4, result["created_metadata"])
        self.assertEqual(4, result["calculated_hashes"])
        self.assertEqual(4, len(metadata_payloads))
        self.assertTrue(all(payload.get("sha256") for payload in metadata_payloads))
        self.assertTrue(any(event.get("worker_count") == 2 for event in events))


if __name__ == "__main__":
    unittest.main()

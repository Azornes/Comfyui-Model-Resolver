import hashlib
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from core import worker_utils
from core.metadata_builder import (
    METADATA_BUILD_MODE_CALCULATE_FRESH,
    METADATA_BUILD_MODE_IMPORT_EXISTING,
    build_missing_local_metadata,
    normalize_metadata_build_mode,
)
from core.path_utils import get_model_resolver_sidecar_path


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
        metadata_path = get_model_resolver_sidecar_path(model_path)
        with open(metadata_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        return metadata_path

    def _read_metadata(self, model_path):
        metadata_path = get_model_resolver_sidecar_path(model_path)
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

    def test_worker_count_preserves_builder_defaults_and_requested_limits(self):
        with patch.object(worker_utils.os, "cpu_count", return_value=8):
            self.assertEqual(
                worker_utils.resolve_worker_count(
                    20,
                    default_worker_limit=4,
                ),
                (4, 8),
            )
            self.assertEqual(
                worker_utils.resolve_worker_count(
                    20,
                    6,
                    default_worker_limit=4,
                ),
                (6, 8),
            )
            self.assertEqual(
                worker_utils.resolve_worker_count(
                    0,
                    default_worker_limit=4,
                ),
                (4, 8),
            )

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

            result = build_missing_local_metadata(
                models=[self._model_info(model_path)],
                metadata_mode=METADATA_BUILD_MODE_IMPORT_EXISTING,
            )
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

    def test_same_stem_models_receive_extension_qualified_sidecars(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_content = b"bin adapter weights"
            safetensors_content = b"safetensors adapter weights"
            bin_path = self._write_model(tmpdir, "ip-adapter_sd15.bin", bin_content)
            safetensors_path = self._write_model(
                tmpdir,
                "ip-adapter_sd15.safetensors",
                safetensors_content,
            )

            result = build_missing_local_metadata(
                models=[
                    self._model_info(bin_path),
                    self._model_info(safetensors_path),
                ],
                worker_count=1,
                metadata_mode=METADATA_BUILD_MODE_CALCULATE_FRESH,
            )

            bin_metadata_path = get_model_resolver_sidecar_path(bin_path)
            safetensors_metadata_path = get_model_resolver_sidecar_path(
                safetensors_path
            )
            legacy_metadata_path = os.path.splitext(bin_path)[0] + ".metadata.json"
            with open(bin_metadata_path, "r", encoding="utf-8") as handle:
                bin_metadata = json.load(handle)
            with open(safetensors_metadata_path, "r", encoding="utf-8") as handle:
                safetensors_metadata = json.load(handle)
            legacy_metadata_exists = os.path.exists(legacy_metadata_path)

        self.assertTrue(result["success"])
        self.assertEqual(2, result["created_metadata"])
        self.assertFalse(legacy_metadata_exists)
        self.assertEqual("ip-adapter_sd15.bin", bin_metadata["filename"])
        self.assertEqual(
            hashlib.sha256(bin_content).hexdigest(),
            bin_metadata["sha256"],
        )
        self.assertEqual(
            "ip-adapter_sd15.safetensors",
            safetensors_metadata["filename"],
        )
        self.assertEqual(
            hashlib.sha256(safetensors_content).hexdigest(),
            safetensors_metadata["sha256"],
        )
        self.assertEqual("comfyui-model-resolver", bin_metadata["managed_by"])
        self.assertNotIn("favorite", bin_metadata)
        self.assertNotIn("notes", bin_metadata)
        self.assertEqual(
            METADATA_BUILD_MODE_CALCULATE_FRESH,
            bin_metadata["metadata_build_mode"],
        )

    def test_external_metadata_remains_untouched_and_is_not_copied(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_content = b"bin"
            bin_path = self._write_model(tmpdir, "adapter.bin", bin_content)
            safetensors_path = self._write_model(
                tmpdir,
                "adapter.safetensors",
                b"safe",
            )
            legacy_sha = "c" * 64
            legacy_path = os.path.splitext(bin_path)[0] + ".metadata.json"
            legacy_payload = {
                "filename": "adapter.bin",
                "file_path": bin_path,
                "sha256": legacy_sha,
                "notes": "preserve external user details",
                "favorite": True,
            }
            with open(legacy_path, "w", encoding="utf-8") as handle:
                json.dump(legacy_payload, handle)

            result = build_missing_local_metadata(
                models=[
                    self._model_info(bin_path),
                    self._model_info(safetensors_path),
                ],
                worker_count=1,
                metadata_mode=METADATA_BUILD_MODE_CALCULATE_FRESH,
            )

            with open(
                get_model_resolver_sidecar_path(bin_path),
                "r",
                encoding="utf-8",
            ) as handle:
                bin_metadata = json.load(handle)
            with open(
                get_model_resolver_sidecar_path(safetensors_path),
                "r",
                encoding="utf-8",
            ) as handle:
                safetensors_metadata = json.load(handle)
            with open(legacy_path, "r", encoding="utf-8") as handle:
                legacy_after = json.load(handle)

        self.assertTrue(result["success"])
        self.assertEqual(legacy_payload, legacy_after)
        self.assertEqual(
            hashlib.sha256(bin_content).hexdigest(),
            bin_metadata["sha256"],
        )
        self.assertNotEqual(legacy_sha, bin_metadata["sha256"])
        self.assertNotIn("notes", bin_metadata)
        self.assertNotIn("favorite", bin_metadata)
        self.assertEqual("adapter.bin", bin_metadata["filename"])
        self.assertEqual("adapter.safetensors", safetensors_metadata["filename"])
        self.assertEqual(
            hashlib.sha256(b"safe").hexdigest(),
            safetensors_metadata["sha256"],
        )

    def test_import_mode_uses_external_metadata_without_modifying_it(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = self._write_model(
                tmpdir,
                "imported.safetensors",
                b"local model bytes",
            )
            external_path = os.path.join(tmpdir, "imported.metadata.json")
            external_sha = "d" * 64
            external_payload = {
                "filename": "imported.safetensors",
                "file_path": model_path,
                "model_name": "Imported model name",
                "base_model": "SDXL 1.0",
                "tags": ["external-tag"],
                "sha256": external_sha,
                "hash_status": "completed",
                "notes": "user-owned note",
                "favorite": True,
            }
            with open(external_path, "w", encoding="utf-8") as handle:
                json.dump(external_payload, handle)

            result = build_missing_local_metadata(
                models=[self._model_info(model_path)],
                worker_count=1,
                metadata_mode=METADATA_BUILD_MODE_IMPORT_EXISTING,
            )
            _metadata_path, metadata = self._read_metadata(model_path)
            with open(external_path, "r", encoding="utf-8") as handle:
                external_after = json.load(handle)

        self.assertTrue(result["success"])
        self.assertEqual(1, result["created_metadata"])
        self.assertEqual(0, result["calculated_hashes"])
        self.assertEqual(external_payload, external_after)
        self.assertEqual(external_sha, metadata["sha256"])
        self.assertEqual("external_metadata", metadata["sha256_source"])
        self.assertEqual("Imported model name", metadata["model_name"])
        self.assertEqual("SDXL 1.0", metadata["base_model"])
        self.assertEqual(["external-tag"], metadata["tags"])
        self.assertNotIn("notes", metadata)
        self.assertNotIn("favorite", metadata)
        self.assertEqual(
            external_path.replace(os.sep, "/"),
            metadata["imported_from"],
        )
        self.assertEqual(
            METADATA_BUILD_MODE_IMPORT_EXISTING,
            metadata["metadata_build_mode"],
        )

    def test_import_mode_calculates_hash_when_external_hash_is_pending(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            content = b"calculate missing external hash"
            model_path = self._write_model(
                tmpdir,
                "pending.safetensors",
                content,
            )
            external_path = os.path.join(tmpdir, "pending.metadata.json")
            with open(external_path, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "filename": "pending.safetensors",
                        "sha256": "e" * 64,
                        "hash_status": "pending",
                    },
                    handle,
                )

            result = build_missing_local_metadata(
                models=[self._model_info(model_path)],
                worker_count=1,
                metadata_mode=METADATA_BUILD_MODE_IMPORT_EXISTING,
            )
            _metadata_path, metadata = self._read_metadata(model_path)

        self.assertEqual(1, result["calculated_hashes"])
        self.assertEqual(hashlib.sha256(content).hexdigest(), metadata["sha256"])
        self.assertEqual("file", metadata["sha256_source"])

    def test_invalid_metadata_mode_falls_back_to_fresh_calculation(self):
        self.assertEqual(
            METADATA_BUILD_MODE_CALCULATE_FRESH,
            normalize_metadata_build_mode("unsupported"),
        )

    def test_exact_sidecar_remains_canonical_after_sibling_is_removed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_path = self._write_model(tmpdir, "adapter.bin", b"bin")
            safetensors_path = self._write_model(
                tmpdir,
                "adapter.safetensors",
                b"safe",
            )
            exact_metadata_path = get_model_resolver_sidecar_path(bin_path)
            with open(exact_metadata_path, "w", encoding="utf-8") as handle:
                json.dump({"filename": "adapter.bin", "size": 3}, handle)

            os.remove(safetensors_path)
            selected_path = get_model_resolver_sidecar_path(bin_path)

        self.assertEqual(exact_metadata_path, selected_path)

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

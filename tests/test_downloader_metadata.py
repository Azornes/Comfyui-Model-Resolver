import json
import hashlib
import os
import tempfile
import unittest
from unittest.mock import patch

from core import downloader
from core.downloader import (
    build_lora_manager_metadata,
    download_model,
    get_metadata_sidecar_path,
    get_progress,
    write_lora_manager_metadata,
)


class DownloaderMetadataSidecarTests(unittest.TestCase):
    def test_huggingface_metadata_does_not_create_civitai_identity(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            payload = build_lora_manager_metadata(
                model_path,
                {
                    "details_source": "huggingface",
                    "source": "huggingface",
                    "model_id": "DreamFast/Qwen3-VL-4b-Heretic-ComfyUI",
                    "filename": "model.safetensors",
                    "sha256": "a" * 64,
                    "download_url": (
                        "https://huggingface.co/DreamFast/repo/resolve/main/"
                        "model.safetensors"
                    ),
                },
                category="text_encoders",
            )

        self.assertEqual("huggingface", payload["source"])
        self.assertEqual("a" * 64, payload["sha256"])
        self.assertFalse(payload["from_civitai"])
        self.assertEqual({}, payload["civitai"])
        self.assertIsNone(payload["metadata_source"])

    def test_writes_lora_manager_sidecar_and_sanitizes_secrets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "example.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            metadata_path = write_lora_manager_metadata(
                model_path,
                {
                    "details_source": "civitai",
                    "model_id": "123",
                    "version_id": "456",
                    "name": "Example Model",
                    "version_name": "v1",
                    "base_model": "SDXL 1.0",
                    "tags": ["style", "concept"],
                    "trained_words": ["example trigger"],
                    "creator": {"username": "maker"},
                    "download_url": (
                        "https://civitai.com/api/download/models/456"
                        "?type=Model&token=secret-token"
                    ),
                    "hf_token": "secret-hf-token",
                    "headers": {"Authorization": "Bearer secret"},
                    "hashes": {"SHA256": "ABCDEF"},
                    "path_metadata": {
                        "filename": "example.safetensors",
                        "model_name": "Example Model",
                    },
                },
                category="checkpoints",
                source_url="https://civitai.com/api/download/models/456?token=secret",
            )

            self.assertEqual(get_metadata_sidecar_path(model_path), metadata_path)
            with open(metadata_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

        self.assertEqual("example", payload["file_name"])
        self.assertEqual("Example Model", payload["model_name"])
        self.assertEqual(3, payload["size"])
        self.assertEqual("abcdef", payload["sha256"])
        self.assertEqual("completed", payload["hash_status"])
        self.assertEqual("checkpoint", payload["model_type"])
        self.assertEqual("checkpoint", payload["sub_type"])
        self.assertEqual("civitai_api", payload["metadata_source"])
        self.assertEqual(123, payload["civitai"]["modelId"])
        self.assertEqual(456, payload["civitai"]["id"])
        self.assertEqual(["example trigger"], payload["civitai"]["trainedWords"])
        self.assertNotIn("token=", payload["civitai"]["downloadUrl"])
        self.assertIn("type=Model", payload["civitai"]["downloadUrl"])
        self.assertNotIn("secret", json.dumps(payload))

    def test_existing_file_with_same_hash_is_marked_already_downloaded(self):
        content = b"existing model"
        expected_sha256 = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "existing.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(content)

            download_id = "samehash"
            with downloader.download_lock:
                downloader.download_progress[download_id] = {
                    "status": "starting",
                    "progress": 0,
                    "filename": "existing.safetensors",
                    "path": model_path,
                    "directory": tmpdir,
                }

            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                result = download_model(
                    "https://example.com/existing.safetensors",
                    "existing.safetensors",
                    "checkpoints",
                    download_id=download_id,
                    metadata={"sha256": expected_sha256},
                )

            progress = get_progress(download_id)
            with downloader.download_lock:
                downloader.download_progress.pop(download_id, None)

        self.assertTrue(result["success"])
        self.assertTrue(result["already_exists"])
        self.assertEqual("completed", progress["status"])
        self.assertTrue(progress["already_exists"])
        self.assertIn("already downloaded", progress["message"])

    def test_existing_matching_file_replaces_stale_sidecar_provenance(self):
        content = b"existing HuggingFace model"
        expected_sha256 = hashlib.sha256(content).hexdigest()
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "existing.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(content)
            metadata_path = get_metadata_sidecar_path(model_path)
            with open(metadata_path, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "source": "civarchive",
                        "details_source": "civarchive",
                        "sha256": "0" * 64,
                        "hash_status": "completed",
                        "from_civitai": True,
                        "civitai": {"modelId": 123},
                    },
                    handle,
                )

            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                result = download_model(
                    "https://huggingface.co/DreamFast/repo/resolve/main/"
                    "existing.safetensors",
                    "existing.safetensors",
                    "text_encoders",
                    download_id="refreshstalesidecar",
                    metadata={
                        "source": "huggingface",
                        "details_source": "huggingface",
                        "model_id": "DreamFast/repo",
                        "filename": "existing.safetensors",
                        "sha256": expected_sha256,
                    },
                )

            with open(metadata_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

        self.assertTrue(result["success"])
        self.assertTrue(result["already_exists"])
        self.assertEqual("huggingface", payload["source"])
        self.assertEqual(expected_sha256, payload["sha256"])
        self.assertFalse(payload["from_civitai"])
        self.assertEqual({}, payload["civitai"])

    def test_existing_file_uses_completed_metadata_hash_before_hashing_file(self):
        expected_sha256 = "a" * 64
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "existing.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"large local file")
            with open(get_metadata_sidecar_path(model_path), "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "sha256": expected_sha256,
                        "hash_status": "completed",
                    },
                    handle,
                )

            download_id = "metadatahash"
            with downloader.download_lock:
                downloader.download_progress[download_id] = {
                    "status": "starting",
                    "progress": 0,
                    "filename": "existing.safetensors",
                    "path": model_path,
                    "directory": tmpdir,
                }

            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                with patch(
                    "core.downloader.calculate_file_sha256",
                    side_effect=AssertionError("file hash should not be calculated"),
                ):
                    result = download_model(
                        "https://example.com/existing.safetensors",
                        "existing.safetensors",
                        "checkpoints",
                        download_id=download_id,
                        metadata={"sha256": expected_sha256},
                    )

            progress = get_progress(download_id)
            with downloader.download_lock:
                downloader.download_progress.pop(download_id, None)

        self.assertTrue(result["success"])
        self.assertTrue(result["already_exists"])
        self.assertEqual("metadata", result["sha256_source"])
        self.assertEqual("metadata", progress["sha256_source"])

    def test_existing_file_uses_safetensors_header_hash_before_hashing_file(self):
        expected_sha256 = "b" * 64
        header = json.dumps(
            {"__metadata__": {"modelspec.hash.sha256": expected_sha256}},
            separators=(",", ":"),
        ).encode("utf-8")

        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "existing.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(len(header).to_bytes(8, byteorder="little"))
                handle.write(header)
                handle.write(b"large local model payload")

            download_id = "headerhash"
            with downloader.download_lock:
                downloader.download_progress[download_id] = {
                    "status": "starting",
                    "progress": 0,
                    "filename": "existing.safetensors",
                    "path": model_path,
                    "directory": tmpdir,
                }

            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                with patch(
                    "core.path_utils.hashlib.sha256",
                    side_effect=AssertionError("file hash should not be calculated"),
                ):
                    result = download_model(
                        "https://example.com/existing.safetensors",
                        "existing.safetensors",
                        "checkpoints",
                        download_id=download_id,
                        metadata={"sha256": expected_sha256},
                    )

            progress = get_progress(download_id)
            with downloader.download_lock:
                downloader.download_progress.pop(download_id, None)

        self.assertTrue(result["success"])
        self.assertTrue(result["already_exists"])
        self.assertEqual("safetensors_header", result["sha256_source"])
        self.assertEqual("safetensors_header", progress["sha256_source"])

    def test_existing_file_with_different_hash_stays_blocked(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "existing.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"local model")

            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                result = download_model(
                    "https://example.com/existing.safetensors",
                    "existing.safetensors",
                    "checkpoints",
                    download_id="hashmismatch",
                    metadata={"sha256": "0" * 64},
                )

        self.assertFalse(result["success"])
        self.assertIn("SHA256 does not match", result["error"])


if __name__ == "__main__":
    unittest.main()

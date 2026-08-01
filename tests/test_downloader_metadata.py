import json
import hashlib
from io import BytesIO
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image

from core import downloader
from core.downloader import (
    _extract_expected_sha256,
    build_lora_manager_metadata,
    download_model,
    get_progress,
    write_lora_manager_metadata,
)
from core.path_utils import get_model_resolver_sidecar_path


class DownloaderMetadataSidecarTests(unittest.TestCase):
    def test_selected_file_hash_overrides_stale_source_hash(self):
        stale_hash = "1" * 64
        selected_hash = "f" * 64
        metadata = {
            "source": "lora_manager_archive",
            "filename": "CBS_novuschroma21 style.safetensors",
            "sha256": stale_hash,
            "selected_file": {
                "name": "CBS_novuschroma21 style.safetensors",
                "hashes": {"SHA256": selected_hash},
            },
        }

        self.assertEqual(selected_hash, _extract_expected_sha256(metadata))

    def test_selected_file_without_hash_does_not_fall_back_to_stale_source_hash(self):
        stale_hash = "1" * 64
        metadata = {
            "source": "lora_manager_archive",
            "filename": "another-variant.safetensors",
            "sha256": stale_hash,
            "selected_file": {
                "name": "another-variant.safetensors",
            },
        }

        self.assertEqual("", _extract_expected_sha256(metadata))

    def test_keeps_model_description_separate_from_version_notes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            payload = build_lora_manager_metadata(
                model_path,
                {
                    "source": "civitai",
                    "model_id": 123,
                    "version_id": 456,
                    "model_description": "Model page description",
                    "description": "Version-specific release notes",
                },
                category="checkpoints",
            )

        self.assertEqual("Model page description", payload["modelDescription"])
        self.assertEqual(
            "Version-specific release notes",
            payload["version_description"],
        )
        self.assertEqual(
            "Model page description",
            payload["civitai"]["model"]["description"],
        )
        self.assertEqual(
            "Version-specific release notes",
            payload["civitai"]["description"],
        )

    def test_civarchive_metadata_keeps_provider_page_separate_from_hf_mirror(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            payload = build_lora_manager_metadata(
                model_path,
                {
                    "source": "civarchive",
                    "details_source": "civarchive",
                    "model_id": 123,
                    "version_id": 456,
                    "version_url": (
                        "https://huggingface.co/author/repo/blob/main/model.safetensors"
                    ),
                    "url": "https://civarchive.com/models/123?modelVersionId=456",
                    "download_url": (
                        "https://huggingface.co/author/repo/resolve/main/model.safetensors"
                    ),
                    "sha256": "a" * 64,
                },
                category="checkpoints",
            )

        expected_page = "https://civarchive.com/models/123?modelVersionId=456"
        self.assertEqual(expected_page, payload["source_url"])
        self.assertEqual(expected_page, payload["version_url"])
        self.assertEqual(
            "https://huggingface.co/author/repo/resolve/main/model.safetensors",
            payload["download_url"],
        )

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
            external_metadata_path = os.path.join(tmpdir, "example.metadata.json")
            external_payload = {
                "notes": "user note",
                "favorite": True,
            }
            with open(external_metadata_path, "w", encoding="utf-8") as handle:
                json.dump(external_payload, handle)

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

            self.assertEqual(
                get_model_resolver_sidecar_path(model_path),
                metadata_path,
            )
            with open(metadata_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            with open(external_metadata_path, "r", encoding="utf-8") as handle:
                external_after = json.load(handle)

        self.assertEqual(external_payload, external_after)
        self.assertEqual("comfyui-model-resolver", payload["managed_by"])
        self.assertEqual(1, payload["schema_version"])
        self.assertNotIn("notes", payload)
        self.assertNotIn("favorite", payload)
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

    def test_uses_full_civitai_payload_from_fetched_details(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "example.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            payload = build_lora_manager_metadata(
                model_path,
                {
                    "source": "civitai",
                    "details_source": "civitai",
                    "model_id": 123,
                    "version_id": 456,
                    "download_url": (
                        "https://civitai.com/api/download/models/456?token=secret"
                    ),
                    "civitai_details": {
                        "source": "civitai",
                        "model_id": 123,
                        "version_id": 456,
                        "civitai": {
                            "modelId": 123,
                            "id": 456,
                            "name": "v1",
                            "images": [
                                {
                                    "url": "https://image.civitai.com/example.jpeg",
                                    "nsfwLevel": 4,
                                    "meta": {
                                        "seed": 42,
                                        "prompt": "Full prompt metadata",
                                    },
                                }
                            ],
                            "files": [
                                {
                                    "name": "example.safetensors",
                                    "virusScanResult": "Success",
                                }
                            ],
                            "model": {
                                "name": "Example Model",
                                "allowCommercialUse": ["Image"],
                            },
                            "stats": {"downloadCount": 10},
                        },
                    },
                },
                category="loras",
            )

        civitai = payload["civitai"]
        self.assertEqual(4, civitai["images"][0]["nsfwLevel"])
        self.assertEqual(
            "Full prompt metadata",
            civitai["images"][0]["meta"]["prompt"],
        )
        self.assertEqual("Success", civitai["files"][0]["virusScanResult"])
        self.assertEqual(["Image"], civitai["model"]["allowCommercialUse"])
        self.assertEqual(10, civitai["stats"]["downloadCount"])
        self.assertNotIn("token=", civitai["downloadUrl"])

    def test_writes_optimized_jpeg_preview_from_first_model_image(self):
        source_image = Image.new("RGBA", (960, 1440), (20, 40, 60, 128))
        source_buffer = BytesIO()
        source_image.save(source_buffer, format="PNG")
        response = MagicMock()
        response.headers = {"Content-Length": str(len(source_buffer.getvalue()))}
        response.iter_content.return_value = [source_buffer.getvalue()]

        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "preview-model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"abc")

            with patch(
                "core.downloader.request_public_url",
                return_value=(
                    response,
                    "https://image.civitai.com/example.png",
                    {},
                ),
            ):
                metadata_path = write_lora_manager_metadata(
                    model_path,
                    {
                        "source": "civitai",
                        "images": [
                            {
                                "url": "https://image.civitai.com/example.png",
                                "type": "image",
                            }
                        ],
                    },
                    category="loras",
                    create_preview=True,
                )

            preview_path = os.path.join(tmpdir, "preview-model.jpeg")
            self.assertTrue(os.path.isfile(preview_path))
            with Image.open(preview_path) as preview_image:
                self.assertEqual("JPEG", preview_image.format)
                self.assertEqual((480, 720), preview_image.size)
                self.assertEqual("RGB", preview_image.mode)
                self.assertFalse(preview_image.getexif())
            with open(metadata_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

        self.assertEqual(
            preview_path.replace(os.sep, "/"),
            payload["preview_url"],
        )
        response.raise_for_status.assert_called_once_with()
        response.close.assert_called_once_with()

    def test_preview_download_uses_system_trust_after_requests_ssl_error(self):
        ssl_error = downloader.requests.exceptions.SSLError("certificate error")
        with (
            patch(
                "core.downloader.request_public_url",
                side_effect=ssl_error,
            ),
            patch(
                "core.downloader._download_preview_image_with_system_trust",
                return_value=b"preview-data",
            ) as fallback,
        ):
            result = downloader._download_preview_image(
                "https://image.civitai.com/example.jpeg"
            )

        self.assertEqual(b"preview-data", result)
        fallback.assert_called_once_with(
            "https://image.civitai.com/example.jpeg"
        )

    def test_writes_optimized_civitai_video_preview_and_prefers_it_over_jpeg(self):
        video_data = b"\x00\x00\x00\x18ftypmp42preview-video"
        response = MagicMock()
        response.headers = {"Content-Length": str(len(video_data))}
        response.iter_content.return_value = [video_data]

        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "video-model.safetensors")
            old_image_path = os.path.join(tmpdir, "video-model.jpeg")
            with open(model_path, "wb") as handle:
                handle.write(b"model")
            with open(old_image_path, "wb") as handle:
                handle.write(b"old-image")

            with patch(
                "core.downloader.request_public_url",
                return_value=(
                    response,
                    "https://image.civitai.com/example.mp4",
                    {},
                ),
            ) as request_preview:
                metadata_path = write_lora_manager_metadata(
                    model_path,
                    {
                        "images": [
                            {
                                "url": (
                                    "https://image.civitai.com/x/"
                                    "original=true/12345.mp4"
                                ),
                                "type": "video",
                            }
                        ],
                    },
                    category="loras",
                    create_preview=True,
                )

            preview_path = os.path.join(tmpdir, "video-model.mp4")
            self.assertTrue(os.path.isfile(preview_path))
            with open(preview_path, "rb") as handle:
                self.assertEqual(video_data, handle.read())
            with open(metadata_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

            self.assertEqual(
                preview_path,
                downloader.get_existing_model_preview_path(model_path),
            )

        requested_url = request_preview.call_args.args[1]
        self.assertIn(
            "/transcode=true,width=450,optimized=true/",
            requested_url,
        )
        self.assertEqual(preview_path.replace(os.sep, "/"), payload["preview_url"])
        response.raise_for_status.assert_called_once_with()
        response.close.assert_called_once_with()

    def test_existing_model_preview_path_finds_adjacent_preview(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            preview_path = os.path.join(tmpdir, "model.jpeg")
            with open(model_path, "wb") as model_file:
                model_file.write(b"model")
            with open(preview_path, "wb") as preview_file:
                preview_file.write(b"preview")

            result = downloader.get_existing_model_preview_path(model_path)

        self.assertEqual(preview_path, result)

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
            metadata_path = get_model_resolver_sidecar_path(model_path)
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
            with open(
                get_model_resolver_sidecar_path(model_path),
                "w",
                encoding="utf-8",
            ) as handle:
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

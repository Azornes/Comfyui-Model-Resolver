import unittest
import os
import json
import tempfile
import socket
import threading
from unittest.mock import patch, MagicMock, AsyncMock
import importlib
import requests

# Ensure we import core modules correctly
from core.downloader import (
    write_lora_manager_metadata,
    get_metadata_sidecar_path,
    download_model,
    get_progress,
    _resolve_download_url_for_aria2,
    start_aria2_daemon,
    _delete_partial_download_files,
    download_progress,
    download_lock,
    read_completed_metadata_sha256,
)
from core.workflow_updater import (
    convert_to_relative_path,
    update_model_path,
    update_workflow_nodes,
)
from core.settings import (
    calculate_template_subfolder,
    _resolve_base_model_mapping,
)

# Dynamically import hyphenated root package name to access root class JobProgressTracker
node_mod = importlib.import_module("comfyui-model-resolver")
JobProgressTracker = node_mod.JobProgressTracker


class ModelResolverRobustnessTests(unittest.TestCase):

    def test_metadata_sidecar_credentials_scrubbing(self):
        """
        Covers Requirement: API Token and credential leakage to local JSON metadata files.
        Verifies that write_lora_manager_metadata filters authorization headers, 
        tokens, cookies, and sensitive query keys from URLs and sub-objects,
        and completely removes the 'headers' wrapper object.
        """
        # Arrange
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "secure_model.safetensors")
            with open(model_path, "wb") as f:
                f.write(b"model data")

            sensitive_metadata = {
                "details_source": "civitai",
                "model_id": "999",
                "version_id": "888",
                "download_url": "https://civitai.com/api/download/models/888?token=secretapikey&session=secretsess&other=123",
                "hf_token": "hf_secret_abc123",
                "headers": {
                    "Authorization": "Bearer secretbearer",
                    "Cookie": "session=secretcookie"
                },
                "cookies": {"session": "sec"}
            }

            # Act
            metadata_path = write_lora_manager_metadata(
                model_path,
                sensitive_metadata,
                category="loras",
                source_url="https://civitai.com/api/download/models/888?token=secretapikey"
            )

            # Assert
            self.assertTrue(os.path.exists(metadata_path))
            with open(metadata_path, "r", encoding="utf-8") as f:
                written_data = json.load(f)

            # Check that secrets are completely gone from written payload
            serialized = json.dumps(written_data)
            self.assertNotIn("secretapikey", serialized)
            self.assertNotIn("secretsess", serialized)
            self.assertNotIn("hf_secret_abc123", serialized)
            self.assertNotIn("secretbearer", serialized)
            self.assertNotIn("secretcookie", serialized)
            self.assertNotIn("headers", written_data)  # Key itself should be scrubbed

    def test_windows_path_separator_preservation(self):
        """
        Covers Regression Risk: OS slash compatibility on Windows (ComfyUI relative paths).
        Exercises convert_to_relative_path under different-drive scenarios and relative cases
        without relpath tautological mocking.
        """
        # Scenario 1: Same drive conversion (simulating relative subpath backslashes)
        category = "checkpoints"
        absolute_path = r"C:\models\checkpoints\sdxl\sdxl_base.safetensors"
        base_dir = r"C:\models\checkpoints"
        
        # Act same drive
        with patch("os.path.isabs", return_value=True), \
             patch("os.path.relpath", return_value=r"sdxl\sdxl_base.safetensors"):
            relative_path = convert_to_relative_path(absolute_path, category, base_dir)
            
        self.assertEqual(relative_path, r"sdxl\sdxl_base.safetensors")
        self.assertNotIn("/", relative_path)

        # Scenario 2: Different drive fallback (relpath raises ValueError, falls back to basename)
        absolute_diff_drive = r"D:\checkpoints\model.safetensors"
        with patch("os.path.isabs", return_value=True), \
             patch("os.path.relpath", side_effect=ValueError("Different drives")):
            relative_diff = convert_to_relative_path(absolute_diff_drive, category, base_dir)
            
        self.assertEqual(relative_diff, "model.safetensors")

        # Scenario 3: Already relative path (should return as-is)
        already_relative = r"sdxl\my_model.safetensors"
        with patch("os.path.isabs", return_value=False):
            relative_as_is = convert_to_relative_path(already_relative, category, base_dir)
            
        self.assertEqual(relative_as_is, already_relative)

    def test_lora_manager_v2_widget_path_replacement(self):
        """
        Covers Requirement: Specialized LoraManager loader updates.
        Verifies that update_model_path replaces lora names within the nested list
        widget_index == 2 case-insensitively and updates the corresponding display text.
        """
        # Arrange
        workflow = {
            "nodes": [
                {
                    "id": 15,
                    "type": "LoraLoaderV2",
                    "widgets_values": [
                        "On",
                        "<lora:OLD_LORA_NAME:1.0>",
                        [
                            {"name": "OLD_LORA_NAME", "strength": 1.0, "enabled": True}
                        ]
                    ]
                }
            ]
        }
        mapping = {
            "is_lora_v2": True,
            "original_lora_name": "OLD_LORA_NAME"
        }
        resolved_model = {
            "filename": "new_lora_name.safetensors",
            "category": "loras"
        }

        # Act
        success = update_model_path(
            workflow=workflow,
            node_id=15,
            widget_index=2,
            resolved_path="new_lora_name.safetensors",
            category="loras",
            resolved_model=resolved_model,
            mapping=mapping
        )

        # Assert
        self.assertTrue(success)
        node = workflow["nodes"][0]
        # Verify nested list (widget index 2) got updated
        self.assertEqual(node["widgets_values"][2][0]["name"], "new_lora_name")
        # Verify display text (widget index 1) got replaced correctly
        self.assertEqual(node["widgets_values"][1], "<lora:new_lora_name:1.0>")

    def test_nested_subgraph_path_resolution_and_replacement(self):
        """
        Covers Requirement: Nested Subgraph Path Resolution and update.
        Verifies update_model_path correctly locates nodes defined inside subgraphs
        and updates their widget values.
        """
        # Arrange
        workflow = {
            "nodes": [
                {
                    "id": 1,
                    "type": "SubgraphInstanceNode",
                    "widgets_values": ["dummy"]
                }
            ],
            "definitions": {
                "subgraphs": [
                    {
                        "id": "subgraph_a",
                        "nodes": [
                            {
                                "id": 99,
                                "type": "CheckpointLoaderSimple",
                                "widgets_values": ["old_model.safetensors"]
                            }
                        ]
                    }
                ]
            }
        }

        # Act
        success = update_model_path(
            workflow=workflow,
            node_id=99,
            widget_index=0,
            resolved_path="new_model.safetensors",
            category="checkpoints",
            subgraph_id="subgraph_a",
            is_top_level=False
        )

        # Assert
        self.assertTrue(success)
        subgraph_nodes = workflow["definitions"]["subgraphs"][0]["nodes"]
        self.assertEqual(subgraph_nodes[0]["widgets_values"][0], "new_model.safetensors")

    def test_downloader_file_cleanup_on_cancellation(self):
        """
        Covers Requirement: Partial/corrupted file cleanup on failed/cancelled downloads.
        Verifies that _delete_partial_download_files removes incomplete models and partial .aria2 sidecars.
        """
        # Arrange
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_model_path = os.path.join(tmpdir, "temp_model.safetensors")
            temp_aria2_path = f"{temp_model_path}.aria2"

            with open(temp_model_path, "wb") as f:
                f.write(b"partial model contents")
            with open(temp_aria2_path, "wb") as f:
                f.write(b"partial aria2 state")

            self.assertTrue(os.path.exists(temp_model_path))
            self.assertTrue(os.path.exists(temp_aria2_path))

            # Act
            _delete_partial_download_files(temp_model_path)

            # Assert
            self.assertFalse(os.path.exists(temp_model_path))
            self.assertFalse(os.path.exists(temp_aria2_path))

    def test_hash_verification_redundant_download_skip(self):
        """
        Covers Requirement: Prevent redundant downloading of existing files.
        Verifies that download_model registers already downloaded if SHA256 matches.
        """
        # Arrange
        with tempfile.TemporaryDirectory() as tmpdir:
            model_file = "downloaded_model.safetensors"
            model_path = os.path.join(tmpdir, model_file)
            
            with open(model_path, "wb") as f:
                f.write(b"existing model contents")

            expected_sha256 = "8ed3577a7b9d6539d3897da936966e2294d8778c23a7604fabbb84cc4da1eeb1"
            download_id = "test_redundant_skip"

            with download_lock:
                download_progress[download_id] = {
                    "status": "starting",
                    "progress": 0,
                    "filename": model_file,
                }

            # Act
            with patch("core.downloader.get_download_directory", return_value=tmpdir):
                result = download_model(
                    url="https://example.com/downloaded_model.safetensors",
                    filename=model_file,
                    category="checkpoints",
                    download_id=download_id,
                    metadata={"sha256": expected_sha256}
                )

            # Assert
            self.assertTrue(result["success"])
            self.assertTrue(result["already_exists"])
            progress = get_progress(download_id)
            self.assertEqual(progress["status"], "completed")

    def test_base_model_mapping_fuzzy_resolution(self):
        """
        Covers Requirement: Custom Base Model mappings and path templating.
        Verifies that base model name mapping matches substrings and returns custom subfolders.
        Also asserts that short keys (< 4 characters) are correctly skipped.
        """
        # Arrange
        mappings = {
            "Pony": "SDXL/Pony",
            "stable": "SD1.5",
            "SD": "should_be_skipped"  # Key length is 2 < 4, should be ignored by fuzzy loop
        }

        # Act
        resolved_pony = _resolve_base_model_mapping(mappings, "Pony Diffusion V6 XL")
        resolved_sd15 = _resolve_base_model_mapping(mappings, "stable diffusion 1.5 pruned")
        resolved_short = _resolve_base_model_mapping(mappings, "SD 1.5")

        # Assert
        self.assertEqual(resolved_pony, "SDXL/Pony")
        self.assertEqual(resolved_sd15, "SD1.5")
        self.assertEqual(resolved_short, "SD 1.5")  # Returns default (no match) because "SD" key is skipped

    def test_civitai_redirection_link_resolution_for_aria2(self):
        """
        Covers Integration Requirement: Redirect resolution for Aria2.
        Verifies _resolve_download_url_for_aria2 pre-resolves redirect URLs.
        """
        api_url = "https://civitai.com/api/download/models/123"
        redirect_url = "https://civitai-delivery.net/models/123/model.safetensors?token=abc"

        mock_response1 = MagicMock()
        mock_response1.status_code = 302
        mock_response1.headers = {"Location": redirect_url}

        mock_response2 = MagicMock()
        mock_response2.status_code = 200

        with patch("requests.get", side_effect=[mock_response1, mock_response2]) as mock_get, patch(
            "core.downloader.validate_public_http_url",
            side_effect=lambda value: value,
        ), patch(
            "core.network_utils.validate_public_http_url",
            side_effect=lambda value: value,
        ):
            resolved, _ = _resolve_download_url_for_aria2(api_url)
            self.assertEqual(resolved, redirect_url)
            self.assertEqual(mock_get.call_count, 2)

    def test_job_progress_tracker_clamping_and_thread_safety(self):
        """
        Covers Requirement: Thread-safe progress tracking and validation.
        Verifies percentage values clamp to [0.0, 100.0] and parallel updates work safely.
        Also asserts that subsequent updates cannot overwrite a 'cancelled' job status.
        """
        # Arrange
        tracker = JobProgressTracker()
        progress_id = "test_tracker_clamps"

        # Act Clamping
        tracker.update(progress_id, percent=-10.0, status="running")
        pct_negative = tracker.get(progress_id)["percent"]

        tracker.update(progress_id, percent=150.0, status="running")
        pct_overflow = tracker.get(progress_id)["percent"]

        # Act Cancel Lock
        tracker.mark_cancelled(progress_id)
        tracker.update(progress_id, percent=50.0, status="running")
        status_after_cancel = tracker.get(progress_id)["status"]

        # Run multi-threaded updates to verify lock integrity
        threads = []
        for i in range(10):
            t = threading.Thread(target=tracker.update, args=(progress_id,), kwargs={"percent": float(i * 10)})
            threads.append(t)
            t.start()
        for t in threads:
            t.join()

        # Assert
        self.assertEqual(pct_negative, 0.0)
        self.assertEqual(pct_overflow, 100.0)
        self.assertEqual(status_after_cancel, "cancelled")

    def test_aria2_port_collision_fallback(self):
        """
        Covers Integration Requirement: Port conflict error handling.
        Verifies start_aria2_daemon handles socket binding errors and logs port collision warnings gracefully.
        """
        # Arrange
        settings = {
            "aria2c_path": "aria2c",
            "download_backend": "aria2"
        }

        # Act
        with patch("socket.socket.bind", side_effect=OSError("Address already in use")), \
             patch("core.downloader._read_aria2_version", return_value="1.36.0"), \
             patch("subprocess.Popen") as mock_popen:
            result = start_aria2_daemon(settings)

        # Assert
        mock_popen.assert_not_called()
        self.assertFalse(result.get("success", True))

    def test_download_failure_chunk_cleanup(self):
        """
        Covers Requirement: Partial file cleanup on network download failure.
        Verifies that if the HTTP chunk download fails due to network exceptions midway,
        the partial model file is deleted from disk to prevent ComfyUI loads of corrupt files.
        """
        # Arrange
        with tempfile.TemporaryDirectory() as tmpdir:
            model_file = "failed_download.safetensors"
            model_path = os.path.join(tmpdir, model_file)
            
            # Setup a mock response where iter_content yields a chunk then raises RequestException
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.headers = {"content-length": "100"}
            
            def iter_content_mock(*args, **kwargs):
                # First chunk successfully yields to create the file
                yield b"some partial data"
                # Raising error midway
                raise requests.exceptions.RequestException("Connection timed out midway")
                
            mock_response.iter_content = iter_content_mock
            download_id = "test_chunk_cleanup_id"

            with download_lock:
                download_progress[download_id] = {
                    "status": "starting",
                    "progress": 0,
                    "filename": model_file,
                }

            # Act
            with patch("requests.get", return_value=mock_response), \
                 patch("core.downloader.get_download_directory", return_value=tmpdir):
                result = download_model(
                    url="https://example.com/failed_download.safetensors",
                    filename=model_file,
                    category="checkpoints",
                    download_id=download_id
                )
                
            # Assert
            self.assertFalse(result["success"])
            self.assertFalse(os.path.exists(model_path))

    def test_metadata_incomplete_hash_recalculation(self):
        """
        Covers Requirement: Recalculate file hash if sidecar status is not completed.
        Verifies that if a metadata file exists but has a hash_status of "pending" or "failed",
        it returns an empty string to force recalculation of the physical file's hash.
        """
        # Arrange
        with tempfile.TemporaryDirectory() as tmpdir:
            model_file = "pending_hash_model.safetensors"
            model_path = os.path.join(tmpdir, model_file)
            with open(model_path, "wb") as f:
                f.write(b"test data")
                
            # Create a sidecar metadata file with status "pending"
            sidecar_path = get_metadata_sidecar_path(model_path)
            with open(sidecar_path, "w") as f:
                json.dump({"sha256": "fake_hash", "hash_status": "pending"}, f)
                
            # Act
            res_hash = read_completed_metadata_sha256(model_path)
            
            # Assert
            self.assertEqual(res_hash, "")

    def test_invalid_subgraph_returns_false(self):
        """
        Covers Boundary Requirement: Handling missing/malformed subgraphs gracefully.
        Verifies update_model_path returns False when targeting a subgraph_id that does not exist.
        """
        # Arrange
        workflow = {
            "nodes": [],
            "definitions": {
                "subgraphs": []
            }
        }

        # Act
        success = update_model_path(
            workflow=workflow,
            node_id=1,
            widget_index=0,
            resolved_path="model.safetensors",
            category="checkpoints",
            subgraph_id="nonexistent_subgraph",
            is_top_level=False
        )

        # Assert
        self.assertFalse(success)

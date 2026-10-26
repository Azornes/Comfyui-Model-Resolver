import os
import tempfile
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from core.download.api import context as downloader
from core.download.aria2_backend import (
    download_file_with_aria2,
    pause_download,
    recover_aria2_missing_control_file,
    resume_download,
    start_background_sha256_verification,
)
from core.download.orchestrator import download_file, find_active_download_for_path
from core.path_utils import normalize_metadata_file_path


class DownloaderBoundaryTests(unittest.TestCase):
    def test_build_download_headers_cleans_values_and_adds_civitai_defaults(self):
        headers = downloader.build_download_headers(
            "https://civitai.com/api/download/models/123",
            {
                " user-agent ": "custom\r\n-agent",
                "X-Test": " value\n",
                "Empty": "  ",
            },
        )

        self.assertEqual("custom-agent", headers["user-agent"])
        self.assertEqual("value", headers["X-Test"])
        self.assertNotIn("Empty", headers)
        self.assertEqual("*/*", headers["Accept"])
        self.assertEqual("identity", headers["Accept-Encoding"])
        self.assertEqual("https://civitai.com/", headers["Referer"])
        self.assertEqual("https://civitai.com", headers["Origin"])

    def test_build_download_headers_does_not_add_provider_headers_for_other_hosts(self):
        headers = downloader.build_download_headers("https://example.com/model.safetensors")

        self.assertEqual(downloader.DOWNLOAD_USER_AGENT, headers["User-Agent"])
        self.assertNotIn("Referer", headers)
        self.assertNotIn("Origin", headers)

    def test_json_safe_metadata_redacts_secrets_and_signed_query_parameters(self):
        payload = downloader._json_safe_metadata(
            {
                "token": "secret-token",
                "nested": {
                    "Authorization": "secret-header",
                    "url": "https://example.com/model?token=secret&keep=yes",
                },
                "items": ({"cookie": "secret-cookie"}, {1, 2}),
                "custom": SimpleNamespace(value="safe"),
            }
        )

        self.assertNotIn("token", payload)
        self.assertNotIn("Authorization", payload["nested"])
        self.assertEqual("https://example.com/model?keep=yes", payload["nested"]["url"])
        self.assertEqual({}, payload["items"][0])
        self.assertEqual({1, 2}, set(payload["items"][1]))
        self.assertEqual("namespace(value='safe')", payload["custom"])

    def test_metadata_helper_coercions_preserve_non_numeric_values(self):
        self.assertIsNone(downloader._coerce_int_or_value(""))
        self.assertEqual(12, downloader._coerce_int_or_value("12"))
        self.assertEqual("unknown", downloader._coerce_int_or_value("unknown"))
        self.assertEqual(12, downloader._coerce_size("12.9"))
        self.assertEqual(0, downloader._coerce_size("not-a-size"))
        self.assertEqual("models/subfolder", downloader.normalize_metadata_file_path("models\\subfolder"))
        self.assertEqual("models/subfolder", normalize_metadata_file_path("models\\subfolder"))

    def test_metadata_source_and_model_type_helpers_cover_provider_variants(self):
        self.assertEqual(
            "diffusion_model",
            downloader._resolve_lora_manager_model_type("unknown", "diffusion model"),
        )
        self.assertEqual(
            "embedding",
            downloader._resolve_lora_manager_model_type("unknown", "textual inversion"),
        )
        self.assertEqual("civitai_api", downloader._metadata_source_value("civitai"))
        self.assertEqual("existing", downloader._metadata_source_value("unknown", "existing"))
        self.assertIsNone(downloader._metadata_source_value("unknown"))

    def test_aria2_rpc_sends_authenticated_json_rpc_request(self):
        response = MagicMock(status_code=200, text='{"result": {"version": "1.36"}}')
        response.json.return_value = {"result": {"version": "1.36"}}

        with patch.object(downloader, "aria2_rpc_url", "http://127.0.0.1:6800/jsonrpc"), patch.object(
            downloader, "aria2_rpc_secret", "rpc-secret"
        ), patch(
            "core.download.api.context.requests.post",
            return_value=response,
        ) as mock_post:
            result = downloader._aria2_rpc("aria2.getVersion")

        self.assertEqual({"version": "1.36"}, result)
        request_payload = mock_post.call_args.kwargs["json"]
        self.assertEqual("aria2.getVersion", request_payload["method"])
        self.assertEqual("token:rpc-secret", request_payload["params"][0])

    def test_aria2_rpc_rejects_missing_endpoint_and_invalid_json(self):
        with patch.object(downloader, "aria2_rpc_url", ""), self.assertRaises(
            downloader.Aria2Error
        ):
            downloader._aria2_rpc("aria2.getVersion")

        response = MagicMock(status_code=200, text="not-json")
        response.json.side_effect = ValueError("invalid json")
        with patch.object(
            downloader, "aria2_rpc_url", "http://127.0.0.1:6800/jsonrpc"
        ), patch(
            "core.download.api.context.requests.post",
            return_value=response,
        ), self.assertRaisesRegex(
            downloader.Aria2Error, "non-JSON"
        ):
            downloader._aria2_rpc("aria2.getVersion")

    def test_aria2_status_helpers_parse_values_and_paths(self):
        self.assertEqual(12, downloader._parse_aria2_int("12"))
        self.assertEqual(0, downloader._parse_aria2_int("not-a-number"))
        self.assertEqual(
            "C:/models/actual.safetensors",
            downloader._resolve_aria2_completed_path(
                {"files": [{"path": "C:/models/actual.safetensors"}]},
                "fallback.safetensors",
            ),
        )
        self.assertEqual(
            "fallback.safetensors",
            downloader._resolve_aria2_completed_path({}, "fallback.safetensors"),
        )

    def test_aria2_action_error_helper_recognizes_idempotent_states(self):
        self.assertTrue(downloader._aria2_action_error_is_ok("paused", "already paused"))
        self.assertTrue(downloader._aria2_action_error_is_ok("downloading", "not paused"))
        self.assertFalse(downloader._aria2_action_error_is_ok("paused", "permission denied"))
        self.assertFalse(downloader._aria2_action_error_is_ok("completed", "already paused"))

    def test_pause_and_resume_queue_their_expected_aria2_states(self):
        facade = SimpleNamespace(
            cancelled_downloads=set(),
            _queue_aria2_desired_state=MagicMock(
                side_effect=lambda download_id, status: {
                    "success": True,
                    "download_id": download_id,
                    "status": status,
                }
            ),
        )

        self.assertEqual(
            {"success": True, "download_id": "pause-1", "status": "paused"},
            pause_download("pause-1", dependencies=facade),
        )
        self.assertEqual(
            {
                "success": True,
                "download_id": "resume-1",
                "status": "downloading",
            },
            resume_download("resume-1", dependencies=facade),
        )
        facade._queue_aria2_desired_state.assert_has_calls(
            [call("pause-1", "paused"), call("resume-1", "downloading")]
        )

    def test_pause_and_resume_reject_downloads_being_cancelled(self):
        facade = SimpleNamespace(
            cancelled_downloads={"cancelled-1"},
            _queue_aria2_desired_state=MagicMock(),
        )

        self.assertEqual(
            {"success": False, "error": "Download is being cancelled"},
            pause_download("cancelled-1", dependencies=facade),
        )
        self.assertEqual(
            {"success": False, "error": "Download is being cancelled"},
            resume_download("cancelled-1", dependencies=facade),
        )
        facade._queue_aria2_desired_state.assert_not_called()

    def test_aria2_missing_control_file_error_is_detected(self):
        self.assertTrue(
            downloader._is_aria2_missing_control_file_error(
                "File exists, but a control file(*.aria2) does not exist. "
                "Download was canceled; add --allow-overwrite=true."
            )
        )
        self.assertFalse(
            downloader._is_aria2_missing_control_file_error(
                "TLS handshake failed"
            )
        )

    def test_aria2_missing_control_file_recovery_restarts_only_when_alone(self):
        facade = SimpleNamespace(
            aria2_lock=threading.Lock(),
            aria2_transfers={"download-1": {"gid": "gid-1"}},
            _aria2_rpc=MagicMock(),
            stop_aria2_daemon=MagicMock(return_value={"success": True}),
            _ensure_aria2_daemon=MagicMock(),
        )

        self.assertTrue(
            recover_aria2_missing_control_file(
                "download-1",
                "gid-1",
                {"download_backend": "aria2"},
                dependencies=facade,
            )
        )
        facade.stop_aria2_daemon.assert_called_once_with(
            reason="stale-control-file"
        )
        facade._ensure_aria2_daemon.assert_called_once()
        self.assertNotIn("download-1", facade.aria2_transfers)

        facade.aria2_transfers.update(
            {
                "download-1": {"gid": "gid-1"},
                "download-2": {"gid": "gid-2"},
            }
        )
        facade.stop_aria2_daemon.reset_mock()
        self.assertFalse(
            recover_aria2_missing_control_file(
                "download-1",
                "gid-1",
                dependencies=facade,
            )
        )
        facade.stop_aria2_daemon.assert_not_called()

    def test_active_download_path_is_reused_case_insensitively(self):
        active_id = find_active_download_for_path(
            {
                "active": {
                    "status": "downloading",
                    "path": r"C:\Models\Qwen.safetensors",
                },
                "finished": {
                    "status": "completed",
                    "path": r"C:\Models\Other.safetensors",
                },
            },
            r"c:\models\qwen.safetensors",
            os,
        )

        self.assertEqual("active", active_id)

    def test_progress_snapshot_is_copied_and_completed_entries_can_be_cleared(self):
        with patch.dict(
            downloader.download_progress,
            {
                "active": {"status": "downloading", "progress": 20},
                "completed": {"status": "completed"},
                "failed": {"status": "error"},
                "cancelled": {"status": "cancelled"},
            },
            clear=True,
        ), patch.object(
            downloader, "cancelled_downloads", {"cancelled", "active"}
        ):
            snapshot = downloader.get_all_progress()
            snapshot["active"]["progress"] = 100
            downloader.clear_completed_downloads()

            self.assertEqual(20, downloader.download_progress["active"]["progress"])
            self.assertEqual({"active"}, set(downloader.download_progress))
            self.assertEqual({"active"}, downloader.cancelled_downloads)

    def test_delete_python_partial_download_file_removes_only_partial_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            partial_path = os.path.join(temp_dir, "model.safetensors.partial")
            final_path = os.path.join(temp_dir, "model.safetensors")
            open(partial_path, "wb").close()
            open(final_path, "wb").close()

            downloader._delete_python_partial_download_file(partial_path)

            self.assertFalse(os.path.exists(partial_path))
            self.assertTrue(os.path.exists(final_path))

    def test_python_download_resumes_from_existing_partial_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "model.safetensors")
            partial_path = f"{dest_path}.part"
            initial_data = b"0123456789"
            with open(partial_path, "wb") as f:
                f.write(initial_data)

            remaining_data = b"ABCDEFGHIJ"
            total_data = initial_data + remaining_data

            mock_response = MagicMock()
            mock_response.status_code = 206
            mock_response.headers = {
                "Content-Range": f"bytes 10-19/{len(total_data)}",
                "Content-Length": "10",
            }
            mock_response.iter_content.return_value = [remaining_data]

            with patch.object(downloader, "_download_backend_from_settings", return_value="python"), \
                 patch.object(downloader, "request_public_url", return_value=(mock_response, "https://example.com/model.safetensors", {})) as mock_req, \
                 patch.object(downloader, "write_model_resolver_metadata", return_value=""):
                result = download_file(
                    "https://example.com/model.safetensors",
                    dest_path,
                    "resume-test-1",
                    dependencies=downloader,
                )

            self.assertTrue(result["success"], f"Download failed: {result}")
            self.assertEqual(len(total_data), result["size"])
            self.assertTrue(os.path.exists(dest_path))
            self.assertFalse(os.path.exists(partial_path))
            with open(dest_path, "rb") as f:
                self.assertEqual(total_data, f.read())

            sent_headers = mock_req.call_args.kwargs.get("headers", {})
            self.assertEqual("bytes=10-", sent_headers.get("Range"))

    def test_python_download_preserves_partial_file_on_read_timeout(self):
        import requests

        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "model.safetensors")
            partial_path = f"{dest_path}.part"

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.headers = {"Content-Length": "1000"}

            def failing_iter_content(*args, **kwargs):
                yield b"initial_chunk"
                raise requests.exceptions.ReadTimeout("Read timed out")

            mock_response.iter_content.side_effect = failing_iter_content

            with patch.object(downloader, "_download_backend_from_settings", return_value="python"), \
                 patch.object(downloader, "request_public_url", return_value=(mock_response, "https://example.com/model.safetensors", {})):
                result = download_file(
                    "https://example.com/model.safetensors",
                    dest_path,
                    "timeout-test-1",
                    dependencies=downloader,
                )

            self.assertFalse(result["success"])
            self.assertIn("Read timed out", result["error"])
            self.assertFalse(os.path.exists(dest_path))
            self.assertTrue(os.path.exists(partial_path))
            with open(partial_path, "rb") as f:
                self.assertEqual(b"initial_chunk", f.read())

    def test_python_download_deletes_partial_file_on_explicit_cancel(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "model.safetensors")
            partial_path = f"{dest_path}.part"

            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.headers = {"Content-Length": "1000"}

            def cancelling_iter_content(*args, **kwargs):
                downloader.cancelled_downloads.add("cancel-test-1")
                yield b"chunk"

            mock_response.iter_content.side_effect = cancelling_iter_content

            with patch.object(downloader, "_download_backend_from_settings", return_value="python"), \
                 patch.object(downloader, "request_public_url", return_value=(mock_response, "https://example.com/model.safetensors", {})):
                result = download_file(
                    "https://example.com/model.safetensors",
                    dest_path,
                    "cancel-test-1",
                    dependencies=downloader,
                )

            self.assertFalse(result["success"])
            self.assertFalse(os.path.exists(dest_path))
            self.assertFalse(os.path.exists(partial_path))

    def test_aria2_options_omit_checksum_and_integrity_check(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "model.safetensors")
            mock_rpc = MagicMock()
            mock_rpc.side_effect = ["test-gid", {}]

            with patch.object(downloader, "_ensure_aria2_daemon"), \
                 patch.object(downloader, "_resolve_download_url_for_aria2", return_value=("https://example.com/model.safetensors", {})), \
                 patch.object(downloader, "_aria2_rpc", mock_rpc), \
                 patch.object(downloader, "_aria2_tell_status", return_value={"status": "complete", "completedLength": "100", "totalLength": "100"}), \
                 patch.object(downloader, "write_model_resolver_metadata", return_value=""), \
                 patch.object(downloader, "_schedule_aria2_idle_stop"), \
                 patch.object(downloader, "invalidate_model_caches"), \
                 patch.object(downloader, "_start_background_sha256_verification"):

                result = download_file_with_aria2(
                    "https://example.com/model.safetensors",
                    dest_path,
                    "aria2-no-checksum-test",
                    metadata={"sha256": "a" * 64},
                    dependencies=downloader,
                )

            self.assertTrue(result["success"])
            add_uri_options = mock_rpc.call_args_list[0].args[1][1]
            self.assertNotIn("checksum", add_uri_options)
            self.assertNotIn("check-integrity", add_uri_options)

    def test_background_sha256_verification_success(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "test_model.safetensors")
            content = b"sample model weights for sha256 check"
            with open(dest_path, "wb") as f:
                f.write(content)

            import hashlib
            expected_sha = hashlib.sha256(content).hexdigest()
            sidecar_path = f"{dest_path}.modelresolver.json"
            downloader.write_json_atomic(sidecar_path, {"sha256": expected_sha})

            download_id = "bg-verify-success"
            with downloader.download_lock:
                downloader.download_progress[download_id] = {"status": "completed"}

            thread = start_background_sha256_verification(
                dest_path,
                expected_sha,
                download_id=download_id,
                metadata_path=sidecar_path,
                dependencies=downloader,
            )
            self.assertIsNotNone(thread)
            thread.join(timeout=5)

            with downloader.download_lock:
                progress = downloader.download_progress.get(download_id, {})
                self.assertTrue(progress.get("sha256_verified"))
                self.assertEqual(expected_sha, progress.get("sha256"))

            sidecar_meta = downloader.read_json_safe(sidecar_path, {})
            self.assertTrue(sidecar_meta.get("sha256_verified"))
            self.assertEqual(expected_sha, sidecar_meta.get("sha256"))

    def test_background_sha256_verification_mismatch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dest_path = os.path.join(temp_dir, "test_corrupt.safetensors")
            with open(dest_path, "wb") as f:
                f.write(b"corrupted content")

            expected_sha = "0" * 64
            sidecar_path = f"{dest_path}.modelresolver.json"
            downloader.write_json_atomic(sidecar_path, {"sha256": expected_sha})

            download_id = "bg-verify-mismatch"
            with downloader.download_lock:
                downloader.download_progress[download_id] = {"status": "completed"}

            thread = start_background_sha256_verification(
                dest_path,
                expected_sha,
                download_id=download_id,
                metadata_path=sidecar_path,
                dependencies=downloader,
            )
            self.assertIsNotNone(thread)
            thread.join(timeout=5)

            with downloader.download_lock:
                progress = downloader.download_progress.get(download_id, {})
                self.assertFalse(progress.get("sha256_verified"))
                self.assertIn("mismatch", progress.get("error", "").lower())

            sidecar_meta = downloader.read_json_safe(sidecar_path, {})
            self.assertFalse(sidecar_meta.get("sha256_verified"))



if __name__ == "__main__":
    unittest.main()

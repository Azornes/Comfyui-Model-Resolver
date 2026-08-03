import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.download.api import context as downloader
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


if __name__ == "__main__":
    unittest.main()

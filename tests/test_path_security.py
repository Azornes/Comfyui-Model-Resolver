import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

import core.downloader as downloader_module
from core.aria2_installer import Aria2InstallError, _safe_extract_tar
from core.downloader import (
    Aria2Error,
    _download_huggingface_xet,
    _resolve_aria2c_executable,
    _sanitize_download_error,
    download_file,
    download_file_with_aria2,
    download_model,
    is_allowed_model_download_filename,
    sanitize_download_filename,
)
from core.network_utils import (
    UnsafeUrlError,
    host_matches_domain,
    request_public_url,
    validate_public_http_url,
)
from core.path_utils import get_safe_metadata_sidecar_path, is_path_in_configured_model_roots


class DummyFolderPaths:
    def __init__(self, roots):
        self.folder_names_and_paths = {
            "checkpoints": (roots, {".safetensors"}),
        }

    def get_folder_paths(self, category):
        value = self.folder_names_and_paths.get(category, ([], set()))
        return list(value[0])


class PathSecurityTests(unittest.TestCase):
    def test_external_model_root_is_allowed(self):
        with tempfile.TemporaryDirectory() as model_root:
            model_path = os.path.join(model_root, "model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"model")

            self.assertTrue(
                is_path_in_configured_model_roots(
                    model_path,
                    DummyFolderPaths([model_root]),
                )
            )

        with tempfile.TemporaryDirectory() as model_root, tempfile.TemporaryDirectory() as other_root:
            outside_path = os.path.join(other_root, "model.safetensors")
            with open(outside_path, "wb") as handle:
                handle.write(b"model")

            self.assertFalse(
                is_path_in_configured_model_roots(
                    outside_path,
                    DummyFolderPaths([model_root]),
                )
            )

    def test_download_filename_is_forced_to_basename(self):
        self.assertEqual(
            "evil.safetensors",
            sanitize_download_filename("../nested/evil.safetensors"),
        )
        self.assertEqual(
            "evil.safetensors",
            sanitize_download_filename(r"C:\temp\evil.safetensors"),
        )

    def test_download_target_stays_inside_model_directory(self):
        with tempfile.TemporaryDirectory() as model_root:
            with patch("core.downloader.get_download_directory", return_value=model_root):
                with patch("core.downloader.download_file") as mock_download_file:
                    expected_path = os.path.join(model_root, "evil.safetensors")
                    mock_download_file.return_value = {
                        "success": True,
                        "download_id": "pathsecurity",
                        "path": expected_path,
                    }

                    result = download_model(
                        "https://example.com/evil.safetensors",
                        "../evil.safetensors",
                        "checkpoints",
                        download_id="pathsecurity",
                    )

            self.assertTrue(result["success"])
            self.assertEqual(
                os.path.join(model_root, "evil.safetensors"),
                mock_download_file.call_args.args[1],
            )

    def test_non_model_executable_download_is_rejected(self):
        self.assertFalse(is_allowed_model_download_filename("payload.exe"))
        self.assertTrue(is_allowed_model_download_filename("model.safetensors"))

    def test_metadata_path_is_always_canonical_sidecar(self):
        with tempfile.TemporaryDirectory() as model_root:
            model_path = os.path.join(model_root, "model.safetensors")
            with open(model_path, "wb") as handle:
                handle.write(b"model")

            metadata_path = get_safe_metadata_sidecar_path(model_path)
            self.assertEqual(
                os.path.join(model_root, "model.metadata.json"),
                metadata_path,
            )
            self.assertNotEqual(model_path, metadata_path)

    def test_private_and_local_download_urls_are_rejected(self):
        for url in (
            "http://127.0.0.1:8188/internal",
            "http://10.0.0.1/model.safetensors",
            "http://[::1]/model.safetensors",
            "file:///etc/passwd",
        ):
            with self.subTest(url=url):
                with self.assertRaises(UnsafeUrlError):
                    validate_public_http_url(url)

    def test_provider_domain_matching_does_not_accept_lookalikes(self):
        self.assertTrue(host_matches_domain("huggingface.co", "huggingface.co"))
        self.assertTrue(host_matches_domain("cdn.huggingface.co", "huggingface.co"))
        self.assertFalse(
            host_matches_domain("huggingface.co.attacker.example", "huggingface.co")
        )
        self.assertFalse(host_matches_domain("evilcivitai.com", "civitai.com"))

    def test_redirect_to_loopback_is_blocked_before_second_request(self):
        redirect_response = MagicMock()
        redirect_response.status_code = 302
        redirect_response.headers = {
            "Location": "http://127.0.0.1:8188/private"
        }

        with patch(
            "core.network_utils.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("93.184.216.34", 443))],
        ), patch(
            "core.network_utils.requests.get",
            return_value=redirect_response,
        ) as mock_get:
            with self.assertRaises(UnsafeUrlError):
                request_public_url(
                    "GET",
                    "https://example.com/model.safetensors",
                    headers={"Authorization": "Bearer secret"},
                )

        mock_get.assert_called_once()
        redirect_response.close.assert_called_once()

    def test_authorization_is_preserved_only_for_explicit_xet_bridge(self):
        redirect_response = MagicMock()
        redirect_response.status_code = 302
        redirect_response.headers = {
            "Location": "https://cas-bridge.xethub.hf.co/object?signature=test"
        }
        final_response = MagicMock()
        final_response.status_code = 200
        final_response.headers = {}

        with patch(
            "core.network_utils.socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("93.184.216.34", 443))],
        ), patch(
            "core.network_utils.requests.get",
            side_effect=[redirect_response, final_response],
        ) as mock_get:
            response, final_url, final_headers = request_public_url(
                "GET",
                "https://huggingface.co/example/resolve/main/model.safetensors",
                headers={
                    "Authorization": "Bearer secret",
                    "Cookie": "session=secret",
                },
                trusted_sensitive_redirect_hosts={"cas-bridge.xethub.hf.co"},
                trusted_sensitive_redirect_headers={"authorization"},
            )

        self.assertIs(response, final_response)
        self.assertEqual("https://cas-bridge.xethub.hf.co/object?signature=test", final_url)
        self.assertEqual("Bearer secret", final_headers["Authorization"])
        self.assertNotIn("Cookie", final_headers)
        self.assertEqual("Bearer secret", mock_get.call_args_list[1].kwargs["headers"]["Authorization"])
        self.assertNotIn("Cookie", mock_get.call_args_list[1].kwargs["headers"])

    def test_aria2_backend_does_not_get_replaced_by_hf_xet(self):
        expected = {"success": True, "download_id": "aria-xet"}
        with patch(
            "core.downloader._download_backend_from_settings",
            return_value="aria2",
        ), patch(
            "core.downloader._download_huggingface_xet",
        ) as mock_xet, patch(
            "core.downloader.download_file_with_aria2",
            return_value=expected,
        ) as mock_aria2:
            result = download_file(
                "https://huggingface.co/example/resolve/main/model.safetensors",
                "model.safetensors",
                "aria-xet",
                headers={"Authorization": "Bearer secret"},
            )

        self.assertEqual(expected, result)
        mock_xet.assert_not_called()
        mock_aria2.assert_called_once()

    def test_aria2_cannot_follow_an_unvalidated_redirect_after_preflight(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = os.path.join(temp_dir, "model.safetensors")
            Path(destination).write_bytes(b"model")
            with patch(
                "core.downloader.load_settings",
                return_value={"download_backend": "aria2"},
            ), patch(
                "core.downloader._ensure_aria2_daemon",
            ), patch(
                "core.downloader._resolve_download_url_for_aria2",
                return_value=(
                    "https://cas-bridge.xethub.hf.co/object?signature=test",
                    {"Authorization": "Bearer secret"},
                ),
            ), patch(
                "core.downloader._aria2_rpc",
                return_value="test-gid",
            ) as mock_rpc, patch(
                "core.downloader._aria2_tell_status",
                return_value={
                    "status": "complete",
                    "completedLength": "5",
                    "totalLength": "5",
                },
            ), patch(
                "core.downloader.write_lora_manager_metadata",
                return_value="",
            ), patch(
                "core.downloader._schedule_aria2_idle_stop",
            ):
                result = download_file_with_aria2(
                    "https://huggingface.co/example/resolve/main/model.safetensors",
                    destination,
                    "aria-no-redirect",
                )

        self.assertTrue(result["success"])
        add_uri_params = mock_rpc.call_args_list[0].args[1]
        self.assertEqual("0", add_uri_params[1]["max-redirect"])

    def test_aria2_resume_does_not_replace_uri_of_partial_download(self):
        transfer = {
            "gid": "test-gid",
            "path": "model.safetensors",
        }
        rpc_calls = []

        def fake_rpc(method, params):
            rpc_calls.append((method, params))
            return "OK"

        with patch.dict(
            downloader_module.aria2_transfers,
            {"resume-xet": transfer},
            clear=True,
        ), patch.dict(
            downloader_module.aria2_desired_states,
            {"resume-xet": {"status": "downloading", "seq": 1, "running": True}},
            clear=True,
        ), patch.dict(
            downloader_module.download_progress,
            {"resume-xet": {"status": "paused", "speed": 0}},
            clear=True,
        ), patch(
            "core.downloader._resolve_download_url_for_aria2",
        ) as mock_resolve, patch(
            "core.downloader._aria2_rpc",
            side_effect=fake_rpc,
        ):
            downloader_module._run_aria2_desired_state_worker("resume-xet")

        self.assertEqual([("aria2.unpause", ["test-gid"])], rpc_calls)
        mock_resolve.assert_not_called()

    def test_aria2_status_poll_retries_transient_connection_reset(self):
        expected_status = {
            "gid": "test-gid",
            "status": "active",
            "completedLength": "1024",
        }
        transient_error = requests.exceptions.ConnectionError(
            "Connection reset by peer"
        )

        with patch(
            "core.downloader._aria2_rpc",
            side_effect=[transient_error, expected_status],
        ) as mock_rpc, patch("core.downloader.time.sleep") as mock_sleep:
            status = downloader_module._aria2_tell_status("test-gid")

        self.assertEqual(expected_status, status)
        self.assertEqual(2, mock_rpc.call_count)
        mock_sleep.assert_called_once_with(
            downloader_module.ARIA2_STATUS_RPC_RETRY_DELAY
        )

    def test_aria2_can_resume_partial_file_after_rpc_failure(self):
        with tempfile.TemporaryDirectory() as model_root:
            destination = os.path.join(model_root, "model.safetensors")
            Path(destination).write_bytes(b"partial")
            Path(f"{destination}.aria2").write_bytes(b"control")
            expected = {
                "success": True,
                "download_id": "resume-partial",
                "path": destination,
            }

            with patch(
                "core.downloader.get_download_directory",
                return_value=model_root,
            ), patch(
                "core.downloader._download_backend_from_settings",
                return_value="aria2",
            ), patch(
                "core.downloader.download_file",
                return_value=expected,
            ) as mock_download:
                result = download_model(
                    "https://huggingface.co/example/resolve/main/model.safetensors",
                    "model.safetensors",
                    "checkpoints",
                    download_id="resume-partial",
                )

        self.assertEqual(expected, result)
        mock_download.assert_called_once()

    def test_arbitrary_aria2_executable_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = os.path.join(temp_dir, "aria2c.exe")
            with open(executable, "wb") as handle:
                handle.write(b"not an executable")

            with patch("core.downloader.shutil.which", return_value=None):
                with self.assertRaises(Aria2Error):
                    _resolve_aria2c_executable({"aria2c_path": executable})

    def test_managed_aria2_executable_path_is_allowed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = os.path.join(temp_dir, "aria2c.exe")
            with open(executable, "wb") as handle:
                handle.write(b"managed executable")

            with patch("core.downloader.MANAGED_ARIA2_ROOT", Path(temp_dir)):
                resolved = _resolve_aria2c_executable({"aria2c_path": executable})
            self.assertEqual(os.path.realpath(executable), resolved)

    def test_huggingface_xet_download_bypasses_signed_http_bridge(self):
        file_metadata = MagicMock()
        file_metadata.size = 5
        file_metadata.xet_file_data = SimpleNamespace(
            file_hash="test-hash",
            refresh_route="https://huggingface.co/xet-token",
        )
        session = MagicMock()
        group = MagicMock()
        session.new_file_download_group.return_value = group
        group.__enter__.return_value = group

        def fake_start_download_file(file_info, destination_path):
            Path(destination_path).write_bytes(b"model")
            progress_callback = session.new_file_download_group.call_args.kwargs[
                "progress_callback"
            ]
            progress_callback(
                SimpleNamespace(
                    total_bytes_completed=5,
                    total_bytes_completion_rate=5000,
                    total_transfer_bytes_completed=5,
                    total_transfer_bytes=5,
                    total_transfer_bytes_completion_rate=2.5,
                ),
                {},
            )

        group.start_download_file.side_effect = fake_start_download_file

        with tempfile.TemporaryDirectory() as temp_dir:
            destination = os.path.join(temp_dir, "model.safetensors")
            with patch(
                "core.downloader.validate_public_http_url",
                side_effect=lambda url: url,
            ), patch(
                "huggingface_hub.file_download.get_hf_file_metadata",
                return_value=file_metadata,
            ), patch(
                "huggingface_hub.utils._xet.get_xet_session",
                return_value=session,
                create=True,
            ), patch(
                "huggingface_hub.utils._xet.xet_headers_without_auth",
                side_effect=lambda headers: headers,
                create=True,
            ), patch(
                "hf_xet.XetSession",
                create=True,
            ), patch(
                "hf_xet.XetFileInfo",
                side_effect=lambda hash, file_size: SimpleNamespace(
                    hash=hash,
                    file_size=file_size,
                ),
                create=True,
            ), patch(
                "core.downloader.write_lora_manager_metadata",
                return_value=os.path.join(temp_dir, "model.metadata.json"),
            ):
                result = _download_huggingface_xet(
                    "https://huggingface.co/example/model/resolve/main/model.safetensors",
                    destination,
                    "xet-test",
                )

            self.assertTrue(result["success"])
            self.assertEqual(5, result["size"])
            self.assertEqual(b"model", Path(destination).read_bytes())
            group.start_download_file.assert_called_once()
            self.assertEqual(
                200,
                session.new_file_download_group.call_args.kwargs[
                    "progress_interval_ms"
                ],
            )

    def test_huggingface_xet_detailed_progress_reports_speed_and_fraction(self):
        download_id = "xet-progress-test"
        total_size = 8 * 1024**3
        downloaded = 64 * 1024**2
        adapter = downloader_module._HuggingFaceXetProgressAdapter(
            download_id,
            total_size,
            0,
        )
        total_update = SimpleNamespace(
            total_bytes_completed=downloaded,
            total_bytes_completion_rate=1024**3,
            total_transfer_bytes_completed=48 * 1024**2,
            total_transfer_bytes=6 * 1024**3,
            total_transfer_bytes_completion_rate=10 * 1024**2,
        )

        with patch.dict(
            downloader_module.download_progress,
            {download_id: {}},
            clear=True,
        ):
            adapter(total_update, [])
            progress = downloader_module.download_progress[download_id]

        self.assertEqual("downloading", progress["status"])
        self.assertEqual(downloaded, progress["downloaded"])
        self.assertEqual(10 * 1024**2, progress["speed"])
        self.assertEqual(48 * 1024**2, progress["transfer_downloaded"])
        self.assertEqual(6 * 1024**3, progress["transfer_total_size"])
        self.assertEqual(0.8, progress["transfer_progress"])
        self.assertEqual(0.8, progress["progress"])

    def test_huggingface_xet_without_refresh_helper_uses_native_fallback(self):
        legacy_hf_xet = SimpleNamespace(
            PyItemProgressUpdate=object(),
            PyTotalProgressUpdate=object(),
            PyXetDownloadInfo=object(),
            download_files=MagicMock(),
        )
        real_import = __import__

        def import_without_refresh_helper(
            name,
            globals=None,
            locals=None,
            fromlist=(),
            level=0,
        ):
            if name == "hf_xet":
                return legacy_hf_xet
            if (
                name == "huggingface_hub.utils"
                and "refresh_xet_connection_info" in fromlist
            ):
                raise ImportError("refresh_xet_connection_info is unavailable")
            return real_import(name, globals, locals, fromlist, level)

        incomplete_path = Path("model.safetensors.xet-part")
        xet_file_data = SimpleNamespace(file_hash="test-hash")
        progress_adapter = MagicMock()

        with patch(
            "builtins.__import__",
            side_effect=import_without_refresh_helper,
        ), patch("huggingface_hub.file_download.xet_get") as mock_xet_get:
            downloader_module._run_huggingface_xet_transfer(
                incomplete_path,
                xet_file_data,
                {"Authorization": "Bearer test"},
                1024,
                "model.safetensors",
                progress_adapter,
            )

        mock_xet_get.assert_called_once_with(
            incomplete_path=incomplete_path,
            xet_file_data=xet_file_data,
            headers={"Authorization": "Bearer test"},
            expected_size=1024,
            displayed_filename="model.safetensors",
            _tqdm_bar=progress_adapter,
        )
        legacy_hf_xet.download_files.assert_not_called()

    def test_cancel_download_calls_active_huggingface_xet_handle(self):
        download_id = "xet-cancel-handle-test"
        handle = MagicMock()

        with patch.dict(
            downloader_module.download_progress,
            {download_id: {"status": "downloading"}},
            clear=True,
        ), patch.dict(
            downloader_module.xet_transfers,
            {download_id: {"handle": handle, "partial_path": "model.xet-part"}},
            clear=True,
        ):
            downloader_module.cancel_download(download_id)

        handle.cancel.assert_called_once_with()
        downloader_module.cancelled_downloads.discard(download_id)

    def test_huggingface_xet_partial_cleanup_retries_windows_file_lock(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            partial_path = os.path.join(temp_dir, "model.safetensors.xet-part")
            Path(partial_path).write_bytes(b"partial")
            real_remove = os.remove
            attempts = 0

            def remove_after_lock_released(path):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise PermissionError("file is still in use")
                real_remove(path)

            with patch("core.downloader.os.remove", side_effect=remove_after_lock_released), patch(
                "core.downloader.time.sleep"
            ):
                removed = downloader_module._delete_xet_partial_file(partial_path)

            self.assertTrue(removed)
            self.assertEqual(2, attempts)
            self.assertFalse(os.path.exists(partial_path))

    def test_huggingface_xet_does_not_infer_network_speed_from_file_progress(self):
        download_id = "xet-no-derived-speed-test"
        adapter = downloader_module._HuggingFaceXetProgressAdapter(
            download_id,
            100 * 1024**2,
            0,
        )

        with patch.dict(
            downloader_module.download_progress,
            {download_id: {}},
            clear=True,
        ):
            adapter(
                SimpleNamespace(
                    total_bytes_completed=10 * 1024**2,
                    total_bytes_completion_rate=1024**3,
                    total_transfer_bytes_completed=0,
                    total_transfer_bytes=80 * 1024**2,
                    total_transfer_bytes_completion_rate=None,
                ),
                {},
            )
            progress = downloader_module.download_progress[download_id]

        self.assertEqual(10 * 1024**2, progress["downloaded"])
        self.assertEqual(0, progress["speed"])

    def test_signed_download_query_is_removed_from_error(self):
        error = _sanitize_download_error(
            "403 for url: https://cas-bridge.xethub.hf.co/object?Policy=secret&Signature=secret"
        )
        self.assertEqual(
            "403 for url: https://cas-bridge.xethub.hf.co/object",
            error,
        )

    def test_tar_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = os.path.join(temp_dir, "aria2.tar")
            destination = Path(temp_dir) / "extract"
            destination.mkdir()
            with tarfile.open(archive_path, "w") as archive:
                payload = tarfile.TarInfo("safe.txt")
                payload.size = 4
                archive.addfile(payload, io.BytesIO(b"safe"))
                link = tarfile.TarInfo("escape")
                link.type = tarfile.SYMTYPE
                link.linkname = "../../outside"
                archive.addfile(link)

            with self.assertRaises(Aria2InstallError):
                _safe_extract_tar(Path(archive_path), destination)


if __name__ == "__main__":
    unittest.main()

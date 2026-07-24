import os
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from core.file_manager import (
    FileManagerError,
    FileManagerUnavailableError,
    UnsupportedFileManagerPlatformError,
    normalize_file_manager_path,
    open_in_file_manager,
)


class FileManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.directory = os.path.join(self.temp_dir.name, "models with spaces")
        os.makedirs(self.directory)
        self.file_path = os.path.join(self.directory, "módel.safetensors")
        with open(self.file_path, "wb") as handle:
            handle.write(b"test")

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def successful_process():
        process = MagicMock()
        process.wait.return_value = 0
        return process

    def test_rejects_empty_non_string_and_null_byte_paths(self):
        for value in ("", "   ", None, {"path": "model"}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_file_manager_path(value)
        with self.assertRaises(ValueError):
            normalize_file_manager_path("bad\x00path")

    def test_preserves_an_existing_posix_path_with_literal_backslash(self):
        with patch("core.file_manager.os.name", "posix"), patch(
            "core.file_manager._normalized_absolute_path",
            side_effect=["/models/literal\\name", "/models/literal/name"],
        ), patch(
            "core.file_manager.os.path.exists",
            side_effect=[True],
        ):
            result = normalize_file_manager_path("/models/literal\\name")

        self.assertEqual(result, "/models/literal\\name")

    def test_recovers_frontend_backslash_separators_on_posix(self):
        with patch("core.file_manager.os.name", "posix"), patch(
            "core.file_manager._normalized_absolute_path",
            side_effect=["/models/pony\\styles", "/models/pony/styles"],
        ), patch(
            "core.file_manager.os.path.exists",
            side_effect=[False, True],
        ):
            result = normalize_file_manager_path("/models/pony\\styles")

        self.assertEqual(result, "/models/pony/styles")

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which")
    def test_windows_reveals_a_file_and_handles_unicode(self, mock_which, mock_popen):
        mock_which.return_value = r"C:\Windows\explorer.exe"
        mock_popen.return_value = self.successful_process()

        result = open_in_file_manager(self.file_path, system="Windows")

        command = mock_popen.call_args.args[0]
        self.assertEqual(command, [r"C:\Windows\explorer.exe", "/select,", os.path.realpath(self.file_path)])
        self.assertFalse(mock_popen.call_args.kwargs["shell"])
        self.assertTrue(result["selected"])

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which")
    def test_windows_opens_a_directory_without_select(self, mock_which, mock_popen):
        mock_which.return_value = r"C:\Windows\explorer.exe"
        mock_popen.return_value = self.successful_process()

        result = open_in_file_manager(self.directory, system="Windows")

        command = mock_popen.call_args.args[0]
        self.assertEqual(command, [r"C:\Windows\explorer.exe", os.path.realpath(self.directory)])
        self.assertFalse(result["selected"])

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/open")
    def test_macos_reveals_a_file(self, _mock_which, mock_popen):
        mock_popen.return_value = self.successful_process()

        result = open_in_file_manager(self.file_path, system="Darwin")

        self.assertEqual(
            mock_popen.call_args.args[0],
            ["/usr/bin/open", "-R", os.path.realpath(self.file_path)],
        )
        self.assertTrue(result["selected"])

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/open")
    def test_macos_opens_a_directory(self, _mock_which, mock_popen):
        mock_popen.return_value = self.successful_process()

        open_in_file_manager(self.directory, system="Darwin")

        self.assertEqual(
            mock_popen.call_args.args[0],
            ["/usr/bin/open", os.path.realpath(self.directory)],
        )

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which")
    def test_linux_opens_the_parent_directory_with_xdg_open(self, mock_which, mock_popen):
        mock_which.side_effect = lambda name: "/usr/bin/xdg-open" if name == "xdg-open" else None
        mock_popen.return_value = self.successful_process()

        result = open_in_file_manager(self.file_path, system="Linux")

        self.assertEqual(
            mock_popen.call_args.args[0],
            ["/usr/bin/xdg-open", os.path.realpath(self.directory)],
        )
        self.assertFalse(result["selected"])

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which")
    def test_linux_falls_back_to_gio_for_a_directory(self, mock_which, mock_popen):
        mock_which.side_effect = lambda name: "/usr/bin/gio" if name == "gio" else None
        mock_popen.return_value = self.successful_process()

        result = open_in_file_manager(self.directory, system="Linux")

        self.assertEqual(
            mock_popen.call_args.args[0],
            ["/usr/bin/gio", "open", os.path.realpath(self.directory)],
        )
        self.assertEqual(result["launcher"], "gio")

    @patch("core.file_manager.shutil.which", return_value=None)
    def test_missing_launcher_has_a_specific_error(self, _mock_which):
        with self.assertRaises(FileManagerUnavailableError):
            open_in_file_manager(self.directory, system="Linux")

    def test_missing_and_special_paths_are_rejected(self):
        with self.assertRaises(FileNotFoundError):
            open_in_file_manager(os.path.join(self.temp_dir.name, "missing"), system="Linux")

        with patch("core.file_manager.os.path.exists", return_value=True), patch(
            "core.file_manager.os.path.isfile", return_value=False
        ), patch(
            "core.file_manager.os.path.isdir", return_value=False
        ), self.assertRaises(FileManagerError):
            open_in_file_manager(self.directory, system="Linux")

    def test_unsupported_platform_has_a_specific_error(self):
        with self.assertRaises(UnsupportedFileManagerPlatformError):
            open_in_file_manager(self.directory, system="FreeBSD")

    @patch("core.file_manager.subprocess.Popen", side_effect=OSError("launch failed"))
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/xdg-open")
    def test_spawn_failure_is_wrapped(self, _mock_which, _mock_popen):
        with self.assertRaisesRegex(FileManagerError, "launch failed"):
            open_in_file_manager(self.directory, system="Linux")

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/xdg-open")
    def test_fast_nonzero_launcher_exit_is_reported(self, _mock_which, mock_popen):
        process = MagicMock()
        process.wait.return_value = 3
        mock_popen.return_value = process

        with self.assertRaisesRegex(FileManagerError, "code 3"):
            open_in_file_manager(self.directory, system="Linux")

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/xdg-open")
    def test_launcher_wait_failure_is_wrapped(self, _mock_which, mock_popen):
        process = MagicMock()
        process.wait.side_effect = OSError("wait failed")
        mock_popen.return_value = process

        with self.assertRaisesRegex(FileManagerError, "wait failed"):
            open_in_file_manager(self.directory, system="Linux")

    @patch("core.file_manager.subprocess.Popen")
    @patch("core.file_manager.shutil.which", return_value="/usr/bin/xdg-open")
    def test_long_running_launcher_is_treated_as_started(self, _mock_which, mock_popen):
        process = MagicMock()
        process.wait.side_effect = subprocess.TimeoutExpired("xdg-open", 2.0)
        mock_popen.return_value = process

        result = open_in_file_manager(self.directory, system="Linux")

        self.assertEqual(result["launcher"], "xdg-open")

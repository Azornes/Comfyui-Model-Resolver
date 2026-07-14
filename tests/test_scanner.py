import unittest
from unittest.mock import patch, MagicMock
from core.scanner import _model_identity, scan_directory, find_local_file_path

class ScannerTests(unittest.TestCase):

    def test_model_identity_empty_and_valid(self):
        self.assertEqual(_model_identity({}), "")
        
        with patch("core.scanner._path_identity", return_value="stable_id"):
            self.assertEqual(_model_identity({"path": "/path/to/file"}), "stable_id")

    @patch("os.walk")
    @patch("os.path.exists")
    @patch("os.path.isdir")
    def test_scan_directory(self, mock_isdir, mock_exists, mock_walk):
        mock_exists.return_value = True
        mock_isdir.return_value = True
        
        # Setup mock file hierarchy
        # os.walk yields: (dirpath, dirnames, filenames)
        mock_walk.return_value = [
            ("/models/checkpoints", ["subdir"], ["root_model.safetensors", "readme.txt"]),
            ("/models/checkpoints/subdir", [], ["nested_model.ckpt"])
        ]
        
        extensions = {".safetensors", ".ckpt"}
        models = scan_directory("/models/checkpoints", extensions, "checkpoints")
        
        # Verify that we found the two models and ignored readme.txt
        self.assertEqual(len(models), 2)
        
        # First model check
        m1 = next(m for m in models if m["filename"] == "root_model.safetensors")
        self.assertEqual(m1["relative_path"].replace("\\", "/"), "root_model.safetensors")
        self.assertEqual(m1["category"], "checkpoints")
        import os
        self.assertEqual(m1["base_directory"], os.path.abspath("/models/checkpoints"))

        # Second model check
        m2 = next(m for m in models if m["filename"] == "nested_model.ckpt")
        self.assertEqual(m2["relative_path"].replace("\\", "/"), "subdir/nested_model.ckpt")

    @patch("os.walk")
    @patch("os.path.exists")
    @patch("os.path.isdir")
    def test_scan_directory_respects_explicit_extensions(
        self, mock_isdir, mock_exists, mock_walk
    ):
        mock_exists.return_value = True
        mock_isdir.return_value = True
        mock_walk.return_value = [
            (
                "/models/diffusion_models",
                [],
                ["quantized.gguf", "regular.safetensors"],
            )
        ]

        models = scan_directory(
            "/models/diffusion_models", {".gguf"}, "model_gguf"
        )

        self.assertEqual([model["filename"] for model in models], ["quantized.gguf"])

    @patch("core.scanner.folder_paths")
    @patch("core.scanner.get_model_files")
    def test_find_local_file_path(self, mock_get_files, mock_folder_paths):
        # 1. Test not found
        mock_get_files.return_value = []
        mock_folder_paths.get_full_path.return_value = None
        self.assertIsNone(find_local_file_path("missing.safetensors", "checkpoints"))

        # 2. Test found via folder_paths
        mock_folder_paths.get_full_path.return_value = "/models/checkpoints/my_model.safetensors"
        self.assertEqual(
            find_local_file_path("my_model.safetensors", "checkpoints"),
            "/models/checkpoints/my_model.safetensors"
        )

        # 3. Test found via local scanner fallback
        mock_folder_paths.get_full_path.return_value = None
        mock_get_files.return_value = [
            {"filename": "fallback.safetensors", "path": "/models/other/fallback.safetensors"}
        ]
        self.assertEqual(
            find_local_file_path("fallback.safetensors", "checkpoints"),
            "/models/other/fallback.safetensors"
        )

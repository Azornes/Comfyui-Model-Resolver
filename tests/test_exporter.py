import os
import tempfile
import unittest

from core.exporter import (
    build_model_links_markdown,
    compute_sha256,
    is_inside_model_dirs,
    strip_secrets,
)
from core.download.directories import get_download_directory
from core.downloader import download_model
from core.sources.huggingface import parse_huggingface_url


class ExporterTests(unittest.TestCase):

    def test_strip_secrets(self):
        url = "https://huggingface.co/repo/model.safetensors?token=secret123&keep=yes"
        self.assertEqual(
            strip_secrets(url),
            "https://huggingface.co/repo/model.safetensors?keep=yes",
        )
        url_civ = "https://civitai.com/api/download/models/123?token=civkey&foo=bar"
        self.assertEqual(
            strip_secrets(url_civ),
            "https://civitai.com/api/download/models/123?foo=bar",
        )
        self.assertEqual(strip_secrets(""), "")
        self.assertEqual(strip_secrets("not-a-url"), "not-a-url")

    def test_build_model_links_markdown(self):
        models = [
            {
                "name": "flux1-dev.safetensors",
                "directory": "diffusion_models",
                "url": "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors?token=secret",
            },
            {
                "name": "loras/my_style.safetensors",
                "directory": "loras",
                "url": "",
            },
        ]
        markdown = build_model_links_markdown(models)
        self.assertIn("## Model links", markdown)
        self.assertIn("**diffusion_models**", markdown)
        self.assertIn("[flux1-dev.safetensors](https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors)", markdown)
        self.assertNotIn("token=secret", markdown)
        self.assertIn("- my_style.safetensors (no public link)", markdown)
        self.assertIn("## Model storage location", markdown)
        self.assertIn("📂 diffusion_models/", markdown)
        self.assertIn("flux1-dev.safetensors", markdown)

    def test_compute_sha256(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"model-resolver-test-data")
            f_path = f.name
        try:
            h = compute_sha256(f_path)
            self.assertEqual(len(h), 64)
            # Second call hits cache
            self.assertEqual(compute_sha256(f_path), h)
        finally:
            if os.path.exists(f_path):
                os.remove(f_path)

    def test_is_inside_model_dirs_rejects_nonexistent_or_arbitrary(self):
        self.assertFalse(is_inside_model_dirs(""))
        self.assertFalse(is_inside_model_dirs("C:/nonexistent_file_xyz.safetensors"))


class SecurityAndHfTests(unittest.TestCase):

    def test_blocked_download_folders(self):
        self.assertIsNone(get_download_directory("custom_nodes"))
        self.assertIsNone(get_download_directory("configs"))
        self.assertIsNone(get_download_directory("CUSTOM_NODES"))

    def test_download_model_rejects_path_traversal(self):
        res = download_model(
            url="https://example.com/test.safetensors",
            filename="malicious.safetensors",
            category="checkpoints",
            subfolder="../evil",
        )
        self.assertFalse(res["success"])
        self.assertIn("Invalid file name", res["error"])

        res_drive = download_model(
            url="https://example.com/test.safetensors",
            filename="malicious.safetensors",
            category="checkpoints",
            subfolder="C:/evil",
        )
        self.assertFalse(res_drive["success"])
        self.assertIn("Invalid file name", res_drive["error"])

    def test_parse_hf_url_supports_hf_co_and_unquote(self):
        ref = parse_huggingface_url(
            "https://hf.co/black-forest-labs/FLUX.1-dev/resolve/main/flux1-dev.safetensors"
        )
        self.assertIsNotNone(ref)
        self.assertEqual(ref.repo, "black-forest-labs/FLUX.1-dev")
        self.assertEqual(ref.filename, "flux1-dev.safetensors")
        self.assertEqual(ref.branch, "main")

        ref_quoted = parse_huggingface_url(
            "https://huggingface.co/user/repo%20name/resolve/main/my%20model.safetensors"
        )
        self.assertIsNotNone(ref_quoted)
        self.assertEqual(ref_quoted.repo, "user/repo name")
        self.assertEqual(ref_quoted.filename, "my model.safetensors")


if __name__ == "__main__":
    unittest.main()

"""Tests for the HuggingFace worker subprocess downloader and progress shims."""

import io
import json
import os
import shutil
import tempfile
import time
import unittest
from unittest import mock

from core.download._hf_worker import _ProgressTqdm, _http_error_message
from core.download.hf_worker_downloader import (
    _remove_staging,
    _staging_dir,
    download_huggingface_worker,
    is_hf_worker_supported,
)
from core.download.huggingface_xet import HuggingFaceXetProgressAdapter
from core.download.orchestrator import start_background_download


class TestProgressTqdm(unittest.TestCase):
    def test_progress_tqdm_accepts_postfix_setters(self):
        bar = _ProgressTqdm(total=1000)
        bar.update(100)
        bar.set_postfix_str("10MB/s", refresh=False)
        bar.set_postfix(speed=1)
        bar.set_description("Downloading")
        bar.refresh()
        bar.set_some_future_setter("arbitrary")
        bar.update(100)
        self.assertEqual(bar.n, 200)

    def test_progress_tqdm_raises_on_unknown_non_set_attribute(self):
        bar = _ProgressTqdm(total=1000)
        with self.assertRaises(AttributeError):
            _ = bar.nonexistent_method()

    def test_progress_tqdm_uses_whichever_signal_is_further_along(self):
        bar = _ProgressTqdm(total=1000)
        bar.update(100)  # reconstruction: 100
        bar.update_transfer(400)  # transfer: 400
        bar._report(force=True)
        self.assertEqual(bar.n, 400)

        bar.update(450)  # reconstruction: 550
        bar._report(force=True)
        self.assertEqual(bar.n, 550)

    def test_progress_tqdm_never_double_counts(self):
        bar = _ProgressTqdm(total=1000)
        bar.update(200)
        bar.update_transfer(200)
        bar._report(force=True)
        self.assertEqual(bar.n, 200)

    def test_http_error_message(self):
        self.assertIn("HuggingFace token required", _http_error_message(401, False))
        self.assertIn("rejected the token", _http_error_message(403, True))
        self.assertIn("Model not found", _http_error_message(404, False))
        self.assertIsNone(_http_error_message(500, False))


class TestHuggingFaceXetProgressAdapter(unittest.TestCase):
    def setUp(self):
        self.mock_deps = mock.MagicMock()
        self.mock_deps.cancelled_downloads = set()
        self.mock_deps.download_lock = mock.MagicMock()
        self.mock_deps.download_progress = {}
        self.adapter = HuggingFaceXetProgressAdapter(
            download_id="dl_1",
            total_size=1000,
            start_time=time.time(),
            dependencies=self.mock_deps,
        )

    def test_adapter_accepts_tqdm_setters(self):
        self.adapter.set_postfix_str("15MB/s")
        self.adapter.set_postfix(speed=15)
        self.adapter.set_description("Fetching")
        self.adapter.refresh()
        self.adapter.close()

    def test_adapter_getattr_setters(self):
        # Any set_* should resolve to a no-op callable
        fn = getattr(self.adapter, "set_custom_postfix")
        self.assertTrue(callable(fn))
        fn(123, test="ok")

    def test_adapter_raises_on_unknown_non_set_attribute(self):
        with self.assertRaises(AttributeError):
            _ = self.adapter.invalid_attribute_xyz


class TestHfWorkerDownloader(unittest.TestCase):
    def test_staging_dir(self):
        path = _staging_dir(r"C:\models\checkpoints", "abc12345")
        self.assertTrue(path.endswith(".model_resolver_tmp_abc12345"))

    def test_remove_staging_retries_and_cleans_up(self):
        tmp = tempfile.mkdtemp(prefix="mr_staging_test_")
        test_file = os.path.join(tmp, "temp.bin")
        with open(test_file, "wb") as f:
            f.write(b"data")
        _remove_staging(tmp)
        self.assertFalse(os.path.exists(tmp))

    def test_download_worker_non_hf_url_returns_none(self):
        with mock.patch("core.download.hf_worker_downloader.is_hf_worker_supported", return_value=True):
            result = download_huggingface_worker(
                url="https://civitai.com/api/download/models/123",
                dest_path="x.safetensors",
                download_id="d1",
                dependencies=mock.MagicMock(),
            )
            self.assertIsNone(result)

    def test_download_worker_unsupported_returns_none(self):
        with mock.patch("core.download.hf_worker_downloader.is_hf_worker_supported", return_value=False):
            result = download_huggingface_worker(
                url="https://huggingface.co/Comfy-Org/Flux/resolve/main/model.safetensors",
                dest_path="model.safetensors",
                download_id="d1",
                dependencies=mock.MagicMock(),
            )
            self.assertIsNone(result)


class TestPathTraversalRejection(unittest.TestCase):
    def test_start_background_download_raises_value_error_on_traversal(self):
        deps = mock.MagicMock()
        deps.generate_download_id.return_value = "d_test"
        deps.sanitize_download_filename.side_effect = lambda f: os.path.basename(f)

        for bad_subfolder in ("../evil", "..\\evil", "sub/../../evil", "C:evil"):
            with self.assertRaises(ValueError):
                start_background_download(
                    url="https://example.com/model.safetensors",
                    filename="model.safetensors",
                    category="checkpoints",
                    subfolder=bad_subfolder,
                    dependencies=deps,
                )


if __name__ == "__main__":
    unittest.main()

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

repo_root = str(Path(__file__).resolve().parents[1])
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from core.contracts import ResolvedModel
from core.download.hf_cache import cleanup_hf_incomplete_blobs, get_hf_cache_dir
from core.progress import JobProgressTracker
from core.scanner import cleanup_zero_byte_model_files, scan_directory
from core.sources.huggingface import (
    AMBIGUOUS_HF_MODEL_FILENAMES,
    search_huggingface_for_file,
)
from core.sources.popular import (
    _load_popular_models,
    get_popular_models_status,
    popular_models_mgr,
)


class TestHfDownloaderImprovements(unittest.TestCase):
    def test_popular_models_catalog(self):
        status = get_popular_models_status(check_remote=False)
        self.assertIn("local_count", status)
        self.assertGreaterEqual(status["local_count"], 0)
        self.assertIn("source_url", status)
        models = _load_popular_models()
        self.assertIsInstance(models, dict)

    def test_hf_cache_cleanup(self):
        cache_dir = get_hf_cache_dir()
        self.assertTrue(isinstance(cache_dir, str) and len(cache_dir) > 0)

        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_blobs = os.path.join(tmp_dir, "models--test--repo", "blobs")
            os.makedirs(repo_blobs, exist_ok=True)
            incomplete_blob = os.path.join(repo_blobs, "abc123.incomplete")
            with open(incomplete_blob, "wb") as f:
                f.write(b"partial data")

            valid_blob = os.path.join(repo_blobs, "abc123_done")
            with open(valid_blob, "wb") as f:
                f.write(b"full data")

            self.assertTrue(os.path.exists(incomplete_blob))
            cleaned = cleanup_hf_incomplete_blobs(tmp_dir)
            self.assertEqual(cleaned, 1)
            self.assertFalse(os.path.exists(incomplete_blob))
            self.assertTrue(os.path.exists(valid_blob))

    def test_scanner_skips_zero_byte_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            valid_file = os.path.join(tmp_dir, "good_model.safetensors")
            with open(valid_file, "wb") as f:
                f.write(b"model bytes")

            zero_file = os.path.join(tmp_dir, "corrupted_empty.safetensors")
            with open(zero_file, "wb") as f:
                pass  # 0 bytes

            results = scan_directory(tmp_dir, {".safetensors"}, "checkpoints")
            filenames = [r.filename for r in results]
            self.assertIn("good_model.safetensors", filenames)
            self.assertNotIn("corrupted_empty.safetensors", filenames)

    def test_ambiguous_hf_model_filenames(self):
        self.assertIn("model.safetensors", AMBIGUOUS_HF_MODEL_FILENAMES)
        self.assertIn("pytorch_model.bin", AMBIGUOUS_HF_MODEL_FILENAMES)
        self.assertIn("diffusion_pytorch_model.safetensors", AMBIGUOUS_HF_MODEL_FILENAMES)

        # Ambiguous file search without SHA-256 should immediately return None
        res = search_huggingface_for_file("model.safetensors", sha256=None)
        self.assertIsNone(res)

    def test_search_tracker_skip_model(self):
        tracker = JobProgressTracker()
        tracker.skip_model("job_1", "model_to_skip.safetensors")

        self.assertTrue(tracker.is_model_skipped("job_1", "model_to_skip.safetensors"))
        self.assertTrue(tracker.is_model_skipped("job_1", "MODEL_TO_SKIP.SAFETENSORS"))
        self.assertFalse(tracker.is_model_skipped("job_1", "other_model.safetensors"))
        self.assertFalse(tracker.is_model_skipped("job_2", "model_to_skip.safetensors"))


if __name__ == "__main__":
    unittest.main()

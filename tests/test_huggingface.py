import unittest
import re
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from core.sources.huggingface import (
    parse_huggingface_url,
    get_huggingface_download_url,
    _normalize_huggingface_size_probe_url,
    _write_persistent_author_index,
)
from core.matcher import build_filename_search_queries, clean_filename_for_search
from core.type_utils import extract_file_size

class HuggingFaceSourceTests(unittest.TestCase):

    def test_persistent_author_index_is_pretty_printed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            with patch(
                "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                str(index_path),
            ):
                _write_persistent_author_index(
                    "Example",
                    {
                        "author": "Example",
                        "updated_at": 1,
                        "repo_count": 0,
                        "file_count": 0,
                        "repos": [],
                        "files": [],
                    },
                )

            content = index_path.read_text(encoding="utf-8")
            self.assertIn('\n  "version":', content)
            self.assertIn('\n  "authors": {', content)
            self.assertTrue(content.endswith("\n"))
            self.assertEqual("Example", json.loads(content)["authors"]["Example"]["author"])

    def test_parse_huggingface_url_valid_http(self):
        url = "https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors"
        result = parse_huggingface_url(url)
        self.assertIsNotNone(result)
        self.assertEqual(result["repo"], "runwayml/stable-diffusion-v1-5")
        self.assertEqual(result["branch"], "main")
        self.assertEqual(result["filename"], "v1-5-pruned-emaonly.safetensors")

    def test_parse_huggingface_url_valid_hf_protocol(self):
        url = "hf://stabilityai/stable-diffusion-xl-base-1.0/sd_xl_base_1.0.safetensors"
        result = parse_huggingface_url(url)
        self.assertIsNotNone(result)
        self.assertEqual(result["repo"], "stabilityai/stable-diffusion-xl-base-1.0")
        self.assertEqual(result["filename"], "sd_xl_base_1.0.safetensors")

    def test_parse_huggingface_url_invalid(self):
        self.assertIsNone(parse_huggingface_url("https://example.com/not-hf"))
        self.assertIsNone(parse_huggingface_url("hf://not_enough_slashes"))

    def test_get_huggingface_download_url(self):
        repo = "runwayml/stable-diffusion-v1-5"
        filename = "v1-5-pruned-emaonly.safetensors"
        url = get_huggingface_download_url(repo, filename)
        self.assertEqual(
            url,
            "https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors"
        )

    def test_extract_file_size(self):
        # Directly nested key
        self.assertEqual(extract_file_size({"size": 100}), 100)
        self.assertEqual(extract_file_size({"sizeBytes": "200"}), 200)
        
        # LFS nested key
        self.assertEqual(extract_file_size({"lfs": {"size": 300}}), 300)
        
        # None cases
        self.assertIsNone(extract_file_size(None))
        self.assertIsNone(extract_file_size({}))

    def test_normalize_huggingface_size_probe_url(self):
        url = "https://huggingface.co/user/repo/blob/main/model.safetensors"
        normalized = _normalize_huggingface_size_probe_url(url)
        self.assertEqual(normalized, "https://huggingface.co/user/repo/resolve/main/model.safetensors")

    def test_clean_filename_for_search(self):
        self.assertEqual(clean_filename_for_search("model_fp16.safetensors"), "model")
        self.assertEqual(clean_filename_for_search("model_scaled_bf16.safetensors"), "model")
        self.assertEqual(clean_filename_for_search("my-awesome-model.safetensors"), "my-awesome-model")

        # Verify new format/precision suffixes are cleaned
        self.assertEqual(clean_filename_for_search("model_fp8.safetensors"), "model")
        self.assertEqual(clean_filename_for_search("model_q4.safetensors"), "model")
        self.assertEqual(clean_filename_for_search("model_mixed.safetensors"), "model")

    def test_build_huggingface_search_queries(self):
        queries = build_filename_search_queries("some_model_bf16.safetensors")
        self.assertIn("some_model", queries)
        self.assertIn("some_model_bf16", queries)

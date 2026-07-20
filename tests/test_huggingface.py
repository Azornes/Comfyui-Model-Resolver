import unittest
import re
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from core.sources.huggingface import (
    _fetch_author_index,
    _is_author_index_fresh,
    _read_persistent_author_indexes,
    build_huggingface_custom_result,
    parse_huggingface_url,
    get_huggingface_download_url,
    _normalize_huggingface_size_probe_url,
    _write_persistent_author_index,
)
from core.matcher import build_filename_search_queries
from core.type_utils import extract_file_size

class HuggingFaceSourceTests(unittest.TestCase):

    def test_fetch_author_index_builds_index_from_provider_repo_list(self):
        with patch(
            "core.sources.huggingface.execute_provider_json_request",
            return_value=[
                {
                    "id": "Comfy-Org/example",
                    "siblings": [
                        {
                            "rfilename": "text_encoders/model.safetensors",
                            "size": 123,
                        }
                    ],
                }
            ],
        ):
            index = _fetch_author_index("Comfy-Org", headers={})

        self.assertIsInstance(index, dict)
        self.assertEqual("Comfy-Org", index["author"])
        self.assertEqual(1, index["repo_count"])
        self.assertEqual(1, index["file_count"])
        self.assertEqual(
            "text_encoders/model.safetensors",
            index["files"][0]["path"],
        )

    def test_malformed_list_author_index_is_not_treated_as_fresh(self):
        self.assertFalse(_is_author_index_fresh([{"id": "Comfy-Org/example"}]))

    def test_persistent_cache_discards_raw_provider_list_entries(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "authors": {
                            "Comfy-Org": [{"id": "Comfy-Org/example"}],
                            "Valid": {
                                "author": "Valid",
                                "updated_at": 1,
                                "repo_count": 0,
                                "file_count": 0,
                                "repos": [],
                                "files": [],
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            with patch(
                "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                str(index_path),
            ):
                data = _read_persistent_author_indexes()

        self.assertNotIn("Comfy-Org", data["authors"])
        self.assertIn("Valid", data["authors"])

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

    def test_custom_result_uses_sha256_from_exact_huggingface_file(self):
        sha256 = "a" * 64
        url = (
            "https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/"
            "blob/main/qwen3-vl-4b-heretic_int8.safetensors"
        )
        with patch(
            "core.sources.huggingface._get_repo_tree",
            return_value=[
                {
                    "path": "qwen3-vl-4b-heretic_int8.safetensors",
                    "size": 123,
                    "lfs": {"oid": f"sha256:{sha256}", "size": 123},
                }
            ],
        ):
            result = build_huggingface_custom_result(url)

        self.assertIsNotNone(result)
        self.assertEqual(sha256, result["sha256"])
        self.assertEqual({"SHA256": sha256}, result["hashes"])
        self.assertEqual(123, result["size"])
        self.assertEqual("huggingface", result["source"])
        self.assertTrue(result["custom_url"])

    def test_custom_result_leaves_hash_empty_when_huggingface_does_not_provide_it(self):
        url = "https://huggingface.co/user/repo/blob/main/model.safetensors"
        with patch("core.sources.huggingface._get_repo_tree", return_value=None):
            with patch(
                "core.sources.huggingface.fetch_remote_file_size_cached",
                return_value=456,
            ):
                result = build_huggingface_custom_result(url)

        self.assertIsNotNone(result)
        self.assertEqual("", result["sha256"])
        self.assertEqual({}, result["hashes"])
        self.assertEqual(456, result["size"])

    def test_build_huggingface_search_queries(self):
        queries = build_filename_search_queries("some_model_bf16.safetensors")
        self.assertIn("some_model", queries)
        self.assertIn("some_model_bf16", queries)

import json
import re
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from core.matcher import build_filename_search_queries
from core.sources.huggingface import (
    HF_AUTHOR_FALLBACKS,
    _build_author_index_from_models,
    _fetch_author_index,
    _fetch_remote_file_size_bytes,
    _find_matching_file_in_author_index,
    _get_author_index,
    _is_author_index_fresh,
    _normalize_huggingface_size_probe_url,
    _read_persistent_author_indexes,
    _write_persistent_author_index,
    build_huggingface_custom_result,
    clear_search_cache,
    get_huggingface_download_url,
    get_huggingface_file_sha256,
    get_huggingface_model_details,
    get_known_author_fallback_indexes_status,
    parse_huggingface_url,
    search_huggingface_for_file,
)
from core.type_utils import extract_file_size


class HuggingFaceSourceTests(unittest.TestCase):

    def test_known_author_fallbacks_include_comfy_org_and_kijai(self):
        self.assertEqual(["Comfy-Org", "Kijai"], HF_AUTHOR_FALLBACKS)

    def test_known_author_status_reports_each_author_file_count(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "authors": {
                            "Comfy-Org": {
                                "author": "Comfy-Org",
                                "updated_at": 1,
                                "repo_count": 2,
                                "file_count": 3,
                                "repos": [],
                                "files": [],
                            },
                            "Kijai": {
                                "author": "Kijai",
                                "updated_at": 2,
                                "repo_count": 4,
                                "file_count": 5,
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
                status = get_known_author_fallback_indexes_status()

        self.assertEqual(
            {"Comfy-Org": 3, "Kijai": 5},
            {item["author"]: item["file_count"] for item in status["authors"]},
        )
        self.assertEqual(8, status["file_count"])
        self.assertTrue(status["fully_cached"])

    def test_fetch_author_index_builds_index_from_provider_repo_list(self):
        sha256 = "a" * 64
        with (
            patch(
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
            ),
            patch(
                "core.sources.huggingface._get_repo_tree",
                return_value=[
                    {
                        "path": "text_encoders/model.safetensors",
                        "size": 123,
                        "lfs": {"oid": f"sha256:{sha256}", "size": 123},
                    }
                ],
            ),
        ):
            index = _fetch_author_index("Comfy-Org", headers={})

        self.assertIsInstance(index, dict)
        self.assertEqual("Comfy-Org", index["author"])
        self.assertEqual(1, index["repo_count"])
        self.assertEqual(1, index["file_count"])
        self.assertEqual(1, index["hash_count"])
        self.assertEqual(
            "text_encoders/model.safetensors",
            index["files"][0]["path"],
        )
        self.assertEqual(sha256, index["files"][0]["sha256"])

    def test_author_index_matches_sha256_directly(self):
        sha256 = "b" * 64
        index = _build_author_index_from_models(
            "Comfy-Org",
            [
                {
                    "id": "Comfy-Org/example",
                    "siblings": [
                        {
                            "rfilename": "models/example.safetensors",
                            "size": 456,
                            "lfs": {"oid": f"sha256:{sha256}", "size": 456},
                        }
                    ],
                }
            ],
        )

        result = _find_matching_file_in_author_index(
            index,
            "different-name.safetensors",
            sha256=sha256,
        )

        self.assertIsNotNone(result)
        self.assertEqual("hash", result["match_type"])
        self.assertEqual(sha256, result["sha256"])
        self.assertEqual("models/example.safetensors", result["path"])

    def test_hash_search_uses_author_index_before_filename_search(self):
        sha256 = "c" * 64
        index = _build_author_index_from_models(
            "Comfy-Org",
            [
                {
                    "id": "Comfy-Org/example",
                    "siblings": [
                        {
                            "rfilename": "models/example.safetensors",
                            "size": 789,
                            "lfs": {"oid": f"sha256:{sha256}", "size": 789},
                        }
                    ],
                }
            ],
        )

        clear_search_cache()
        with (
            patch(
                "core.sources.huggingface._get_author_index",
                return_value=index,
            ) as get_index,
            patch(
                "core.sources.huggingface.execute_provider_json_request"
            ) as request,
        ):
            result = search_huggingface_for_file(
                "different-name.safetensors",
                sha256=sha256,
            )

        self.assertIsNotNone(result)
        self.assertEqual("hash", result["match_type"])
        self.assertEqual(sha256, result["sha256"])
        get_index.assert_called_once()
        request.assert_not_called()

    def test_malformed_list_author_index_is_not_treated_as_fresh(self):
        self.assertFalse(_is_author_index_fresh([{"id": "Comfy-Org/example"}]))

    def test_persistent_cache_discards_raw_provider_list_entries(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "version": 2,
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

    def test_non_persistent_author_index_refresh_does_not_persist(self):
        fresh_index = {
            "author": "Example",
            "updated_at": 123,
            "repo_count": 1,
            "file_count": 1,
            "hash_count": 1,
            "repos": ["Example/repo"],
            "files": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index",
                    return_value=fresh_index,
                ) as fetch_index,
            ):
                clear_search_cache()
                result = _get_author_index(
                    "Example",
                    headers={},
                    force_refresh=True,
                    persist=False,
                )

            self.assertIs(fresh_index, result)
            self.assertFalse(index_path.exists())
            fetch_index.assert_called_once_with("Example", headers={})

    def test_force_search_uses_fresh_author_indexes_without_refreshing(self):
        now = time.time()
        indexes = {
            author: {
                "author": author,
                "updated_at": now,
                "repo_count": 1,
                "file_count": 1,
                "hash_count": 1,
                "repos": [f"{author}/example"],
                "files": [
                    {
                        "repo_id": f"{author}/example",
                        "path": "other.safetensors",
                        "filename": "other.safetensors",
                        "size": 123,
                        "sha256": "1" * 64,
                    }
                ],
            }
            for author in HF_AUTHOR_FALLBACKS
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps({"version": 2, "authors": indexes}),
                encoding="utf-8",
            )
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index"
                ) as fetch_index,
            ):
                clear_search_cache()
                result = search_huggingface_for_file(
                    "missing.safetensors",
                    sha256="2" * 64,
                    force_refresh=True,
                    use_api_search=False,
                    use_brave_fallback=False,
                )

        self.assertIsNone(result)
        fetch_index.assert_not_called()

    def test_force_search_can_initialize_missing_author_index(self):
        sha256 = "e" * 64
        index = {
            "author": "Comfy-Org",
            "updated_at": 123,
            "repo_count": 1,
            "file_count": 1,
            "hash_count": 1,
            "repos": ["Comfy-Org/example"],
            "files": [
                {
                    "repo_id": "Comfy-Org/example",
                    "path": "model.safetensors",
                    "filename": "model.safetensors",
                    "size": 123,
                    "sha256": sha256,
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index",
                    return_value=index,
                ) as fetch_index,
            ):
                clear_search_cache()
                result = search_huggingface_for_file(
                    "model.safetensors",
                    sha256=sha256,
                    force_refresh=True,
                    use_api_search=False,
                    use_brave_fallback=False,
                )
                index_was_persisted = index_path.exists()

        self.assertIsNotNone(result)
        self.assertTrue(index_was_persisted)
        fetch_index.assert_called_once_with("Comfy-Org", headers={})

    def test_force_search_refreshes_stale_author_index_after_cache_miss(self):
        sha256 = "f" * 64
        stale_index = {
            "author": "Comfy-Org",
            "updated_at": 0,
            "repo_count": 1,
            "file_count": 1,
            "hash_count": 0,
            "repos": ["Comfy-Org/example"],
            "files": [],
        }
        refreshed_index = {
            **stale_index,
            "updated_at": time.time(),
            "hash_count": 1,
            "files": [
                {
                    "repo_id": "Comfy-Org/example",
                    "path": "model.safetensors",
                    "filename": "model.safetensors",
                    "size": 123,
                    "sha256": sha256,
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "authors": {
                            "Comfy-Org": stale_index,
                            "Kijai": {**stale_index, "author": "Kijai"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index",
                    return_value=refreshed_index,
                ) as fetch_index,
            ):
                clear_search_cache()
                result = search_huggingface_for_file(
                    "renamed-model.safetensors",
                    sha256=sha256,
                    force_refresh=True,
                    use_api_search=False,
                    use_brave_fallback=False,
                )

        self.assertIsNotNone(result)
        self.assertEqual("hash", result["match_type"])
        fetch_index.assert_called_once_with("Comfy-Org", headers={})

    def test_force_search_uses_stale_author_index_when_hash_matches(self):
        sha256 = "7" * 64
        stale_index = {
            "author": "Comfy-Org",
            "updated_at": 0,
            "repo_count": 1,
            "file_count": 1,
            "hash_count": 1,
            "repos": ["Comfy-Org/example"],
            "files": [
                {
                    "repo_id": "Comfy-Org/example",
                    "path": "model.safetensors",
                    "filename": "model.safetensors",
                    "size": 123,
                    "sha256": sha256,
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            index_path.write_text(
                json.dumps({"version": 2, "authors": {"Comfy-Org": stale_index}}),
                encoding="utf-8",
            )
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index"
                ) as fetch_index,
            ):
                clear_search_cache()
                result = search_huggingface_for_file(
                    "renamed-model.safetensors",
                    sha256=sha256,
                    force_refresh=True,
                    use_api_search=False,
                    use_brave_fallback=False,
                )

        self.assertIsNotNone(result)
        self.assertEqual("hash", result["match_type"])
        fetch_index.assert_not_called()

    def test_explicit_author_index_refresh_still_persists(self):
        fresh_index = {
            "author": "Example",
            "updated_at": 123,
            "repo_count": 1,
            "file_count": 1,
            "hash_count": 1,
            "repos": ["Example/repo"],
            "files": [],
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            index_path = Path(tmpdir) / "huggingface-author-index.json"
            with (
                patch(
                    "core.sources.huggingface.HF_AUTHOR_INDEX_CACHE_PATH",
                    str(index_path),
                ),
                patch(
                    "core.sources.huggingface._fetch_author_index",
                    return_value=fresh_index,
                ),
            ):
                clear_search_cache()
                result = _get_author_index(
                    "Example",
                    headers={},
                    force_refresh=True,
                )

            self.assertIs(fresh_index, result)
            self.assertTrue(index_path.exists())

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

    def test_get_huggingface_file_sha256_matches_repo_path(self):
        sha256 = "a" * 64
        repo_tree = [
            {
                "path": "vae/minimax_h3_audio_vae_fp32.safetensors",
                "lfs": {"oid": f"sha256:{sha256}"},
            }
        ]
        with patch(
            "core.sources.huggingface._get_repo_tree",
            return_value=repo_tree,
        ) as get_repo_tree:
            result = get_huggingface_file_sha256(
                "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/"
                "vae/minimax_h3_audio_vae_fp32.safetensors",
                headers={"Authorization": "Bearer test"},
            )

        self.assertEqual(sha256, result)
        get_repo_tree.assert_called_once_with(
            "Comfy-Org/MiniMax-H3",
            headers={"Authorization": "Bearer test"},
            branch="main",
        )

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
        self.assertEqual(extract_file_size({"sizeKB": 2}), 2048)
        self.assertEqual(extract_file_size({"sizeKB": 0}), 0)
        
        # LFS nested key
        self.assertEqual(extract_file_size({"lfs": {"size": 300}}), 300)
        
        # None cases
        self.assertIsNone(extract_file_size(None))
        self.assertIsNone(extract_file_size({}))

    def test_normalize_huggingface_size_probe_url(self):
        url = "https://huggingface.co/user/repo/blob/main/model.safetensors"
        normalized = _normalize_huggingface_size_probe_url(url)
        self.assertEqual(normalized, "https://huggingface.co/user/repo/resolve/main/model.safetensors")

    @patch(
        "core.sources.huggingface.fetch_remote_file_size_cached",
        return_value=789,
    )
    def test_remote_size_probe_preserves_headers_and_timeout(self, mock_fetch):
        url = "https://huggingface.co/user/repo/blob/main/model.safetensors"
        headers = {"Authorization": "Bearer test"}

        size = _fetch_remote_file_size_bytes(url, headers=headers, timeout=7)

        self.assertEqual(size, 789)
        mock_fetch.assert_called_once_with(
            "https://huggingface.co/user/repo/resolve/main/model.safetensors",
            headers=headers,
            timeout=7,
        )

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

    def test_model_details_lists_only_variants_from_matched_folder(self):
        sha256 = "b" * 64
        tree = [
            {
                "path": "diffusion_models/model_fp8_scaled.safetensors",
                "size": 100,
                "lfs": {"oid": f"sha256:{sha256}", "size": 100},
            },
            {
                "path": "diffusion_models/model_int8_convrot.safetensors",
                "size": 80,
            },
            {
                "path": "text_encoders/encoder_fp8.safetensors",
                "size": 50,
            },
            {"path": "diffusion_models/README.md", "size": 10},
        ]
        with patch("core.sources.huggingface._get_repo_tree", return_value=tree):
            with patch(
                "core.sources.huggingface.execute_provider_json_request",
                return_value={
                    "modelId": "Comfy-Org/example",
                    "author": "Comfy-Org",
                    "downloads": 123,
                    "likes": 4,
                    "tags": ["comfyui"],
                },
            ):
                details = get_huggingface_model_details(
                    "Comfy-Org/example",
                    "diffusion_models/model_fp8_scaled.safetensors",
                )

        self.assertIsNotNone(details)
        self.assertEqual("huggingface", details["source"])
        self.assertEqual("diffusion_models", details["folder"])
        files = details["selected_version"]["files"]
        self.assertEqual(
            [
                "model_fp8_scaled.safetensors",
                "model_int8_convrot.safetensors",
            ],
            [file_info["name"] for file_info in files],
        )
        self.assertTrue(files[0]["primary"])
        self.assertEqual("FP8 scaled", files[0]["metadata"]["fp"])
        self.assertEqual(sha256, files[0]["sha256"])
        self.assertEqual("INT8 convrot", files[1]["metadata"]["fp"])

    def test_model_details_passes_huggingface_token_to_tree_and_metadata(self):
        tree = [{"path": "model.safetensors", "size": 100}]
        with patch(
            "core.sources.huggingface._get_repo_tree",
            return_value=tree,
        ) as mock_tree:
            with patch(
                "core.sources.huggingface.execute_provider_json_request",
                return_value={},
            ) as mock_request:
                details = get_huggingface_model_details(
                    "private/repo",
                    "model.safetensors",
                    token="hf_secret",
                )

        self.assertIsNotNone(details)
        expected_headers = {"Authorization": "Bearer hf_secret"}
        mock_tree.assert_called_once_with(
            "private/repo",
            headers=expected_headers,
            branch="main",
        )
        self.assertEqual(expected_headers, mock_request.call_args.kwargs["headers"])

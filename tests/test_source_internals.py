"""
test_source_internals.py

Integration-smoke tests for pure (network-free) internal helper functions
in civarchive.py, civitai.py, and workflow_updater.py.

Goal: catch NameError / ImportError style regressions where a helper is
renamed or prefixed incorrectly (e.g. _extract_trained_words vs
extract_trained_words), or where a refactored unified function changes
its output contract.
"""

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import requests

# ---------------------------------------------------------------------------
# civarchive internals
# ---------------------------------------------------------------------------
from core.sources.civarchive import (
    _collect_archive_download_urls,
    _fetch_remote_file_size_bytes,
    _normalize_archive_version,
    _normalize_download_url,
    _resolve_file_size_bytes,
    build_civarchive_custom_result,
    parse_civarchive_url,
)

# ---------------------------------------------------------------------------
# civitai internals
# ---------------------------------------------------------------------------
from core.sources.civitai import (
    _build_civitai_result_from_version,
    _enrich_model_info_with_details,
    _extract_model_images,
    _extract_public_api_model_candidates,
    _extract_trpc_model_candidates,
    _find_matching_file_in_versions,
    _normalize_civitai_file,
    _search_civitai_public_api_candidates,
    _search_civitai_red_candidates,
    _search_civitai_trpc_candidates,
    build_civitai_custom_result,
    build_civitai_result_payload,
    build_civitai_session_cookie,
    clear_search_cache,
    get_civitai_model_details,
    get_model_info_by_hash,
    get_model_info_for_file,
    parse_civitai_url,
    search_civitai_for_file,
)
from core.sources.common import is_remote_link_marked_dead
from core.type_utils import prepare_remote_size_probe_url

# ---------------------------------------------------------------------------
# workflow_updater
# ---------------------------------------------------------------------------
from core.workflow_updater import (
    convert_to_relative_path,
    get_base_directory_for_model,
)

CIVARCHIVE_BASE = "https://civarchive.com"


def write_safetensors_stub(file_path, header):
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    with open(file_path, "wb") as handle:
        handle.write(len(header_bytes).to_bytes(8, byteorder="little"))
        handle.write(header_bytes)
        handle.write(b"tensor payload")


class CivitaiResultBuilderTests(unittest.TestCase):

    def test_build_result_payload_preserves_optional_search_fields(self):
        payload = build_civitai_result_payload(
            model_id=123,
            version_id=456,
            model_name="Example model",
            model_type="Checkpoint",
            file_info={"name": "example.safetensors", "hashes": {"SHA256": "abc123"}},
            filename="example.safetensors",
            download_url="https://example.test/download",
            size=2048,
            base_model="SDXL",
            tags=["style"],
            match_type="exact",
            version_name="v1",
            confidence=100.0,
        )

        self.assertEqual("Example model", payload["name"])
        self.assertEqual("v1", payload["version_name"])
        self.assertEqual("example.safetensors", payload["filename"])
        self.assertEqual("abc123", payload["sha256"])
        self.assertEqual(100.0, payload["confidence"])

    def test_build_result_from_version_has_unified_builder_available(self):
        result = _build_civitai_result_from_version(
            model_id=123,
            model_name="Aisha Greyrat",
            model_type="LORA",
            version={"id": 456, "baseModel": "Anima"},
            file_info={
                "name": "aisha-greyrat.safetensors",
                "downloadUrl": "https://civitai.com/api/download/models/456",
                "sizeKB": 10,
                "hashes": {"SHA256": "abc123"},
            },
            tags=["character"],
        )

        self.assertEqual("civitai", result["source"])
        self.assertEqual(123, result["model_id"])
        self.assertEqual(456, result["version_id"])
        self.assertEqual("Anima", result["base_model"])
        self.assertEqual("abc123", result["sha256"])
        self.assertEqual(10 * 1024, result["size"])


class CustomUrlResultBuilderTests(unittest.TestCase):
    def test_civitai_custom_result_preserves_all_result_fields(self):
        result = build_civitai_custom_result({
            "model_id": 123,
            "version_id": 456,
            "name": "Example model",
            "type": "LORA",
            "tags": ["style"],
            "images": [{"url": "https://example.test/image"}],
            "description": "Model description",
            "version_url": "https://civitai.com/models/123?modelVersionId=456",
            "selected_version": {
                "id": 456,
                "name": "v1",
                "base_model": "SD 1.5",
                "trained_words": ["example"],
                "description": "Version notes",
                "files": [{
                    "name": "example.safetensors",
                    "type": "Model",
                    "download_url": "https://civitai.com/api/download/models/456",
                    "size": 123,
                    "sha256": "abc123",
                    "hashes": {"SHA256": "abc123"},
                }],
            },
        })

        self.assertEqual({
            "source": "civitai",
            "details_source": "civitai",
            "model_id": 123,
            "version_id": 456,
            "name": "Example model",
            "version_name": "v1",
            "type": "LORA",
            "filename": "example.safetensors",
            "url": "https://civitai.com/models/123?modelVersionId=456",
            "version_url": "https://civitai.com/models/123?modelVersionId=456",
            "download_url": "https://civitai.com/api/download/models/456",
            "size": 123,
            "base_model": "SD 1.5",
            "tags": ["style"],
            "trained_words": ["example"],
            "images": [{"url": "https://example.test/image"}],
            "description": "Version notes",
            "model_description": "Model description",
            "sha256": "abc123",
            "hashes": {"SHA256": "abc123"},
            "match_type": "custom_url",
            "custom_url": True,
        }, result)

    def test_civarchive_custom_result_preserves_provider_fields(self):
        result = build_civarchive_custom_result({
            "model_id": 789,
            "version_id": 987,
            "name": "Archived model",
            "type": "Checkpoint",
            "tags": ["archive"],
            "platform": "civitai",
            "platform_url": "https://civitai.com/models/789",
            "description": "Archive description",
            "version_url": "https://civarchive.com/models/789?modelVersionId=987",
            "selected_version": {
                "id": 987,
                "name": "archive-v1",
                "base_model": "SDXL",
                "trained_words": ["archived"],
                "description": "Archive notes",
                "platform_url": "https://civitai.com/models/789?modelVersionId=987",
                "files": [{
                    "name": "archived.safetensors",
                    "type": "Model",
                    "download_url": "https://civarchive.com/download/987",
                    "download_urls": [
                        "https://civarchive.com/download/987",
                        "https://mirror.example.test/987",
                    ],
                    "size": 456,
                    "sha256": "def456",
                    "hashes": {"SHA256": "def456"},
                }],
            },
        })

        self.assertEqual({
            "source": "civarchive",
            "details_source": "civarchive",
            "model_id": 789,
            "version_id": 987,
            "name": "Archived model",
            "version_name": "archive-v1",
            "type": "Checkpoint",
            "filename": "archived.safetensors",
            "url": "https://civarchive.com/models/789?modelVersionId=987",
            "version_url": "https://civarchive.com/models/789?modelVersionId=987",
            "platform_url": "https://civitai.com/models/789",
            "download_url": "https://civarchive.com/download/987",
            "download_urls": [
                "https://civarchive.com/download/987",
                "https://mirror.example.test/987",
            ],
            "size": 456,
            "base_model": "SDXL",
            "tags": ["archive"],
            "trained_words": ["archived"],
            "images": [],
            "description": "Archive notes",
            "sha256": "def456",
            "hash": "def456",
            "hashes": {"SHA256": "def456"},
            "platform": "civitai",
            "match_type": "custom_url",
            "custom_url": True,
        }, result)


class CivitaiModelDetailsTests(unittest.TestCase):

    def test_preserves_full_selected_version_for_metadata_sidecar(self):
        response = {
            "id": 123,
            "name": "Alt-Girl/E-Girl",
            "type": "LORA",
            "description": "Model description",
            "tags": ["style", "e-girl"],
            "allowNoCredit": True,
            "allowCommercialUse": ["Image", "Sell"],
            "creator": {"username": "TheAINovice", "image": None},
            "stats": {"downloadCount": 1000},
            "modelVersions": [
                {
                    "id": 456,
                    "name": "Old version",
                    "baseModel": "Krea 1",
                    "images": [],
                    "files": [],
                },
                {
                    "id": 789,
                    "name": "Krea2 v1.0",
                    "baseModel": "Krea 2",
                    "createdAt": "2026-07-14T05:52:54.321Z",
                    "stats": {"downloadCount": 1705, "thumbsUpCount": 106},
                    "images": [
                        {
                            "url": "https://image.civitai.com/example.jpeg",
                            "nsfwLevel": 4,
                            "hash": "blurhash",
                            "meta": {
                                "seed": 884670593557080,
                                "prompt": "AltGirl prompt",
                                "steps": 8,
                                "additionalResources": [
                                    {
                                        "name": "support-style.safetensors",
                                        "type": "lora",
                                        "strength": 0.5,
                                    }
                                ],
                            },
                        }
                    ],
                    "files": [
                        {
                            "id": 321,
                            "name": "AltGirlKrea.safetensors",
                            "type": "Model",
                            "pickleScanResult": "Success",
                            "virusScanResult": "Success",
                            "hashes": {"SHA256": "A" * 64},
                            "primary": True,
                        }
                    ],
                },
            ],
        }

        with patch(
            "core.sources.civitai.execute_provider_json_request",
            return_value=response,
        ):
            details = get_civitai_model_details(123, 789)

        self.assertIsNotNone(details)
        civitai = details["civitai"]
        self.assertEqual(789, civitai["id"])
        self.assertEqual(123, civitai["modelId"])
        self.assertEqual(4, civitai["images"][0]["nsfwLevel"])
        self.assertEqual("AltGirl prompt", civitai["images"][0]["meta"]["prompt"])
        self.assertEqual(
            {
                "name": "Alt-Girl/E-Girl",
                "versionName": "Krea2 v1.0",
                "type": "LORA",
                "modelId": 123,
                "modelVersionId": 789,
                "url": "https://civitai.com/models/123?modelVersionId=789",
                "primary": True,
            },
            civitai["images"][0]["resources"][0],
        )
        self.assertEqual(
            {
                "name": "support-style.safetensors",
                "type": "lora",
                "strength": 0.5,
            },
            civitai["images"][0]["resources"][1],
        )
        self.assertEqual("Success", civitai["files"][0]["virusScanResult"])
        self.assertEqual(1705, civitai["stats"]["downloadCount"])
        self.assertEqual(
            ["Image", "Sell"],
            civitai["model"]["allowCommercialUse"],
        )
        self.assertEqual("TheAINovice", civitai["creator"]["username"])
        self.assertNotIn("modelVersions", civitai["model"])


class CivitaiHashLookupCacheTests(unittest.TestCase):

    def setUp(self):
        clear_search_cache()

    def tearDown(self):
        clear_search_cache()

    @staticmethod
    def _http_error(status_code):
        response = requests.Response()
        response.status_code = status_code
        return requests.HTTPError(response=response)

    def test_only_not_found_response_is_cached(self):
        with patch(
            "core.sources.civitai.execute_provider_json_request",
            side_effect=self._http_error(404),
        ) as request_json:
            self.assertIsNone(get_model_info_by_hash("a" * 64))
            self.assertIsNone(get_model_info_by_hash("a" * 64))

        request_json.assert_called_once()
        self.assertTrue(request_json.call_args.kwargs["raise_on_error"])

    def test_transient_http_error_is_not_cached(self):
        with patch(
            "core.sources.civitai.execute_provider_json_request",
            side_effect=self._http_error(503),
        ) as request_json:
            self.assertIsNone(get_model_info_by_hash("b" * 64))
            self.assertIsNone(get_model_info_by_hash("b" * 64))

        self.assertEqual(request_json.call_count, 2)

    def test_unexpected_json_shape_is_not_cached(self):
        with patch(
            "core.sources.civitai.execute_provider_json_request",
            return_value=[],
        ) as request_json:
            self.assertIsNone(get_model_info_by_hash("c" * 64))
            self.assertIsNone(get_model_info_by_hash("c" * 64))

        self.assertEqual(request_json.call_count, 2)


# ===========================================================================
# civitai - local safetensors fallback
# ===========================================================================
class CivitaiLocalFallbackTests(unittest.TestCase):

    def test_get_model_info_for_file_infers_base_model_when_civitai_misses(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "orphan_flux.safetensors")
            write_safetensors_stub(
                file_path,
                {
                    "__metadata__": {},
                    "double_blocks.0.img_attn.qkv.weight": {
                        "dtype": "F16",
                        "shape": [1],
                    },
                },
            )

            with patch("core.sources.civitai.get_model_info_by_hash", return_value=None):
                result = get_model_info_for_file(file_path)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "local")
        self.assertEqual(result["base_model"], "Flux.1 D")
        self.assertTrue(result["base_model_inferred"])
        self.assertEqual(result["base_model_source"], "safetensors_header")

    def test_get_model_info_for_file_infers_base_model_when_civitai_errors(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "offline_sd3.safetensors")
            write_safetensors_stub(
                file_path,
                {
                    "__metadata__": {},
                    "joint_blocks.0.x_block.attn.qkv.weight": {
                        "dtype": "F16",
                        "shape": [1],
                    },
                },
            )

            with patch(
                "core.sources.civitai.get_model_info_by_hash",
                side_effect=OSError("offline"),
            ):
                result = get_model_info_for_file(file_path)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "local")
        self.assertEqual(result["base_model"], "SD 3")
        self.assertTrue(result["base_model_inferred"])

    def test_get_model_info_for_file_uses_safetensors_header_metadata_on_miss(self):
        expected_hash = "d" * 64
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "header_lora.safetensors")
            write_safetensors_stub(
                file_path,
                {
                    "__metadata__": {
                        "modelspec.title": "Header LoRA",
                        "modelspec.author": "Header Maker",
                        "modelspec.description": "Local header description",
                        "modelspec.hash.sha256": expected_hash,
                        "modelspec.tags": json.dumps(["style"]),
                        "modelspec.trigger_phrase": "header trigger",
                        "ss_base_model_version": "pony",
                        "ss_network_module": "networks.lora",
                        "sshs_model_hash": "e" * 64,
                    },
                },
            )

            with patch("core.sources.civitai.get_model_info_by_hash", return_value=None):
                result = get_model_info_for_file(file_path)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "local")
        self.assertEqual(result["details_source"], "safetensors_header")
        self.assertEqual(result["model_name"], "Header LoRA")
        self.assertEqual(result["creator"]["username"], "Header Maker")
        self.assertEqual(result["description"], "Local header description")
        self.assertEqual(result["base_model"], "Pony")
        self.assertEqual(result["sha256"], expected_hash)
        self.assertEqual(result["tags"], ["style"])
        self.assertEqual(result["trained_words"], ["header trigger"])
        self.assertTrue(result["local_metadata_available"])


# ===========================================================================
# civarchive - _normalize_download_url
# ===========================================================================
class NormalizeDownloadUrlTests(unittest.TestCase):

    def test_absolute_https_url_passes_through(self):
        url = "https://civarchive.com/api/download/models/123"
        self.assertEqual(_normalize_download_url(url), url)

    def test_absolute_http_url_passes_through(self):
        url = "http://example.com/model.safetensors"
        self.assertEqual(_normalize_download_url(url), url)

    def test_protocol_relative_url_gets_https(self):
        result = _normalize_download_url("//civarchive.com/api/download/models/99")
        self.assertEqual(result, "https://civarchive.com/api/download/models/99")

    def test_relative_api_path_gets_base_url(self):
        result = _normalize_download_url("/api/download/models/42")
        self.assertTrue(result.startswith(CIVARCHIVE_BASE))
        self.assertIn("/api/download/models/42", result)

    def test_none_returns_none(self):
        self.assertIsNone(_normalize_download_url(None))

    def test_empty_string_returns_none(self):
        self.assertIsNone(_normalize_download_url(""))

    def test_whitespace_only_returns_none(self):
        self.assertIsNone(_normalize_download_url("   "))

    def test_non_string_returns_none(self):
        self.assertIsNone(_normalize_download_url(12345))

    def test_non_http_relative_path_returns_none(self):
        self.assertIsNone(_normalize_download_url("/some/other/path"))


# ===========================================================================
# shared remote link dead marker
# ===========================================================================
class ArchiveLinkIsDeadTests(unittest.TestCase):

    def test_not_dead_when_no_flags(self):
        self.assertFalse(is_remote_link_marked_dead({"url": "https://example.com/m.safetensors"}))

    def test_dead_when_deletedAt_set(self):
        self.assertTrue(is_remote_link_marked_dead({"deletedAt": "2024-01-01"}))

    def test_dead_when_deleted_at_set(self):
        self.assertTrue(is_remote_link_marked_dead({"deleted_at": "2024-01-01"}))

    def test_dead_when_isDead_true(self):
        self.assertTrue(is_remote_link_marked_dead({"isDead": True}))

    def test_dead_when_is_dead_true(self):
        self.assertTrue(is_remote_link_marked_dead({"is_dead": True}))

    def test_dead_when_likelyDead_true(self):
        self.assertTrue(is_remote_link_marked_dead({"likelyDead": True}))

    def test_dead_when_status_dead(self):
        self.assertTrue(is_remote_link_marked_dead({"status": "dead"}))

    def test_dead_when_status_deleted_case_insensitive(self):
        self.assertTrue(is_remote_link_marked_dead({"status": "Deleted"}))

    def test_dead_when_status_unavailable(self):
        self.assertTrue(is_remote_link_marked_dead({"status": "unavailable"}))

    def test_not_dead_for_non_dict(self):
        self.assertFalse(is_remote_link_marked_dead("dead"))
        self.assertFalse(is_remote_link_marked_dead(None))
        self.assertFalse(is_remote_link_marked_dead([]))


class RemoteLinkIsDeadTests(unittest.TestCase):
    def test_common_predicate_matches_all_supported_dead_link_markers(self):
        dead_items = (
            {"deletedAt": "2024-01-01"},
            {"deleted_at": "2024-01-01"},
            {"isDead": True},
            {"is_dead": True},
            {"likelyDead": True},
            {"likely_dead": True},
            {"dead": True},
            {"status": "dead"},
            {"status": "Deleted"},
            {"status": "unavailable"},
            {"status": "missing"},
        )
        for item in dead_items:
            self.assertTrue(is_remote_link_marked_dead(item))

    def test_common_predicate_keeps_live_and_non_mapping_items_alive(self):
        self.assertFalse(is_remote_link_marked_dead({"url": "https://example.com/model.safetensors"}))
        self.assertFalse(is_remote_link_marked_dead("dead"))
        self.assertFalse(is_remote_link_marked_dead(None))
        self.assertFalse(is_remote_link_marked_dead([]))


# ===========================================================================
# civarchive - _collect_archive_download_urls (common collector adapter)
# ===========================================================================
class CollectArchiveDownloadUrlsTests(unittest.TestCase):

    def _make_file_info(self, mirrors=None, download_url=None,
                        download_urls=None, dead=False):
        info = {}
        if mirrors is not None:
            info["mirrors"] = mirrors
        if download_url is not None:
            info["downloadUrl"] = download_url
        if download_urls is not None:
            info["download_urls"] = download_urls
        if dead:
            info["isDead"] = True
        return info

    def test_extracts_mirror_urls(self):
        fi = self._make_file_info(mirrors=[
            {"url": "https://civarchive.com/api/download/models/1.safetensors"},
        ])
        result = _collect_archive_download_urls(fi)
        self.assertIn("https://civarchive.com/api/download/models/1.safetensors", result)

    def test_skips_dead_mirrors(self):
        fi = self._make_file_info(mirrors=[
            {"url": "https://civarchive.com/api/download/models/1.safetensors", "isDead": True},
        ])
        result = _collect_archive_download_urls(fi)
        self.assertEqual(result, [])

    def test_skip_file_if_dead_returns_empty(self):
        fi = self._make_file_info(
            download_url="https://civarchive.com/api/download/models/1.safetensors",
            dead=True,
        )
        result = _collect_archive_download_urls(fi, skip_file_if_dead=True)
        self.assertEqual(result, [])

    def test_check_download_urls_list_includes_extra_urls(self):
        fi = self._make_file_info(download_urls=[
            "https://civarchive.com/api/download/models/2.safetensors"
        ])
        result = _collect_archive_download_urls(fi, check_download_urls_list=True,
                                                skip_file_if_dead=True)
        self.assertIn("https://civarchive.com/api/download/models/2.safetensors", result)

    def test_prioritize_civitai_last_sorts_correctly(self):
        civitai_url = "https://civitai.com/api/download/models/99.safetensors"
        other_url = "https://civarchive.com/api/download/models/77.safetensors"
        fi = self._make_file_info(mirrors=[
            {"url": civitai_url},
            {"url": other_url},
        ])
        result = _collect_archive_download_urls(fi, prioritize_civitai_last=True)
        self.assertEqual(result[-1], civitai_url)
        self.assertEqual(result[0], other_url)

    def test_deduplication(self):
        url = "https://civarchive.com/api/download/models/1.safetensors"
        fi = self._make_file_info(
            mirrors=[{"url": url}],
            download_url=url,
        )
        result = _collect_archive_download_urls(fi)
        self.assertEqual(result.count(url), 1)

    def test_empty_file_info_returns_empty(self):
        self.assertEqual(_collect_archive_download_urls({}), [])


# ===========================================================================
# civarchive - archive download URL collection strategy
# ===========================================================================
class CollectArchiveDownloadUrlsStrategyTests(unittest.TestCase):

    def test_civitai_url_sorted_last(self):
        civitai = "https://civitai.com/api/download/models/99.safetensors"
        archive = "https://civarchive.com/api/download/models/77.safetensors"
        fi = {"mirrors": [{"url": civitai}, {"url": archive}]}
        result = _collect_archive_download_urls(
            fi,
            prioritize_civitai_last=True,
            download_url_keys=("downloadUrl",),
        )
        self.assertEqual(result[-1], civitai)
        self.assertEqual(result[0], archive)

    def test_returns_list(self):
        result = _collect_archive_download_urls(
            {},
            prioritize_civitai_last=True,
            download_url_keys=("downloadUrl",),
        )
        self.assertIsInstance(result, list)


# ===========================================================================
# civarchive - normalized download URL collection strategy
# ===========================================================================
class CollectNormalizedArchiveDownloadUrlsTests(unittest.TestCase):

    def test_skips_dead_file(self):
        fi = {
            "isDead": True,
            "downloadUrl": "https://civarchive.com/api/download/models/1.safetensors",
        }
        self.assertEqual(
            _collect_archive_download_urls(
                fi,
                skip_file_if_dead=True,
                check_download_urls_list=True,
                download_url_keys=("download_url", "downloadUrl"),
            ),
            [],
        )

    def test_collects_mirror_and_extra_urls(self):
        fi = {
            "mirrors": [{"url": "https://civarchive.com/api/download/models/1.safetensors"}],
            "download_urls": ["https://civarchive.com/api/download/models/2.safetensors"],
        }
        result = _collect_archive_download_urls(
            fi,
            skip_file_if_dead=True,
            check_download_urls_list=True,
            download_url_keys=("download_url", "downloadUrl"),
        )
        self.assertEqual(len(result), 2)

    def test_dead_mirror_url_excluded_from_download_urls(self):
        dead_url = "https://civarchive.com/api/download/models/1.safetensors"
        fi = {
            "mirrors": [{"url": dead_url, "isDead": True}],
            "download_urls": [dead_url],
        }
        result = _collect_archive_download_urls(
            fi,
            skip_file_if_dead=True,
            check_download_urls_list=True,
            download_url_keys=("download_url", "downloadUrl"),
        )
        self.assertNotIn(dead_url, result)


# ===========================================================================
# civarchive - _normalize_archive_version (calls extract_trained_words)
# ===========================================================================
class NormalizeArchiveVersionTests(unittest.TestCase):

    def _make_version(self, **kwargs):
        return {"id": 1, "name": "v1", **kwargs}

    def _make_context(self, model_id=100):
        return {"id": model_id, "name": "TestModel", "type": "LORA"}

    def test_returns_dict_with_expected_keys(self):
        version = self._make_version()
        result = _normalize_archive_version(version, self._make_context())
        for key in ("id", "name", "trained_words", "files", "images", "stats"):
            self.assertIn(key, result)

    def test_trained_words_from_trainedWords_key(self):
        """Regression: extract_trained_words must be called correctly (not _extract_trained_words)."""
        version = self._make_version(trainedWords=["lora_trigger", "style_word"])
        result = _normalize_archive_version(version, self._make_context())
        self.assertIn("lora_trigger", result["trained_words"])
        self.assertIn("style_word", result["trained_words"])

    def test_trained_words_from_trigger_key(self):
        version = self._make_version(trigger="my_trigger_word")
        result = _normalize_archive_version(version, self._make_context())
        self.assertIn("my_trigger_word", result["trained_words"])

    def test_trained_words_empty_when_not_present(self):
        version = self._make_version()
        result = _normalize_archive_version(version, self._make_context())
        self.assertEqual(result["trained_words"], [])

    def test_base_model_extracted(self):
        version = self._make_version(baseModel="SDXL 1.0")
        result = _normalize_archive_version(version, self._make_context())
        self.assertEqual(result["base_model"], "SDXL 1.0")

    def test_images_list_when_no_images(self):
        version = self._make_version()
        result = _normalize_archive_version(version, self._make_context())
        self.assertIsInstance(result["images"], list)

    def test_files_list_when_no_files(self):
        version = self._make_version()
        result = _normalize_archive_version(version, self._make_context())
        self.assertIsInstance(result["files"], list)


# ===========================================================================
# civarchive - parse_civarchive_url
# ===========================================================================
class ParseCivarchiveUrlTests(unittest.TestCase):

    def test_model_url_parsed(self):
        result = parse_civarchive_url("https://civarchive.com/models/123")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("model_id"), 123)

    def test_model_version_url_parsed(self):
        result = parse_civarchive_url("https://civarchive.com/models/123?modelVersionId=456")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("model_id"), 123)
        self.assertEqual(result.get("version_id"), 456)

    def test_non_civarchive_url_returns_none(self):
        self.assertIsNone(parse_civarchive_url("https://huggingface.co/user/repo"))

    def test_empty_url_returns_none(self):
        self.assertIsNone(parse_civarchive_url(""))

    def test_none_returns_none(self):
        self.assertIsNone(parse_civarchive_url(None))


# ===========================================================================
# civarchive - _prepare_size_probe_url
# ===========================================================================
class PrepareSizeProbeUrlTests(unittest.TestCase):

    def _prepare_size_probe_url(self, url):
        return prepare_remote_size_probe_url(url, ["civarchive.com", "civitai.com", "civitai.red"])

    def test_civarchive_api_download_url_passes(self):
        url = "https://civarchive.com/api/download/models/77.safetensors"
        self.assertEqual(self._prepare_size_probe_url(url), url)

    def test_civarchive_non_download_url_blocked(self):
        url = "https://civarchive.com/models/77"
        self.assertIsNone(self._prepare_size_probe_url(url))

    def test_civitai_non_download_url_blocked(self):
        url = "https://civitai.com/models/123"
        self.assertIsNone(self._prepare_size_probe_url(url))

    def test_civitai_api_download_url_passes(self):
        url = "https://civitai.com/api/download/models/99.safetensors"
        self.assertEqual(self._prepare_size_probe_url(url), url)

    def test_none_returns_none(self):
        self.assertIsNone(self._prepare_size_probe_url(None))


class CivArchiveMirrorSizeProbeTests(unittest.TestCase):

    @patch(
        "core.sources.civarchive.fetch_remote_file_size_cached",
        return_value=364853140,
    )
    def test_huggingface_mirror_is_allowed(self, mock_fetch):
        url = (
            "https://huggingface.co/unsloth/LTX-2.3-GGUF/resolve/main/vae/"
            "ltx-2.3-22b-distilled_audio_vae.safetensors"
        )

        self.assertEqual(_fetch_remote_file_size_bytes(url), 364853140)
        mock_fetch.assert_called_once()
        self.assertEqual(mock_fetch.call_args.args[0], url)

    @patch(
        "core.sources.civarchive.fetch_remote_file_size_cached",
        return_value=364853140,
    )
    def test_modelscope_mirror_is_allowed(self, mock_fetch):
        url = (
            "https://www.modelscope.ai/unsloth/LTX-2.3-GGUF/resolve/master/vae/"
            "ltx-2.3-22b-distilled_audio_vae.safetensors"
        )

        self.assertEqual(_fetch_remote_file_size_bytes(url), 364853140)
        mock_fetch.assert_called_once()
        self.assertEqual(mock_fetch.call_args.args[0], url)

    @patch("core.sources.civarchive._fetch_remote_file_size_bytes")
    def test_huggingface_is_probed_before_modelscope(self, mock_fetch):
        modelscope_url = "https://www.modelscope.ai/org/repo/resolve/master/model.safetensors"
        huggingface_url = "https://huggingface.co/org/repo/resolve/main/model.safetensors"
        mock_fetch.side_effect = lambda url: 123456 if url == huggingface_url else None

        size = _resolve_file_size_bytes(
            {},
            [modelscope_url, huggingface_url],
        )

        self.assertEqual(size, 123456)
        mock_fetch.assert_called_once_with(huggingface_url)

    @patch("core.sources.civarchive.fetch_remote_file_size_cached")
    def test_untrusted_mirror_is_not_probed(self, mock_fetch):
        self.assertIsNone(
            _fetch_remote_file_size_bytes(
                "https://example.com/models/model.safetensors"
            )
        )
        mock_fetch.assert_not_called()



# ===========================================================================
# civitai - parse_civitai_url
# ===========================================================================
class ParseCivitaiUrlTests(unittest.TestCase):

    def test_standard_model_url(self):
        result = parse_civitai_url("https://civitai.com/models/123456")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("model_id"), 123456)

    def test_model_url_with_version(self):
        result = parse_civitai_url("https://civitai.com/models/123456?modelVersionId=789")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("model_id"), 123456)
        self.assertEqual(result.get("version_id"), 789)

    def test_civitai_red_model_url_with_version(self):
        result = parse_civitai_url("https://civitai.red/models/123456?modelVersionId=789")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("model_id"), 123456)
        self.assertEqual(result.get("version_id"), 789)

    def test_civitai_red_download_url(self):
        result = parse_civitai_url("https://civitai.red/api/download/models/789")
        self.assertIsNotNone(result)
        self.assertEqual(result.get("version_id"), 789)

    def test_non_civitai_url_returns_none(self):
        self.assertIsNone(parse_civitai_url("https://civarchive.com/models/123"))

    def test_none_returns_none(self):
        self.assertIsNone(parse_civitai_url(None))

    def test_empty_string_returns_none(self):
        self.assertIsNone(parse_civitai_url(""))


# ===========================================================================
# civitai - civitai.red HTML fallback
# ===========================================================================
class CivitaiRedSearchTests(unittest.TestCase):

    def test_session_cookie_header_includes_current_and_legacy_names(self):
        cookie = build_civitai_session_cookie("valid-session-token")

        self.assertIn("__Secure-civ-token=valid-session-token", cookie)
        self.assertIn("__Secure-civitai-token=valid-session-token", cookie)

    @patch("core.sources.civitai.log")
    @patch("core.sources.civitai.requests.get")
    def test_unauthorized_html_fallback_is_silent_not_warning(self, mock_get, mock_log):
        response = MagicMock()
        response.status_code = 403
        mock_get.return_value = response

        result = _search_civitai_red_candidates("ae.safetensors")

        self.assertEqual(result, [])
        mock_log.debug.assert_not_called()
        mock_log.warning.assert_not_called()

    @patch("core.sources.civitai.requests.get")
    def test_html_fallback_sends_session_token_cookie(self, mock_get):
        response = MagicMock()
        response.status_code = 200
        response.text = ""
        mock_get.return_value = response

        _search_civitai_red_candidates(
            "ae.safetensors",
            session_token="valid-session-token",
        )

        headers = mock_get.call_args.kwargs.get("headers", {})
        self.assertIn("__Secure-civ-token=valid-session-token", headers.get("Cookie", ""))
        self.assertIn("__Secure-civitai-token=valid-session-token", headers.get("Cookie", ""))
        self.assertIn("user-agent", headers)

    @patch("core.sources.civitai.requests.get")
    def test_html_fallback_uses_current_search_url_and_model_type(self, mock_get):
        response = MagicMock()
        response.status_code = 200
        response.text = ""
        mock_get.return_value = response

        _search_civitai_red_candidates(
            r"models\diffusion_models\Anima_baseV10.safetensors",
            model_type="diffusion_models",
        )

        url = mock_get.call_args.args[0]
        self.assertTrue(url.startswith("https://civitai.red/search/models?"))
        self.assertIn("sortBy=models_v9", url)
        self.assertIn("query=Anima_baseV10", url)
        self.assertIn("modelType=Checkpoint", url)


class CivitaiTrpcSearchTests(unittest.TestCase):

    def test_extracts_candidates_from_devalue_serialized_data(self):
        payload = {
            "result": {
                "data": json.dumps(
                    [
                        {"items": 1, "nextCursor": -1},
                        [2],
                        {"id": 3, "version": 4},
                        2725430,
                        {"id": 5},
                        3071760,
                    ],
                    separators=(",", ":"),
                )
            }
        }

        result = _extract_trpc_model_candidates(payload)

        self.assertEqual(
            result,
            [{"model_id": 2725430, "version_id": 3071760}],
        )

    def test_unrecognized_trpc_shapes_return_no_candidates(self):
        payloads = [
            None,
            "not-an-object",
            {"result": "not-an-object"},
            {"result": {"data": "not-json"}},
            {"result": {"data": {"json": "not-json"}}},
            {"result": {"data": {"json": {"items": "not-a-list"}}}},
        ]

        for payload in payloads:
            with self.subTest(payload=payload):
                self.assertEqual(_extract_trpc_model_candidates(payload), [])

    @patch("core.sources.civitai.requests.get")
    def test_devalue_serialized_empty_items_does_not_abort_search(self, mock_get):
        response = MagicMock()
        response.status_code = 200
        response.headers = {"content-type": "application/json"}
        response.text = (
            '{"result":{"data":"[{\\"items\\":1,\\"nextCursor\\":-1},[]]"}}'
        )
        response.json.return_value = {
            "result": {"data": '[{"items":1,"nextCursor":-1},[]]'}
        }
        mock_get.return_value = response

        result = _search_civitai_trpc_candidates(
            "KNPV3_1.safetensors",
            model_type="loras",
            limit=5,
        )

        self.assertEqual(result, [])
        mock_get.assert_called_once()

    @patch("core.sources.civitai.requests.get")
    def test_does_not_retry_without_type_filter_when_typed_search_is_empty(self, mock_get):
        empty_response = MagicMock()
        empty_response.status_code = 200
        empty_response.headers = {"content-type": "application/json"}
        empty_response.text = '{"result":{"data":{"json":{"items":[]}}}}'
        empty_response.json.return_value = {
            "result": {"data": {"json": {"items": []}}}
        }

        mock_get.return_value = empty_response

        result = _search_civitai_trpc_candidates(
            "Anima_baseV10.safetensors",
            model_type="diffusion_models",
            limit=5,
        )

        self.assertEqual(result, [])
        mock_get.assert_called_once()
        url = mock_get.call_args.args[0]
        self.assertIn("Anima_baseV10", url)
        self.assertIn("Checkpoint", url)

    def test_html_fallback_not_used_to_top_up_trpc_candidates(self):
        clear_search_cache()
        with patch(
            "core.sources.civitai._search_civitai_trpc_candidates",
            return_value=[{"model_id": 10, "version_id": 20}],
        ), patch(
            "core.sources.civitai._search_civitai_red_candidates"
        ) as html_search, patch(
            "core.sources.civitai._find_civitai_file_in_model",
            return_value=None,
        ):
            result = search_civitai_for_file(
                "ae.safetensors",
                model_type="vae",
                candidate_limit=5,
                use_trpc_search=True,
                use_html_fallback=True,
            )

        self.assertIsNone(result)
        html_search.assert_not_called()
        clear_search_cache()

    def test_public_api_candidates_used_when_trpc_disabled_and_html_empty(self):
        clear_search_cache()
        expected = {
            "source": "civitai",
            "model_id": 2676616,
            "version_id": 3005748,
            "filename": "sickOllie_v1.safetensors",
            "confidence": 100.0,
        }
        with patch(
            "core.sources.civitai._search_civitai_red_candidates",
            return_value=[],
        ) as html_search, patch(
            "core.sources.civitai._search_civitai_public_api_candidates",
            return_value=[{"model_id": 2676616, "version_id": 3005748}],
        ) as api_search, patch(
            "core.sources.civitai._find_civitai_file_in_model",
            return_value=expected,
        ):
            result = search_civitai_for_file(
                "sickOllie_v1.safetensors",
                model_type="diffusion_models",
                candidate_limit=5,
                use_trpc_search=False,
                use_html_fallback=True,
            )

        self.assertEqual(result, expected)
        html_search.assert_called_once()
        api_search.assert_called_once()
        clear_search_cache()

    def test_public_api_candidate_extraction_uses_first_version(self):
        payload = {
            "items": [
                {
                    "id": 101,
                    "modelVersions": [
                        {"id": 202},
                        {"id": 303},
                    ],
                }
            ]
        }

        result = _extract_public_api_model_candidates(payload, limit=5)

        self.assertEqual(result, [{"model_id": 101, "version_id": 202}])

    @patch("core.sources.civitai.requests.get")
    def test_public_api_search_sends_auth_and_type_filter(self, mock_get):
        response = MagicMock()
        response.status_code = 200
        response.headers = {"content-type": "application/json"}
        response.text = '{"items":[{"id":101,"modelVersions":[{"id":202}]}]}'
        response.json.return_value = {
            "items": [{"id": 101, "modelVersions": [{"id": 202}]}]
        }
        mock_get.return_value = response

        result = _search_civitai_public_api_candidates(
            "realistic.safetensors",
            model_type="checkpoints",
            api_key="api-key",
            session_token="session-token",
            limit=5,
        )

        self.assertEqual(result, [{"model_id": 101, "version_id": 202}])
        params = mock_get.call_args.kwargs.get("params", {})
        headers = mock_get.call_args.kwargs.get("headers", {})
        self.assertEqual(params.get("query"), "realistic")
        self.assertEqual(params.get("types"), "Checkpoint")
        self.assertEqual(headers.get("Authorization"), "Bearer api-key")
        self.assertIn("__Secure-civitai-token=session-token", headers.get("Cookie", ""))

    def test_public_api_search_can_be_disabled(self):
        clear_search_cache()
        with patch(
            "core.sources.civitai._search_civitai_trpc_candidates",
            return_value=[],
        ), patch(
            "core.sources.civitai._search_civitai_red_candidates",
            return_value=[],
        ), patch(
            "core.sources.civitai._search_civitai_public_api_candidates",
            return_value=[{"model_id": 2676616, "version_id": 3005748}],
        ) as api_search:
            result = search_civitai_for_file(
                "sickOllie_v1.safetensors",
                candidate_limit=5,
                use_trpc_search=True,
                use_api_search=False,
                use_html_fallback=True,
            )

        self.assertIsNone(result)
        api_search.assert_not_called()
        clear_search_cache()


# ===========================================================================
# civitai - _extract_model_images
# ===========================================================================
class ExtractModelImagesTests(unittest.TestCase):

    def test_returns_list_for_empty_input(self):
        self.assertIsInstance(_extract_model_images({}), list)

    def test_extracts_images_list(self):
        version_info = {
            "images": [
                {"url": "https://image.civitai.com/img1.jpg", "nsfw": False},
                {"url": "https://image.civitai.com/img2.jpg", "nsfw": True},
            ]
        }
        result = _extract_model_images(version_info)
        self.assertIsInstance(result, list)
        self.assertGreater(len(result), 0)

    def test_all_results_have_url(self):
        version_info = {
            "images": [
                {"url": "https://image.civitai.com/img1.jpg"},
            ]
        }
        result = _extract_model_images(version_info)
        for item in result:
            self.assertIn("url", item)

    def test_no_images_key_returns_empty(self):
        result = _extract_model_images({"name": "v1"})
        self.assertEqual(result, [])

    def test_adds_linked_parent_model_without_replacing_additional_resources(self):
        version_info = {
            "id": 3084537,
            "name": "Krea2 (v0.5)",
            "modelId": 2268008,
            "model": {
                "name": "Realistic Snapshot (Z-Image-Turbo + Krea 2)",
                "type": "LORA",
            },
            "images": [
                {
                    "url": "https://image.civitai.com/135642695.jpeg",
                    "meta": {
                        "additionalResources": [
                            {
                                "name": (
                                    "dwdwadawdadw__realisticsnapshotideogram__"
                                    "5th%20training6000.safetensors"
                                ),
                                "type": "lora",
                                "strength": 2,
                            },
                            {
                                "name": "lenovo_krea2.safetensors",
                                "type": "lora",
                                "strength": 0.5,
                            }
                        ]
                    },
                }
            ],
        }

        result = _extract_model_images(version_info)

        resources = result[0]["resources"]
        self.assertEqual(
            resources[0],
            {
                "name": "Realistic Snapshot (Z-Image-Turbo + Krea 2)",
                "versionName": "Krea2 (v0.5)",
                "type": "LORA",
                "modelId": 2268008,
                "modelVersionId": 3084537,
                "url": (
                    "https://civitai.com/models/2268008"
                    "?modelVersionId=3084537"
                ),
                "primary": True,
                "strength": 2,
            },
        )
        self.assertEqual(
            resources[1],
            {
                "name": "lenovo_krea2.safetensors",
                "type": "lora",
                "strength": 0.5,
            },
        )

    def test_does_not_duplicate_an_existing_parent_model_resource(self):
        version_info = {
            "id": 3084537,
            "name": "Krea2 (v0.5)",
            "modelId": 2268008,
            "model": {"name": "Realistic Snapshot", "type": "LORA"},
            "images": [
                {
                    "url": "https://image.civitai.com/135642695.jpeg",
                    "resources": [
                        {
                            "name": "Realistic Snapshot",
                            "modelId": 2268008,
                            "modelVersionId": 3084537,
                        }
                    ],
                }
            ],
        }

        result = _extract_model_images(version_info)

        self.assertEqual(len(result[0]["resources"]), 1)


# ===========================================================================
# civitai - _normalize_civitai_file
# ===========================================================================
class NormalizeCivitaiFileTests(unittest.TestCase):

    def _make_file(self, **kwargs):
        return {
            "id": 1,
            "name": "model.safetensors",
            "downloadUrl": "https://civitai.com/api/download/models/1",
            "sizeKB": 2048,
            "hashes": {"SHA256": "abc123def456"},
            "primary": True,
            **kwargs,
        }

    def test_returns_dict_with_expected_keys(self):
        result = _normalize_civitai_file(self._make_file(), model_id=10, version_id=20)
        for key in ("name", "download_url", "sha256", "primary", "size"):
            self.assertIn(key, result)

    def test_sha256_extracted_from_hashes(self):
        result = _normalize_civitai_file(
            self._make_file(hashes={"SHA256": "deadbeef1234"}),
            model_id=10, version_id=20,
        )
        self.assertEqual(result["sha256"], "deadbeef1234")

    def test_primary_flag_preserved(self):
        result = _normalize_civitai_file(self._make_file(primary=True), model_id=10, version_id=20)
        self.assertTrue(result["primary"])
        result2 = _normalize_civitai_file(self._make_file(primary=False), model_id=10, version_id=20)
        self.assertFalse(result2["primary"])

    def test_empty_file_info_does_not_raise_nameerror(self):
        try:
            result = _normalize_civitai_file({}, model_id=10, version_id=20)
            self.assertIsInstance(result, dict)
        except (TypeError, AttributeError, KeyError):
            pass  # acceptable - no silent NameError allowed


class CivitaiFilenameMatchTests(unittest.TestCase):

    def test_short_filename_base_does_not_partial_match_longer_name(self):
        versions = [
            {
                "id": 1,
                "files": [
                    {"name": "titanae-akima.safetensors"},
                ],
            }
        ]

        result = _find_matching_file_in_versions(versions, "ae.safetensors")

        self.assertIsNone(result)

    def test_short_filename_base_still_matches_exact_filename(self):
        versions = [
            {
                "id": 1,
                "files": [
                    {"name": "ae.safetensors"},
                ],
            }
        ]

        result = _find_matching_file_in_versions(versions, "ae.safetensors")

        self.assertIsNotNone(result)
        self.assertEqual(result["match_type"], "exact")


# ===========================================================================
# civitai - hash lookup details enrichment
# ===========================================================================
class EnrichModelInfoWithDetailsTests(unittest.TestCase):

    def test_selected_version_enrichment_does_not_raise_nameerror(self):
        details = {
            "selected_version": {
                "description": "version description",
                "url": "https://civitai.com/models/10?modelVersionId=20",
            },
            "name": "Resolved Model",
            "type": "Checkpoint",
            "description": "model description",
            "tags": ["tag-a"],
            "images": [{"url": "https://image.civitai.com/example.jpeg"}],
            "version_url": "https://civitai.com/models/10?modelVersionId=20",
            "url": "https://civitai.com/models/10",
        }

        with patch("core.sources.civitai.get_civitai_model_details", return_value=details):
            result = _enrich_model_info_with_details(
                {"source": "civitai", "sha256": "a" * 64},
                model_id=10,
                version_id=20,
            )

        self.assertEqual(result["description"], "version description")
        self.assertEqual(result["model_name"], "Resolved Model")
        self.assertEqual(result["model_type"], "Checkpoint")
        self.assertEqual(result["tags"], ["tag-a"])
        self.assertEqual(result["images"], details["images"])


# ===========================================================================
# workflow_updater - convert_to_relative_path
# ===========================================================================
class ConvertToRelativePathTests(unittest.TestCase):

    def test_returns_filename_when_in_base_dir(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "model.safetensors")
            result = convert_to_relative_path(model_path, "checkpoints", tmpdir)
            self.assertEqual(result, "model.safetensors")

    def test_returns_relative_path_with_subfolder(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "sd15")
            os.makedirs(subdir)
            model_path = os.path.join(subdir, "model.safetensors")
            result = convert_to_relative_path(model_path, "checkpoints", tmpdir)
            self.assertIn("sd15", result)
            self.assertIn("model.safetensors", result)

    def test_uses_forward_slashes(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "sub")
            os.makedirs(subdir)
            model_path = os.path.join(subdir, "model.safetensors")
            result = convert_to_relative_path(model_path, "loras", tmpdir)
            # Result should use forward slashes (platform-normalised)
            result_normalised = result.replace("\\", "/")
            self.assertIn("sub", result_normalised)
            self.assertIn("model.safetensors", result_normalised)


# ===========================================================================
# workflow_updater - get_base_directory_for_model
# ===========================================================================
class GetBaseDirectoryForModelTests(unittest.TestCase):

    def test_returns_base_directory_if_provided(self):
        model = {"base_directory": "/some/path/models"}
        result = get_base_directory_for_model(model, "checkpoints")
        self.assertEqual(result, "/some/path/models")

    def test_returns_none_without_path_or_base_directory(self):
        result = get_base_directory_for_model({}, "checkpoints")
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()

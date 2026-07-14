import unittest
from unittest.mock import patch, MagicMock
from core.type_utils import (
    looks_like_model_file,
    normalize_model_image,
    fetch_remote_file_size,
    get_version_sort_key,
    check_credential_http,
    extract_response_file_size,
    normalize_sha256,
    unique_ordered_strings,
    extract_sha256_from_metadata,
    extract_trained_words,
    fetch_remote_file_size_cached,
    clear_remote_size_cache,
    normalize_category_to_model_type,
    check_credential_preconditions,
)
from core.path_utils import (
    calculate_file_sha256,
    extract_safetensors_header_sha256,
    extract_safetensors_header_metadata,
    find_metadata_sidecar_path,
    infer_safetensors_base_model,
    read_json_safe,
    write_json_atomic,
)

class UnifiedHelpersTests(unittest.TestCase):

    def test_looks_like_model_file_huggingface(self):
        # Valid HuggingFace URLs
        self.assertTrue(looks_like_model_file("https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors"))
        self.assertTrue(looks_like_model_file("https://huggingface.co/lllyasviel/ControlNet-v1-1/blob/main/control_v11p_sd15_canny.pth"))
        self.assertTrue(looks_like_model_file("hf://user/repo/model.safetensors"))
        
        # Invalid / Spaces HuggingFace URLs
        self.assertFalse(looks_like_model_file("https://huggingface.co/spaces/stabilityai/stable-diffusion"))
        self.assertFalse(looks_like_model_file("https://huggingface.co/runwayml/stable-diffusion-v1-5"))

    def test_looks_like_model_file_civitai_and_civarchive(self):
        # Valid download URLs
        self.assertTrue(looks_like_model_file("https://civitai.com/api/download/models/12345"))
        self.assertTrue(looks_like_model_file("https://civitai.red/api/download/models/999"))
        self.assertTrue(looks_like_model_file("https://civarchive.com/api/download/models/777"))

    def test_looks_like_model_file_extensions(self):
        # Known model extensions
        self.assertTrue(looks_like_model_file("https://example.com/files/my_model.safetensors"))
        self.assertTrue(looks_like_model_file("https://example.com/files/my_model.ckpt"))
        self.assertTrue(looks_like_model_file("https://example.com/files/my_model.gguf"))
        
        # Unknown/invalid extensions
        self.assertFalse(looks_like_model_file("https://example.com/files/my_model.txt"))
        self.assertFalse(looks_like_model_file("https://example.com/files/image.png"))
        self.assertFalse(looks_like_model_file("not_a_url_string"))

    def test_looks_like_model_file_expected_filename(self):
        # Matching expected filename
        self.assertTrue(looks_like_model_file("https://example.com/files/special_name.bin", "special_name.bin"))
        self.assertTrue(looks_like_model_file("https://example.com/files/special_name", "special_name"))

    def test_normalize_model_image_civitai_format(self):
        raw_image = {
            "url": "https://image.civitai.com/x/width=1200/12345.jpeg",
            "id": 12345,
            "meta": {
                "prompt": "masterpiece, best quality, 1girl",
                "negativePrompt": "low quality, worst quality",
                "cfgScale": 7.5,
                "seed": 424242,
                "steps": 25,
                "sampler": "Euler a",
            }
        }
        normalized = normalize_model_image(raw_image)
        self.assertEqual(normalized["url"], "https://image.civitai.com/x/width=1200/12345.jpeg")
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/images/12345")
        self.assertEqual(normalized["positive"], "masterpiece, best quality, 1girl")
        self.assertEqual(normalized["negative"], "low quality, worst quality")
        self.assertEqual(normalized["cfg"], 7.5)
        self.assertEqual(normalized["seed"], 424242)
        self.assertEqual(normalized["steps"], 25)
        self.assertEqual(normalized["sampler"], "Euler a")

    def test_normalize_model_image_civarchive_format(self):
        raw_image = {
            "imageUrl": "https://civarchive.com/img/9999.png",
            "postUrl": "https://civitai.com/posts/8888",
            "seed": 9999,
            "steps": 30,
            "cfg": 8.0,
            "sampler": "DPM++ 2M Karras",
            "positive": "cool car",
            "negative": "blurry",
        }
        normalized = normalize_model_image(raw_image)
        self.assertEqual(normalized["url"], "https://civarchive.com/img/9999.png")
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/posts/8888")
        self.assertEqual(normalized["positive"], "cool car")
        self.assertEqual(normalized["negative"], "blurry")
        self.assertEqual(normalized["seed"], 9999)
        self.assertEqual(normalized["steps"], 30)
        self.assertEqual(normalized["cfg"], 8.0)
        self.assertEqual(normalized["sampler"], "DPM++ 2M Karras")

    def test_normalize_model_image_regex_fallback(self):
        raw_image = {
            "url": "https://image.civitai.com/images/width=1200/987654.jpeg",
        }
        normalized = normalize_model_image(raw_image)
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/images/987654")

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_head_success(self, mock_get, mock_head):
        from requests.structures import CaseInsensitiveDict
        # Setup mock response for HEAD
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = CaseInsensitiveDict({"Content-Length": "104857600"})
        mock_head.return_value = mock_response
        
        size = fetch_remote_file_size("https://example.com/model.safetensors")
        self.assertEqual(size, 104857600)
        mock_head.assert_called_once()
        mock_get.assert_not_called()

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_get_fallback(self, mock_get, mock_head):
        from requests.structures import CaseInsensitiveDict
        # HEAD fails
        mock_head_response = MagicMock()
        mock_head_response.status_code = 405  # Method Not Allowed
        mock_head.return_value = mock_head_response
        
        # GET succeeds with Range
        mock_get_response = MagicMock()
        mock_get_response.status_code = 206  # Partial Content
        mock_get_response.headers = CaseInsensitiveDict({
            "Content-Range": "bytes 0-0/209715200",
            "Content-Length": "1"
        })
        mock_get.return_value = mock_get_response
        
        size = fetch_remote_file_size("https://example.com/model.safetensors")
        self.assertEqual(size, 209715200)
        mock_head.assert_called_once()
        mock_get.assert_called_once()

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_exception_handling(self, mock_get, mock_head):
        mock_head.side_effect = Exception("Connection error")
        mock_get.side_effect = Exception("Connection error")
        
        size = fetch_remote_file_size("https://example.com/model.safetensors")
        self.assertIsNone(size)

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_get_200_ok_fallback(self, mock_get, mock_head):
        from requests.structures import CaseInsensitiveDict
        # HEAD fails
        mock_head_response = MagicMock()
        mock_head_response.status_code = 405
        mock_head.return_value = mock_head_response
        
        # GET succeeds with 200 OK (full file)
        mock_get_response = MagicMock()
        mock_get_response.status_code = 200
        mock_get_response.headers = CaseInsensitiveDict({
            "Content-Length": "524288000"
        })
        mock_get.return_value = mock_get_response
        
        size = fetch_remote_file_size("https://example.com/model.safetensors")
        self.assertEqual(size, 524288000)
        mock_head.assert_called_once()
        mock_get.assert_called_once()

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_redirect_handling(self, mock_get, mock_head):
        from requests.structures import CaseInsensitiveDict
        # HEAD returns a 302 Redirect
        mock_head_response = MagicMock()
        mock_head_response.status_code = 302
        mock_head_response.headers = CaseInsensitiveDict({
            "Location": "https://redirected.com/real_model.safetensors"
        })
        
        # Redirects are followed manually so every destination can be validated.
        mock_head_response_redirected = MagicMock()
        mock_head_response_redirected.status_code = 200
        mock_head_response_redirected.headers = CaseInsensitiveDict({
            "Content-Length": "1000"
        })
        mock_head.side_effect = [mock_head_response, mock_head_response_redirected]

        with patch(
            "core.network_utils.validate_public_http_url",
            side_effect=lambda url: url,
        ):
            size = fetch_remote_file_size("https://example.com/redirect")
        self.assertEqual(size, 1000)

        self.assertEqual(mock_head.call_count, 2)
        self.assertEqual(
            mock_head.call_args_list[0].kwargs,
            {
                "headers": {"Accept-Encoding": "identity"},
                "allow_redirects": False,
                "stream": True,
                "timeout": 15,
            },
        )
        self.assertEqual(
            mock_head.call_args_list[1].args[0],
            "https://redirected.com/real_model.safetensors",
        )

    def test_write_json_atomic_recovery_on_replace_failure(self):
        import tempfile
        import os
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "test.json")
            with open(file_path, "w") as f:
                f.write('{"initial": true}')
            
            # Mock os.replace to raise OSError (simulating write/replace collision on Windows)
            with patch("os.replace", side_effect=OSError("Permission Denied")):
                with self.assertRaises(OSError):
                    write_json_atomic(file_path, {"updated": True})
            
            # Verify the original file is untouched and readable
            with open(file_path, "r") as f:
                self.assertEqual(f.read(), '{"initial": true}')
            
            # Verify no temporary files leak in the directory
            self.assertEqual(os.listdir(tmpdir), ["test.json"])

    def test_read_json_safe_malformed_syntax_fallback(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "corrupt.json")
            with open(file_path, "w") as f:
                f.write('{"unclosed_brace": true')  # Malformed JSON
            
            result = read_json_safe(file_path, {"fallback": True})
            self.assertEqual(result, {"fallback": True})

    def test_calculate_file_sha256_missing_file_handling(self):
        # Empty path
        self.assertIsNone(calculate_file_sha256(""))
        # Non-existent path
        self.assertIsNone(calculate_file_sha256("non_existent_file_path.safetensors"))
        # A directory path
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            self.assertIsNone(calculate_file_sha256(tmpdir))

    def test_get_version_sort_key_missing_and_invalid_timestamps(self):
        # Normal sorting: timestamp, then id
        v1 = {"id": 10, "published_at": "2024-01-01T00:00:00Z"}
        v2 = {"id": 20, "published_at": "2024-01-01T00:00:00Z"}
        # Both same timestamp, sorted by id
        self.assertEqual(get_version_sort_key(v1), ("2024-01-01T00:00:00Z", 10))
        self.assertEqual(get_version_sort_key(v2), ("2024-01-01T00:00:00Z", 20))
        
        # Missing timestamp completely
        v3 = {"id": 30}
        self.assertEqual(get_version_sort_key(v3), ("", 30))
        
        # None as timestamp
        v4 = {"id": 40, "updatedAt": None}
        self.assertEqual(get_version_sort_key(v4), ("", 40))

    def test_get_version_sort_key_malformed_ids(self):
        # String ID that cannot be cast to int should default to 0
        v1 = {"id": "invalid_id_string", "published_at": "2024-01-01"}
        self.assertEqual(get_version_sort_key(v1), ("2024-01-01", 0))
        
        # Negative ID
        v2 = {"id": -5, "published_at": "2024-01-01"}
        self.assertEqual(get_version_sort_key(v2), ("2024-01-01", -5))

    def test_looks_like_model_file_unexpected_edge_cases(self):
        # URL with trailing text that invalidates the extension
        self.assertFalse(looks_like_model_file("https://example.com/file.safetensors invalid"))
        # No scheme
        self.assertFalse(looks_like_model_file("example.com/file.safetensors"))
        # No extension or path
        self.assertFalse(looks_like_model_file("https://example.com/"))
        # Empty string
        self.assertFalse(looks_like_model_file(""))

    def test_normalize_model_image_missing_civitai_urls(self):
        # Image URL contains numbers at the end, should extract post ID
        raw_image = {
            "url": "https://image.civitai.com/x/width=1200/987654.jpeg",
        }
        normalized = normalize_model_image(raw_image)
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/images/987654")
        
        # Non-CivitAI image URL with no numbers shouldn't build civitaiUrl
        raw_image_other = {
            "url": "https://example.com/some_image.png",
        }
        normalized_other = normalize_model_image(raw_image_other)
        self.assertEqual(normalized_other["civitaiUrl"], "")

    @patch("requests.post")
    @patch("requests.get")
    def test_check_credential_http_various_responses(self, mock_get, mock_post):
        # 1. Success case with GET and username parsing
        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.json.return_value = {"user": {"name": "civit_maker"}}
        mock_get.return_value = mock_response_200
        
        result = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={"Authorization": "Bearer key"},
            get_username=lambda data: data["user"]["name"],
            success_message="Authenticated"
        )
        self.assertTrue(result["success"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["username"], "civit_maker")
        self.assertEqual(result["message"], "Authenticated for civit_maker.")

        # 2. HTTP 401/403 Invalid case
        mock_response_401 = MagicMock()
        mock_response_401.status_code = 401
        mock_get.return_value = mock_response_401
        
        result_401 = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={"Authorization": "Bearer bad"},
            error_msg_401_403="Denied Access"
        )
        self.assertTrue(result_401["success"])
        self.assertFalse(result_401["valid"])
        self.assertEqual(result_401["status"], "invalid")
        self.assertEqual(result_401["message"], "Denied Access")
        self.assertEqual(result_401["status_code"], 401)

        # 3. HTTP 429 Rate Limit case with custom handler
        mock_response_429 = MagicMock()
        mock_response_429.status_code = 429
        mock_get.return_value = mock_response_429
        
        custom_handler = lambda r: {"status": "limited", "retry": True}
        result_429 = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={},
            custom_429_handler=custom_handler
        )
        self.assertEqual(result_429, {"status": "limited", "retry": True})

        # 4. Timeout Exception handling
        import requests
        mock_get.side_effect = requests.exceptions.Timeout("Request timed out")
        result_timeout = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={}
        )
        self.assertFalse(result_timeout["success"])
        self.assertEqual(result_timeout["status"], "timeout")

    def test_calculate_file_sha256_success(self):
        import tempfile
        import os
        import hashlib
        
        content = b"model binary data block"
        expected_hash = hashlib.sha256(content).hexdigest()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "mock_model.safetensors")
            with open(file_path, "wb") as f:
                f.write(content)
            
            calculated_hash = calculate_file_sha256(file_path, chunk_size=4)
            self.assertEqual(calculated_hash, expected_hash)

    def write_safetensors_stub(self, file_path, header):
        import json

        header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
        with open(file_path, "wb") as f:
            f.write(len(header_bytes).to_bytes(8, byteorder="little"))
            f.write(header_bytes)
            f.write(b"tensor payload")

    def test_extract_safetensors_header_sha256(self):
        import os
        import tempfile

        expected_hash = "a" * 64
        header = {"__metadata__": {"modelspec.hash.sha256": expected_hash.upper()}}

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "header_hash.safetensors")
            self.write_safetensors_stub(file_path, header)

            self.assertEqual(extract_safetensors_header_sha256(file_path), expected_hash)

            with patch(
                "core.path_utils.hashlib.sha256",
                side_effect=AssertionError("full file hash should not be calculated"),
            ):
                self.assertEqual(calculate_file_sha256(file_path), expected_hash)

    def test_extract_safetensors_header_sha256_with_0x_prefix(self):
        import os
        import tempfile

        expected_hash = "b" * 64
        header = {"__metadata__": {"modelspec.hash_sha256": "0x" + expected_hash}}

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "header_hash_0x.safetensors")
            self.write_safetensors_stub(file_path, header)

            self.assertEqual(extract_safetensors_header_sha256(file_path), expected_hash)

    def test_extract_safetensors_header_sha256_ignores_sshs_model_hash(self):
        import hashlib
        import json
        import os
        import tempfile

        header = {
            "__metadata__": {
                "sshs_model_hash": "c" * 64,
                "sshs_legacy_hash": "dacc4e08",
            },
        }
        header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
        payload = (
            len(header_bytes).to_bytes(8, byteorder="little")
            + header_bytes
            + b"tensor payload"
        )
        expected_hash = hashlib.sha256(payload).hexdigest()

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "sshs_hash.safetensors")
            with open(file_path, "wb") as f:
                f.write(payload)

            self.assertIsNone(extract_safetensors_header_sha256(file_path))
            self.assertEqual(calculate_file_sha256(file_path), expected_hash)

    def test_infer_safetensors_base_model_from_architecture(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "sdxl_arch.safetensors")
            self.write_safetensors_stub(
                file_path,
                {
                    "__metadata__": {
                        "modelspec.architecture": "stable-diffusion-xl-v1-base",
                    },
                },
            )

            self.assertEqual(infer_safetensors_base_model(file_path), "SDXL 1.0")

    def test_extract_safetensors_header_metadata_summary(self):
        import json
        import os
        import tempfile

        expected_hash = "c" * 64
        model_hash = "d" * 64
        header = {
            "__metadata__": {
                "modelspec.title": "Header Model",
                "modelspec.author": "Header Author",
                "modelspec.description": "Header description",
                "modelspec.license": "MIT",
                "modelspec.hash.sha256": expected_hash,
                "modelspec.tags": json.dumps(["style", "character"]),
                "modelspec.trigger_phrase": "hero, dramatic light",
                "modelspec.thumbnail": "data:image/png;base64,abc",
                "ss_base_model_version": "pony",
                "ss_clip_skip": "2",
                "ss_network_module": "networks.lora",
                "ss_network_dim": "16",
                "sshs_model_hash": model_hash,
                "ss_tag_frequency": json.dumps(
                    {"dataset": {"blue eyes": 12, "solo": 9}}
                ),
                "workflow": "{}",
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "header_metadata.safetensors")
            self.write_safetensors_stub(file_path, header)

            metadata = extract_safetensors_header_metadata(file_path)

        self.assertTrue(metadata["from_safetensors_header"])
        self.assertEqual(metadata["model_name"], "Header Model")
        self.assertEqual(metadata["creator"]["username"], "Header Author")
        self.assertEqual(metadata["description"], "Header description")
        self.assertEqual(metadata["license"], "MIT")
        self.assertEqual(metadata["base_model"], "Pony")
        self.assertEqual(metadata["sha256"], expected_hash)
        self.assertEqual(metadata["sha256_source"], "safetensors_header")
        self.assertEqual(metadata["clip_skip"], 2)
        self.assertIn("style", metadata["tags"])
        self.assertIn("blue eyes", metadata["tags"])
        self.assertEqual(metadata["trained_words"], ["hero", "dramatic light"])
        self.assertEqual(metadata["model_type"], "LORA")
        self.assertTrue(metadata["metadata_summary"]["has_embedded_workflow"])
        self.assertEqual(metadata["metadata_summary"]["network_dim"], "16")
        self.assertEqual(metadata["metadata_summary"]["model_hash"], model_hash)

    def test_infer_safetensors_base_model_from_tensor_fingerprints(self):
        import os
        import tempfile

        cases = [
            ("flux.safetensors", "double_blocks.0.img_attn.qkv.weight", "Flux.1 D"),
            ("sd3.safetensors", "joint_blocks.0.x_block.attn.qkv.weight", "SD 3"),
            ("sdxl.safetensors", "conditioner.embedders.1.model.transformer", "SDXL 1.0"),
            (
                "sd15.safetensors",
                "model.diffusion_model.input_blocks.0.0.weight",
                "SD 1.5",
            ),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            for filename, tensor_key, expected_base_model in cases:
                file_path = os.path.join(tmpdir, filename)
                self.write_safetensors_stub(
                    file_path,
                    {
                        "__metadata__": {},
                        tensor_key: {"dtype": "F16", "shape": [1]},
                    },
                )
                self.assertEqual(
                    infer_safetensors_base_model(file_path),
                    expected_base_model,
                )

    def test_calculate_file_sha256_falls_back_without_header_sha256(self):
        import hashlib
        import json
        import os
        import tempfile

        header = json.dumps(
            {"__metadata__": {"modelspec.hash.blake3": "b" * 64}},
            separators=(",", ":"),
        ).encode("utf-8")
        payload = (
            len(header).to_bytes(8, byteorder="little")
            + header
            + b"tensor payload"
        )
        expected_hash = hashlib.sha256(payload).hexdigest()

        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "fallback_hash.safetensors")
            with open(file_path, "wb") as f:
                f.write(payload)

            self.assertIsNone(extract_safetensors_header_sha256(file_path))
            self.assertEqual(calculate_file_sha256(file_path), expected_hash)

    def test_extract_response_file_size_html_type_exclusion(self):
        from requests.structures import CaseInsensitiveDict
        
        # HTML Content-Type should be ignored for content-length
        mock_response = MagicMock()
        mock_response.headers = CaseInsensitiveDict({
            "Content-Length": "12345",
            "Content-Type": "text/html; charset=utf-8"
        })
        size = extract_response_file_size(mock_response)
        self.assertIsNone(size)

        # Non-HTML content-type should be parsed
        mock_response_valid = MagicMock()
        mock_response_valid.headers = CaseInsensitiveDict({
            "Content-Length": "12345",
            "Content-Type": "application/octet-stream"
        })
        size_valid = extract_response_file_size(mock_response_valid)
        self.assertEqual(size_valid, 12345)

    def test_read_json_safe_edge_cases(self):
        # 1. Path is None
        self.assertIsNone(read_json_safe(None))
        # 2. Path is empty
        self.assertEqual(read_json_safe("", "default"), "default")
        # 3. Path is a directory
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            self.assertEqual(read_json_safe(tmpdir, "default"), "default")

    def test_get_version_sort_key_non_dict_input(self):
        # If version is not a dict, it must fall back to ("", 0) gracefully
        self.assertEqual(get_version_sort_key(None), ("", 0))
        self.assertEqual(get_version_sort_key("not a dict"), ("", 0))
        self.assertEqual(get_version_sort_key([]), ("", 0))

    def test_looks_like_model_file_expected_filename_fallback(self):
        # expected_filename does not match basename, but it has a valid extension
        self.assertTrue(looks_like_model_file("https://example.com/files/model.safetensors", "other_name.safetensors"))
        # expected_filename does not match basename, and does NOT have a valid extension
        self.assertFalse(looks_like_model_file("https://example.com/files/config.json", "other_name.safetensors"))

    def test_normalize_model_image_edge_cases(self):
        # 1. Non-dict input returns empty dict
        self.assertEqual(normalize_model_image(None), {})
        self.assertEqual(normalize_model_image([]), {})
        
        # 2. default_civitai_url fallback works
        raw_image = {
            "url": "https://example.com/some_image.png",
        }
        normalized = normalize_model_image(raw_image, default_civitai_url="https://civitai.com/posts/fallback")
        self.assertEqual(normalized["civitaiUrl"], "https://civitai.com/posts/fallback")

    def test_metadata_sidecar_strict_credential_scrubbing(self):
        """
        Covers Security Risk: API keys, cookies, or authorization tokens leaking into local JSON metadata sidecar files.
        Verifies that build_lora_manager_metadata scrubs sensitive query parameters and headers from payloads.
        """
        import json
        from core.downloader import build_lora_manager_metadata
        dest_path = "dummy_model.safetensors"
        metadata = {
            "download_url": "https://civitai.com/api/download/models/123?token=sensitivetoken123&session=cookie_val",
            "source_url": "https://civitai.com/models/123?apiKey=sensitiveapikey123",
            "headers": {"Authorization": "Bearer some-bearer-token"},
            "hf_token": "hf_abc123secret",
        }
        
        payload = build_lora_manager_metadata(
            dest_path=dest_path,
            metadata=metadata,
            category="loras",
            source_url="https://civitai.com/api/download/models/123?token=sensitivetoken123"
        )
        
        serialized = json.dumps(payload)
        self.assertNotIn("sensitivetoken123", serialized)
        self.assertNotIn("cookie_val", serialized)
        self.assertNotIn("sensitiveapikey123", serialized)
        self.assertNotIn("hf_abc123secret", serialized)
        self.assertNotIn("Authorization", payload)
        self.assertNotIn("headers", payload)

    def test_write_json_atomic_cleanup_on_failure(self):
        """
        Covers File System Integrity Risk: Disk write or rename failure leaving corrupted or incomplete files.
        Verifies that write_json_atomic cleans up temporary files and leaves the original file intact on failure.
        """
        import tempfile
        import os
        from unittest.mock import patch
        
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "target.json")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write('{"intact": true}')
            
            with patch("os.replace", side_effect=OSError("Permission denied")):
                with self.assertRaises(OSError):
                    write_json_atomic(file_path, {"changed": True})
            
            with open(file_path, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), '{"intact": true}')
            
            files = os.listdir(tmpdir)
            self.assertEqual(files, ["target.json"])

    @patch("requests.head")
    @patch("requests.get")
    def test_fetch_remote_file_size_head_fails_get_range_succeeds(self, mock_get, mock_head):
        """
        Covers Network Compatibility Risk: HEAD request blocked or unsupported by remote servers.
        Verifies fallback to partial GET request using bytes=0-0 range and extracting correct Content-Range size.
        Asserts that Range headers and stream parameters are correct to prevent full model downloads.
        """
        from requests.structures import CaseInsensitiveDict
        
        mock_head_res = MagicMock()
        mock_head_res.status_code = 405
        mock_head.return_value = mock_head_res
        
        mock_get_res = MagicMock()
        mock_get_res.status_code = 206
        mock_get_res.headers = CaseInsensitiveDict({
            "Content-Range": "bytes 0-0/987654321",
            "Content-Length": "1",
            "Content-Type": "application/octet-stream"
        })
        mock_get.return_value = mock_get_res
        
        size = fetch_remote_file_size("https://example.com/range_model.safetensors", headers={"Custom-Header": "Value"})
        self.assertEqual(size, 987654321)
        mock_head.assert_called_once()
        
        # Assert specific range check request parameters to prevent full file download
        mock_get.assert_called_once_with(
            "https://example.com/range_model.safetensors",
            headers={"Custom-Header": "Value", "Accept-Encoding": "identity", "Range": "bytes=0-0"},
            allow_redirects=False,
            stream=True,
            timeout=15
        )

    def test_calculate_file_sha256_handles_large_file_chunking(self):
        """
        Covers Process Stability Risk: OOM error when hashing large gigabyte-sized files.
        Verifies calculate_file_sha256 reads the file incrementally in exact chunk_size blocks,
        and that a mutation reading the entire file in one go is caught.
        """
        from unittest.mock import mock_open, patch
        import hashlib
        
        content = b"large_model_data_block_chunk_test"
        expected_hash = hashlib.sha256(content).hexdigest()
        
        # Setup a mock file where we can control read outputs and count calls
        # We simulate reading 4 bytes at a time
        chunks = [content[i:i+4] for i in range(0, len(content), 4)] + [b""]
        mock_file = MagicMock()
        mock_file.read.side_effect = chunks
        mock_file.__enter__.return_value = mock_file
        
        m_open = mock_open()
        m_open.return_value = mock_file
        
        with patch("builtins.open", m_open), patch("os.path.exists", return_value=True):
            calculated_hash = calculate_file_sha256("dummy_path.safetensors", chunk_size=4)
            
            # Assert correct hash was calculated
            self.assertEqual(calculated_hash, expected_hash)
            
            # Assert it was read chunk-by-chunk rather than all at once
            self.assertEqual(mock_file.read.call_count, len(chunks))
            for call in mock_file.read.call_args_list[:-1]:
                self.assertEqual(call[0][0], 4)

    def test_read_json_safe_handles_raw_corrupt_payload(self):
        """
        Covers Resilience Risk: Malformed or truncated settings JSON causing process startup failure.
        Verifies read_json_safe catches json formatting/syntax errors and successfully returns the fallback.
        """
        import tempfile
        import os
        
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "corrupt.json")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("corrupted JSON content {[[}")
            
            result = read_json_safe(file_path, default={"fallback": "value"})
            self.assertEqual(result, {"fallback": "value"})

    def test_fetch_remote_file_size_ignores_html_content_type(self):
        """
        Covers Network Response Boundary: Cloudflare or local proxies returning HTML pages with length instead of binaries.
        Verifies extract_response_file_size excludes HTML page content-lengths from being parsed as valid size metadata.
        """
        from requests.structures import CaseInsensitiveDict
        mock_response = MagicMock()
        mock_response.headers = CaseInsensitiveDict({
            "Content-Length": "8888",
            "Content-Type": "text/html; charset=utf-8"
        })
        
        size = extract_response_file_size(mock_response)
        self.assertIsNone(size)

    def test_get_version_sort_key_missing_or_invalid_values(self):
        """
        Covers Functional Robustness: Missing or invalid timestamps/IDs in model versions.
        Verifies stable key tuples are generated without raising TypeError or ValueError.
        """
        version_missing_id = {"published_at": "2024-01-01T00:00:00Z"}
        version_invalid_id = {"published_at": "2024-01-01T00:00:00Z", "id": "not_an_int"}
        version_none = None
        
        key_missing = get_version_sort_key(version_missing_id)
        key_invalid = get_version_sort_key(version_invalid_id)
        key_none = get_version_sort_key(version_none)
        
        self.assertEqual(key_missing, ("2024-01-01T00:00:00Z", 0))
        self.assertEqual(key_invalid, ("2024-01-01T00:00:00Z", 0))
        self.assertEqual(key_none, ("", 0))

    def test_looks_like_model_file_strict_matches(self):
        """
        Covers Input Boundary Validation: Ensuring downloader model URL verification functions exclude false positives.
        Verifies HuggingFace Spaces page rejection and valid download link acceptance.
        """
        self.assertFalse(looks_like_model_file("https://huggingface.co/spaces/user/space-name"))
        self.assertTrue(looks_like_model_file("https://civitai.com/api/download/models/12345"))
        self.assertTrue(looks_like_model_file("https://example.com/some_model.safetensors"))
        self.assertFalse(looks_like_model_file("https://example.com/some_image.jpg"))

    @patch("requests.get")
    def test_check_credential_http_rate_limit_and_timeout(self, mock_get):
        """
        Covers Integration Boundary Risk: Remote credential checking fails gracefully under rate limits or network timeout.
        Verifies Timeout exception handling and HTTP 429 rate limit responses map correctly.
        """
        import requests
        mock_get.side_effect = requests.exceptions.Timeout("Request timed out")
        
        result_timeout = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={"Authorization": "Bearer token"}
        )
        
        self.assertFalse(result_timeout["success"])
        self.assertEqual(result_timeout["status"], "timeout")
        
        mock_get.side_effect = None
        mock_res_429 = MagicMock()
        mock_res_429.status_code = 429
        mock_get.return_value = mock_res_429
        
        result_429 = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={"Authorization": "Bearer token"}
        )
        
        self.assertFalse(result_429["success"])
        self.assertEqual(result_429["status_code"], 429)
        self.assertEqual(result_429["status"], "error")

    def test_write_json_atomic_serialization_failure_cleanup(self):
        """
        Covers File System Integrity Risk: Attempting to serialize un-serializable payloads during atomic writes.
        Verifies that any temp files generated before/during serialization failure are cleaned up.
        """
        import tempfile
        import os
        
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "target.json")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write('{"intact": true}')
                
            with self.assertRaises(TypeError):
                write_json_atomic(file_path, {"unserializable": {1, 2, 3}})
                
            with open(file_path, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), '{"intact": true}')
                
            files = os.listdir(tmpdir)
            self.assertEqual(files, ["target.json"])

    def test_looks_like_model_file_encoded_and_fragments(self):
        """
        Covers Input Boundary Validation: Validates looks_like_model_file parses percent-encoded URLs,
        query parameters, and URL fragment/hash symbols correctly.
        """
        self.assertTrue(looks_like_model_file("https://example.com/files/model%2Esafetensors"))
        self.assertTrue(looks_like_model_file("https://example.com/files/model.ckpt#weights"))
        self.assertTrue(looks_like_model_file("https://example.com/files/my%20model.safetensors?token=abc"))
        self.assertTrue(looks_like_model_file("https://example.com/my%20model.safetensors", "my model.safetensors"))

    @patch("requests.get")
    def test_check_credential_http_custom_429_handler_raises(self, mock_get):
        """
        Covers Error Recovery Risk: Simulates custom rate limit handlers raising unhandled exceptions.
        Verifies that check_credential_http catches these exceptions and maps them gracefully to failure responses.
        """
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_get.return_value = mock_response
        
        def bad_handler(resp):
            raise ValueError("custom handler exploded")
            
        result = check_credential_http(
            url="https://civitai.com/api/v1/me",
            headers={},
            custom_429_handler=bad_handler
        )
        
        self.assertFalse(result["success"])
        self.assertFalse(result["valid"])
        self.assertEqual(result["status"], "error")
        self.assertIn("custom handler exploded", result["message"])

    def test_normalize_sha256(self):
        h = "a" * 64
        self.assertEqual(normalize_sha256(h), h)
        self.assertEqual(normalize_sha256("sha256:" + h), h)
        self.assertEqual(normalize_sha256("sha256=" + h), h)
        self.assertEqual(normalize_sha256("SHA256:" + h.upper()), h)
        self.assertEqual(normalize_sha256("invalid_hash"), "")
        self.assertEqual(normalize_sha256(None), "")

    def test_unique_ordered_strings(self):
        self.assertEqual(unique_ordered_strings(["a", "b", "a", "c", "b"]), ["a", "b", "c"])
        self.assertEqual(unique_ordered_strings(["  a  ", "b", "a"]), ["a", "b"])
        self.assertEqual(unique_ordered_strings([]), [])

    def test_extract_sha256_from_metadata(self):
        h = "a" * 64
        self.assertEqual(extract_sha256_from_metadata({"sha256": h}), h)
        self.assertEqual(extract_sha256_from_metadata({"hash": h}), h)
        self.assertEqual(extract_sha256_from_metadata({"hashes": {"SHA256": h}}), h)
        self.assertEqual(extract_sha256_from_metadata({"hashes": {"sha256": h}}), h)
        self.assertEqual(extract_sha256_from_metadata({"file_info": {"sha256": h}}), h)
        self.assertEqual(extract_sha256_from_metadata({"file_info": {"hashes": {"sha256": h}}}), h)
        self.assertEqual(extract_sha256_from_metadata({}), "")

    def test_extract_trained_words(self):
        # --- basic flat inputs (existing cases) ---
        self.assertEqual(extract_trained_words("word1", ["word2"]), ["word1", "word2"])
        self.assertEqual(extract_trained_words({"word": "word1"}, [{"name": "word2"}]), ["word1", "word2"])
        self.assertEqual(extract_trained_words("word1", "word1"), ["word1"])

    def test_extract_trained_words_version_dict_trainedWords(self):
        # Mirrors the real civitai.py call: extract_trained_words(version)
        # where version is a dict with "trainedWords" key (list of strings)
        version = {
            "id": 123,
            "name": "v1.0",
            "trainedWords": ["trigger1", "trigger2"],
            "baseModel": "SD 1.5",
        }
        self.assertEqual(extract_trained_words(version), ["trigger1", "trigger2"])

    def test_extract_trained_words_version_dict_trainedWords_string(self):
        # trainedWords may be a single string in some API responses
        version = {"trainedWords": "solo_trigger"}
        self.assertEqual(extract_trained_words(version), ["solo_trigger"])

    def test_extract_trained_words_version_dict_trigger_key(self):
        # Mirrors the civarchive.py call pattern: version.get("trigger")
        version = {"trigger": "civarchive_trigger"}
        self.assertEqual(extract_trained_words(version), ["civarchive_trigger"])

    def test_extract_trained_words_version_dict_both_trainedWords_and_trigger(self):
        # Both keys present – both should be collected, deduped
        version = {"trainedWords": ["word_a", "word_b"], "trigger": "word_b"}
        result = extract_trained_words(version)
        self.assertIn("word_a", result)
        self.assertIn("word_b", result)
        self.assertEqual(result.count("word_b"), 1)  # deduplication

    def test_extract_trained_words_version_dict_model_tags(self):
        # model.tags path
        version = {"model": {"tags": ["tag1", "tag2"]}}
        self.assertEqual(extract_trained_words(version), ["tag1", "tag2"])

    def test_extract_trained_words_empty_and_none_inputs(self):
        self.assertEqual(extract_trained_words(None), [])
        self.assertEqual(extract_trained_words(""), [])
        self.assertEqual(extract_trained_words({}), [])
        self.assertEqual(extract_trained_words({"trainedWords": []}), [])
        self.assertEqual(extract_trained_words({"trainedWords": None}), [])

    def test_extract_trained_words_deduplication_case_insensitive(self):
        # Same word in different cases should appear only once
        result = extract_trained_words(["Trigger1", "trigger1", "TRIGGER1"])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], "Trigger1")  # first occurrence wins

    def test_extract_trained_words_multiple_version_dicts(self):
        # Called with multiple separate version objects (multi-arg form)
        v1 = {"trainedWords": ["alpha"]}
        v2 = {"trainedWords": ["beta"]}
        self.assertEqual(extract_trained_words(v1, v2), ["alpha", "beta"])

    @patch("core.type_utils.fetch_remote_file_size")
    def test_fetch_remote_file_size_cached(self, mock_fetch):
        clear_remote_size_cache()
        mock_fetch.return_value = 12345
        url = "https://example.com/file.bin"
        
        size1 = fetch_remote_file_size_cached(url)
        size2 = fetch_remote_file_size_cached(url)
        
        self.assertEqual(size1, 12345)
        self.assertEqual(size2, 12345)
        mock_fetch.assert_called_once()
        
        # Test clearing cache
        clear_remote_size_cache()
        mock_fetch.reset_mock()
        mock_fetch.return_value = 54321
        size3 = fetch_remote_file_size_cached(url)
        self.assertEqual(size3, 54321)
        mock_fetch.assert_called_once()

    @patch("os.path.exists")
    def test_find_metadata_sidecar_path(self, mock_exists):
        # We want to test finding a sidecar file.
        # Let's say model path is e:/models/sd15.safetensors
        # Standard names: e:/models/sd15.metadata.json, e:/models/sd15.safetensors.metadata.json, etc.
        mock_exists.side_effect = lambda p: p.endswith("sd15.metadata.json")
        
        path = find_metadata_sidecar_path("e:/models/sd15.safetensors")
        self.assertTrue(path.endswith("sd15.metadata.json"))

    @patch("os.path.exists")
    def test_find_metadata_sidecar_path_does_not_return_input_path(self, mock_exists):
        mock_exists.side_effect = (
            lambda p: p.replace("\\", "/").lower() == "e:/models/ae.metadata.json"
        )

        path = find_metadata_sidecar_path("e:/models/ae.metadata.json")
        self.assertEqual(path, "")

    def test_normalize_category_to_model_type(self):
        self.assertEqual(normalize_category_to_model_type("checkpoints"), "checkpoint")
        self.assertEqual(normalize_category_to_model_type("loras"), "lora")
        self.assertEqual(normalize_category_to_model_type("vae"), "vae")
        self.assertEqual(normalize_category_to_model_type("diffusion_models"), "diffusion_model")
        self.assertEqual(normalize_category_to_model_type("embeddings"), "embedding")
        self.assertEqual(normalize_category_to_model_type(""), "")

    def test_check_credential_preconditions(self):
        # Empty inputs
        self.assertEqual(
            check_credential_preconditions("", "Token"),
            {
                "success": False,
                "valid": False,
                "status": "missing",
                "message": "Paste a Token first.",
            }
        )
        # Non-empty inputs
        self.assertIsNone(check_credential_preconditions("my-token", "Token"))

    def test_calculate_file_sha256_with_progress(self):
        import tempfile
        import os
        from core.path_utils import calculate_file_sha256
        
        content = b"some test binary data for progress"
        progress_calls = []
        
        def on_progress(bytes_read, total_bytes):
            progress_calls.append((bytes_read, total_bytes))
            
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "progress_test.bin")
            with open(file_path, "wb") as f:
                f.write(content)
                
            calculated_hash = calculate_file_sha256(
                file_path, chunk_size=4, on_progress=on_progress
            )
            self.assertIsNotNone(calculated_hash)
            # Verify progress was called
            self.assertTrue(len(progress_calls) > 0)
            self.assertEqual(progress_calls[-1], (len(content), len(content)))

    def test_calculate_file_sha256_cancellation(self):
        import tempfile
        import os
        from core.path_utils import calculate_file_sha256, HashCalculationCancelled
        
        content = b"some test binary data for cancellation"
        
        def is_cancelled():
            return True
            
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "cancel_test.bin")
            with open(file_path, "wb") as f:
                f.write(content)
                
            with self.assertRaises(HashCalculationCancelled):
                calculate_file_sha256(
                    file_path, chunk_size=4, is_cancelled=is_cancelled
                )

    def test_save_catalog_with_backup(self):
        import tempfile
        import os
        from core.path_utils import save_catalog_with_backup, read_json_safe
        
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = os.path.join(tmpdir, "catalog.json")
            meta_file = os.path.join(tmpdir, "catalog_meta.json")
            
            # Initial write
            initial_data = {"items": [1, 2, 3]}
            initial_meta = {"updated_at": "now"}
            
            save_catalog_with_backup(data_file, initial_data, meta_file, initial_meta)
            
            self.assertTrue(os.path.exists(data_file))
            self.assertTrue(os.path.exists(meta_file))
            self.assertEqual(read_json_safe(data_file), initial_data)
            self.assertEqual(read_json_safe(meta_file), initial_meta)
            
            # Write with backup check
            new_data = {"items": [4, 5, 6]}
            new_meta = {"updated_at": "later"}
            
            save_catalog_with_backup(data_file, new_data, meta_file, new_meta)
            
            # Verify backup exists
            backup_file = data_file + ".bak"
            self.assertTrue(os.path.exists(backup_file))
            self.assertEqual(read_json_safe(backup_file), initial_data)
            
            # Verify new data is written
            self.assertEqual(read_json_safe(data_file), new_data)
            self.assertEqual(read_json_safe(meta_file), new_meta)

    @patch("requests.get")
    def test_request_source_json_success(self, mock_get):
        from core.network_utils import request_source_json
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True}
        mock_get.return_value = mock_response

        res = request_source_json("https://example.com/api")
        self.assertEqual(res, {"success": True})

    @patch("requests.get")
    @patch("time.sleep")
    def test_request_source_json_429_retry(self, mock_sleep, mock_get):
        from core.network_utils import request_source_json
        mock_response_429 = MagicMock()
        mock_response_429.status_code = 429
        mock_response_429.headers = {"Retry-After": "1.5"}

        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.json.return_value = {"ok": True}

        mock_get.side_effect = [mock_response_429, mock_response_200]

        res = request_source_json("https://example.com/api", max_attempts=2)
        self.assertEqual(res, {"ok": True})
        mock_sleep.assert_called_once_with(1.5)

    def test_split_path_segments(self):
        from core.path_utils import split_path_segments
        self.assertEqual(split_path_segments("a/b/c"), ["a", "b", "c"])
        self.assertEqual(split_path_segments("a\\b\\c"), ["a", "b", "c"])
        self.assertEqual(split_path_segments("a/./b/../c"), ["a", "b", "c"])
        self.assertEqual(split_path_segments("a/./b/../c", filter_dots=False), ["a", ".", "b", "..", "c"])
        self.assertEqual(split_path_segments(""), [])
        self.assertEqual(split_path_segments(None), [])

    def test_parse_provider_model_url(self):
        from core.type_utils import parse_provider_model_url
        allowed = ["civitai.com", "civitai.red"]
        
        # Valid url download format
        res = parse_provider_model_url("https://civitai.com/api/download/models/12345", allowed)
        self.assertEqual(res, {"version_id": 12345})
        
        # Valid model page format
        res = parse_provider_model_url("https://civitai.red/models/9876?modelVersionId=54321", allowed)
        self.assertEqual(res, {"model_id": 9876, "version_id": 54321})
        
        # Non-matching hostname
        res = parse_provider_model_url("https://example.com/api/download/models/12345", allowed)
        self.assertIsNone(res)
        
        # Mirror sha256 path pattern
        res = parse_provider_model_url("https://civarchive.com/sha256/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", ["civarchive.com"])
        self.assertEqual(res, {"sha256": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"})




import io
import json
import sys
import unittest
from unittest.mock import MagicMock, patch

from core.download import _hf_worker as worker
from core.download.validation import (
    extract_filename_from_content_disposition,
    is_allowed_model_download_filename,
)
from core.sources.huggingface import HF_AUTHOR_FALLBACKS
from core.type_utils import guess_category_from_filename
from core.workflow.references import get_node_model_info
from core.workflow.widgets import (
    MODEL_WIDGET_NAME_TO_CATEGORY,
    get_node_model_widget_category_hint,
)


class TestHuggingFaceFeatures2026(unittest.TestCase):
    def test_priority_authors_included(self):
        expected_authors = [
            "Kim2091",
            "Phips",
            "lightx2v",
            "vrgamedevgirl84",
            "unsloth",
            "Lightricks",
            "Winnougan",
            "LBH-123-AI",
        ]
        for author in expected_authors:
            self.assertIn(
                author,
                HF_AUTHOR_FALLBACKS,
                f"Author {author} should be included in HF_AUTHOR_FALLBACKS",
            )

    def test_guess_category_from_filename(self):
        self.assertEqual(
            guess_category_from_filename("wan2.1_bernini_1.3B_fp16.safetensors"),
            "diffusion_models",
        )
        self.assertEqual(
            guess_category_from_filename("wan2.2_14b_mxfp8.safetensors"),
            "diffusion_models",
        )
        self.assertEqual(
            guess_category_from_filename("wan2.1_vae.safetensors"),
            "vae",
        )
        self.assertEqual(
            guess_category_from_filename("wan2.1_t5xxl.safetensors"),
            "text_encoders",
        )
        self.assertEqual(
            guess_category_from_filename("minimax_h3_upscaler.safetensors"),
            "latent_upscale_models",
        )
        self.assertEqual(
            guess_category_from_filename("minimax_video_1.safetensors"),
            "diffusion_models",
        )
        self.assertEqual(
            guess_category_from_filename("mmaudio_large_v1.safetensors"),
            "audio_encoders",
        )
        self.assertEqual(
            guess_category_from_filename("vocoder_mmaudio.safetensors"),
            "audio_encoders",
        )
        self.assertEqual(
            guess_category_from_filename("taesdxl_decoder.safetensors"),
            "vae_approx",
        )
        self.assertEqual(
            guess_category_from_filename("clip_vision_h.safetensors"),
            "clip_vision",
        )
        self.assertIsNone(guess_category_from_filename("unknown_generic_file.bin"))

    def test_node_mappings_for_new_architectures(self):
        self.assertEqual(
            get_node_model_widget_category_hint("WanVideoModelLoader", 0),
            "diffusion_models",
        )
        self.assertEqual(
            get_node_model_widget_category_hint("WanVideoTextEncoderLoader", 0),
            "text_encoders",
        )
        self.assertEqual(
            get_node_model_widget_category_hint("WanVideoVAELoader", 0),
            "vae",
        )
        self.assertEqual(
            get_node_model_widget_category_hint("MiniMaxModelLoader", 0),
            "diffusion_models",
        )
        self.assertEqual(
            get_node_model_widget_category_hint("MiniMaxH3Loader", 0),
            "latent_upscale_models",
        )
        self.assertEqual(
            get_node_model_widget_category_hint("MMAudioModelLoader", 0),
            "audio_encoders",
        )
        self.assertEqual(
            MODEL_WIDGET_NAME_TO_CATEGORY.get("wan_video_name"),
            "diffusion_models",
        )
        self.assertEqual(
            MODEL_WIDGET_NAME_TO_CATEGORY.get("mmaudio_name"),
            "audio_encoders",
        )

    def test_workflow_references_prioritize_wan_diffusion_over_checkpoints(self):
        node = {
            "id": 1,
            "type": "CheckpointLoaderSimple",
            "widgets_values": ["wan2.1_14B_bf16.safetensors"],
        }
        refs = get_node_model_info(node)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].category, "diffusion_models")
        self.assertIn("diffusion_models", refs[0].extra.get("category_hints", []))

    def test_extract_filename_from_content_disposition(self):
        # Standard filename with double quotes
        cd1 = 'attachment; filename="epicrealism_naturalSin.safetensors"'
        self.assertEqual(
            extract_filename_from_content_disposition(cd1),
            "epicrealism_naturalSin.safetensors",
        )
        self.assertTrue(
            is_allowed_model_download_filename(extract_filename_from_content_disposition(cd1))
        )

        # Standard filename without quotes
        cd2 = "attachment; filename=model.ckpt"
        self.assertEqual(extract_filename_from_content_disposition(cd2), "model.ckpt")

        # RFC 5987 / RFC 6266 UTF-8 encoded
        cd3 = "attachment; filename*=UTF-8''my%20flux%20lora.safetensors"
        self.assertEqual(
            extract_filename_from_content_disposition(cd3),
            "my flux lora.safetensors",
        )

        # Path traversal sanitized
        cd4 = 'attachment; filename="../../../etc/passwd.safetensors"'
        self.assertEqual(
            extract_filename_from_content_disposition(cd4),
            "passwd.safetensors",
        )

        # Empty / None
        self.assertEqual(extract_filename_from_content_disposition(""), "")
        self.assertEqual(extract_filename_from_content_disposition(None), "")
        self.assertEqual(extract_filename_from_content_disposition("inline"), "")

    def test_hf_worker_retries_anonymous_on_token_rejection(self):
        mock_hub = MagicMock()
        mock_errors = MagicMock()

        class DummyHfHubHTTPError(Exception):
            def __init__(self, msg, status_code=401):
                super().__init__(msg)
                self.response = MagicMock(status_code=status_code)

        mock_errors.HfHubHTTPError = DummyHfHubHTTPError
        mock_hub.hf_hub_download.side_effect = [
            DummyHfHubHTTPError("401 Client Error: Invalid credentials", status_code=401),
            "/path/to/downloaded/model.safetensors",
        ]

        emitted = []
        payload = json.dumps({
            "repo_id": "some-org/public-model",
            "filename": "model.safetensors",
            "local_dir": "/tmp",
            "token": "hf_fine_grained_restricted",
        })

        with patch.dict(sys.modules, {
            "huggingface_hub": mock_hub,
            "huggingface_hub.errors": mock_errors,
        }), \
             patch("sys.stdin", io.StringIO(payload)), \
             patch.object(worker, "emit", lambda event, **kw: emitted.append((event, kw))), \
             patch.object(worker, "log", lambda msg, **kw: None):
            worker.main()

        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0][0], "done")
        self.assertEqual(emitted[0][1]["path"], "/path/to/downloaded/model.safetensors")
        self.assertEqual(mock_hub.hf_hub_download.call_count, 2)
        self.assertEqual(mock_hub.hf_hub_download.call_args_list[1][1]["token"], False)

    def test_hf_worker_does_not_retry_anonymous_on_gated_repo(self):
        mock_hub = MagicMock()
        mock_errors = MagicMock()

        class DummyHfHubHTTPError(Exception):
            def __init__(self, msg, status_code=401):
                super().__init__(msg)
                self.response = MagicMock(status_code=status_code)

        mock_errors.HfHubHTTPError = DummyHfHubHTTPError
        mock_hub.hf_hub_download.side_effect = DummyHfHubHTTPError(
            "401 Client Error: Gated repo access restricted", status_code=401
        )

        emitted = []
        payload = json.dumps({
            "repo_id": "black-forest-labs/FLUX.1-dev",
            "filename": "flux1-dev.safetensors",
            "local_dir": "/tmp",
            "token": "hf_token",
        })

        with patch.dict(sys.modules, {
            "huggingface_hub": mock_hub,
            "huggingface_hub.errors": mock_errors,
        }), \
             patch("sys.stdin", io.StringIO(payload)), \
             patch.object(worker, "emit", lambda event, **kw: emitted.append((event, kw))), \
             patch.object(worker, "log", lambda msg, **kw: None):
            worker.main()

        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0][0], "error")
        self.assertEqual(mock_hub.hf_hub_download.call_count, 1)


if __name__ == "__main__":
    unittest.main()

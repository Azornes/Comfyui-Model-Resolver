"""
Tests for core/model_classifier.py: Model Classification & Misplaced Models (Tidy)
"""

import os
import shutil
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from core.contracts import ResolvedModel
from core.model_classifier import (
    WORKS_ANYWAY,
    check_model_misplacement,
    classify_gguf_metadata,
    classify_model_file,
    classify_safetensors_header,
    find_model_sidecars,
    get_target_root_for_category,
    get_unique_destination_path,
    is_category_compatible,
    move_misplaced_model,
    normalize_category_for_placement,
    scan_misplaced_models,
)


class ModelClassifierTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_classify_safetensors_lora(self):
        header = {
            "lora_unet_down_blocks_0_attentions_0_proj_in.lora_up.weight": {"shape": [32, 320]},
            "lora_unet_down_blocks_0_attentions_0_proj_in.lora_down.weight": {"shape": [320, 32]},
            "__metadata__": {"ss_base_model_version": "sdxl_base_v1-0"},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "loras")
        self.assertEqual(res["base"], "SDXL")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_checkpoint(self):
        header = {
            "model.diffusion_model.input_blocks.0.0.weight": {"shape": [320, 4, 3, 3]},
            "first_stage_model.encoder.conv_in.weight": {"shape": [128, 3, 3, 3]},
            "cond_stage_model.transformer.text_model.embeddings.token_embedding.weight": {"shape": [49408, 768]},
            "__metadata__": {},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "checkpoints")
        self.assertEqual(res["base"], "SD 1.5")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_controlnet(self):
        header = {
            "control_model.input_blocks.0.0.weight": {"shape": [320, 4, 3, 3]},
            "control_model.zero_convs.0.0.weight": {"shape": [320, 320, 1, 1]},
            "__metadata__": {"modelspec.architecture": "stable-diffusion-xl"},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "controlnet")
        self.assertEqual(res["base"], "SDXL")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_vae(self):
        header = {
            "encoder.down_blocks.0.resnets.0.conv1.weight": {"shape": [128, 128, 3, 3]},
            "decoder.up_blocks.0.resnets.0.conv1.weight": {"shape": [512, 512, 3, 3]},
            "__metadata__": {},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "vae")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_diffusion_models(self):
        header = {
            "double_blocks.0.img_attn.qkv.weight": {"shape": [3072, 3072]},
            "single_blocks.0.linear1.weight": {"shape": [12288, 3072]},
            "__metadata__": {"modelspec.architecture": "flux"},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "diffusion_models")
        self.assertEqual(res["base"], "Flux.1 D")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_text_encoders(self):
        header = {
            "text_model.encoder.layers.0.self_attn.q_proj.weight": {"shape": [768, 768]},
            "__metadata__": {},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "text_encoders")
        self.assertTrue(res["sure"])

    def test_classify_safetensors_embedding(self):
        header = {
            "emb_params": {"shape": [1, 768]},
            "string_to_param": {"*": {"shape": [1, 768]}},
            "__metadata__": {},
        }
        res = classify_safetensors_header(header)
        self.assertEqual(res["kind"], "embeddings")
        self.assertEqual(res["base"], "SD 1.5")
        self.assertTrue(res["sure"])

    def test_classify_gguf_metadata(self):
        flux_meta = {"general.architecture": "flux"}
        res = classify_gguf_metadata(flux_meta)
        self.assertEqual(res["kind"], "diffusion_models")
        self.assertEqual(res["base"], "Flux.1 D")
        self.assertTrue(res["sure"])

        t5_meta = {"general.architecture": "t5"}
        res2 = classify_gguf_metadata(t5_meta)
        self.assertEqual(res2["kind"], "text_encoders")
        self.assertTrue(res2["sure"])

    def test_works_anyway_and_compatibility(self):
        self.assertTrue(is_category_compatible("checkpoints", "diffusion_models"))
        self.assertTrue(is_category_compatible("diffusion_models", "checkpoints"))
        self.assertTrue(is_category_compatible("unet", "diffusion_models"))
        self.assertTrue(is_category_compatible("clip", "text_encoders"))
        self.assertTrue(is_category_compatible("loras", "loras"))
        self.assertFalse(is_category_compatible("checkpoints", "loras"))
        self.assertFalse(is_category_compatible("loras", "checkpoints"))

    def test_check_model_misplacement_detection(self):
        fake_fp = MagicMock()
        checkpoints_dir = os.path.join(self.temp_dir, "models", "checkpoints")
        loras_dir = os.path.join(self.temp_dir, "models", "loras")
        os.makedirs(checkpoints_dir, exist_ok=True)
        os.makedirs(loras_dir, exist_ok=True)

        fake_fp.folder_names_and_paths = {
            "checkpoints": ([checkpoints_dir], {".safetensors"}),
            "loras": ([loras_dir], {".safetensors"}),
        }
        fake_fp.get_folder_paths.side_effect = lambda cat: {
            "checkpoints": [checkpoints_dir],
            "loras": [loras_dir],
        }.get(cat, [])

        # Create a LoRA placed inside checkpoints directory
        misplaced_file = os.path.join(checkpoints_dir, "my_misplaced_lora.safetensors")
        with open(misplaced_file, "wb") as f:
            f.write(b"\x00" * 100)

        with patch("core.model_classifier.classify_model_file") as mock_classify:
            mock_classify.return_value = {
                "kind": "loras",
                "base": "SDXL",
                "sure": True,
                "format": "safetensors",
                "form": "",
            }
            res = check_model_misplacement(
                misplaced_file, current_category="checkpoints", folder_paths_module=fake_fp
            )
            self.assertIsNotNone(res)
            self.assertTrue(res["is_misplaced"])
            self.assertEqual(res["detected_category"], "loras")
            self.assertEqual(res["target_category"], "loras")
            self.assertEqual(res["target_root"], loras_dir)
            self.assertEqual(res["target_path"], os.path.join(loras_dir, "my_misplaced_lora.safetensors"))

    def test_find_model_sidecars_and_hidden_dirs(self):
        model_dir = os.path.join(self.temp_dir, "models", "loras")
        cmr_dir = os.path.join(model_dir, ".cmr")
        os.makedirs(cmr_dir, exist_ok=True)

        model_path = os.path.join(model_dir, "test_model.safetensors")
        with open(model_path, "wb") as f:
            f.write(b"model")

        preview_path = os.path.join(model_dir, "test_model.preview.png")
        with open(preview_path, "wb") as f:
            f.write(b"preview")

        hidden_json_path = os.path.join(cmr_dir, "test_model.cmr.json")
        with open(hidden_json_path, "wb") as f:
            f.write(b"{}")

        sidecars = find_model_sidecars(model_path)
        paths = [s[0] for s in sidecars]
        self.assertIn(preview_path, paths)
        self.assertIn(hidden_json_path, paths)

        # Check shared stem protection: if another model shares stem, beside sidecars stay
        gguf_model = os.path.join(model_dir, "test_model.gguf")
        with open(gguf_model, "wb") as f:
            f.write(b"gguf")

        sidecars_after_shared = find_model_sidecars(model_path)
        beside_sidecars = [s for s in sidecars_after_shared if not s[2]]
        self.assertEqual(len(beside_sidecars), 0)

    def test_move_misplaced_model_relocation(self):
        checkpoints_dir = os.path.join(self.temp_dir, "models", "checkpoints")
        loras_dir = os.path.join(self.temp_dir, "models", "loras")
        os.makedirs(checkpoints_dir, exist_ok=True)
        os.makedirs(loras_dir, exist_ok=True)

        fake_fp = MagicMock()
        fake_fp.folder_names_and_paths = {
            "checkpoints": ([checkpoints_dir], {".safetensors"}),
            "loras": ([loras_dir], {".safetensors"}),
        }
        fake_fp.get_folder_paths.side_effect = lambda cat: {
            "checkpoints": [checkpoints_dir],
            "loras": [loras_dir],
        }.get(cat, [])

        src_model = os.path.join(checkpoints_dir, "style_lora.safetensors")
        with open(src_model, "wb") as f:
            f.write(b"lora data")

        src_preview = os.path.join(checkpoints_dir, "style_lora.preview.png")
        with open(src_preview, "wb") as f:
            f.write(b"preview data")

        cmr_dir = os.path.join(checkpoints_dir, ".cmr")
        os.makedirs(cmr_dir, exist_ok=True)
        src_cmr = os.path.join(cmr_dir, "style_lora.cmr.json")
        with open(src_cmr, "wb") as f:
            f.write(b"{\"custom\": true}")

        res = move_misplaced_model(
            source_path=src_model,
            target_category="loras",
            folder_paths_module=fake_fp,
        )
        self.assertTrue(res["success"])
        expected_dest = os.path.join(loras_dir, "style_lora.safetensors")
        self.assertEqual(res["target_path"], expected_dest)
        self.assertTrue(os.path.isfile(expected_dest))
        self.assertFalse(os.path.exists(src_model))

        # Check preview moved beside destination model
        dest_preview = os.path.join(loras_dir, "style_lora.preview.png")
        self.assertTrue(os.path.isfile(dest_preview))
        self.assertFalse(os.path.exists(src_preview))

        # Check hidden sidecar moved to destination's .cmr
        dest_cmr = os.path.join(loras_dir, ".cmr", "style_lora.cmr.json")
        self.assertTrue(os.path.isfile(dest_cmr))
        self.assertFalse(os.path.exists(src_cmr))

        # Check empty source .cmr directory was cleaned up
        self.assertFalse(os.path.exists(cmr_dir))

    def test_unique_destination_path_collision_avoidance(self):
        target_dir = os.path.join(self.temp_dir, "target")
        os.makedirs(target_dir, exist_ok=True)

        existing = os.path.join(target_dir, "model.safetensors")
        with open(existing, "wb") as f:
            f.write(b"v1")

        p2, stem2 = get_unique_destination_path(target_dir, "model.safetensors")
        self.assertEqual(p2, os.path.join(target_dir, "model (2).safetensors"))
        self.assertEqual(stem2, "model (2)")


if __name__ == "__main__":
    unittest.main()

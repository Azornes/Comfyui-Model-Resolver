"""Regression tests for security, integrity, classification, and workflow fixes on dev."""

import asyncio
import hashlib
import importlib
import json
import os
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    import requests as _requests  # noqa: F401
except ImportError:
    _req = types.ModuleType("requests")
    _req.exceptions = types.SimpleNamespace(RequestException=Exception)
    _req.Session = object
    sys.modules["requests"] = _req

from core import exporter, model_classifier, path_utils
from core.custom_nodes import ast_scanner
from core.download import hf_worker_downloader
from core.services.placement_service import PlacementService
from core.workflow import lora_stack_patch, references


def _build_safetensors_bytes(header_obj: dict, payload_size: int) -> bytes:
    header_bytes = json.dumps(header_obj).encode("utf-8")
    return struct.pack("<Q", len(header_bytes)) + header_bytes + (b"\x00" * payload_size)


class _DummyFolderPaths:
    def __init__(self, root_dir: str, mapping: dict):
        self.base_path = root_dir
        self.folder_names_and_paths = {
            k: (list(v), {".safetensors", ".gguf", ".ckpt"})
            for k, v in mapping.items()
        }
        self.filename_list_cache = {}
        self.cache_helper = {}

    def get_folder_paths(self, category: str):
        entry = self.folder_names_and_paths.get(category)
        return list(entry[0]) if entry else []


class TestDevAuditFixes(unittest.TestCase):
    def test_sd15_lora_with_input_blocks_not_misclassified_as_sdxl(self):
        header = {
            "lora_unet_input_blocks_1_1_transformer_blocks_0_attn2_to_k.lora_down.weight": {
                "dtype": "F16",
                "shape": [16, 768],
                "data_offsets": [0, 100],
            },
            "lora_unet_output_blocks_3_1_transformer_blocks_0_attn2_to_k.lora_down.weight": {
                "dtype": "F16",
                "shape": [16, 768],
                "data_offsets": [100, 200],
            },
        }
        result = model_classifier.classify_safetensors_header(header)
        self.assertEqual(result["kind"], "loras")
        self.assertEqual(result["base"], "SD 1.5")
        self.assertTrue(result["sure"])

    def test_sdxl_lora_with_2048_context_classified_as_sdxl(self):
        header = {
            "lora_unet_input_blocks_4_1_transformer_blocks_0_attn2_to_k.lora_down.weight": {
                "dtype": "F16",
                "shape": [16, 2048],
                "data_offsets": [0, 100],
            }
        }
        result = model_classifier.classify_safetensors_header(header)
        self.assertEqual(result["base"], "SDXL")
        self.assertTrue(result["sure"])

    def test_move_misplaced_model_blocks_subfolder_traversal_and_self_move(self):
        with tempfile.TemporaryDirectory() as tmp:
            ckpt_dir = os.path.join(tmp, "checkpoints")
            lora_dir = os.path.join(tmp, "loras")
            uncreated_diff_dir = os.path.join(tmp, "diffusion_models")
            os.makedirs(ckpt_dir)
            os.makedirs(lora_dir)

            src = os.path.join(ckpt_dir, "demo.safetensors")
            with open(src, "wb") as fh:
                fh.write(b"12345678")

            fp = _DummyFolderPaths(
                tmp,
                {
                    "checkpoints": [ckpt_dir],
                    "loras": [lora_dir],
                    "diffusion_models": [uncreated_diff_dir],
                },
            )

            for bad_sub in ("../../outside", "/tmp/escape", "..\\escape", "a/../../b", "bad\x00sub"):
                with self.assertRaises(ValueError):
                    model_classifier.move_misplaced_model(
                        src, "loras", subfolder=bad_sub, folder_paths_module=fp
                    )

            # Self-move must be a no-op instead of renaming to demo (2).safetensors
            noop = model_classifier.move_misplaced_model(
                src, "checkpoints", subfolder="", folder_paths_module=fp
            )
            self.assertTrue(noop["success"])
            self.assertTrue(noop.get("already_in_place"))
            self.assertTrue(os.path.isfile(src))
            self.assertFalse(os.path.exists(os.path.join(ckpt_dir, "demo (2).safetensors")))

            # Moving into a configured category whose folder does not yet exist creates it
            moved = model_classifier.move_misplaced_model(
                src, "diffusion_models", subfolder="flux", folder_paths_module=fp
            )
            self.assertTrue(moved["success"])
            expected_dest = os.path.join(uncreated_diff_dir, "flux", "demo.safetensors")
            self.assertEqual(moved["target_path"], expected_dest)
            self.assertTrue(os.path.isfile(expected_dest))

    def test_find_model_sidecars_protects_hidden_sidecars_on_stem_collision(self):
        with tempfile.TemporaryDirectory() as tmp:
            m1 = os.path.join(tmp, "shared.safetensors")
            m2 = os.path.join(tmp, "shared.ckpt")
            cmr_dir = os.path.join(tmp, ".cmr")
            os.makedirs(cmr_dir)
            hidden_meta = os.path.join(cmr_dir, "shared.cmr.json")
            beside_meta = os.path.join(tmp, "shared.civitai.info")
            for p in (m1, m2, hidden_meta, beside_meta):
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write("{}")

            # When shared.ckpt coexists, neither beside nor hidden stem-sidecars may be stolen
            self.assertEqual(model_classifier.find_model_sidecars(m1), [])

            os.remove(m2)
            found = model_classifier.find_model_sidecars(m1)
            found_paths = {item[0] for item in found}
            self.assertIn(hidden_meta, found_paths)
            self.assertIn(beside_meta, found_paths)

    def test_placement_service_look_rejects_outside_roots_and_move_handles_type_error(self):
        class _FakeWeb:
            @staticmethod
            def json_response(data, status=200):
                return {"status": status, "data": data}

        class _FakeCtx:
            def require(self, name):
                return asyncio if name == "asyncio" else _FakeWeb

        class _FakeReq:
            def __init__(self, query=None, body=None):
                self.query = query or {}
                self._body = body or {}

            async def json(self):
                return self._body

        svc = PlacementService(_FakeCtx())

        with patch("core.path_utils.is_path_in_configured_model_roots", return_value=False):
            resp = asyncio.run(svc.look_placement(_FakeReq(query={"path": "/etc/passwd"})))
            self.assertEqual(resp["status"], 403)

        bad_move = asyncio.run(svc.move_model(_FakeReq(body={"path": 123, "target_category": "loras"})))
        self.assertEqual(bad_move["status"], 400)

    def test_exporter_markdown_and_search_signatures(self):
        md = exporter.build_model_links_markdown([
            {"name": "///", "url": "https://example.com/a", "directory": "loras"},
            {"name": "sub/demo.safetensors", "url": "https://example.com/demo", "directory": "checkpoints"},
        ])
        self.assertIn("https://github.com/Azornes/Comfyui-Model-Resolver", md)
        self.assertNotIn("darek-k/comfyui-model-resolver", md)

        # Verify find_download_source invokes real provider signatures without TypeError
        fake_match = types.SimpleNamespace(
            download_url="https://example.com/found.safetensors",
            url="https://example.com/page",
            match_mode="exact",
            filename="demo.safetensors",
        )
        with (
            patch("core.sources.civitai.search_civitai_for_file", return_value=None) as p_civ,
            patch("core.sources.civarchive.search_civarchive_for_file", return_value=None) as p_ca,
            patch("core.sources.huggingface.search_huggingface_for_file", return_value=None) as p_hf,
            patch("core.sources.popular.search_popular_models", return_value=[]),
            patch("core.sources.model_list.search_model_list", return_value=fake_match) as p_ml,
        ):
            res = exporter.find_download_source("demo.safetensors", category="loras", sha256="a" * 64)
            self.assertIsNotNone(res)
            self.assertEqual(res["source"], "model_list")
            p_ca.assert_called_once_with("demo.safetensors", sha256="a" * 64)
            p_ml.assert_called_once_with("demo.safetensors", exact_only=True)
            p_civ.assert_called_once_with("demo.safetensors", sha256="a" * 64)
            p_hf.assert_called_once_with("demo.safetensors", sha256="a" * 64)

    def test_check_safetensors_damage_validates_part_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok_part = os.path.join(tmp, "ok.safetensors.part")
            bad_part = os.path.join(tmp, "truncated.safetensors.part")

            header = {"w": {"dtype": "F16", "shape": [4], "data_offsets": [0, 8]}}
            with open(ok_part, "wb") as fh:
                fh.write(_build_safetensors_bytes(header, payload_size=8))
            with open(bad_part, "wb") as fh:
                fh.write(_build_safetensors_bytes(header, payload_size=2))

            self.assertEqual(path_utils.check_safetensors_damage(ok_part), "")
            self.assertEqual(path_utils.check_safetensors_damage(bad_part), "truncated")

    def test_parse_gguf_metadata_handles_scalar_arrays_and_deep_nesting(self):
        # Build valid GGUF v3 header with 2 KV pairs: a large uint32 scalar array + general.architecture
        buf = bytearray(b"GGUF")
        buf += struct.pack("<I", 3)  # version
        buf += struct.pack("<Q", 0)  # tensor_count
        buf += struct.pack("<Q", 2)  # kv_count
        # KV 1: large scalar array (5000 uint32s)
        k1 = b"tokenizer.ggml.token_type"
        buf += struct.pack("<Q", len(k1)) + k1
        buf += struct.pack("<I", 9)  # array
        buf += struct.pack("<I", 4)  # uint32
        buf += struct.pack("<Q", 5000)
        buf += b"\x00\x00\x00\x00" * 5000
        # KV 2: general.architecture = "flux"
        k2 = b"general.architecture"
        v2 = b"flux"
        buf += struct.pack("<Q", len(k2)) + k2
        buf += struct.pack("<I", 8)  # string
        buf += struct.pack("<Q", len(v2)) + v2

        parsed = path_utils.parse_gguf_metadata(bytes(buf))
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.get("general.architecture"), "flux")
        self.assertEqual(len(parsed.get("tokenizer.ggml.token_type", [])), 20)

        # Deeply nested arrays must not raise RecursionError
        nested = bytearray(b"GGUF")
        nested += struct.pack("<I", 3) + struct.pack("<Q", 0) + struct.pack("<Q", 1)
        nested += struct.pack("<Q", 1) + b"x"
        nested += struct.pack("<I", 9)
        for _ in range(10):
            nested += struct.pack("<I", 9) + struct.pack("<Q", 1)
        self.assertIsNone(path_utils.parse_gguf_metadata(bytes(nested)))

    def test_references_keeps_load_lora_when_clip_strength_zero_and_keeps_enabled_duplicate(self):
        # Standard Load LoRA with strength_model=1.0, strength_clip=0.0 MUST stay active!
        node_active = {
            "id": 1,
            "type": "Load LoRA",
            "inputs": [{"name": "model", "link": 1}],
            "outputs": [{"name": "MODEL", "links": [2]}],
            "widgets_values": ["flux_style.safetensors", 1.0, 0.0],
        }
        refs = references.get_node_model_info(node_active)
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].original_path, "flux_style.safetensors")

        # Standard Load LoRA with BOTH strengths == 0.0 IS disabled
        node_zero = {
            "id": 2,
            "type": "Load LoRA",
            "inputs": [{"name": "model", "link": 1}],
            "outputs": [{"name": "MODEL", "links": [2]}],
            "widgets_values": ["disabled_both.safetensors", 0.0, 0.0],
        }
        self.assertEqual(references.get_node_model_info(node_zero), [])

        # Dynamic LoRA stack: slot 0 disabled, slot 1 enabled with SAME filename -> keep slot 1!
        node_stack = {
            "id": 3,
            "type": "LoadLoraModel",
            "inputs": [{"name": "model", "link": 1}],
            "outputs": [{"name": "MODEL", "links": [2]}],
            "widgets_values": [
                "dup.safetensors", 1.0, False,
                "dup.safetensors", 0.8, True,
            ],
        }
        stack_refs = references.get_node_model_info(node_stack)
        self.assertEqual(len(stack_refs), 1)
        self.assertEqual(stack_refs[0].widget_index, 3)

    def test_ast_scanner_preserves_widget_indices_and_node_class_mappings(self):
        with tempfile.TemporaryDirectory() as tmp:
            node_file = os.path.join(tmp, "custom_loader.py")
            with open(node_file, "w", encoding="utf-8") as fh:
                fh.write(
                    "import folder_paths\n"
                    "class MyLoaderImpl:\n"
                    "    @classmethod\n"
                    "    def INPUT_TYPES(cls):\n"
                    "        return {\n"
                    "            'required': {\n"
                    "                'model': ('MODEL',),\n"
                    "                'device': (['cuda', 'cpu'],),\n"
                    "                'ckpt_name': (folder_paths.get_filename_list('checkpoints'),),\n"
                    "                'strength': ('FLOAT', {'default': 1.0}),\n"
                    "                'vae_name': (folder_paths.get_filename_list('vae'),),\n"
                    "            }\n"
                    "        }\n"
                    "NODE_CLASS_MAPPINGS = {'Pretty Custom Loader': MyLoaderImpl}\n"
                )
            scanned = ast_scanner.scan_custom_node_widget_schemas([tmp])
            self.assertIn("MyLoaderImpl", scanned)
            self.assertIn("Pretty Custom Loader", scanned)

            with patch.object(ast_scanner, "get_node_widget_schema_hints", return_value=scanned):
                # Socket 'model' does not shift widget_index:
                # 0 = device (non-model -> None), 1 = ckpt_name -> checkpoints, 2 = strength -> None, 3 = vae_name -> vae
                self.assertIsNone(ast_scanner.resolve_ast_node_widget_category("Pretty Custom Loader", widget_index=0))
                self.assertEqual(
                    ast_scanner.resolve_ast_node_widget_category("Pretty Custom Loader", widget_index=1),
                    "checkpoints",
                )
                self.assertIsNone(ast_scanner.resolve_ast_node_widget_category("Pretty Custom Loader", widget_index=2))
                self.assertEqual(
                    ast_scanner.resolve_ast_node_widget_category("Pretty Custom Loader", widget_index=3),
                    "vae",
                )

    def test_lora_stack_patch_normalizes_separators_and_ignores_none(self):
        class _FakeLoadLoraModel:
            pass

        fake_nls = types.ModuleType("comfy_extras.nodes_lora_stack")
        fake_nls.LoadLoraModel = _FakeLoadLoraModel
        fake_comfy_extras = types.ModuleType("comfy_extras")
        fake_comfy_extras.nodes_lora_stack = fake_nls
        fake_fp = types.ModuleType("folder_paths")
        fake_fp.get_filename_list = lambda folder: [r"SDXL\style.safetensors"]

        with patch.dict(
            sys.modules,
            {
                "comfy_extras": fake_comfy_extras,
                "comfy_extras.nodes_lora_stack": fake_nls,
                "folder_paths": fake_fp,
            },
        ):
            lora_stack_patch.patch_lora_stack_nodes()
            ok = _FakeLoadLoraModel.validate_inputs(
                loras=[
                    {"lora_name": "SDXL/style.safetensors", "strength": 1.0, "enabled": True},
                    {"lora_name": "None", "strength": 1.0, "enabled": True},
                    {"lora_name": "missing.safetensors", "strength": 0.0, "enabled": True},
                    {"lora_name": "missing2.safetensors", "strength": 1.0, "enabled": False},
                ]
            )
            self.assertIs(ok, True)

            bad = _FakeLoadLoraModel.validate_inputs(
                loras=[{"lora_name": "actually_missing.safetensors", "strength": 1.0, "enabled": True}]
            )
            self.assertIsInstance(bad, str)
            self.assertIn("actually_missing.safetensors", bad)


if __name__ == "__main__":
    unittest.main()

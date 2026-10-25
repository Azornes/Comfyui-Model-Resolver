"""Tests for Smart Model Loader Nova [SML2] custom node adapter."""

import json
import unittest

from core.contracts import (
    CustomNodeMetadata,
    ModelReference,
    Resolution,
    ResolvedModel,
)
from core.custom_nodes.registry import (
    get_custom_node_model_adapter,
    get_custom_node_resolution_metadata,
)
from core.custom_nodes.smart_model_loader_nova import (
    ADAPTER_ID,
    CONFIG_WIDGET_INDEX,
    _dump_configuration,
    _load_configuration,
    analyze_references,
    has_potential_reference,
    update_model_path,
)
from core.resolver import get_workflow_hash_info_for_ref
from core.workflow.analysis import analyze_workflow_models
from core.workflow_updater import update_model_path as update_workflow_model_path


class SmartModelLoaderNovaTests(unittest.TestCase):
    def test_adapter_registration(self):
        for node_type in (
            "Smart Model Loader [SML2]",
            "CLIP Loader [SML2]",
            "LoRA Stack [SML2]",
        ):
            with self.subTest(node_type=node_type):
                adapter = get_custom_node_model_adapter(node_type)
                self.assertIsNotNone(adapter)
                self.assertEqual(ADAPTER_ID, adapter.adapter_id)

    def test_load_and_dump_configuration(self):
        raw_dict = {"model": {"kind": "unet"}, "version": 1}
        config, stored_as_string = _load_configuration(raw_dict)
        self.assertFalse(stored_as_string)
        self.assertEqual(raw_dict, config)

        raw_json = '{"version":1,"model":{"kind":"unet"}}'
        config, stored_as_string = _load_configuration(raw_json)
        self.assertTrue(stored_as_string)
        self.assertEqual("unet", config["model"]["kind"])

        dumped = _dump_configuration(config)
        self.assertEqual('{"model":{"kind":"unet"},"version":1}', dumped)

    def test_analyze_references_extracts_all_resource_types(self):
        config = {
            "model": {
                "kind": "unet",
                "resource": {
                    "name": "Qwen/diffusion_model.safetensors",
                    "sha256": "a" * 64,
                },
            },
            "clip": {
                "source": "external",
                "encoders": [
                    {
                        "id": "clip-1",
                        "resource": {
                            "name": "text_encoders/qwen_clip.safetensors",
                            "sha256": "b" * 64,
                        },
                    }
                ],
            },
            "vae": {
                "source": "external",
                "resource": {
                    "name": "vae/qwen_vae.safetensors",
                },
            },
            "loras": {
                "entries": [
                    {
                        "id": "lora-1",
                        "resource": {
                            "name": "loras/detail_slider.safetensors",
                        },
                        "strength": 1.5,
                        "enabled": True,
                    }
                ]
            },
            "version": 1,
        }

        node = {
            "id": 10,
            "type": "Smart Model Loader [SML2]",
            "title": "Smart Loader",
            "widgets_values": [_dump_configuration(config)],
        }

        available = [
            ResolvedModel(
                path="/models/vae/qwen_vae.safetensors",
                filename="qwen_vae.safetensors",
                category="vae",
                relative_path="vae/qwen_vae.safetensors",
            )
        ]

        refs = analyze_references(
            node,
            available_models=available,
            is_active=True,
            get_widget_name_hint=lambda n, idx: "configuration",
        )

        self.assertIsNotNone(refs)
        self.assertEqual(4, len(refs))

        by_cat = {ref.category: ref for ref in refs}

        # 1. Diffusion model
        unet_ref = by_cat["diffusion_models"]
        self.assertEqual("Qwen/diffusion_model.safetensors", unet_ref.original_path)
        self.assertEqual("a" * 64, unet_ref.extra_value("workflow_sha256"))
        self.assertEqual("sml2_configuration", unet_ref.extra_value("hash_lookup_source"))
        self.assertFalse(unet_ref.exists)

        # 2. Text encoder (clip)
        clip_ref = by_cat["text_encoders"]
        self.assertEqual("text_encoders/qwen_clip.safetensors", clip_ref.original_path)
        self.assertEqual("b" * 64, clip_ref.extra_value("workflow_sha256"))

        # 3. VAE (matched from available_models)
        vae_ref = by_cat["vae"]
        self.assertEqual("vae/qwen_vae.safetensors", vae_ref.original_path)
        self.assertTrue(vae_ref.exists)
        self.assertEqual("/models/vae/qwen_vae.safetensors", vae_ref.extra_value("full_path"))

        # 4. LoRA
        lora_ref = by_cat["loras"]
        self.assertEqual("loras/detail_slider.safetensors", lora_ref.original_path)
        self.assertEqual(1.5, lora_ref.extra_value("strength"))
        self.assertTrue(lora_ref.extra_value("active"))

    def test_analyze_references_skips_baked_and_none(self):
        config = {
            "model": {
                "kind": "unet",
                "resource": {"name": "None"},
            },
            "clip": {
                "source": "baked",
                "encoders": [{"resource": {"name": "ignored.safetensors"}}],
            },
            "vae": {
                "source": "baked",
                "resource": {"name": "ignored_vae.safetensors"},
            },
        }
        node = {
            "id": 11,
            "type": "Smart Model Loader [SML2]",
            "widgets_values": [_dump_configuration(config)],
        }
        refs = analyze_references(
            node,
            is_active=True,
            get_widget_name_hint=lambda n, idx: "configuration",
        )
        self.assertEqual([], refs)

    def test_has_potential_reference(self):
        valid_node = {
            "widgets_values": [
                json.dumps({"model": {"resource": {"name": "model.safetensors"}}})
            ]
        }
        empty_node = {
            "widgets_values": [
                json.dumps({"model": {"resource": {"name": "None"}}})
            ]
        }
        invalid_node = {"widgets_values": ["not-json"]}

        self.assertTrue(has_potential_reference(valid_node))
        self.assertFalse(has_potential_reference(empty_node))
        self.assertFalse(has_potential_reference(invalid_node))

    def test_update_model_path_rewrites_resource_and_hash(self):
        config = {
            "model": {
                "kind": "unet",
                "resource": {
                    "name": "AuthorFolder/qwen_unet.safetensors",
                    "sha256": "1" * 64,
                },
            },
            "version": 1,
        }
        node = {
            "id": 12,
            "type": "Smart Model Loader [SML2]",
            "widgets_values": [_dump_configuration(config)],
        }

        resolved = ResolvedModel(
            path="C:/models/diffusion_models/Local/qwen_unet.safetensors",
            filename="qwen_unet.safetensors",
            category="diffusion_models",
            relative_path="Local/qwen_unet.safetensors",
            extra={"sha256": "2" * 64},
        )
        metadata = CustomNodeMetadata(
            adapter_id=ADAPTER_ID,
            original_identity="AuthorFolder/qwen_unet.safetensors",
        )

        success = update_model_path(node, CONFIG_WIDGET_INDEX, resolved, metadata)
        self.assertTrue(success)

        updated_config, is_str = _load_configuration(node["widgets_values"][0])
        self.assertTrue(is_str)
        resource = updated_config["model"]["resource"]
        self.assertEqual("Local/qwen_unet.safetensors", resource["name"])
        self.assertEqual("2" * 64, resource["sha256"])

    def test_update_model_path_removes_stale_hash_when_resolved_lacks_hash(self):
        config = {
            "model": {
                "kind": "unet",
                "resource": {
                    "name": "AuthorFolder/qwen_unet.safetensors",
                    "sha256": "1" * 64,
                },
            },
        }
        node = {
            "id": 13,
            "type": "Smart Model Loader [SML2]",
            "widgets_values": [_dump_configuration(config)],
        }
        resolved = ResolvedModel(
            path="C:/models/diffusion_models/other.safetensors",
            filename="other.safetensors",
            category="diffusion_models",
            relative_path="other.safetensors",
        )
        metadata = CustomNodeMetadata(
            adapter_id=ADAPTER_ID,
            original_identity="AuthorFolder/qwen_unet.safetensors",
        )

        success = update_model_path(node, CONFIG_WIDGET_INDEX, resolved, metadata)
        self.assertTrue(success)

        updated_config, _ = _load_configuration(node["widgets_values"][0])
        resource = updated_config["model"]["resource"]
        self.assertEqual("other.safetensors", resource["name"])
        self.assertNotIn("sha256", resource)

    def test_get_workflow_hash_info_for_ref_custom_node_fallback(self):
        ref = ModelReference.from_mapping(
            {
                "node_id": 14,
                "original_path": "model.safetensors",
                "name": "model.safetensors",
                "workflow_sha256": "c" * 64,
                "hash_lookup_source": "sml2_configuration",
            }
        )

        # 1. With empty workflow_hashes: falls back to node's own hash
        hash_info = get_workflow_hash_info_for_ref({}, ref)
        self.assertIsNotNone(hash_info)
        self.assertEqual("c" * 64, hash_info["sha256"])
        self.assertEqual("sml2_configuration", hash_info["source"])

        # 2. When workflow_hashes has a match, workflow_hashes takes priority
        workflow_hashes = {
            "model.safetensors": {"sha256": "d" * 64, "source": "workflow_metadata"}
        }
        priority_info = get_workflow_hash_info_for_ref(workflow_hashes, ref)
        self.assertEqual("d" * 64, priority_info["sha256"])
        self.assertEqual("workflow_metadata", priority_info["source"])

    def test_workflow_analyzer_and_updater_end_to_end(self):
        """Verify the full pipeline: analyze_workflow_models -> resolution metadata -> update_model_path."""
        config = {
            "model": {
                "kind": "unet",
                "resource": {
                    "name": "Qwen Image/qwen_image_2.1_int8_convrot.safetensors",
                    "sha256": "cb74" * 16,
                },
            },
            "clip": {
                "source": "external",
                "type": "qwen_image",
                "encoders": [
                    {
                        "id": "clip-1",
                        "resource": {
                            "name": "qwen3-vl-8b-heretic-1.3.0_int8_convrot.safetensors",
                            "sha256": "443f" * 16,
                        },
                    }
                ],
            },
            "vae": {
                "source": "external",
                "resource": {
                    "name": "qwen_image_2.1_vae_bf16.safetensors",
                },
            },
            "loras": {
                "entries": [
                    {
                        "id": "lora-1",
                        "resource": {
                            "name": "qwen/Pornmaster_QI2.1_Breasts_Slider_V1.safetensors",
                        },
                        "strength": 5.0,
                    }
                ]
            },
            "version": 1,
        }
        workflow = {
            "nodes": [
                {
                    "id": 42,
                    "type": "Smart Model Loader [SML2]",
                    "widgets_values": [_dump_configuration(config)],
                }
            ]
        }

        # 1. Workflow analyzer extracts references via custom node adapter
        refs = analyze_workflow_models(workflow, available_models=[])
        self.assertEqual(4, len(refs))
        by_cat = {ref.category: ref for ref in refs}

        unet_ref = by_cat["diffusion_models"]
        self.assertEqual(
            "Qwen Image/qwen_image_2.1_int8_convrot.safetensors",
            unet_ref.original_path,
        )
        self.assertEqual(ADAPTER_ID, unet_ref.extra_value("custom_node_adapter"))
        self.assertEqual("cb74" * 16, unet_ref.extra_value("workflow_sha256"))

        # 2. Verify resolution metadata extraction for workflow updater
        metadata = get_custom_node_resolution_metadata(unet_ref)
        self.assertEqual(ADAPTER_ID, metadata.adapter_id)
        self.assertEqual(
            "Qwen Image/qwen_image_2.1_int8_convrot.safetensors",
            metadata.original_identity,
        )

        # 3. Test end-to-end update through core.workflow_updater.update_model_path
        resolution = Resolution(
            node_id=42,
            widget_index=CONFIG_WIDGET_INDEX,
            resolved_path="diffusion_models/qwen_fixed.safetensors",
            category="diffusion_models",
            resolved_model=ResolvedModel(
                path="/models/diffusion_models/qwen_fixed.safetensors",
                filename="qwen_fixed.safetensors",
                category="diffusion_models",
                relative_path="qwen_fixed.safetensors",
                extra={"sha256": "1111" * 16},
            ),
            custom_node_metadata=metadata,
        )
        updated = update_workflow_model_path(workflow, resolution)
        self.assertTrue(updated)

        updated_config, _ = _load_configuration(
            workflow["nodes"][0]["widgets_values"][0]
        )
        res = updated_config["model"]["resource"]
        self.assertEqual("qwen_fixed.safetensors", res["name"])
        self.assertEqual("1111" * 16, res["sha256"])


if __name__ == "__main__":
    unittest.main()

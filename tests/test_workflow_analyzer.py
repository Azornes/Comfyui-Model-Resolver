import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import ANY, patch

from core import resolver as resolver_core
from core.scanner import invalidate_model_files_cache, scan_directory
from core.workflow import analysis, dynamic_widgets, references
from core.workflow.analysis import analyze_workflow_models, identify_missing_models
from core.workflow.dynamic_widgets import get_lora_model_strength
from core.workflow.inventory import (
    get_workflow_model_inventory,
    invalidate_workflow_model_inventory_cache,
)


def _workflow_with_model(model_path):
    return {
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": [model_path],
                "inputs": [],
                "outputs": [],
            }
        ]
    }


class WorkflowAnalyzerCaseSensitivityTests(unittest.TestCase):
    def test_folder_case_mismatch_is_reported_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "QWEN")
            os.makedirs(model_dir)
            model_path = os.path.join(model_dir, "qwen_3_4b.safetensors")
            with open(model_path, "wb"):
                pass

            available_models = [
                {
                    "filename": "qwen_3_4b.safetensors",
                    "path": model_path,
                    "relative_path": r"QWEN\qwen_3_4b.safetensors",
                    "category": "checkpoints",
                    "base_directory": tmpdir,
                }
            ]

            refs = analyze_workflow_models(
                _workflow_with_model(r"Qwen\qwen_3_4b.safetensors"),
                available_models=available_models,
            )
            missing = identify_missing_models(refs, available_models)

            self.assertFalse(refs[0]["exists"])
            self.assertEqual(1, len(missing))
            self.assertEqual(
                r"Qwen\qwen_3_4b.safetensors", missing[0]["original_path"]
            )

    def test_exact_folder_case_is_not_reported_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "QWEN")
            os.makedirs(model_dir)
            model_path = os.path.join(model_dir, "qwen_3_4b.safetensors")
            with open(model_path, "wb"):
                pass

            available_models = [
                {
                    "filename": "qwen_3_4b.safetensors",
                    "path": model_path,
                    "relative_path": r"QWEN\qwen_3_4b.safetensors",
                    "category": "checkpoints",
                    "base_directory": tmpdir,
                }
            ]

            refs = analyze_workflow_models(
                _workflow_with_model(r"QWEN\qwen_3_4b.safetensors"),
                available_models=available_models,
            )
            missing = identify_missing_models(refs, available_models)

            self.assertTrue(refs[0]["exists"])
            self.assertEqual([], missing)


class WorkflowAnalyzerCategoryHintTests(unittest.TestCase):
    def test_choice_info_merge_preserves_source_and_choice_rules(self):
        current = {"source": "folder_paths", "choices": ["A", "B"]}
        incoming = {"source": "static", "choices": ["B", "C"]}
        expected = {
            "source": "hybrid",
            "choices": ["A", "B", "C"],
        }
        target = {"model": current}

        dynamic_widgets._merge_choice_info(target, "model", incoming)

        self.assertEqual(expected, target["model"])
        self.assertEqual(
            expected,
            dynamic_widgets._merge_choice_info_values(current, incoming),
        )
        self.assertEqual(
            current,
            dynamic_widgets._merge_choice_info_values(current, None),
        )

    def test_named_widget_does_not_inherit_conflicting_index_category(self):
        cases = [
            ("easy fullLoader", 7, "resolution", "512 x 512"),
            ("ttN pipeLoader_v2", 8, "negative", "Negative"),
            ("WanVideoVAELoader", 1, "precision", "bf16"),
        ]

        for node_type, widget_index, widget_name, widget_value in cases:
            with self.subTest(node_type=node_type, widget_name=widget_name):
                dynamic_hints = {
                    "widget_names": [widget_name, "vae_name"],
                    "by_name": {"vae_name": ["vae"]},
                    "by_index": {widget_index: ["vae"]},
                    "choice_info_by_name": {},
                    "choice_info_by_index": {
                        widget_index: {"source": "folder_paths", "choices": []}
                    },
                }
                widget_inputs = [
                    {
                        "name": f"widget_{index}",
                        "type": "STRING",
                        "widget": {"name": f"widget_{index}"},
                    }
                    for index in range(widget_index)
                ]
                widget_inputs.append(
                    {
                        "name": widget_name,
                        "type": "STRING",
                        "widget": {"name": widget_name},
                    }
                )
                workflow = {
                    "nodes": [
                        {
                            "id": 500,
                            "type": node_type,
                            "inputs": [
                                {"name": "model_override", "type": "MODEL"},
                                *widget_inputs,
                            ],
                            "widgets_values": [
                                *([""] * widget_index),
                                widget_value,
                            ],
                            "outputs": [],
                        }
                    ]
                }

                with patch(
                    "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
                    return_value=dynamic_hints,
                ):
                    refs = analyze_workflow_models(workflow, available_models=[])

                self.assertEqual([], refs)

    def test_dynamic_sentinel_survives_model_extension_filter(self):
        fake_folder_paths = SimpleNamespace()

        def get_filename_list(category):
            return [f"{category}.safetensors"]

        fake_folder_paths.get_filename_list = get_filename_list

        class FilteredMultiCategoryLoader:
            @classmethod
            def INPUT_TYPES(cls):
                choices = (
                    fake_folder_paths.get_filename_list("checkpoints")
                    + fake_folder_paths.get_filename_list("diffusion_models")
                )
                return {
                    "required": {
                        "model_name": (
                            [
                                choice
                                for choice in choices
                                if choice.endswith((".ckpt", ".safetensors"))
                            ],
                        )
                    }
                }

        with (
            patch.object(
                dynamic_widgets,
                "_get_comfy_node_class",
                return_value=FilteredMultiCategoryLoader,
            ),
            patch.object(
                dynamic_widgets,
                "_get_folder_paths_module",
                return_value=fake_folder_paths,
            ),
        ):
            hints = dynamic_widgets._build_dynamic_node_widget_category_hints(
                "FilteredMultiCategoryLoader"
            )

        self.assertEqual(
            ["checkpoints", "diffusion_models"],
            hints["by_name"]["model_name"],
        )

    def test_control_after_generate_keeps_serialized_widget_indexes_aligned(self):
        fake_folder_paths = SimpleNamespace()

        def get_filename_list(category):
            return [f"{category}.safetensors"]

        fake_folder_paths.get_filename_list = get_filename_list

        class ControlledIndexLoader:
            @classmethod
            def INPUT_TYPES(cls):
                return {
                    "required": {
                        "csv_filename_path": ("STRING", {}),
                        "index": (
                            "INT",
                            {"default": 0, "control_after_generate": True},
                        ),
                        "start_ckpt_name": (
                            fake_folder_paths.get_filename_list("checkpoints"),
                        ),
                        "count": ("INT", {"default": 1}),
                    }
                }

        with (
            patch.object(
                dynamic_widgets,
                "_get_comfy_node_class",
                return_value=ControlledIndexLoader,
            ),
            patch.object(
                dynamic_widgets,
                "_get_folder_paths_module",
                return_value=fake_folder_paths,
            ),
        ):
            hints = dynamic_widgets._build_dynamic_node_widget_category_hints(
                "ControlledIndexLoader"
            )

        self.assertTrue(hints["has_generated_widgets"])
        self.assertEqual(
            {
                0: "csv_filename_path",
                1: "index",
                2: "control_after_generate",
                3: "start_ckpt_name",
                4: "count",
            },
            hints["serialized_name_by_index"],
        )
        self.assertEqual([2], hints["non_model_by_index"])
        self.assertNotIn(2, hints["by_index"])
        self.assertEqual(["checkpoints"], hints["by_index"][3])

    def test_control_after_generate_is_skipped_and_following_model_is_detected(self):
        dynamic_hints = {
            "widget_names": [
                "csv_filename_path",
                "index",
                "start_ckpt_name",
                "count",
            ],
            "by_name": {"start_ckpt_name": ["checkpoints"]},
            "by_index": {3: ["checkpoints"]},
            "serialized_name_by_index": {
                0: "csv_filename_path",
                1: "index",
                2: "control_after_generate",
                3: "start_ckpt_name",
                4: "count",
            },
            "non_model_by_index": [2],
            "has_generated_widgets": True,
            "choice_info_by_name": {
                "start_ckpt_name": {
                    "source": "folder_paths",
                    "choices": [],
                }
            },
            "choice_info_by_index": {
                3: {"source": "folder_paths", "choices": []}
            },
        }
        workflow = {
            "nodes": [
                {
                    "id": 503,
                    "type": "CSV Reader X Checkpoint",
                    "inputs": [
                        {
                            "name": "csv_filename_path",
                            "type": "STRING",
                            "widget": {"name": "csv_filename_path"},
                        },
                        {
                            "name": "index",
                            "type": "INT",
                            "widget": {"name": "index"},
                        },
                        {
                            "name": "start_ckpt_name",
                            "type": "COMBO",
                            "widget": {"name": "start_ckpt_name"},
                        },
                        {
                            "name": "count",
                            "type": "INT",
                            "widget": {"name": "count"},
                        },
                    ],
                    "widgets_values": [
                        "",
                        0,
                        "randomize",
                        r"LTXV\model.safetensors",
                        1,
                    ],
                    "outputs": [],
                }
            ]
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value=dynamic_hints,
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual(3, refs[0]["widget_index"])
        self.assertEqual("start_ckpt_name", refs[0]["widget_name"])
        self.assertEqual(r"LTXV\model.safetensors", refs[0]["original_path"])
        self.assertEqual("checkpoints", refs[0]["category"])

    def test_implicit_seed_control_keeps_following_model_aligned(self):
        dynamic_hints = {
            "widget_names": ["noise_seed", "clip_name", "strength"],
            "by_name": {"clip_name": ["clip_vision"]},
            "by_index": {1: ["clip_vision"]},
            "serialized_name_by_index": {
                0: "noise_seed",
                1: "clip_name",
                2: "strength",
            },
            "non_model_by_index": [],
            "has_generated_widgets": False,
            "choice_info_by_name": {
                "clip_name": {
                    "source": "folder_paths",
                    "choices": [],
                }
            },
            "choice_info_by_index": {
                1: {"source": "folder_paths", "choices": []}
            },
        }
        workflow = {
            "nodes": [
                {
                    "id": 321,
                    "type": "UltraSharkSampler Tiled",
                    "inputs": [
                        {
                            "name": "noise_seed",
                            "type": "INT",
                            "widget": {"name": "noise_seed"},
                        },
                        {
                            "name": "clip_name",
                            "type": "COMBO",
                            "widget": {"name": "clip_name"},
                        },
                        {
                            "name": "strength",
                            "type": "FLOAT",
                            "widget": {"name": "strength"},
                        },
                    ],
                    "widgets_values": [
                        0,
                        "randomize",
                        "clip-vit-large-patch14.safetensors",
                        1.0,
                    ],
                    "outputs": [{"type": "LATENT", "links": []}],
                }
            ]
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value=dynamic_hints,
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual(2, refs[0]["widget_index"])
        self.assertEqual("clip_name", refs[0]["widget_name"])
        self.assertEqual(
            "clip-vit-large-patch14.safetensors",
            refs[0]["original_path"],
        )
        self.assertEqual("clip_vision", refs[0]["category"])
        self.assertFalse(refs[0]["exists"])

    def test_non_model_static_choices_in_hybrid_model_dropdowns_are_skipped(self):
        cases = [
            ("DependenciesEdit", "ckpt_name", "checkpoints", "Original"),
            ("DependenciesEdit", "vae_name", "vae", "Baked VAE"),
            ("easy XYInputs: ModelMergeBlocks", "vae_use", "vae", "Use Model 1"),
            ("RecipeModelPicker", "vae", "vae", "(Default)"),
        ]

        for node_type, widget_name, category, value in cases:
            with self.subTest(node_type=node_type, value=value):
                dynamic_hints = {
                    "widget_names": [widget_name],
                    "by_name": {widget_name: [category]},
                    "by_index": {0: [category]},
                    "serialized_name_by_index": {},
                    "non_model_by_index": [],
                    "has_generated_widgets": False,
                    "choice_info_by_name": {
                        widget_name: {
                            "source": "hybrid",
                            "choices": [value],
                        }
                    },
                    "choice_info_by_index": {
                        0: {"source": "hybrid", "choices": [value]}
                    },
                }
                workflow = {
                    "nodes": [
                        {
                            "id": 504,
                            "type": node_type,
                            "widgets": [{"name": widget_name}],
                            "widgets_values": [value],
                            "outputs": [],
                        }
                    ]
                }

                with patch(
                    "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
                    return_value=dynamic_hints,
                ):
                    refs = analyze_workflow_models(workflow, available_models=[])

                self.assertEqual([], refs)

    def test_res4lyf_placeholders_are_not_model_references(self):
        category_by_index = {
            0: ["checkpoints", "diffusion_models"],
            1: [],
            2: ["text_encoders"],
            3: ["text_encoders"],
            4: ["vae"],
            5: ["clip_vision"],
            6: ["style_models"],
        }
        workflow = {
            "nodes": [
                {
                    "id": 501,
                    "type": "FluxLoader",
                    "widgets": [
                        {"name": "model_name"},
                        {"name": "weight_dtype"},
                        {"name": "clip_name1"},
                        {"name": "clip_name2_opt"},
                        {"name": "vae_name"},
                        {"name": "clip_vision_name"},
                        {"name": "style_model_name"},
                    ],
                    "widgets_values": [
                        ".none",
                        "default",
                        ".use_ckpt_clip",
                        ".none",
                        ".use_ckpt_vae",
                        ".none",
                        ".none",
                    ],
                    "outputs": [
                        {"type": "MODEL", "links": []},
                        {"type": "CLIP", "links": []},
                        {"type": "VAE", "links": []},
                        {"type": "CLIP_VISION", "links": []},
                        {"type": "STYLE_MODEL", "links": []},
                    ],
                }
            ]
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_widget_category_hints",
            side_effect=lambda _node, index: category_by_index[index],
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_ambiguous_model_outputs_do_not_override_widget_name_category(self):
        workflow = {
            "nodes": [
                {
                    "id": 502,
                    "type": "FluxLoader",
                    "widgets": [{"name": "model_name"}],
                    "widgets_values": ["flux.safetensors"],
                    "outputs": [
                        {"type": "CLIP_VISION", "links": []},
                        {"type": "STYLE_MODEL", "links": []},
                    ],
                }
            ]
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_widget_category_hints",
            return_value=[],
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("diffusion_models", refs[0]["category"])

    def test_show_anything_cached_model_text_is_not_a_model_reference(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "KREA2")
            os.makedirs(model_dir)
            model_path = os.path.join(
                model_dir, "krea2_turbo_fp8_scaled.safetensors"
            )
            with open(model_path, "wb"):
                pass

            workflow = {
                "nodes": [
                    {
                        "id": 141,
                        "type": "easy showAnything",
                        "title": "Diffusion model",
                        "inputs": [{"name": "anything", "type": "*", "link": 700}],
                        "outputs": [{"name": "output", "type": "*", "links": []}],
                        "widgets": [{"name": "text"}],
                        "widgets_values": [
                            r"KREA2\krea2_turbo_fp8_scaled.safetensors"
                        ],
                    }
                ]
            }
            available_models = [
                {
                    "filename": "krea2_turbo_fp8_scaled.safetensors",
                    "path": model_path,
                    "relative_path": r"KREA2\krea2_turbo_fp8_scaled.safetensors",
                    "category": "diffusion_models",
                    "base_directory": tmpdir,
                }
            ]

            refs = analyze_workflow_models(
                workflow, available_models=available_models
            )

            self.assertEqual([], refs)

    def test_model_like_widget_name_keeps_custom_model_reference_detection(self):
        workflow = {
            "nodes": [
                {
                    "id": 199,
                    "type": "CustomModelSelector",
                    "widgets": [{"name": "filename"}],
                    "widgets_values": ["custom_model.safetensors"],
                    "outputs": [],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("custom_model.safetensors", refs[0]["original_path"])

    def test_set_node_model_slot_name_does_not_turn_constant_into_model(self):
        workflow = {
            "nodes": [
                {
                    "id": 3,
                    "type": "SetNode",
                    "title": "Set_MODEL_BASE",
                    "inputs": [{"name": "MODEL", "type": "MODEL", "link": 701}],
                    "outputs": [{"name": "MODEL", "type": "MODEL", "links": []}],
                    "widgets": [{"name": "Constant"}],
                    "widgets_values": ["MODEL_BASE"],
                },
                {
                    "id": 19,
                    "type": "SetNode",
                    "title": "Set_MODEL_LORA",
                    "inputs": [{"name": "MODEL", "type": "MODEL", "link": 702}],
                    "outputs": [{"name": "MODEL", "type": "MODEL", "links": []}],
                    "widgets": [{"name": "Constant"}],
                    "widgets_values": ["MODEL_LORA"],
                },
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_model_slot_does_not_turn_device_widget_into_model(self):
        workflow = {
            "nodes": [
                {
                    "id": 104,
                    "type": "CustomVideoUpscaler",
                    "inputs": [
                        {"name": "model", "type": "MODEL", "link": 703},
                        {
                            "name": "offload_device",
                            "type": "COMBO",
                            "widget": {"name": "offload_device"},
                        },
                    ],
                    "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
                    "widgets": [{"name": "offload_device"}],
                    "widgets_values": ["cuda:0"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_filename_widget_template_without_model_extension_is_ignored(self):
        workflow = {
            "nodes": [
                {
                    "id": 155,
                    "type": "Image Saver",
                    "widgets": [{"name": "filename"}],
                    "widgets_values": ["Krea2_%time_%seed"],
                    "outputs": [],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_model_name_string_used_as_metadata_query_is_ignored(self):
        workflow = {
            "nodes": [
                {
                    "id": 153,
                    "type": "Civitai Hash Fetcher (Image Saver)",
                    "inputs": [
                        {
                            "name": "username",
                            "type": "STRING",
                            "widget": {"name": "username"},
                        },
                        {
                            "name": "model_name",
                            "type": "STRING",
                            "widget": {"name": "model_name"},
                        },
                        {
                            "name": "version",
                            "type": "STRING",
                            "widget": {"name": "version"},
                        },
                    ],
                    "outputs": [{"name": "STRING", "type": "STRING", "links": []}],
                    "widgets_values": [
                        "latentheart",
                        (
                            "Krea2 [SFW / NSFW] Uncensored - Image-to-Prompt + "
                            "Prompt Enhancer + 4K Upscaler + CivitAI Metadata"
                        ),
                        "",
                    ],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_upscale_model_loader_widget_named_model_name_stays_upscale(self):
        workflow = {
            "nodes": [
                {
                    "id": 200,
                    "type": "UpscaleModelLoader",
                    "inputs": [],
                    "outputs": [
                        {
                            "name": "UPSCALE_MODEL",
                            "type": "UPSCALE_MODEL",
                            "links": [770],
                        }
                    ],
                    "widgets": [{"name": "model_name"}],
                    "widgets_values": ["4x_NMKD-Siax_200k.pth"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("upscale_models", refs[0]["category"])

    def test_upscale_output_hint_does_not_mark_every_text_widget_as_model(self):
        workflow = {
            "nodes": [
                {
                    "id": 201,
                    "type": "CustomUpscaleLoader",
                    "outputs": [{"type": "UPSCALE_MODEL", "links": [771]}],
                    "widgets": [{"name": "model_name"}, {"name": "mode"}],
                    "widgets_values": ["4x_NMKD-Siax_200k.pth", "nearest"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("4x_NMKD-Siax_200k.pth", refs[0]["original_path"])
        self.assertEqual("upscale_models", refs[0]["category"])

    def test_impact_sam_loader_uses_sams_category(self):
        workflow = {
            "nodes": [
                {
                    "id": 168,
                    "type": "SAMLoader",
                    "title": "SAMLoader",
                    "outputs": [{"type": "SAM_MODEL", "links": [590]}],
                    "widgets": [{"name": "model_name"}],
                    "widgets_values": ["sam_vit_b_01ec64.pth"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("sam_vit_b_01ec64.pth", refs[0]["original_path"])
        self.assertEqual("sams", refs[0]["category"])

    def test_impact_sam_loader_esam_option_is_not_missing_model(self):
        workflow = {
            "nodes": [
                {
                    "id": 168,
                    "type": "SAMLoader",
                    "title": "SAMLoader",
                    "outputs": [{"type": "SAM_MODEL", "links": [590]}],
                    "widgets": [{"name": "model_name"}],
                    "widgets_values": ["ESAM"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual([], refs)

    def test_impact_ultralytics_detector_provider_uses_ultralytics_category(self):
        workflow = {
            "nodes": [
                {
                    "id": 167,
                    "type": "UltralyticsDetectorProvider",
                    "title": "SEGM Detector",
                    "outputs": [
                        {"name": "BBOX_DETECTOR", "type": "BBOX_DETECTOR", "links": []},
                        {"name": "SEGM_DETECTOR", "type": "SEGM_DETECTOR", "links": [590]},
                    ],
                    "widgets": [{"name": "model_name"}],
                    "widgets_values": ["segm/person_yolov8m-seg.pt"],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("segm/person_yolov8m-seg.pt", refs[0]["original_path"])
        self.assertEqual("ultralytics", refs[0]["category"])

    def test_core_extra_loader_categories_match_comfyui_folder_paths(self):
        cases = [
            ("DiffusersLoader", ["wan_diffusers"], [{"name": "model_path"}], "diffusers"),
            ("GLIGENLoader", ["gligen.safetensors"], [{"name": "gligen_name"}], "gligen"),
            ("AudioEncoderLoader", ["audio_encoder.safetensors"], [{"name": "audio_encoder_name"}], "audio_encoders"),
            ("LoadBackgroundRemovalModel", ["birefnet.pth"], [{"name": "bg_removal_name"}], "background_removal"),
            ("LoadDA3Model", ["depth_anything_3.pth", "default"], [{"name": "model_name"}, {"name": "weight_dtype"}], "geometry_estimation"),
            ("FrameInterpolationModelLoader", ["rife.pth"], [{"name": "model_name"}], "frame_interpolation"),
            ("LoadMediaPipeFaceLandmarker", ["face_landmarker.pth"], [{"name": "model_name"}], "detection"),
            ("ModelPatchLoader", ["qwen_patch.safetensors"], [{"name": "name"}], "model_patches"),
            ("LoadMoGeModel", ["moge.safetensors"], [{"name": "model_name"}], "geometry_estimation"),
            ("PhotoMakerLoader", ["photomaker.bin"], [{"name": "photomaker_model_name"}], "photomaker"),
            ("OpticalFlowLoader", ["raft_large.pth"], [{"name": "model_name"}], "optical_flow"),
        ]

        for node_type, widget_values, widgets, expected_category in cases:
            with self.subTest(node_type=node_type):
                refs = analyze_workflow_models(
                    {
                        "nodes": [
                            {
                                "id": 300,
                                "type": node_type,
                                "widgets": widgets,
                                "widgets_values": widget_values,
                                "outputs": [{"links": [1]}],
                            }
                        ]
                    },
                    available_models=[],
                )

                self.assertEqual(1, len(refs))
                self.assertEqual(expected_category, refs[0]["category"])

    def test_multi_clip_loader_indexes_are_text_encoders(self):
        refs = analyze_workflow_models(
            {
                "nodes": [
                    {
                        "id": 301,
                        "type": "QuadrupleCLIPLoader",
                        "widgets_values": [
                            "clip_l.safetensors",
                            "clip_g.safetensors",
                            "t5xxl.safetensors",
                            "llama.safetensors",
                        ],
                        "outputs": [{"links": [1]}],
                    }
                ]
            },
            available_models=[],
        )

        self.assertEqual(4, len(refs))
        self.assertEqual({"text_encoders"}, {ref["category"] for ref in refs})

    def test_gguf_unet_loader_keeps_diffusion_badge_and_raw_folder_hint(self):
        for node_type in (
            "LoaderGGUF",
            "LoaderGGUFAdvanced",
            "UnetLoaderGGUF",
            "UnetLoaderGGUFAdvanced",
        ):
            with self.subTest(node_type=node_type):
                with patch(
                    "core.workflow.dynamic_widgets.get_dynamic_widget_category_hints",
                    return_value=["model_gguf"],
                ):
                    refs = analyze_workflow_models(
                        {
                            "nodes": [
                                {
                                    "id": 345,
                                    "type": node_type,
                                    "widgets": [{"name": "gguf_name"}],
                                    "widgets_values": [
                                        r"LTXV\LTX-2.3-22B-distilled-1.1-Q4_K_M.gguf"
                                    ],
                                    "outputs": [{"type": "MODEL", "links": [1]}],
                                }
                            ]
                        },
                        available_models=[],
                    )

                self.assertEqual(1, len(refs))
                self.assertEqual("diffusion_models", refs[0]["category"])
                self.assertEqual(["diffusion_models"], refs[0]["category_hints"])
                self.assertEqual(["model_gguf"], refs[0]["folder_key_hints"])

    def test_gguf_loader_resolves_scanner_category_alias(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_path = os.path.join(tmpdir, "flux1-fill-dev-Q4_K_S.gguf")
            with open(model_path, "wb"):
                pass

            available_models = [
                {
                    "filename": "flux1-fill-dev-Q4_K_S.gguf",
                    "path": model_path,
                    "relative_path": r"FLUX\FILL\flux1-fill-dev-Q4_K_S.gguf",
                    "category": "model_gguf",
                    "base_directory": tmpdir,
                }
            ]
            workflow = {
                "nodes": [
                    {
                        "id": 346,
                        "type": "LoaderGGUF",
                        "widgets": [{"name": "gguf_name"}],
                        "widgets_values": [
                            r"FLUX\FILL\flux1-fill-dev-Q4_K_S.gguf"
                        ],
                        "outputs": [{"type": "MODEL", "links": [1]}],
                    }
                ]
            }

            with patch(
                "core.workflow.dynamic_widgets.get_dynamic_widget_category_hints",
                return_value=["model_gguf"],
            ):
                refs = analyze_workflow_models(
                    workflow,
                    available_models=available_models,
                )

        self.assertEqual(1, len(refs))
        self.assertTrue(refs[0]["exists"])
        self.assertEqual(model_path, refs[0]["full_path"])
        self.assertEqual("diffusion_models", refs[0]["category"])


class ScannerFolderModelTests(unittest.TestCase):
    def test_diffusers_folder_models_are_scanned_as_folder_entries(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = os.path.join(tmpdir, "wan_diffusers")
            os.makedirs(model_dir)
            with open(os.path.join(model_dir, "model_index.json"), "w", encoding="utf-8") as handle:
                handle.write("{}")
            ignored_dir = os.path.join(tmpdir, "not_a_diffusers_model")
            os.makedirs(ignored_dir)

            models = scan_directory(tmpdir, {"folder"}, "diffusers")

            self.assertEqual(1, len(models))
            self.assertEqual("wan_diffusers", models[0]["relative_path"])
            self.assertEqual(model_dir, models[0]["path"])


class WorkflowCategoryHintsTests(unittest.TestCase):
    def test_non_model_config_widget_does_not_hide_checkpoint_widget(self):
        workflow = {
            "nodes": [
                {
                    "id": 470,
                    "type": "CheckpointLoader",
                    "widgets": [
                        {"name": "config_name"},
                        {"name": "ckpt_name"},
                    ],
                    "widgets_values": [
                        "v1-inference.yaml",
                        "model.safetensors",
                    ],
                    "outputs": [{"type": "MODEL", "links": [1]}],
                }
            ]
        }

        def dynamic_category_hints(_node, widget_index):
            if widget_index == 0:
                return ["configs"]
            return ["checkpoints"]

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_widget_category_hints",
            side_effect=dynamic_category_hints,
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("model.safetensors", refs[0]["original_path"])
        self.assertEqual("checkpoints", refs[0]["category"])

    def test_node_type_to_category_hints_is_populated(self):
        from core.workflow.widgets import NODE_TYPE_TO_CATEGORY_HINTS
        # Verify standard loader mappings are correctly generated
        self.assertEqual("checkpoints", NODE_TYPE_TO_CATEGORY_HINTS.get("CheckpointLoaderSimple"))
        self.assertEqual("checkpoints", NODE_TYPE_TO_CATEGORY_HINTS.get("CheckpointLoader"))
        self.assertEqual("diffusion_models", NODE_TYPE_TO_CATEGORY_HINTS.get("UNETLoader"))
        self.assertEqual("loras", NODE_TYPE_TO_CATEGORY_HINTS.get("LoraLoader"))
        self.assertEqual("text_encoders", NODE_TYPE_TO_CATEGORY_HINTS.get("CLIPLoader"))
        # Verify custom fallbacks are also correctly populated
        self.assertEqual("loras", NODE_TYPE_TO_CATEGORY_HINTS.get("LoraLoaderV2"))


class WorkflowLoraStrengthTests(unittest.TestCase):
    @staticmethod
    def _easy_lora_stack_hints():
        return {
            "serialized_name_by_index": {
                0: "toggle",
                1: "mode",
                2: "num_loras",
                3: "lora_1_name",
                4: "lora_1_strength",
                5: "lora_1_model_strength",
                6: "lora_1_clip_strength",
                7: "lora_2_name",
                8: "lora_2_strength",
                9: "lora_2_model_strength",
                10: "lora_2_clip_strength",
            },
            "non_model_by_index": [],
            "has_generated_widgets": False,
        }

    def test_bypass_loader_uses_strength_model_from_dynamic_schema(self):
        node = {
            "type": "LoraLoaderBypass",
            "widgets_values": [
                r"Anima\anime\AnimeEditV2.safetensors",
                0.65,
                0.4,
            ],
        }
        hints = {
            "serialized_name_by_index": {
                0: "lora_name",
                1: "strength_model",
                2: "strength_clip",
            },
            "non_model_by_index": [],
            "has_generated_widgets": False,
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value=hints,
        ):
            strength = get_lora_model_strength(node, 0)

        self.assertEqual(0.65, strength)

    def test_custom_loader_supports_lora_model_strength_widget(self):
        node = {
            "type": "easy fullLoader",
            "inputs": [
                {"name": "model", "type": "MODEL"},
                {"name": "lora_name", "widget": {"name": "lora_name"}},
                {
                    "name": "lora_model_strength",
                    "widget": {"name": "lora_model_strength"},
                },
                {
                    "name": "lora_clip_strength",
                    "widget": {"name": "lora_clip_strength"},
                },
            ],
            "widgets_values": ["style.safetensors", 0.8, 0.3],
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value={},
        ):
            strength = get_lora_model_strength(node, 0)

        self.assertEqual(0.8, strength)

    def test_bypass_loader_keeps_legacy_next_widget_fallback(self):
        node = {
            "type": "LoraLoaderBypass",
            "widgets_values": ["style.safetensors", "1.25", 0.5],
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value={},
        ):
            strength = get_lora_model_strength(node, 0)

        self.assertEqual(1.25, strength)

    def test_easy_lora_stack_simple_mode_uses_matching_indexed_strength(self):
        node = {
            "type": "easy loraStack",
            "widgets_values": [
                True,
                "simple",
                2,
                "first.safetensors",
                0.7,
                0.2,
                0.3,
                "second.safetensors",
                1.1,
                1.2,
                1.3,
            ],
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value=self._easy_lora_stack_hints(),
        ):
            first_strength = get_lora_model_strength(node, 3)
            second_strength = get_lora_model_strength(node, 7)

        self.assertEqual(0.7, first_strength)
        self.assertEqual(1.1, second_strength)

    def test_easy_lora_stack_advanced_mode_uses_model_strength(self):
        node = {
            "type": "easy loraStack",
            "widgets_values": [
                True,
                "advanced",
                1,
                "style.safetensors",
                0.7,
                0.45,
                0.25,
            ],
        }

        with patch(
            "core.workflow.dynamic_widgets.get_dynamic_node_widget_category_hints",
            return_value=self._easy_lora_stack_hints(),
        ):
            strength = get_lora_model_strength(node, 3)

        self.assertEqual(0.45, strength)


class WorkflowCustomNodeAdapterTests(unittest.TestCase):
    def test_lora_manager_list_is_extracted_by_adapter(self):
        workflow = {
            "nodes": [
                {
                    "id": 390,
                    "type": "Lora Loader (LoraManager)",
                    "widgets_values": [
                        {"version": 1, "textWidgetName": "text"},
                        "<lora:missing_style:0.65>",
                        [
                            {
                                "name": "missing_style",
                                "strength": 0.65,
                                "active": True,
                            }
                        ],
                    ],
                }
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("lora-manager", refs[0]["custom_node_adapter"])
        self.assertEqual("missing_style", refs[0]["original_path"])
        self.assertEqual(0.65, refs[0]["strength"])
        self.assertTrue(refs[0]["active"])


class WorkflowMissingReferenceGroupingTests(unittest.TestCase):
    def test_power_lora_duplicate_missing_tracks_all_node_refs(self):
        workflow = {
            "nodes": [
                {
                    "id": 401,
                    "type": "Power Lora Loader (rgthree)",
                    "widgets_values": [
                        {"on": True, "lora": "missing_style.safetensors", "strength": 1.0}
                    ],
                },
                {
                    "id": 402,
                    "type": "Power Lora Loader (rgthree)",
                    "widgets_values": [
                        {"on": True, "lora": "missing_style.safetensors", "strength": 0.5}
                    ],
                },
            ]
        }

        refs = analyze_workflow_models(workflow, available_models=[])
        missing = identify_missing_models(refs, [])

        self.assertEqual(2, len(refs))
        self.assertEqual(
            ["rgthree-power-lora-loader", "rgthree-power-lora-loader"],
            [ref["custom_node_adapter"] for ref in refs],
        )
        self.assertEqual(1, len(missing))
        self.assertEqual(2, missing[0]["reference_count"])
        self.assertEqual(
            [401, 402],
            [ref["node_id"] for ref in missing[0]["all_node_refs"]],
        )
        self.assertEqual(
            ["lora", "lora"],
            [ref["nested_key"] for ref in missing[0]["all_node_refs"]],
        )

    def test_same_filename_different_categories_are_not_merged(self):
        refs = [
            {
                "node_id": 501,
                "widget_index": 0,
                "original_path": "shared_name.safetensors",
                "category": "checkpoints",
                "exists": False,
            },
            {
                "node_id": 502,
                "widget_index": 0,
                "original_path": "shared_name.safetensors",
                "category": "loras",
                "exists": False,
            },
        ]

        missing = identify_missing_models(refs, [])

        self.assertEqual(2, len(missing))
        self.assertEqual(
            {"checkpoints", "loras"},
            {item["category"] for item in missing},
        )


class WorkflowResolverMatchingTests(unittest.TestCase):
    def test_missing_model_matches_keep_highest_confidence_for_same_path(self):
        shared_path = os.path.join(os.getcwd(), "models", "shared.safetensors")
        matches = [
            {
                "model": {
                    "path": shared_path,
                    "relative_path": "models/shared.safetensors",
                },
                "filename": "shared.safetensors",
                "confidence": 0.35,
            },
            {
                "model": {
                    "path": shared_path,
                    "relative_path": "models/shared.safetensors",
                },
                "filename": "shared.safetensors",
                "confidence": 0.88,
            },
        ]
        workflow_ref = {
            "node_id": 1,
            "node_type": "CheckpointLoaderSimple",
            "widget_index": 0,
            "original_path": "shared.safetensors",
            "category": "checkpoints",
            "exists": False,
        }

        with (
            patch.object(
                resolver_core,
                "get_workflow_model_inventory",
                return_value={
                    "available_models": [],
                    "model_refs": [workflow_ref],
                },
            ),
            patch.object(resolver_core, "find_matches", return_value=matches),
            patch.object(resolver_core, "_get_active_downloads_by_path", return_value={}),
        ):
            result = resolver_core.analyze_and_find_matches(
                _workflow_with_model("shared.safetensors")
            )

        self.assertEqual(
            [match["confidence"] for match in result["missing_models"][0]["matches"]],
            [0.88],
        )

    def test_resolved_models_skip_redundant_fuzzy_matching(self):
        workflow = _workflow_with_model("existing.safetensors")
        resolved_ref = {
            "node_id": 1,
            "node_type": "CheckpointLoaderSimple",
            "widget_index": 0,
            "original_path": "existing.safetensors",
            "category": "checkpoints",
            "exists": True,
            "full_path": r"E:\models\existing.safetensors",
        }
        available_models = [
            {
                "filename": "existing.safetensors",
                "relative_path": "existing.safetensors",
                "path": resolved_ref["full_path"],
                "category": "checkpoints",
            }
        ]
        progress = []

        with (
            patch.object(
                resolver_core,
                "get_workflow_model_inventory",
                return_value={
                    "available_models": available_models,
                    "model_refs": [resolved_ref],
                },
            ),
            patch.object(resolver_core, "find_matches") as find_matches,
        ):
            result = resolver_core.analyze_and_find_matches(
                workflow,
                progress_callback=progress.append,
            )

        find_matches.assert_not_called()
        self.assertEqual(1, result["total_resolved"])
        self.assertEqual([], result["resolved_models"][0]["matches"])
        self.assertFalse(
            any(
                "Analyzing resolved model" in str(update.get("message") or "")
                for update in progress
            )
        )


class WorkflowModelInventoryCacheTests(unittest.TestCase):
    def setUp(self):
        invalidate_workflow_model_inventory_cache()

    def tearDown(self):
        invalidate_workflow_model_inventory_cache()

    def test_unchanged_workflow_reuses_shared_inventory(self):
        workflow = _workflow_with_model("shared.safetensors")
        available_models = [{"filename": "shared.safetensors"}]
        model_refs = [{"original_path": "shared.safetensors", "exists": True}]

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=available_models,
            ) as get_models,
            patch.object(
                analysis,
                "analyze_workflow_models",
                return_value=model_refs,
            ) as analyze_models,
        ):
            first = get_workflow_model_inventory(workflow)
            second = get_workflow_model_inventory({"nodes": workflow["nodes"]})

        self.assertIs(first["available_models"], available_models)
        self.assertIs(second["model_refs"], model_refs)
        get_models.assert_called_once_with(force_rescan=False)
        analyze_models.assert_called_once_with(
            workflow,
            available_models=available_models,
            progress_callback=None,
            analysis_context=ANY,
        )
        self.assertTrue(
            analyze_models.call_args.kwargs["analysis_context"].startswith(
                "workflow_signature="
            )
        )

    def test_force_rescan_rebuilds_shared_inventory(self):
        workflow = _workflow_with_model("forced.safetensors")

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ) as get_models,
            patch.object(
                analysis,
                "analyze_workflow_models",
                return_value=[],
            ) as analyze_models,
        ):
            get_workflow_model_inventory(workflow)
            get_workflow_model_inventory(workflow, force_rescan=True)

        self.assertEqual(2, get_models.call_count)
        self.assertEqual(
            {"force_rescan": True},
            get_models.call_args_list[-1].kwargs,
        )
        self.assertEqual(2, analyze_models.call_count)

    def test_node_layout_changes_reuse_shared_inventory(self):
        workflow = _workflow_with_model("moved.safetensors")
        workflow["nodes"][0]["pos"] = [10, 20]
        moved_workflow = _workflow_with_model("moved.safetensors")
        moved_workflow["nodes"][0]["pos"] = [300, 500]
        moved_workflow["nodes"][0]["size"] = [420, 180]

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                analysis,
                "analyze_workflow_models",
                return_value=[],
            ) as analyze_models,
        ):
            get_workflow_model_inventory(workflow)
            get_workflow_model_inventory(moved_workflow)

        analyze_models.assert_called_once()

    def test_model_selection_change_rebuilds_shared_inventory(self):
        first_workflow = _workflow_with_model("first.safetensors")
        second_workflow = _workflow_with_model("second.safetensors")

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                analysis,
                "analyze_workflow_models",
                return_value=[],
            ) as analyze_models,
        ):
            get_workflow_model_inventory(first_workflow)
            get_workflow_model_inventory(second_workflow)

        self.assertEqual(2, analyze_models.call_count)

    def test_only_changed_loader_is_reanalyzed(self):
        first_workflow = {
            "nodes": [
                _workflow_with_model("first.safetensors")["nodes"][0],
                {
                    **_workflow_with_model("unchanged.safetensors")["nodes"][0],
                    "id": 2,
                },
            ]
        }
        second_workflow = {
            "nodes": [
                _workflow_with_model("second.safetensors")["nodes"][0],
                {
                    **_workflow_with_model("unchanged.safetensors")["nodes"][0],
                    "id": 2,
                },
            ]
        }

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                references,
                "get_node_model_info",
                wraps=references.get_node_model_info,
            ) as get_node_info,
        ):
            get_workflow_model_inventory(first_workflow)
            result = get_workflow_model_inventory(second_workflow)

        self.assertEqual(3, get_node_info.call_count)
        self.assertEqual(
            {"second.safetensors", "unchanged.safetensors"},
            {ref["original_path"] for ref in result["model_refs"]},
        )

    def test_changed_loader_keeps_previous_result_position(self):
        first_workflow = {
            "nodes": [
                {
                    **_workflow_with_model("first.safetensors")["nodes"][0],
                    "id": 1,
                },
                {
                    **_workflow_with_model("middle.safetensors")["nodes"][0],
                    "id": 2,
                },
                {
                    **_workflow_with_model("last.safetensors")["nodes"][0],
                    "id": 3,
                },
            ]
        }
        second_workflow = {
            "nodes": [
                first_workflow["nodes"][0],
                first_workflow["nodes"][2],
                {
                    **_workflow_with_model("middle-updated.safetensors")["nodes"][0],
                    "id": 2,
                },
            ]
        }

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                references,
                "get_node_model_info",
                wraps=references.get_node_model_info,
            ) as get_node_info,
        ):
            get_workflow_model_inventory(first_workflow)
            result = get_workflow_model_inventory(second_workflow)

        self.assertEqual(4, get_node_info.call_count)
        self.assertEqual(
            [
                "first.safetensors",
                "middle-updated.safetensors",
                "last.safetensors",
            ],
            [ref["original_path"] for ref in result["model_refs"]],
        )

    def test_new_loader_does_not_reanalyze_existing_loader(self):
        first_workflow = _workflow_with_model("existing.safetensors")
        second_workflow = {
            "nodes": [
                first_workflow["nodes"][0],
                {
                    **_workflow_with_model("new.safetensors")["nodes"][0],
                    "id": 2,
                },
            ]
        }

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                references,
                "get_node_model_info",
                wraps=references.get_node_model_info,
            ) as get_node_info,
        ):
            get_workflow_model_inventory(first_workflow)
            get_workflow_model_inventory(second_workflow)

        self.assertEqual(2, get_node_info.call_count)

    def test_promoted_widget_context_change_uses_full_analysis(self):
        def build_workflow(promoted_value):
            return {
                "nodes": [
                    {
                        "id": 1,
                        "type": "subgraph-1",
                        "widgets_values": [promoted_value],
                        "properties": {
                            "proxyWidgets": [["10", "ckpt_name"]],
                        },
                        "inputs": [],
                        "outputs": [],
                    },
                    {
                        **_workflow_with_model("top.safetensors")["nodes"][0],
                        "id": 2,
                    },
                ],
                "definitions": {
                    "subgraphs": [
                        {
                            "id": "subgraph-1",
                            "name": "Promoted loader",
                            "inputs": [],
                            "nodes": [
                                {
                                    **_workflow_with_model(
                                        "inner.safetensors"
                                    )["nodes"][0],
                                    "id": 10,
                                    "inputs": [
                                        {
                                            "name": "ckpt_name",
                                            "widget": {
                                                "name": "ckpt_name",
                                            },
                                            "link": None,
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                },
            }

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                references,
                "get_node_model_info",
                wraps=references.get_node_model_info,
            ) as get_node_info,
        ):
            get_workflow_model_inventory(
                build_workflow("first.safetensors")
            )
            get_workflow_model_inventory(
                build_workflow("second.safetensors")
            )

        self.assertEqual(6, get_node_info.call_count)

    def test_inner_subgraph_model_change_reuses_unchanged_nodes(self):
        def build_workflow(inner_value):
            return {
                "nodes": [
                    {
                        "id": 1,
                        "type": "subgraph-1",
                        "widgets_values": [],
                        "properties": {},
                        "inputs": [],
                        "outputs": [],
                    }
                ],
                "definitions": {
                    "subgraphs": [
                        {
                            "id": "subgraph-1",
                            "name": "Model subgraph",
                            "inputs": [],
                            "nodes": [
                                {
                                    **_workflow_with_model(inner_value)["nodes"][0],
                                    "id": 10,
                                },
                                {
                                    **_workflow_with_model(
                                        "unchanged.safetensors"
                                    )["nodes"][0],
                                    "id": 11,
                                },
                            ],
                        }
                    ]
                },
            }

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                references,
                "get_node_model_info",
                wraps=references.get_node_model_info,
            ) as get_node_info,
            patch.object(analysis.log, "debug") as debug_log,
        ):
            get_workflow_model_inventory(
                build_workflow("first.safetensors"),
                analysis_id="analysis-1",
            )
            get_workflow_model_inventory(
                build_workflow("second.safetensors"),
                analysis_id="analysis-2",
            )

        self.assertEqual(4, get_node_info.call_count)
        debug_messages = [
            call.args[0]
            for call in debug_log.call_args_list
            if call.args
        ]
        self.assertTrue(
            any(
                "Analyzing subgraph: Model subgraph (ID: subgraph-1) "
                "with 1 changed nodes, reused 1 nodes (analysis_id=analysis-2)"
                in message
                for message in debug_messages
            )
        )

    def test_scanner_invalidation_clears_shared_inventory(self):
        workflow = _workflow_with_model("invalidated.safetensors")

        with (
            patch(
                "core.scanner.get_model_files",
                return_value=[],
            ),
            patch.object(
                analysis,
                "analyze_workflow_models",
                return_value=[],
            ) as analyze_models,
        ):
            get_workflow_model_inventory(workflow)
            invalidate_model_files_cache()
            get_workflow_model_inventory(workflow)

        self.assertEqual(2, analyze_models.call_count)


if __name__ == "__main__":
    unittest.main()

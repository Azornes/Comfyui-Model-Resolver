import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from core import workflow_analyzer
from core.scanner import scan_directory
from core.workflow_analyzer import analyze_workflow_models, identify_missing_models


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
                    "core.workflow_analyzer.get_dynamic_node_widget_category_hints",
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
                workflow_analyzer,
                "_get_comfy_node_class",
                return_value=FilteredMultiCategoryLoader,
            ),
            patch.object(
                workflow_analyzer,
                "_get_folder_paths_module",
                return_value=fake_folder_paths,
            ),
        ):
            hints = workflow_analyzer._build_dynamic_node_widget_category_hints(
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
                workflow_analyzer,
                "_get_comfy_node_class",
                return_value=ControlledIndexLoader,
            ),
            patch.object(
                workflow_analyzer,
                "_get_folder_paths_module",
                return_value=fake_folder_paths,
            ),
        ):
            hints = workflow_analyzer._build_dynamic_node_widget_category_hints(
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
            "core.workflow_analyzer.get_dynamic_node_widget_category_hints",
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
            "core.workflow_analyzer.get_dynamic_node_widget_category_hints",
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
                    "core.workflow_analyzer.get_dynamic_node_widget_category_hints",
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
            "core.workflow_analyzer.get_dynamic_widget_category_hints",
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
            "core.workflow_analyzer.get_dynamic_widget_category_hints",
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
                    "core.workflow_analyzer.get_dynamic_widget_category_hints",
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
                "core.workflow_analyzer.get_dynamic_widget_category_hints",
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
            "core.workflow_analyzer.get_dynamic_widget_category_hints",
            side_effect=dynamic_category_hints,
        ):
            refs = analyze_workflow_models(workflow, available_models=[])

        self.assertEqual(1, len(refs))
        self.assertEqual("model.safetensors", refs[0]["original_path"])
        self.assertEqual("checkpoints", refs[0]["category"])

    def test_node_type_to_category_hints_is_populated(self):
        from core.workflow_analyzer import NODE_TYPE_TO_CATEGORY_HINTS
        # Verify standard loader mappings are correctly generated
        self.assertEqual("checkpoints", NODE_TYPE_TO_CATEGORY_HINTS.get("CheckpointLoaderSimple"))
        self.assertEqual("checkpoints", NODE_TYPE_TO_CATEGORY_HINTS.get("CheckpointLoader"))
        self.assertEqual("diffusion_models", NODE_TYPE_TO_CATEGORY_HINTS.get("UNETLoader"))
        self.assertEqual("loras", NODE_TYPE_TO_CATEGORY_HINTS.get("LoraLoader"))
        self.assertEqual("text_encoders", NODE_TYPE_TO_CATEGORY_HINTS.get("CLIPLoader"))
        # Verify custom fallbacks are also correctly populated
        self.assertEqual("loras", NODE_TYPE_TO_CATEGORY_HINTS.get("LoraLoaderV2"))


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


if __name__ == "__main__":
    unittest.main()

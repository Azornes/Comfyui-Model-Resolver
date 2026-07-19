import os
import tempfile
import unittest

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

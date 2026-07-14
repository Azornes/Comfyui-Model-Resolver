import unittest

from core.path_templates import infer_download_path_templates
from core.settings import calculate_template_subfolder


BASE_MODELS = {
    "base_models": [
        {
            "name": "Pony",
            "aliases": ["pony", "ponyxl", "pony diffusion"],
        },
        {
            "name": "SDXL 1.0",
            "aliases": ["sdxl", "sdxl10"],
        },
        {
            "name": "Illustrious",
            "aliases": ["illustrious", "illustriousxl"],
        },
        {
            "name": "Flux.1 Krea",
            "aliases": ["Flux.1 Krea", "flux 1 krea"],
        },
        {
            "name": "Krea 2",
            "aliases": ["krea", "krea 2"],
        },
        {
            "name": "Anima",
            "aliases": ["anima"],
        },
        {
            "name": "Ideogram 4.0",
            "aliases": ["Ideogram 4.0", "ideogram", "ideogram 4 0"],
        },
        {
            "name": "Upscaler",
            "aliases": ["upscaler"],
        },
    ]
}


class PathTemplateInferenceTests(unittest.TestCase):
    def test_detects_base_model_and_first_tag_layout(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "loras",
                    "relative_path": r"ponyxl\style\model-a.safetensors",
                    "path": r"C:\models\loras\ponyxl\style\model-a.safetensors",
                },
                {
                    "category": "lora",
                    "relative_path": r"ponyxl\character\model-b.safetensors",
                    "path": r"C:\models\loras\ponyxl\character\model-b.safetensors",
                },
                {
                    "category": "loras",
                    "relative_path": r"sdxl\style\model-c.safetensors",
                    "path": r"C:\models\loras\sdxl\style\model-c.safetensors",
                },
            ],
            BASE_MODELS,
        )

        self.assertEqual("{base_model}/{first_tag}", result["templates"]["loras"])
        self.assertEqual("ponyxl", result["base_model_path_mappings"]["Pony"])
        self.assertEqual("sdxl", result["base_model_path_mappings"]["SDXL 1.0"])
        self.assertTrue(result["categories"]["loras"]["apply"])

    def test_detects_flat_layout(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "vae",
                    "relative_path": "vae-a.safetensors",
                    "path": r"C:\models\vae\vae-a.safetensors",
                },
                {
                    "category": "vae",
                    "relative_path": "vae-b.safetensors",
                    "path": r"C:\models\vae\vae-b.safetensors",
                },
            ],
            BASE_MODELS,
        )

        self.assertEqual("", result["templates"]["vae"])
        self.assertTrue(result["categories"]["vae"]["apply"])

    def test_detects_nested_checkpoint_base_model_mappings(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "checkpoints",
                    "relative_path": r"SDXL\Pony\pony-realism.safetensors",
                    "path": r"C:\models\checkpoints\SDXL\Pony\pony-realism.safetensors",
                },
                {
                    "category": "checkpoints",
                    "relative_path": r"SDXL\Illustrious\wai.safetensors",
                    "path": r"C:\models\checkpoints\SDXL\Illustrious\wai.safetensors",
                },
                {
                    "category": "checkpoints",
                    "relative_path": r"SDXL\Illustrious\realistic\real.safetensors",
                    "path": r"C:\models\checkpoints\SDXL\Illustrious\realistic\real.safetensors",
                },
                {
                    "category": "checkpoints",
                    "relative_path": r"SDXL\SDXL\juggernaut.safetensors",
                    "path": r"C:\models\checkpoints\SDXL\SDXL\juggernaut.safetensors",
                },
            ],
            BASE_MODELS,
        )

        self.assertEqual("{base_model}", result["templates"]["checkpoints"])
        self.assertEqual("SDXL/Pony", result["base_model_path_mappings"]["Pony"])
        self.assertEqual(
            "SDXL/Illustrious",
            result["base_model_path_mappings"]["Illustrious"],
        )
        self.assertEqual(
            "SDXL/SDXL",
            result["base_model_path_mappings"]["SDXL 1.0"],
        )

    def test_base_model_mapping_matches_longer_metadata_name(self):
        subfolder = calculate_template_subfolder(
            "checkpoints",
            {"base_model": "Pony Diffusion V6 XL"},
            {
                "download_path_templates": {"checkpoints": "{base_model}"},
                "base_model_path_mappings": {"Pony": "SDXL/Pony"},
            },
        )

        self.assertEqual("SDXL/Pony", subfolder)

    def test_detect_does_not_map_krea2_to_flux_krea_folder(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "loras",
                    "relative_path": r"FLUX\KREA\concept\snofs_krea_v1.safetensors",
                    "path": r"C:\models\loras\FLUX\KREA\concept\snofs_krea_v1.safetensors",
                },
                {
                    "category": "loras",
                    "relative_path": r"FLUX\KREA\style\another_flux_krea.safetensors",
                    "path": r"C:\models\loras\FLUX\KREA\style\another_flux_krea.safetensors",
                },
            ],
            BASE_MODELS,
        )

        self.assertNotIn("Krea 2", result["base_model_path_mappings"])
        self.assertEqual(
            "FLUX/KREA",
            result["base_model_path_mappings"]["Flux.1 Krea"],
        )

    def test_detect_does_not_map_anima_to_wan_animate_folder(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "checkpoints",
                    "relative_path": r"WAN\WAN2.2ANIMATE\model-a.safetensors",
                    "path": r"C:\models\checkpoints\WAN\WAN2.2ANIMATE\model-a.safetensors",
                },
                {
                    "category": "checkpoints",
                    "relative_path": r"WAN\WAN2.2ANIMATE\model-b.safetensors",
                    "path": r"C:\models\checkpoints\WAN\WAN2.2ANIMATE\model-b.safetensors",
                },
            ],
            BASE_MODELS,
        )

        self.assertNotIn("Anima", result["base_model_path_mappings"])

    def test_detect_accepts_version_and_plural_alias_suffixes(self):
        result = infer_download_path_templates(
            [
                {
                    "category": "diffusion_models",
                    "relative_path": r"IDEOGRAM4\model-a.safetensors",
                    "path": r"C:\models\diffusion_models\IDEOGRAM4\model-a.safetensors",
                },
                {
                    "category": "upscale_models",
                    "relative_path": r"ESRGAN\Upscalers\photo\model-a.pth",
                    "path": r"C:\models\upscale_models\ESRGAN\Upscalers\photo\model-a.pth",
                },
            ],
            BASE_MODELS,
        )

        self.assertEqual(
            "IDEOGRAM4",
            result["base_model_path_mappings"]["Ideogram 4.0"],
        )
        self.assertEqual(
            "ESRGAN/Upscalers",
            result["base_model_path_mappings"]["Upscaler"],
        )


if __name__ == "__main__":
    unittest.main()

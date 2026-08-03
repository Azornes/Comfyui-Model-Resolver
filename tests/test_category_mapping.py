import unittest

from core.type_utils import normalize_download_category, resolve_model_category


class CategoryMappingTests(unittest.TestCase):
    def test_folder_category_aliases_resolve_to_existing_comfyui_keys(self):
        expected = {
            "checkpoint": "checkpoints",
            "lora": "loras",
            "embedding": "embeddings",
            "textual inversion": "embeddings",
            "textualinversion": "embeddings",
            "upscaler": "upscale_models",
            "unet gguf": "diffusion_models",
            "select-safetensors": "diffusion_models",
            "clip": "text_encoders",
            "ip_adapter": "ipadapter",
            "ultralytics_bbox": "ultralytics",
            "background-removal-model": "background_removal",
            "default": "upscale_models",
        }

        for raw_category, canonical_category in expected.items():
            self.assertEqual(
                canonical_category,
                resolve_model_category(raw_category, target_format="folder"),
            )
            self.assertEqual(
                canonical_category,
                normalize_download_category(raw_category),
            )

    def test_unknown_and_empty_categories_keep_current_fallbacks(self):
        self.assertEqual("checkpoints", normalize_download_category(""))
        self.assertEqual("checkpoints", normalize_download_category(None))
        self.assertEqual("new_category", normalize_download_category("new category"))


if __name__ == "__main__":
    unittest.main()

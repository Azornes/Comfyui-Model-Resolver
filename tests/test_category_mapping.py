import json
import unittest
from pathlib import Path

from core.type_utils import (
    CATEGORY_MAP,
    normalize_category_token,
    normalize_download_category,
    resolve_model_category,
)


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

    def test_category_token_contract_normalizes_common_separators(self):
        expected = {
            "  TEXTUAL\\INVERSION  ": ("textual_inversion", "embeddings"),
            "unet / gguf": ("unet_gguf", "diffusion_models"),
            "select---safetensors": ("select_safetensors", "diffusion_models"),
            "clip__vision": ("clip_vision", "clip_vision"),
        }

        for raw_category, (token, canonical_category) in expected.items():
            self.assertEqual(
                token,
                normalize_category_token(raw_category),
            )
            self.assertEqual(
                canonical_category,
                normalize_download_category(raw_category),
            )

    def test_frontend_category_alias_artifact_matches_backend_map(self):
        project_root = Path(__file__).resolve().parents[1]
        artifact = (
            project_root / "web" / "resolver" / "utils" / "category_aliases.generated.js"
        ).read_text(encoding="utf-8")
        payload = artifact.split(
            "export const CATEGORY_ALIASES = Object.freeze(\n", 1
        )[1].split("\n);\n", 1)[0]

        self.assertEqual(CATEGORY_MAP, json.loads(payload))


if __name__ == "__main__":
    unittest.main()

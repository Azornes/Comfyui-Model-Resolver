import ast
import tempfile
import unittest
from pathlib import Path

from core.custom_nodes import ast_scanner
from core.custom_nodes.ast_scanner import (
    _extract_widget_schema_from_input_types_ast,
    clear_node_widget_schema_hints_cache,
    resolve_ast_node_widget_category,
    scan_custom_node_widget_schemas,
)
from core.workflow.widgets import (
    get_node_model_widget_category_hint,
    get_widget_category_hint,
    is_workflow_model_widget_candidate,
)


class AstScannerTests(unittest.TestCase):
    def setUp(self):
        clear_node_widget_schema_hints_cache()

    def tearDown(self):
        clear_node_widget_schema_hints_cache()

    def test_extract_widget_schema_direct_calls(self):
        source = """
class TestNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"),),
                "vae_name": (folder_paths.get_filename_list("vae"), {"default": ""}),
            },
            "optional": {
                "lora_name": (folder_paths.get_filename_list("loras"),),
            }
        }
"""
        tree = ast.parse(source)
        cls_def = tree.body[0]
        fn_def = cls_def.body[0]
        schema = _extract_widget_schema_from_input_types_ast(fn_def)

        self.assertEqual(len(schema), 3)
        self.assertEqual(schema[0]["name"], "ckpt_name")
        self.assertEqual(schema[0]["folders"], ["checkpoints"])
        self.assertEqual(schema[1]["name"], "vae_name")
        self.assertEqual(schema[1]["folders"], ["vae"])
        self.assertEqual(schema[2]["name"], "lora_name")
        self.assertEqual(schema[2]["folders"], ["loras"])

    def test_extract_widget_schema_variable_assignment_and_addition(self):
        source = """
class CombinedModelLoader:
    @classmethod
    def INPUT_TYPES(s):
        models = folder_paths.get_filename_list("diffusion_models") + folder_paths.get_filename_list("unet")
        clip_files = folder_paths.get_filename_list("text_encoders")
        inputs = {
            "required": {
                "model_name": (models,),
                "clip_name": (clip_files,),
            }
        }
        return inputs
"""
        tree = ast.parse(source)
        cls_def = tree.body[0]
        fn_def = cls_def.body[0]
        schema = _extract_widget_schema_from_input_types_ast(fn_def)

        self.assertEqual(len(schema), 2)
        self.assertEqual(schema[0]["name"], "model_name")
        # Notice unet normalizes to diffusion_models so deduplicated into ['diffusion_models']
        self.assertIn("diffusion_models", schema[0]["folders"])
        self.assertEqual(schema[1]["name"], "clip_name")
        self.assertEqual(schema[1]["folders"], ["text_encoders"])

    def test_extract_widget_schema_subscript_notation(self):
        source = """
class SubscriptNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "checkpoint": (folder_paths.folder_names_and_paths["checkpoints"][0],),
            }
        }
"""
        tree = ast.parse(source)
        cls_def = tree.body[0]
        fn_def = cls_def.body[0]
        schema = _extract_widget_schema_from_input_types_ast(fn_def)

        self.assertEqual(len(schema), 1)
        self.assertEqual(schema[0]["name"], "checkpoint")
        self.assertEqual(schema[0]["folders"], ["checkpoints"])

    def test_scan_custom_node_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            py_file = temp_path / "custom_test_node.py"
            py_file.write_text("""
import folder_paths

class DynamicCustomAwesomeLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "awesome_diffusion": (folder_paths.get_filename_list("diffusion_models"),),
                "awesome_vae": (folder_paths.get_filename_list("vae"),),
            }
        }
""", encoding="utf-8")

            results = scan_custom_node_widget_schemas([str(temp_path)])
            self.assertIn("DynamicCustomAwesomeLoader", results)
            schema = results["DynamicCustomAwesomeLoader"]
            self.assertEqual(len(schema), 2)
            self.assertEqual(schema[0]["name"], "awesome_diffusion")
            self.assertEqual(schema[0]["folders"], ["diffusion_models"])
            self.assertEqual(schema[1]["name"], "awesome_vae")
            self.assertEqual(schema[1]["folders"], ["vae"])

    def test_workflow_widgets_integration(self):
        # Inject directly into cache for the test
        ast_scanner._node_widget_schema_hints_cache = {
            "UnregisteredCommunityLoader": [
                {"name": "cool_model", "folders": ["diffusion_models"]}
            ]
        }

        # 1. resolve_ast_node_widget_category by index and name
        cat_idx = resolve_ast_node_widget_category("UnregisteredCommunityLoader", widget_index=0)
        self.assertEqual(cat_idx, "diffusion_models")

        cat_name = resolve_ast_node_widget_category("UnregisteredCommunityLoader", widget_name="cool_model")
        self.assertEqual(cat_name, "diffusion_models")

        # 2. get_node_model_widget_category_hint
        node_cat = get_node_model_widget_category_hint("UnregisteredCommunityLoader", 0)
        self.assertEqual(node_cat, "diffusion_models")

        # 3. get_widget_category_hint
        node = {
            "type": "UnregisteredCommunityLoader",
            "inputs": [{"name": "cool_model", "widget": {"name": "cool_model"}}]
        }
        widget_cat = get_widget_category_hint(node, 0)
        self.assertEqual(widget_cat, "diffusion_models")

        # 4. is_workflow_model_widget_candidate
        self.assertTrue(is_workflow_model_widget_candidate(node, 0))


if __name__ == "__main__":
    unittest.main()

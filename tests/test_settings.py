import unittest
from core.settings import (
    bool_setting,
    normalize_settings,
    sanitize_folder_name,
    normalize_relative_subfolder,
    normalize_download_path_template,
    _resolve_base_model_mapping,
)

class SettingsTests(unittest.TestCase):

    def test_bool_setting(self):
        self.assertTrue(bool_setting("true"))
        self.assertTrue(bool_setting(True))
        self.assertFalse(bool_setting("false"))
        self.assertFalse(bool_setting(False))

    def test_workflow_dependency_marker_defaults_to_disabled(self):
        self.assertFalse(normalize_settings({})["workflow_dependency_marker_enabled"])
        self.assertTrue(
            normalize_settings({"workflow_dependency_marker_enabled": "true"})[
                "workflow_dependency_marker_enabled"
            ]
        )

    def test_auto_open_on_missing_defaults_to_disabled(self):
        self.assertFalse(normalize_settings({})["auto_open_on_missing"])
        self.assertTrue(
            normalize_settings({"auto_open_on_missing": "true"})[
                "auto_open_on_missing"
            ]
        )

    def test_sanitize_folder_name(self):
        self.assertEqual(sanitize_folder_name("valid_name"), "valid_name")
        self.assertEqual(sanitize_folder_name("name/with\\slashes"), "name_with_slashes")
        self.assertEqual(sanitize_folder_name("  spaces  and..dots.  "), "spaces and..dots")
        self.assertEqual(sanitize_folder_name("", "fallback"), "fallback")

    def test_normalize_relative_subfolder(self):
        self.assertEqual(normalize_relative_subfolder("sub\\dir/name"), "sub/dir/name")
        self.assertEqual(normalize_relative_subfolder(""), "")

    def test_normalize_download_path_template(self):
        self.assertEqual(normalize_download_path_template("some/{category}/template/"), "some/{category}/template")
        self.assertEqual(normalize_download_path_template(""), "")

    def test_resolve_base_model_mapping(self):
        mappings = {
            "SDXL": "sdxl",
            "SD1.5": "sd15",
        }
        self.assertEqual(_resolve_base_model_mapping(mappings, "SDXL 1.0"), "sdxl")
        self.assertEqual(_resolve_base_model_mapping(mappings, "SD 1.5"), "sd15")
        self.assertEqual(_resolve_base_model_mapping(mappings, "unknown"), "unknown")

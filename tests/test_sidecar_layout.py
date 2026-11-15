import os
import tempfile
import unittest

from core.path_utils import (
    MODEL_RESOLVER_METADATA_SUFFIX,
    PRIMARY_HIDDEN_DIR,
    _get_safe_sidecar_path,
    find_external_metadata_sidecar_path,
    find_model_resolver_sidecar_path,
    get_configured_sidecar_layout,
    get_model_resolver_sidecar_path,
    get_safe_model_resolver_sidecar_path,
    set_sidecar_layout_override,
    write_json_atomic,
)
from core.settings import get_sidecar_layout, normalize_settings


class SidecarLayoutTests(unittest.TestCase):
    def tearDown(self):
        set_sidecar_layout_override(None)

    def test_settings_normalization_default_and_hidden(self):
        self.assertEqual(normalize_settings({})["sidecar_layout"], "beside")
        self.assertEqual(
            normalize_settings({"sidecar_layout": "hidden"})["sidecar_layout"],
            "hidden",
        )
        self.assertEqual(
            normalize_settings({"sidecar_layout": "HIDDEN"})["sidecar_layout"],
            "hidden",
        )
        self.assertEqual(
            normalize_settings({"sidecar_layout": "invalid"})["sidecar_layout"],
            "beside",
        )
        self.assertEqual(get_sidecar_layout({"sidecar_layout": "hidden"}), "hidden")
        self.assertEqual(get_sidecar_layout({"sidecar_layout": "beside"}), "beside")

    def test_configured_layout_override(self):
        set_sidecar_layout_override("hidden")
        self.assertEqual(get_configured_sidecar_layout(), "hidden")
        set_sidecar_layout_override("beside")
        self.assertEqual(get_configured_sidecar_layout(), "beside")
        set_sidecar_layout_override(None)

    def test_get_model_resolver_sidecar_path_respects_layout(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "test_model.safetensors")

            # Default / beside layout
            set_sidecar_layout_override("beside")
            expected_beside = os.path.join(
                temp_dir, f"test_model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path), expected_beside
            )

            # Hidden layout
            set_sidecar_layout_override("hidden")
            expected_hidden = os.path.join(
                temp_dir,
                PRIMARY_HIDDEN_DIR,
                f"test_model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}",
            )
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path), expected_hidden
            )

            # Explicit layout parameter override
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path, layout="beside"),
                expected_beside,
            )
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path, layout="hidden"),
                expected_hidden,
            )

    def test_get_model_resolver_sidecar_path_preserves_existing_location(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "existing_model.safetensors")
            with open(model_path, "wb") as f:
                f.write(b"model data")

            # Case A: Existing beside file -> return beside even if layout is "hidden"
            beside_sidecar = os.path.join(
                temp_dir, f"existing_model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            with open(beside_sidecar, "w", encoding="utf-8") as f:
                f.write("{}")

            set_sidecar_layout_override("hidden")
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path), beside_sidecar
            )

            # Clean up beside file
            os.remove(beside_sidecar)

            # Case B: Existing .cmr file -> return .cmr even if layout is "beside"
            cmr_dir = os.path.join(temp_dir, PRIMARY_HIDDEN_DIR)
            os.makedirs(cmr_dir, exist_ok=True)
            cmr_sidecar = os.path.join(
                cmr_dir, f"existing_model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            with open(cmr_sidecar, "w", encoding="utf-8") as f:
                f.write("{}")

            set_sidecar_layout_override("beside")
            self.assertEqual(
                get_model_resolver_sidecar_path(model_path), cmr_sidecar
            )

    def test_find_model_resolver_sidecar_path_in_cmr_and_amb(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "sample.safetensors")
            with open(model_path, "wb") as f:
                f.write(b"test")

            # 1. Not found initially
            self.assertEqual(find_model_resolver_sidecar_path(model_path), "")

            # 2. Found in .amb (AMB compatibility)
            amb_dir = os.path.join(temp_dir, ".amb")
            os.makedirs(amb_dir, exist_ok=True)
            amb_sidecar = os.path.join(
                amb_dir, f"sample.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            with open(amb_sidecar, "w", encoding="utf-8") as f:
                f.write('{"from": "amb"}')

            self.assertEqual(
                find_model_resolver_sidecar_path(model_path), amb_sidecar
            )

            # 3. Found in .cmr (preferred over .amb)
            cmr_dir = os.path.join(temp_dir, ".cmr")
            os.makedirs(cmr_dir, exist_ok=True)
            cmr_sidecar = os.path.join(
                cmr_dir, f"sample.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            with open(cmr_sidecar, "w", encoding="utf-8") as f:
                f.write('{"from": "cmr"}')

            self.assertEqual(
                find_model_resolver_sidecar_path(model_path), cmr_sidecar
            )

            # 4. Works with dir_entries cache
            dir_entries = {os.path.normcase(name) for name in os.listdir(temp_dir)}
            self.assertEqual(
                find_model_resolver_sidecar_path(model_path, dir_entries=dir_entries),
                cmr_sidecar,
            )

            # If dir_entries does not contain .cmr, hidden check is skipped
            empty_entries = {"sample.safetensors"}
            self.assertEqual(
                find_model_resolver_sidecar_path(model_path, dir_entries=empty_entries),
                "",
            )

    def test_find_external_metadata_sidecar_path_in_hidden_dirs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "checkpoint.safetensors")
            with open(model_path, "wb") as f:
                f.write(b"data")

            # Put external .civitai.info inside .cmr
            cmr_dir = os.path.join(temp_dir, ".cmr")
            os.makedirs(cmr_dir, exist_ok=True)
            info_path = os.path.join(cmr_dir, "checkpoint.safetensors.civitai.info")
            with open(info_path, "w", encoding="utf-8") as f:
                f.write('{"id": 12345}')

            found = find_external_metadata_sidecar_path(model_path)
            self.assertEqual(found, info_path)

    def test_safe_sidecar_path_permits_hidden_subdirectories(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_path = os.path.join(temp_dir, "model.safetensors")
            with open(model_path, "wb") as f:
                f.write(b"model")

            # Beside safe check
            set_sidecar_layout_override("beside")
            safe_beside = get_safe_model_resolver_sidecar_path(model_path)
            self.assertEqual(
                safe_beside,
                os.path.join(temp_dir, f"model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"),
            )

            # Hidden safe check (.cmr)
            set_sidecar_layout_override("hidden")
            safe_hidden = get_safe_model_resolver_sidecar_path(model_path)
            self.assertEqual(
                safe_hidden,
                os.path.join(
                    temp_dir, PRIMARY_HIDDEN_DIR, f"model.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
                ),
            )

            # Outside directory is still strictly rejected
            outside = os.path.join(os.path.dirname(temp_dir), "outside.json")
            with self.assertRaises(ValueError):
                _get_safe_sidecar_path(model_path, lambda _: outside)

    def test_write_json_atomic_creates_hidden_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = os.path.join(
                temp_dir, PRIMARY_HIDDEN_DIR, f"test.safetensors{MODEL_RESOLVER_METADATA_SUFFIX}"
            )
            write_json_atomic(target_path, {"test": True}, indent=2)
            self.assertTrue(os.path.isfile(target_path))
            self.assertTrue(os.path.isdir(os.path.join(temp_dir, PRIMARY_HIDDEN_DIR)))

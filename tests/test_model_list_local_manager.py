"""Tests for local ComfyUI-Manager discovery and fallback in model_list."""

import json
from unittest.mock import patch

from core.sources import model_list


def test_find_local_manager_model_list_path_finds_existing_file(tmp_path):
    mgr_dir = tmp_path / "custom_nodes" / "ComfyUI-Manager"
    mgr_dir.mkdir(parents=True)
    mgr_file = mgr_dir / "model-list.json"
    mgr_file.write_text(json.dumps({"models": [{"name": "test_model", "filename": "test.safetensors"}]}), encoding="utf-8")

    class MockFolderPaths:
        @staticmethod
        def get_folder_paths(kind):
            if kind == "custom_nodes":
                return [str(tmp_path / "custom_nodes")]
            return []

    with patch.dict("sys.modules", {"folder_paths": MockFolderPaths}):
        found = model_list.find_local_manager_model_list_path()
        assert found is not None
        assert found.replace("\\", "/").lower() == str(mgr_file).replace("\\", "/").lower()


def test_sync_model_list_from_local_manager(tmp_path):
    mgr_file = tmp_path / "model-list.json"
    models_data = [
        {"name": "Local Checkpoint", "filename": "local_ckpt.safetensors", "url": "https://example.com/ckpt.safetensors"}
    ]
    mgr_file.write_text(json.dumps({"models": models_data}), encoding="utf-8")

    with patch.object(model_list, "find_local_manager_model_list_path", return_value=str(mgr_file)), \
         patch.object(model_list.catalog_mgr, "sync_catalog") as mock_sync, \
         patch.object(model_list, "reload_model_list"):
        result = model_list.sync_model_list_from_local_manager(force=True)
        assert result is not None
        assert result.get("updated") is True
        assert result.get("source") == "local_manager"
        mock_sync.assert_called_once()


def test_update_model_list_from_remote_falls_back_to_local_on_error():
    with patch.object(model_list, "_get_remote_model_list_info", side_effect=RuntimeError("Network error")), \
         patch.object(model_list, "sync_model_list_from_local_manager", return_value={"updated": True, "source": "local_manager"}) as mock_fallback:
        result = model_list.update_model_list_from_remote()
        assert result.get("fallback_to_local") is True
        assert "Network error" in result.get("warning", "")
        mock_fallback.assert_called_once_with(force=True)

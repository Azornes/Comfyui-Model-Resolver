"""Unit tests for download state persistence and interrupted download recovery."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from core.download import aria2_backend, state_store


def test_save_and_read_persisted_downloads(tmp_path):
    state_file = tmp_path / "downloads.json"
    assert state_store.read_persisted_downloads(state_file) == {}

    spec = {
        "url": "https://example.com/test.safetensors",
        "filename": "test.safetensors",
        "category": "checkpoints",
        "path": str(tmp_path / "test.safetensors"),
        "status": "starting",
        "total_size": 1000,
        "downloaded": 0,
    }
    state_store.save_download_spec("dl-1", spec, state_file=state_file)

    records = state_store.read_persisted_downloads(state_file)
    assert "dl-1" in records
    assert records["dl-1"]["filename"] == "test.safetensors"
    assert records["dl-1"]["status"] == "starting"
    assert "updated_at" in records["dl-1"]


def test_update_persisted_transfer_status(tmp_path):
    state_file = tmp_path / "downloads.json"
    spec = {
        "filename": "model.safetensors",
        "status": "starting",
        "downloaded": 0,
        "total_size": 5000,
    }
    state_store.save_download_spec("dl-2", spec, state_file=state_file)

    state_store.update_download_progress_state(
        "dl-2",
        status="downloading",
        downloaded=2500,
        total_size=5000,
        state_file=state_file,
    )

    records = state_store.read_persisted_downloads(state_file)
    assert records["dl-2"]["status"] == "downloading"
    assert records["dl-2"]["downloaded"] == 2500


def test_remove_persisted_download(tmp_path):
    state_file = tmp_path / "downloads.json"
    state_store.save_download_spec(
        "dl-3",
        {"filename": "model.safetensors"},
        state_file=state_file,
    )
    assert "dl-3" in state_store.read_persisted_downloads(state_file)

    state_store.remove_persisted_download("dl-3", state_file=state_file)
    assert "dl-3" not in state_store.read_persisted_downloads(state_file)


def test_clear_completed_persisted_transfers(tmp_path):
    state_file = tmp_path / "downloads.json"
    state_store.save_download_spec(
        "active-1",
        {"status": "downloading"},
        state_file=state_file,
    )
    state_store.save_download_spec(
        "completed-1",
        {"status": "completed"},
        state_file=state_file,
    )
    state_store.save_download_spec(
        "cancelled-1",
        {"status": "cancelled"},
        state_file=state_file,
    )

    state_store.clear_completed_persisted_transfers(state_file=state_file)
    records = state_store.read_persisted_downloads(state_file)
    assert "active-1" in records
    assert "completed-1" not in records
    assert "cancelled-1" not in records


def test_restore_persisted_downloads_interrupted(tmp_path):
    state_file = tmp_path / "downloads.json"
    model_path = tmp_path / "interrupted.safetensors"
    # Create partial model file
    model_path.write_bytes(b"x" * 2000)
    # Create aria2 control file indicating unfinished download
    (tmp_path / "interrupted.safetensors.aria2").write_bytes(b"aria2_control")

    spec = {
        "url": "https://example.com/interrupted.safetensors",
        "filename": "interrupted.safetensors",
        "path": str(model_path),
        "directory": str(tmp_path),
        "status": "downloading",
        "total_size": 4000,
        "downloaded": 2000,
        "download_backend": "aria2",
    }
    state_store.save_download_spec("dl-restore-1", spec, state_file=state_file)

    download_progress = {}
    import threading
    lock = threading.Lock()

    restored = state_store.restore_persisted_downloads(
        download_progress,
        lock,
        state_file=state_file,
    )
    assert restored == 1
    assert "dl-restore-1" in download_progress
    item = download_progress["dl-restore-1"]
    assert item["status"] == "paused"
    assert item["interrupted"] is True
    assert item["progress"] == 50
    assert item["downloaded"] == 2000
    assert item["total_size"] == 4000


def test_restore_persisted_downloads_skips_and_cleans_already_completed(tmp_path):
    state_file = tmp_path / "downloads.json"
    model_path = tmp_path / "already_done.safetensors"
    model_path.write_bytes(b"x" * 4000)

    spec = {
        "url": "https://example.com/already_done.safetensors",
        "filename": "already_done.safetensors",
        "path": str(model_path),
        "directory": str(tmp_path),
        "status": "downloading",
        "total_size": 4000,
        "downloaded": 4000,
    }
    state_store.save_download_spec("dl-done-1", spec, state_file=state_file)

    download_progress = {}
    import threading
    lock = threading.Lock()

    restored = state_store.restore_persisted_downloads(
        download_progress,
        lock,
        state_file=state_file,
    )
    assert restored == 0
    assert "dl-done-1" not in download_progress
    # Verifies it was removed from disk
    assert "dl-done-1" not in state_store.read_persisted_downloads(state_file)


def test_resume_download_restarts_restored_download_when_no_aria2_gid():
    mock_start_bg = MagicMock()
    persisted_spec = {
        "url": "https://example.com/model.safetensors",
        "filename": "model.safetensors",
        "category": "checkpoints",
        "headers": {"Authorization": "Bearer 123"},
        "subfolder": "sub",
        "base_directory": "/models",
        "metadata": {"title": "Test Model"},
    }

    facade = SimpleNamespace(
        cancelled_downloads=set(),
        aria2_transfers={},
        get_persisted_spec=MagicMock(return_value=persisted_spec),
        start_background_download=mock_start_bg,
        _queue_aria2_desired_state=MagicMock(
            return_value={"success": False, "error": "Download action is not available yet"}
        ),
    )

    result = aria2_backend.resume_download("dl-persisted-1", dependencies=facade)
    assert result["success"] is True
    assert result["message"] == "Download resumed"

    mock_start_bg.assert_called_once_with(
        url="https://example.com/model.safetensors",
        filename="model.safetensors",
        category="checkpoints",
        headers={"Authorization": "Bearer 123"},
        subfolder="sub",
        base_directory="/models",
        metadata={"title": "Test Model"},
        download_id="dl-persisted-1",
    )

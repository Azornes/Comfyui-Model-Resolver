import importlib


def test_initial_download_progress_preserves_the_shared_contract():
    state = importlib.import_module("core.download.state")
    create_initial_progress = getattr(state, "create_initial_progress", None)
    assert callable(create_initial_progress)

    progress = create_initial_progress(
        url="https://example.com/model.safetensors",
        path=r"C:\models\model.safetensors",
        filename="model.safetensors",
        directory=r"C:\models",
        download_backend="aria2",
        total_size=42,
        start_time=12.5,
    )

    assert progress == {
        "status": "starting",
        "progress": 0,
        "total_size": 42,
        "downloaded": 0,
        "filename": "model.safetensors",
        "path": r"C:\models\model.safetensors",
        "directory": r"C:\models",
        "url": "https://example.com/model.safetensors",
        "error": None,
        "speed": 0,
        "start_time": 12.5,
        "download_backend": "aria2",
    }


def test_initial_download_progress_defaults_total_size_to_zero():
    state = importlib.import_module("core.download.state")
    progress = state.create_initial_progress(
        url="https://example.com/model.safetensors",
        path="model.safetensors",
        filename="model.safetensors",
        directory="",
        download_backend="python",
        start_time=1.0,
    )

    assert progress["total_size"] == 0
    assert progress["download_backend"] == "python"

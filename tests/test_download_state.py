import importlib
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


def test_cancel_does_not_wait_for_http_headers_and_closes_late_response():
    orchestrator = importlib.import_module("core.download.orchestrator")
    entered = threading.Event()
    release = threading.Event()
    closed = threading.Event()
    cancelled = threading.Event()
    response = SimpleNamespace(close=closed.set)

    def request(*args, **kwargs):
        entered.set()
        assert release.wait(2)
        return response, "https://example.com/model", {}

    facade = SimpleNamespace(request_public_url=request, cancelled_downloads=set())

    def run():
        with pytest.raises(orchestrator.DownloadCancelled):
            orchestrator.request_download_response(facade, "download", "https://example.com/model")
        cancelled.set()

    worker = threading.Thread(target=run)
    worker.start()
    try:
        assert entered.wait(1)
        facade.cancelled_downloads.add("download")
        assert cancelled.wait(1), "Cancellation must finish before HTTP headers arrive"
        assert not closed.is_set()
    finally:
        release.set()
        worker.join(2)
    assert closed.wait(1)


def test_download_response_preserves_result_and_network_errors():
    orchestrator = importlib.import_module("core.download.orchestrator")
    result = (Mock(), "https://example.com/model", {})
    facade = SimpleNamespace(request_public_url=Mock(return_value=result), cancelled_downloads=set())
    assert orchestrator.request_download_response(facade, "download", result[1]) == result
    facade.request_public_url.side_effect = ValueError("network error")
    with pytest.raises(ValueError, match="network error"):
        orchestrator.request_download_response(facade, "download", result[1])


def test_cancel_is_idempotent_and_does_not_revive_terminal_downloads():
    state_module = importlib.import_module("core.download.state")
    progress = {"download": {"status": "starting", "speed": 5}}
    state = SimpleNamespace(
        download_progress=progress,
        download_lock=threading.Lock(),
        cancelled_downloads=set(),
        aria2_lock=threading.Lock(),
        aria2_desired_states={},
        aria2_transfers={},
        xet_transfers_lock=threading.Lock(),
        xet_transfers={},
    )
    assert state_module.cancel_download("download", state)
    assert progress["download"] == {"status": "cancelling", "speed": 0}
    assert "download" in state.cancelled_downloads
    for status in ("cancelled", "completed", "error"):
        progress["download"]["status"] = status
        state.cancelled_downloads.clear()
        assert state_module.cancel_download("download", state)
        assert progress["download"]["status"] == status
        assert not state.cancelled_downloads
    assert state_module.cancel_download("unknown", state)
    assert "unknown" not in state.cancelled_downloads


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

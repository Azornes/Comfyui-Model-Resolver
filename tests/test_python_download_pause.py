import hashlib
import os
import requests
import tempfile
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.download import api as download_api
from core.download import orchestrator
from core.download import state as download_state


def test_python_download_control_lifecycle():
    controls = {}
    lock = threading.Lock()
    dl_id = "test-dl-1"

    assert not download_state.is_python_download_active(dl_id, controls, lock)

    event = download_state.register_python_download_control(dl_id, controls, lock)
    assert download_state.is_python_download_active(dl_id, controls, lock)
    assert event.is_set()

    # Pause
    paused = download_state.pause_python_download(dl_id, controls, lock)
    assert paused is True
    assert not event.is_set()

    # Resume
    resumed = download_state.resume_python_download(dl_id, controls, lock)
    assert resumed is True
    assert event.is_set()

    # Unregister
    download_state.unregister_python_download_control(dl_id, controls, lock)
    assert not download_state.is_python_download_active(dl_id, controls, lock)
    assert dl_id not in controls


def test_pause_and_resume_download_facade_integration():
    download_id = "py-dl-42"
    controls = {}
    controls_lock = threading.Lock()
    progress = {
        download_id: {
            "status": "downloading",
            "speed": 500000,
            "downloaded": 1024,
            "total_size": 4096,
            "download_backend": "python",
        }
    }
    persisted_updates = []

    def fake_update_state(dl_id, **kwargs):
        persisted_updates.append((dl_id, kwargs))

    facade = SimpleNamespace(
        cancelled_downloads=set(),
        download_progress=progress,
        download_lock=threading.Lock(),
        python_download_controls=controls,
        python_download_controls_lock=controls_lock,
        is_python_download_active=lambda did: did in controls,
        pause_python_download=lambda did: download_state.pause_python_download(
            did, controls, controls_lock
        ),
        resume_python_download=lambda did: download_state.resume_python_download(
            did, controls, controls_lock
        ),
        _set_download_progress_status=lambda did, st, **kw: (
            progress[did].update(status=st, **kw)
        ),
        update_download_progress_state=fake_update_state,
        _queue_aria2_desired_state=MagicMock(),
    )

    # Register active python download
    event = download_state.register_python_download_control(
        download_id, controls, controls_lock
    )

    # Test pause
    pause_res = download_api.pause_download(download_id, dependencies=facade)
    assert pause_res == {"success": True, "message": "Download paused"}
    assert not event.is_set()
    assert progress[download_id]["status"] == "paused"
    assert progress[download_id]["speed"] == 0
    assert ("py-dl-42", {"status": "paused"}) in persisted_updates

    # Pause again while already paused
    pause_again = download_api.pause_download(download_id, dependencies=facade)
    assert pause_again == {"success": True, "message": "Download paused"}

    # Test resume
    resume_res = download_api.resume_download(download_id, dependencies=facade)
    assert resume_res == {"success": True, "message": "Download resumed"}
    assert event.is_set()
    assert progress[download_id]["status"] == "downloading"
    assert ("py-dl-42", {"status": "downloading"}) in persisted_updates


def test_pause_and_resume_reject_when_cancelled():
    download_id = "cancelling-dl"
    facade = SimpleNamespace(
        cancelled_downloads={download_id},
        is_python_download_active=lambda did: True,
    )
    p_res = download_api.pause_download(download_id, dependencies=facade)
    assert p_res == {"success": False, "error": "Download is being cancelled"}

    r_res = download_api.resume_download(download_id, dependencies=facade)
    assert r_res == {"success": False, "error": "Download is being cancelled"}


def test_in_flight_pause_and_resume_streaming():
    """Verify that a Python download pauses chunk writing until resumed, then completes."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = os.path.join(tmpdir, "test_model.safetensors")
        download_id = "stream-pause-test"

        chunks = [b"chunk1_", b"chunk2_", b"chunk3_"]
        chunk1_yielded = threading.Event()
        allow_chunk2 = threading.Event()

        class MockResponse:
            def __init__(self):
                self.headers = {"content-length": str(sum(len(c) for c in chunks))}
                self.status_code = 200

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size=None):
                yield chunks[0]
                chunk1_yielded.set()
                allow_chunk2.wait(timeout=5)
                yield chunks[1]
                yield chunks[2]

            def close(self):
                pass

        mock_resp = MockResponse()
        controls = {}
        controls_lock = threading.Lock()
        progress = {}
        cancelled_set = set()

        facade = SimpleNamespace(
            hashlib=download_api.context.hashlib,
            os=os,
            requests=download_api.context.requests,
            time=time,
            urlparse=download_api.context.urlparse,
            deque=download_api.context.deque,
            download_progress=progress,
            download_lock=threading.Lock(),
            cancelled_downloads=cancelled_set,
            SPEED_HISTORY_SIZE=10,
            CHUNK_SIZE=1024,
            CLI_LOG_INTERVAL=60,
            log=download_api.log,
            _extract_expected_sha256=lambda m: None,
            _download_backend_from_settings=lambda: "python",
            _download_huggingface_xet=lambda *a, **k: None,
            get_filename_from_path=os.path.basename,
            host_matches_domain=lambda *a: False,
            _strip_sensitive_url_params=lambda u: u,
            build_download_headers=lambda u, h: {},
            format_bytes=lambda b: f"{b}B",
            _delete_python_partial_download_file=lambda p: (
                os.path.exists(p) and os.unlink(p)
            ),
            _sanitize_download_error=str,
            extract_response_file_size=lambda r: sum(len(c) for c in chunks),
            write_model_resolver_metadata=lambda *a, **k: None,
            invalidate_model_caches=lambda: None,
            register_python_download_control=lambda did: download_state.register_python_download_control(
                did, controls, controls_lock
            ),
            unregister_python_download_control=lambda did: download_state.unregister_python_download_control(
                did, controls, controls_lock
            ),
            is_python_download_active=lambda did: did in controls,
            pause_python_download=lambda did: download_state.pause_python_download(
                did, controls, controls_lock
            ),
            resume_python_download=lambda did: download_state.resume_python_download(
                did, controls, controls_lock
            ),
            update_download_progress_state=MagicMock(),
        )

        def mock_request(*args, **kwargs):
            return mock_resp, "https://example.com/test_model.safetensors", {}

        with patch.object(orchestrator, "request_download_response", side_effect=mock_request):
            download_thread = threading.Thread(
                target=orchestrator.download_file,
                args=("https://example.com/test_model.safetensors", dest_path, download_id),
                kwargs={"dependencies": facade},
            )
            download_thread.start()

            # Wait for first chunk to be yielded
            assert chunk1_yielded.wait(timeout=2)

            # Pause download
            download_state.pause_python_download(download_id, controls, controls_lock)

            # Now allow chunk 2 to be yielded into the loop
            allow_chunk2.set()

            # Wait to confirm loop entered paused state on chunk 2
            deadline = time.time() + 2
            while time.time() < deadline:
                with facade.download_lock:
                    if progress.get(download_id, {}).get("status") == "paused":
                        break
                time.sleep(0.05)
            assert progress[download_id]["status"] == "paused"
            assert progress[download_id]["speed"] == 0

            # Resume download
            download_state.resume_python_download(download_id, controls, controls_lock)

            download_thread.join(timeout=5)
            assert not download_thread.is_alive()

            # Download completed
            assert progress[download_id]["status"] == "completed"
            assert os.path.exists(dest_path)
            with open(dest_path, "rb") as f:
                assert f.read() == b"chunk1_chunk2_chunk3_"


def test_in_flight_pause_and_cancel():
    """Verify that cancelling while paused unblocks the thread and cleans up."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = os.path.join(tmpdir, "cancel_model.safetensors")
        download_id = "cancel-pause-test"

        first_chunk_event = threading.Event()

        class InfiniteResponse:
            def __init__(self):
                self.headers = {"content-length": "1000000"}
                self.status_code = 200

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size=None):
                first_chunk_event.set()
                while True:
                    yield b"infinite_data_"
                    time.sleep(0.05)

            def close(self):
                pass

        mock_resp = InfiniteResponse()
        controls = {}
        controls_lock = threading.Lock()
        progress = {}
        cancelled_set = set()

        facade = SimpleNamespace(
            hashlib=download_api.context.hashlib,
            os=os,
            requests=download_api.context.requests,
            time=time,
            urlparse=download_api.context.urlparse,
            deque=download_api.context.deque,
            download_progress=progress,
            download_lock=threading.Lock(),
            cancelled_downloads=cancelled_set,
            SPEED_HISTORY_SIZE=10,
            CHUNK_SIZE=1024,
            CLI_LOG_INTERVAL=60,
            log=download_api.log,
            _extract_expected_sha256=lambda m: None,
            _download_backend_from_settings=lambda: "python",
            _download_huggingface_xet=lambda *a, **k: None,
            get_filename_from_path=os.path.basename,
            host_matches_domain=lambda *a: False,
            _strip_sensitive_url_params=lambda u: u,
            build_download_headers=lambda u, h: {},
            format_bytes=lambda b: f"{b}B",
            _delete_python_partial_download_file=lambda p: (
                os.path.exists(p) and os.unlink(p)
            ),
            _sanitize_download_error=str,
            extract_response_file_size=lambda r: 1000000,
            write_model_resolver_metadata=lambda *a, **k: None,
            invalidate_model_caches=lambda: None,
            register_python_download_control=lambda did: download_state.register_python_download_control(
                did, controls, controls_lock
            ),
            unregister_python_download_control=lambda did: download_state.unregister_python_download_control(
                did, controls, controls_lock
            ),
            is_python_download_active=lambda did: did in controls,
            pause_python_download=lambda did: download_state.pause_python_download(
                did, controls, controls_lock
            ),
            resume_python_download=lambda did: download_state.resume_python_download(
                did, controls, controls_lock
            ),
            update_download_progress_state=MagicMock(),
        )

        def mock_request(*args, **kwargs):
            return mock_resp, "https://example.com/cancel_model.safetensors", {}

        with patch.object(orchestrator, "request_download_response", side_effect=mock_request):
            download_thread = threading.Thread(
                target=orchestrator.download_file,
                args=("https://example.com/cancel_model.safetensors", dest_path, download_id),
                kwargs={"dependencies": facade},
            )
            download_thread.start()

            assert first_chunk_event.wait(timeout=2)

            # Pause download
            download_state.pause_python_download(download_id, controls, controls_lock)

            # Confirm paused
            deadline = time.time() + 2
            while time.time() < deadline:
                with facade.download_lock:
                    if progress.get(download_id, {}).get("status") == "paused":
                        break
                time.sleep(0.05)
            assert progress[download_id]["status"] == "paused"

            # Now cancel download while paused
            cancelled_set.add(download_id)

            # Waking up event if done by state
            download_state.cancel_download(
                download_id,
                SimpleNamespace(
                    download_progress=progress,
                    download_lock=facade.download_lock,
                    cancelled_downloads=cancelled_set,
                    aria2_lock=threading.Lock(),
                    aria2_transfers={},
                    aria2_desired_states={},
                    xet_transfers={},
                    xet_transfers_lock=threading.Lock(),
                    python_download_controls=controls,
                    python_download_controls_lock=controls_lock,
                    set_download_progress_status=MagicMock(),
                    force_remove_aria2_transfer=MagicMock(),
                    thread_factory=threading.Thread,
                    log=facade.log,
                ),
            )

            download_thread.join(timeout=3)
            assert not download_thread.is_alive()
            assert progress[download_id]["status"] == "cancelled"
            assert not os.path.exists(f"{dest_path}.part")
            assert not os.path.exists(dest_path)


def test_python_download_416_complete_file_recovered_and_published():
    """Verify HTTP 416 on resume treats an already complete .part file as finished and publishes it."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = os.path.join(tmpdir, "model_416.safetensors")
        part_path = f"{dest_path}.part"
        download_id = "dl-416-complete"

        data = b"X" * 1024
        with open(part_path, "wb") as f:
            f.write(data)

        expected_hash = hashlib.sha256(data).hexdigest()
        controls = {}
        controls_lock = threading.Lock()
        progress = {}
        cancelled_set = set()

        facade = SimpleNamespace(
            hashlib=hashlib,
            os=os,
            requests=requests,
            time=time,
            urlparse=download_api.context.urlparse,
            deque=download_api.context.deque,
            download_progress=progress,
            download_lock=threading.Lock(),
            cancelled_downloads=cancelled_set,
            SPEED_HISTORY_SIZE=10,
            CHUNK_SIZE=1024,
            CLI_LOG_INTERVAL=60,
            log=download_api.log,
            load_settings=lambda: {},
            PYTHON_DOWNLOAD_CONNECT_TIMEOUT=10,
            PYTHON_DOWNLOAD_READ_TIMEOUT=15,
            PYTHON_DOWNLOAD_MAX_RETRIES=2,
            PYTHON_DOWNLOAD_RETRY_DELAY=0.1,
            _extract_expected_sha256=lambda m: (m or {}).get("sha256"),
            _download_backend_from_settings=lambda: "python",
            _download_huggingface_xet=lambda *a, **k: None,
            get_filename_from_path=os.path.basename,
            host_matches_domain=lambda *a: False,
            _strip_sensitive_url_params=lambda u: u,
            build_download_headers=lambda u, h: dict(h or {}),
            format_bytes=lambda b: f"{b}B",
            _delete_python_partial_download_file=lambda p: os.path.exists(p) and os.unlink(p),
            _sanitize_download_error=str,
            extract_response_file_size=lambda r: (
                1024 if getattr(r, "status_code", None) == 416 else 1024
            ),
            write_model_resolver_metadata=lambda *a, **k: os.path.join(tmpdir, "meta.json"),
            invalidate_model_caches=lambda: None,
            register_python_download_control=lambda did: download_state.register_python_download_control(
                did, controls, controls_lock
            ),
            unregister_python_download_control=lambda did: download_state.unregister_python_download_control(
                did, controls, controls_lock
            ),
        )

        mock_416_resp = MagicMock()
        mock_416_resp.status_code = 416
        mock_416_resp.headers = {"Content-Range": "bytes */1024"}
        http_err = requests.exceptions.HTTPError(response=mock_416_resp)

        def mock_request(*args, **kwargs):
            raise http_err

        with patch.object(orchestrator, "request_download_response", side_effect=mock_request):
            result = orchestrator.download_file(
                "https://example.com/model.safetensors",
                dest_path,
                download_id,
                metadata={"sha256": expected_hash},
                dependencies=facade,
            )

            assert result["success"] is True
            assert result["size"] == 1024
            assert result["sha256"] == expected_hash
            assert result["sha256_verified"] is True
            assert not os.path.exists(part_path)
            assert os.path.exists(dest_path)
            with open(dest_path, "rb") as f:
                assert f.read() == data


def test_python_download_416_size_mismatch_resets_and_redownloads():
    """Verify HTTP 416 on resume resets .part file and redownloads when size does not match."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = os.path.join(tmpdir, "model_416_mismatch.safetensors")
        part_path = f"{dest_path}.part"
        download_id = "dl-416-mismatch"

        with open(part_path, "wb") as f:
            f.write(b"Z" * 500)

        new_data = b"CORRECT_FULL_CONTENT"
        expected_hash = hashlib.sha256(new_data).hexdigest()

        controls = {}
        controls_lock = threading.Lock()
        progress = {}
        cancelled_set = set()

        class MockFreshResponse:
            def __init__(self):
                self.status_code = 200
                self.headers = {"content-length": str(len(new_data))}

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size=None):
                yield new_data

            def close(self):
                pass

        fresh_resp = MockFreshResponse()

        facade = SimpleNamespace(
            hashlib=hashlib,
            os=os,
            requests=requests,
            time=time,
            urlparse=download_api.context.urlparse,
            deque=download_api.context.deque,
            download_progress=progress,
            download_lock=threading.Lock(),
            cancelled_downloads=cancelled_set,
            SPEED_HISTORY_SIZE=10,
            CHUNK_SIZE=1024,
            CLI_LOG_INTERVAL=60,
            log=download_api.log,
            load_settings=lambda: {},
            PYTHON_DOWNLOAD_CONNECT_TIMEOUT=10,
            PYTHON_DOWNLOAD_READ_TIMEOUT=15,
            PYTHON_DOWNLOAD_MAX_RETRIES=2,
            PYTHON_DOWNLOAD_RETRY_DELAY=0.1,
            _extract_expected_sha256=lambda m: (m or {}).get("sha256"),
            _download_backend_from_settings=lambda: "python",
            _download_huggingface_xet=lambda *a, **k: None,
            get_filename_from_path=os.path.basename,
            host_matches_domain=lambda *a: False,
            _strip_sensitive_url_params=lambda u: u,
            build_download_headers=lambda u, h: dict(h or {}),
            format_bytes=lambda b: f"{b}B",
            _delete_python_partial_download_file=lambda p: os.path.exists(p) and os.unlink(p),
            _sanitize_download_error=str,
            extract_response_file_size=lambda r: (
                1000 if getattr(r, "status_code", None) == 416 else len(new_data)
            ),
            write_model_resolver_metadata=lambda *a, **k: os.path.join(tmpdir, "meta.json"),
            invalidate_model_caches=lambda: None,
            register_python_download_control=lambda did: download_state.register_python_download_control(
                did, controls, controls_lock
            ),
            unregister_python_download_control=lambda did: download_state.unregister_python_download_control(
                did, controls, controls_lock
            ),
        )

        mock_416_resp = MagicMock()
        mock_416_resp.status_code = 416
        mock_416_resp.headers = {"Content-Range": "bytes */1000"}
        http_err = requests.exceptions.HTTPError(response=mock_416_resp)

        call_count = 0

        def mock_request(fcd, did, url, headers=None, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                assert "Range" in (headers or {})
                raise http_err
            assert "Range" not in (headers or {})
            return fresh_resp, url, {}

        with patch.object(orchestrator, "request_download_response", side_effect=mock_request):
            result = orchestrator.download_file(
                "https://example.com/model.safetensors",
                dest_path,
                download_id,
                metadata={"sha256": expected_hash},
                dependencies=facade,
            )

            assert result["success"] is True
            assert result["size"] == len(new_data)
            assert result["sha256"] == expected_hash
            assert not os.path.exists(part_path)
            assert os.path.exists(dest_path)
            with open(dest_path, "rb") as f:
                assert f.read() == new_data


def test_python_download_stall_auto_reconnects():
    """Verify that a socket ReadTimeout stall triggers automatic reconnect and resumes from offset."""
    with tempfile.TemporaryDirectory() as tmpdir:
        dest_path = os.path.join(tmpdir, "model_stall.safetensors")
        part_path = f"{dest_path}.part"
        download_id = "dl-stall-test"

        chunk1 = b"PART_ONE_"
        chunk2 = b"PART_TWO_DONE"
        total_data = chunk1 + chunk2
        expected_hash = hashlib.sha256(total_data).hexdigest()

        controls = {}
        controls_lock = threading.Lock()
        progress = {}
        cancelled_set = set()

        class MockStallingResponse:
            def __init__(self):
                self.status_code = 200
                self.headers = {"content-length": str(len(total_data))}

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size=None):
                yield chunk1
                raise requests.exceptions.ReadTimeout("Read timed out without data")

            def close(self):
                pass

        class MockResumeResponse:
            def __init__(self):
                self.status_code = 206
                self.headers = {
                    "content-length": str(len(chunk2)),
                    "content-range": f"bytes {len(chunk1)}-{len(total_data)-1}/{len(total_data)}",
                }

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size=None):
                yield chunk2

            def close(self):
                pass

        resp1 = MockStallingResponse()
        resp2 = MockResumeResponse()

        facade = SimpleNamespace(
            hashlib=hashlib,
            os=os,
            requests=requests,
            time=time,
            urlparse=download_api.context.urlparse,
            deque=download_api.context.deque,
            download_progress=progress,
            download_lock=threading.Lock(),
            cancelled_downloads=cancelled_set,
            SPEED_HISTORY_SIZE=10,
            CHUNK_SIZE=1024,
            CLI_LOG_INTERVAL=60,
            log=download_api.log,
            load_settings=lambda: {},
            PYTHON_DOWNLOAD_CONNECT_TIMEOUT=10,
            PYTHON_DOWNLOAD_READ_TIMEOUT=15,
            PYTHON_DOWNLOAD_MAX_RETRIES=2,
            PYTHON_DOWNLOAD_RETRY_DELAY=0.01,
            _extract_expected_sha256=lambda m: (m or {}).get("sha256"),
            _download_backend_from_settings=lambda: "python",
            _download_huggingface_xet=lambda *a, **k: None,
            get_filename_from_path=os.path.basename,
            host_matches_domain=lambda *a: False,
            _strip_sensitive_url_params=lambda u: u,
            build_download_headers=lambda u, h: dict(h or {}),
            format_bytes=lambda b: f"{b}B",
            _delete_python_partial_download_file=lambda p: os.path.exists(p) and os.unlink(p),
            _sanitize_download_error=str,
            extract_response_file_size=lambda r: (
                len(total_data) if getattr(r, "status_code", None) == 200 else len(chunk2)
            ),
            write_model_resolver_metadata=lambda *a, **k: os.path.join(tmpdir, "meta.json"),
            invalidate_model_caches=lambda: None,
            register_python_download_control=lambda did: download_state.register_python_download_control(
                did, controls, controls_lock
            ),
            unregister_python_download_control=lambda did: download_state.unregister_python_download_control(
                did, controls, controls_lock
            ),
        )

        attempts = 0

        def mock_request(fcd, did, url, headers=None, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return resp1, url, {}
            assert headers.get("Range") == f"bytes={len(chunk1)}-"
            return resp2, url, {}

        with patch.object(orchestrator, "request_download_response", side_effect=mock_request):
            result = orchestrator.download_file(
                "https://example.com/model_stall.safetensors",
                dest_path,
                download_id,
                metadata={"sha256": expected_hash},
                dependencies=facade,
            )

            assert result["success"] is True
            assert result["size"] == len(total_data)
            assert result["sha256"] == expected_hash
            assert not os.path.exists(part_path)
            assert os.path.exists(dest_path)
            with open(dest_path, "rb") as f:
                assert f.read() == total_data

"""
Subprocess-based HuggingFace Downloader using huggingface_hub.hf_hub_download.

Executes downloads in a killable worker process (_hf_worker.py) to enable OS-level
cancellation, isolated token scoping, and stable public APIs.
"""

import inspect
import json
import os
import queue as queue_mod
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Dict, Optional

from ..log_system import create_module_logger
from .dependencies import require_download_dependencies
from .state import create_initial_progress

log = create_module_logger(__name__)

_WORKER_SCRIPT = os.path.join(os.path.dirname(__file__), "_hf_worker.py")
_PROCESS_JOIN_TIMEOUT = 5.0


def is_hf_worker_supported() -> bool:
    """Check if huggingface_hub is available and supports tqdm_class hook (>=1.1.0)."""
    try:
        import huggingface_hub

        sig = inspect.signature(huggingface_hub.hf_hub_download)
        return "tqdm_class" in sig.parameters
    except Exception:
        return False


def _staging_dir(dest_dir: str, download_id: str) -> str:
    return os.path.join(dest_dir, f".model_resolver_tmp_{download_id}")


def _remove_staging(path: str) -> None:
    for _ in range(10):
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path):
            return
        time.sleep(0.2)


def _pipe_reader(pipe: Any, out_queue: queue_mod.Queue) -> None:
    try:
        for line in pipe:
            out_queue.put(line)
    except Exception:
        pass
    finally:
        out_queue.put(None)


def download_huggingface_worker(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    *,
    dependencies: Any = None,
    expected_sha256: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Download a HuggingFace file using the isolated worker subprocess.

    Returns None if the URL is not a valid HuggingFace repository file URL
    or if huggingface_hub does not support the modern worker engine.
    """
    if not is_hf_worker_supported():
        return None

    facade = require_download_dependencies(dependencies, "Hugging Face worker")
    try:
        from ..sources.huggingface import parse_huggingface_url
        parsed = parse_huggingface_url(url)
    except Exception:
        parsed = None

    if parsed is None or not getattr(parsed, "repo", None) or not getattr(parsed, "filename", None):
        return None

    repo_id = parsed.repo
    repo_filename = parsed.filename
    revision = getattr(parsed, "branch", "main") or "main"

    token: str | bool = False
    if headers and "Authorization" in headers:
        auth_header = headers["Authorization"].strip()
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        elif auth_header:
            token = auth_header
    if not token and hasattr(facade, "get_huggingface_token"):
        token = facade.get_huggingface_token() or False
    if not token:
        env_token = os.environ.get("HF_TOKEN")
        if env_token:
            token = env_token.strip()

    dest_dir = os.path.dirname(dest_path)
    filename = os.path.basename(dest_path)
    staging = _staging_dir(dest_dir, download_id)
    start_time = time.time()

    expected_sha256 = (
        expected_sha256
        or (facade._extract_expected_sha256(metadata) if hasattr(facade, "_extract_expected_sha256") else None)
    )
    if not expected_sha256:
        try:
            from ..sources.huggingface import get_huggingface_file_sha256
            expected_sha256 = get_huggingface_file_sha256(url, headers=headers)
        except Exception:
            expected_sha256 = None

    with facade.download_lock:
        facade.download_progress[download_id] = create_initial_progress(
            url=url,
            path=dest_path,
            filename=filename,
            directory=dest_dir,
            download_backend="huggingface_worker",
            start_time=start_time,
            total_size=0,
        )

    facade.cancelled_downloads.discard(download_id)

    try:
        os.makedirs(dest_dir, exist_ok=True)
        os.makedirs(staging, exist_ok=True)
    except Exception as e:
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "error"
                state["error"] = f"Could not create download directory: {e}"
        return {"success": False, "download_id": download_id, "path": dest_path, "error": str(e)}

    log.info(f"Starting Hugging Face worker download: {filename} from {repo_id}")

    request_payload = {
        "repo_id": repo_id,
        "filename": repo_filename,
        "revision": revision,
        "local_dir": staging,
        "token": token,
    }

    try:
        proc = subprocess.Popen(
            [sys.executable, _WORKER_SCRIPT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception as e:
        _remove_staging(staging)
        error_msg = f"Could not start download worker process: {e}"
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "error"
                state["error"] = error_msg
        log.error(f"✗ Hugging Face worker failed to start: {error_msg}")
        return {"success": False, "download_id": download_id, "path": dest_path, "error": error_msg}

    try:
        if proc.stdin:
            proc.stdin.write(json.dumps(request_payload) + "\n")
            proc.stdin.flush()
            proc.stdin.close()
    except Exception:
        pass

    stdout_queue: queue_mod.Queue = queue_mod.Queue()
    stderr_lines: list = []
    reader = threading.Thread(target=_pipe_reader, args=(proc.stdout, stdout_queue), daemon=True)
    reader.start()
    stderr_reader = threading.Thread(
        target=lambda: stderr_lines.extend(proc.stderr.readlines() if proc.stderr else []),
        daemon=True,
    )
    stderr_reader.start()

    result_path = None
    error_msg = None
    cancelled = False
    total_size = 0
    last_downloaded = 0
    last_speed_time = start_time
    speed = 0.0

    while True:
        if download_id in facade.cancelled_downloads:
            cancelled = True
            break
        try:
            line = stdout_queue.get(timeout=0.5)
        except queue_mod.Empty:
            continue
        if line is None:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue

        event = msg.get("event")
        if event == "progress":
            n = msg.get("n")
            total = msg.get("total")
            if total:
                total_size = total
            now = time.time()
            dt = now - last_speed_time
            if dt > 0 and n is not None:
                speed = max(0.0, (n - last_downloaded) / dt)
                last_downloaded = n
                last_speed_time = now

            with facade.download_lock:
                state = facade.download_progress.get(download_id)
                if state is not None:
                    state["status"] = "downloading"
                    state["downloaded"] = n or 0
                    state["speed"] = int(speed)
                    if total_size > 0:
                        state["total_size"] = total_size
                        state["progress"] = min(100.0, round((n or 0) / total_size * 100, 1))
        elif event == "log":
            log.debug(f"[hf-worker] {msg.get('message', '')}")
        elif event == "done":
            result_path = msg.get("path")
        elif event == "error":
            error_msg = msg.get("message")

    if download_id in facade.cancelled_downloads:
        cancelled = True

    if cancelled:
        proc.terminate()
        try:
            proc.wait(timeout=_PROCESS_JOIN_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
        _remove_staging(staging)
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "cancelled"
                state["speed"] = 0
                state["error"] = "Download cancelled"
        facade.cancelled_downloads.discard(download_id)
        log.info(f"Hugging Face worker download cancelled: {filename}")
        return {"success": False, "download_id": download_id, "path": dest_path, "error": "Download cancelled"}

    try:
        proc.wait(timeout=_PROCESS_JOIN_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
    stderr_reader.join(timeout=1.0)
    stderr_text = "".join(stderr_lines).strip()

    if error_msg or not result_path or not os.path.exists(result_path):
        _remove_staging(staging)
        if stderr_text:
            log.debug(f"[hf-worker stderr] {stderr_text}")
        stderr_tail = stderr_text.splitlines()[-1].strip() if stderr_text else ""
        final_err = error_msg or (
            f"Worker process failed: {stderr_tail}"
            if stderr_tail
            else "Download failed without error message"
        )
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "error"
                state["error"] = final_err
                state["speed"] = 0
        log.error(f"✗ Hugging Face worker download failed: {filename} - {final_err}")
        return {"success": False, "download_id": download_id, "path": dest_path, "error": final_err}

    # Verify safetensors header & tensor bounds before publishing
    if hasattr(facade, "check_safetensors_damage"):
        damage = facade.check_safetensors_damage(result_path)
        if damage:
            _remove_staging(staging)
            error_msg = f"Safetensors file is corrupted or truncated ({damage})"
            with facade.download_lock:
                state = facade.download_progress.get(download_id)
                if state is not None:
                    state["status"] = "error"
                    state["error"] = error_msg
                    state["speed"] = 0
                    state["sha256_verified"] = False
            log.error(f"✗ Hugging Face worker download rejected: {filename} - {error_msg}")
            return {
                "success": False,
                "download_id": download_id,
                "path": dest_path,
                "error": error_msg,
                "sha256_verified": False,
            }

    # Compute actual SHA-256 when expected_sha256 is present to verify file integrity
    actual_sha256: Optional[str] = None
    sha256_verified: Optional[bool] = None
    if expected_sha256:
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "verifying"
                state["speed"] = 0
        try:
            import hashlib
            hasher = hashlib.sha256()
            with open(result_path, "rb") as fh:
                while True:
                    chunk = fh.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    hasher.update(chunk)
            actual_sha256 = hasher.hexdigest().lower()
            expected_norm = str(expected_sha256).strip().lower()
            if actual_sha256 != expected_norm:
                _remove_staging(staging)
                error_msg = (
                    f"SHA256 mismatch: expected {expected_norm[:16]}..., "
                    f"got {actual_sha256[:16]}..."
                )
                with facade.download_lock:
                    state = facade.download_progress.get(download_id)
                    if state is not None:
                        state["status"] = "error"
                        state["error"] = error_msg
                        state["speed"] = 0
                        state["sha256"] = actual_sha256
                        state["expected_sha256"] = expected_norm
                        state["sha256_verified"] = False
                log.error(f"✗ Hugging Face worker download rejected: {filename} - {error_msg}")
                return {
                    "success": False,
                    "download_id": download_id,
                    "path": dest_path,
                    "error": error_msg,
                    "sha256": actual_sha256,
                    "expected_sha256": expected_norm,
                    "sha256_verified": False,
                }
            sha256_verified = True
        except Exception as hash_exc:
            log.warning(f"Could not verify SHA256 for {filename}: {hash_exc}")

    try:
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        try:
            os.replace(result_path, dest_path)
        except OSError as replace_err:
            import errno
            if replace_err.errno == errno.EXDEV:
                shutil.move(result_path, dest_path)
            else:
                raise
    except Exception as e:
        _remove_staging(staging)
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state["status"] = "error"
                state["error"] = f"Could not move downloaded file into place: {e}"
        return {"success": False, "download_id": download_id, "path": dest_path, "error": str(e)}

    # Only remove our isolated per-download staging directory; never wipe the
    # global ~/.cache/huggingface/hub repo folder (breaks concurrent downloads
    # from the same repo and deletes other tools' cached models).
    _remove_staging(staging)
    file_size = os.path.getsize(dest_path) if os.path.exists(dest_path) else total_size

    verified_sha256 = actual_sha256 if sha256_verified else None
    metadata_path = None
    if hasattr(facade, "write_model_resolver_metadata"):
        metadata_for_sidecar = dict(metadata) if isinstance(metadata, dict) else {}
        if verified_sha256:
            metadata_for_sidecar["sha256"] = verified_sha256
            metadata_for_sidecar["hash"] = verified_sha256
        metadata_path = facade.write_model_resolver_metadata(
            dest_path,
            metadata_for_sidecar,
            category,
            url,
            create_preview=True,
        )

    with facade.download_lock:
        state = facade.download_progress.get(download_id)
        if state is not None:
            state["status"] = "completed"
            state["progress"] = 100
            state["downloaded"] = file_size
            state["total_size"] = file_size
            state["speed"] = 0
            if verified_sha256:
                state["sha256"] = verified_sha256
                state["expected_sha256"] = expected_sha256
                state["sha256_verified"] = True
                state["sha256_source"] = "verified_file"
            if metadata_path:
                state["metadata_path"] = metadata_path

    if hasattr(facade, "invalidate_model_caches"):
        facade.invalidate_model_caches()

    log.info(f"✓ Hugging Face worker download complete: {filename}")
    return {
        "success": True,
        "download_id": download_id,
        "path": dest_path,
        "size": file_size,
        "metadata_path": metadata_path,
        "sha256": verified_sha256,
        "expected_sha256": expected_sha256,
        "sha256_verified": sha256_verified,
    }

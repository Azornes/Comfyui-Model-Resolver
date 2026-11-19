"""
Standalone worker for downloading a single file from HuggingFace via huggingface_hub.

Launched via `sys.executable <this file>` in its own OS process to allow immediate,
reliable cancellation (OS-level kill) and avoid monkeypatching internal packages.
"""

import json
import sys
import time


def emit(event: str, **fields) -> None:
    sys.stdout.write(json.dumps({"event": event, "t": time.time(), **fields}) + "\n")
    sys.stdout.flush()


def log(message: str, **fields) -> None:
    emit("log", message=message, **fields)


class _ProgressTqdm:
    """tqdm-compatible shim for hf_hub_download's tqdm_class hook."""

    _active_max_total: int = 0

    def __init__(self, *args, **kwargs):
        self.total = kwargs.get("total") or 0
        self._reconstruction_n = 0
        self._transfer_n = 0
        self.n = 0
        self._last_emit = 0.0
        if self.total and self.total > _ProgressTqdm._active_max_total:
            _ProgressTqdm._active_max_total = self.total

    def _is_primary_bar(self) -> bool:
        if _ProgressTqdm._active_max_total <= 0:
            return True
        if not self.total:
            return False
        return self.total >= _ProgressTqdm._active_max_total

    def _report(self, force: bool = False) -> None:
        self.n = max(self._reconstruction_n, self._transfer_n)
        if not self._is_primary_bar():
            return
        now = time.monotonic()
        if force or now - self._last_emit >= 0.2:
            self._last_emit = now
            emit("progress", n=self.n, total=self.total)

    def update(self, n: int = 1) -> None:
        self._reconstruction_n += n
        self._report()

    def update_transfer(self, n: int = 1) -> None:
        self._transfer_n += n
        self._report()

    def set_transfer_postfix_str(self, *args, **kwargs) -> None:
        pass

    def close(self) -> None:
        self._report(force=True)

    def set_description(self, *args, **kwargs) -> None:
        pass

    def set_postfix_str(self, *args, **kwargs) -> None:
        pass

    def set_postfix(self, *args, **kwargs) -> None:
        pass

    def refresh(self, *args, **kwargs) -> None:
        pass

    def __getattr__(self, name: str):
        if name.startswith("set_"):
            return lambda *args, **kwargs: None
        raise AttributeError(name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _http_error_message(status: int | None, has_token: bool) -> str | None:
    if status in (401, 403):
        if has_token:
            return (
                f"HuggingFace rejected the token (HTTP {status}) - check it in Model Resolver settings, "
                "and accept the model's license terms on its HuggingFace page."
            )
        return f"HuggingFace token required (HTTP {status}) - add one in Model Resolver settings."
    if status == 404:
        return "Model not found (HTTP 404): the file may have been moved or deleted."
    return None


_GATED_MARKERS = (
    "gated",
    "restricted",
    "authorized list",
    "ask for access",
    "request access",
    "agreement",
    "license",
    "terms",
    "conditions",
)


def main() -> None:
    raw_input = sys.stdin.readline()
    if not raw_input:
        emit("error", message="No download request received on stdin")
        return

    try:
        request = json.loads(raw_input)
    except Exception as e:
        emit("error", message=f"Invalid request JSON: {e}")
        return

    repo_id = request.get("repo_id")
    filename = request.get("filename")
    revision = request.get("revision") or "main"
    local_dir = request.get("local_dir")
    token = request.get("token", False)

    if not repo_id or not filename or not local_dir:
        emit("error", message="Missing required fields (repo_id, filename, local_dir)")
        return

    try:
        import huggingface_hub
        from huggingface_hub.errors import HfHubHTTPError
    except Exception as e:
        emit("error", message=f"huggingface_hub is not available in this environment: {e}")
        return

    t0 = time.time()
    try:
        path = huggingface_hub.hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            revision=revision,
            local_dir=local_dir,
            token=token,
            tqdm_class=_ProgressTqdm,
        )
        log("download finished", elapsed=round(time.time() - t0, 2))
        emit("done", path=path)
    except HfHubHTTPError as e:
        status = getattr(e.response, "status_code", None)
        err_lower = str(e).lower()
        is_gated = any(m in err_lower for m in _GATED_MARKERS)
        if token and status in (401, 403) and not is_gated:
            log(f"Token rejected for repository (HTTP {status}), retrying anonymously...")
            _ProgressTqdm._active_max_total = 0
            try:
                path = huggingface_hub.hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    local_dir=local_dir,
                    token=False,
                    tqdm_class=_ProgressTqdm,
                )
                log("anonymous download finished", elapsed=round(time.time() - t0, 2))
                emit("done", path=path)
                return
            except Exception as anon_exc:
                log(f"Anonymous retry failed: {anon_exc}")
        emit("error", message=_http_error_message(status, bool(token)) or str(e), status=status)
    except Exception as e:
        err_lower = str(e).lower()
        is_gated = any(m in err_lower for m in _GATED_MARKERS)
        resp_status = getattr(getattr(e, "response", None), "status_code", None)
        is_auth_error = resp_status in (401, 403) or any(
            marker in err_lower
            for marker in (
                "401 client error",
                "403 client error",
                "http 401",
                "http 403",
                "invalid username or password",
                "unauthorized",
            )
        )
        if token and is_auth_error and not is_gated:
            log("Token error, retrying anonymously...")
            _ProgressTqdm._active_max_total = 0
            try:
                path = huggingface_hub.hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    local_dir=local_dir,
                    token=False,
                    tqdm_class=_ProgressTqdm,
                )
                log("anonymous download finished", elapsed=round(time.time() - t0, 2))
                emit("done", path=path)
                return
            except Exception as anon_exc:
                log(f"Anonymous retry failed: {anon_exc}")
        emit("error", message=str(e))


if __name__ == "__main__":
    main()

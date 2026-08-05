"""Low-level aria2 helpers used by the downloader facade."""

import socket
from typing import Any, Dict, Optional

from ..log_system import create_module_logger
from .state import create_initial_progress

log = create_module_logger("core.downloader")


class Aria2Error(RuntimeError):
    """Raised when the aria2 backend cannot start or process a request."""


def _require_dependencies(dependencies: Any) -> Any:
    """Return explicitly supplied services for the aria2 backend."""
    if dependencies is None:
        raise RuntimeError("aria2 backend dependencies were not provided")
    return dependencies


def try_certifi_ca_path(*, dependencies: Any = None) -> str:
    """Return certifi's CA bundle path when it is available."""
    facade = _require_dependencies(dependencies)
    try:
        import certifi  # type: ignore

        path = certifi.where()
        return path if path and facade.os.path.isfile(path) else ""
    except Exception:
        return ""


def resolve_aria2c_executable(
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> str:
    """Resolve aria2c while restricting explicit paths to the managed install."""
    facade = _require_dependencies(dependencies)
    active_settings = (
        settings if isinstance(settings, dict) else facade.load_settings()
    )
    configured = str(active_settings.get("aria2c_path") or "").strip()
    candidate = facade.os.path.expandvars(
        facade.os.path.expanduser(configured or "aria2c")
    )
    expected_names = {"aria2c", "aria2c.exe"}
    candidate_name = facade.get_filename_from_path(candidate).lower()
    has_path_component = bool(
        facade.os.path.isabs(candidate)
        or facade.os.path.dirname(candidate)
        or "/" in candidate
        or "\\" in candidate
    )

    if has_path_component:
        if (
            candidate_name in expected_names
            and facade.os.path.isfile(candidate)
            and facade.is_path_within(candidate, facade.MANAGED_ARIA2_ROOT)
        ):
            return facade.os.path.realpath(facade.os.path.abspath(candidate))
        raise Aria2Error(
            "Custom aria2c paths are restricted to the managed Model Resolver install. "
            "Use the built-in aria2 installer or place aria2c on PATH."
        )

    if candidate_name in expected_names:
        resolved = facade.shutil.which(candidate)
        if resolved and facade.get_filename_from_path(resolved).lower() in expected_names:
            return facade.os.path.realpath(facade.os.path.abspath(resolved))

    raise Aria2Error(
        "aria2c executable was not found. Use the built-in installer or place aria2c on PATH."
    )


def find_free_port() -> int:
    """Return an unused local TCP port for the aria2 RPC endpoint."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def parse_aria2_int(value: Any) -> int:
    """Parse an aria2 numeric field without propagating malformed values."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def is_aria2_missing_control_file_error(error: Any) -> bool:
    """Identify aria2's stale-output error caused by a missing .aria2 file."""
    message = str(error or "").lower()
    return (
        "control file" in message
        and "does not exist" in message
        and "allow-overwrite" in message
    )


def resolve_aria2_completed_path(status: Dict[str, Any], default_path: str) -> str:
    """Use aria2's completed file path when it reports one."""
    files = status.get("files")
    if isinstance(files, list) and files:
        first = files[0]
        if isinstance(first, dict):
            candidate = first.get("path")
            if isinstance(candidate, str) and candidate:
                return candidate
    return default_path


def delete_partial_download_files(
    dest_path: str,
    *,
    dependencies: Any = None,
) -> None:
    """Delete an incomplete model and its aria2 control sidecar."""
    facade = _require_dependencies(dependencies)
    for path in (dest_path, f"{dest_path}.aria2"):
        try:
            if path and facade.os.path.exists(path):
                facade.os.remove(path)
        except Exception as exc:
            log.warning(f"Could not delete incomplete download file {path}: {exc}")


def delete_python_partial_download_file(
    partial_path: str,
    *,
    dependencies: Any = None,
) -> None:
    """Remove a partial Python download without touching the final model path."""
    facade = _require_dependencies(dependencies)
    try:
        if partial_path and facade.os.path.exists(partial_path):
            facade.os.remove(partial_path)
    except Exception as exc:
        log.warning(
            f"Could not delete incomplete Python download file {partial_path}: {exc}"
        )


def delete_xet_partial_file(
    partial_path: str,
    attempts: int = 5,
    *,
    dependencies: Any = None,
) -> bool:
    """Delete a stopped Xet partial file, retrying while Windows releases it."""
    facade = _require_dependencies(dependencies)
    attempts = max(1, int(attempts or 1))
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            if not facade.os.path.exists(partial_path):
                return True
            facade.os.remove(partial_path)
            return True
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                facade.time.sleep(0.25)

    log.warning(f"Could not delete incomplete Xet file {partial_path}: {last_error}")
    return False


def aria2_action_error_is_ok(status: str, message: str) -> bool:
    """Recognize idempotent aria2 pause/resume errors."""
    lowered = str(message or "").lower()
    if status == "paused":
        return "already paused" in lowered or "is paused" in lowered
    if status == "downloading":
        return "not paused" in lowered or "has not been paused" in lowered
    return False


def resolve_download_url_for_aria2(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    *,
    dependencies: Any = None,
) -> tuple[str, Dict[str, str]]:
    """Preflight an aria2 URL and validate every redirect before RPC handoff."""
    facade = _require_dependencies(dependencies)
    request_headers = facade.build_download_headers(url, headers)
    source_host = facade.urlparse(str(url or "")).hostname
    is_huggingface_source = facade.host_matches_domain(
        source_host,
        "huggingface.co",
    )
    response = None
    try:
        response, resolved_url, resolved_headers = facade.request_public_url(
            "GET",
            url,
            headers=request_headers,
            timeout=20,
            stream=True,
            trusted_sensitive_redirect_hosts=(
                facade.HF_XET_ARIA2_AUTH_HOSTS
                if is_huggingface_source
                else None
            ),
            trusted_sensitive_redirect_headers=(
                {"authorization"} if is_huggingface_source else None
            ),
        )
        response.raise_for_status()
        return resolved_url, resolved_headers
    finally:
        if response is not None:
            response.close()


def read_aria2_version(executable: str, *, dependencies: Any = None) -> str:
    """Read the installed aria2 version without raising process errors."""
    facade = _require_dependencies(dependencies)
    if not executable:
        return ""
    try:
        kwargs: Dict[str, Any] = {}
        if facade.os.name == "nt":
            kwargs["creationflags"] = getattr(
                facade.subprocess,
                "CREATE_NO_WINDOW",
                0,
            )
        result = facade.subprocess.run(
            [executable, "--version"],
            stdout=facade.subprocess.PIPE,
            stderr=facade.subprocess.STDOUT,
            text=True,
            timeout=5,
            check=False,
            **kwargs,
        )
    except Exception:
        return ""

    first_line = ""
    for line in str(result.stdout or "").splitlines():
        text = line.strip()
        if text:
            first_line = text
            break
    if not first_line:
        return ""

    for token in first_line.replace(",", " ").split():
        if token and token[0].isdigit():
            return token
    return first_line


def get_aria2_status(
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Return aria2 availability, daemon and active-transfer information."""
    facade = _require_dependencies(dependencies)
    active_settings = (
        settings if isinstance(settings, dict) else facade.load_settings()
    )
    configured_path = str(active_settings.get("aria2c_path") or "").strip()
    try:
        resolved_path = facade._resolve_aria2c_executable(
            active_settings,
        )
        available = True
        version = facade._read_aria2_version(
            resolved_path,
        )
        error = ""
    except Exception as exc:
        resolved_path = ""
        available = False
        version = ""
        error = str(exc)

    with facade.aria2_lock:
        process = facade.aria2_process
        running = process is not None and process.poll() is None
        if not running and process is not None:
            facade.aria2_process = None
            facade.aria2_process_started_by_resolver = False
        managed = bool(running and facade.aria2_process_started_by_resolver)
        active_transfers = len(facade.aria2_transfers)

    return {
        "backend": facade._download_backend_from_settings(active_settings),
        "configured_path": configured_path,
        "resolved_path": resolved_path,
        "available": available,
        "version": version,
        "running": running,
        "managed": managed,
        "can_stop": bool(managed and active_transfers == 0),
        "active_transfers": active_transfers,
        "auto_stop_enabled": bool(active_settings.get("aria2_auto_stop_daemon", True)),
        "idle_stop_seconds": facade.ARIA2_IDLE_STOP_SECONDS,
        "error": error,
    }


def aria2_rpc(
    method: str,
    params: Optional[list[Any]] = None,
    *,
    dependencies: Any = None,
) -> Any:
    """Call the local aria2 JSON-RPC endpoint."""
    facade = _require_dependencies(dependencies)
    if not facade.aria2_rpc_url:
        raise Aria2Error("aria2 RPC endpoint is not initialized")

    payload = {
        "jsonrpc": "2.0",
        "id": facade.secrets.token_hex(8),
        "method": method,
        "params": [f"token:{facade.aria2_rpc_secret}", *(params or [])],
    }
    with facade.aria2_rpc_lock:
        response = facade.requests.post(
            facade.aria2_rpc_url,
            json=payload,
            timeout=facade.ARIA2_RPC_TIMEOUT,
        )
        text = response.text
        try:
            body = response.json()
        except ValueError as exc:
            raise Aria2Error(
                f"aria2 RPC returned non-JSON response ({response.status_code}): {text[:300]}"
            ) from exc

        if "error" in body:
            error = body.get("error") or {}
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise Aria2Error(message or f"aria2 RPC {method} failed")

        if response.status_code != 200:
            raise Aria2Error(
                f"aria2 RPC {method} returned HTTP {response.status_code}: {text[:300]}"
            )

        return body.get("result")


def aria2_ping(*, dependencies: Any = None) -> bool:
    """Check whether the local aria2 RPC endpoint responds."""
    facade = _require_dependencies(dependencies)
    try:
        result = facade._aria2_rpc(
            "aria2.getVersion",
            [],
        )
        return isinstance(result, dict)
    except Exception:
        return False


def cancel_aria2_idle_timer_locked(*, dependencies: Any = None) -> None:
    """Cancel the pending idle timer while holding the aria2 lock."""
    facade = _require_dependencies(dependencies)
    if facade.aria2_idle_timer is not None:
        facade.aria2_idle_timer.cancel()
        facade.aria2_idle_timer = None


def aria2_has_active_transfers_locked(*, dependencies: Any = None) -> bool:
    """Return whether aria2 has active resolver-owned transfers."""
    facade = _require_dependencies(dependencies)
    return bool(facade.aria2_transfers)


def stop_aria2_daemon(
    reason: str = "manual",
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Stop the aria2 RPC process started by Model Resolver."""
    facade = _require_dependencies(dependencies)
    with facade.aria2_lock:
        facade._cancel_aria2_idle_timer_locked()
        process = facade.aria2_process
        running = process is not None and process.poll() is None
        if not running:
            facade.aria2_process = None
            facade.aria2_rpc_url = ""
            facade.aria2_rpc_secret = ""
            facade.aria2_process_started_by_resolver = False
            return {
                "success": True,
                "stopped": False,
                "message": "aria2 daemon is not running",
            }

        if not facade.aria2_process_started_by_resolver:
            return {
                "success": False,
                "stopped": False,
                "error": "This aria2 daemon was not started by Model Resolver.",
            }

        if facade._aria2_has_active_transfers_locked():
            return {
                "success": False,
                "stopped": False,
                "error": "aria2 daemon has active downloads.",
            }

        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=2)
            except Exception:
                pass

        facade.aria2_process = None
        facade.aria2_rpc_url = ""
        facade.aria2_rpc_secret = ""
        facade.aria2_process_started_by_resolver = False

    log.info(f"aria2 RPC daemon stopped ({reason})")
    return {"success": True, "stopped": True, "message": "aria2 daemon stopped"}


def start_aria2_daemon(
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Start the aria2 RPC process without creating a download."""
    facade = _require_dependencies(dependencies)
    active_settings = (
        settings if isinstance(settings, dict) else facade.load_settings()
    )
    try:
        facade._ensure_aria2_daemon(
            active_settings,
        )
        status = facade.get_aria2_status(
            active_settings,
        )
        return {
            **status,
            "success": True,
            "started": bool(status.get("running")),
            "message": "aria2 daemon is running",
        }
    except Exception as exc:
        try:
            status = facade.get_aria2_status(
                active_settings,
            )
        except Exception:
            status = {}
        return {
            **status,
            "success": False,
            "started": False,
            "error": str(exc),
        }


def aria2_idle_stop_worker(*, dependencies: Any = None) -> None:
    """Stop a resolver-owned daemon after its idle timeout."""
    facade = _require_dependencies(dependencies)
    with facade.aria2_lock:
        facade.aria2_idle_timer = None

    settings = facade.load_settings()
    if not settings.get("aria2_auto_stop_daemon", True):
        return
    with facade.aria2_lock:
        process = facade.aria2_process
        running = process is not None and process.poll() is None
        if (
            not running
            or not facade.aria2_process_started_by_resolver
            or facade._aria2_has_active_transfers_locked()
        ):
            return
    facade.stop_aria2_daemon(reason="idle")


def schedule_aria2_idle_stop(*, dependencies: Any = None) -> None:
    """Schedule daemon shutdown when no resolver transfer remains active."""
    facade = _require_dependencies(dependencies)
    settings = facade.load_settings()
    if not settings.get("aria2_auto_stop_daemon", True):
        return
    with facade.aria2_lock:
        facade._cancel_aria2_idle_timer_locked()
        process = facade.aria2_process
        running = process is not None and process.poll() is None
        if (
            not running
            or not facade.aria2_process_started_by_resolver
            or facade._aria2_has_active_transfers_locked()
        ):
            return
        facade.aria2_idle_timer = facade.threading.Timer(
            facade.ARIA2_IDLE_STOP_SECONDS,
            facade._aria2_idle_stop_worker,
        )
        facade.aria2_idle_timer.daemon = True
        facade.aria2_idle_timer.start()


def ensure_aria2_daemon(
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> None:
    """Start or reuse the resolver-owned aria2 daemon."""
    facade = _require_dependencies(dependencies)
    active_settings = (
        settings if isinstance(settings, dict) else facade.load_settings()
    )
    with facade.aria2_lock:
        facade._cancel_aria2_idle_timer_locked()
        process = facade.aria2_process
        if (
            process is not None
            and process.poll() is None
            and facade._aria2_ping()
        ):
            return

        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass
        facade.aria2_process = None
        facade.aria2_process_started_by_resolver = False

        executable = facade._resolve_aria2c_executable(
            active_settings,
        )
        port = facade._find_free_port()
        facade.aria2_rpc_secret = facade.secrets.token_hex(16)
        facade.aria2_rpc_url = f"http://127.0.0.1:{port}/jsonrpc"

        command = [
            executable,
            "--enable-rpc=true",
            "--rpc-listen-all=false",
            f"--rpc-listen-port={port}",
            f"--rpc-secret={facade.aria2_rpc_secret}",
            "--check-certificate=true",
            "--allow-overwrite=true",
            "--auto-file-renaming=false",
            "--file-allocation=none",
            "--max-concurrent-downloads=5",
            "--continue=true",
            "--daemon=false",
            "--quiet=true",
            f"--stop-with-process={facade.os.getpid()}",
        ]
        ca_cert = facade._try_certifi_ca_path()
        if ca_cert:
            command.insert(5, f"--ca-certificate={ca_cert}")

        creationflags = 0
        if facade.os.name == "nt":
            creationflags = getattr(facade.subprocess, "CREATE_NO_WINDOW", 0)

        log.info(f"Starting aria2 RPC daemon from {executable}")
        facade.aria2_process = facade.subprocess.Popen(
            command,
            stdout=facade.subprocess.DEVNULL,
            stderr=facade.subprocess.PIPE,
            creationflags=creationflags,
        )
        facade.aria2_process_started_by_resolver = True

        start_time = facade.time.time()
        last_error = ""
        while facade.time.time() - start_time < 10:
            process = facade.aria2_process
            if process.poll() is not None:
                stderr = ""
                try:
                    stderr = (
                        process.stderr.read() if process.stderr else b""
                    ).decode("utf-8", errors="replace")
                except Exception:
                    stderr = ""
                raise Aria2Error(
                    "aria2 RPC process exited early with code "
                    f"{process.returncode}: {stderr.strip()}"
                )
            try:
                if facade._aria2_ping():
                    return
            except Exception as exc:
                last_error = str(exc)
            facade.time.sleep(0.2)

        raise Aria2Error(
            "Timed out waiting for aria2 RPC to become ready"
            f"{': ' + last_error if last_error else ''}"
        )


def recover_aria2_missing_control_file(
    download_id: str,
    gid: str,
    settings: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> bool:
    """Restart a stale resolver daemon when a download loses its control file."""
    facade = _require_dependencies(dependencies)
    with facade.aria2_lock:
        other_transfers = [
            active_id
            for active_id in facade.aria2_transfers
            if active_id != download_id
        ]
        if other_transfers:
            log.warning(
                "Skipping automatic aria2 recovery because other downloads are active: "
                f"{', '.join(other_transfers)}"
            )
            return False
        facade.aria2_transfers.pop(download_id, None)

    try:
        if gid:
            try:
                facade._aria2_rpc(
                    "aria2.removeDownloadResult",
                    [gid],
                )
            except Exception as exc:
                log.debug(f"Could not remove stale aria2 result {gid}: {exc}")

        stopped = facade.stop_aria2_daemon(reason="stale-control-file")
        if not stopped.get("success"):
            log.warning(
                "Could not restart aria2 for stale control-file recovery: "
                f"{stopped.get('error') or stopped.get('message') or 'unknown error'}"
            )
            return False

        facade._ensure_aria2_daemon(settings)
        log.info(
            "Restarted aria2 after detecting a missing control file; "
            f"retrying download {download_id}"
        )
        return True
    except Exception as exc:
        log.warning(f"Automatic aria2 recovery failed for {download_id}: {exc}")
        return False


def aria2_tell_status(gid: str, *, dependencies: Any = None) -> Dict[str, Any]:
    """Read an aria2 transfer status with retries for transient resets."""
    facade = _require_dependencies(dependencies)
    keys = [
        "gid",
        "status",
        "totalLength",
        "completedLength",
        "downloadSpeed",
        "connections",
        "errorMessage",
        "files",
    ]
    for attempt in range(facade.ARIA2_STATUS_RPC_RETRIES):
        try:
            result = facade._aria2_rpc(
                "aria2.tellStatus",
                [gid, keys],
            )
            return result if isinstance(result, dict) else {}
        except (facade.requests.exceptions.ConnectionError, facade.requests.exceptions.Timeout):
            if attempt + 1 >= facade.ARIA2_STATUS_RPC_RETRIES:
                raise
            log.debug(
                f"Retrying aria2 status RPC for {gid} "
                f"({attempt + 2}/{facade.ARIA2_STATUS_RPC_RETRIES})"
            )
            facade.time.sleep(facade.ARIA2_STATUS_RPC_RETRY_DELAY * (attempt + 1))

    return {}


def download_file_with_aria2(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Download a file with an aria2c JSON-RPC process."""
    facade = _require_dependencies(dependencies)
    settings = facade.load_settings()
    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }
    start_time = facade.time.time()
    filename = facade.get_filename_from_path(dest_path)
    expected_sha256 = facade._extract_expected_sha256(metadata)

    with facade.download_lock:
        facade.download_progress[download_id] = create_initial_progress(
            url=url,
            path=dest_path,
            filename=filename,
            directory=facade.os.path.dirname(dest_path),
            download_backend="aria2",
            start_time=start_time,
        )

    try:
        facade.os.makedirs(facade.os.path.dirname(dest_path), exist_ok=True)
        facade._ensure_aria2_daemon(
            settings,
        )
        aria2_url, request_headers = facade._resolve_download_url_for_aria2(
            url,
            headers,
        )

        options: Dict[str, Any] = {
            "dir": facade.os.path.dirname(dest_path),
            "out": filename,
            "continue": "true",
            "max-connection-per-server": "4",
            "split": "4",
            "min-split-size": "1M",
            "allow-overwrite": "true",
            "auto-file-renaming": "false",
            "file-allocation": "none",
            "no-want-digest-header": "true",
            # Redirects were already resolved and validated above. Keeping them
            # disabled prevents sensitive headers from reaching another host.
            "max-redirect": "0",
        }
        if expected_sha256:
            # Let aria2 verify the file as part of the transfer instead of
            # requiring a second Python pass over a multi-gigabyte model.
            options["checksum"] = f"sha-256={expected_sha256}"
            options["check-integrity"] = "true"
        user_agent = facade._get_header_value(request_headers, "User-Agent")
        referer = facade._get_header_value(request_headers, "Referer")
        if user_agent:
            options["user-agent"] = user_agent
        if referer:
            options["referer"] = referer

        header_values = [
            f"{key}: {value}"
            for key, value in request_headers.items()
            if str(key).lower() not in {"user-agent", "referer"}
        ]
        if header_values:
            options["header"] = header_values

        def add_aria2_transfer() -> str:
            new_gid = facade._aria2_rpc(
                "aria2.addUri",
                [[aria2_url], options],
            )
            if not isinstance(new_gid, str) or not new_gid:
                raise Aria2Error("aria2 did not return a download gid")

            with facade.aria2_lock:
                facade.aria2_transfers[download_id] = {
                    "gid": new_gid,
                    "path": dest_path,
                }
            with facade.download_lock:
                facade.download_progress[download_id].update(
                    {
                        "aria2_gid": new_gid,
                        "status": "downloading",
                        "error": None,
                        "progress": 0,
                        "downloaded": 0,
                        "total_size": 0,
                        "speed": 0,
                    }
                )
            return new_gid

        recovery_attempted = False
        try:
            gid = add_aria2_transfer()
        except Exception as exc:
            if (
                not recovery_attempted
                and download_id not in facade.cancelled_downloads
                and facade._is_aria2_missing_control_file_error(exc)
            ):
                recovery_attempted = True
                facade._set_download_progress_status(
                    download_id,
                    "starting",
                    error=None,
                    speed=0,
                )
                if facade._recover_aria2_missing_control_file(
                    download_id,
                    "",
                    settings,
                ):
                    gid = add_aria2_transfer()
                else:
                    raise
            else:
                raise

        log.info(f"Starting aria2 download: {filename}")
        last_cli_log = start_time

        while True:
            if download_id in facade.cancelled_downloads:
                try:
                    facade._aria2_rpc(
                        "aria2.forceRemove",
                        [gid],
                    )
                except Exception:
                    pass
                with facade.download_lock:
                    if download_id in facade.download_progress:
                        facade.download_progress[download_id]["status"] = "cancelled"
                        facade.download_progress[download_id]["speed"] = 0
                facade._delete_partial_download_files(
                    dest_path,
                )
                facade.cancelled_downloads.discard(download_id)
                result["error"] = "Download cancelled"
                return result

            status = facade._aria2_tell_status(
                gid,
            )
            state = str(status.get("status") or "")
            total_size = facade._parse_aria2_int(status.get("totalLength"))
            downloaded = facade._parse_aria2_int(status.get("completedLength"))
            speed = facade._parse_aria2_int(status.get("downloadSpeed"))
            connections = facade._parse_aria2_int(status.get("connections"))
            progress = int((downloaded / total_size) * 100) if total_size > 0 else 0
            mapped_status = {
                "active": "downloading",
                "waiting": "downloading",
                "paused": "paused",
                "complete": "completed",
                "error": "error",
                "removed": "cancelled",
            }.get(state, state or "downloading")

            with facade.download_lock:
                if download_id in facade.download_progress:
                    facade.download_progress[download_id].update(
                        {
                            "status": mapped_status,
                            "progress": max(0, min(progress, 100)),
                            "total_size": total_size,
                            "downloaded": downloaded,
                            "speed": (
                                0
                                if mapped_status in {"paused", "completed"}
                                else speed
                            ),
                            "connections": connections,
                            "download_backend": "aria2",
                            "aria2_gid": gid,
                        }
                    )

            now = facade.time.time()
            if (
                now - last_cli_log >= facade.CLI_LOG_INTERVAL
                and mapped_status == "downloading"
            ):
                last_cli_log = now
                total_str = facade.format_bytes(total_size) if total_size else "?"
                log.info(
                    "aria2 progress: "
                    f"{facade.format_bytes(downloaded)} / {total_str} "
                    f"({progress}%) - {facade.format_bytes(speed)}/s"
                )

            if state == "complete":
                completed_path = facade._resolve_aria2_completed_path(
                    status,
                    dest_path,
                )
                size = (
                    facade.os.path.getsize(completed_path)
                    if facade.os.path.exists(completed_path)
                    else downloaded
                )
                metadata_path = facade.write_model_resolver_metadata(
                    completed_path,
                    metadata or {},
                    category,
                    url,
                    create_preview=True,
                )
                with facade.download_lock:
                    facade.download_progress[download_id].update(
                        {
                            "status": "completed",
                            "progress": 100,
                            "downloaded": size,
                            "total_size": total_size or size,
                            "speed": 0,
                            "path": completed_path,
                            "directory": facade.os.path.dirname(completed_path),
                        }
                    )
                    if metadata_path:
                        facade.download_progress[download_id][
                            "metadata_path"
                        ] = metadata_path
                result.update(
                    {
                        "success": True,
                        "path": completed_path,
                        "size": size,
                        "metadata_path": metadata_path,
                    }
                )
                elapsed = facade.time.time() - start_time
                avg_speed = size / elapsed if elapsed > 0 else 0
                log.info(f"✓ aria2 download complete: {filename}")
                log.info(
                    f"Size: {facade.format_bytes(size)}, Time: {elapsed:.1f}s, "
                    f"Avg speed: {facade.format_bytes(int(avg_speed))}/s"
                )
                facade.invalidate_model_files_cache()
                facade.invalidate_local_hash_match_cache()
                return result

            if state == "error":
                error_msg = status.get("errorMessage") or "aria2 download failed"
                if (
                    not recovery_attempted
                    and download_id not in facade.cancelled_downloads
                    and facade._is_aria2_missing_control_file_error(error_msg)
                ):
                    recovery_attempted = True
                    facade._set_download_progress_status(
                        download_id,
                        "starting",
                        error=None,
                        speed=0,
                    )
                    recovered = facade._recover_aria2_missing_control_file(
                        download_id,
                        gid,
                        settings,
                    )
                    if recovered:
                        gid = add_aria2_transfer()
                        continue
                with facade.download_lock:
                    facade.download_progress[download_id]["status"] = "error"
                    facade.download_progress[download_id]["error"] = error_msg
                result["error"] = error_msg
                return result

            if state == "removed":
                with facade.download_lock:
                    facade.download_progress[download_id]["status"] = "cancelled"
                    facade.download_progress[download_id]["speed"] = 0
                facade._delete_partial_download_files(
                    dest_path,
                )
                facade.cancelled_downloads.discard(download_id)
                result["error"] = "Download cancelled"
                return result

            facade.time.sleep(0.5)

    except Exception as exc:
        error_msg = facade._sanitize_download_error(exc)
        with facade.download_lock:
            if download_id in facade.download_progress:
                facade.download_progress[download_id]["status"] = "error"
                facade.download_progress[download_id]["error"] = error_msg
                facade.download_progress[download_id]["speed"] = 0
        result["error"] = error_msg
        log.error(f"✗ aria2 download failed: {filename}")
        log.error(f"Error: {error_msg}")
        return result
    finally:
        with facade.aria2_lock:
            facade.aria2_transfers.pop(download_id, None)
            facade.aria2_action_locks.pop(download_id, None)
            facade.aria2_desired_states.pop(download_id, None)
        facade._schedule_aria2_idle_stop()


def force_remove_aria2_transfer(
    download_id: str,
    gid: str,
    *,
    dependencies: Any = None,
) -> None:
    """Request removal of an active aria2 transfer."""
    facade = _require_dependencies(dependencies)
    try:
        facade._aria2_rpc(
            "aria2.forceRemove",
            [gid],
        )
    except Exception as exc:
        log.warning(f"Could not cancel aria2 download {download_id}: {exc}")


def get_aria2_action_lock(
    download_id: str,
    *,
    dependencies: Any = None,
) -> Any:
    """Return the per-download lock used to serialize aria2 actions."""
    facade = _require_dependencies(dependencies)
    with facade.aria2_lock:
        lock = facade.aria2_action_locks.get(download_id)
        if lock is None:
            lock = facade.threading.Lock()
            facade.aria2_action_locks[download_id] = lock
        return lock


def set_download_progress_status(
    download_id: str,
    status: str,
    *,
    dependencies: Any = None,
    **updates: Any,
) -> None:
    """Update a download status while holding the progress lock."""
    facade = _require_dependencies(dependencies)
    with facade.download_lock:
        if download_id in facade.download_progress:
            facade.download_progress[download_id]["status"] = status
            facade.download_progress[download_id].update(updates)


def run_aria2_desired_state_worker(
    download_id: str,
    *,
    dependencies: Any = None,
) -> None:
    """Apply the latest queued pause/resume request for a transfer."""
    facade = _require_dependencies(dependencies)
    while True:
        with facade.aria2_lock:
            desired = dict(facade.aria2_desired_states.get(download_id) or {})
        if not desired or download_id in facade.cancelled_downloads:
            with facade.aria2_lock:
                state = facade.aria2_desired_states.get(download_id)
                if state:
                    state["running"] = False
            return

        desired_status = str(desired.get("status") or "")
        desired_seq = int(desired.get("seq") or 0)
        transfer = facade.aria2_transfers.get(download_id)
        gid = transfer.get("gid") if isinstance(transfer, dict) else ""
        if not gid:
            with facade.aria2_lock:
                facade.aria2_desired_states.pop(download_id, None)
            return

        method = "aria2.forcePause" if desired_status == "paused" else "aria2.unpause"
        try:
            with facade._get_aria2_action_lock(
                download_id,
            ):
                facade._aria2_rpc(
                    method,
                    [gid],
                )
            current_speed = facade.download_progress.get(download_id, {}).get(
                "speed",
                0,
            )
            facade._set_download_progress_status(
                download_id,
                desired_status,
                speed=0 if desired_status == "paused" else current_speed,
            )
        except Exception as exc:
            if facade._aria2_action_error_is_ok(
                desired_status,
                str(exc),
            ):
                current_speed = facade.download_progress.get(download_id, {}).get(
                    "speed",
                    0,
                )
                facade._set_download_progress_status(
                    download_id,
                    desired_status,
                    speed=0 if desired_status == "paused" else current_speed,
                )
            else:
                if desired_status == "downloading":
                    facade._set_download_progress_status(
                        download_id,
                        "paused",
                        speed=0,
                    )
                safe_error = facade._sanitize_download_error(exc)
                log.warning(
                    f"aria2 {desired_status} action failed for "
                    f"{download_id}: {safe_error}"
                )

        with facade.aria2_lock:
            latest = facade.aria2_desired_states.get(download_id)
            if not latest:
                return
            if int(latest.get("seq") or 0) == desired_seq:
                facade.aria2_desired_states.pop(download_id, None)
                return


def queue_aria2_desired_state(
    download_id: str,
    status: str,
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Queue an aria2 pause/resume state change and start its worker."""
    facade = _require_dependencies(dependencies)
    transfer = facade.aria2_transfers.get(download_id)
    if not transfer or not transfer.get("gid"):
        return {"success": False, "error": "Download action is not available yet"}

    start_worker = False
    with facade.aria2_lock:
        previous = facade.aria2_desired_states.get(download_id) or {}
        seq = int(previous.get("seq") or 0) + 1
        running = bool(previous.get("running"))
        facade.aria2_desired_states[download_id] = {
            "status": status,
            "seq": seq,
            "running": True,
        }
        start_worker = not running

    current_speed = facade.download_progress.get(download_id, {}).get("speed", 0)
    facade._set_download_progress_status(
        download_id,
        status,
        speed=0 if status == "paused" else current_speed,
    )

    if start_worker:
        facade.threading.Thread(
            target=facade._run_aria2_desired_state_worker,
            args=(download_id,),
            daemon=True,
        ).start()

    message = "Download paused" if status == "paused" else "Download resumed"
    return {"success": True, "message": message}


def _set_aria2_desired_download_state(
    download_id: str,
    status: str,
    *,
    dependencies: Any = None,
) -> Dict[str, Any]:
    facade = _require_dependencies(dependencies)
    if download_id in facade.cancelled_downloads:
        return {"success": False, "error": "Download is being cancelled"}
    return facade._queue_aria2_desired_state(
        download_id,
        status,
    )


def pause_download(download_id: str, *, dependencies: Any = None) -> Dict[str, Any]:
    """Pause an aria2 download. Built-in Python downloads cannot be paused."""
    return _set_aria2_desired_download_state(
        download_id,
        "paused",
        dependencies=dependencies,
    )


def resume_download(download_id: str, *, dependencies: Any = None) -> Dict[str, Any]:
    """Resume a paused aria2 download."""
    return _set_aria2_desired_download_state(
        download_id,
        "downloading",
        dependencies=dependencies,
    )

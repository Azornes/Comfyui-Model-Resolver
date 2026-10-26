"""High-level download orchestration used by the downloader facade."""

import threading
from typing import Any, Callable, Dict, Optional

from .state import create_initial_progress


class DownloadCancelled(Exception):
    """The caller cancelled before the download response became available."""


def parse_retry_after(value: Optional[str]) -> Optional[int]:
    """Parse HTTP Retry-After header into integer seconds."""
    if not value or not str(value).strip():
        return None
    val = str(value).strip()
    try:
        return max(1, int(val))
    except ValueError:
        pass
    try:
        from datetime import datetime, timezone
        from email.utils import parsedate_to_datetime

        parsed = parsedate_to_datetime(val)
        now = datetime.now(timezone.utc)
        if parsed.tzinfo is None:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
        delta = (parsed - now).total_seconds()
        return max(1, int(delta))
    except Exception:
        return None


def request_download_response(facade: Any, download_id: str, url: str, **kwargs: Any):
    """Allow cancellation while waiting for HTTP headers without opening a file."""
    finished = threading.Event()
    guard = threading.Lock()
    outcome = {}
    abandoned = False

    def request():
        try:
            result = facade.request_public_url("GET", url, **kwargs)
            with guard:
                if abandoned:
                    result[0].close()
                else:
                    outcome["result"] = result
        except Exception as exc:
            with guard:
                outcome["error"] = exc
        finally:
            finished.set()

    if download_id in facade.cancelled_downloads:
        raise DownloadCancelled()
    threading.Thread(target=request, daemon=True).start()
    while True:
        finished.wait(0.1)
        with guard:
            if download_id in facade.cancelled_downloads:
                abandoned = True
                if "result" in outcome:
                    outcome.pop("result")[0].close()
                raise DownloadCancelled()
            if finished.is_set():
                if "error" in outcome:
                    raise outcome["error"]
                return outcome["result"]


def find_active_download_for_path(
    download_progress: Dict[str, Dict[str, Any]],
    target_path: str,
    os_module: Any,
    *,
    exclude_id: str = "",
) -> Optional[str]:
    """Return the active download using the same normalized destination path."""
    if not target_path:
        return None
    normalized_target = os_module.path.normcase(
        os_module.path.abspath(target_path)
    )
    terminal_statuses = {"completed", "error", "cancelled"}
    for download_id, progress in download_progress.items():
        if download_id == exclude_id or not isinstance(progress, dict):
            continue
        if str(progress.get("status") or "").lower() in terminal_statuses:
            continue
        existing_path = progress.get("path")
        if not existing_path:
            continue
        normalized_existing = os_module.path.normcase(
            os_module.path.abspath(str(existing_path))
        )
        if normalized_existing == normalized_target:
            return download_id
    return None


def download_file(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    chunk_size: int = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    dependencies: Any = None,
) -> Dict[str, Any]:
    """
    Download a file from URL with progress tracking and speed calculation.

    The caller supplies mutable state and backend helpers explicitly.
    """
    if dependencies is None:
        raise RuntimeError("Download orchestration dependencies were not provided")
    facade = dependencies
    hashlib = facade.hashlib
    os = facade.os
    requests = facade.requests
    time = facade.time
    urlparse = facade.urlparse
    deque = facade.deque
    download_progress = facade.download_progress
    download_lock = facade.download_lock
    cancelled_downloads = facade.cancelled_downloads
    speed_history_size = facade.SPEED_HISTORY_SIZE
    default_chunk_size = facade.CHUNK_SIZE
    cli_log_interval = facade.CLI_LOG_INTERVAL
    log = facade.log

    active_settings = facade.load_settings() if callable(getattr(facade, "load_settings", None)) else {}
    if not isinstance(active_settings, dict):
        active_settings = {}
    connect_timeout = getattr(facade, "PYTHON_DOWNLOAD_CONNECT_TIMEOUT", 20)
    read_timeout = (
        int(active_settings.get("download_stall_timeout") or 0)
        or getattr(facade, "PYTHON_DOWNLOAD_READ_TIMEOUT", 60)
    )

    expected_sha256 = facade._extract_expected_sha256(metadata)

    download_backend = facade._download_backend_from_settings()
    if download_backend != "aria2":
        xet_result = facade._download_huggingface_xet(
            url,
            dest_path,
            download_id,
            headers=headers,
            metadata=metadata,
            category=category,
        )
        if xet_result is not None:
            return xet_result

    if download_backend == "aria2":
        return facade.download_file_with_aria2(
            url,
            dest_path,
            download_id,
            headers=headers,
            metadata=metadata,
            category=category,
        )

    if chunk_size is None:
        chunk_size = default_chunk_size

    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }
    partial_path = f"{dest_path}.part"
    response = None
    published = False

    start_time = time.time()
    speed_history = deque(maxlen=speed_history_size)
    last_speed_update = start_time
    last_downloaded = 0
    last_cli_log = start_time

    register_control = getattr(facade, "register_python_download_control", None)
    control_event = register_control(download_id) if callable(register_control) else None

    with download_lock:
        download_progress[download_id] = create_initial_progress(
            url=url,
            path=dest_path,
            filename=facade.get_filename_from_path(dest_path),
            directory=os.path.dirname(dest_path),
            download_backend="python",
            start_time=start_time,
        )

    try:
        destination_directory = os.path.dirname(dest_path)
        if destination_directory:
            os.makedirs(destination_directory, exist_ok=True)

        existing_size = (
            os.path.getsize(partial_path)
            if os.path.isfile(partial_path)
            else 0
        )

        filename = facade.get_filename_from_path(dest_path)
        source_host = urlparse(url).hostname
        source = (
            "HuggingFace"
            if facade.host_matches_domain(source_host, "huggingface.co")
            else "CivitAI"
            if facade.host_matches_domain(
                source_host,
                "civitai.com",
                "civitai.red",
            )
            else "URL"
        )
        log.info(f"Starting download: {filename}")
        log.info(f"Source: {source}")
        log.info(f"URL: {facade._strip_sensitive_url_params(url)}")

        coordinator_fn = getattr(facade, "get_rate_limit_coordinator", None)
        if callable(coordinator_fn):
            rl = coordinator_fn()
            if rl.is_rate_limited(url):
                cooldown = int(rl.get_cooldown(url))
                if cooldown > 0:
                    error_msg = f"Rate limit exceeded (HTTP 429): please retry after {cooldown}s."
                    with download_lock:
                        download_progress[download_id]["status"] = "error"
                        download_progress[download_id]["error"] = error_msg
                        download_progress[download_id]["speed"] = 0
                    result["error"] = error_msg
                    log.error(f"✗ Download deferred: {filename}")
                    log.error(f"Error: {error_msg}")
                    return result

        guard_fn = getattr(facade, "get_connectivity_guard", None)
        if callable(guard_fn):
            guard = guard_fn()
            if guard.is_offline(url):
                cooldown = int(guard.get_offline_cooldown(url))
                error_msg = f"Network offline: destination in connectivity cooldown ({cooldown}s remaining)."
                with download_lock:
                    download_progress[download_id]["status"] = "error"
                    download_progress[download_id]["error"] = error_msg
                    download_progress[download_id]["speed"] = 0
                result["error"] = error_msg
                log.error(f"✗ Download failed: {filename}")
                log.error(f"Error: {error_msg}")
                return result

        request_headers = facade.build_download_headers(url, headers)
        if existing_size > 0:
            request_headers["Range"] = f"bytes={existing_size}-"
            log.info(
                f"Found partial download ({facade.format_bytes(existing_size)}). "
                "Requesting resume from server..."
            )

        is_already_complete = False
        try:
            response, final_url, _final_headers = request_download_response(
                facade,
                download_id,
                url,
                headers=request_headers,
                stream=True,
                timeout=(connect_timeout, read_timeout),
            )
            response.raise_for_status()
            guard_fn = getattr(facade, "get_connectivity_guard", None)
            if callable(guard_fn):
                guard_fn().record_success(url)
        except requests.exceptions.HTTPError as http_err:
            status_code = getattr(getattr(http_err, "response", None), "status_code", None)
            if existing_size > 0 and status_code == 416:
                known_remote_size = facade.extract_response_file_size(getattr(http_err, "response", None))
                if known_remote_size is None or known_remote_size <= 0:
                    try:
                        check_headers = facade.build_download_headers(url, headers)
                        check_headers.pop("Range", None)
                        check_resp, _check_url, _ = facade.request_public_url(
                            "HEAD",
                            url,
                            headers=check_headers,
                            timeout=(connect_timeout, 15),
                        )
                        if getattr(check_resp, "status_code", None) == 200:
                            known_remote_size = facade.extract_response_file_size(check_resp)
                        check_resp.close()
                    except Exception as head_exc:
                        log.debug(f"HEAD size check on HTTP 416 failed: {head_exc}")
                        known_remote_size = None

                if (
                    known_remote_size is not None
                    and known_remote_size > 0
                    and existing_size == known_remote_size
                ):
                    log.info(
                        f"Server returned HTTP 416 for {filename}, but existing partial file "
                        f"already matches full remote size ({facade.format_bytes(existing_size)}). "
                        "Treating partial file as fully downloaded and proceeding to integrity check."
                    )
                    is_already_complete = True
                    total_size = known_remote_size
                    downloaded = existing_size
                    is_resumed = True
                    response = None
                    final_url = url
                else:
                    log.warning(
                        f"Server rejected byte range {existing_size}- (HTTP 416) for {filename}. "
                        "Resetting partial file and restarting download from beginning."
                    )
                    facade._delete_python_partial_download_file(partial_path)
                    existing_size = 0
                    request_headers.pop("Range", None)
                    response, final_url, _final_headers = request_download_response(
                        facade,
                        download_id,
                        url,
                        headers=request_headers,
                        stream=True,
                        timeout=(connect_timeout, read_timeout),
                    )
                    response.raise_for_status()
            else:
                raise

        if not is_already_complete:
            if final_url != url:
                log.debug("Validated download redirect target")

            is_resumed = bool(
                existing_size > 0 and getattr(response, "status_code", None) == 206
            )
            if not is_resumed and existing_size > 0 and final_url and final_url != url:
                log.info(
                    "Range request was not honored across redirect (HTTP 200). "
                    f"Retrying Range request directly on target URL for {filename}..."
                )
                try:
                    response.close()
                except Exception:
                    pass
                try:
                    retry_resp, retry_final_url, _ = request_download_response(
                        facade,
                        download_id,
                        final_url,
                        headers=request_headers,
                        stream=True,
                        timeout=(connect_timeout, read_timeout),
                    )
                    retry_resp.raise_for_status()
                    if getattr(retry_resp, "status_code", None) == 206:
                        response = retry_resp
                        final_url = retry_final_url
                        is_resumed = True
                        log.info(
                            f"Successfully resumed download from target URL at byte {existing_size}"
                        )
                    else:
                        response = retry_resp
                except Exception as retry_exc:
                    log.debug(f"Direct Range retry on target URL failed: {retry_exc}")

            if not is_resumed and existing_size > 0:
                log.info(
                    f"Server returned HTTP {getattr(response, 'status_code', None)} without partial content support. "
                    "Restarting download from beginning."
                )
                existing_size = 0

            total_size = facade.extract_response_file_size(response) or 0
            if is_resumed and total_size <= existing_size:
                content_len = int(response.headers.get("content-length", 0) or 0)
                if content_len > 0:
                    total_size = existing_size + content_len

            downloaded = existing_size if is_resumed else 0
            last_downloaded = downloaded

        total_size_str = facade.format_bytes(total_size) if total_size > 0 else "unknown"

        with download_lock:
            download_progress[download_id]["total_size"] = total_size
            download_progress[download_id]["downloaded"] = downloaded
            download_progress[download_id]["status"] = (
                "verifying" if (expected_sha256 and is_already_complete) else "downloading"
            )
            if total_size > 0 and downloaded > 0:
                download_progress[download_id]["progress"] = int((downloaded / total_size) * 100)

        if is_resumed:
            resumed_pct = int((downloaded / total_size) * 100) if total_size > 0 else 0
            log.info(
                f"Resuming download: {filename} from {facade.format_bytes(downloaded)} / {total_size_str} ({resumed_pct}%)"
            )
        else:
            log.info(f"Size: {total_size_str}")

        sha256_hasher = hashlib.sha256() if expected_sha256 else None
        if is_resumed and sha256_hasher is not None:
            log.info(
                f"Hashing existing partial file ({facade.format_bytes(downloaded)}) for SHA256 integrity check..."
            )
            with open(partial_path, "rb") as existing_file:
                while True:
                    if download_id in cancelled_downloads:
                        raise DownloadCancelled()
                    existing_chunk = existing_file.read(4 * 1024 * 1024)
                    if not existing_chunk:
                        break
                    sha256_hasher.update(existing_chunk)

        cancelled = False
        if is_already_complete:
            with download_lock:
                download_progress[download_id]["status"] = "verifying" if expected_sha256 else "completed"
                download_progress[download_id]["progress"] = 100
                download_progress[download_id]["speed"] = 0
            if progress_callback:
                progress_callback(downloaded, total_size)
        else:
            max_stream_retries = getattr(facade, "PYTHON_DOWNLOAD_MAX_RETRIES", 2)
            stream_retry_delay = getattr(facade, "PYTHON_DOWNLOAD_RETRY_DELAY", 0.5)
            stream_attempts = 0

            file_mode = "ab" if is_resumed else "wb"
            with open(partial_path, file_mode) as file_handle:
                while True:
                    try:
                        for chunk in response.iter_content(chunk_size=chunk_size):
                            if download_id in cancelled_downloads:
                                cancelled = True
                                break

                            if control_event is not None and not control_event.is_set():
                                file_handle.flush()
                                with download_lock:
                                    if download_id in download_progress:
                                        download_progress[download_id]["status"] = "paused"
                                        download_progress[download_id]["speed"] = 0
                                update_store = getattr(facade, "update_download_progress_state", None)
                                if callable(update_store):
                                    update_store(
                                        download_id,
                                        status="paused",
                                        downloaded=downloaded,
                                        total_size=total_size,
                                    )
                                log.info(
                                    f"Download paused: {filename} at "
                                    f"{facade.format_bytes(downloaded)}"
                                )

                                while not control_event.is_set():
                                    if download_id in cancelled_downloads or cancelled:
                                        cancelled = True
                                        break
                                    control_event.wait(timeout=0.2)

                                if cancelled:
                                    break

                                with download_lock:
                                    if (
                                        download_id in download_progress
                                        and download_progress[download_id].get("status") == "paused"
                                    ):
                                        download_progress[download_id]["status"] = "downloading"
                                if callable(update_store):
                                    update_store(
                                        download_id,
                                        status="downloading",
                                        downloaded=downloaded,
                                        total_size=total_size,
                                    )
                                log.info(
                                    f"Download resumed: {filename} from "
                                    f"{facade.format_bytes(downloaded)}"
                                )
                                last_speed_update = time.time()
                                last_downloaded = downloaded

                            if chunk:
                                file_handle.write(chunk)
                                if sha256_hasher is not None:
                                    sha256_hasher.update(chunk)
                                downloaded += len(chunk)
                                stream_attempts = 0

                                current_time = time.time()
                                time_delta = current_time - last_speed_update
                                if time_delta >= 0.5:
                                    bytes_delta = downloaded - last_downloaded
                                    instant_speed = bytes_delta / time_delta if time_delta > 0 else 0
                                    speed_history.append(instant_speed)
                                    smoothed_speed = sum(speed_history) / len(speed_history) if speed_history else 0
                                    last_speed_update = current_time
                                    last_downloaded = downloaded

                                    with download_lock:
                                        download_progress[download_id]["downloaded"] = downloaded
                                        download_progress[download_id]["speed"] = int(smoothed_speed)
                                        if total_size > 0:
                                            download_progress[download_id]["progress"] = int((downloaded / total_size) * 100)

                                    if current_time - last_cli_log >= cli_log_interval:
                                        last_cli_log = current_time
                                        progress_pct = int((downloaded / total_size) * 100) if total_size > 0 else 0
                                        downloaded_str = facade.format_bytes(downloaded)
                                        total_str = facade.format_bytes(total_size) if total_size > 0 else "?"
                                        speed_str = facade.format_bytes(int(smoothed_speed)) + "/s"
                                        log.info(f"Progress: {downloaded_str} / {total_str} ({progress_pct}%) - {speed_str}")
                                        update_store = getattr(facade, "update_download_progress_state", None)
                                        if callable(update_store):
                                            update_store(
                                                download_id,
                                                downloaded=downloaded,
                                                total_size=total_size,
                                            )
                                else:
                                    with download_lock:
                                        download_progress[download_id]["downloaded"] = downloaded
                                        if total_size > 0:
                                            download_progress[download_id]["progress"] = int((downloaded / total_size) * 100)

                                if progress_callback:
                                    progress_callback(downloaded, total_size)

                        if cancelled or download_id in cancelled_downloads:
                            break

                        # Check if stream closed prematurely
                        if total_size > 0 and downloaded < total_size:
                            raise requests.exceptions.RequestException(
                                f"Connection closed prematurely ({facade.format_bytes(downloaded)} / {total_size_str})"
                            )

                        # Finished transferring all data
                        break

                    except (requests.exceptions.RequestException, OSError, TimeoutError) as stream_exc:
                        if cancelled or download_id in cancelled_downloads:
                            cancelled = True
                            break

                        if stream_attempts < max_stream_retries:
                            stream_attempts += 1
                            file_handle.flush()
                            try:
                                response.close()
                            except Exception:
                                pass

                            is_stall = (
                                isinstance(stream_exc, (requests.exceptions.Timeout, TimeoutError))
                                or "read timed out" in str(stream_exc).lower()
                                or "timed out" in str(stream_exc).lower()
                            )
                            stall_msg = (
                                f"Download stream stalled without data for {read_timeout}s"
                                if is_stall
                                else f"Download stream interrupted ({facade._sanitize_download_error(stream_exc)})"
                            )
                            log.warning(
                                f"{stall_msg} for {filename}; "
                                f"auto-reconnecting and resuming from byte {downloaded} "
                                f"(attempt {stream_attempts}/{max_stream_retries})..."
                            )
                            time.sleep(stream_retry_delay)

                            resume_headers = facade.build_download_headers(url, headers)
                            if downloaded > 0:
                                resume_headers["Range"] = f"bytes={downloaded}-"

                            reconnected = False
                            if final_url and final_url != url:
                                try:
                                    resume_resp, resume_final_url, _ = request_download_response(
                                        facade,
                                        download_id,
                                        final_url,
                                        headers=resume_headers,
                                        stream=True,
                                        timeout=(connect_timeout, read_timeout),
                                    )
                                    resume_resp.raise_for_status()
                                    if getattr(resume_resp, "status_code", None) == 206:
                                        response = resume_resp
                                        final_url = resume_final_url
                                        reconnected = True
                                except Exception as rec_exc:
                                    log.debug(f"Direct reconnect on target URL failed: {rec_exc}")

                            if not reconnected:
                                try:
                                    resume_resp, resume_final_url, _ = request_download_response(
                                        facade,
                                        download_id,
                                        url,
                                        headers=resume_headers,
                                        stream=True,
                                        timeout=(connect_timeout, read_timeout),
                                    )
                                    resume_resp.raise_for_status()
                                    if getattr(resume_resp, "status_code", None) == 206 or downloaded == 0:
                                        response = resume_resp
                                        final_url = resume_final_url
                                        reconnected = True
                                except Exception as rec_exc:
                                    log.debug(f"Origin reconnect failed: {rec_exc}")

                            if reconnected:
                                continue

                        raise

        if cancelled or download_id in cancelled_downloads:
            with download_lock:
                download_progress[download_id]["status"] = "cancelled"
            facade._delete_python_partial_download_file(partial_path)
            log.info(f"Cancelled: {filename} - incomplete file deleted")
            result["error"] = "Download cancelled"
            cancelled_downloads.discard(download_id)
            return result

        actual_sha256 = sha256_hasher.hexdigest() if sha256_hasher is not None else ""
        if expected_sha256:
            with download_lock:
                download_progress[download_id]["status"] = "verifying"
                download_progress[download_id]["sha256"] = actual_sha256
                download_progress[download_id]["expected_sha256"] = expected_sha256

            if actual_sha256 != expected_sha256:
                bad_path = f"{dest_path}.badsha"
                try:
                    os.replace(partial_path, bad_path)
                except OSError as exc:
                    log.warning(f"Could not preserve SHA256-mismatched download at {bad_path}: {exc}")
                    bad_path = ""
                error_msg = f"SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
                if bad_path:
                    error_msg += f"; file kept at {bad_path}"
                    # Use the intended filename so removing .badsha also makes
                    # the already computed hash available to local model info.
                    # Never attach the rejected file's hash to an existing model.
                    sidecar_model_path = bad_path if os.path.exists(dest_path) else dest_path
                    try:
                        payload = facade.build_model_resolver_metadata(
                            sidecar_model_path,
                            {"sha256": actual_sha256, "size": downloaded},
                            category,
                        )
                        payload.update({
                            "expected_sha256": expected_sha256,
                            "sha256_verified": False,
                        })
                        metadata_path = facade.get_model_resolver_sidecar_path(sidecar_model_path)
                        facade.write_json_atomic(metadata_path, payload, indent=2)
                        result["metadata_path"] = metadata_path
                        log.info(f"Metadata saved for SHA256-mismatched download: {metadata_path}")
                    except Exception as exc:
                        log.warning(f"Could not save metadata for {bad_path}: {exc}")
                with download_lock:
                    download_progress[download_id]["status"] = "error"
                    download_progress[download_id]["error"] = error_msg
                    download_progress[download_id]["sha256_verified"] = False
                result.update(
                    {
                        "error": error_msg,
                        "sha256": actual_sha256,
                        "expected_sha256": expected_sha256,
                        "sha256_verified": False,
                    }
                )
                log.error(f"✗ Download rejected: {filename} - {error_msg}")
                return result

        os.replace(partial_path, dest_path)
        published = True

        with download_lock:
            download_progress[download_id]["status"] = "completed"
            download_progress[download_id]["progress"] = 100
            download_progress[download_id]["speed"] = 0
            if expected_sha256:
                download_progress[download_id]["sha256"] = actual_sha256
                download_progress[download_id]["expected_sha256"] = expected_sha256
                download_progress[download_id]["sha256_verified"] = True

        result["success"] = True
        result["size"] = downloaded
        if expected_sha256:
            result.update(
                {
                    "sha256": actual_sha256,
                    "expected_sha256": expected_sha256,
                    "sha256_verified": True,
                }
            )
        metadata_path = facade.write_model_resolver_metadata(
            dest_path,
            metadata or {},
            category,
            url,
            create_preview=True,
        )
        if metadata_path:
            result["metadata_path"] = metadata_path
            with download_lock:
                if download_id in download_progress:
                    download_progress[download_id]["metadata_path"] = metadata_path

        elapsed = time.time() - start_time
        transferred_bytes = downloaded - (existing_size if is_resumed else 0)
        avg_speed = transferred_bytes / elapsed if elapsed > 0 else 0
        log.info(f"✓ Download complete: {filename}")
        log.info(
            f"Size: {facade.format_bytes(downloaded)}, Time: {elapsed:.1f}s, "
            f"Avg speed: {facade.format_bytes(int(avg_speed))}/s"
        )
        facade.invalidate_model_caches()

    except DownloadCancelled:
        facade._delete_python_partial_download_file(partial_path)
        result["error"] = "Download cancelled"
        with download_lock:
            download_progress[download_id].update(status="cancelled", speed=0)
        cancelled_downloads.discard(download_id)

    except requests.exceptions.RequestException as exc:
        error_msg = facade._sanitize_download_error(exc)
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in [401, 403]:
            if "huggingface.co" in url:
                error_msg = f"Unauthorized (HTTP {status_code}): HuggingFace token may be required."
            elif "civitai.com" in url:
                error_msg = f"Unauthorized (HTTP {status_code}): CivitAI API key may be required."
            else:
                error_msg = f"Unauthorized (HTTP {status_code}): Authentication required."
        elif status_code == 404:
            error_msg = "Model not found (HTTP 404): The file may have been moved or deleted."
        elif status_code == 429:
            resp = getattr(exc, "response", None)
            retry_hdr = resp.headers.get("Retry-After") if resp is not None else None
            retry_sec = parse_retry_after(retry_hdr) if retry_hdr else None
            effective_delay = retry_sec or 60
            coordinator_fn = getattr(facade, "get_rate_limit_coordinator", None)
            if callable(coordinator_fn):
                coordinator_fn().register_rate_limit(
                    url,
                    effective_delay,
                    reason=f"Download rate limit (HTTP 429) for {facade.get_filename_from_path(dest_path)}",
                )
            if retry_sec:
                error_msg = f"Rate limit exceeded (HTTP 429): please retry after {retry_sec}s."
            else:
                error_msg = "Rate limit exceeded (HTTP 429): too many requests, please try again later."

        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(f"✗ Download failed: {facade.get_filename_from_path(dest_path)}")
        log.error(f"Error: {error_msg}")

        if not published:
            if status_code == 404:
                facade._delete_python_partial_download_file(partial_path)
            elif os.path.isfile(partial_path) and os.path.getsize(partial_path) > 0:
                log.info(
                    f"Partial download preserved: {facade.format_bytes(os.path.getsize(partial_path))} "
                    f"at {partial_path}. Retrying will attempt to resume."
                )

    except Exception as exc:
        guard_fn = getattr(facade, "get_connectivity_guard", None)
        if callable(guard_fn):
            guard_fn().record_failure(url, exc)
        error_msg = facade._sanitize_download_error(exc)
        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(f"✗ Download failed: {facade.get_filename_from_path(dest_path)}")
        log.error(f"Error: {error_msg}")
        log.error(f"Download error: {exc}", exc_info=True)

        if not published and os.path.isfile(partial_path) and os.path.getsize(partial_path) > 0:
            log.info(
                f"Partial download preserved: {facade.format_bytes(os.path.getsize(partial_path))} "
                f"at {partial_path}. Retrying will attempt to resume."
            )

    finally:
        unregister_control = getattr(facade, "unregister_python_download_control", None)
        if callable(unregister_control):
            unregister_control(download_id)
        if response is not None:
            try:
                response.close()
            except Exception as exc:
                log.debug(f"Could not close download response: {exc}")

    return result


def download_model(
    url: str,
    filename: str,
    category: str,
    download_id: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = "",
    base_directory: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    dependencies: Any = None,
) -> Dict[str, Any]:
    """Validate a model target and delegate the actual transfer."""
    if dependencies is None:
        raise RuntimeError("Download orchestration dependencies were not provided")
    facade = dependencies
    os = facade.os
    download_lock = facade.download_lock
    download_progress = facade.download_progress
    log = facade.log

    if download_id is None:
        download_id = facade.generate_download_id()

    filename = facade.sanitize_download_filename(filename)
    if not filename:
        return {
            "success": False,
            "download_id": download_id,
            "error": "Invalid filename",
        }
    if not facade.is_allowed_model_download_filename(filename):
        return {
            "success": False,
            "download_id": download_id,
            "error": "Unsupported model file extension",
        }
    subfolder = facade.normalize_relative_subfolder(subfolder)

    dest_dir = facade.get_download_directory(category, base_directory)
    if not dest_dir:
        return {
            "success": False,
            "download_id": download_id,
            "error": f"Could not find directory for category: {category}",
        }

    if subfolder:
        dest_dir = os.path.join(dest_dir, *subfolder.split("/"))

    dest_dir = os.path.abspath(os.path.normpath(dest_dir))
    dest_path = os.path.abspath(os.path.normpath(os.path.join(dest_dir, filename)))
    if not facade.is_path_within(dest_path, dest_dir):
        return {
            "success": False,
            "download_id": download_id,
            "error": "Download target is outside the selected model directory",
        }

    with download_lock:
        active_download_id = find_active_download_for_path(
            download_progress,
            dest_path,
            os,
            exclude_id=download_id,
        )
    if active_download_id:
        message = f"A download is already active for this file: {dest_path}"
        log.info(f"{message} (download_id={active_download_id})")
        return {
            "success": False,
            "download_id": download_id,
            "active_download_id": active_download_id,
            "error": message,
            "path": dest_path,
        }

    resume_aria2_partial = bool(
        facade._download_backend_from_settings() == "aria2"
        and os.path.isfile(dest_path)
        and os.path.isfile(f"{dest_path}.aria2")
    )
    if (
        facade._download_backend_from_settings() == "aria2"
        and os.path.isfile(f"{dest_path}.aria2")
        and not os.path.isfile(dest_path)
    ):
        log.warning(f"Removing orphaned aria2 control file: {dest_path}.aria2")
        facade._delete_partial_download_files(dest_path)
    if resume_aria2_partial:
        log.info(f"Resuming partial aria2 download: {dest_path}")

    if os.path.exists(dest_path) and not resume_aria2_partial:
        expected_sha256 = facade._extract_expected_sha256(metadata)
        if expected_sha256:
            metadata_sha256 = facade.read_completed_metadata_sha256(dest_path)
            sha256_source = "metadata"
            existing_sha256 = metadata_sha256
            if metadata_sha256:
                if metadata_sha256 == expected_sha256:
                    log.info(f"File exists, metadata SHA256 matches: {dest_path}")
                else:
                    log.info(f"File exists, metadata SHA256 differs from source; verifying file content: {dest_path}")
                    existing_sha256 = ""

            try:
                if not existing_sha256:
                    sha256_source = "file"
                    log.info(f"File exists, verifying SHA256: {dest_path}")
                    detected_sha256_source = ["file"]

                    def set_detected_sha256_source(source: str) -> None:
                        if source:
                            detected_sha256_source[0] = source

                    existing_sha256 = (
                        facade.calculate_file_sha256(
                            dest_path,
                            on_hash_source=set_detected_sha256_source,
                        )
                        or ""
                    )
                    sha256_source = detected_sha256_source[0]
            except Exception as exc:
                error_msg = f"File already exists and its SHA256 could not be verified: {dest_path}"
                log.warning(f"{error_msg} ({exc})")
                return {
                    "success": False,
                    "download_id": download_id,
                    "error": error_msg,
                    "path": dest_path,
                }

            if existing_sha256 == expected_sha256:
                message = "This model is already downloaded and matches the source hash."
                metadata_path = (
                    facade.write_model_resolver_metadata(
                        dest_path,
                        metadata or {},
                        category,
                        url,
                        create_preview=True,
                    )
                    or ""
                )
                size = os.path.getsize(dest_path)
                with download_lock:
                    if download_id in download_progress:
                        download_progress[download_id].update(
                            {
                                "status": "completed",
                                "progress": 100,
                                "total_size": size,
                                "downloaded": size,
                                "speed": 0,
                                "path": dest_path,
                                "directory": os.path.dirname(dest_path),
                                "error": None,
                                "already_exists": True,
                                "message": message,
                                "sha256": existing_sha256,
                                "expected_sha256": expected_sha256,
                                "sha256_source": sha256_source,
                            }
                        )
                        if metadata_path:
                            download_progress[download_id]["metadata_path"] = metadata_path
                log.info(f"{message} Path: {dest_path}")
                return {
                    "success": True,
                    "download_id": download_id,
                    "path": dest_path,
                    "size": size,
                    "already_exists": True,
                    "message": message,
                    "metadata_path": metadata_path,
                    "sha256_source": sha256_source,
                }

            error_msg = f"File already exists, but its SHA256 does not match the selected source: {dest_path}"
            log.warning(f"{error_msg} (existing={existing_sha256}, expected={expected_sha256})")
            return {
                "success": False,
                "download_id": download_id,
                "error": error_msg,
                "path": dest_path,
                "existing_sha256": existing_sha256,
                "expected_sha256": expected_sha256,
            }

        return {
            "success": False,
            "download_id": download_id,
            "error": f"File already exists: {dest_path}",
            "path": dest_path,
        }

    return facade.download_file(
        url,
        dest_path,
        download_id,
        headers=headers,
        metadata=metadata,
        category=category,
    )


def start_background_download(
    url: str,
    filename: str,
    category: str,
    headers: Optional[Dict[str, str]] = None,
    subfolder: str = "",
    base_directory: str = "",
    metadata: Optional[Dict[str, Any]] = None,
    download_id: Optional[str] = None,
    dependencies: Any = None,
) -> str:
    """Start model validation and download in a background thread."""
    if dependencies is None:
        raise RuntimeError("Download orchestration dependencies were not provided")
    facade = dependencies
    os = facade.os
    time = facade.time
    download_progress = facade.download_progress
    download_lock = facade.download_lock
    log = facade.log

    effective_download_id = download_id or facade.generate_download_id()
    filename = facade.sanitize_download_filename(filename)
    subfolder = facade.normalize_relative_subfolder(subfolder)
    initial_directory = facade.get_download_directory(category, base_directory) or ""
    if initial_directory and subfolder:
        initial_directory = os.path.join(initial_directory, *subfolder.split("/"))
    initial_path = os.path.join(initial_directory, filename) if initial_directory and filename else ""

    with download_lock:
        active_download_id = find_active_download_for_path(
            download_progress,
            initial_path,
            os,
            exclude_id=effective_download_id,
        )
        if active_download_id and active_download_id != effective_download_id:
            log.info(
                f"Reusing active download for {initial_path} "
                f"(download_id={active_download_id})"
            )
            return active_download_id
        download_progress[effective_download_id] = create_initial_progress(
            url=url,
            path=initial_path,
            filename=filename,
            directory=initial_directory,
            download_backend=facade._download_backend_from_settings(),
            start_time=time.time(),
        )

    save_spec = getattr(facade, "save_download_spec", None)
    if callable(save_spec):
        save_spec(
            effective_download_id,
            {
                "url": url,
                "filename": filename,
                "category": category,
                "headers": headers or {},
                "subfolder": subfolder,
                "base_directory": base_directory,
                "metadata": metadata or {},
                "expected_sha256": (metadata or {}).get("sha256"),
                "download_backend": facade._download_backend_from_settings(),
                "path": initial_path,
                "directory": initial_directory,
                "status": "starting",
                "created_at": time.time(),
            },
        )

    def run_download() -> None:
        try:
            with download_lock:
                if effective_download_id in facade.cancelled_downloads:
                    download_progress[effective_download_id].update(status="cancelled", speed=0)
                    facade.cancelled_downloads.discard(effective_download_id)
                    remove_persisted = getattr(facade, "remove_persisted_download", None)
                    if callable(remove_persisted):
                        remove_persisted(effective_download_id)
                    return
            result = facade.download_model(
                url,
                filename,
                category,
                effective_download_id,
                headers,
                subfolder,
                base_directory,
                metadata,
            )
            if result.get("success"):
                remove_persisted = getattr(facade, "remove_persisted_download", None)
                if callable(remove_persisted):
                    remove_persisted(effective_download_id)
            else:
                cancelled = False
                with download_lock:
                    if effective_download_id in download_progress:
                        cancelled = (
                            effective_download_id in facade.cancelled_downloads
                            or download_progress[effective_download_id].get("status") == "cancelled"
                        )
                        download_progress[effective_download_id]["status"] = "cancelled" if cancelled else "error"
                        facade.cancelled_downloads.discard(effective_download_id)
                        download_progress[effective_download_id]["error"] = result.get(
                            "error",
                            "Download failed",
                        )
                        if result.get("path"):
                            result_path = result["path"]
                            download_progress[effective_download_id]["path"] = result_path
                            download_progress[effective_download_id]["directory"] = os.path.dirname(result_path)
                if cancelled:
                    remove_persisted = getattr(facade, "remove_persisted_download", None)
                    if callable(remove_persisted):
                        remove_persisted(effective_download_id)
        except Exception as exc:
            with download_lock:
                download_progress[effective_download_id] = {
                    "status": "error",
                    "progress": 0,
                    "total_size": 0,
                    "downloaded": 0,
                    "filename": filename,
                    "path": "",
                    "directory": "",
                    "url": url,
                    "error": str(exc),
                    "speed": 0,
                    "start_time": time.time(),
                    "download_backend": facade._download_backend_from_settings(),
                }

    facade.threading.Thread(target=run_download, daemon=True).start()
    return effective_download_id

"""High-level download orchestration used by the downloader facade."""

import importlib
from typing import Any, Callable, Dict, Optional


def _downloader_module():
    """Return the facade so runtime patches and settings remain effective."""
    return importlib.import_module("core.downloader")


def download_file(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    chunk_size: int = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
) -> Dict[str, Any]:
    """
    Download a file from URL with progress tracking and speed calculation.

    The facade provides the mutable state and backend helpers. Resolving those
    dependencies at call time preserves the existing patch points used by the
    ComfyUI routes and tests.
    """
    facade = _downloader_module()
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

    with download_lock:
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": 0,
            "downloaded": 0,
            "filename": facade.get_filename_from_path(dest_path),
            "path": dest_path,
            "directory": os.path.dirname(dest_path),
            "url": url,
            "error": None,
            "speed": 0,
            "start_time": start_time,
            "download_backend": "python",
        }

    try:
        destination_directory = os.path.dirname(dest_path)
        if destination_directory:
            os.makedirs(destination_directory, exist_ok=True)
        facade._delete_python_partial_download_file(partial_path)

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

        request_headers = facade.build_download_headers(url, headers)
        response, final_url, _final_headers = facade.request_public_url(
            "GET",
            url,
            headers=request_headers,
            stream=True,
            timeout=30,
        )
        response.raise_for_status()
        if final_url != url:
            log.debug("Validated download redirect target")

        total_size = facade.extract_response_file_size(response) or 0
        total_size_str = (
            facade.format_bytes(total_size) if total_size > 0 else "unknown"
        )
        log.info(f"Size: {total_size_str}")

        with download_lock:
            download_progress[download_id]["total_size"] = total_size
            download_progress[download_id]["status"] = "downloading"

        downloaded = 0
        sha256_hasher = hashlib.sha256() if expected_sha256 else None
        cancelled = False
        with open(partial_path, "wb") as file_handle:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if download_id in cancelled_downloads:
                    cancelled = True
                    break

                if chunk:
                    file_handle.write(chunk)
                    if sha256_hasher is not None:
                        sha256_hasher.update(chunk)
                    downloaded += len(chunk)

                    current_time = time.time()
                    time_delta = current_time - last_speed_update
                    if time_delta >= 0.5:
                        bytes_delta = downloaded - last_downloaded
                        instant_speed = (
                            bytes_delta / time_delta if time_delta > 0 else 0
                        )
                        speed_history.append(instant_speed)
                        smoothed_speed = (
                            sum(speed_history) / len(speed_history)
                            if speed_history
                            else 0
                        )
                        last_speed_update = current_time
                        last_downloaded = downloaded

                        with download_lock:
                            download_progress[download_id][
                                "downloaded"
                            ] = downloaded
                            download_progress[download_id]["speed"] = int(
                                smoothed_speed
                            )
                            if total_size > 0:
                                download_progress[download_id]["progress"] = int(
                                    (downloaded / total_size) * 100
                                )

                        if current_time - last_cli_log >= cli_log_interval:
                            last_cli_log = current_time
                            progress_pct = (
                                int((downloaded / total_size) * 100)
                                if total_size > 0
                                else 0
                            )
                            downloaded_str = facade.format_bytes(downloaded)
                            total_str = (
                                facade.format_bytes(total_size)
                                if total_size > 0
                                else "?"
                            )
                            speed_str = (
                                facade.format_bytes(int(smoothed_speed)) + "/s"
                            )
                            log.info(
                                f"Progress: {downloaded_str} / {total_str} "
                                f"({progress_pct}%) - {speed_str}"
                            )
                    else:
                        with download_lock:
                            download_progress[download_id][
                                "downloaded"
                            ] = downloaded
                            if total_size > 0:
                                download_progress[download_id]["progress"] = int(
                                    (downloaded / total_size) * 100
                                )

                    if progress_callback:
                        progress_callback(downloaded, total_size)

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
                    log.warning(
                        "Could not preserve SHA256-mismatched download at "
                        f"{bad_path}: {exc}"
                    )
                    bad_path = ""
                error_msg = (
                    f"SHA256 mismatch: expected {expected_sha256}, "
                    f"got {actual_sha256}"
                )
                if bad_path:
                    error_msg += f"; file kept at {bad_path}"
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
        avg_speed = downloaded / elapsed if elapsed > 0 else 0
        log.info(f"✓ Download complete: {filename}")
        log.info(
            f"Size: {facade.format_bytes(downloaded)}, Time: {elapsed:.1f}s, "
            f"Avg speed: {facade.format_bytes(int(avg_speed))}/s"
        )
        facade.invalidate_model_files_cache()
        facade.invalidate_local_hash_match_cache()

    except requests.exceptions.RequestException as exc:
        error_msg = facade._sanitize_download_error(exc)
        if hasattr(exc, "response") and exc.response is not None:
            status_code = exc.response.status_code
            if status_code in [401, 403]:
                if "huggingface.co" in url:
                    error_msg = (
                        f"Unauthorized (HTTP {status_code}): "
                        "HuggingFace token may be required."
                    )
                elif "civitai.com" in url:
                    error_msg = (
                        f"Unauthorized (HTTP {status_code}): "
                        "CivitAI API key may be required."
                    )
                else:
                    error_msg = (
                        f"Unauthorized (HTTP {status_code}): "
                        "Authentication required."
                    )
            elif status_code == 404:
                error_msg = (
                    "Model not found (HTTP 404): "
                    "The file may have been moved or deleted."
                )

        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(
            f"✗ Download failed: {facade.get_filename_from_path(dest_path)}"
        )
        log.error(f"Error: {error_msg}")

        if not published:
            facade._delete_python_partial_download_file(partial_path)

    except Exception as exc:
        error_msg = facade._sanitize_download_error(exc)
        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(
            f"✗ Download failed: {facade.get_filename_from_path(dest_path)}"
        )
        log.error(f"Error: {error_msg}")
        log.error(f"Download error: {exc}", exc_info=True)

        if not published:
            facade._delete_python_partial_download_file(partial_path)

    finally:
        if response is not None:
            try:
                response.close()
            except Exception as exc:
                log.debug(f"Could not close download response: {exc}")

    return result

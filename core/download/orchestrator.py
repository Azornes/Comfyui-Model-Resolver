"""High-level download orchestration used by the downloader facade."""

from typing import Any, Callable, Dict, Optional


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
        total_size_str = facade.format_bytes(total_size) if total_size > 0 else "unknown"
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
                    else:
                        with download_lock:
                            download_progress[download_id]["downloaded"] = downloaded
                            if total_size > 0:
                                download_progress[download_id]["progress"] = int((downloaded / total_size) * 100)

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
                    log.warning(f"Could not preserve SHA256-mismatched download at {bad_path}: {exc}")
                    bad_path = ""
                error_msg = f"SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
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
                    error_msg = f"Unauthorized (HTTP {status_code}): HuggingFace token may be required."
                elif "civitai.com" in url:
                    error_msg = f"Unauthorized (HTTP {status_code}): CivitAI API key may be required."
                else:
                    error_msg = f"Unauthorized (HTTP {status_code}): Authentication required."
            elif status_code == 404:
                error_msg = "Model not found (HTTP 404): The file may have been moved or deleted."

        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(f"✗ Download failed: {facade.get_filename_from_path(dest_path)}")
        log.error(f"Error: {error_msg}")

        if not published:
            facade._delete_python_partial_download_file(partial_path)

    except Exception as exc:
        error_msg = facade._sanitize_download_error(exc)
        with download_lock:
            download_progress[download_id]["status"] = "error"
            download_progress[download_id]["error"] = error_msg
        result["error"] = error_msg
        log.error(f"✗ Download failed: {facade.get_filename_from_path(dest_path)}")
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

    download_id = facade.generate_download_id()
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
        )
        if active_download_id:
            log.info(
                f"Reusing active download for {initial_path} "
                f"(download_id={active_download_id})"
            )
            return active_download_id
        download_progress[download_id] = {
            "status": "starting",
            "progress": 0,
            "total_size": 0,
            "downloaded": 0,
            "filename": filename,
            "path": initial_path,
            "directory": initial_directory,
            "url": url,
            "error": None,
            "speed": 0,
            "start_time": time.time(),
            "download_backend": facade._download_backend_from_settings(),
        }

    def run_download() -> None:
        try:
            result = facade.download_model(
                url,
                filename,
                category,
                download_id,
                headers,
                subfolder,
                base_directory,
                metadata,
            )
            if not result.get("success"):
                with download_lock:
                    if download_id in download_progress:
                        download_progress[download_id]["status"] = "error"
                        download_progress[download_id]["error"] = result.get(
                            "error",
                            "Download failed",
                        )
                        if result.get("path"):
                            result_path = result["path"]
                            download_progress[download_id]["path"] = result_path
                            download_progress[download_id]["directory"] = os.path.dirname(result_path)
        except Exception as exc:
            with download_lock:
                download_progress[download_id] = {
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
    return download_id

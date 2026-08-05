"""Hugging Face Xet transport and progress integration."""

from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from ..log_system import create_module_logger
from .state import create_initial_progress

log = create_module_logger("core.downloader")


def _require_dependencies(dependencies: Any) -> Any:
    """Return explicitly supplied services for Hugging Face Xet."""
    if dependencies is None:
        raise RuntimeError("Hugging Face Xet dependencies were not provided")
    return dependencies


class HuggingFaceXetDownloadCancelled(Exception):
    """Raised by the Xet progress adapter when a download is cancelled."""


class HuggingFaceXetProgressAdapter:
    """Forward hf_xet byte progress to the resolver's download state."""

    def __init__(
        self,
        download_id: str,
        total_size: int,
        start_time: float,
        *,
        dependencies: Any = None,
    ) -> None:
        self.dependencies = _require_dependencies(dependencies)
        self.download_id = download_id
        self.total_size = max(0, int(total_size or 0))
        self.downloaded = 0
        self.transfer_downloaded = 0
        self.transfer_total_size = 0
        self.last_update = start_time
        self.speed = 0

    def _publish(
        self,
        downloaded: int,
        speed: int,
        transfer_downloaded: int = 0,
        transfer_total_size: int = 0,
    ) -> None:
        facade = self.dependencies
        downloaded = max(0, int(downloaded or 0))
        if self.total_size > 0:
            downloaded = min(downloaded, self.total_size)
        self.downloaded = max(self.downloaded, downloaded)
        progress = (
            min(100.0, round((self.downloaded / self.total_size) * 100, 1))
            if self.total_size > 0
            else 0
        )

        self.transfer_downloaded = max(
            self.transfer_downloaded,
            max(0, int(transfer_downloaded or 0)),
        )
        self.transfer_total_size = max(
            self.transfer_total_size,
            max(0, int(transfer_total_size or 0)),
        )
        transfer_progress = (
            min(
                100.0,
                round(
                    (self.transfer_downloaded / self.transfer_total_size) * 100,
                    1,
                ),
            )
            if self.transfer_total_size > 0
            else 0
        )

        self.speed = max(0, int(speed or 0))
        with facade.download_lock:
            state = facade.download_progress.get(self.download_id)
            if state is not None:
                state.update(
                    {
                        "status": "downloading",
                        "progress": progress,
                        "downloaded": self.downloaded,
                        "total_size": self.total_size,
                        "speed": self.speed,
                        "transfer_downloaded": self.transfer_downloaded,
                        "transfer_total_size": self.transfer_total_size,
                        "transfer_progress": transfer_progress,
                        "download_backend": "huggingface_xet",
                    }
                )

    def update(self, byte_delta: Any) -> None:
        if self.download_id in self.dependencies.cancelled_downloads:
            raise HuggingFaceXetDownloadCancelled("Download cancelled")

        try:
            delta = max(0, int(float(byte_delta or 0)))
        except (TypeError, ValueError):
            delta = 0

        downloaded = self.downloaded + delta
        # The legacy one-argument callback exposes logical byte increments only,
        # not network-transfer speed. Reporting a derived rate here would confuse
        # fast cache/file reconstruction with actual download throughput.
        self._publish(downloaded, 0)

    def __call__(self, total_update: Any, item_updates: Any) -> None:
        """Receive hf_xet's detailed 200 ms progress snapshots when available."""
        if self.download_id in self.dependencies.cancelled_downloads:
            raise HuggingFaceXetDownloadCancelled("Download cancelled")

        downloaded = int(getattr(total_update, "total_bytes_completed", 0) or 0)
        if downloaded <= 0:
            items = (
                item_updates.values()
                if isinstance(item_updates, dict)
                else item_updates
            )
            for item in items or []:
                downloaded = max(
                    downloaded,
                    int(getattr(item, "bytes_completed", 0) or 0),
                )

        transfer_downloaded = int(
            getattr(total_update, "total_transfer_bytes_completed", 0) or 0
        )
        transfer_total_size = int(
            getattr(total_update, "total_transfer_bytes", 0) or 0
        )
        transfer_rate = getattr(
            total_update,
            "total_transfer_bytes_completion_rate",
            None,
        )
        try:
            speed = max(0, int(float(transfer_rate or 0)))
        except (TypeError, ValueError):
            speed = 0
        self.last_update = self.dependencies.time.time()
        self._publish(
            downloaded,
            speed,
            transfer_downloaded,
            transfer_total_size,
        )


def run_huggingface_xet_transfer(
    incomplete_path: Path,
    xet_file_data: Any,
    request_headers: Dict[str, str],
    expected_size: int,
    filename: str,
    progress_adapter: HuggingFaceXetProgressAdapter,
    *,
    dependencies: Any = None,
) -> None:
    """Use detailed native Xet progress when supported, with legacy fallback."""
    facade = _require_dependencies(dependencies)
    import hf_xet
    from huggingface_hub.file_download import xet_get
    try:
        from huggingface_hub.utils import refresh_xet_connection_info
    except ImportError:
        refresh_xet_connection_info = None

    supports_session_progress = all(
        hasattr(hf_xet, name) for name in ("XetFileInfo", "XetSession")
    )
    if supports_session_progress:
        try:
            from huggingface_hub.utils._xet import (
                get_xet_session,
                xet_headers_without_auth,
            )
        except ImportError:
            supports_session_progress = False

    if supports_session_progress:
        session = get_xet_session()
        xet_headers = xet_headers_without_auth(request_headers)
        group = session.new_file_download_group(
            token_refresh_url=xet_file_data.refresh_route,
            token_refresh_headers=request_headers,
            custom_headers=xet_headers,
            progress_callback=progress_adapter,
            progress_interval_ms=200,
        )
        try:
            with group:
                handle = group.start_download_file(
                    hf_xet.XetFileInfo(xet_file_data.file_hash, expected_size or None),
                    str(incomplete_path.absolute()),
                )
                with facade.xet_transfers_lock:
                    facade.xet_transfers[progress_adapter.download_id] = {
                        "handle": handle,
                        "partial_path": str(incomplete_path),
                    }
                if progress_adapter.download_id in facade.cancelled_downloads:
                    cancel = getattr(handle, "cancel", None)
                    if callable(cancel):
                        cancel()
        finally:
            with facade.xet_transfers_lock:
                facade.xet_transfers.pop(progress_adapter.download_id, None)
        return

    supports_detailed_progress = refresh_xet_connection_info is not None and all(
        hasattr(hf_xet, name)
        for name in (
            "PyItemProgressUpdate",
            "PyTotalProgressUpdate",
            "PyXetDownloadInfo",
            "download_files",
        )
    )
    if not supports_detailed_progress:
        xet_get(
            incomplete_path=incomplete_path,
            xet_file_data=xet_file_data,
            headers=request_headers,
            expected_size=expected_size or None,
            displayed_filename=filename,
            _tqdm_bar=progress_adapter,
        )
        return

    connection_info = refresh_xet_connection_info(
        file_data=xet_file_data,
        headers=request_headers,
    )
    if connection_info is None:
        raise ValueError("Failed to refresh Hugging Face Xet connection info")

    def token_refresher() -> tuple[str, int]:
        refreshed = refresh_xet_connection_info(
            file_data=xet_file_data,
            headers=request_headers,
        )
        if refreshed is None:
            raise ValueError("Failed to refresh Hugging Face Xet access token")
        return refreshed.access_token, refreshed.expiration_unix_epoch

    download_info = hf_xet.PyXetDownloadInfo(
        destination_path=str(incomplete_path.absolute()),
        hash=xet_file_data.file_hash,
        file_size=expected_size or None,
    )
    hf_xet.download_files(
        [download_info],
        endpoint=connection_info.endpoint,
        token_info=(
            connection_info.access_token,
            connection_info.expiration_unix_epoch,
        ),
        token_refresher=token_refresher,
        progress_updater=[progress_adapter],
    )


def download_huggingface_xet(
    url: str,
    dest_path: str,
    download_id: str,
    headers: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    category: str = "",
    *,
    dependencies: Any = None,
) -> Optional[Dict[str, Any]]:
    """Download Hugging Face Xet files with the official hf_xet transport."""
    facade = _require_dependencies(dependencies)
    validated_url = facade.validate_public_http_url(url)
    parsed_url = urlparse(validated_url)
    if not (
        facade.host_matches_domain(parsed_url.hostname, "huggingface.co")
        and "/resolve/" in parsed_url.path
    ):
        return None

    try:
        __import__("hf_xet")
        from huggingface_hub.file_download import get_hf_file_metadata
    except ImportError:
        return None

    request_headers = facade.build_download_headers(validated_url, headers)
    try:
        file_metadata = get_hf_file_metadata(
            validated_url,
            headers=request_headers,
            timeout=20,
        )
    except Exception as exc:
        log.debug(
            "Hugging Face Xet metadata probe failed; using HTTP fallback: "
            f"{type(exc).__name__}"
        )
        return None

    xet_file_data = getattr(file_metadata, "xet_file_data", None)
    if xet_file_data is None:
        return None

    try:
        expected_size = max(0, int(getattr(file_metadata, "size", 0) or 0))
    except (TypeError, ValueError):
        expected_size = 0

    result = {
        "success": False,
        "download_id": download_id,
        "path": dest_path,
        "error": None,
        "size": 0,
    }
    start_time = facade.time.time()
    filename = facade.get_filename_from_path(dest_path)
    partial_path = f"{dest_path}.xet-part"
    progress_adapter = HuggingFaceXetProgressAdapter(
        download_id,
        expected_size,
        start_time,
        dependencies=dependencies,
    )

    with facade.download_lock:
        facade.download_progress[download_id] = create_initial_progress(
            url=validated_url,
            path=dest_path,
            filename=filename,
            directory=facade.os.path.dirname(dest_path),
            download_backend="huggingface_xet",
            start_time=start_time,
            total_size=expected_size,
        )

    facade.cancelled_downloads.discard(download_id)
    try:
        facade.os.makedirs(facade.os.path.dirname(dest_path), exist_ok=True)
        if facade.os.path.exists(partial_path):
            facade.os.remove(partial_path)

        log.info(f"Starting Hugging Face Xet download: {filename}")
        run_huggingface_xet_transfer(
            Path(partial_path),
            xet_file_data,
            request_headers,
            expected_size,
            filename,
            progress_adapter,
            dependencies=dependencies,
        )

        if download_id in facade.cancelled_downloads:
            raise HuggingFaceXetDownloadCancelled("Download cancelled")

        size = facade.os.path.getsize(partial_path)
        if expected_size and size != expected_size:
            raise OSError(
                f"Downloaded size mismatch: expected {expected_size}, received {size}"
            )
        facade.os.replace(partial_path, dest_path)

        metadata_path = facade.write_model_resolver_metadata(
            dest_path,
            metadata or {},
            category,
            validated_url,
            create_preview=True,
        )
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state.update(
                    {
                        "status": "completed",
                        "progress": 100,
                        "downloaded": size,
                        "total_size": expected_size or size,
                        "speed": 0,
                    }
                )
                if metadata_path:
                    state["metadata_path"] = metadata_path

        result.update(
            {
                "success": True,
                "size": size,
                "metadata_path": metadata_path,
            }
        )
        elapsed = facade.time.time() - start_time
        avg_speed = size / elapsed if elapsed > 0 else 0
        log.info(f"✓ Hugging Face Xet download complete: {filename}")
        log.info(
            f"Size: {facade.format_bytes(size)}, Time: {elapsed:.1f}s, "
            f"Avg speed: {facade.format_bytes(int(avg_speed))}/s"
        )
        facade.invalidate_model_files_cache()
        facade.invalidate_local_hash_match_cache()
        return result
    except Exception as exc:
        was_cancelled = (
            isinstance(exc, HuggingFaceXetDownloadCancelled)
            or download_id in facade.cancelled_downloads
        )
        facade._delete_xet_partial_file(partial_path)

        error_msg = (
            "Download cancelled"
            if was_cancelled
            else facade._sanitize_download_error(exc)
        )
        with facade.download_lock:
            state = facade.download_progress.get(download_id)
            if state is not None:
                state.update(
                    {
                        "status": "cancelled" if was_cancelled else "error",
                        "error": error_msg,
                        "speed": 0,
                    }
                )
        facade.cancelled_downloads.discard(download_id)
        result["error"] = error_msg
        if was_cancelled:
            log.info(f"Hugging Face Xet download cancelled: {filename}")
        else:
            log.error(f"✗ Hugging Face Xet download failed: {filename}")
            log.error(f"Error: {error_msg}")
        return result

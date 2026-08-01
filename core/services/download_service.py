"""Download orchestration service used by HTTP route adapters."""

import os
from urllib.parse import unquote, urlparse

from ..routes.context import RouteContext


class DownloadService:
    """Coordinate download requests without embedding business logic in routes."""

    def __init__(self, context: RouteContext):
        self.aria2_install_error = context.get("Aria2InstallError")
        self.unsafe_url_error = context.get("UnsafeUrlError")
        self.asyncio = context.get("asyncio")
        self.cancel_download_fn = context.get("cancel_download")
        self.clear_completed_downloads_fn = context.get(
            "clear_completed_downloads"
        )
        self.first_non_empty = context.get("first_non_empty")
        self.get_all_progress_fn = context.get("get_all_progress")
        self.get_aria2_status_fn = context.get("get_aria2_status")
        self.get_civarchive_model_details = context.get(
            "get_civarchive_model_details"
        )
        self.get_civitai_model_details = context.get("get_civitai_model_details")
        self.get_default_root_for_category = context.get(
            "get_default_root_for_category"
        )
        self.get_download_directory = context.get("get_download_directory")
        self.get_override_settings_from_request = context.get(
            "get_override_settings_from_request"
        )
        self.get_progress_fn = context.get("get_progress")
        self.host_matches_domain = context.get("host_matches_domain")
        self.install_aria2_engine = context.get("install_aria2_engine")
        self.is_allowed_model_download_filename = context.get(
            "is_allowed_model_download_filename"
        )
        self.load_resolver_settings = context.get("load_resolver_settings")
        self.normalize_download_category = context.get(
            "normalize_download_category"
        )
        self.pause_download_fn = context.get("pause_download")
        self.resolve_download_subfolder = context.get(
            "resolve_download_subfolder"
        )
        self.resume_download_fn = context.get("resume_download")
        self.save_resolver_settings = context.get("save_resolver_settings")
        self.sanitize_download_filename = context.get(
            "sanitize_download_filename"
        )
        self.extension = context.get("self")
        self.split_path_segments = context.get("split_path_segments")
        self.start_aria2_daemon = context.get("start_aria2_daemon")
        self.start_background_download = context.get("start_background_download")
        self.stop_aria2_daemon = context.get("stop_aria2_daemon")
        self.to_bool = context.get("to_bool")
        self.to_int = context.get("to_int")
        self.validate_public_http_url = context.get("validate_public_http_url")
        self.web = context.get("web")

    @property
    def logger(self):
        return self.extension.logger

    async def download_model(self, request):
        """Validate and start a background model download."""
        data = await request.json()
        url = data.get("url", "")
        filename = data.get("filename", "")
        category = self.normalize_download_category(
            data.get("category", "checkpoints")
        )
        subfolder = data.get("subfolder", "")
        base_directory = data.get("base_directory", "")
        path_metadata = data.get("path_metadata", {})
        if not isinstance(path_metadata, dict):
            path_metadata = {}
        download_metadata = data.get("download_metadata") or data.get(
            "metadata", {}
        )
        if not isinstance(download_metadata, dict):
            download_metadata = {}
        download_metadata = dict(download_metadata)
        settings = self.load_resolver_settings()
        if not base_directory:
            base_directory = self.get_default_root_for_category(category, settings)
        subfolder = self.resolve_download_subfolder(
            category,
            subfolder,
            path_metadata,
            settings,
        )

        if not url:
            return self.web.json_response({"error": "URL is required"}, status=400)
        try:
            url = await self.asyncio.to_thread(self.validate_public_http_url, url)
        except self.unsafe_url_error as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        download_host = urlparse(url).hostname

        if not filename:
            filename = unquote(urlparse(url).path.split("/")[-1])
        filename = self.sanitize_download_filename(filename)

        if not filename:
            return self.web.json_response(
                {"error": "Could not determine filename"}, status=400
            )
        if not self.is_allowed_model_download_filename(filename):
            return self.web.json_response(
                {"error": "Unsupported model file extension"}, status=400
            )

        headers = {}
        if self.host_matches_domain(download_host, "huggingface.co"):
            hf_token = data.get("hf_token", "")
            if hf_token:
                headers["Authorization"] = f"Bearer {hf_token}"
        elif self.host_matches_domain(
            download_host,
            "civitai.com",
            "civitai.red",
        ):
            civitai_key = data.get("civitai_key", "")
            if civitai_key and "token=" not in url:
                url += f"{'&' if '?' in url else '?'}token={civitai_key}"
            civitai_session_token = str(
                data.get("civitai_session_token", "") or ""
            ).strip()
            if civitai_session_token:
                headers["Cookie"] = (
                    f"__Secure-civitai-token={civitai_session_token}"
                )

        inferred_source = ""
        if self.host_matches_domain(download_host, "civitai.com", "civitai.red"):
            inferred_source = "civitai"
        elif self.host_matches_domain(download_host, "huggingface.co"):
            inferred_source = "huggingface"

        download_metadata.setdefault("filename", filename)
        download_metadata.setdefault("category", category)
        download_metadata.setdefault("download_url", url)
        download_metadata.setdefault("source_url", url)
        download_metadata.setdefault("path_metadata", path_metadata)
        download_metadata.setdefault(
            "source",
            self.first_non_empty(
                download_metadata.get("details_source"),
                path_metadata.get("source"),
                inferred_source,
            ),
        )

        model_id = self.to_int(
            self.first_non_empty(
                download_metadata.get("model_id"),
                download_metadata.get("modelId"),
                path_metadata.get("model_id"),
            )
        )
        version_id = self.to_int(
            self.first_non_empty(
                download_metadata.get("version_id"),
                download_metadata.get("versionId"),
                path_metadata.get("version_id"),
            )
        )
        source_name = str(
            self.first_non_empty(
                download_metadata.get("details_source"),
                download_metadata.get("source"),
            )
        ).lower()
        try:
            if (
                source_name == "civitai"
                and model_id
                and not download_metadata.get("civitai_details")
            ):
                details = await self.asyncio.to_thread(
                    self.get_civitai_model_details,
                    model_id,
                    version_id,
                    data.get("civitai_key", ""),
                )
                if details:
                    download_metadata["civitai_details"] = details
            elif (
                source_name == "civarchive"
                and model_id
                and not download_metadata.get("civitai_details")
            ):
                details = await self.asyncio.to_thread(
                    self.get_civarchive_model_details,
                    model_id,
                    version_id,
                )
                if details:
                    download_metadata["civitai_details"] = details
        except Exception as metadata_error:
            self.logger.warning(
                f"Model metadata lookup failed: {metadata_error}"
            )

        target_directory = ""
        target_path = ""
        try:
            target_directory = self.get_download_directory(
                category,
                base_directory,
            ) or ""
            if target_directory and subfolder:
                target_directory = os.path.join(
                    target_directory,
                    *self.split_path_segments(subfolder),
                )
            if target_directory:
                target_path = os.path.join(target_directory, filename)
        except Exception:
            target_directory = ""
            target_path = ""

        download_id = self.start_background_download(
            url=url,
            filename=filename,
            category=category,
            headers=headers if headers else None,
            subfolder=subfolder,
            base_directory=base_directory,
            metadata=download_metadata,
        )

        return self.web.json_response(
            {
                "success": True,
                "download_id": download_id,
                "filename": filename,
                "category": category,
                "path": target_path,
                "directory": target_directory,
                "download_backend": settings.get("download_backend", "python"),
            }
        )

    async def get_download_progress(self, request):
        """Return progress for one download."""
        download_id = request.match_info["download_id"]
        progress = self.get_progress_fn(download_id)
        if progress:
            return self.web.json_response(progress)
        return self.web.json_response({"error": "Download not found"}, status=404)

    async def get_all_downloads_progress(self, request):
        """Return progress for all downloads."""
        return self.web.json_response(self.get_all_progress_fn())

    async def cancel_download(self, request):
        """Cancel a download in progress."""
        download_id = request.match_info["download_id"]
        self.cancel_download_fn(download_id)
        return self.web.json_response({"success": True})

    async def pause_download(self, request):
        """Pause an aria2 download."""
        download_id = request.match_info["download_id"]
        result = self.pause_download_fn(download_id)
        status = 200 if result.get("success") else 400
        return self.web.json_response(result, status=status)

    async def resume_download(self, request):
        """Resume an aria2 download."""
        download_id = request.match_info["download_id"]
        result = self.resume_download_fn(download_id)
        status = 200 if result.get("success") else 400
        return self.web.json_response(result, status=status)

    async def clear_completed_downloads(self, request):
        """Clear completed and failed downloads from progress memory."""
        self.clear_completed_downloads_fn()
        return self.web.json_response({"success": True})

    async def aria2_status(self, request):
        """Report aria2 availability using optional request settings."""
        settings = await self.get_override_settings_from_request(request)
        result = await self.asyncio.to_thread(self.get_aria2_status_fn, settings)
        return self.web.json_response(result)

    async def aria2_start(self, request):
        """Start the aria2 daemon without starting a download."""
        settings = await self.get_override_settings_from_request(request)
        result = await self.asyncio.to_thread(self.start_aria2_daemon, settings)
        status = 200 if result.get("success") else 400
        return self.web.json_response(result, status=status)

    async def aria2_stop(self, request):
        """Stop the aria2 daemon started by Model Resolver."""
        result = await self.asyncio.to_thread(self.stop_aria2_daemon)
        status = 200 if result.get("success") else 400
        return self.web.json_response(result, status=status)

    async def aria2_install(self, request):
        """Install aria2 and persist the selected download backend."""
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        force = False
        if isinstance(payload, dict):
            force = self.to_bool(payload.get("force"), False)
        try:
            install_result = await self.asyncio.to_thread(
                self.install_aria2_engine,
                force,
            )
        except self.aria2_install_error as exc:
            self.logger.warning(f"Model Resolver aria2 install failed: {exc}")
            return self.web.json_response(
                {"success": False, "error": str(exc)},
                status=500,
            )
        settings = await self.asyncio.to_thread(
            self.save_resolver_settings,
            {
                "aria2c_path": install_result.get("aria2c_path", ""),
                "download_backend": "aria2",
            },
        )
        install_result["settings"] = settings
        return self.web.json_response(install_result)

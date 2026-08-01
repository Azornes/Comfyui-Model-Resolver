"""Downloads route registration."""

def register_download_routes(context):
    Aria2InstallError = context.get('Aria2InstallError')
    UnsafeUrlError = context.get('UnsafeUrlError')
    asyncio = context.get('asyncio')
    cancel_download = context.get('cancel_download')
    clear_completed_downloads = context.get('clear_completed_downloads')
    first_non_empty = context.get('first_non_empty')
    get_all_progress = context.get('get_all_progress')
    get_aria2_status = context.get('get_aria2_status')
    get_civarchive_model_details = context.get('get_civarchive_model_details')
    get_civitai_model_details = context.get('get_civitai_model_details')
    get_default_root_for_category = context.get('get_default_root_for_category')
    get_download_directory = context.get('get_download_directory')
    get_override_settings_from_request = context.get('get_override_settings_from_request')
    get_progress = context.get('get_progress')
    host_matches_domain = context.get('host_matches_domain')
    install_aria2_engine = context.get('install_aria2_engine')
    is_allowed_model_download_filename = context.get('is_allowed_model_download_filename')
    json_api_endpoint = context.get('json_api_endpoint')
    load_resolver_settings = context.get('load_resolver_settings')
    normalize_download_category = context.get('normalize_download_category')
    pause_download = context.get('pause_download')
    resolve_download_subfolder = context.get('resolve_download_subfolder')
    resume_download = context.get('resume_download')
    routes = context.get('routes')
    sanitize_download_filename = context.get('sanitize_download_filename')
    save_resolver_settings = context.get('save_resolver_settings')
    self = context.get('self')
    split_path_segments = context.get('split_path_segments')
    start_aria2_daemon = context.get('start_aria2_daemon')
    start_background_download = context.get('start_background_download')
    stop_aria2_daemon = context.get('stop_aria2_daemon')
    to_bool = context.get('to_bool')
    to_int = context.get('to_int')
    validate_public_http_url = context.get('validate_public_http_url')
    web = context.get('web')

    @routes.post("/model_resolver/download")
    @json_api_endpoint("download", return_success_on_error=True)
    async def download_model(request):
        """Start downloading a model."""
        data = await request.json()
        url = data.get("url", "")
        filename = data.get("filename", "")
        category = data.get("category", "checkpoints")
        category = normalize_download_category(category)
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
        settings = load_resolver_settings()
        if not base_directory:
            base_directory = get_default_root_for_category(category, settings)
        subfolder = resolve_download_subfolder(
            category,
            subfolder,
            path_metadata,
            settings,
        )

        if not url:
            return web.json_response(
                {"error": "URL is required"}, status=400
            )
        try:
            url = await asyncio.to_thread(validate_public_http_url, url)
        except UnsafeUrlError as exc:
            return web.json_response({"error": str(exc)}, status=400)

        from urllib.parse import urlparse as _download_urlparse

        download_host = _download_urlparse(url).hostname

        if not filename:
            # Extract filename from URL
            from urllib.parse import unquote, urlparse

            parsed = urlparse(url)
            filename = unquote(parsed.path.split("/")[-1])
        filename = sanitize_download_filename(filename)

        if not filename:
            return web.json_response(
                {"error": "Could not determine filename"}, status=400
            )
        if not is_allowed_model_download_filename(filename):
            return web.json_response(
                {"error": "Unsupported model file extension"}, status=400
            )

        # Build headers if needed
        headers = {}
        if host_matches_domain(download_host, "huggingface.co"):
            hf_token = data.get("hf_token", "")
            if hf_token:
                headers["Authorization"] = f"Bearer {hf_token}"
        elif host_matches_domain(
            download_host,
            "civitai.com",
            "civitai.red",
        ):
            civitai_key = data.get("civitai_key", "")
            if civitai_key and "token=" not in url:
                url += (
                    f"{'&' if '?' in url else '?'}token={civitai_key}"
                )
            civitai_session_token = str(
                data.get("civitai_session_token", "") or ""
            ).strip()
            if civitai_session_token:
                headers["Cookie"] = (
                    f"__Secure-civitai-token={civitai_session_token}"
                )

        def _first_metadata_value(*values):
            return first_non_empty(*values)

        def _metadata_int(value):
            return to_int(value)

        inferred_source = ""
        if host_matches_domain(download_host, "civitai.com", "civitai.red"):
            inferred_source = "civitai"
        elif host_matches_domain(download_host, "huggingface.co"):
            inferred_source = "huggingface"

        download_metadata.setdefault("filename", filename)
        download_metadata.setdefault("category", category)
        download_metadata.setdefault("download_url", url)
        download_metadata.setdefault("source_url", url)
        download_metadata.setdefault("path_metadata", path_metadata)
        download_metadata.setdefault(
            "source",
            _first_metadata_value(
                download_metadata.get("details_source"),
                path_metadata.get("source"),
                inferred_source,
            ),
        )

        model_id = _metadata_int(
            _first_metadata_value(
                download_metadata.get("model_id"),
                download_metadata.get("modelId"),
                path_metadata.get("model_id"),
            )
        )
        version_id = _metadata_int(
            _first_metadata_value(
                download_metadata.get("version_id"),
                download_metadata.get("versionId"),
                path_metadata.get("version_id"),
            )
        )
        source_name = str(
            _first_metadata_value(
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
                details = await asyncio.to_thread(
                    get_civitai_model_details,
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
                details = await asyncio.to_thread(
                    get_civarchive_model_details,
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
            import os as _download_os

            target_directory = (
                get_download_directory(category, base_directory) or ""
            )
            if target_directory and subfolder:
                target_directory = _download_os.path.join(
                    target_directory, *split_path_segments(subfolder)
                )
            if target_directory:
                target_path = _download_os.path.join(
                    target_directory, filename
                )
        except Exception:
            target_directory = ""
            target_path = ""

        # Start background download
        download_id = start_background_download(
            url=url,
            filename=filename,
            category=category,
            headers=headers if headers else None,
            subfolder=subfolder,
            base_directory=base_directory,
            metadata=download_metadata,
        )

        return web.json_response(
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

    @routes.get("/model_resolver/progress/{download_id}")
    @json_api_endpoint("progress")
    async def get_download_progress(request):
        """Get progress for a specific download."""
        download_id = request.match_info["download_id"]
        progress = get_progress(download_id)

        if progress:
            return web.json_response(progress)
        else:
            return web.json_response(
                {"error": "Download not found"}, status=404
            )

    @routes.get("/model_resolver/progress")
    @json_api_endpoint("progress")
    async def get_all_downloads_progress(request):
        """Get progress for all downloads."""
        progress = get_all_progress()
        return web.json_response(progress)

    @routes.post("/model_resolver/cancel/{download_id}")
    @json_api_endpoint("cancel", return_success_on_error=True)
    async def cancel_download_route(request):
        """Cancel a download in progress."""
        download_id = request.match_info["download_id"]
        cancel_download(download_id)
        return web.json_response({"success": True})

    @routes.post("/model_resolver/pause/{download_id}")
    @json_api_endpoint("pause", return_success_on_error=True)
    async def pause_download_route(request):
        """Pause an aria2 download."""
        download_id = request.match_info["download_id"]
        result = pause_download(download_id)
        status = 200 if result.get("success") else 400
        return web.json_response(result, status=status)

    @routes.post("/model_resolver/resume/{download_id}")
    @json_api_endpoint("resume", return_success_on_error=True)
    async def resume_download_route(request):
        """Resume an aria2 download."""
        download_id = request.match_info["download_id"]
        result = resume_download(download_id)
        status = 200 if result.get("success") else 400
        return web.json_response(result, status=status)

    @routes.post("/model_resolver/clear_completed_downloads")
    @json_api_endpoint("clear_completed_downloads", return_success_on_error=True)
    async def clear_completed_downloads_route(request):
        """Clear completed and failed downloads from progress memory."""
        clear_completed_downloads()
        return web.json_response({"success": True})

    @routes.get("/model_resolver/aria2/status")
    @routes.post("/model_resolver/aria2/status")
    @json_api_endpoint("aria2 status")
    async def aria2_status_route(request):
        """Report aria2 availability using saved settings, with optional override via POST."""
        settings = await get_override_settings_from_request(request)
        return web.json_response(await asyncio.to_thread(get_aria2_status, settings))


    @routes.post("/model_resolver/aria2/start")
    @json_api_endpoint("aria2 start", return_success_on_error=True)
    async def aria2_start_route(request):
        """Start the aria2 daemon without starting a download."""
        settings = await get_override_settings_from_request(request)
        result = await asyncio.to_thread(start_aria2_daemon, settings)
        status = 200 if result.get("success") else 400
        return web.json_response(result, status=status)

    @routes.get("/model_resolver/aria2/stop")
    @routes.post("/model_resolver/aria2/stop")
    @json_api_endpoint("aria2 stop", return_success_on_error=True)
    async def aria2_stop_route(request):
        """Stop the aria2 daemon started by Model Resolver."""
        result = await asyncio.to_thread(stop_aria2_daemon)
        status = 200 if result.get("success") else 400
        return web.json_response(result, status=status)

    @routes.post("/model_resolver/aria2/install")
    @json_api_endpoint("aria2 install")
    async def aria2_install_route(request):
        """Download official aria2c binary and save its path."""
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        force = False
        if isinstance(payload, dict):
            force = to_bool(payload.get("force"), False)
        try:
            install_result = await asyncio.to_thread(install_aria2_engine, force)
        except Aria2InstallError as exc:
            self.logger.warning(f"Model Resolver aria2 install failed: {exc}")
            return web.json_response({"success": False, "error": str(exc)}, status=500)
        settings = await asyncio.to_thread(
            save_resolver_settings,
            {
                "aria2c_path": install_result.get("aria2c_path", ""),
                "download_backend": "aria2",
            },
        )
        install_result["settings"] = settings
        return web.json_response(install_result)

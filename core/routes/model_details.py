"""Model details route registration."""

from .context import RouteContext


def register_model_details_routes(context: RouteContext):
    asyncio = context.get('asyncio')
    download_available = context.get('download_available')
    get_civarchive_model_details = context.get('get_civarchive_model_details')
    get_civitai_model_details = context.get('get_civitai_model_details')
    get_huggingface_model_details = context.get('get_huggingface_model_details')
    json_api_endpoint = context.get('json_api_endpoint')
    routes = context.get('routes')
    web = context.get('web')

    @routes.post("/model_resolver/model-details")
    @json_api_endpoint("model-details")
    async def model_details(request):
        """Return normalized full model details for sources that expose model pages."""
        data = await request.json()
        source = str(data.get("source", "")).strip().lower()
        model_id = data.get("model_id")
        version_id = data.get("version_id")
        civitai_key = data.get("civitai_key", "")
        hf_token = data.get("hf_token", "")
        file_path = data.get("file_path", "")
        branch = data.get("branch", "")

        if not download_available:
            return web.json_response(
                {"error": "Download providers are not available"}, status=503
            )

        if source == "lora_manager_archive":
            source = "civitai"

        if source not in {"civitai", "civarchive", "huggingface"}:
            return web.json_response(
                {"error": "Unsupported model details source"}, status=400
            )

        if source == "huggingface":
            model_id = str(model_id or "").strip()
            branch = str(branch or version_id or "main").strip() or "main"
            version_id = branch
        else:
            try:
                model_id = (
                    int(model_id)
                    if model_id is not None and str(model_id).strip()
                    else None
                )
            except (TypeError, ValueError):
                model_id = None

            try:
                version_id = (
                    int(version_id)
                    if version_id is not None and str(version_id).strip()
                    else None
                )
            except (TypeError, ValueError):
                version_id = None

        if not model_id:
            return web.json_response(
                {"error": "model_id is required"}, status=400
            )

        if source == "civitai":
            details = await asyncio.to_thread(
                get_civitai_model_details,
                model_id,
                version_id,
                civitai_key or None,
            )
        elif source == "civarchive":
            details = await asyncio.to_thread(
                get_civarchive_model_details,
                model_id,
                version_id,
            )
        else:
            details = await asyncio.to_thread(
                get_huggingface_model_details,
                model_id,
                file_path,
                branch,
                hf_token or None,
            )

        if not details:
            return web.json_response(
                {"error": "Model details not found"}, status=404
            )

        return web.json_response(details)

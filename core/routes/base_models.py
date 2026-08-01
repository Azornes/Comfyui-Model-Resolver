"""Routes for the bundled base-model catalog."""

import asyncio

from ..sources.popular import (
    get_base_models_config,
    get_base_models_status,
    update_base_models_from_remote,
)


def register_base_model_routes(routes, web, json_api_endpoint):
    """Register base-model catalog endpoints."""

    @routes.get("/model_resolver/base-models")
    @json_api_endpoint("base-models")
    async def get_base_models(request):
        """Return the bundled base-model configuration."""
        data = get_base_models_config()
        return web.json_response(data)

    @routes.get("/model_resolver/base-models/status")
    @json_api_endpoint("base-models status")
    async def get_base_models_status_route(request):
        """Get local and optional remote base-model status."""
        check_remote = request.query.get("check_remote") == "1"
        status = await asyncio.to_thread(get_base_models_status, check_remote)
        return web.json_response(status)

    @routes.post("/model_resolver/base-models/update")
    @json_api_endpoint("base-models update")
    async def update_base_models_route(request):
        """Update the base-model list from CivitAI."""
        status = await asyncio.to_thread(update_base_models_from_remote)
        return web.json_response(status)

"""CivitAI and exact model metadata route registration."""

from ..services.model_service import ModelService
from .context import RouteContext


def register_civitai_search_routes(context: RouteContext):
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")
    model_service = ModelService(context)

    @routes.post("/model_resolver/civitai-search")
    @json_api_endpoint("civitai-search")
    async def civitai_search(request):
        """Delegate model operation to the model service."""
        return await model_service.civitai_search(request)

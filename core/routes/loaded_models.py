"""Loaded model route registration."""

from ..services.loaded_models_service import LoadedModelsService
from .context import RouteContext


def register_loaded_model_routes(context: RouteContext):
    """Register loaded model routes and delegate behavior to a service."""
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")
    service = LoadedModelsService(context)

    @routes.post("/model_resolver/loaded")
    @json_api_endpoint("get_loaded_models")
    async def get_loaded_models(request):
        return await service.get_loaded_models(request)

    @routes.get("/model_resolver/loaded-progress/{loaded_id}")
    @json_api_endpoint("loaded-progress")
    async def get_loaded_models_progress(request):
        return await service.get_loaded_models_progress(request)

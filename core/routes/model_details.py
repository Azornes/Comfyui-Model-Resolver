"""Model details route registration."""

from ..services.model_service import ModelService
from .context import RouteContext


def register_model_details_routes(context: RouteContext):
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")
    model_service = ModelService(context)

    @routes.post("/model_resolver/model-details")
    @json_api_endpoint("model-details")
    async def model_details(request):
        """Delegate model operation to the model service."""
        return await model_service.model_details(request)

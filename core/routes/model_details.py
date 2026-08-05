"""Model details route registration."""

from ..services.model_service import ModelService
from .context import RouteContext
from .helpers import register_service_route


def register_model_details_routes(context: RouteContext):
    model_service = ModelService(context)
    register_service_route(
        context,
        path="/model_resolver/model-details",
        error_prefix="model-details",
        operation=model_service.model_details,
    )

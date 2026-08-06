"""Custom model URL route registration."""

from ..services.model_service import ModelService
from .context import RouteContext
from .helpers import register_service_route


def register_custom_url_routes(
    context: RouteContext,
    model_service: ModelService,
):
    register_service_route(
        context,
        path="/model_resolver/custom-url",
        error_prefix="custom-url",
        operation=model_service.custom_url,
    )

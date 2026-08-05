"""CivitAI and exact model metadata route registration."""

from ..services.model_service import ModelService
from .context import RouteContext
from .helpers import register_service_route


def register_civitai_search_routes(context: RouteContext):
    model_service = ModelService(context)
    register_service_route(
        context,
        path="/model_resolver/civitai-search",
        error_prefix="civitai-search",
        operation=model_service.civitai_search,
    )

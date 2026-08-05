"""Loaded model route registration."""

from ..services.loaded_models_service import LoadedModelsService
from .context import RouteContext
from .helpers import register_service_route


def register_loaded_model_routes(context: RouteContext):
    """Register loaded model routes and delegate behavior to a service."""
    service = LoadedModelsService(context)

    register_service_route(
        context,
        path="/model_resolver/loaded",
        error_prefix="get_loaded_models",
        operation=service.get_loaded_models,
    )
    register_service_route(
        context,
        path="/model_resolver/loaded-progress/{loaded_id}",
        methods=("get",),
        error_prefix="loaded-progress",
        operation=service.get_loaded_models_progress,
    )

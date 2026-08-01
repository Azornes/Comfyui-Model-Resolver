"""Compatibility exports for model information route registration."""

from .civitai_search import register_civitai_search_routes
from .context import RouteContext
from .custom_url import register_custom_url_routes
from .model_details import register_model_details_routes


def register_model_info_routes(context: RouteContext):
    register_civitai_search_routes(context)
    register_custom_url_routes(context)
    register_model_details_routes(context)

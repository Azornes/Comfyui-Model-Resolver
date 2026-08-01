"""Compatibility exports for search route registration."""

from .context import RouteContext
from .search_support import register_search_support_routes
from .source_search import register_source_search_routes


def register_search_routes(context: RouteContext):
    register_source_search_routes(context)
    register_search_support_routes(context)

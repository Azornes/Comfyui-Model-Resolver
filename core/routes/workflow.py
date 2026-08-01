"""Compatibility exports for workflow route registration."""

from .context import RouteContext
from .hashes import register_hash_routes
from .loaded_models import register_loaded_model_routes
from .workflow_analysis import register_workflow_analysis_routes

__all__ = ["register_loaded_model_routes", "register_workflow_routes"]

def register_workflow_routes(context: RouteContext):
    register_workflow_analysis_routes(context)
    register_hash_routes(context)

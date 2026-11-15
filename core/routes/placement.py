"""Placement routes for checking and moving misplaced models."""

from ..services.placement_service import PlacementService
from .context import RouteContext
from .helpers import register_service_route


def register_placement_routes(context: RouteContext):
    """Register placement and tidy routes."""
    placement_service = PlacementService(context)

    register_service_route(
        context,
        path="/model_resolver/placement/check",
        methods=("get",),
        error_prefix="placement check",
        operation=placement_service.check_placement,
    )
    register_service_route(
        context,
        path="/model_resolver/placement/look",
        methods=("get",),
        error_prefix="placement look",
        operation=placement_service.look_placement,
    )
    register_service_route(
        context,
        path="/model_resolver/placement/move",
        methods=("post",),
        error_prefix="placement move",
        operation=placement_service.move_model,
    )

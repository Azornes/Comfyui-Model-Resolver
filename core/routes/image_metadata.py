"""Workflow metadata inspection route registration."""

from ..services.image_metadata_service import ImageMetadataService
from .context import RouteContext
from .helpers import register_service_route


def register_image_metadata_routes(context: RouteContext):
    """Register the read-only image/JSON workflow inspector endpoint."""
    service = ImageMetadataService(context)
    register_service_route(
        context,
        path="/model_resolver/inspect-metadata",
        error_prefix="inspect-metadata",
        operation=service.inspect_metadata,
    )

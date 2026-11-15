"""HTTP routes for workflow model export and public link sharing."""

from ..services.exporter_service import ExporterService
from .context import RouteContext
from .helpers import register_service_route


def register_exporter_routes(context: RouteContext):
    """Register workflow model export routes."""
    service = ExporterService(context)
    routes = context.get("routes")

    register_service_route(
        context,
        path="/model_resolver/export/markdown",
        error_prefix="export-markdown",
        operation=service.export_markdown,
    )
    register_service_route(
        context,
        path="/model_resolver/export/lookup",
        error_prefix="export-lookup",
        operation=service.export_lookup,
    )
    register_service_route(
        context,
        path="/model_resolver/export/hash",
        error_prefix="export-hash-start",
        operation=service.export_hash_start,
    )

    @routes.get("/model_resolver/export/hash/{job_id}")
    async def get_export_hash_status(request):
        return await service.export_hash_status(request)

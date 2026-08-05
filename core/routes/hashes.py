"""HTTP adapters for local model and hash operations."""

from ..services.hash_service import HashService
from .context import RouteContext
from .helpers import register_service_route


def register_hash_routes(context: RouteContext):
    """Register hash routes and delegate behavior to :class:`HashService`."""
    service = HashService(context)
    routes = context.get("routes")

    register_service_route(
        context,
        path="/model_resolver/local-model-hashes",
        error_prefix="local-model-hashes",
        operation=service.local_model_hashes,
    )

    @routes.get("/model_resolver/model-preview")
    async def get_model_preview(request):
        return await service.get_model_preview(request)

    register_service_route(
        context,
        path="/model_resolver/workflow-model-hashes",
        error_prefix="workflow-model-hashes",
        operation=service.workflow_model_hashes,
    )
    register_service_route(
        context,
        path="/model_resolver/local-matches-by-hash",
        error_prefix="local-matches-by-hash",
        operation=service.local_matches_by_hash,
    )
    register_service_route(
        context,
        path="/model_resolver/open-containing-folder",
        error_prefix="open-containing-folder",
        operation=service.open_containing_folder,
    )
    register_service_route(
        context,
        path="/model_resolver/calculate-file-hash",
        error_prefix="calculate-file-hash",
        operation=service.calculate_file_hash,
    )
    register_service_route(
        context,
        path="/model_resolver/calculate-file-hash/start",
        error_prefix="calculate-file-hash-start",
        operation=service.calculate_file_hash_start,
    )
    register_service_route(
        context,
        path="/model_resolver/calculate-file-hash/progress/{progress_id}",
        methods=("get",),
        error_prefix="calculate-file-hash-progress",
        operation=service.calculate_file_hash_progress,
    )
    register_service_route(
        context,
        path="/model_resolver/calculate-file-hash/cancel/{progress_id}",
        error_prefix="calculate-file-hash-cancel",
        operation=service.calculate_file_hash_cancel,
    )

"""HTTP adapters for local model and hash operations."""

from ..services.hash_service import HashService
from .context import RouteContext


def register_hash_routes(context: RouteContext):
    """Register hash routes and delegate behavior to :class:`HashService`."""
    service = HashService(context)
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")

    @routes.post("/model_resolver/local-model-hashes")
    @json_api_endpoint("local-model-hashes")
    async def local_model_hashes(request):
        return await service.local_model_hashes(request)

    @routes.get("/model_resolver/model-preview")
    async def get_model_preview(request):
        return await service.get_model_preview(request)

    @routes.post("/model_resolver/workflow-model-hashes")
    @json_api_endpoint("workflow-model-hashes")
    async def workflow_model_hashes(request):
        return await service.workflow_model_hashes(request)

    @routes.post("/model_resolver/local-matches-by-hash")
    @json_api_endpoint("local-matches-by-hash")
    async def local_matches_by_hash(request):
        return await service.local_matches_by_hash(request)

    @routes.post("/model_resolver/open-containing-folder")
    @json_api_endpoint("open-containing-folder")
    async def open_containing_folder(request):
        return await service.open_containing_folder(request)

    @routes.post("/model_resolver/calculate-file-hash")
    @json_api_endpoint("calculate-file-hash")
    async def calculate_file_hash_route(request):
        return await service.calculate_file_hash(request)

    @routes.post("/model_resolver/calculate-file-hash/start")
    @json_api_endpoint("calculate-file-hash-start")
    async def calculate_file_hash_start_route(request):
        return await service.calculate_file_hash_start(request)

    @routes.get("/model_resolver/calculate-file-hash/progress/{progress_id}")
    @json_api_endpoint("calculate-file-hash-progress")
    async def calculate_file_hash_progress_route(request):
        return await service.calculate_file_hash_progress(request)

    @routes.post("/model_resolver/calculate-file-hash/cancel/{progress_id}")
    @json_api_endpoint("calculate-file-hash-cancel")
    async def calculate_file_hash_cancel_route(request):
        return await service.calculate_file_hash_cancel(request)

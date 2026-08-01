"""HTTP adapters for download operations."""

from ..services.download_service import DownloadService
from .context import RouteContext


def register_download_routes(context: RouteContext):
    """Register download routes and delegate behavior to :class:`DownloadService`."""
    service = DownloadService(context)
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")

    @routes.post("/model_resolver/download")
    @json_api_endpoint("download", return_success_on_error=True)
    async def download_model(request):
        return await service.download_model(request)

    @routes.get("/model_resolver/progress/{download_id}")
    @json_api_endpoint("progress")
    async def get_download_progress(request):
        return await service.get_download_progress(request)

    @routes.get("/model_resolver/progress")
    @json_api_endpoint("progress")
    async def get_all_downloads_progress(request):
        return await service.get_all_downloads_progress(request)

    @routes.post("/model_resolver/cancel/{download_id}")
    @json_api_endpoint("cancel", return_success_on_error=True)
    async def cancel_download_route(request):
        return await service.cancel_download(request)

    @routes.post("/model_resolver/pause/{download_id}")
    @json_api_endpoint("pause", return_success_on_error=True)
    async def pause_download_route(request):
        return await service.pause_download(request)

    @routes.post("/model_resolver/resume/{download_id}")
    @json_api_endpoint("resume", return_success_on_error=True)
    async def resume_download_route(request):
        return await service.resume_download(request)

    @routes.post("/model_resolver/clear_completed_downloads")
    @json_api_endpoint("clear_completed_downloads", return_success_on_error=True)
    async def clear_completed_downloads_route(request):
        return await service.clear_completed_downloads(request)

    @routes.get("/model_resolver/aria2/status")
    @routes.post("/model_resolver/aria2/status")
    @json_api_endpoint("aria2 status")
    async def aria2_status_route(request):
        return await service.aria2_status(request)

    @routes.post("/model_resolver/aria2/start")
    @json_api_endpoint("aria2 start", return_success_on_error=True)
    async def aria2_start_route(request):
        return await service.aria2_start(request)

    @routes.get("/model_resolver/aria2/stop")
    @routes.post("/model_resolver/aria2/stop")
    @json_api_endpoint("aria2 stop", return_success_on_error=True)
    async def aria2_stop_route(request):
        return await service.aria2_stop(request)

    @routes.post("/model_resolver/aria2/install")
    @json_api_endpoint("aria2 install")
    async def aria2_install_route(request):
        return await service.aria2_install(request)

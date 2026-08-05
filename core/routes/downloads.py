"""HTTP adapters for download operations."""

from ..services.download_service import DownloadService
from .context import RouteContext
from .helpers import register_service_route


def register_download_routes(context: RouteContext):
    """Register download routes and delegate behavior to :class:`DownloadService`."""
    service = DownloadService(context)

    register_service_route(
        context,
        path="/model_resolver/download",
        error_prefix="download",
        operation=service.download_model,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/progress/{download_id}",
        methods=("get",),
        error_prefix="progress",
        operation=service.get_download_progress,
    )
    register_service_route(
        context,
        path="/model_resolver/progress",
        methods=("get",),
        error_prefix="progress",
        operation=service.get_all_downloads_progress,
    )
    register_service_route(
        context,
        path="/model_resolver/cancel/{download_id}",
        error_prefix="cancel",
        operation=service.cancel_download,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/pause/{download_id}",
        error_prefix="pause",
        operation=service.pause_download,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/resume/{download_id}",
        error_prefix="resume",
        operation=service.resume_download,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/clear_completed_downloads",
        error_prefix="clear_completed_downloads",
        operation=service.clear_completed_downloads,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/aria2/status",
        methods=("get", "post"),
        error_prefix="aria2 status",
        operation=service.aria2_status,
    )
    register_service_route(
        context,
        path="/model_resolver/aria2/start",
        error_prefix="aria2 start",
        operation=service.aria2_start,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/aria2/stop",
        methods=("get", "post"),
        error_prefix="aria2 stop",
        operation=service.aria2_stop,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/aria2/install",
        error_prefix="aria2 install",
        operation=service.aria2_install,
    )

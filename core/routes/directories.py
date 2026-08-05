"""Directories route registration."""

from ..services.directory_service import DirectoryService
from ..services.scanner_service import ScannerService
from .context import RouteContext
from .helpers import register_service_route


def register_directory_routes(context: RouteContext):
    """Register directory routes and delegate behavior to services."""
    json_api_endpoint = context.get("json_api_endpoint")
    register_version_routes = context.get("register_version_routes")
    routes = context.get("routes")
    web = context.get("web")
    directory_service = DirectoryService(context)
    scanner_service = ScannerService(context)

    register_service_route(
        context,
        path="/model_resolver/directories",
        methods=("get",),
        error_prefix="directories",
        operation=directory_service.get_directories,
    )
    register_service_route(
        context,
        path="/model_resolver/root-directories",
        methods=("get",),
        error_prefix="root directories",
        operation=directory_service.get_root_directories,
    )
    register_service_route(
        context,
        path="/model_resolver/path-template-suggestions",
        methods=("get",),
        error_prefix="path template suggestions",
        operation=scanner_service.get_path_template_suggestions,
    )
    register_service_route(
        context,
        path="/model_resolver/capabilities",
        methods=("get",),
        error_prefix="capabilities",
        operation=directory_service.get_capabilities,
    )

    register_version_routes(routes, web, json_api_endpoint)

    register_service_route(
        context,
        path="/model_resolver/subfolders/{category}",
        methods=("get",),
        error_prefix="subfolders",
        operation=directory_service.get_subfolders,
    )

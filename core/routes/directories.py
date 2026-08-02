"""Directories route registration."""

from ..services.directory_service import DirectoryService
from ..services.scanner_service import ScannerService
from .context import RouteContext


def register_directory_routes(context: RouteContext):
    """Register directory routes and delegate behavior to services."""
    json_api_endpoint = context.get("json_api_endpoint")
    register_version_routes = context.get("register_version_routes")
    routes = context.get("routes")
    web = context.get("web")
    directory_service = DirectoryService(context)
    scanner_service = ScannerService(context)

    @routes.get("/model_resolver/directories")
    @json_api_endpoint("directories")
    async def get_directories(request):
        return await directory_service.get_directories(request)

    @routes.get("/model_resolver/root-directories")
    @json_api_endpoint("root directories")
    async def get_root_directories(request):
        return await directory_service.get_root_directories(request)

    @routes.get("/model_resolver/path-template-suggestions")
    @json_api_endpoint("path template suggestions")
    async def get_path_template_suggestions(request):
        return await scanner_service.get_path_template_suggestions(request)

    @routes.get("/model_resolver/capabilities")
    @json_api_endpoint("capabilities")
    async def get_capabilities(request):
        return await directory_service.get_capabilities(request)

    register_version_routes(routes, web, json_api_endpoint)

    @routes.get("/model_resolver/subfolders/{category}")
    @json_api_endpoint("subfolders")
    async def get_subfolders(request):
        return await directory_service.get_subfolders(request)

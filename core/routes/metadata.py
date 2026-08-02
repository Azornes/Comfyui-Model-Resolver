"""Metadata route registration."""

from ..services.metadata_service import MetadataService
from ..services.scanner_service import ScannerService
from .context import RouteContext


def register_metadata_routes(context: RouteContext):
    json_api_endpoint = context.get('json_api_endpoint')
    routes = context.get('routes')
    scanner_service = ScannerService(context)
    metadata_service = MetadataService(context)

    @routes.get("/model_resolver/models")
    @json_api_endpoint("get_models")
    async def get_models(request):
        """Get list of all available models."""
        return await scanner_service.get_models(request)

    @routes.post("/model_resolver/metadata-size-audit")
    @json_api_endpoint("metadata-size-audit")
    async def metadata_size_audit_route(request):
        """Check local model .metadata.json sidecars for stale size values."""
        return await metadata_service.metadata_size_audit(request)

    @routes.get("/model_resolver/metadata-build/capabilities")
    @json_api_endpoint("metadata-build-capabilities")
    async def metadata_build_capabilities_route(request):
        """Return local CPU and worker limits for the metadata builder."""
        return await metadata_service.metadata_build_capabilities(request)

    @routes.post("/model_resolver/metadata-build/start")
    @json_api_endpoint("metadata-build-start")
    async def metadata_build_start_route(request):
        """Create missing local metadata sidecars and fill missing SHA256 values."""
        return await metadata_service.metadata_build_start(request)

    @routes.get("/model_resolver/metadata-build/progress/{progress_id}")
    @json_api_endpoint("metadata-build-progress")
    async def metadata_build_progress_route(request):
        """Return progress for local metadata sidecar creation."""
        return await metadata_service.metadata_build_progress(request)

    @routes.post("/model_resolver/metadata-build/cancel/{progress_id}")
    @json_api_endpoint("metadata-build-cancel")
    async def metadata_build_cancel_route(request):
        """Cancel local metadata sidecar creation."""
        return await metadata_service.metadata_build_cancel(request)

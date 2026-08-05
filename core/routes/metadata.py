"""Metadata route registration."""

from ..services.metadata_service import MetadataService
from ..services.scanner_service import ScannerService
from .context import RouteContext
from .helpers import register_service_route


def register_metadata_routes(context: RouteContext):
    scanner_service = ScannerService(context)
    metadata_service = MetadataService(context)

    register_service_route(
        context,
        path="/model_resolver/models",
        methods=("get",),
        error_prefix="get_models",
        operation=scanner_service.get_models,
    )
    register_service_route(
        context,
        path="/model_resolver/metadata-size-audit",
        error_prefix="metadata-size-audit",
        operation=metadata_service.metadata_size_audit,
    )
    register_service_route(
        context,
        path="/model_resolver/metadata-build/capabilities",
        methods=("get",),
        error_prefix="metadata-build-capabilities",
        operation=metadata_service.metadata_build_capabilities,
    )
    register_service_route(
        context,
        path="/model_resolver/metadata-build/start",
        error_prefix="metadata-build-start",
        operation=metadata_service.metadata_build_start,
    )
    register_service_route(
        context,
        path="/model_resolver/metadata-build/progress/{progress_id}",
        methods=("get",),
        error_prefix="metadata-build-progress",
        operation=metadata_service.metadata_build_progress,
    )
    register_service_route(
        context,
        path="/model_resolver/metadata-build/cancel/{progress_id}",
        error_prefix="metadata-build-cancel",
        operation=metadata_service.metadata_build_cancel,
    )

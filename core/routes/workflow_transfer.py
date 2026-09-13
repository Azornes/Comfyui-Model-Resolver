"""Workflow metadata transfer route registration."""

from ..services.workflow_transfer_service import WorkflowTransferService
from .context import RouteContext
from .helpers import register_service_route


def register_workflow_transfer_routes(context: RouteContext):
    """Register the workflow metadata transfer endpoint."""
    service = WorkflowTransferService(context)
    register_service_route(
        context,
        path="/model_resolver/transfer-models",
        error_prefix="transfer-models",
        operation=service.transfer_models,
    )

"""Workflow analysis route registration."""

from ..services.workflow_service import WorkflowService
from .context import RouteContext
from .helpers import register_service_route


def register_workflow_analysis_routes(context: RouteContext):
    get_progress_response = context.get("get_progress_response")
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")
    self = context.get("self")
    workflow_service = WorkflowService(context)

    @routes.post("/model_resolver/analyze")
    async def analyze_workflow(request):
        return await workflow_service.analyze_workflow(request)

    @routes.get("/model_resolver/analyze-progress/{analysis_id}")
    @json_api_endpoint("analyze-progress")
    async def get_analyze_progress(request):
        """Get workflow analysis progress."""
        return get_progress_response(
            self.analysis_progress,
            request,
            param_name="analysis_id",
            not_found_payload={
                "status": "unknown",
                "stage": "unknown",
                "message": "No analysis progress available",
                "current": 0,
                "total": 0,
            }
        )

    register_service_route(
        context,
        path="/model_resolver/resolve",
        error_prefix="resolve",
        operation=workflow_service.resolve_models,
        return_success_on_error=True,
    )
    register_service_route(
        context,
        path="/model_resolver/local-matches",
        error_prefix="local-matches",
        operation=workflow_service.local_matches,
    )

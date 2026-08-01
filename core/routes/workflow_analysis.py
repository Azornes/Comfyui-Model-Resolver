"""Workflow analysis route registration."""

from ..services.workflow_service import WorkflowService
from .context import RouteContext


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

    @routes.post("/model_resolver/resolve")
    @json_api_endpoint("resolve", return_success_on_error=True)
    async def resolve_models(request):
        return await workflow_service.resolve_models(request)

    @routes.post("/model_resolver/local-matches")
    @json_api_endpoint("local-matches")
    async def local_matches(request):
        return await workflow_service.local_matches(request)

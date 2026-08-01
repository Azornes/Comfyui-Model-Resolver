"""Remote source search route registration."""

from ..services.search_service import SearchService
from .context import RouteContext


def register_source_search_routes(context: RouteContext):
    cancel_progress_response = context.get("cancel_progress_response")
    get_progress_response = context.get("get_progress_response")
    json_api_endpoint = context.get("json_api_endpoint")
    routes = context.get("routes")
    self = context.get("self")
    search_service = SearchService(context)

    @routes.get("/model_resolver/search-progress/{progress_id}")
    @json_api_endpoint("search-progress")
    async def get_search_progress_route(request):
        """Return live progress for an in-flight source search."""
        return get_progress_response(
            self.search_tracker,
            request,
            not_found_payload={"exists": False},
            found_wrapper=lambda prog: {"exists": True, **prog}
        )

    @routes.post("/model_resolver/search-cancel/{progress_id}")
    @json_api_endpoint("search-cancel", return_success_on_error=True)
    async def cancel_search_progress_route(request):
        """Mark an in-flight source search as cancelled."""
        return cancel_progress_response(
            self.search_tracker,
            request,
            cancel_message="Cancelled"
        )

    @routes.post("/model_resolver/search")
    async def search_sources(request):
        return await search_service.search_sources(request)

"""Search cache, credentials, and index route registration."""

from ..services.search_support_service import SearchSupportService
from .context import RouteContext


def register_search_support_routes(context: RouteContext):
    json_api_endpoint = context.require("json_api_endpoint")
    routes = context.require("routes")
    service = SearchSupportService(context)

    @routes.post("/model_resolver/clear-search-cache")
    @json_api_endpoint("Clear search cache")
    async def clear_search_cache_route(request):
        return await service.clear_search_cache(request)

    @routes.post("/model_resolver/civitai/session-token/check")
    async def civitai_session_token_check_route(request):
        return await service.check_civitai_session_token_route(request)

    @routes.post("/model_resolver/civitai/api-key/check")
    async def civitai_api_key_check_route(request):
        return await service.check_civitai_api_key_route(request)

    @routes.post("/model_resolver/huggingface/token/check")
    async def huggingface_token_check_route(request):
        return await service.check_huggingface_token_route(request)

    @routes.post("/model_resolver/brave/api-key/check")
    async def brave_api_key_check_route(request):
        return await service.check_brave_search_api_key_route(request)

    @routes.get("/model_resolver/huggingface/author-index/status")
    @json_api_endpoint("HuggingFace author index status")
    async def huggingface_author_index_status_route(request):
        return await service.author_index_status(request)

    @routes.post("/model_resolver/huggingface/author-index/refresh")
    @json_api_endpoint("HuggingFace author index refresh")
    async def huggingface_author_index_refresh_route(request):
        return await service.refresh_author_index(request)

    @routes.get("/model_resolver/model-list/status")
    @json_api_endpoint("Model list status")
    async def model_list_status_route(request):
        return await service.model_list_status(request)

    @routes.post("/model_resolver/model-list/update")
    @json_api_endpoint("Model list update")
    async def model_list_update_route(request):
        return await service.update_model_list(request)

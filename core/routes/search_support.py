"""Search cache, credentials, and index route registration."""

from ..services.search_support_service import SearchSupportService
from .context import RouteContext
from .helpers import register_service_route


def register_search_support_routes(context: RouteContext):
    service = SearchSupportService(context)

    register_service_route(
        context,
        path="/model_resolver/clear-search-cache",
        error_prefix="Clear search cache",
        operation=service.clear_search_cache,
    )

    credential_routes = (
        (
            "/model_resolver/civitai/session-token/check",
            service.check_civitai_session_token_route,
        ),
        (
            "/model_resolver/civitai/api-key/check",
            service.check_civitai_api_key_route,
        ),
        (
            "/model_resolver/huggingface/token/check",
            service.check_huggingface_token_route,
        ),
        (
            "/model_resolver/brave/api-key/check",
            service.check_brave_search_api_key_route,
        ),
    )
    for path, operation in credential_routes:
        register_service_route(
            context,
            path=path,
            error_prefix="Credential check",
            operation=operation,
        )

    register_service_route(
        context,
        path="/model_resolver/huggingface/author-index/status",
        methods=("get",),
        error_prefix="HuggingFace author index status",
        operation=service.author_index_status,
    )
    register_service_route(
        context,
        path="/model_resolver/huggingface/author-index/refresh",
        error_prefix="HuggingFace author index refresh",
        operation=service.refresh_author_index,
    )
    register_service_route(
        context,
        path="/model_resolver/model-list/status",
        methods=("get",),
        error_prefix="Model list status",
        operation=service.model_list_status,
    )
    register_service_route(
        context,
        path="/model_resolver/model-list/update",
        error_prefix="Model list update",
        operation=service.update_model_list,
    )

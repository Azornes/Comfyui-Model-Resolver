"""Search cache, credentials, and index route registration."""

from .context import RouteContext


def register_search_support_routes(context: RouteContext):
    asyncio = context.get('asyncio')
    check_brave_search_api_key = context.get('check_brave_search_api_key')
    check_civitai_api_key = context.get('check_civitai_api_key')
    check_civitai_session_token = context.get('check_civitai_session_token')
    check_huggingface_token = context.get('check_huggingface_token')
    clear_all_search_caches = context.get('clear_all_search_caches')
    clear_huggingface_search_cache = context.get('clear_huggingface_search_cache')
    get_known_author_fallback_indexes_status = context.get('get_known_author_fallback_indexes_status')
    get_model_list_update_status = context.get('get_model_list_update_status')
    invalidate_local_hash_match_cache = context.get('invalidate_local_hash_match_cache')
    invalidate_model_files_cache = context.get('invalidate_model_files_cache')
    json_api_endpoint = context.get('json_api_endpoint')
    refresh_known_author_fallback_indexes = context.get('refresh_known_author_fallback_indexes')
    reload_model_list = context.get('reload_model_list')
    reload_popular_databases = context.get('reload_popular_databases')
    routes = context.get('routes')
    self = context.get('self')
    update_model_list_from_remote = context.get('update_model_list_from_remote')
    web = context.get('web')

    @routes.post("/model_resolver/clear-search-cache")
    @json_api_endpoint("Clear search cache")
    async def clear_search_cache_route(request):
        """Clear backend search caches after token/settings changes."""
        clear_all_search_caches()
        reload_popular_databases()
        reload_model_list()
        invalidate_model_files_cache()
        invalidate_local_hash_match_cache()
        self.search_result_timestamps.clear()
        self.logger.info("Cleared backend search caches")
        return web.json_response({"success": True, "cleared": "all"})

    async def _check_credential_helper(request, payload_key, check_func, log_name):
        try:
            data = await request.json()
            val = data.get(payload_key, "")
            result = await asyncio.to_thread(check_func, val)
            return web.json_response(result)
        except Exception as e:
            self.logger.exception(f"{log_name} check error: {e}")
            return web.json_response({"error": str(e)}, status=500)

    @routes.post("/model_resolver/civitai/session-token/check")
    async def civitai_session_token_check_route(request):
        """Check whether a CivitAI browser session token is valid."""
        return await _check_credential_helper(
            request, "civitai_session_token", check_civitai_session_token, "CivitAI session token"
        )

    @routes.post("/model_resolver/civitai/api-key/check")
    async def civitai_api_key_check_route(request):
        """Check whether a CivitAI API key is valid."""
        return await _check_credential_helper(
            request, "civitai_key", check_civitai_api_key, "CivitAI API key"
        )

    @routes.post("/model_resolver/huggingface/token/check")
    async def huggingface_token_check_route(request):
        """Check whether a HuggingFace token is valid."""
        return await _check_credential_helper(
            request, "hf_token", check_huggingface_token, "HuggingFace token"
        )

    @routes.post("/model_resolver/brave/api-key/check")
    async def brave_api_key_check_route(request):
        """Check whether a Brave Search API key is valid."""
        return await _check_credential_helper(
            request, "brave_search_api_key", check_brave_search_api_key, "Brave Search API key"
        )

    @routes.get("/model_resolver/huggingface/author-index/status")
    @json_api_endpoint("HuggingFace author index status")
    async def huggingface_author_index_status_route(request):
        """Return local HuggingFace author fallback index status."""
        return web.json_response(
            get_known_author_fallback_indexes_status()
        )

    @routes.post("/model_resolver/huggingface/author-index/refresh")
    @json_api_endpoint("HuggingFace author index refresh")
    async def huggingface_author_index_refresh_route(request):
        """Refresh HuggingFace author fallback index."""
        data = await request.json()
        hf_token = data.get("hf_token", "")
        result = await asyncio.to_thread(
            refresh_known_author_fallback_indexes, hf_token or None
        )
        clear_huggingface_search_cache()
        return web.json_response(result)

    @routes.get("/model_resolver/model-list/status")
    @json_api_endpoint("Model list status")
    async def model_list_status_route(request):
        """Return local model-list status and optionally compare with GitHub."""
        check_remote = (
            str(request.query.get("check_remote", "")).lower()
            in {"1", "true", "yes"}
        )
        return web.json_response(
            get_model_list_update_status(check_remote=check_remote)
        )

    @routes.post("/model_resolver/model-list/update")
    @json_api_endpoint("Model list update")
    async def model_list_update_route(request):
        """Download latest ComfyUI-Manager model-list.json."""
        result = await asyncio.to_thread(update_model_list_from_remote)
        clear_all_search_caches()
        self.search_result_timestamps.clear()
        return web.json_response(result)

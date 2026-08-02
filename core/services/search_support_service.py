"""Search cache, credentials, and index operations for HTTP routes."""

from ..routes.context import RouteContext


class SearchSupportService:
    """Coordinate search support operations independently of route decorators."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.require("asyncio")
        self.check_brave_search_api_key = context.require(
            "check_brave_search_api_key"
        )
        self.check_civitai_api_key = context.require("check_civitai_api_key")
        self.check_civitai_session_token = context.require(
            "check_civitai_session_token"
        )
        self.check_huggingface_token = context.require("check_huggingface_token")
        self.clear_all_search_caches = context.require("clear_all_search_caches")
        self.clear_huggingface_search_cache = context.require(
            "clear_huggingface_search_cache"
        )
        self.get_known_author_fallback_indexes_status = context.require(
            "get_known_author_fallback_indexes_status"
        )
        self.get_model_list_update_status = context.require(
            "get_model_list_update_status"
        )
        self.invalidate_local_hash_match_cache = context.require(
            "invalidate_local_hash_match_cache"
        )
        self.invalidate_model_files_cache = context.require(
            "invalidate_model_files_cache"
        )
        self.refresh_known_author_fallback_indexes = context.require(
            "refresh_known_author_fallback_indexes"
        )
        self.reload_model_list = context.require("reload_model_list")
        self.reload_popular_databases = context.require("reload_popular_databases")
        self.extension = context.require("self")
        self.update_model_list_from_remote = context.require(
            "update_model_list_from_remote"
        )
        self.web = context.require("web")

    async def clear_search_cache(self, request):
        """Clear backend search caches after token/settings changes."""
        self.clear_all_search_caches()
        self.reload_popular_databases()
        self.reload_model_list()
        self.invalidate_model_files_cache()
        self.invalidate_local_hash_match_cache()
        self.extension.search_result_timestamps.clear()
        self.extension.logger.info("Cleared backend search caches")
        return self.web.json_response({"success": True, "cleared": "all"})

    async def _check_credential_helper(
        self,
        request,
        payload_key,
        check_func,
        log_name,
    ):
        try:
            data = await request.json()
            value = data.get(payload_key, "")
            result = await self.asyncio.to_thread(check_func, value)
            return self.web.json_response(result)
        except Exception as error:
            self.extension.logger.exception(f"{log_name} check error: {error}")
            return self.web.json_response({"error": str(error)}, status=500)

    async def check_civitai_session_token_route(self, request):
        """Check whether a CivitAI browser session token is valid."""
        return await self._check_credential_helper(
            request,
            "civitai_session_token",
            self.check_civitai_session_token,
            "CivitAI session token",
        )

    async def check_civitai_api_key_route(self, request):
        """Check whether a CivitAI API key is valid."""
        return await self._check_credential_helper(
            request,
            "civitai_key",
            self.check_civitai_api_key,
            "CivitAI API key",
        )

    async def check_huggingface_token_route(self, request):
        """Check whether a HuggingFace token is valid."""
        return await self._check_credential_helper(
            request,
            "hf_token",
            self.check_huggingface_token,
            "HuggingFace token",
        )

    async def check_brave_search_api_key_route(self, request):
        """Check whether a Brave Search API key is valid."""
        return await self._check_credential_helper(
            request,
            "brave_search_api_key",
            self.check_brave_search_api_key,
            "Brave Search API key",
        )

    async def author_index_status(self, request):
        """Return local HuggingFace author fallback index status."""
        return self.web.json_response(
            self.get_known_author_fallback_indexes_status()
        )

    async def refresh_author_index(self, request):
        """Refresh HuggingFace author fallback index."""
        data = await request.json()
        hf_token = data.get("hf_token", "")
        result = await self.asyncio.to_thread(
            self.refresh_known_author_fallback_indexes,
            hf_token or None,
        )
        self.clear_huggingface_search_cache()
        return self.web.json_response(result)

    async def model_list_status(self, request):
        """Return local model-list status and optionally compare with GitHub."""
        check_remote = str(request.query.get("check_remote", "")).lower() in {
            "1",
            "true",
            "yes",
        }
        return self.web.json_response(
            self.get_model_list_update_status(check_remote=check_remote)
        )

    async def update_model_list(self, request):
        """Download latest ComfyUI-Manager model-list.json."""
        result = await self.asyncio.to_thread(self.update_model_list_from_remote)
        self.clear_all_search_caches()
        self.extension.search_result_timestamps.clear()
        return self.web.json_response(result)

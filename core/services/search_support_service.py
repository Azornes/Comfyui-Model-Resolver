"""Search cache, credentials, and index operations for HTTP routes."""

from ..request_utils import (
    read_bool_field,
    read_optional_object_payload,
    read_text_field,
)
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
        self.invalidate_model_caches = context.require("invalidate_model_caches")
        self.refresh_known_author_fallback_indexes = context.require(
            "refresh_known_author_fallback_indexes"
        )
        self.reload_model_list = context.require("reload_model_list")
        self.reload_popular_databases = context.require("reload_popular_databases")
        self.extension = context.require("self")
        self.update_model_list_from_remote = context.require(
            "update_model_list_from_remote"
        )
        self.get_popular_models_status = context.get(
            "get_popular_models_status"
        )
        self.update_popular_models_from_remote = context.get(
            "update_popular_models_from_remote"
        )
        self.web = context.require("web")

    async def clear_search_cache(self, request):
        """Clear backend search caches after token/settings changes."""
        def _clear_all():
            self.clear_all_search_caches()
            self.reload_popular_databases()
            self.reload_model_list()
            self.invalidate_model_caches()

        await self.asyncio.to_thread(_clear_all)
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
            data = await read_optional_object_payload(request)
            value = read_text_field(
                data,
                payload_key,
                contract_name=f"{log_name} request",
            )
            result = await self.asyncio.to_thread(check_func, value)
            return self.web.json_response(result)
        except TypeError as error:
            return self.web.json_response({"error": str(error)}, status=400)
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
        status = await self.asyncio.to_thread(
            self.get_known_author_fallback_indexes_status
        )
        return self.web.json_response(status)

    async def refresh_author_index(self, request):
        """Refresh HuggingFace author fallback index."""
        data = await read_optional_object_payload(request)
        try:
            hf_token = read_text_field(
                data,
                "hf_token",
                contract_name="Author index refresh request",
            )
        except TypeError as error:
            return self.web.json_response({"error": str(error)}, status=400)
        result = await self.asyncio.to_thread(
            self.refresh_known_author_fallback_indexes,
            hf_token or None,
        )
        self.clear_huggingface_search_cache()
        return self.web.json_response(result)

    async def model_list_status(self, request):
        """Return local model-list status and optionally compare with GitHub."""
        try:
            check_remote = read_bool_field(
                request.query,
                "check_remote",
                contract_name="Model list status request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        status = await self.asyncio.to_thread(
            self.get_model_list_update_status,
            check_remote=check_remote,
        )
        return self.web.json_response(status)

    async def update_model_list(self, request):
        """Download latest ComfyUI-Manager model-list.json."""
        result = await self.asyncio.to_thread(self.update_model_list_from_remote)
        self.clear_all_search_caches()
        self.extension.search_result_timestamps.clear()
        return self.web.json_response(result)


    async def popular_models_status(self, request):
        """Return local popular-models status and optionally compare with remote."""
        try:
            check_remote = read_bool_field(
                request.query,
                "check_remote",
                contract_name="Popular models status request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        if self.get_popular_models_status:
            status = await self.asyncio.to_thread(
                self.get_popular_models_status,
                check_remote=check_remote,
            )
            return self.web.json_response(status)
        return self.web.json_response({"error": "Popular models status not available"}, status=501)

    async def update_popular_models(self, request):
        """Download latest popular-models.json."""
        if not self.update_popular_models_from_remote:
            return self.web.json_response({"error": "Popular models update not available"}, status=501)
        result = await self.asyncio.to_thread(self.update_popular_models_from_remote)
        self.clear_all_search_caches()
        self.extension.search_result_timestamps.clear()
        return self.web.json_response(result)

    async def skip_search_model(self, request):
        """Skip searching for a specific model without cancelling entire workflow search."""
        data = await read_optional_object_payload(request)
        progress_id = data.get("progress_id", "")
        filename = data.get("filename", "")
        if hasattr(self.extension, "search_tracker") and progress_id:
            self.extension.search_tracker.skip_model(progress_id, filename)
            return self.web.json_response({"skipped": True, "progress_id": progress_id, "filename": filename})
        return self.web.json_response({"error": "Invalid progress_id or search_tracker unavailable"}, status=400)

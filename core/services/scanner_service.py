"""Local model scanning orchestration used by HTTP route adapters."""

from ..routes.context import RouteContext


class ScannerService:
    """Coordinate local model listing and path-template discovery."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.get("asyncio")
        self.get_model_files = context.get("get_model_files")
        self.infer_download_path_templates = context.get(
            "infer_download_path_templates"
        )
        self.invalidate_local_hash_match_cache = context.get(
            "invalidate_local_hash_match_cache"
        )
        self.to_bool = context.get("to_bool")
        self.web = context.get("web")

    async def get_models(self, request):
        """Return the locally available models, optionally forcing a rescan."""
        force_rescan = self.to_bool(
            request.query.get("force") or request.query.get("force_rescan"),
            False,
        )
        if force_rescan:
            self.invalidate_local_hash_match_cache()
        models = self.get_model_files(force_rescan=force_rescan)
        return self.web.json_response(models)

    async def get_path_template_suggestions(self, request):
        """Infer download path templates from locally available models."""
        from ..sources.popular import get_base_models_config

        force_rescan = request.query.get("force") == "1"
        models = await self.asyncio.to_thread(
            self.get_model_files,
            force_rescan,
        )
        base_models_config = get_base_models_config()
        suggestions = await self.asyncio.to_thread(
            self.infer_download_path_templates,
            models,
            base_models_config,
        )
        return self.web.json_response(suggestions)

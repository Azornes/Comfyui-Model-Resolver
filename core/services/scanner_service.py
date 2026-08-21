"""Local model scanning orchestration used by HTTP route adapters."""

from ..metadata_model_utils import normalize_models
from ..request_utils import read_first_bool_field
from ..routes.context import RouteContext


class ScannerService:
    """Coordinate local model listing and path-template discovery."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.require("asyncio")
        self.get_model_files = context.require("get_model_files")
        self.infer_download_path_templates = context.require(
            "infer_download_path_templates"
        )
        self.invalidate_local_hash_match_cache = context.require(
            "invalidate_local_hash_match_cache"
        )
        self.web = context.require("web")

    async def get_models(self, request):
        """Return the locally available models, optionally forcing a rescan."""
        try:
            force_rescan = read_first_bool_field(
                request.query,
                ("force", "force_rescan"),
                contract_name="Models request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        if force_rescan:
            self.invalidate_local_hash_match_cache()
        models = normalize_models(
            self.get_model_files(force_rescan=force_rescan)
        )
        return self.web.json_response(
            [model.to_dict() for model in models]
        )

    async def get_path_template_suggestions(self, request):
        """Infer download path templates from locally available models."""
        from ..sources.popular import get_base_models_config

        try:
            force_rescan = read_first_bool_field(
                request.query,
                ("force", "force_rescan"),
                contract_name="Path template suggestions request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        models = await self.asyncio.to_thread(
            self.get_model_files,
            force_rescan,
        )
        models = normalize_models(models)
        base_models_config = get_base_models_config()
        suggestions = await self.asyncio.to_thread(
            self.infer_download_path_templates,
            models,
            base_models_config,
        )
        return self.web.json_response(suggestions)

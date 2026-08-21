"""Model details service."""

from ..request_utils import (
    coerce_integer_identifier,
    read_identifier_field,
    read_optional_object_payload,
    read_text_field,
)
from ..routes.context import RouteContext
from .model_utils import ModelDetailsDependencies, ModelServiceDependencies


class ModelDetailsService(ModelServiceDependencies):
    """Load normalized details for supported model providers."""

    def __init__(self, context: RouteContext):
        super().__init__(ModelDetailsDependencies.from_context(context))

    async def model_details(self, request):
        """Return normalized full model details for sources that expose model pages."""
        asyncio = self.asyncio
        download_available = self.download_available
        get_civarchive_model_details = self.get_civarchive_model_details
        get_civitai_model_details = self.get_civitai_model_details
        get_huggingface_model_details = self.get_huggingface_model_details
        web = self.web
        data = await read_optional_object_payload(request)
        try:
            source = read_text_field(
                data,
                "source",
                contract_name="Model details request",
            ).lower()
            model_id = read_identifier_field(
                data,
                "model_id",
                contract_name="Model details request",
            )
            version_id = read_identifier_field(
                data,
                "version_id",
                contract_name="Model details request",
            )
            civitai_key = read_text_field(
                data,
                "civitai_key",
                contract_name="Model details request",
            )
            hf_token = read_text_field(
                data,
                "hf_token",
                contract_name="Model details request",
            )
            file_path = read_text_field(
                data,
                "file_path",
                contract_name="Model details request",
            )
            branch = read_text_field(
                data,
                "branch",
                contract_name="Model details request",
            )
        except TypeError as exc:
            return web.json_response({"error": str(exc)}, status=400)

        if not download_available:
            return web.json_response(
                {"error": "Download providers are not available"}, status=503
            )

        if source == "lora_manager_archive":
            source = "civitai"

        if source not in {"civitai", "civarchive", "huggingface"}:
            return web.json_response(
                {"error": "Unsupported model details source"}, status=400
            )

        if source == "huggingface":
            if model_id is not None and not isinstance(model_id, str):
                return web.json_response(
                    {"error": "Model details model_id must be a string for Hugging Face"},
                    status=400,
                )
            if version_id is not None and not isinstance(version_id, str):
                return web.json_response(
                    {"error": "Model details version_id must be a string for Hugging Face"},
                    status=400,
                )
            model_id = model_id.strip() if isinstance(model_id, str) else ""
            branch = branch or version_id or "main"
            version_id = branch
        else:
            try:
                model_id = coerce_integer_identifier(
                    model_id,
                    "model_id",
                    contract_name="Model details request",
                )
                version_id = coerce_integer_identifier(
                    version_id,
                    "version_id",
                    contract_name="Model details request",
                )
            except (TypeError, ValueError) as exc:
                return web.json_response({"error": str(exc)}, status=400)

        if not model_id:
            return web.json_response(
                {"error": "model_id is required"}, status=400
            )

        if source == "civitai":
            details = await asyncio.to_thread(
                get_civitai_model_details,
                model_id,
                version_id,
                civitai_key or None,
            )
        elif source == "civarchive":
            details = await asyncio.to_thread(
                get_civarchive_model_details,
                model_id,
                version_id,
            )
        else:
            details = await asyncio.to_thread(
                get_huggingface_model_details,
                model_id,
                file_path,
                branch,
                hf_token or None,
            )

        if not details:
            return web.json_response(
                {"error": "Model details not found"}, status=404
            )

        return web.json_response(details)

"""HTTP service for transferring metadata models into the active workflow."""

from ..request_utils import read_optional_object_payload, validate_workflow_payload
from ..workflow.formats import detect_workflow_format, normalize_workflow_payload
from ..workflow_transfer import transfer_models_to_workflow


class WorkflowTransferService:
    """Validate transfer requests and apply them through the shared workflow updater."""

    def __init__(self, context):
        self.asyncio = context.require("asyncio")
        self.get_workflow_model_inventory = context.require(
            "get_workflow_model_inventory"
        )
        self.web = context.require("web")

    async def transfer_models(self, request):
        """Transfer selected source models into selected target slots."""
        data = await read_optional_object_payload(request)
        workflow, workflow_error = validate_workflow_payload(
            data.get("workflow"),
            empty_is_missing=True,
        )
        if workflow_error:
            return self.web.json_response({"error": workflow_error}, status=400)

        source_models = data.get("source_models")
        target_refs = data.get("target_refs")
        if not isinstance(source_models, list):
            return self.web.json_response(
                {"error": "source_models must be an array"},
                status=400,
            )
        if not isinstance(target_refs, list):
            return self.web.json_response(
                {"error": "target_refs must be an array"},
                status=400,
            )
        if len(source_models) > 500 or len(target_refs) > 1000:
            return self.web.json_response(
                {"error": "The transfer selection is too large"},
                status=400,
            )

        mode = data.get("mode", "replace")
        if not isinstance(mode, str):
            return self.web.json_response(
                {"error": "Transfer mode must be a string"},
                status=400,
            )
        activity_scope = data.get("activity_scope", "all")
        if not isinstance(activity_scope, str):
            return self.web.json_response(
                {"error": "LoRA activity scope must be a string"},
                status=400,
            )

        if detect_workflow_format(workflow) == "api":
            try:
                workflow, _workflow_format = normalize_workflow_payload(workflow)
            except ValueError as exc:
                return self.web.json_response({"error": str(exc)}, status=400)

        try:
            inventory = await self.asyncio.to_thread(
                self.get_workflow_model_inventory,
                workflow,
            )
            result = await self.asyncio.to_thread(
                transfer_models_to_workflow,
                workflow,
                source_models,
                target_refs,
                mode=mode,
                activity_scope=activity_scope,
                inventory=inventory,
            )
        except (TypeError, ValueError) as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        return self.web.json_response(result)

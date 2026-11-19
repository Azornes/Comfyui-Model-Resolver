"""
Placement and Tidy service for detecting and relocating misplaced model files.
"""

from typing import Any, Dict

from ..model_classifier import (
    check_model_misplacement,
    classify_model_file,
    move_misplaced_model,
    scan_misplaced_models,
)
from ..request_utils import read_first_bool_field, read_optional_object_payload, read_text_field
from ..routes.context import RouteContext


class PlacementService:
    """Service handling misplaced model detection and safe relocation."""

    def __init__(self, context: RouteContext):
        self.asyncio = context.require("asyncio")
        self.web = context.require("web")

    async def check_placement(self, request) -> Any:
        """Scan local models for misplaced files."""
        try:
            force_rescan = read_first_bool_field(
                request.query,
                ("rescan", "force", "force_rescan"),
                contract_name="Placement check request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        include_works_anyway = False
        try:
            include_works_anyway = read_first_bool_field(
                request.query,
                ("include_works_anyway", "all"),
                contract_name="Placement check request",
            )
        except TypeError:
            pass

        data = await self.asyncio.to_thread(
            scan_misplaced_models,
            models=None,
            force_rescan=force_rescan,
            include_works_anyway=include_works_anyway,
        )
        return self.web.json_response(data)

    async def look_placement(self, request) -> Any:
        """Inspect a single model's header and placement status."""
        path = request.query.get("path", "").strip()
        if not path:
            return self.web.json_response({"error": "path parameter is required"}, status=400)

        from ..path_utils import is_path_in_configured_model_roots

        if not is_path_in_configured_model_roots(path):
            return self.web.json_response(
                {"error": "Model path is outside configured model roots"},
                status=403,
            )

        classification = await self.asyncio.to_thread(classify_model_file, path)
        misplacement = await self.asyncio.to_thread(check_model_misplacement, path)

        return self.web.json_response({
            "path": path,
            "classification": classification,
            "misplacement": misplacement,
        })

    async def move_model(self, request) -> Any:
        """Move a misplaced model and its sidecars safely to target category."""
        try:
            payload: Dict[str, Any] = await read_optional_object_payload(request)
            path = read_text_field(payload, "path", contract_name="Placement move path")
            target_category = read_text_field(
                payload, "target_category", contract_name="Placement move target_category"
            )
            raw_subfolder = payload.get("subfolder")
            if raw_subfolder is not None and not isinstance(raw_subfolder, str):
                raise TypeError("Placement move subfolder must be a string")
            subfolder = raw_subfolder.strip() if isinstance(raw_subfolder, str) and raw_subfolder.strip() else None
        except (TypeError, ValueError) as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        try:
            result = await self.asyncio.to_thread(
                move_misplaced_model,
                source_path=path,
                target_category=target_category,
                subfolder=subfolder,
            )
            return self.web.json_response(result)
        except FileNotFoundError as exc:
            return self.web.json_response({"error": str(exc)}, status=404)
        except (PermissionError, ValueError) as exc:
            return self.web.json_response({"error": str(exc)}, status=400)
        except OSError as exc:
            return self.web.json_response({"error": f"I/O error moving model: {exc}"}, status=500)

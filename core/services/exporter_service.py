"""Workflow export service for sharing workflows with model download links."""

import asyncio
from typing import Any

from ..exporter import (
    build_model_links_markdown,
    get_hash_job,
    is_inside_model_dirs,
    lookup_export_links,
    start_hash_job,
)
from ..request_utils import read_optional_object_payload, read_text_field
from ..routes.context import RouteContext


class ExporterService:
    """Implement workflow model export operations used by HTTP routes."""

    def __init__(self, context: RouteContext):
        self.context = context
        self.web = context.require("web")
        self.asyncio = context.get("asyncio", asyncio)

    async def export_markdown(self, request: Any):
        """Generate official-style Markdown for model links and folder locations."""
        data = await read_optional_object_payload(request)
        models = data.get("models")
        if not isinstance(models, list):
            return self.web.json_response(
                {"error": "models must be a list"},
                status=400,
            )

        markdown = build_model_links_markdown(models)
        return self.web.json_response({"success": True, "markdown": markdown})

    async def export_lookup(self, request: Any):
        """Look up public download links for a list of workflow models."""
        data = await read_optional_object_payload(request)
        models = data.get("models")
        if not isinstance(models, list):
            return self.web.json_response(
                {"error": "models must be a list"},
                status=400,
            )

        links = await self.asyncio.to_thread(lookup_export_links, models)
        return self.web.json_response({"success": True, "links": links})

    async def export_hash_start(self, request: Any):
        """Start a background hash computation job for a local model."""
        data = await read_optional_object_payload(request)
        try:
            full_path = read_text_field(
                data,
                "full_path",
                contract_name="Export hash request",
            )
        except TypeError as exc:
            return self.web.json_response({"error": str(exc)}, status=400)

        if not full_path or not is_inside_model_dirs(full_path):
            return self.web.json_response(
                {"error": "File must be located inside a ComfyUI model folder"},
                status=400,
            )

        job_id = await self.asyncio.to_thread(start_hash_job, full_path)
        return self.web.json_response({"success": True, "job_id": job_id})

    async def export_hash_status(self, request: Any):
        """Get progress and result of a background hash job."""
        job_id = request.match_info.get("job_id", "")
        job = get_hash_job(job_id)
        if not job:
            return self.web.json_response(
                {"error": f"Unknown hash job: {job_id}"},
                status=404,
            )
        return self.web.json_response(job)

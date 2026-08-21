"""Workflow analysis service."""

from ..contracts import MissingModel, Resolution, WorkflowAnalysisResult
from ..custom_nodes import get_custom_node_resolution_metadata
from ..request_utils import (
    read_bool_field,
    read_optional_object_payload,
    read_text_field,
    validate_workflow_payload,
)
from ..routes.context import RouteContext


class WorkflowService:
    """Execute workflow analysis and local-resolution operations."""

    def __init__(self, context: RouteContext):
        extension = context.require("self")
        self.analysis_progress = extension.analysis_progress
        self._update_analysis_progress = extension._update_analysis_progress
        self.logger = extension.logger
        self.analyze_and_find_matches = context.require("analyze_and_find_matches")
        self.apply_resolution = context.require("apply_resolution")
        self.asyncio = context.require("asyncio")
        self.download_available = context.require("download_available")
        self.fetch_remote_file_size_cached = context.require("fetch_remote_file_size_cached")
        self.get_filename_from_path = context.require("get_filename_from_path")
        self.get_popular_model_url = context.get("get_popular_model_url")
        self.invalidate_local_hash_match_cache = context.require("invalidate_local_hash_match_cache")
        self.search_local_matches = context.require("search_local_matches")
        self.search_model_list = context.get("search_model_list")
        self.should_skip_existing_custom_node_reference = context.require(
            "should_skip_existing_custom_node_reference"
        )
        self.web = context.require("web")

    async def analyze_workflow(self, request):
        """Analyze workflow and return missing models with matches."""
        analyze_and_find_matches = self.analyze_and_find_matches
        asyncio = self.asyncio
        download_available = self.download_available
        fetch_remote_file_size_cached = self.fetch_remote_file_size_cached
        get_filename_from_path = self.get_filename_from_path
        get_popular_model_url = self.get_popular_model_url
        invalidate_local_hash_match_cache = self.invalidate_local_hash_match_cache
        search_model_list = self.search_model_list
        should_skip_existing_custom_node_reference = self.should_skip_existing_custom_node_reference
        web = self.web
        try:
            data = await read_optional_object_payload(request)
            workflow_json, workflow_error = validate_workflow_payload(
                data.get("workflow")
            )
            try:
                analysis_id = read_text_field(
                    data,
                    "analysis_id",
                    contract_name="Workflow analysis request",
                )
                force_rescan = read_bool_field(
                    data,
                    "force_rescan",
                    contract_name="Workflow analysis request",
                )
            except TypeError as exc:
                return web.json_response({"error": str(exc)}, status=400)
            if force_rescan:
                invalidate_local_hash_match_cache()

            if workflow_error:
                return web.json_response(
                    {"error": workflow_error}, status=400
                )

            if analysis_id:
                self._update_analysis_progress(
                    analysis_id,
                    {
                        "status": "starting",
                        "stage": "starting",
                        "message": "Starting analysis...",
                        "current": 0,
                        "total": 0,
                    },
                )

            def update_analysis_progress(payload):
                self._update_analysis_progress(analysis_id, payload)

            # Analyze and find matches
            analysis_result = await asyncio.to_thread(
                analyze_and_find_matches,
                workflow_json,
                0.0,
                10,
                update_analysis_progress if analysis_id else None,
                force_rescan=force_rescan,
                analysis_id=analysis_id,
            )

            filtered_missing: list[MissingModel] = []
            for missing in analysis_result.missing_models:
                name = (
                    missing.extra_value("name")
                    or missing.reference.original_path
                )
                if should_skip_existing_custom_node_reference(missing.reference):
                    self.logger.info(
                        "Filtered existing custom-node model "
                        f"reference: {name}"
                    )
                    continue
                filtered_missing.append(missing)

            # If download available, check for download sources only from LOCAL sources
            # (workflow_url, popular, model-list.json) - skip automatic online search
            # Online search is now only triggered on-demand via search button
            if download_available:
                for index, missing in enumerate(filtered_missing):
                    # Check if there's a 100% local match
                    matches = missing.matches or ()
                    has_perfect_match = any(match.confidence == 100 for match in matches)

                    if not has_perfect_match:
                        filename = get_filename_from_path(
                            missing.reference.original_path
                        )

                        # 0. Check workflow URL first (highest priority - directly from workflow)
                        workflow_url = missing.extra_value("workflow_url", "")
                        if workflow_url:
                            # Determine source from URL
                            if "huggingface.co" in workflow_url:
                                source = "huggingface"
                            elif "civitai.com" in workflow_url:
                                source = "civitai"
                            else:
                                source = "workflow"

                            # Try to get file size using cached remote helper
                            file_size = fetch_remote_file_size_cached(workflow_url, timeout=5)

                            filtered_missing[index] = missing.with_extra(
                                download_source={
                                    "source": source,
                                    "url": workflow_url,
                                    "model_url": missing.extra_value(
                                        "workflow_model_url", workflow_url
                                    ),
                                    "filename": filename,
                                    "directory": missing.extra_value(
                                        "workflow_directory", ""
                                    )
                                    or missing.reference.category
                                    or "checkpoints",
                                    "match_type": "exact",
                                    "url_source": "workflow",
                                    "size": file_size,
                                }
                            )
                            continue

                        # 1. Check popular models (always exact match)
                        popular_info = get_popular_model_url(filename)
                        if popular_info:
                            popular_model_list_result = search_model_list(
                                filename, exact_only=True
                            )
                            filtered_missing[index] = missing.with_extra(
                                download_source={
                                    "source": "popular",
                                    "url": popular_info.url
                                    or popular_info.download_url,
                                    "filename": popular_info.filename or filename,
                                    "type": popular_info.model_type,
                                    "directory": popular_info.directory,
                                    "size": (
                                        popular_model_list_result.size
                                        if popular_model_list_result
                                        and popular_model_list_result.size
                                        is not None
                                        else None
                                    )
                                    if popular_model_list_result
                                    and popular_model_list_result.size is not None
                                    else popular_info.size,
                                    "match_type": "exact",
                                }
                            )
                            continue

                        # 2. Check model list (ComfyUI Manager database)
                        # Use exact_only=True to avoid confusing fuzzy matches for downloads
                        model_list_result = search_model_list(
                            filename, exact_only=True
                        )
                        if model_list_result:
                            filtered_missing[index] = missing.with_extra(
                                download_source={
                                    "source": "model_list",
                                    "url": model_list_result.url,
                                    "filename": model_list_result.filename,
                                    "name": model_list_result.name,
                                    "type": model_list_result.model_type,
                                    "directory": model_list_result.extra_value(
                                        "directory"
                                    ),
                                    "size": model_list_result.size,
                                    "match_type": model_list_result.match_type,
                                    "confidence": model_list_result.confidence,
                                }
                            )
                            continue

                        # NOTE: Search for online sources (HuggingFace, CivitAI) is
                        # now done on-demand via /model_resolver/search endpoint
                        # when user clicks "Search Online" button, not automatically

            result = WorkflowAnalysisResult(
                missing_models=tuple(filtered_missing),
                resolved_models=analysis_result.resolved_models,
                total_resolved=analysis_result.total_resolved,
                total_missing=len(filtered_missing),
                total_models_analyzed=analysis_result.total_models_analyzed,
            )

            if analysis_id:
                self.analysis_progress.update(
                    analysis_id,
                    status="completed",
                    stage="completed",
                    message="Analysis complete",
                    current=result.total_missing,
                    total=result.total_missing,
                )

            return web.json_response(result.to_dict())
        except Exception as e:
            if "analysis_id" in locals() and analysis_id:
                self.analysis_progress.update(
                    analysis_id,
                    status="error",
                    stage="error",
                    message=str(e),
                    current=0,
                    total=0,
                )
            self.logger.error(f"Model Resolver analyze error: {e}", exc_info=True)
            return web.json_response({"error": str(e)}, status=500)

    async def resolve_models(self, request):
        """Apply model resolution and return updated workflow."""
        apply_resolution = self.apply_resolution
        web = self.web
        data = await read_optional_object_payload(request)
        workflow_json, workflow_error = validate_workflow_payload(
            data.get("workflow"),
            empty_is_missing=True,
            require_object=False,
        )
        raw_resolutions = data.get("resolutions", [])

        if workflow_error:
            return web.json_response(
                {"error": workflow_error}, status=400
            )

        if not isinstance(raw_resolutions, list) or not raw_resolutions:
            return web.json_response(
                {"error": "Resolutions array is required"}, status=400
            )

        try:
            resolutions = []
            for raw_resolution in raw_resolutions:
                if not isinstance(raw_resolution, dict):
                    raise ValueError("Each resolution must be an object")
                resolution = Resolution.from_mapping(raw_resolution)
                resolution.validate()
                resolutions.append(
                    resolution.with_custom_node_metadata(
                        get_custom_node_resolution_metadata(resolution.reference)
                    )
                )
        except (TypeError, ValueError) as exc:
            return web.json_response(
                {"error": f"Invalid resolution: {exc}"},
                status=400,
            )

        # Apply resolutions
        updated_workflow = apply_resolution(workflow_json, resolutions)

        return web.json_response(
            {"workflow": updated_workflow, "success": True}
        )

    async def local_matches(self, request):
        """Search local model files by filename/path."""
        invalidate_local_hash_match_cache = self.invalidate_local_hash_match_cache
        search_local_matches = self.search_local_matches
        web = self.web
        data = await read_optional_object_payload(request)
        try:
            filename = read_text_field(
                data,
                "filename",
                contract_name="Local matches request",
            )
            category = read_text_field(
                data,
                "category",
                contract_name="Local matches request",
            )
            force_rescan = read_bool_field(
                data,
                "force_rescan",
                contract_name="Local matches request",
            )
        except TypeError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        if force_rescan:
            invalidate_local_hash_match_cache()

        if not filename:
            return web.json_response(
                {"error": "filename is required"}, status=400
            )

        matches = search_local_matches(
            filename,
            category=category or None,
            similarity_threshold=0.0,
            max_matches_per_model=10,
            force_rescan=force_rescan,
        )
        return web.json_response(
            {"matches": [match.to_dict() for match in matches]}
        )

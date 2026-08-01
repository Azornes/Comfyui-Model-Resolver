"""Workflow analysis route registration."""

from .context import RouteContext


def register_workflow_analysis_routes(context: RouteContext):
    analyze_and_find_matches = context.get('analyze_and_find_matches')
    apply_resolution = context.get('apply_resolution')
    asyncio = context.get('asyncio')
    download_available = context.get('download_available')
    fetch_remote_file_size_cached = context.get('fetch_remote_file_size_cached')
    get_filename_from_path = context.get('get_filename_from_path')
    get_popular_model_url = context.get('get_popular_model_url')
    get_progress_response = context.get('get_progress_response')
    invalidate_local_hash_match_cache = context.get('invalidate_local_hash_match_cache')
    json_api_endpoint = context.get('json_api_endpoint')
    routes = context.get('routes')
    search_local_matches = context.get('search_local_matches')
    search_model_list = context.get('search_model_list')
    self = context.get('self')
    should_skip_existing_custom_node_reference = context.get('should_skip_existing_custom_node_reference')
    to_bool = context.get('to_bool')
    web = context.get('web')

    @routes.post("/model_resolver/analyze")
    async def analyze_workflow(request):
        """Analyze workflow and return missing models with matches."""
        try:
            data = await request.json()
            workflow_json = data.get("workflow")
            analysis_id = str(data.get("analysis_id") or "").strip()
            force_rescan = to_bool(data.get("force_rescan"), False)
            if force_rescan:
                invalidate_local_hash_match_cache()

            if workflow_json is None:
                return web.json_response(
                    {"error": "Workflow JSON is required"}, status=400
                )
            if not isinstance(workflow_json, dict):
                return web.json_response(
                    {"error": "Workflow JSON must be an object"}, status=400
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
            result = await asyncio.to_thread(
                analyze_and_find_matches,
                workflow_json,
                0.0,
                10,
                update_analysis_progress if analysis_id else None,
                force_rescan=force_rescan,
            )

            missing_models = result.get("missing_models", [])
            filtered_missing = []
            for missing in missing_models:
                name = missing.get("name") or missing.get("original_path", "")
                if should_skip_existing_custom_node_reference(missing):
                    self.logger.info(
                        "Filtered existing custom-node model "
                        f"reference: {name}"
                    )
                    continue
                filtered_missing.append(missing)
            result["missing_models"] = filtered_missing
            result["total_missing"] = len(filtered_missing)

            # If download available, check for download sources only from LOCAL sources
            # (workflow_url, popular, model-list.json) - skip automatic online search
            # Online search is now only triggered on-demand via search button
            if download_available:
                for missing in result.get("missing_models", []):
                    # Check if there's a 100% local match
                    matches = missing.get("matches", [])
                    has_perfect_match = any(
                        m.get("confidence", 0) == 100 for m in matches
                    )

                    if not has_perfect_match:
                        filename = get_filename_from_path(
                            missing.get("original_path", "")
                        )

                        # 0. Check workflow URL first (highest priority - directly from workflow)
                        workflow_url = missing.get("workflow_url", "")
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

                            missing["download_source"] = {
                                "source": source,
                                "url": workflow_url,
                                "model_url": missing.get(
                                    "workflow_model_url", workflow_url
                                ),
                                "filename": filename,
                                "directory": missing.get(
                                    "workflow_directory", ""
                                )
                                or missing.get("category", "checkpoints"),
                                "match_type": "exact",
                                "url_source": "workflow",
                                "size": file_size,
                            }
                            continue

                        # 1. Check popular models (always exact match)
                        popular_info = get_popular_model_url(filename)
                        if popular_info:
                            popular_model_list_result = search_model_list(
                                filename, exact_only=True
                            )
                            missing["download_source"] = {
                                "source": "popular",
                                "url": popular_info.get("url"),
                                "filename": filename,
                                "type": popular_info.get("type"),
                                "directory": popular_info.get("directory"),
                                "size": (
                                    popular_model_list_result.get("size")
                                    if popular_model_list_result
                                    else None
                                )
                                or popular_info.get("size"),
                                "match_type": "exact",
                            }
                            continue

                        # 2. Check model list (ComfyUI Manager database)
                        # Use exact_only=True to avoid confusing fuzzy matches for downloads
                        model_list_result = search_model_list(
                            filename, exact_only=True
                        )
                        if model_list_result:
                            missing["download_source"] = {
                                "source": "model_list",
                                "url": model_list_result.get("url"),
                                "filename": model_list_result.get("filename"),
                                "name": model_list_result.get("name"),
                                "type": model_list_result.get("type"),
                                "directory": model_list_result.get("directory"),
                                "size": model_list_result.get("size"),
                                "match_type": model_list_result.get(
                                    "match_type"
                                ),
                                "confidence": model_list_result.get(
                                    "confidence"
                                ),
                            }
                            continue

                        # NOTE: Search for online sources (HuggingFace, CivitAI) is
                        # now done on-demand via /model_resolver/search endpoint
                        # when user clicks "Search Online" button, not automatically

            if analysis_id:
                self.analysis_progress.update(
                    analysis_id,
                    status="completed",
                    stage="completed",
                    message="Analysis complete",
                    current=result.get("total_missing", 0),
                    total=result.get("total_missing", 0),
                )

            return web.json_response(result)
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

    @routes.get("/model_resolver/analyze-progress/{analysis_id}")
    @json_api_endpoint("analyze-progress")
    async def get_analyze_progress(request):
        """Get workflow analysis progress."""
        return get_progress_response(
            self.analysis_progress,
            request,
            param_name="analysis_id",
            not_found_payload={
                "status": "unknown",
                "stage": "unknown",
                "message": "No analysis progress available",
                "current": 0,
                "total": 0,
            }
        )

    @routes.post("/model_resolver/resolve")
    @json_api_endpoint("resolve", return_success_on_error=True)
    async def resolve_models(request):
        """Apply model resolution and return updated workflow."""
        data = await request.json()
        workflow_json = data.get("workflow")
        resolutions = data.get("resolutions", [])

        if not workflow_json:
            return web.json_response(
                {"error": "Workflow JSON is required"}, status=400
            )

        if not resolutions:
            return web.json_response(
                {"error": "Resolutions array is required"}, status=400
            )

        # Apply resolutions
        updated_workflow = apply_resolution(workflow_json, resolutions)

        return web.json_response(
            {"workflow": updated_workflow, "success": True}
        )

    @routes.post("/model_resolver/local-matches")
    @json_api_endpoint("local-matches")
    async def local_matches(request):
        """Search local model files by filename/path."""
        data = await request.json()
        filename = data.get("filename", "")
        category = data.get("category", "")
        force_rescan = to_bool(data.get("force_rescan"), False)
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
        return web.json_response({"matches": matches})

"""Loaded model route registration."""

from .context import RouteContext


def register_loaded_model_routes(context: RouteContext):
    adapt_custom_node_loaded_model = context.get('adapt_custom_node_loaded_model')
    asyncio = context.get('asyncio')
    get_filename_from_path = context.get('get_filename_from_path')
    get_progress_response = context.get('get_progress_response')
    get_workflow_model_inventory = context.get('get_workflow_model_inventory')
    json_api_endpoint = context.get('json_api_endpoint')
    routes = context.get('routes')
    self = context.get('self')
    web = context.get('web')

    @routes.post("/model_resolver/loaded")
    @json_api_endpoint("get_loaded_models")
    async def get_loaded_models(request):
        """Get all currently loaded models in the workflow."""
        data = await request.json()
        workflow_json = data.get("workflow")
        loaded_id = str(
            data.get("loaded_id") or data.get("progress_id") or ""
        ).strip()

        if not workflow_json:
            return web.json_response(
                {"error": "Workflow JSON is required"}, status=400
            )
        if not isinstance(workflow_json, dict):
            return web.json_response(
                {"error": "Workflow JSON must be an object"}, status=400
            )

        def update_loaded_progress(*args, **kwargs):
            self._update_loaded_progress(loaded_id, *args, **kwargs)

        def get_workflow_node_count():
            node_count = 0
            nodes = workflow_json.get("nodes", [])
            if isinstance(nodes, list):
                node_count += len(nodes)

            definitions = workflow_json.get("definitions", {})
            subgraphs = (
                definitions.get("subgraphs", [])
                if isinstance(definitions, dict)
                else []
            )
            if isinstance(subgraphs, list):
                for subgraph in subgraphs:
                    if not isinstance(subgraph, dict):
                        continue
                    subgraph_nodes = subgraph.get("nodes", [])
                    if isinstance(subgraph_nodes, list):
                        node_count += len(subgraph_nodes)
            return node_count

        def interpolate_percent(start, end, current, total):
            if not total:
                return start
            try:
                ratio = max(0.0, min(1.0, float(current) / float(total)))
            except (TypeError, ValueError, ZeroDivisionError):
                ratio = 0.0
            return start + ((end - start) * ratio)

        def build_loaded_models_response():
            from ..workflow_analyzer import (
                URN_TYPE_MAP,
                get_lora_model_strength,
            )

            update_loaded_progress(
                "scanning",
                "Scanning local model index...",
                percent=5,
            )

            workflow_node_count = get_workflow_node_count()

            def update_workflow_analysis_progress(payload):
                self._update_workflow_analysis_progress(
                    loaded_id,
                    workflow_node_count,
                    interpolate_percent,
                    payload,
                    start_percent=5,
                    end_percent=45,
                )

            inventory = get_workflow_model_inventory(
                workflow_json,
                progress_callback=update_workflow_analysis_progress,
            )
            available_models = inventory["available_models"]
            all_model_refs = inventory["model_refs"]

            # Create lookup for full paths by filename (with and without extension)
            path_by_filename = {}
            total_local_models = len(available_models)
            update_loaded_progress(
                "indexing",
                f"Indexing {total_local_models} local models...",
                percent=45,
                current=0,
                total=total_local_models,
            )
            for index, model_info in enumerate(available_models, start=1):
                rel_path = model_info.get("relative_path", "")
                if rel_path:
                    filename = get_filename_from_path(rel_path)
                    path_by_filename[filename] = model_info.get("path")
                    # Also add without extension for matching (simple approach)
                    if "." in filename:
                        filename_no_ext = filename.rsplit(".", 1)[0]
                        if filename_no_ext not in path_by_filename:
                            path_by_filename[filename_no_ext] = model_info.get("path")
                    # Add the full relative path as key too
                    path_by_filename[rel_path] = model_info.get("path")

                if (
                    total_local_models
                    and (index == total_local_models or index % 250 == 0)
                ):
                    update_loaded_progress(
                        "indexing",
                        f"Indexing local model {index} of {total_local_models}",
                        percent=interpolate_percent(
                            45, 55, index, total_local_models
                        ),
                        current=index,
                        total=total_local_models,
                    )

            # Also use folder_paths.get_full_path() to get paths
            try:
                import folder_paths
            except Exception:
                folder_paths = None

            folder_categories = [
                "loras",
                "checkpoints",
                "vae",
                "controlnet",
                "upscale_models",
            ]
            if folder_paths:
                for index, category_name in enumerate(folder_categories, start=1):
                    update_loaded_progress(
                        "indexing",
                        f"Reading {category_name} model list...",
                        percent=interpolate_percent(
                            55, 65, index - 1, len(folder_categories)
                        ),
                        current=index - 1,
                        total=len(folder_categories),
                    )
                    try:
                        filenames = folder_paths.get_filename_list(category_name)
                        for filename in filenames:
                            full_path = folder_paths.get_full_path(
                                category_name, filename
                            )
                            if (
                                full_path
                                and full_path not in path_by_filename.values()
                            ):
                                path_by_filename[filename] = full_path
                                filename_no_ext = (
                                    filename.rsplit(".", 1)[0]
                                    if "." in filename
                                    else filename
                                )
                                if filename_no_ext not in path_by_filename:
                                    path_by_filename[filename_no_ext] = full_path
                    except Exception:
                        pass

            # Also extract from node.properties.models
            workflow_nodes = workflow_json.get("nodes", [])
            nodes = list(workflow_nodes) if isinstance(workflow_nodes, list) else []
            node_scopes = {
                id(node): {
                    "subgraph_id": "",
                    "subgraph_name": "",
                    "is_top_level": True,
                }
                for node in nodes
                if isinstance(node, dict)
            }
            definitions = workflow_json.get("definitions", {})
            subgraphs = (
                definitions.get("subgraphs", [])
                if isinstance(definitions, dict)
                else []
            )
            for subgraph in subgraphs:
                if isinstance(subgraph, dict):
                    subgraph_nodes = subgraph.get("nodes", [])
                    if isinstance(subgraph_nodes, list):
                        nodes.extend(subgraph_nodes)
                        for node in subgraph_nodes:
                            if not isinstance(node, dict):
                                continue
                            node_scopes[id(node)] = {
                                "subgraph_id": subgraph.get("id") or "",
                                "subgraph_name": (
                                    subgraph.get("name")
                                    or subgraph.get("id")
                                    or ""
                                ),
                                "is_top_level": False,
                            }

            def get_node_scope(node):
                return node_scopes.get(
                    id(node),
                    {
                        "subgraph_id": "",
                        "subgraph_name": "",
                        "is_top_level": True,
                    },
                )

            def node_matches_ref(node, ref):
                if not isinstance(node, dict):
                    return False
                if str(node.get("id")) != str(ref.get("node_id")):
                    return False
                scope = get_node_scope(node)
                if scope["is_top_level"] != (
                    ref.get("is_top_level") is not False
                ):
                    return False
                if not scope["is_top_level"]:
                    return str(scope["subgraph_id"]) == str(
                        ref.get("subgraph_id") or ""
                    )
                return True

            # Collect all loaded models with their values
            loaded_models = []
            total_refs = len(all_model_refs)
            update_loaded_progress(
                "building",
                "Building loaded models list...",
                percent=65,
                current=0,
                total=total_refs,
            )

            # Process each model reference from analyze_workflow_models
            for index, ref in enumerate(all_model_refs, start=1):
                if total_refs and (index == total_refs or index % 50 == 0):
                    update_loaded_progress(
                        "building",
                        f"Building loaded model {index} of {total_refs}",
                        percent=interpolate_percent(65, 94, index, total_refs),
                        current=index,
                        total=total_refs,
                    )

                original_path = ref.get("original_path", "")
                node_id = ref.get("node_id")
                widget_index = ref.get("widget_index")
                node_type = ref.get("node_type", "")
                category = ref.get("category", "unknown")

                # Determine model name and strength
                model_name = get_filename_from_path(original_path)
                strength = None

                if (
                    ref.get("strength") is None
                    and category in {"lora", "loras"}
                ):
                    for node in nodes:
                        if node_matches_ref(node, ref):
                            strength = get_lora_model_strength(
                                node,
                                widget_index,
                            )
                            break

                if ref.get("strength") is not None:
                    strength = ref.get("strength")

                model_name, strength = adapt_custom_node_loaded_model(
                    ref,
                    model_name,
                    strength,
                )

                # Check if model exists locally
                exists = ref.get("exists", False)

                # If URN, resolve to display name
                if ref.get("is_urn"):
                    urn = ref.get("urn", {})
                    # Use model name from URN as display name
                    model_name = (
                        f"urn:{urn.get('type', 'model')}:{urn.get('model_id')}"
                    )
                    category = urn.get("type", category)
                    if category in URN_TYPE_MAP:
                        category = URN_TYPE_MAP[category]

                loaded_models.append(
                    {
                        "name": model_name,
                        "category": category,
                        "node_id": node_id,
                        "widget_index": widget_index,
                        "node_type": node_type,
                        "node_title": ref.get("node_title", ""),
                        "subgraph_id": ref.get("subgraph_id") or "",
                        "subgraph_name": ref.get("subgraph_name") or "",
                        "is_top_level": ref.get("is_top_level") is not False,
                        "locate_node_id": ref.get("locate_node_id"),
                        "locate_node_type": ref.get("locate_node_type", ""),
                        "locate_node_title": ref.get("locate_node_title", ""),
                        "locate_subgraph_id": (
                            ref.get("locate_subgraph_id") or ""
                        ),
                        "locate_subgraph_name": (
                            ref.get("locate_subgraph_name") or ""
                        ),
                        "locate_is_top_level": (
                            ref.get("locate_is_top_level") is not False
                        ),
                        "locate_via_promoted_widget": ref.get(
                            "locate_via_promoted_widget", False
                        ),
                        "exists": exists,
                        "strength": strength,
                        "original_path": original_path,
                        "is_urn": ref.get("is_urn", False),
                        "custom_node_adapter": ref.get(
                            "custom_node_adapter"
                        ),
                        "active": ref.get("active"),
                        "connected": ref.get("connected", True),
                        "resolved_path": (
                            path_by_filename.get(model_name)
                            or path_by_filename.get(original_path)
                        ),
                    }
                )

            # Also check node.properties.models for embedded models
            total_nodes = len(nodes)
            for node_index, node in enumerate(nodes, start=1):
                if total_nodes and (
                    node_index == total_nodes or node_index % 50 == 0
                ):
                    update_loaded_progress(
                        "embedded",
                        "Checking embedded model metadata...",
                        percent=interpolate_percent(
                            94, 98, node_index, total_nodes
                        ),
                        current=node_index,
                        total=total_nodes,
                    )

                node_type = node.get("type", "")
                properties = node.get("properties", {})
                if not isinstance(properties, dict):
                    properties = {}
                models_list = properties.get("models", [])
                if not isinstance(models_list, list):
                    models_list = []

                for model_info in models_list:
                    if isinstance(model_info, dict):
                        name = model_info.get("name", "")
                        directory = model_info.get("directory", "")
                        node_scope = get_node_scope(node)

                        if name:
                            # Check if this model is already in loaded_models
                            existing = next(
                                (
                                    model
                                    for model in loaded_models
                                    if model.get("original_path") == name
                                ),
                                None,
                            )
                            if not existing:
                                loaded_models.append(
                                    {
                                        "name": get_filename_from_path(name),
                                        "category": directory or "checkpoints",
                                        "node_id": node.get("id"),
                                        "widget_index": None,
                                        "node_type": node_type,
                                        "node_title": node.get("title", ""),
                                        "subgraph_id": node_scope["subgraph_id"],
                                        "subgraph_name": node_scope[
                                            "subgraph_name"
                                        ],
                                        "is_top_level": node_scope[
                                            "is_top_level"
                                        ],
                                        "exists": True,  # Embedded models are loaded
                                        "strength": None,
                                        "original_path": name,
                                        "is_urn": False,
                                    }
                                )

            update_loaded_progress(
                "finalizing",
                "Loaded models ready",
                percent=99,
                current=len(loaded_models),
                total=len(loaded_models),
            )
            return {
                "loaded_models": loaded_models,
                "total": len(loaded_models),
            }

        update_loaded_progress(
            "starting",
            "Preparing loaded model scan...",
            percent=0,
            status="starting",
            current=0,
            total=0,
        )

        try:
            result = await asyncio.to_thread(build_loaded_models_response)
        except Exception as e:
            update_loaded_progress(
                "error",
                str(e),
                percent=100,
                status="error",
                current=0,
                total=0,
            )
            self.logger.error(
                f"Model Resolver loaded models error: {e}", exc_info=True
            )
            return web.json_response({"error": str(e)}, status=500)

        update_loaded_progress(
            "completed",
            "Loaded models ready",
            percent=100,
            status="completed",
            current=result.get("total", 0),
            total=result.get("total", 0),
        )
        return web.json_response(result)

    @routes.get("/model_resolver/loaded-progress/{loaded_id}")
    @json_api_endpoint("loaded-progress")
    async def get_loaded_models_progress(request):
        """Get loaded models inspection progress."""
        return get_progress_response(
            self.loaded_progress,
            request,
            param_name="loaded_id",
            not_found_payload={
                "status": "unknown",
                "stage": "unknown",
                "message": "No loaded models progress available",
                "percent": 0,
                "current": 0,
                "total": 0,
            }
        )

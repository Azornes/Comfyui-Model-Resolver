"""Workflow missing-model grouping compatibility module."""

from typing import Any, Dict, List


def identify_missing_models(
    workflow_models: List[Dict[str, Any]], available_models: List[Dict[str, str]] = None
) -> List[Dict[str, Any]]:
    """
    Identify which models from the workflow are missing.
    Deduplicates by category and filename - same model file only appears once even if
    referenced by multiple nodes.

    Args:
        workflow_models: List of model references from analyze_workflow_models
        available_models: Optional list of available models (if None, checks via folder_paths)

    Returns:
        List of missing model references (deduplicated by category and filename).
        Each entry has 'all_node_refs' containing all node references for that model.
    """
    # Group missing models by category and filename to deduplicate workflow
    # references without merging unrelated model folders that happen to share a name.
    missing_by_model: Dict[tuple[str, str], Dict[str, Any]] = {}

    for model_ref in workflow_models:
        # If exists is False, it's missing
        if not model_ref.get("exists", False):
            filename = model_ref.get("original_path", "")
            category = model_ref.get("category", "")
            group_key = (str(category or ""), str(filename or ""))

            if group_key not in missing_by_model:
                # First occurrence - use this as the primary entry
                missing_by_model[group_key] = {
                    **model_ref,
                    "reference_count": 1,
                    "all_node_refs": [
                        model_ref.copy()
                    ],  # Track all nodes needing this model
                }
            else:
                # Duplicate - just add to the node refs list
                existing = missing_by_model[group_key]
                existing["all_node_refs"].append(model_ref.copy())
                existing["reference_count"] = len(existing["all_node_refs"])
                if model_ref.get("auto_download_capable"):
                    existing["auto_download_capable"] = True
                if model_ref.get("auto_download_candidate"):
                    existing["auto_download_candidate"] = True
                if model_ref.get("input_choice_matches_value"):
                    existing["input_choice_matches_value"] = True
                existing_source = str(existing.get("input_choice_source") or "").lower()
                model_source = str(model_ref.get("input_choice_source") or "").lower()
                if existing_source != "hybrid" and model_source in {
                    "static",
                    "hybrid",
                    "workflow_schema",
                }:
                    existing["input_choice_source"] = model_source

    # Return deduplicated list
    return list(missing_by_model.values())

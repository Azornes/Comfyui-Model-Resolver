from types import SimpleNamespace
from unittest.mock import patch

from core.workflow import analysis, references, subgraphs
from core.workflow_updater import update_workflow_nodes


def _loader_node(node_id=10, value="model.safetensors", link=None):
    return {
        "id": node_id,
        "type": "CheckpointLoaderSimple",
        "title": "Loader",
        "widgets_values": [value],
        "inputs": [
            {
                "name": "ckpt_name",
                "widget": {"name": "ckpt_name"},
                "link": link,
            }
        ],
        "outputs": [],
    }


def test_subgraph_widget_indexes_support_named_inputs_and_links():
    node = {
        **_loader_node(),
        "inputs": [
            {"name": "model", "widget": None, "link": 1},
            {"name": "ckpt_name", "widget": {"name": "ckpt_name"}},
        ],
        "widgets_values": ["model.safetensors"],
    }

    assert subgraphs._get_widget_index_for_input_index(node, 0) is None
    assert subgraphs._get_widget_index_for_input_index(node, 1) == 0
    assert subgraphs._get_widget_index_by_name(node, "ckpt-name") == 0
    assert subgraphs._get_node_by_id([node], "10") is node

    subgraph = {
        "inputs": [{"name": "ckpt_name", "linkIds": [7, "8"]}],
    }
    assert subgraphs._get_subgraph_input_link_ids(subgraph, "ckpt-name") == {
        "7",
        "8",
    }
    assert subgraphs._get_subgraph_input_link_ids(subgraph, "missing") == set()


def test_find_promoted_targets_prefers_explicit_node_then_linked_input():
    explicit_node = _loader_node(node_id=10)
    linked_node = _loader_node(node_id=11, link=7)
    subgraph = {
        "inputs": [{"name": "ckpt_name", "linkIds": [7]}],
        "nodes": [explicit_node, linked_node],
    }

    with patch.object(
        subgraphs.references,
        "get_effective_model_category_hint",
        return_value="checkpoints",
    ):
        explicit = subgraphs._find_promoted_widget_targets(
            subgraph, "10", "ckpt_name"
        )
        linked = subgraphs._find_promoted_widget_targets(
            subgraph, "-1", "ckpt_name"
        )

    assert [(item["node_id"], item["widget_index"]) for item in explicit] == [(10, 0)]
    assert [(item["node_id"], item["widget_index"]) for item in linked] == [(11, 0)]
    assert linked[0]["category"] == "checkpoints"


def test_build_promoted_contexts_records_instance_and_inner_locators():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "subgraph-1",
                "widgets_values": ["promoted.safetensors"],
                "properties": {"proxyWidgets": [["10", "ckpt_name"]]},
            }
        ]
    }
    subgraph = {
        "id": "subgraph-1",
        "name": "Promoted loader",
        "nodes": [_loader_node()],
    }

    with patch.object(
        subgraphs.references,
        "get_effective_model_category_hint",
        return_value="checkpoints",
    ):
        contexts = subgraphs._build_promoted_widget_contexts(workflow, [subgraph])

    instance = contexts["instance_widgets"][("1", 0)]
    assert instance["subgraph_name"] == "Promoted loader"
    assert instance["promoted_value"] == "promoted.safetensors"
    assert contexts["inner_widgets"][("subgraph-1", "10", 0)][0]["node_id"] == 1
    assert contexts["inner_widget_names"][("subgraph-1", "10", "ckpt_name")]


def test_apply_instance_promoted_context_resolves_existing_model(tmp_path):
    model_path = tmp_path / "promoted.safetensors"
    model_path.write_bytes(b"model")
    available_models = [
        {
            "category": "checkpoints",
            "relative_path": "promoted.safetensors",
            "path": str(model_path),
        }
    ]
    reference = {"original_path": "promoted.safetensors", "exists": False}
    context = {
        "proxy_widget_name": "ckpt_name",
        "node_id": 10,
        "node_type": "CheckpointLoaderSimple",
        "node_title": "Loader",
        "widget_index": 0,
        "widget_name": "ckpt_name",
        "category": "checkpoints",
    }

    subgraphs._apply_instance_promoted_widget_context(
        reference,
        context,
        available_models,
    )

    assert reference["promoted_inner_node_id"] == 10
    assert reference["category"] == "checkpoints"
    assert reference["full_path"] == str(model_path)
    assert reference["exists"] is True


def test_apply_promoted_locator_supports_name_fallback_and_value_selection():
    contexts = {
        "inner_widgets": {},
        "inner_widget_names": {
            ("subgraph-1", "10", "ckpt_name"): [
                {"node_id": 1, "node_type": "Subgraph", "subgraph_name": "One", "promoted_value": "first"},
                {"node_id": 2, "node_type": "Subgraph", "subgraph_name": "Two", "promoted_value": "second"},
            ]
        },
    }
    reference = {
        "subgraph_id": "subgraph-1",
        "node_id": 10,
        "widget_index": 99,
        "widget_name": "ckpt_name",
        "original_path": "second",
    }

    subgraphs._apply_promoted_widget_locator(reference, contexts)

    assert reference["locate_node_id"] == 2
    assert reference["locate_subgraph_name"] == "Two"
    assert reference["locate_is_top_level"] is True
    assert reference["locate_via_promoted_widget"] is True


def test_subgraph_input_reference_targets_instance_for_update_and_location():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "subgraph-1",
                "title": "Model subgraph",
                "inputs": [
                    {
                        "name": "ckpt_name",
                        "type": "COMBO",
                        "widget": {"name": "ckpt_name"},
                        "link": None,
                    }
                ],
                "outputs": [{"links": [20]}],
                "properties": {"proxyWidgets": [["10", "ckpt_name"]]},
                # Some serialized subgraph instances have no values here;
                # the connected inner widget still contains the old value.
                "widgets_values": [],
            }
        ],
        "definitions": {
            "subgraphs": [
                {
                    "id": "subgraph-1",
                    "name": "Model subgraph",
                    "inputs": [
                        {"name": "ckpt_name", "type": "COMBO", "linkIds": [7]}
                    ],
                    "nodes": [
                        {
                            "id": 10,
                            "type": "CheckpointLoaderSimple",
                            "inputs": [
                                {
                                    "name": "ckpt_name",
                                    "type": "COMBO",
                                    "widget": {"name": "ckpt_name"},
                                    "link": 7,
                                }
                            ],
                            "outputs": [{"type": "MODEL", "links": [20]}],
                            "widgets_values": ["inner-stale.safetensors"],
                        }
                    ],
                }
            ]
        },
    }

    refs = analysis.analyze_workflow_models(workflow, available_models=[])

    assert len(refs) == 1
    assert refs[0]["node_id"] == 1
    assert refs[0]["widget_index"] == 0
    assert refs[0]["subgraph_id"] == "subgraph-1"
    assert refs[0]["is_top_level"] is True
    assert refs[0]["subgraph_path"] is None
    assert refs[0]["locate_node_id"] == 1
    assert refs[0]["locate_subgraph_id"] == ""
    assert refs[0]["promoted_inner_node_id"] == 10

    no_proxy_workflow = {
        **workflow,
        "nodes": [
            {
                **workflow["nodes"][0],
                "properties": {},
            }
        ],
    }
    no_proxy_refs = analysis.analyze_workflow_models(
        no_proxy_workflow, available_models=[]
    )
    assert no_proxy_refs[0]["node_id"] == 1
    assert no_proxy_refs[0]["promoted_inner_node_id"] == 10

    update_workflow_nodes(
        workflow,
        [
            {
                "node_id": refs[0]["node_id"],
                "widget_index": refs[0]["widget_index"],
                "resolved_path": "replacement.safetensors",
                "category": "checkpoints",
                "subgraph_id": refs[0]["subgraph_id"],
                "is_top_level": refs[0]["is_top_level"],
                "promoted_widget_name": refs[0]["promoted_widget_name"],
            }
        ],
    )

    assert workflow["nodes"][0]["widgets_values"] == ["replacement.safetensors"]
    assert workflow["definitions"]["subgraphs"][0]["nodes"][0]["widgets_values"] == [
        "inner-stale.safetensors"
    ]


def test_reused_subgraph_instance_refreshes_promoted_model_context():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "subgraph-1",
                "inputs": [
                    {
                        "name": "ckpt_name",
                        "type": "COMBO",
                        "widget": {"name": "ckpt_name"},
                        "link": None,
                    }
                ],
                "properties": {"proxyWidgets": [["10", "ckpt_name"]]},
                "widgets_values": ["old.safetensors"],
            }
        ],
        "definitions": {
            "subgraphs": [
                {
                    "id": "subgraph-1",
                    "name": "Promoted loader",
                    "nodes": [_loader_node(value="old.safetensors")],
                }
            ]
        },
    }
    previous_node_cache = {}
    analysis.analyze_workflow_models(
        workflow,
        available_models=[],
        node_cache_out=previous_node_cache,
    )

    updated_workflow = {
        **workflow,
        "nodes": [
            {
                **workflow["nodes"][0],
                "widgets_values": ["new.safetensors"],
            }
        ],
    }
    # Simulate a serialized proxy widget change whose node cache entry was
    # retained while the promoted context changed.
    previous_node_cache[("top", "", "1")]["fingerprint"] = (
        analysis._get_workflow_node_fingerprint(updated_workflow["nodes"][0])
    )

    refs = analysis.analyze_workflow_models(
        updated_workflow,
        available_models=[],
        previous_node_cache=previous_node_cache,
    )

    assert len(refs) == 1
    assert refs[0]["node_id"] == 1
    assert refs[0]["original_path"] == "new.safetensors"
    assert refs[0]["promoted_inner_node_id"] == 10


def test_reference_matching_handles_placeholders_paths_and_scanner_records(tmp_path):
    model_path = tmp_path / "folder" / "model.safetensors"
    model_path.parent.mkdir()
    model_path.write_bytes(b"model")
    available_models = [
        {
            "category": "checkpoints",
            "relative_path": "folder/model.safetensors",
            "path": str(model_path),
        }
    ]

    assert references.is_model_filename("model.safetensors") is True
    assert references.is_model_filename("urn:air:sd:checkpoint:civitai:1@2") is True
    assert references.should_scan_as_model_reference("None", True) is False
    assert references.should_scan_as_model_reference("plain-name", True) is True
    assert references.should_scan_as_model_reference("plain-name", False) is False
    assert references.is_static_or_hybrid_widget_choice(
        "Folder\\Model.safetensors",
        {"source": "static", "choices": ["folder/model.safetensors"]},
    )
    assert references.static_or_hybrid_choice_looks_like_model(
        "folder/model.safetensors",
        {"source": "hybrid", "choices": []},
    )

    resolved = references.try_resolve_model_path(
        "folder/model.safetensors",
        ["checkpoints", "configs"],
        available_models=available_models,
    )
    assert resolved == ("checkpoints", str(model_path))
    assert references.try_resolve_model_path(
        "folder/MODEL.safetensors",
        ["checkpoints"],
        available_models=available_models,
    ) is None


def test_reference_resolution_uses_folder_paths_when_scanner_is_not_available(tmp_path):
    model_path = tmp_path / "model.safetensors"
    model_path.write_bytes(b"model")
    fake_folder_paths = SimpleNamespace(
        folder_names_and_paths={"checkpoints": ([], set()), "configs": ([], set())},
        get_filename_list=lambda category: ["model.safetensors"],
        get_full_path=lambda category, filename: str(model_path),
    )

    with patch.object(references, "folder_paths", fake_folder_paths):
        assert references.try_resolve_model_path("model.safetensors") == (
            "checkpoints",
            str(model_path),
        )

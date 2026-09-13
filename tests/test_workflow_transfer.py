from copy import deepcopy
from types import SimpleNamespace

import pytest

from core.contracts import ModelReference
from core.workflow_transfer import (
    normalize_transfer_category,
    transfer_models_to_workflow,
)


def _reference(
    node_id,
    original_path,
    *,
    category,
    node_type="",
    widget_index=0,
    is_top_level=None,
    subgraph_id=None,
    **extra,
):
    payload = {
        "node_id": node_id,
        "node_type": node_type,
        "widget_index": widget_index,
        "original_path": original_path,
        "category": category,
        "exists": False,
    }
    if is_top_level is not None:
        payload["is_top_level"] = is_top_level
    if subgraph_id is not None:
        payload["subgraph_id"] = subgraph_id
    payload.update(extra)
    return ModelReference.from_mapping(payload)


def _inventory(*references):
    return SimpleNamespace(model_refs=tuple(references))


def _selector(reference):
    return reference.to_dict()


def test_normalize_transfer_category_covers_workflow_aliases():
    assert normalize_transfer_category("UPSCALE-MODEL") == "upscale_models"
    assert normalize_transfer_category("checkpoint") == "checkpoints"
    assert normalize_transfer_category("unknown") == ""


def test_replace_fans_one_source_to_selected_slots_and_syncs_named_values():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["old-a.safetensors"],
                "widgets_values_named": {"ckpt_name": "old-a.safetensors"},
            },
            {
                "id": 2,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["old-b.safetensors"],
                "widgets_values_named": {"ckpt_name": "old-b.safetensors"},
            },
        ]
    }
    refs = (
        _reference(
            1,
            "old-a.safetensors",
            category="checkpoints",
            node_type="CheckpointLoaderSimple",
            widget_name="ckpt_name",
        ),
        _reference(
            2,
            "old-b.safetensors",
            category="checkpoints",
            node_type="CheckpointLoaderSimple",
            widget_name="ckpt_name",
        ),
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "new.safetensors", "category": "checkpoint"}],
        [_selector(ref) for ref in refs],
        inventory=_inventory(*refs),
    )

    assert result["updated"] == 2
    assert result["requires_full_reload"] is False
    assert [node["widgets_values"][0] for node in workflow["nodes"]] == [
        "new.safetensors",
        "new.safetensors",
    ]
    assert [
        node["widgets_values_named"]["ckpt_name"] for node in workflow["nodes"]
    ] == ["new.safetensors", "new.safetensors"]


def test_replace_zips_multiple_sources_and_copies_lora_strength():
    workflow = {
        "nodes": [
            {
                "id": 10,
                "type": "LoraLoader",
                "widgets_values": ["old-a.safetensors", 1.0],
                "widgets": [{"name": "lora_name"}, {"name": "strength_model"}],
            },
            {
                "id": 11,
                "type": "LoraLoader",
                "widgets_values": ["old-b.safetensors", 1.0],
                "widgets": [{"name": "lora_name"}, {"name": "strength_model"}],
            },
        ]
    }
    refs = (
        _reference(
            10,
            "old-a.safetensors",
            category="loras",
            node_type="LoraLoader",
            widget_name="lora_name",
        ),
        _reference(
            11,
            "old-b.safetensors",
            category="loras",
            node_type="LoraLoader",
            widget_name="lora_name",
        ),
    )

    result = transfer_models_to_workflow(
        workflow,
        [
            {"original_path": "new-a.safetensors", "category": "loras", "strength": 0.4},
            {"original_path": "new-b.safetensors", "category": "loras", "strength": 0.8},
        ],
        [_selector(ref) for ref in refs],
        inventory=_inventory(*refs),
    )

    assert result["updated"] == 2
    assert result["requires_full_reload"] is True
    assert workflow["nodes"][0]["widgets_values"] == ["new-a.safetensors", 0.4]
    assert workflow["nodes"][1]["widgets_values"] == ["new-b.safetensors", 0.8]


def test_replace_updates_inner_subgraph_node_and_requests_full_reload():
    workflow = {
        "nodes": [],
        "definitions": {
            "subgraphs": [
                {
                    "id": "group-1",
                    "nodes": [
                        {
                            "id": 7,
                            "type": "UpscaleModelLoader",
                            "widgets_values": ["old-upscale.pth"],
                        }
                    ],
                }
            ]
        },
    }
    ref = _reference(
        7,
        "old-upscale.pth",
        category="upscale_models",
        node_type="UpscaleModelLoader",
        is_top_level=False,
        subgraph_id="group-1",
        widget_name="model_name",
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "new-upscale.pth", "category": "upscaler"}],
        [_selector(ref)],
        inventory=_inventory(ref),
    )

    assert result["updated"] == 1
    assert result["requires_full_reload"] is True
    assert (
        workflow["definitions"]["subgraphs"][0]["nodes"][0]["widgets_values"][0]
        == "new-upscale.pth"
    )


def test_replace_updates_lora_manager_entry_and_strength():
    workflow = {
        "nodes": [
            {
                "id": 20,
                "type": "Lora Loader (LoraManager)",
                "widgets_values": [
                    None,
                    "old prompt <lora:old_style:0.7>",
                    [{"name": "old_style", "strength": 0.7, "active": True}],
                ],
                "widgets_values_named": {
                    "text": "old prompt <lora:old_style:0.7>",
                    "loras": [
                        {"name": "old_style", "strength": 0.7, "active": True}
                    ],
                },
            }
        ]
    }
    ref = _reference(
        20,
        "old_style",
        category="loras",
        node_type="Lora Loader (LoraManager)",
        widget_index=2,
        custom_node_adapter="lora-manager",
        name="old_style",
        strength=0.7,
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "new_style.safetensors", "category": "loras", "strength": 0.45}],
        [_selector(ref)],
        inventory=_inventory(ref),
    )

    entry = workflow["nodes"][0]["widgets_values"][2][0]
    assert result["updated"] == 1
    assert entry["name"] == "new_style"
    assert entry["strength"] == 0.45
    assert "<lora:old_style:" not in workflow["nodes"][0]["widgets_values"][1]
    assert "<lora:new_style:0.45>" in workflow["nodes"][0]["widgets_values"][1]
    assert workflow["nodes"][0]["widgets_values_named"]["loras"] == [entry]
    assert workflow["nodes"][0]["widgets_values_named"]["text"] == workflow["nodes"][0]["widgets_values"][1]


def test_merge_appends_lora_manager_entry_without_removing_existing_values():
    workflow = {
        "nodes": [
            {
                "id": 21,
                "type": "LoraLoaderV2",
                "widgets_values": [
                    None,
                    "existing prompt",
                    [{"name": "existing", "strength": 1.0, "active": True}],
                ],
            }
        ]
    }
    ref = _reference(
        21,
        "existing",
        category="loras",
        node_type="LoraLoaderV2",
        widget_index=2,
        custom_node_adapter="lora-manager",
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "added.safetensors", "category": "loras", "strength": 0.6}],
        [_selector(ref)],
        mode="merge",
        inventory=_inventory(ref),
    )

    loras = workflow["nodes"][0]["widgets_values"][2]
    assert result["updated"] == 1
    assert result["requires_full_reload"] is True
    assert [item["name"] for item in loras] == ["existing", "added"]
    assert loras[0]["strength"] == 1.0
    assert loras[1]["active"] is True
    assert "<lora:added:0.6>" in workflow["nodes"][0]["widgets_values"][1]


def test_merge_appends_power_lora_slot_without_removing_existing_values():
    workflow = {
        "nodes": [
            {
                "id": 22,
                "type": "Power Lora Loader (rgthree)",
                "widgets_values": [
                    {},
                    {"type": "PowerLoraLoaderHeaderWidget"},
                    {"on": True, "lora": "existing.safetensors", "strength": 1.0},
                    {},
                    "",
                ],
                "widgets_values_named": {
                    "divider": {},
                    "PowerLoraLoaderHeaderWidget": {
                        "type": "PowerLoraLoaderHeaderWidget"
                    },
                    "lora_1": {
                        "on": True,
                        "lora": "existing.safetensors",
                        "strength": 1.0,
                    },
                    "➕ Add Lora": "",
                },
            }
        ]
    }
    ref = _reference(
        22,
        "existing.safetensors",
        category="loras",
        node_type="Power Lora Loader (rgthree)",
        custom_node_adapter="rgthree-power-lora-loader",
        nested_key="lora",
        strength=1.0,
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "added.safetensors", "category": "loras"}],
        [_selector(ref)],
        mode="add",
        inventory=_inventory(ref),
    )

    values = workflow["nodes"][0]["widgets_values"]
    named_values = workflow["nodes"][0]["widgets_values_named"]
    assert result["updated"] == 1
    assert [item["lora"] for item in values if "lora" in item] == [
        "existing.safetensors",
        "added.safetensors",
    ]
    assert values[-2:] == [{}, ""]
    assert named_values["lora_2"]["lora"] == "added.safetensors"
    assert values[3]["strength"] == 1.0
    assert values[3]["on"] is True
    assert named_values["➕ Add Lora"] == ""


def test_replace_updates_power_lora_named_mirror_and_strength():
    workflow = {
        "nodes": [
            {
                "id": 25,
                "type": "Power Lora Loader (rgthree)",
                "widgets_values": [
                    {},
                    {"type": "PowerLoraLoaderHeaderWidget"},
                    {"on": True, "lora": "old.safetensors", "strength": 1.0},
                    {},
                    "",
                ],
                "widgets_values_named": {
                    "divider": {},
                    "PowerLoraLoaderHeaderWidget": {
                        "type": "PowerLoraLoaderHeaderWidget"
                    },
                    "lora_1": {
                        "on": True,
                        "lora": "old.safetensors",
                        "strength": 1.0,
                    },
                    "➕ Add Lora": "",
                },
            }
        ]
    }
    ref = _reference(
        25,
        "old.safetensors",
        category="loras",
        node_type="Power Lora Loader (rgthree)",
        widget_index=2,
        nested_key="lora",
        custom_node_adapter="rgthree-power-lora-loader",
    )

    result = transfer_models_to_workflow(
        workflow,
        [{"original_path": "new.safetensors", "category": "loras", "strength": 0.35}],
        [_selector(ref)],
        inventory=_inventory(ref),
    )

    value = workflow["nodes"][0]["widgets_values"][2]
    named_value = workflow["nodes"][0]["widgets_values_named"]["lora_1"]
    assert result["updated"] == 1
    assert result["requires_full_reload"] is True
    assert value == {"on": True, "lora": "new.safetensors", "strength": 0.35}
    assert named_value == value


def test_merge_keeps_regular_single_model_nodes_unchanged():
    workflow = {
        "nodes": [
            {
                "id": 23,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["existing.safetensors"],
            }
        ]
    }
    ref = _reference(
        23,
        "existing.safetensors",
        category="checkpoints",
        node_type="CheckpointLoaderSimple",
    )
    original = deepcopy(workflow)

    with pytest.raises(ValueError, match="could accept"):
        transfer_models_to_workflow(
            workflow,
            [{"original_path": "added.safetensors", "category": "checkpoints"}],
            [_selector(ref)],
            mode="merge",
            inventory=_inventory(ref),
        )

    assert workflow == original


def test_stale_target_selector_is_rejected_without_mutating_workflow():
    workflow = {
        "nodes": [
            {
                "id": 24,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["current.safetensors"],
            }
        ]
    }
    current_ref = _reference(
        24,
        "current.safetensors",
        category="checkpoints",
        node_type="CheckpointLoaderSimple",
    )
    stale_selector = {
        **_selector(current_ref),
        "original_path": "stale.safetensors",
    }
    original = deepcopy(workflow)

    with pytest.raises(ValueError, match="no longer available"):
        transfer_models_to_workflow(
            workflow,
            [{"original_path": "new.safetensors", "category": "checkpoints"}],
            [stale_selector],
            inventory=_inventory(current_ref),
        )

    assert workflow == original

"""Tests for extracting workflow hashes in Anomalous Model Browser format."""

from core.resolver import (
    extract_workflow_hash_metadata,
    _collect_workflow_hash_entries,
)


def test_collect_anomalous_hashes_flat_dict():
    raw_workflow = {
        "extra": {
            "anomalous_hashes": {
                "checkpoints/sdxl_base.safetensors": {
                    "hash": "e4a3acaa200a6e3c860558c41d63bc3d2656ffab0da1b3ac970803bdee83e0c7",
                    "size": 4265147814,
                },
                "loras/detail_slider.safetensors": {
                    "SHA256": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                    "file_size": "50000000",
                },
            }
        }
    }

    entries = _collect_workflow_hash_entries(raw_workflow["extra"])
    assert len(entries) >= 2

    metadata_index = extract_workflow_hash_metadata(raw_workflow)
    assert "checkpoints/sdxl_base.safetensors" in metadata_index
    assert "sdxl_base.safetensors" in metadata_index
    assert metadata_index["sdxl_base.safetensors"]["sha256"] == (
        "e4a3acaa200a6e3c860558c41d63bc3d2656ffab0da1b3ac970803bdee83e0c7"
    )
    assert metadata_index["sdxl_base.safetensors"]["size"] == 4265147814

    assert "loras/detail_slider.safetensors" in metadata_index
    assert "detail_slider.safetensors" in metadata_index
    assert metadata_index["detail_slider.safetensors"]["sha256"] == (
        "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    )
    assert metadata_index["detail_slider.safetensors"]["size"] == 50000000


def test_collect_anomalous_hashes_string_values():
    raw_workflow = {
        "extra": {
            "anomalous_hashes": {
                "v1-5-pruned.safetensors": "e4a3acaa200a6e3c860558c41d63bc3d2656ffab0da1b3ac970803bdee83e0c7"
            }
        }
    }

    metadata_index = extract_workflow_hash_metadata(raw_workflow)
    assert "v1-5-pruned.safetensors" in metadata_index
    assert metadata_index["v1-5-pruned.safetensors"]["sha256"] == (
        "e4a3acaa200a6e3c860558c41d63bc3d2656ffab0da1b3ac970803bdee83e0c7"
    )

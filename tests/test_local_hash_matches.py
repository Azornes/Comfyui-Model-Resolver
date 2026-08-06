from unittest.mock import Mock

from core.local_hash_matches import collect_local_hash_matches_for_result


def test_collect_local_hash_matches_forwards_lookup_options_and_enriches_results():
    sha256 = "a" * 64
    lookup = Mock(return_value=[{"path": r"C:\models\local.safetensors"}])

    matches = collect_local_hash_matches_for_result(
        sha256,
        search_local_matches_by_hash=lookup,
        category="checkpoints",
        max_matches=7,
        force_rescan=True,
        source="civitai",
        filename="remote.safetensors",
    )

    lookup.assert_called_once_with(
        sha256,
        category="checkpoints",
        max_matches=7,
        force_rescan=True,
    )
    assert matches == [
        {
            "path": r"C:\models\local.safetensors",
            "hash_lookup_source": "civitai",
            "hash_lookup_filename": "remote.safetensors",
            "hash_lookup_sha256": sha256,
        }
    ]


def test_collect_local_hash_matches_skips_empty_hash_without_lookup():
    lookup = Mock()

    assert collect_local_hash_matches_for_result(
        "",
        search_local_matches_by_hash=lookup,
        source="custom",
        filename="model.safetensors",
    ) == []
    lookup.assert_not_called()

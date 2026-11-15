import hashlib
from unittest.mock import patch
from core.contracts import ResolvedModel
from core.resolver import (
    search_local_matches_by_hash,
    invalidate_local_hash_match_cache,
)
from core.local_hash_matches import collect_local_hash_matches_for_result


def test_size_matched_hashing_unindexed_candidate(tmp_path):
    invalidate_local_hash_match_cache()

    file_content = b"sample weight data 1234567890" * 10
    file_size = len(file_content)
    actual_hash = hashlib.sha256(file_content).hexdigest()

    model_file = tmp_path / "custom_unindexed_model.safetensors"
    model_file.write_bytes(file_content)

    resolved_model = ResolvedModel(
        path=str(model_file),
        category="checkpoints",
        relative_path="custom_unindexed_model.safetensors",
    )

    with patch("core.resolver.get_model_files", return_value=[resolved_model]):
        # Without expected_size or when expected_size is None, unindexed model is not found in cache
        matches_no_size = search_local_matches_by_hash(
            actual_hash,
            force_rescan=True,
            expected_size=None,
        )
        assert len(matches_no_size) == 0

        # With mismatched expected_size, it should skip hashing and return empty
        matches_wrong_size = search_local_matches_by_hash(
            actual_hash,
            expected_size=file_size + 100,
        )
        assert len(matches_wrong_size) == 0

        # With exact matching expected_size, it computes SHA256 and finds the match
        matches_exact = search_local_matches_by_hash(
            actual_hash,
            expected_size=file_size,
        )
        assert len(matches_exact) == 1
        assert matches_exact[0].model.path == str(model_file)
        assert matches_exact[0].extra.get("hash_lookup_source") == "size_matched_hash"
        assert matches_exact[0].extra.get("size") == file_size


def test_collect_local_hash_matches_for_result_passes_expected_size(tmp_path):
    invalidate_local_hash_match_cache()

    file_content = b"lora weight bytes" * 20
    file_size = len(file_content)
    actual_hash = hashlib.sha256(file_content).hexdigest()

    model_file = tmp_path / "unindexed_lora.safetensors"
    model_file.write_bytes(file_content)

    resolved_model = ResolvedModel(
        path=str(model_file),
        category="loras",
        relative_path="unindexed_lora.safetensors",
    )


    with patch("core.resolver.get_model_files", return_value=[resolved_model]):
        matches = collect_local_hash_matches_for_result(
            actual_hash,
            search_local_matches_by_hash=search_local_matches_by_hash,
            expected_size=file_size,
        )
        assert len(matches) == 1
        assert matches[0].model.path == str(model_file)

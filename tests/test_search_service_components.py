from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.services.search_cache import SearchResultCache
from core.services.search_providers import SearchCancelled, SearchProviderRunner


def _request(**overrides):
    values = {
        "filename": "model.safetensors",
        "category": "checkpoints",
        "base_model_context": "SDXL",
        "progress_id": "search-1",
        "progress_source": "civitai",
        "force_search": False,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_search_result_cache_reuses_timestamp_for_same_result():
    timestamps = {}
    cache = SearchResultCache(timestamps)

    first = cache.stamp_results(
        {"civitai": {"name": "Model", "download_url": "https://example.test/model"}},
        force_search=False,
    )
    second = cache.stamp_results(
        {"civitai": {"name": "Model", "download_url": "https://example.test/model"}},
        force_search=False,
    )

    assert first["civitai"]["searched_at"] == second["civitai"]["searched_at"]
    assert len(timestamps) == 1


def test_search_result_cache_stamps_nested_results_and_preserves_empty_values():
    cache = SearchResultCache({})
    payload = {
        "popular": [
            {"filename": "one.safetensors", "url": "https://example.test/one"},
            {"filename": "two.safetensors", "url": "https://example.test/two"},
        ],
        "civitai": None,
        "source_errors": {"civitai": "unavailable"},
    }

    stamped = cache.stamp_results(payload, force_search=False)

    assert all(item["searched_at"] for item in stamped["popular"])
    assert stamped["civitai"] is None
    assert stamped["source_errors"] == {"civitai": "unavailable"}


def test_search_provider_runner_reports_progress_and_result():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result = runner.run_source_search(
        _request(),
        "civitai",
        lambda: ({"civitai": {"name": "Model"}}, True),
        initial_stage="query",
        initial_message="Querying CivitAI",
        initial_percent=30,
    )

    assert result == ({"civitai": {"name": "Model"}}, True)
    progress_calls = owner.search_tracker.update.call_args_list
    assert progress_calls[0].args[:5] == (
        "search-1",
        "civitai",
        "query",
        "Querying CivitAI",
        30,
    )
    assert progress_calls[-1].args[:5] == (
        "search-1",
        "civitai",
        "done",
        "CivitAI checked",
        92,
    )


def test_search_provider_runner_raises_cancellation_before_provider_call():
    owner = SimpleNamespace(search_tracker=MagicMock())
    owner.search_tracker.is_cancelled.return_value = True
    runner = SearchProviderRunner(owner)

    with pytest.raises(SearchCancelled):
        runner.raise_if_search_cancelled(_request(), "civitai")

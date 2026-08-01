from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.routes.context import RouteContext
from core.services.search_cache import SearchResultCache
from core.services.search_dependencies import SearchDependencies
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


def test_search_provider_runner_retries_without_base_model_context():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)
    calls = []

    def search_fn(base_model_context, progress_callback):
        calls.append((base_model_context, progress_callback))
        if len(calls) == 1:
            return None
        return {"name": "Fallback model"}

    result = runner.execute_search_with_fallback(
        _request(),
        "civitai",
        search_fn,
        "CivitAI",
    )

    assert [call[0] for call in calls] == ["SDXL", None]
    assert result["any_model_match"] is True
    assert result["base_model_fallback"] is True
    assert result["requested_base_model"] == "SDXL"


def test_search_provider_runner_searches_local_sources():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        get_popular_model_url=MagicMock(
            return_value={"download_url": "https://example.test/model"}
        ),
        search_model_list=MagicMock(
            return_value={
                "filename": "model.safetensors",
                "size": 123,
                "confidence": 95,
            }
        ),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result, found = runner.search_local_sources(_request(is_urn=False))

    assert found is True
    assert result["popular"]["size"] == 123
    assert result["popular"]["download_url"] == "https://example.test/model"
    assert result["model_list"]["confidence"] == 95


def test_search_provider_runner_scales_provider_progress():
    owner = SimpleNamespace(search_tracker=MagicMock())
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    callback = runner.make_source_progress_callback(
        _request(),
        "civitai",
        20,
        80,
    )
    callback({"stage": "query", "message": "Searching", "percent": 50, "source": "ignored", "items": 2})

    update_call = owner.search_tracker.update.call_args
    assert update_call.args[:5] == (
        "search-1",
        "civitai",
        "query",
        "Searching",
        50.0,
    )
    assert update_call.kwargs == {"status": "running", "items": 2}


def test_search_provider_runner_handles_civarchive_error():
    class ProviderError(Exception):
        pass

    owner = SimpleNamespace(
        CivArchiveSearchError=ProviderError,
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result = runner.run_source_search(
        _request(),
        "civarchive",
        lambda: (_ for _ in ()).throw(ProviderError("provider unavailable")),
        error_handlers={
            ProviderError: lambda error: (
                {"civarchive": None, "source_errors": {"civarchive": str(error)}},
                False,
            )
        },
    )

    assert result == (
        {"civarchive": None, "source_errors": {"civarchive": "provider unavailable"}},
        False,
    )


def test_search_provider_runner_resolves_civitai_urn():
    owner = SimpleNamespace(
        CivArchiveSearchError=Exception,
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="ids=10@20"),
        resolve_urn=MagicMock(
            return_value={
                "model_name": "URN Model",
                "version_name": "v1",
                "expected_filename": "urn.safetensors",
                "base_model": "SDXL",
                "files": [{"name": "urn.safetensors", "sha256": "a" * 64}],
            }
        ),
        get_civitai_download_url=MagicMock(return_value="https://example.test/download"),
        build_search_result=MagicMock(side_effect=lambda source, **fields: {"source": source, **fields}),
    )
    owner.search_tracker.is_cancelled.return_value = False
    owner.log_search_result = MagicMock()
    runner = SearchProviderRunner(owner)

    result, found = runner.search_civitai_source_task(
        _request(
            data={"model_id": 10, "version_id": 20},
            is_urn=True,
            base_model_context="",
        )
    )

    assert found is True
    assert result["civitai"]["model_id"] == 10
    assert result["civitai"]["version_id"] == 20
    assert result["civitai"]["sha256"] == "a" * 64


def test_search_provider_runner_falls_back_for_civitai_urn_without_ids():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        search_civitai=MagicMock(
            return_value=[
                {
                    "model_id": 30,
                    "version_id": 40,
                    "name": "Fallback model",
                    "filename": "model.safetensors",
                    "type": "Checkpoint",
                    "download_url": "https://example.test/fallback",
                    "url": "https://example.test/model/30",
                    "size": 456,
                    "base_model": "SDXL",
                    "tags": ["fallback"],
                }
            ]
        ),
        build_search_result=MagicMock(
            side_effect=lambda source, **fields: {"source": source, **fields}
        ),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result, found = runner.search_civitai_source_task(
        _request(data={"model_id": None, "version_id": None}, is_urn=True)
    )

    assert found is True
    assert result["civitai"]["model_id"] == 30
    assert result["civitai"]["download_url"] == "https://example.test/fallback"
    owner.search_civitai.assert_called_once_with(
        "model.safetensors",
        model_type="checkpoints",
    )


def test_search_provider_runner_resolves_civarchive_urn():
    owner = SimpleNamespace(
        CivArchiveSearchError=Exception,
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="ids=10@20"),
        resolve_civarchive_model_version=MagicMock(
            return_value={"name": "Archived model", "version_id": 20}
        ),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result, found = runner.search_civarchive_source_task(
        _request(
            data={"model_id": 10, "version_id": 20},
            is_urn=True,
        )
    )

    assert found is True
    assert result["civarchive"] == {"name": "Archived model", "version_id": 20}
    owner.resolve_civarchive_model_version.assert_called_once_with(
        10,
        20,
        query="model.safetensors",
    )


def test_search_provider_runner_searches_lora_manager_archive():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        search_lora_manager_archive_for_file=MagicMock(
            return_value={"name": "Archived LoRA"}
        ),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result, found = runner.search_lora_manager_archive_source_task(
        _request(base_model_context="")
    )

    assert found is True
    assert result == {"lora_manager_archive": {"name": "Archived LoRA"}}
    owner.search_lora_manager_archive_for_file.assert_called_once()


def test_search_dependencies_require_extension_context():
    with pytest.raises(KeyError, match="Missing route dependency: self"):
        SearchDependencies.from_context(RouteContext({}))


def test_search_dependencies_require_core_provider_dependencies():
    extension = SimpleNamespace(
        logger=MagicMock(),
        search_result_timestamps={},
        search_tracker=MagicMock(),
    )

    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        SearchDependencies.from_context(RouteContext({"self": extension}))

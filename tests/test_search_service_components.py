import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from core.routes.context import RouteContext
from core.services.search_cache import SearchResultCache
from core.services.search_dependencies import SearchDependencies
from core.services.search_orchestrator import SearchOrchestrator
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


def _build_search_orchestrator():
    tracker = MagicMock()
    tracker.is_cancelled.return_value = False
    extension = SimpleNamespace(
        search_tracker=tracker,
        search_result_timestamps={},
        logger=MagicMock(),
    )

    def to_bool(value, default=False):
        if value is None:
            return default
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def to_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def extract_sha256(metadata):
        return metadata.get("sha256") or (
            metadata.get("hashes") or {}
        ).get("SHA256")

    context_values = {
        "self": extension,
        "asyncio": asyncio,
        "CivArchiveSearchError": Exception,
        "build_model_result": lambda source, **fields: {
            "source": source,
            **fields,
        },
        "clear_civarchive_search_cache": MagicMock(),
        "clear_civitai_search_cache": MagicMock(),
        "clear_huggingface_search_cache": MagicMock(),
        "clear_lora_manager_archive_search_cache": MagicMock(),
        "extract_sha256_from_metadata": extract_sha256,
        "format_size_bytes": lambda value, include_space=True: str(value),
        "get_civitai_download_url": MagicMock(),
        "get_popular_model_url": MagicMock(),
        "reload_model_list": MagicMock(),
        "reload_popular_databases": MagicMock(),
        "resolve_civarchive_model_version": MagicMock(),
        "resolve_urn": MagicMock(),
        "search_civarchive_for_file": MagicMock(),
        "search_civitai": MagicMock(),
        "search_civitai_for_file": MagicMock(),
        "search_huggingface_for_file": MagicMock(),
        "search_local_matches_by_hash": MagicMock(return_value=[]),
        "search_lora_manager_archive_for_file": MagicMock(),
        "search_model_list": MagicMock(),
        "to_bool": to_bool,
        "to_int": to_int,
        "web": SimpleNamespace(
            json_response=lambda payload, status=200: SimpleNamespace(
                payload=payload,
                status=status,
            )
        ),
    }
    return SearchOrchestrator(RouteContext(context_values)), context_values


class _StaticSearchRunner:
    def __init__(self, source_results, source_found):
        self.source_results = source_results
        self.source_found = source_found

    def create_search_tasks(self, request):
        async def search_task():
            return self.source_results, self.source_found

        return [search_task()]

    def raise_if_search_cancelled(self, request, source=""):
        return None


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


def test_search_provider_runner_exposes_civarchive_status_metadata():
    from core.sources.civarchive import CivArchiveSearchError

    owner = SimpleNamespace(
        CivArchiveSearchError=CivArchiveSearchError,
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        log_search_result=MagicMock(),
        search_civarchive_for_file=MagicMock(
            side_effect=CivArchiveSearchError(
                "HTTP 522",
                code="provider_unavailable",
                http_status=522,
                retryable=True,
            )
        ),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)

    result = runner.search_civarchive_source_task(
        _request(is_urn=False, data={}, civarchive_candidate_limit=5)
    )

    assert result[0]["source_status"]["civarchive"] == {
        "state": "unavailable",
        "code": "provider_unavailable",
        "retryable": True,
        "http_status": 522,
        "message": (
            "CivArchive may be overloaded or temporarily unavailable. "
            "Please try again."
        ),
    }
    warning_message = owner.logger.warning.call_args.args[0]
    assert warning_message == (
        "CivArchive search failed: code=provider_unavailable "
        "http_status=522 retryable=yes error_type=CivArchiveSearchError "
        "message=CivArchive may be overloaded or temporarily unavailable. "
        "Please try again."
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
        build_model_result=MagicMock(side_effect=lambda source, **fields: {"source": source, **fields}),
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
    assert result["civitai"]["name"] == "URN Model"
    assert result["civitai"]["version_name"] == "v1"
    assert result["civitai"]["filename"] == "urn.safetensors"
    assert result["civitai"]["type"] == "checkpoints"
    assert result["civitai"]["download_url"] == "https://example.test/download"
    assert result["civitai"]["url"] == "https://civitai.com/models/10?modelVersionId=20"
    assert result["civitai"]["size"] is None
    assert result["civitai"]["base_model"] == "SDXL"
    assert result["civitai"]["match_type"] == "exact"
    assert result["civitai"]["confidence"] == 100.0
    assert result["civitai"]["sha256"] == "a" * 64
    assert result["civitai"]["hashes"] == {}


def test_search_provider_runner_keeps_first_file_when_expected_name_is_missing():
    owner = SimpleNamespace(
        CivArchiveSearchError=Exception,
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="ids=10@20"),
        resolve_urn=MagicMock(
            return_value={
                "model_name": "URN Model",
                "version_name": "v1",
                "expected_filename": "missing.safetensors",
                "base_model": "SDXL",
                "files": [
                    {"name": "fallback.safetensors", "sha256": "a" * 64},
                    {
                        "name": "primary.safetensors",
                        "primary": True,
                        "type": "Model",
                        "sha256": "b" * 64,
                    },
                ],
            }
        ),
        get_civitai_download_url=MagicMock(return_value="https://example.test/download"),
        build_model_result=MagicMock(side_effect=lambda source, **fields: {"source": source, **fields}),
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
        build_model_result=MagicMock(
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


def test_search_provider_runner_skips_name_fallback_for_sha256():
    owner = SimpleNamespace(
        logger=MagicMock(),
        search_tracker=MagicMock(),
        format_log_fields=MagicMock(return_value="file=model.safetensors"),
        log_search_result=MagicMock(),
    )
    owner.search_tracker.is_cancelled.return_value = False
    runner = SearchProviderRunner(owner)
    search_fn = MagicMock(return_value=None)

    result = runner.execute_search_with_fallback(
        _request(sha256="a" * 64),
        "lora_manager_archive",
        search_fn,
        "LoRA archive",
    )

    assert result is None
    search_fn.assert_called_once()


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


def test_search_orchestrator_formats_log_values_and_result_details():
    orchestrator, _ = _build_search_orchestrator()

    assert orchestrator.format_log_value(None) is None
    assert orchestrator.format_log_value("") is None
    assert orchestrator.format_log_value(False) == "no"
    assert orchestrator.format_log_value(["civitai", "huggingface"]) == (
        "civitai,huggingface"
    )
    assert orchestrator.format_log_value('model "one"') == '"model \\"one\\""'
    assert orchestrator.format_log_value("plain") == "plain"
    assert orchestrator.format_log_fields(
        enabled=False,
        tags=["one", "two"],
        missing=None,
    ) == "enabled=no tags=one,two"
    assert orchestrator.format_result_details([{"name": "one"}]) == "count=1"
    assert orchestrator.format_result_details(
        None,
        {"model_id": 10, "files_count": 2},
    ) == "result=none ids=10 files=2"
    assert "ids=10@20" in orchestrator.format_result_details(
        {
            "name": "Model",
            "filename": "model.safetensors",
            "model_id": 10,
            "version_id": 20,
            "size": 1024,
        }
    )


@pytest.mark.asyncio
async def test_search_orchestrator_force_search_refreshes_selected_caches():
    orchestrator, dependencies = _build_search_orchestrator()
    orchestrator.provider_runner = _StaticSearchRunner({}, False)
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "filename": "model.safetensors",
                "sources": [
                    "local",
                    "huggingface",
                    "civitai",
                    "civarchive",
                    "lora_manager_archive",
                ],
                "force_search": True,
                "progress_id": "force-search",
            }
        )
    )

    response = await orchestrator.search_sources(request)

    assert response.status == 200
    assert response.payload["found"] is False
    dependencies["reload_popular_databases"].assert_called_once_with()
    dependencies["reload_model_list"].assert_called_once_with()
    dependencies["clear_huggingface_search_cache"].assert_called_once_with()
    dependencies["clear_civitai_search_cache"].assert_called_once_with()
    dependencies["clear_civarchive_search_cache"].assert_called_once_with()
    dependencies[
        "clear_lora_manager_archive_search_cache"
    ].assert_called_once_with()


@pytest.mark.asyncio
async def test_search_orchestrator_preserves_provider_status_metadata():
    orchestrator, _dependencies = _build_search_orchestrator()
    orchestrator.provider_runner = _StaticSearchRunner(
        {
            "civarchive": None,
            "source_errors": {
                "civarchive": "CivArchive search failed: HTTP 522"
            },
            "source_status": {
                "civarchive": {
                    "state": "unavailable",
                    "code": "provider_unavailable",
                    "retryable": True,
                    "http_status": 522,
                    "message": (
                        "CivArchive may be overloaded or temporarily unavailable. "
                        "Please try again."
                    ),
                }
            },
        },
        False,
    )
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "filename": "model.safetensors",
                "sources": ["civarchive"],
                "progress_id": "provider-status-search",
            }
        )
    )

    response = await orchestrator.search_sources(request)

    assert response.status == 200
    assert response.payload["found"] is False
    assert response.payload["source_errors"] == {
        "civarchive": "CivArchive search failed: HTTP 522"
    }
    assert response.payload["source_status"]["civarchive"]["code"] == (
        "provider_unavailable"
    )
    assert response.payload["source_status"]["civarchive"]["retryable"] is True


@pytest.mark.asyncio
async def test_search_orchestrator_returns_cancelled_response():
    orchestrator, dependencies = _build_search_orchestrator()
    dependencies["self"].search_tracker.is_cancelled.return_value = True
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "filename": "model.safetensors",
                "sources": ["civitai"],
                "progress_id": "cancelled-search",
            }
        )
    )

    response = await orchestrator.search_sources(request)

    assert response.status == 200
    assert response.payload["cancelled"] is True
    assert response.payload["found"] is False
    assert response.payload["searched_sources"] == ["civitai"]
    cancelled_updates = [
        call
        for call in dependencies["self"].search_tracker.update.call_args_list
        if len(call.args) >= 3 and call.args[2] == "cancelled"
    ]
    assert cancelled_updates
    assert cancelled_updates[-1].kwargs == {
        "status": "cancelled",
        "cancelled": True,
    }


@pytest.mark.asyncio
async def test_search_orchestrator_returns_error_response_for_unexpected_failure():
    orchestrator, dependencies = _build_search_orchestrator()
    request = SimpleNamespace(
        json=AsyncMock(side_effect=ValueError("invalid request"))
    )

    response = await orchestrator.search_sources(request)

    assert response.status == 500
    assert response.payload == {"error": "invalid request"}
    error_update = dependencies["self"].search_tracker.update.call_args
    assert error_update.args[:5] == ("", "", "error", "invalid request", 100)
    assert error_update.kwargs == {"status": "error"}
    dependencies["self"].logger.exception.assert_called_once()


@pytest.mark.asyncio
async def test_search_orchestrator_deduplicates_local_hash_matches_and_keeps_errors():
    orchestrator, dependencies = _build_search_orchestrator()
    first_hash = "a" * 64
    failing_hash = "b" * 64

    def lookup_by_hash(sha256, **kwargs):
        if sha256 == first_hash:
            return [
                {"model": {"path": r"C:\\Models\\Local.safetensors"}},
                {"path": r"c:\\models\\local.safetensors"},
            ]
        raise RuntimeError("local index unavailable")

    dependencies["search_local_matches_by_hash"].side_effect = lookup_by_hash
    orchestrator.provider_runner = _StaticSearchRunner(
        {
            "civitai": [
                {
                    "filename": "remote.safetensors",
                    "hashes": {"SHA256": first_hash},
                },
                {"filename": "without-hash.safetensors"},
                {"filename": "failing.safetensors", "sha256": failing_hash},
            ],
            "source_errors": {"civarchive": "provider unavailable"},
        },
        True,
    )
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "filename": "remote.safetensors",
                "category": "checkpoints",
                "sources": ["civitai"],
                "progress_id": "hash-search",
            }
        )
    )

    response = await orchestrator.search_sources(request)

    assert response.status == 200
    assert response.payload["found"] is True
    assert response.payload["source_errors"] == {
        "civarchive": "provider unavailable"
    }
    assert response.payload["source_status"] == {}
    assert len(response.payload["local_hash_matches"]) == 1
    assert response.payload["local_hash_matches"][0]["hash_lookup_sha256"] == (
        first_hash
    )
    assert response.payload["local_hash_matches"][0]["hash_lookup_source"] == (
        "civitai"
    )
    assert dependencies["search_local_matches_by_hash"].call_count == 2
    dependencies["self"].logger.warning.assert_called_once()

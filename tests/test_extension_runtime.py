from unittest.mock import MagicMock

from core.extension import ModelResolverExtension


def test_extension_initializes_progress_trackers_and_route_state():
    extension = ModelResolverExtension()

    assert extension.routes_setup is False
    assert extension.analysis_progress.default_message == "Analyzing..."
    assert extension.loaded_progress.default_message == "Loading loaded models..."
    assert extension.search_tracker.default_message == "Searching..."
    assert extension.hash_tracker.default_message == "Preparing hash calculation..."
    assert (
        extension.metadata_builder_progress.default_message
        == "Building local metadata..."
    )
    assert extension.search_result_timestamps == {}


def test_extension_progress_updates_delegate_to_trackers():
    extension = ModelResolverExtension()
    extension.analysis_progress = MagicMock()
    extension.metadata_builder_progress = MagicMock()
    extension.loaded_progress = MagicMock()

    extension._update_analysis_progress("analysis-1", {"stage": "matching"})
    extension._update_metadata_build_progress("build-1", {"percent": 40})
    extension._update_loaded_progress(
        "loaded-1",
        "indexing",
        "Indexing models",
        percent=50,
        current=2,
        total=4,
        source="local",
    )

    extension.analysis_progress.update_from_payload.assert_called_once_with(
        "analysis-1", {"stage": "matching"}
    )
    extension.metadata_builder_progress.update_from_payload.assert_called_once_with(
        "build-1", {"percent": 40}
    )
    extension.loaded_progress.update_from_payload.assert_called_once_with(
        "loaded-1",
        {
            "stage": "indexing",
            "message": "Indexing models",
            "percent": 50,
            "status": "running",
            "current": 2,
            "total": 4,
            "source": "local",
        },
    )


def test_extension_loaded_progress_ignores_missing_job_id():
    extension = ModelResolverExtension()
    extension.loaded_progress = MagicMock()

    extension._update_loaded_progress(None, "starting", "Preparing")

    extension.loaded_progress.update_from_payload.assert_not_called()


def test_extension_workflow_progress_maps_payload_and_defaults():
    extension = ModelResolverExtension()
    extension._update_loaded_progress = MagicMock()

    extension._update_workflow_analysis_progress(
        "loaded-1",
        10,
        lambda start, end, current, total: start + (end - start) * current / total,
        {
            "stage": "matching",
            "message": "Matching models",
            "current": 5,
            "total": 10,
            "percent": 99,
            "found": 3,
        },
        start_percent=20,
        end_percent=80,
    )

    extension._update_loaded_progress.assert_called_once_with(
        "loaded-1",
        "matching",
        "Matching models",
        percent=50.0,
        current=5,
        total=10,
        found=3,
    )

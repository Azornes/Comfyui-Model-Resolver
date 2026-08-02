import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from aiohttp import web

from core.routes.helpers import create_route_helpers


class _HashCancelled(Exception):
    pass


def _build_helpers():
    logger = MagicMock()
    helpers = create_route_helpers(
        web=web,
        logger=logger,
        load_settings=MagicMock(return_value={"download_backend": "python"}),
        hash_calculation_cancelled=_HashCancelled,
    )
    return helpers, logger


@pytest.mark.asyncio
async def test_json_api_endpoint_returns_500_for_unexpected_exception():
    (json_api_endpoint, *_), logger = _build_helpers()

    @json_api_endpoint("test")
    async def handler(request):
        raise RuntimeError("boom")

    response = await handler(SimpleNamespace())

    assert response.status == 500
    assert response.text == '{"error": "boom"}'
    logger.error.assert_called_once()


@pytest.mark.asyncio
async def test_json_api_endpoint_preserves_http_exception_status():
    (json_api_endpoint, *_), logger = _build_helpers()

    @json_api_endpoint("test")
    async def handler(request):
        raise web.HTTPBadRequest(reason="invalid payload")

    response = await handler(SimpleNamespace())

    assert response.status == 400
    assert response.text == '{"error": "invalid payload"}'
    logger.error.assert_called_once()


@pytest.mark.asyncio
async def test_json_api_endpoint_can_include_failure_success_flag():
    (json_api_endpoint, *_), _ = _build_helpers()

    @json_api_endpoint("test", return_success_on_error=True)
    async def handler(request):
        raise RuntimeError("boom")

    response = await handler(SimpleNamespace())

    assert response.status == 500
    assert response.text == '{"error": "boom", "success": false}'


def test_progress_helpers_validate_ids_and_wrap_results():
    (
        _,
        get_progress_response,
        cancel_progress_response,
        *_rest,
    ), _ = _build_helpers()
    tracker = MagicMock()
    tracker.get.return_value = {"status": "running"}
    tracker.mark_cancelled.return_value = False
    request = SimpleNamespace(match_info={"progress_id": "job-1"})

    progress = get_progress_response(
        tracker,
        request,
        found_wrapper=lambda payload: {"exists": True, **payload},
    )
    cancelled = cancel_progress_response(tracker, request)

    assert progress.text == '{"exists": true, "status": "running"}'
    assert cancelled.text == (
        '{"success": true, "cancelled": false, "progress_id": "job-1"}'
    )
    tracker.cleanup.assert_called_once_with()
    tracker.mark_cancelled.assert_called_once_with("job-1", "Cancelled")


def test_background_helper_reports_unexpected_task_errors():
    (_, _, _, run_in_background_thread, *_rest), logger = _build_helpers()
    tracker = MagicMock()
    tracker.is_cancelled.return_value = False
    on_error = MagicMock()
    error_reported = threading.Event()

    def report_error(error):
        on_error(error)
        error_reported.set()

    run_in_background_thread(
        tracker,
        "job-1",
        lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        MagicMock(),
        on_error=report_error,
    )

    assert error_reported.wait(timeout=2)
    on_error.assert_called_once()
    logger.exception.assert_called_once()

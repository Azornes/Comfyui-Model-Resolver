from unittest.mock import MagicMock, patch

import pytest
import requests

from core.network_guard import (
    ConnectivityGuard,
    RateLimitCoordinator,
    get_connectivity_guard,
    get_rate_limit_coordinator,
    normalize_destination,
    parse_retry_after,
)
from core.network_utils import request_source_response


@pytest.fixture(autouse=True)
def clean_guards():
    """Ensure both guards start each test with clean state."""
    rl = get_rate_limit_coordinator()
    cg = get_connectivity_guard()
    rl.clear()
    cg.clear()
    yield
    rl.clear()
    cg.clear()


def test_normalize_destination():
    assert normalize_destination("https://civitai.com/api/v1/models") == "civitai.com"
    assert normalize_destination("http://huggingface.co:443/models/test") == "huggingface.co"
    assert normalize_destination("sub.domain.org/path?query=1") == "sub.domain.org"
    assert normalize_destination("api.example.com") == "api.example.com"
    assert normalize_destination("") == "__global__"
    assert normalize_destination(None) == "__global__"


def test_parse_retry_after():
    assert parse_retry_after("120") == 120
    assert parse_retry_after(45) == 45
    assert parse_retry_after(None, default=30) == 30
    assert parse_retry_after("invalid", default=60) == 60
    assert parse_retry_after("-10") == 1  # clamped min 1
    assert parse_retry_after("10000") == 3600  # clamped max 3600


def test_rate_limit_coordinator_lifecycle():
    coordinator = RateLimitCoordinator()
    url = "https://civitai.com/api/download/models/123"

    assert not coordinator.is_rate_limited(url)
    assert coordinator.get_cooldown(url) == 0.0

    registered = coordinator.register_rate_limit(url, 2, reason="Rate limit test")
    assert registered == 2
    assert coordinator.is_rate_limited(url)
    assert coordinator.is_rate_limited("https://civitai.com/other")  # same domain
    assert not coordinator.is_rate_limited("https://huggingface.co/model")  # different domain
    assert coordinator.get_reason(url) == "Rate limit test"

    cooldown = coordinator.get_cooldown(url)
    assert 0.0 < cooldown <= 2.0

    # Test clearing
    coordinator.clear(url)
    assert not coordinator.is_rate_limited(url)
    assert coordinator.get_cooldown(url) == 0.0


def test_rate_limit_coordinator_wait_if_needed():
    coordinator = RateLimitCoordinator()
    url = "https://example.com/test"

    # Not rate limited -> returns True immediately
    assert coordinator.wait_if_needed(url, max_wait=1.0) is True

    # Active rate limit longer than max_wait -> returns False immediately without sleeping
    coordinator.register_rate_limit(url, 10)
    assert coordinator.wait_if_needed(url, max_wait=0.1) is False


def test_connectivity_guard_failure_and_recovery():
    guard = ConnectivityGuard(failure_threshold=3, base_backoff=5.0)
    url = "https://civitai.com/api/test"

    assert not guard.is_offline(url)

    # Record 2 failures (under threshold of 3)
    exc = requests.exceptions.ConnectionError("Connection refused")
    assert guard.record_failure(url, exc) is False
    assert not guard.is_offline(url)

    assert guard.record_failure(url, exc) is False
    assert not guard.is_offline(url)

    # 3rd failure activates guard
    assert guard.record_failure(url, exc) is True
    assert guard.is_offline(url)
    assert guard.get_offline_cooldown(url) > 0.0

    # Non-transport error (e.g. HTTP 404) should not increment transport failures
    http_err = requests.exceptions.HTTPError("404 Not Found")
    assert guard.record_failure(url, http_err) is False

    # Success resets the guard
    guard.record_success(url)
    assert not guard.is_offline(url)
    assert guard.get_offline_cooldown(url) == 0.0


def test_request_source_response_with_rate_limit_cooldown():
    url = "https://api.civitai.com/v1/models"
    coordinator = get_rate_limit_coordinator()

    # Pre-register a 10s cooldown
    coordinator.register_rate_limit(url, 10, reason="CivitAI rate limited")

    # request_source_response should skip immediately
    with patch("requests.get") as mock_get:
        response = request_source_response(url, log_name="Test")
        assert response is None
        mock_get.assert_not_called()

    # If raise_on_error is True, raises HTTPError
    with pytest.raises(requests.exceptions.HTTPError, match="Rate limit cooldown active"):
        request_source_response(url, log_name="Test", raise_on_error=True)


def test_request_source_response_registers_429():
    url = "https://api.civitai.com/v1/models"
    coordinator = get_rate_limit_coordinator()
    assert not coordinator.is_rate_limited(url)

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.headers = {"Retry-After": "30"}

    with patch("requests.get", return_value=mock_resp), patch("time.sleep"):
        resp = request_source_response(url, max_attempts=1)
        assert resp == mock_resp

    assert coordinator.is_rate_limited(url)
    assert 20.0 < coordinator.get_cooldown(url) <= 30.0


def test_request_source_response_connectivity_guard_skip():
    url = "https://offline.service.org/api"
    guard = get_connectivity_guard()

    # Activate offline guard
    exc = requests.exceptions.ConnectionError("Network is unreachable")
    for _ in range(guard.failure_threshold):
        guard.record_failure(url, exc)

    assert guard.is_offline(url)

    # Request should be skipped without hitting requests.get
    with patch("requests.get") as mock_get:
        resp = request_source_response(url)
        assert resp is None
        mock_get.assert_not_called()


def test_download_file_defers_when_rate_limited(tmp_path):
    from core.download.api import context as downloader
    from core.download.orchestrator import download_file

    url = "https://civitai.com/api/download/models/999"
    dest_path = str(tmp_path / "rate_limited_model.safetensors")
    coordinator = get_rate_limit_coordinator()

    # Pre-register 60s cooldown
    coordinator.register_rate_limit(url, 60, reason="HTTP 429 civitai")

    result = download_file(
        url,
        dest_path,
        "dl-rl-test",
        dependencies=downloader,
    )

    assert result["success"] is False
    assert "Rate limit exceeded (HTTP 429)" in result["error"]
    assert downloader.download_progress["dl-rl-test"]["status"] == "error"


def test_download_file_defers_when_connectivity_guard_offline(tmp_path):
    from core.download.api import context as downloader
    from core.download.orchestrator import download_file

    url = "https://offline-cdn.example.org/models/test.safetensors"
    dest_path = str(tmp_path / "offline_model.safetensors")
    guard = get_connectivity_guard()

    exc = requests.exceptions.ConnectionError("Connection refused")
    for _ in range(guard.failure_threshold):
        guard.record_failure(url, exc)

    assert guard.is_offline(url)

    result = download_file(
        url,
        dest_path,
        "dl-cg-test",
        dependencies=downloader,
    )

    assert result["success"] is False
    assert "Network offline" in result["error"]
    assert downloader.download_progress["dl-cg-test"]["status"] == "error"


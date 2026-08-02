from types import SimpleNamespace
from unittest.mock import patch

import pytest
import requests

from core import network_utils
from core.sources import civarchive


@pytest.mark.parametrize(
    ("status_code", "expected_code", "retryable"),
    [
        (408, "timeout", True),
        (429, "rate_limited", True),
        (500, "provider_unavailable", True),
        (502, "provider_unavailable", True),
        (522, "provider_unavailable", True),
        (404, "not_found", False),
        (403, "provider_rejected", False),
    ],
)
def test_civarchive_http_failures_are_classified(status_code, expected_code, retryable):
    assert civarchive._classify_civarchive_http_status(status_code) == {
        "code": expected_code,
        "retryable": retryable,
    }


@pytest.mark.parametrize("status_code", [502, 522])
def test_civarchive_search_preserves_http_failure_message(status_code):
    response = SimpleNamespace(status_code=status_code, text="")

    with patch.object(civarchive, "request_source_response", return_value=response), pytest.raises(
        civarchive.CivArchiveSearchError, match=f"HTTP {status_code}"
    ) as raised:
        civarchive._search_page("model.safetensors")

    assert raised.value.code == "provider_unavailable"
    assert raised.value.http_status == status_code
    assert raised.value.retryable is True


def test_civarchive_search_preserves_network_failure_message():
    with patch.object(civarchive, "request_source_response", return_value=None), pytest.raises(
        civarchive.CivArchiveSearchError, match="network error or timeout"
    ) as raised:
        civarchive._search_page("model.safetensors")

    assert raised.value.code == "network_error"
    assert raised.value.http_status is None
    assert raised.value.retryable is True


@pytest.mark.parametrize(
    ("transport_error", "expected_code", "expected_message"),
    [
        (requests.Timeout("read timeout"), "timeout", "timed out"),
        (requests.ConnectionError("connection reset"), "network_error", "network error"),
    ],
)
def test_civarchive_search_classifies_transport_failures(
    transport_error,
    expected_code,
    expected_message,
):
    with patch.object(
        civarchive,
        "request_source_response",
        side_effect=transport_error,
    ), pytest.raises(civarchive.CivArchiveSearchError, match=expected_message) as raised:
        civarchive._search_page("model.safetensors")

    assert raised.value.code == expected_code
    assert raised.value.retryable is True


def test_request_source_response_can_propagate_transport_errors():
    with patch.object(network_utils.requests, "get", side_effect=requests.Timeout("timeout")), pytest.raises(
        requests.Timeout, match="timeout"
    ):
        network_utils.request_source_response(
            "https://example.test/search",
            raise_on_error=True,
        )

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.sources import civarchive


@pytest.mark.parametrize("status_code", [502, 522])
def test_civarchive_search_preserves_http_failure_message(status_code):
    response = SimpleNamespace(status_code=status_code, text="")

    with (
        patch.object(civarchive, "request_source_response", return_value=response),
        pytest.raises(civarchive.CivArchiveSearchError, match=f"HTTP {status_code}"),
    ):
        civarchive._search_page("model.safetensors")


def test_civarchive_search_preserves_network_failure_message():
    with (
        patch.object(civarchive, "request_source_response", return_value=None),
        pytest.raises(civarchive.CivArchiveSearchError, match="network error or timeout"),
    ):
        civarchive._search_page("model.safetensors")

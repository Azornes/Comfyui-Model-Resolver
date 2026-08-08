from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from core.request_utils import extract_request_sha256, read_optional_object_payload


def test_extract_request_sha256_preserves_alias_precedence_and_normalization():
    sha256 = "a" * 64

    assert extract_request_sha256(
        {
            "sha256": "",
            "hash": f"sha256:{sha256.upper()}",
            "file_hash": "b" * 64,
        },
        keys=("sha256", "hash", "file_hash"),
    ) == sha256
    assert extract_request_sha256(
        {"sha256": "invalid", "hash": sha256},
        keys=("sha256", "hash"),
    ) == ""
    assert extract_request_sha256(
        {"SHA256": sha256},
        keys=("sha256", "hash", "SHA256"),
    ) == sha256
    assert extract_request_sha256({}, keys=("sha256", "hash")) == ""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"force": True}, {"force": True}),
        ([], {}),
        ("invalid", {}),
        (None, {}),
    ],
)
async def test_read_optional_object_payload_normalizes_json_values(
    payload, expected
):
    request = SimpleNamespace(
        can_read_body=True,
        json=AsyncMock(return_value=payload),
    )

    assert await read_optional_object_payload(request) == expected


@pytest.mark.asyncio
async def test_read_optional_object_payload_ignores_json_parse_errors():
    request = SimpleNamespace(
        can_read_body=True,
        json=AsyncMock(side_effect=ValueError("invalid json")),
    )

    assert await read_optional_object_payload(request) == {}


@pytest.mark.asyncio
async def test_read_optional_object_payload_skips_unreadable_body():
    request = SimpleNamespace(
        can_read_body=False,
        json=AsyncMock(),
    )

    assert await read_optional_object_payload(request) == {}
    request.json.assert_not_awaited()


@pytest.mark.asyncio
async def test_read_optional_object_payload_supports_requests_without_body_flag():
    request = SimpleNamespace(json=AsyncMock(return_value={"value": 1}))

    assert await read_optional_object_payload(request) == {"value": 1}

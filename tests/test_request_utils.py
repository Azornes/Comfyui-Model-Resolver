from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from core.request_utils import (
    coerce_integer_identifier,
    extract_request_sha256,
    read_bool_field,
    read_first_bool_field,
    read_first_identifier_field,
    read_first_text_field,
    read_identifier_field,
    read_int_field,
    read_optional_object_payload,
    read_optional_text_field,
    read_text_field,
)


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
    with pytest.raises(TypeError, match="Request sha256 must be a string"):
        extract_request_sha256(
            {"sha256": 123},
            keys=("sha256", "hash"),
        )


def test_read_text_field_preserves_optional_null_and_rejects_scalars():
    assert read_text_field({}, "name", default="fallback") == "fallback"
    assert read_text_field({"name": None}, "name", default="fallback") == (
        "fallback"
    )
    assert read_text_field({"name": " value "}, "name") == "value"
    with pytest.raises(TypeError, match="Request name must be a string"):
        read_text_field({"name": 123}, "name")


def test_read_optional_text_field_preserves_missing_value_and_validates():
    assert read_optional_text_field({}, "name") is None
    assert read_optional_text_field({"name": " value "}, "name") == "value"
    assert read_optional_text_field({"name": ""}, "name") is None
    with pytest.raises(TypeError, match="Request name must be a string"):
        read_optional_text_field({"name": 123}, "name")


def test_read_first_text_field_preserves_alias_order_and_rejects_scalars():
    assert read_first_text_field(
        {"url": "", "custom_url": " https://example.test/model "},
        ("url", "custom_url"),
    ) == "https://example.test/model"
    with pytest.raises(TypeError, match="Request url must be a string"):
        read_first_text_field(
            {"url": 123, "custom_url": "https://example.test/model"},
            ("url", "custom_url"),
        )


def test_read_identifier_field_accepts_only_string_or_integer_identifiers():
    assert read_identifier_field({"id": " 12 "}, "id") == "12"
    assert read_identifier_field({"id": 12}, "id") == 12
    assert read_identifier_field({}, "id") is None
    with pytest.raises(TypeError, match="Request id must be an integer or string"):
        read_identifier_field({"id": True}, "id")


def test_coerce_integer_identifier_rejects_non_numeric_values():
    assert coerce_integer_identifier(" 12 ", "id") == 12
    assert coerce_integer_identifier(34, "id") == 34
    assert coerce_integer_identifier("", "id") is None
    with pytest.raises(ValueError, match="Request id must be an integer"):
        coerce_integer_identifier("repo/name", "id")


def test_read_first_identifier_field_preserves_alias_order_and_rejects_scalars():
    assert read_first_identifier_field(
        {"model_id": "", "modelId": " 12 "},
        ("model_id", "modelId"),
    ) == "12"
    with pytest.raises(
        TypeError,
        match="Request model_id must be an integer or string",
    ):
        read_first_identifier_field(
            {"model_id": {"value": 12}, "modelId": 12},
            ("model_id", "modelId"),
        )


def test_read_bool_field_accepts_supported_forms_and_rejects_scalars():
    assert read_bool_field({"value": "true"}, "value") is True
    assert read_bool_field({"value": 0}, "value") is False
    assert read_bool_field({}, "value", default=True) is True
    with pytest.raises(TypeError, match="Request value must be a boolean"):
        read_bool_field({"value": {"enabled": True}}, "value")


def test_read_first_bool_field_preserves_alias_order_and_rejects_scalars():
    assert read_first_bool_field(
        {"force": "", "force_rescan": "true"},
        ("force", "force_rescan"),
    ) is True
    with pytest.raises(TypeError, match="Request force must be a boolean"):
        read_first_bool_field(
            {"force": {"enabled": True}, "force_rescan": True},
            ("force", "force_rescan"),
        )


def test_read_int_field_rejects_boolean_and_invalid_numeric_values():
    assert read_int_field({"value": " 12 "}, "value") == 12
    assert read_int_field({}, "value", default=5) == 5
    with pytest.raises(TypeError, match="Request value must be an integer"):
        read_int_field({"value": True}, "value")
    with pytest.raises(ValueError, match="Request value must be an integer"):
        read_int_field({"value": "not-a-number"}, "value")


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

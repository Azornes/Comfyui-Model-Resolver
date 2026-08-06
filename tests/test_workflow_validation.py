import pytest

from core.request_utils import validate_workflow_payload


@pytest.mark.parametrize(
    ("value", "expected", "error"),
    [
        (None, None, "Workflow JSON is required"),
        ({}, {}, None),
        ([], None, "Workflow JSON must be an object"),
    ],
)
def test_validate_workflow_payload_matches_analyze_contract(value, expected, error):
    result, message = validate_workflow_payload(value)

    assert result == expected
    assert message == error


def test_validate_workflow_payload_can_reject_empty_objects():
    result, message = validate_workflow_payload({}, empty_is_missing=True)

    assert result is None
    assert message == "Workflow JSON is required"


def test_validate_workflow_payload_can_preserve_non_object_resolution_inputs():
    value = ["workflow"]

    result, message = validate_workflow_payload(
        value,
        empty_is_missing=True,
        require_object=False,
    )

    assert result == value
    assert message is None


def test_validate_workflow_payload_can_treat_none_as_an_invalid_object():
    result, message = validate_workflow_payload(
        None,
        none_is_missing=False,
    )

    assert result is None
    assert message == "Workflow JSON must be an object"

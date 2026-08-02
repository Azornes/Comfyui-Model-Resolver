import pytest

from core.routes.context import RouteContext
from core.services.directory_service import DirectoryService
from core.services.scanner_service import ScannerService


def test_route_context_remains_immutable_after_construction():
    values = {"dependency": "original"}
    context = RouteContext(values)
    values["dependency"] = "changed"

    assert context.get("dependency") == "original"
    with pytest.raises(KeyError, match="Missing route dependency: absent"):
        context.require("absent")


def test_scanner_service_requires_mandatory_route_dependencies():
    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        ScannerService(RouteContext({}))


def test_directory_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: TEMPLATE_KEY_ALIASES",
    ):
        DirectoryService(RouteContext({}))

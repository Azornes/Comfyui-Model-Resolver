import pytest

from core.routes.context import RouteContext
from core.services.directory_service import DirectoryService
from core.services.download_service import DownloadService
from core.services.hash_service import HashService
from core.services.loaded_models_service import LoadedModelsService
from core.services.metadata_service import MetadataService
from core.services.scanner_service import ScannerService
from core.services.workflow_service import WorkflowService


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


def test_workflow_service_requires_mandatory_route_dependencies():
    extension = type(
        "Extension",
        (),
        {
            "analysis_progress": object(),
            "_update_analysis_progress": object(),
            "logger": object(),
        },
    )()

    with pytest.raises(
        KeyError,
        match="Missing route dependency: analyze_and_find_matches",
    ):
        WorkflowService(RouteContext({"self": extension}))


def test_loaded_models_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: adapt_custom_node_loaded_model",
    ):
        LoadedModelsService(RouteContext({}))


def test_metadata_service_requires_mandatory_route_dependencies():
    with pytest.raises(KeyError, match="Missing route dependency: asyncio"):
        MetadataService(RouteContext({}))


def test_hash_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: FileManagerError",
    ):
        HashService(RouteContext({}))


def test_download_service_requires_mandatory_route_dependencies():
    with pytest.raises(
        KeyError,
        match="Missing route dependency: Aria2InstallError",
    ):
        DownloadService(RouteContext({}))

import pytest

from core.download.dependencies import require_download_dependencies


@pytest.mark.parametrize(
    ("require_dependencies", "message"),
    [
        (require_download_dependencies, "download configuration"),
        (require_download_dependencies, "download directory"),
        (require_download_dependencies, "metadata sidecar"),
        (require_download_dependencies, "Hugging Face Xet"),
        (require_download_dependencies, "aria2 backend"),
        (require_download_dependencies, "preview download"),
    ],
)
def test_download_dependency_guards_preserve_error_and_identity(
    require_dependencies, message
):
    with pytest.raises(
        RuntimeError,
        match=rf"{message} dependencies were not provided",
    ):
        require_dependencies(None, message)

    dependencies = object()
    assert require_dependencies(dependencies, message) is dependencies

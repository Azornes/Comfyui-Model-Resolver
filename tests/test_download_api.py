import importlib


def test_downloader_facade_exports_only_supported_operations():
    facade = importlib.import_module("core.downloader")

    assert set(facade.__all__) == {
        "cancel_download",
        "clear_completed_downloads",
        "download_file",
        "download_model",
        "get_all_progress",
        "get_progress",
        "start_background_download",
    }
    assert not hasattr(facade, "_aria2_rpc")
    assert not hasattr(facade, "write_model_resolver_metadata")

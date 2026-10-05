import json
from unittest.mock import Mock, patch

from core.sources.civitai import get_civitai_image_version_ids, parse_civitai_image_url


def test_image_url_host_and_path_validation():
    assert parse_civitai_image_url("https://civitai.com/images/144201545?foo=bar") == 144201545
    assert parse_civitai_image_url("https://civitai.red/images/123/") == 123
    for url in ("https://civitai.com.evil.test/images/123", "https://civitai.com/models/123", "https://civitai.com/images/0"):
        assert parse_civitai_image_url(url) is None


def test_image_resources_require_matching_image_and_unique_valid_versions():
    payload = {"items": [
        {"id": 9, "modelVersionIds": [999]},
        {"id": 144201545, "meta": None, "modelVersionIds": [3352534, 3356151, 3352534, None, True, -1, "invalid"]},
    ]}
    with patch("core.sources.civitai.execute_provider_json_request", return_value=payload), \
         patch("core.sources.civitai.request_source_response", return_value=None):
        assert get_civitai_image_version_ids(144201545) == [3352534, 3356151]
        assert get_civitai_image_version_ids(100) == []


def image_page(image_id, resources):
    query = {
        "queryKey": [["image", "getGenerationData"], {"input": {"id": image_id}}],
        "state": {"data": {"resources": resources}},
    }
    payload = {"props": {"pageProps": {"trpcState": {"json": {"queries": [query]}}}}}
    return '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(payload) + '</script>'


def test_empty_public_image_resources_fall_back_to_page_generation_data():
    page = image_page(143748745, [
        {"imageId": 143748745, "modelVersionId": 3356151},
        {"imageId": 143748745, "versionId": 3356151},
        {"imageId": 999, "modelVersionId": 123},
        {"modelVersionId": True},
    ])
    with patch("core.sources.civitai.execute_provider_json_request", return_value={
        "items": [{"id": 143748745, "meta": None, "modelVersionIds": []}],
    }), patch("core.sources.civitai.request_source_response", return_value=Mock(status_code=200, text=page)):
        assert get_civitai_image_version_ids(143748745) == [3356151]
        assert get_civitai_image_version_ids(100) == []


def test_image_page_fallback_ignores_malformed_or_unavailable_page():
    for response in (None, Mock(status_code=403, text="blocked"), Mock(status_code=200, text='<script id="__NEXT_DATA__">invalid</script>')):
        with patch("core.sources.civitai.execute_provider_json_request", return_value=None), \
             patch("core.sources.civitai.request_source_response", return_value=response):
            assert get_civitai_image_version_ids(143748745) == []

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import web

from core.routes.context import RouteContext
from core.routes.search_support import register_search_support_routes


class _Routes:
    def __init__(self):
        self.handlers = {}

    def get(self, path):
        def decorator(handler):
            self.handlers[("GET", path)] = handler
            return handler

        return decorator

    def post(self, path):
        def decorator(handler):
            self.handlers[("POST", path)] = handler
            return handler

        return decorator


def _json_api_endpoint(_name, **_kwargs):
    return lambda handler: handler


def _request(payload=None, query=None):
    return SimpleNamespace(
        json=AsyncMock(return_value=payload),
        query=query or {},
    )


def _response_json(response):
    return json.loads(response.text)


def _build_routes(overrides=None):
    routes = _Routes()
    extension = SimpleNamespace(
        logger=MagicMock(),
        search_result_timestamps={"old": "timestamp"},
    )
    values = {
        "asyncio": asyncio,
        "check_brave_search_api_key": MagicMock(
            return_value={"valid": True, "provider": "brave"}
        ),
        "check_civitai_api_key": MagicMock(
            return_value={"valid": True, "provider": "civitai"}
        ),
        "check_civitai_session_token": MagicMock(
            return_value={"valid": True, "provider": "civitai-session"}
        ),
        "check_huggingface_token": MagicMock(
            return_value={"valid": True, "provider": "huggingface"}
        ),
        "clear_all_search_caches": MagicMock(),
        "clear_huggingface_search_cache": MagicMock(),
        "get_known_author_fallback_indexes_status": MagicMock(
            return_value={"ready": True}
        ),
        "get_model_list_update_status": MagicMock(
            return_value={"loaded": True}
        ),
        "invalidate_local_hash_match_cache": MagicMock(),
        "invalidate_model_files_cache": MagicMock(),
        "json_api_endpoint": _json_api_endpoint,
        "refresh_known_author_fallback_indexes": MagicMock(
            return_value={"refreshed": True}
        ),
        "reload_model_list": MagicMock(),
        "reload_popular_databases": MagicMock(),
        "routes": routes,
        "self": extension,
        "update_model_list_from_remote": MagicMock(
            return_value={"updated": True}
        ),
        "web": web,
    }
    if overrides:
        values.update(overrides)
    register_search_support_routes(RouteContext(values))
    return routes.handlers, values


@pytest.mark.asyncio
async def test_clear_search_cache_route_clears_all_state():
    handlers, values = _build_routes()

    response = await handlers[("POST", "/model_resolver/clear-search-cache")](
        _request()
    )

    assert response.status == 200
    assert _response_json(response) == {"success": True, "cleared": "all"}
    values["clear_all_search_caches"].assert_called_once_with()
    values["reload_popular_databases"].assert_called_once_with()
    values["reload_model_list"].assert_called_once_with()
    values["invalidate_model_files_cache"].assert_called_once_with()
    values["invalidate_local_hash_match_cache"].assert_called_once_with()
    assert values["self"].search_result_timestamps == {}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "payload_key", "value", "checker"),
    [
        (
            "/model_resolver/civitai/session-token/check",
            "civitai_session_token",
            "session-token",
            "check_civitai_session_token",
        ),
        (
            "/model_resolver/civitai/api-key/check",
            "civitai_key",
            "api-key",
            "check_civitai_api_key",
        ),
        (
            "/model_resolver/huggingface/token/check",
            "hf_token",
            "hf-token",
            "check_huggingface_token",
        ),
        (
            "/model_resolver/brave/api-key/check",
            "brave_search_api_key",
            "brave-key",
            "check_brave_search_api_key",
        ),
    ],
)
async def test_credential_routes_validate_credentials(
    path, payload_key, value, checker
):
    handlers, values = _build_routes()

    response = await handlers[("POST", path)](
        _request({payload_key: value})
    )

    assert response.status == 200
    assert _response_json(response) == values[checker].return_value
    values[checker].assert_called_once_with(value)


@pytest.mark.asyncio
async def test_credential_route_returns_error_when_checker_fails():
    handlers, values = _build_routes(
        {"check_civitai_api_key": MagicMock(side_effect=RuntimeError("boom"))}
    )

    response = await handlers[
        ("POST", "/model_resolver/civitai/api-key/check")
    ](_request({"civitai_key": "bad"}))

    assert response.status == 500
    assert _response_json(response) == {"error": "boom"}
    values["self"].logger.exception.assert_called_once()


@pytest.mark.asyncio
async def test_author_index_routes_refresh_and_clear_huggingface_cache():
    handlers, values = _build_routes()

    status_response = await handlers[
        ("GET", "/model_resolver/huggingface/author-index/status")
    ](_request())
    refresh_response = await handlers[
        ("POST", "/model_resolver/huggingface/author-index/refresh")
    ](_request({"hf_token": "token"}))

    assert _response_json(status_response) == {"ready": True}
    assert _response_json(refresh_response) == {"refreshed": True}
    values["refresh_known_author_fallback_indexes"].assert_called_once_with(
        "token"
    )
    values["clear_huggingface_search_cache"].assert_called_once_with()


@pytest.mark.asyncio
async def test_model_list_routes_forward_remote_check_and_update_caches():
    handlers, values = _build_routes()

    status_response = await handlers[
        ("GET", "/model_resolver/model-list/status")
    ](_request(query={"check_remote": "true"}))
    update_response = await handlers[
        ("POST", "/model_resolver/model-list/update")
    ](_request())

    assert _response_json(status_response) == {"loaded": True}
    assert _response_json(update_response) == {"updated": True}
    values["get_model_list_update_status"].assert_called_once_with(
        check_remote=True
    )
    values["update_model_list_from_remote"].assert_called_once_with()
    assert values["self"].search_result_timestamps == {}
    assert values["clear_all_search_caches"].call_count == 1

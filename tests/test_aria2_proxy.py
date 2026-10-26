"""Unit tests for aria2 proxy resolution and option propagation."""

import os
from types import SimpleNamespace
from unittest.mock import patch

from core.download import aria2_backend


def test_resolve_proxy_url_from_settings():
    facade = SimpleNamespace(
        load_settings=lambda: {"proxy_url": "http://proxy.local:8080"},
        os=os,
    )
    proxy = aria2_backend.resolve_proxy_url(dependencies=facade)
    assert proxy == "http://proxy.local:8080"


def test_resolve_proxy_url_from_env():
    facade = SimpleNamespace(
        load_settings=lambda: {},
        os=SimpleNamespace(
            environ={"ALL_PROXY": "socks5://127.0.0.1:1080"}
        ),
    )
    proxy = aria2_backend.resolve_proxy_url(dependencies=facade)
    assert proxy == "socks5://127.0.0.1:1080"


def test_resolve_proxy_url_from_https_proxy_env():
    facade = SimpleNamespace(
        load_settings=lambda: {},
        os=SimpleNamespace(
            environ={"HTTPS_PROXY": "http://corp-proxy:3128"}
        ),
    )
    proxy = aria2_backend.resolve_proxy_url(dependencies=facade)
    assert proxy == "http://corp-proxy:3128"


def test_resolve_proxy_url_none():
    facade = SimpleNamespace(
        load_settings=lambda: {},
        os=SimpleNamespace(environ={}),
    )
    with patch("urllib.request.getproxies", return_value={}):
        proxy = aria2_backend.resolve_proxy_url(dependencies=facade)
        assert proxy == ""

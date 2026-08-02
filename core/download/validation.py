"""Validation and sanitization helpers for model downloads."""

import os
import re
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from ..network_utils import host_matches_domain
from ..path_utils import get_filename_from_path
from ..type_utils import DEFAULT_BROWSER_USER_AGENT, MODEL_EXTENSIONS

DOWNLOAD_USER_AGENT = DEFAULT_BROWSER_USER_AGENT

SENSITIVE_METADATA_KEYS = {
    "authorization",
    "headers",
    "hf_token",
    "civitai_key",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "session",
    "session_token",
    "cookie",
    "cookies",
}

SENSITIVE_QUERY_KEYS = {
    "authorization",
    "auth",
    "hf_token",
    "civitai_key",
    "api_key",
    "apikey",
    "access_token",
    "token",
    "session",
    "sessionid",
    "cookie",
}

_INVALID_DOWNLOAD_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_HTTP_URL_IN_TEXT_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)


def sanitize_download_filename(filename: Any) -> str:
    """Return a safe basename for a downloaded model file."""
    text = get_filename_from_path(str(filename or "")).strip()
    text = _INVALID_DOWNLOAD_FILENAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    if text in {"", ".", ".."}:
        return ""
    return text


def is_allowed_model_download_filename(filename: Any) -> bool:
    """Return True only for model file extensions supported by the resolver."""
    safe_name = sanitize_download_filename(filename)
    return bool(safe_name and os.path.splitext(safe_name)[1].lower() in MODEL_EXTENSIONS)


def _is_sensitive_metadata_key(key: Any) -> bool:
    key_text = str(key or "").strip().lower()
    return (
        key_text in SENSITIVE_METADATA_KEYS
        or "token" in key_text
        or "authorization" in key_text
        or "cookie" in key_text
    )


def _strip_sensitive_url_params(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.query:
        return value

    filtered = []
    changed = False
    for key, item_value in parse_qsl(parsed.query, keep_blank_values=True):
        key_lower = key.lower()
        if key_lower in SENSITIVE_QUERY_KEYS or "token" in key_lower:
            changed = True
            continue
        filtered.append((key, item_value))

    if not changed:
        return value
    return urlunparse(parsed._replace(query=urlencode(filtered, doseq=True)))


def _sanitize_download_error(value: Any) -> str:
    """Remove signed query strings and credentials from errors shown or logged."""
    text = str(value or "")

    def redact_url(match: re.Match) -> str:
        raw_url = match.group(0)
        try:
            parsed = urlparse(raw_url)
            if parsed.query:
                return urlunparse(parsed._replace(query="", fragment=""))
        except Exception:
            pass
        return raw_url

    return _HTTP_URL_IN_TEXT_RE.sub(redact_url, text)


def _clean_http_header_value(value: Any) -> str:
    return str(value or "").replace("\r", "").replace("\n", "").strip()


def _get_header_value(headers: Dict[str, str], key: str) -> str:
    key_lower = key.lower()
    for existing_key, value in headers.items():
        if str(existing_key).lower() == key_lower:
            return str(value or "")
    return ""


def _set_header_default(headers: Dict[str, str], key: str, value: str) -> None:
    if not _get_header_value(headers, key):
        headers[key] = value


def build_download_headers(
    url: str,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Build request headers shared by the Python and aria2 download backends."""
    request_headers: Dict[str, str] = {}
    for key, value in (headers or {}).items():
        clean_key = _clean_http_header_value(key)
        clean_value = _clean_http_header_value(value)
        if clean_key and clean_value:
            request_headers[clean_key] = clean_value

    _set_header_default(request_headers, "User-Agent", DOWNLOAD_USER_AGENT)
    _set_header_default(request_headers, "Accept", "*/*")
    _set_header_default(request_headers, "Accept-Encoding", "identity")

    host = urlparse(str(url or "")).hostname
    if host_matches_domain(host, "civitai.com", "civitai.red"):
        _set_header_default(request_headers, "Referer", "https://civitai.com/")
        _set_header_default(request_headers, "Origin", "https://civitai.com")

    return request_headers

"""Network security helpers for outbound HTTP requests."""

from __future__ import annotations

import ipaddress
import socket
from typing import Any, Dict, Iterable, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

import requests

REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
SENSITIVE_REDIRECT_HEADERS = {"authorization", "cookie", "proxy-authorization"}


class UnsafeUrlError(ValueError):
    """Raised when an outbound URL could access a non-public network target."""


def host_matches_domain(host: Any, *domains: str) -> bool:
    """Return True for an exact domain or one of its real DNS subdomains."""
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return False
    for domain in domains:
        normalized_domain = str(domain or "").strip().lower().rstrip(".")
        if normalized_domain and (
            normalized_host == normalized_domain
            or normalized_host.endswith(f".{normalized_domain}")
        ):
            return True
    return False


def _is_public_ip(address: str) -> bool:
    try:
        parsed = ipaddress.ip_address(str(address).split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
        parsed = parsed.ipv4_mapped
    return bool(parsed.is_global)


def validate_public_http_url(url: Any) -> str:
    """Validate an HTTP(S) URL and reject local, private, or reserved targets."""
    text = str(url or "").strip()
    if not text or len(text) > 8192:
        raise UnsafeUrlError("A valid download URL is required")

    try:
        parsed = urlparse(text)
        port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError("The download URL is malformed") from exc

    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeUrlError("Only http and https download URLs are supported")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeUrlError("Credentials embedded in download URLs are not allowed")

    host = str(parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        raise UnsafeUrlError("The download URL must include a hostname")
    if host_matches_domain(host, "localhost"):
        raise UnsafeUrlError("Localhost download URLs are not allowed")

    try:
        direct_ip = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        direct_ip = None

    if direct_ip is not None:
        if not _is_public_ip(str(direct_ip)):
            raise UnsafeUrlError("Private, local, and reserved download addresses are not allowed")
        return text

    try:
        ascii_host = host.encode("idna").decode("ascii")
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                ascii_host,
                port or (443 if parsed.scheme.lower() == "https" else 80),
                type=socket.SOCK_STREAM,
            )
            if item and len(item) > 4 and item[4]
        }
    except (OSError, UnicodeError) as exc:
        raise UnsafeUrlError("The download hostname could not be resolved") from exc

    if not addresses:
        raise UnsafeUrlError("The download hostname did not resolve to an address")
    if any(not _is_public_ip(address) for address in addresses):
        raise UnsafeUrlError("Private, local, and reserved download addresses are not allowed")
    return text


def _url_origin(url: str) -> Tuple[str, str, int]:
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    port = parsed.port or (443 if scheme == "https" else 80)
    return scheme, str(parsed.hostname or "").lower().rstrip("."), port


def _normalize_hosts(hosts: Optional[Iterable[str]]) -> Set[str]:
    return {
        str(host or "").strip().lower().rstrip(".")
        for host in (hosts or ())
        if str(host or "").strip()
    }


def _redirect_headers(
    headers: Dict[str, str],
    source_url: str,
    target_url: str,
    *,
    trusted_sensitive_redirect_hosts: Optional[Iterable[str]] = None,
    trusted_sensitive_redirect_headers: Optional[Iterable[str]] = None,
) -> Dict[str, str]:
    if _url_origin(source_url) == _url_origin(target_url):
        return dict(headers)

    target_host = _url_origin(target_url)[1]
    trusted_hosts = _normalize_hosts(trusted_sensitive_redirect_hosts)
    allowed_sensitive_headers = {
        str(header or "").strip().lower()
        for header in (trusted_sensitive_redirect_headers or ())
        if str(header or "").strip()
    }
    preserve_for_target = target_host in trusted_hosts
    return {
        key: value
        for key, value in headers.items()
        if (
            str(key).lower() not in SENSITIVE_REDIRECT_HEADERS
            or (
                preserve_for_target
                and str(key).lower() in allowed_sensitive_headers
            )
        )
    }


def request_public_url(
    method: str,
    url: Any,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: Any = 30,
    stream: bool = True,
    max_redirects: int = 5,
    trusted_sensitive_redirect_hosts: Optional[Iterable[str]] = None,
    trusted_sensitive_redirect_headers: Optional[Iterable[str]] = None,
) -> Tuple[requests.Response, str, Dict[str, str]]:
    """Perform a GET/HEAD request while validating every redirect target."""
    current_url = validate_public_http_url(url)
    current_headers = dict(headers or {})
    request_method = str(method or "GET").upper()
    if request_method not in {"GET", "HEAD"}:
        raise ValueError("request_public_url supports only GET and HEAD")

    for redirect_count in range(max_redirects + 1):
        request_func = requests.head if request_method == "HEAD" else requests.get
        response = request_func(
            current_url,
            headers=current_headers,
            allow_redirects=False,
            stream=stream,
            timeout=timeout,
        )
        if response.status_code not in REDIRECT_STATUS_CODES:
            return response, current_url, current_headers

        location = response.headers.get("Location") or response.headers.get("location")
        if not location:
            return response, current_url, current_headers
        if redirect_count >= max_redirects:
            response.close()
            raise UnsafeUrlError("The download URL has too many redirects")

        candidate_url = urljoin(current_url, str(location).strip())
        try:
            next_url = validate_public_http_url(candidate_url)
        except UnsafeUrlError:
            response.close()
            raise
        next_headers = _redirect_headers(
            current_headers,
            current_url,
            next_url,
            trusted_sensitive_redirect_hosts=trusted_sensitive_redirect_hosts,
            trusted_sensitive_redirect_headers=trusted_sensitive_redirect_headers,
        )
        response.close()
        current_url = next_url
        current_headers = next_headers

    raise UnsafeUrlError("The download URL has too many redirects")


def request_source_response(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
    max_attempts: int = 2,
    log_name: str = "Source API",
) -> Optional[requests.Response]:
    """Perform a GET/POST request with retry logic for rate limit status (HTTP 429)."""
    import time

    from .log_system import create_module_logger
    log = create_module_logger(__name__)

    request_params = {k: v for k, v in (params or {}).items() if v is not None}
    response = None

    for attempt in range(max_attempts):
        try:
            if method.upper() == "POST":
                response = requests.post(url, json=request_params, headers=headers, timeout=timeout)
            else:
                response = requests.get(url, params=request_params, headers=headers, timeout=timeout)
        except Exception as e:
            log.warning(f"{log_name} request failed: url={url}, error={e}")
            return None

        if response.status_code != 429 or attempt == max_attempts - 1:
            break

        retry_after = response.headers.get("Retry-After")
        try:
            delay = float(retry_after) if retry_after else 1.2
        except (TypeError, ValueError):
            delay = 1.2
        time.sleep(max(0.5, min(delay, 3.0)))

    return response


def request_source_json(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
    max_attempts: int = 2,
    log_name: str = "Source API",
    raise_on_error: bool = False,
) -> Any:
    """Perform a GET/POST request and return any parsed JSON payload or ``None``."""
    response = request_source_response(
        url,
        method=method,
        headers=headers,
        params=params,
        timeout=timeout,
        max_attempts=max_attempts,
        log_name=log_name,
    )
    if response is None:
        if raise_on_error:
            raise ValueError(f"{log_name} request failed: no response")
        return None

    if response.status_code != 200:
        from .log_system import create_module_logger
        log = create_module_logger(__name__)
        log.debug(f"{log_name} returned HTTP {response.status_code}: url={url}")
        if raise_on_error:
            response.raise_for_status()
        return None

    try:
        return response.json()
    except Exception as e:
        from .log_system import create_module_logger
        log = create_module_logger(__name__)
        log.warning(f"{log_name} JSON parse failed: url={url}, error={e}")
        if raise_on_error:
            raise
        return None


def fetch_json_from_public_url(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30,
) -> Dict[str, Any]:
    """
    Convenience wrapper to fetch and parse JSON from a public HTTP(S) URL.
    """
    res = request_source_json(url, headers=headers, timeout=timeout, raise_on_error=True)
    if not isinstance(res, dict):
        raise ValueError(f"URL did not return a valid JSON object: {url}")
    return res


def execute_provider_json_request(
    provider_name: str,
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    api_key: Optional[str] = None,
    session_token: Optional[str] = None,
    timeout: int = 20,
    max_attempts: int = 2,
    raise_on_error: bool = False,
) -> Any:
    """
    Execute an outbound JSON request and return any parsed JSON payload.

    Provider APIs may return either objects or arrays. Callers that require a
    specific shape must validate the returned value before using it.
    """
    from .type_utils import DEFAULT_BROWSER_USER_AGENT

    req_headers = {"User-Agent": DEFAULT_BROWSER_USER_AGENT, "Accept": "application/json"}
    if headers:
        req_headers.update(headers)

    token = str(api_key or "").strip()
    if token and "Authorization" not in req_headers:
        req_headers["Authorization"] = f"Bearer {token}"

    sess_token = str(session_token or "").strip()
    if sess_token and "Cookie" not in req_headers:
        req_headers["Cookie"] = f"__Secure-civ-token={sess_token}; __Secure-civitai-token={sess_token}"

    return request_source_json(
        url,
        method=method,
        headers=req_headers,
        params=params,
        timeout=timeout,
        max_attempts=max_attempts,
        log_name=provider_name,
        raise_on_error=raise_on_error,
    )




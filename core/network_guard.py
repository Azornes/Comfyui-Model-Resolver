"""Network rate limiting and connectivity guard utilities."""

from __future__ import annotations

import email.utils
import socket
import threading
import time
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import requests

from .log_system import create_module_logger

log = create_module_logger("core.network_guard")

DEFAULT_RETRY_AFTER_SECONDS = 60
MAX_RETRY_AFTER_SECONDS = 3600


def normalize_destination(url_or_host: Any) -> str:
    """Extract and normalize hostname from a URL or raw hostname string."""
    text = str(url_or_host or "").strip().lower()
    if not text:
        return "__global__"
    if "://" in text:
        try:
            parsed = urlparse(text)
            host = (parsed.hostname or "").strip().lower().rstrip(".")
            if host:
                return host
        except Exception:
            pass
    # Raw host or host:port
    candidate = text.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0].strip().rstrip(".")
    return candidate or "__global__"


def parse_retry_after(value: Any, default: int | float = DEFAULT_RETRY_AFTER_SECONDS) -> int | float:
    """Parse HTTP Retry-After header into seconds.

    Supports integer or float seconds (e.g. "120", "1.5") and HTTP-date formats (RFC 2822 / RFC 7231).
    """
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default

    # Try numeric seconds
    try:
        val = float(text)
        if val <= 0:
            return 1
        clamped = min(val, float(MAX_RETRY_AFTER_SECONDS))
        return int(clamped) if clamped.is_integer() else clamped
    except ValueError:
        pass

    # Try HTTP date
    try:
        parsed_tuple = email.utils.parsedate_tz(text)
        if parsed_tuple is not None:
            timestamp = email.utils.mktime_tz(parsed_tuple)
            delta = timestamp - time.time()
            return max(1, min(int(delta), MAX_RETRY_AFTER_SECONDS))
    except Exception:
        pass

    return default


class RateLimitCoordinator:
    """Thread-safe coordinator for domain-level HTTP 429 rate limit cooldowns."""

    _instance: Optional[RateLimitCoordinator] = None
    _singleton_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> RateLimitCoordinator:
        """Retrieve the global RateLimitCoordinator instance."""
        with cls._singleton_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cooldowns: Dict[str, float] = {}
        self._reasons: Dict[str, str] = {}

    def register_rate_limit(
        self,
        target: Any,
        retry_after: int | float | str | None = None,
        reason: Optional[str] = None,
    ) -> int | float:
        """Register a rate limit cooldown for the target's destination domain."""
        dest = normalize_destination(target)
        seconds = parse_retry_after(retry_after)
        expiry = time.time() + seconds

        with self._lock:
            # If an existing longer cooldown is still active, retain the max
            current_expiry = self._cooldowns.get(dest, 0.0)
            if expiry > current_expiry:
                self._cooldowns[dest] = expiry
                self._reasons[dest] = str(reason or "Rate limit exceeded (HTTP 429)")

        log.warning(
            f"Rate limit cooldown registered for {dest}: {seconds}s "
            f"({reason or 'HTTP 429'})"
        )
        return seconds

    def get_cooldown(self, target: Any) -> float:
        """Return remaining seconds of cooldown for target, or 0.0 if not rate limited."""
        dest = normalize_destination(target)
        now = time.time()
        with self._lock:
            expiry = self._cooldowns.get(dest, 0.0)
            if expiry <= now:
                self._cooldowns.pop(dest, None)
                self._reasons.pop(dest, None)
                return 0.0
            return expiry - now

    def is_rate_limited(self, target: Any) -> bool:
        """Return True if the target destination is currently in a cooldown."""
        return self.get_cooldown(target) > 0.0

    def get_reason(self, target: Any) -> Optional[str]:
        """Return the reason recorded for the rate limit cooldown, if any."""
        dest = normalize_destination(target)
        if not self.is_rate_limited(dest):
            return None
        with self._lock:
            return self._reasons.get(dest)

    def wait_if_needed(self, target: Any, max_wait: float = 3.0) -> bool:
        """Wait if cooldown is active and shorter than max_wait.

        Returns True if not rate limited (or wait succeeded), False if cooldown exceeds max_wait.
        """
        cooldown = self.get_cooldown(target)
        if cooldown <= 0:
            return True
        if cooldown <= max_wait:
            time.sleep(cooldown)
            return True
        return False

    def clear(self, target: Optional[Any] = None) -> None:
        """Clear rate limit cooldown for a specific destination or all destinations."""
        with self._lock:
            if target is None:
                self._cooldowns.clear()
                self._reasons.clear()
            else:
                dest = normalize_destination(target)
                self._cooldowns.pop(dest, None)
                self._reasons.pop(dest, None)


class ConnectivityGuard:
    """Thread-safe circuit breaker to suppress repeated network calls when offline."""

    _instance: Optional[ConnectivityGuard] = None
    _singleton_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> ConnectivityGuard:
        """Retrieve the global ConnectivityGuard instance."""
        with cls._singleton_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(
        self,
        *,
        failure_threshold: int = 3,
        base_backoff: float = 15.0,
        max_backoff: float = 300.0,
    ) -> None:
        self._lock = threading.Lock()
        self.failure_threshold = failure_threshold
        self.base_backoff = base_backoff
        self.max_backoff = max_backoff
        self._consecutive_failures: Dict[str, int] = {}
        self._offline_until: Dict[str, float] = {}

    def _is_transport_error(self, error: Any) -> bool:
        """Determine if an exception represents network unreachability / transport failure."""
        if error is None:
            return False
        if isinstance(
            error,
            (
                socket.gaierror,
                requests.exceptions.ConnectionError,
                requests.exceptions.ConnectTimeout,
                ConnectionRefusedError,
                ConnectionResetError,
                OSError,
            ),
        ):
            # Exclude HTTP status errors wrapped in requests (e.g. 404, 500)
            return not isinstance(error, requests.exceptions.HTTPError)
        error_str = str(error).lower()
        return any(
            marker in error_str
            for marker in (
                "getaddrinfo failed",
                "name or service not known",
                "network is unreachable",
                "connection refused",
                "no route to host",
                "failed to establish a new connection",
                "connection timed out",
            )
        )

    def record_failure(self, target: Any, error: Optional[Exception] = None) -> bool:
        """Record a failure for the destination. Returns True if guard activated."""
        if error is not None and not self._is_transport_error(error):
            return False

        dest = normalize_destination(target)
        now = time.time()
        with self._lock:
            count = self._consecutive_failures.get(dest, 0) + 1
            self._consecutive_failures[dest] = count

            if count >= self.failure_threshold:
                multiplier = 2 ** min(count - self.failure_threshold, 4)
                backoff = min(self.base_backoff * multiplier, self.max_backoff)
                self._offline_until[dest] = now + backoff
                log.warning(
                    f"ConnectivityGuard activated for {dest}: {count} consecutive failures. "
                    f"Entering offline cooldown for {backoff:.1f}s."
                )
                return True
        return False

    def record_success(self, target: Any) -> None:
        """Reset consecutive failures and clear offline status for destination."""
        dest = normalize_destination(target)
        with self._lock:
            self._consecutive_failures.pop(dest, None)
            self._offline_until.pop(dest, None)

    def is_offline(self, target: Any) -> bool:
        """Return True if destination is currently in offline cooldown."""
        dest = normalize_destination(target)
        now = time.time()
        with self._lock:
            # Check destination-specific or global offline state
            for key in (dest, "__global__"):
                offline_until = self._offline_until.get(key, 0.0)
                if offline_until > now:
                    return True
                elif key in self._offline_until:
                    self._offline_until.pop(key, None)
                    self._consecutive_failures.pop(key, None)
        return False

    def get_offline_cooldown(self, target: Any) -> float:
        """Return remaining seconds in offline cooldown for target, or 0.0."""
        dest = normalize_destination(target)
        now = time.time()
        with self._lock:
            remaining = 0.0
            for key in (dest, "__global__"):
                offline_until = self._offline_until.get(key, 0.0)
                if offline_until > now:
                    remaining = max(remaining, offline_until - now)
                elif key in self._offline_until:
                    self._offline_until.pop(key, None)
                    self._consecutive_failures.pop(key, None)
            return remaining

    def clear(self) -> None:
        """Clear all failure counters and cooldowns."""
        with self._lock:
            self._consecutive_failures.clear()
            self._offline_until.clear()


def get_rate_limit_coordinator() -> RateLimitCoordinator:
    """Public helper to get the RateLimitCoordinator singleton."""
    return RateLimitCoordinator.get_instance()


def get_connectivity_guard() -> ConnectivityGuard:
    """Public helper to get the ConnectivityGuard singleton."""
    return ConnectivityGuard.get_instance()

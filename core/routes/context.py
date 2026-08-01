"""Dependency container shared by route registration modules."""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any


@dataclass(frozen=True, slots=True)
class RouteContext:
    """Immutable, read-only collection of dependencies used by API routes."""

    _values: Mapping[str, Any]

    def __post_init__(self):
        object.__setattr__(
            self,
            "_values",
            MappingProxyType(dict(self._values)),
        )

    @classmethod
    def from_namespaces(
        cls,
        *namespaces: Mapping[str, Any],
    ) -> "RouteContext":
        """Build a context, with later namespaces taking precedence."""
        values = {}
        for namespace in namespaces:
            values.update(namespace)
        return cls(values)

    def get(self, key: str, default: Any = None) -> Any:
        """Return a dependency or the supplied default when it is optional."""
        return self._values.get(key, default)

    def require(self, key: str) -> Any:
        """Return a dependency or fail with a descriptive configuration error."""
        try:
            return self._values[key]
        except KeyError as exc:
            raise KeyError(f"Missing route dependency: {key}") from exc

    def __contains__(self, key: str) -> bool:
        return key in self._values

    def __len__(self) -> int:
        return len(self._values)

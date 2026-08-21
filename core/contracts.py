"""Canonical internal data contracts used across Model Resolver features.

The HTTP API intentionally continues to expose dictionaries. These immutable
dataclasses are used at feature boundaries so provider-specific payloads and
workflow requests are validated once, while ``to_dict``/``to_kwargs`` keep the
existing compatibility contracts intact.
"""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Any, Dict, List, Optional, Sequence, Tuple


def _freeze_value(value: Any) -> Any:
    """Recursively freeze JSON-like values stored inside a contract."""
    if isinstance(value, Mapping):
        return MappingProxyType(
            {key: _freeze_value(item) for key, item in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, (set, frozenset)):
        return tuple(_freeze_value(item) for item in value)
    return value


def _thaw_value(value: Any) -> Any:
    """Convert frozen contract values back to JSON-compatible containers."""
    if isinstance(value, Mapping):
        return {key: _thaw_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_thaw_value(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return [_thaw_value(item) for item in value]
    return value


def _as_contract_float(value: Any, name: str, default: float = 0.0) -> float:
    """Normalize a canonical finite float without hiding malformed values."""
    if value is None:
        return default
    if isinstance(value, bool):
        raise TypeError(f"{name} must be a finite number")
    try:
        converted = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(converted):
        raise ValueError(f"{name} must be a finite number")
    return converted


def _as_optional_bool(value: Any, name: str = "boolean") -> Optional[bool]:
    """Normalize an optional boolean while rejecting unknown representations."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise ValueError(f"{name} must be a boolean")


def _as_contract_bool(
    value: Any,
    name: str,
) -> bool:
    """Normalize a canonical boolean while rejecting unknown representations."""
    normalized = _as_optional_bool(value, name)
    if normalized is None:
        raise ValueError(f"{name} must be a boolean")
    return normalized


def _as_contract_text(value: Any, name: str, default: str = "") -> str:
    """Normalize a canonical text field without stringifying invalid values."""
    if value is None:
        return default
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _as_optional_contract_text(value: Any, name: str) -> Optional[str]:
    """Normalize an optional canonical text field without string coercion."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value or None


def _as_nullable_contract_text(value: Any, name: str) -> Optional[str]:
    """Validate an optional canonical text field while preserving empty strings."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _as_contract_identifier(value: Any, name: str) -> int | str | None:
    """Normalize an optional model/node identifier without accepting booleans."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise TypeError(f"{name} must be an integer or string")
    if isinstance(value, str):
        return value.strip() or None
    return value


def _as_optional_provider_int(value: Any, name: str) -> Optional[int]:
    """Normalize a provider numeric identifier without accepting arbitrary values."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise TypeError(f"{name} must be an integer")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return int(text)
        except ValueError as exc:
            raise ValueError(f"{name} must be an integer") from exc
    raise TypeError(f"{name} must be an integer")


def _as_optional_non_negative_int(value: Any, name: str) -> Optional[int]:
    """Validate an optional non-negative integer field."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be a non-negative integer")
    if value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


_SIZE_UNIT_MULTIPLIERS = {
    "b": 1,
    "kb": 1024,
    "kib": 1024,
    "mb": 1024**2,
    "mib": 1024**2,
    "gb": 1024**3,
    "gib": 1024**3,
    "tb": 1024**4,
    "tib": 1024**4,
}
_SIZE_LABEL_PATTERN = re.compile(
    r"^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)?$",
    re.IGNORECASE,
)


def _as_size_bytes(value: Any) -> Optional[int]:
    """Normalize numeric and human-readable sizes to bytes."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)) or value < 0:
            return None
        return int(value)
    if not isinstance(value, str):
        return None

    match = _SIZE_LABEL_PATTERN.fullmatch(value.strip())
    if not match:
        return None
    amount = float(match.group(1))
    multiplier = _SIZE_UNIT_MULTIPLIERS.get((match.group(2) or "b").lower(), 1)
    return int(amount * multiplier)


def _require_mapping(value: Any, name: str) -> Dict[str, Any]:
    """Return a mutable mapping copy or reject malformed contract input."""
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    return dict(value)


def _as_contract_mapping(value: Any, name: str) -> Dict[str, Any]:
    """Normalize an optional canonical mapping without discarding invalid values."""
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    return dict(value)


def _as_contract_sequence(value: Any, name: str) -> Tuple[Any, ...]:
    """Normalize an optional canonical array without discarding invalid values."""
    if value is None:
        return ()
    if not isinstance(value, (list, tuple)):
        raise TypeError(f"{name} must be an array")
    return tuple(value)


def _as_contract_size(value: Any, name: str) -> Optional[int]:
    """Normalize a canonical finite byte size while rejecting malformed values."""
    if value is None:
        return None
    normalized = _as_size_bytes(value)
    if normalized is None:
        raise ValueError(f"{name} must be a non-negative size")
    return normalized


def _require_string_mapping(value: Any, name: str) -> Dict[str, str]:
    """Return a mapping with string keys and values or reject malformed input."""
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    if any(
        not isinstance(key, str) or not isinstance(item, str)
        for key, item in value.items()
    ):
        raise TypeError(f"{name} must contain only string keys and values")
    return dict(value)


def _require_non_negative_int(value: Any, name: str) -> int:
    """Return a non-negative integer or reject malformed contract input."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be a non-negative integer")
    if value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def _download_text_from_mapping(
    raw: Mapping[str, Any],
    field_name: str,
    aliases: Sequence[str] = (),
) -> str:
    """Read a download text field without bypassing invalid falsey values."""
    return _contract_text_from_mapping(
        raw,
        field_name,
        aliases,
        contract_name="DownloadSpec",
    )


def _contract_text_from_mapping(
    raw: Mapping[str, Any],
    field_name: str,
    aliases: Sequence[str] = (),
    *,
    contract_name: str,
) -> str:
    """Read a canonical text field without bypassing invalid falsey values."""
    for key in (field_name, *aliases):
        if key not in raw:
            continue
        value = raw[key]
        if value is None:
            continue
        if not isinstance(value, str):
            raise TypeError(f"{contract_name} {key} must be a string")
        if value.strip():
            return value
    return ""


def _first_provider_value(
    raw: Mapping[str, Any],
    keys: Sequence[str],
) -> Any:
    """Read the first meaningful provider value without truthiness fallback."""
    for key in keys:
        if key not in raw:
            continue
        value = raw[key]
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _first_provider_value_preserving_empty(
    raw: Mapping[str, Any],
    keys: Sequence[str],
) -> Any:
    """Read the first present provider value, including explicit empty text."""
    for key in keys:
        if key not in raw or raw[key] is None:
            continue
        return raw[key]
    return None


def _provider_text(
    raw: Mapping[str, Any],
    keys: Sequence[str],
    *,
    field_name: str,
    contract_name: str = "SearchResult",
) -> str:
    """Validate a provider text alias at the external boundary."""
    value = _first_provider_value(raw, keys)
    return _as_contract_text(value, f"{contract_name} {field_name}")


def _provider_optional_text(
    raw: Mapping[str, Any],
    keys: Sequence[str],
    *,
    field_name: str,
    contract_name: str = "SearchResult",
) -> Optional[str]:
    """Validate an optional provider text alias explicitly."""
    value = _first_provider_value(raw, keys)
    return _as_nullable_contract_text(value, f"{contract_name} {field_name}")


def _is_contract_instance(value: Any, expected_type: Any) -> bool:
    """Accept a contract loaded through a second package-module alias."""
    return isinstance(value, expected_type) or (
        value.__class__.__name__ == expected_type.__name__
        and callable(getattr(value, "to_dict", None))
    )


_MODEL_REFERENCE_CANONICAL_KEYS = frozenset(
    {
        "node_id",
        "node_type",
        "widget_index",
        "original_path",
        "category",
        "exists",
        "subgraph_id",
        "is_top_level",
    }
)
_MODEL_REFERENCE_BOOLEAN_EXTRA_KEYS = frozenset(
    {
        "active",
        "auto_download_capable",
        "auto_download_candidate",
        "connected",
        "input_choice_matches_value",
        "is_legacy_lora_manager",
        "is_lora_v2",
        "is_urn",
        "locate_is_top_level",
        "locate_via_promoted_widget",
    }
)
_MODEL_REFERENCE_TEXT_EXTRA_KEYS = frozenset(
    {
        "custom_node_adapter",
        "custom_node_original_identity",
        "expected_filename",
        "filename",
        "full_path",
        "hash_lookup_source",
        "name",
        "widget_name",
        "workflow_sha256",
    }
)
_RESOLVED_MODEL_CANONICAL_KEYS = frozenset(
    {
        "path",
        "filename",
        "relative_path",
        "category",
        "base_directory",
    }
)
_RESOLVED_MODEL_INPUT_KEYS = _RESOLVED_MODEL_CANONICAL_KEYS | {
    "resolved_path",
    "name",
}
_MISSING_MODEL_RESERVED_KEYS = _MODEL_REFERENCE_CANONICAL_KEYS | {
    "reference_count",
    "all_node_refs",
    "matches",
}
_SEARCH_RESULT_INPUT_KEYS = frozenset(
    {
        "source",
        "model_id",
        "modelId",
        "model_name",
        "modelName",
        "version_id",
        "versionId",
        "modelVersionId",
        "name",
        "version_name",
        "versionName",
        "type",
        "model_type",
        "filename",
        "file_name",
        "fileName",
        "url",
        "page_url",
        "download_url",
        "downloadUrl",
        "downloadURL",
        "size",
        "size_bytes",
        "sizeKB",
        "base_model",
        "baseModel",
        "tags",
        "match_type",
        "confidence",
        "sha256",
        "hash",
        "hashes",
        "trained_words",
        "trainedWords",
        "images",
        "details_source",
        "version_url",
        "versionUrl",
        "custom_url",
        "result_mode",
        "SHA256",
    }
)
_SEARCH_RESULT_RESERVED_EXTRA_KEYS = _SEARCH_RESULT_INPUT_KEYS - {"hash"}


@dataclass(frozen=True, slots=True)
class ModelReference:
    """Stable identity for a model reference extracted from a workflow."""

    node_id: int | str | None = None
    node_type: str = ""
    widget_index: Optional[int] = None
    original_path: str = ""
    category: str = ""
    exists: bool = False
    subgraph_id: Optional[str] = None
    is_top_level: Optional[bool] = None
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "node_id",
            _as_contract_identifier(self.node_id, "ModelReference node_id"),
        )
        object.__setattr__(
            self,
            "widget_index",
            _as_optional_non_negative_int(
                self.widget_index,
                "ModelReference widget_index",
            ),
        )
        object.__setattr__(
            self,
            "node_type",
            _as_contract_text(self.node_type, "ModelReference node_type"),
        )
        object.__setattr__(
            self,
            "original_path",
            _as_contract_text(self.original_path, "ModelReference original_path"),
        )
        object.__setattr__(
            self,
            "category",
            _as_contract_text(self.category, "ModelReference category"),
        )
        object.__setattr__(
            self,
            "subgraph_id",
            _as_optional_contract_text(
                self.subgraph_id,
                "ModelReference subgraph_id",
            ),
        )
        object.__setattr__(
            self,
            "exists",
            _as_contract_bool(self.exists, "ModelReference exists"),
        )
        object.__setattr__(
            self,
            "is_top_level",
            _as_optional_bool(self.is_top_level, "ModelReference is_top_level"),
        )
        normalized_extra = {}
        for key, item in _as_contract_mapping(
            self.extra,
            "ModelReference extra",
        ).items():
            if key in _MODEL_REFERENCE_BOOLEAN_EXTRA_KEYS:
                normalized_extra[key] = _as_contract_bool(
                    item,
                    f"ModelReference {key}",
                )
            elif key in _MODEL_REFERENCE_TEXT_EXTRA_KEYS:
                normalized_extra[key] = _as_nullable_contract_text(
                    item,
                    f"ModelReference {key}",
                )
            else:
                normalized_extra[key] = item
        object.__setattr__(
            self,
            "extra",
            _freeze_value(
                {
                    key: item
                    for key, item in normalized_extra.items()
                    if key not in _MODEL_REFERENCE_CANONICAL_KEYS
                }
            ),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ModelReference":
        """Build a reference from the existing workflow-reference dictionary."""
        raw = _require_mapping(value, "ModelReference")
        reference = cls(
            node_id=raw.get("node_id"),
            node_type=raw.get("node_type"),
            widget_index=raw.get("widget_index"),
            original_path=raw.get("original_path"),
            category=raw.get("category"),
            exists=_as_contract_bool(
                raw.get("exists", False),
                "ModelReference exists",
            ),
            subgraph_id=raw.get("subgraph_id"),
            is_top_level=_as_optional_bool(
                raw.get("is_top_level"),
                "ModelReference is_top_level",
            ),
            extra={
                key: item
                for key, item in raw.items()
                if key not in _MODEL_REFERENCE_CANONICAL_KEYS
            },
        )
        if not (
            reference.node_id is not None
            or reference.original_path
            or reference.extra_value("full_path")
            or reference.extra_value("filename")
            or reference.extra_value("name")
            or reference.extra_value("expected_filename")
        ):
            raise ValueError("ModelReference requires a node or model identity")
        return reference

    def with_updates(self, **values: Any) -> "ModelReference":
        """Return a typed reference with canonical or provider-specific fields updated."""
        canonical_updates = {
            key: value
            for key, value in values.items()
            if key in _MODEL_REFERENCE_CANONICAL_KEYS
        }
        extra = {
            key: value
            for key, value in self.extra.items()
            if key not in _MODEL_REFERENCE_CANONICAL_KEYS
        }
        extra.update(
            {
                key: value
                for key, value in values.items()
                if key not in _MODEL_REFERENCE_CANONICAL_KEYS
            }
        )
        return replace(self, extra=extra, **canonical_updates)

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read a workflow-specific field without treating the contract as a loose dict."""
        return self.extra.get(key, default)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the canonical fields while preserving provider/node extras."""
        result = _thaw_value(self.extra)
        result.update(
            {
                "node_id": self.node_id,
                "node_type": self.node_type,
                "widget_index": self.widget_index,
                "original_path": self.original_path,
                "category": self.category,
                "exists": self.exists,
            }
        )
        if self.subgraph_id is not None:
            result["subgraph_id"] = self.subgraph_id
        if self.is_top_level is not None:
            result["is_top_level"] = self.is_top_level
        return result


@dataclass(frozen=True, slots=True)
class ProviderUrlReference:
    """Typed provider URL identity extracted from a supported model URL."""

    model_id: Optional[int] = None
    version_id: Optional[int] = None
    sha256: Optional[str] = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "model_id",
            _as_optional_provider_int(
                self.model_id,
                "ProviderUrlReference model_id",
            ),
        )
        object.__setattr__(
            self,
            "version_id",
            _as_optional_provider_int(
                self.version_id,
                "ProviderUrlReference version_id",
            ),
        )
        sha256 = self.sha256
        if sha256 is not None:
            if not isinstance(sha256, str):
                raise TypeError("ProviderUrlReference sha256 must be a string")
            sha256 = sha256.strip().lower()
            if sha256.startswith("sha256:"):
                sha256 = sha256[7:]
            if not re.fullmatch(r"[0-9a-f]{64}", sha256):
                raise ValueError("ProviderUrlReference sha256 must be a SHA256 hash")
        object.__setattr__(self, "sha256", sha256 or None)
        if self.model_id is None and self.version_id is None and self.sha256 is None:
            raise ValueError("ProviderUrlReference requires a provider identity")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ProviderUrlReference":
        """Build a provider URL identity from parser output."""
        raw = _require_mapping(value, "ProviderUrlReference")
        model_id = raw.get("model_id")
        if model_id is None:
            model_id = raw.get("modelId")
        version_id = raw.get("version_id")
        if version_id is None:
            version_id = raw.get("versionId")
        if version_id is None:
            version_id = raw.get("modelVersionId")
        sha256 = raw.get("sha256")
        if sha256 is None:
            sha256 = raw.get("SHA256")
        return cls(model_id=model_id, version_id=version_id, sha256=sha256)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to the legacy provider parser shape."""
        result: Dict[str, Any] = {}
        if self.model_id is not None:
            result["model_id"] = self.model_id
        if self.version_id is not None:
            result["version_id"] = self.version_id
        if self.sha256 is not None:
            result["sha256"] = self.sha256
        return result


@dataclass(frozen=True, slots=True)
class HuggingFaceFileReference:
    """Typed HuggingFace repository file identity extracted from a URL."""

    repo: str
    filename: str
    branch: str = "main"

    def __post_init__(self) -> None:
        for field_name in ("repo", "filename", "branch"):
            value = getattr(self, field_name)
            if not isinstance(value, str):
                raise TypeError(f"HuggingFaceFileReference {field_name} must be a string")
            object.__setattr__(self, field_name, value.strip())
        if not self.repo:
            raise ValueError("HuggingFaceFileReference repo is required")
        if not self.filename:
            raise ValueError("HuggingFaceFileReference filename is required")
        if not self.branch:
            object.__setattr__(self, "branch", "main")

    def to_dict(self) -> Dict[str, str]:
        """Serialize to the existing parser result shape."""
        return {
            "repo": self.repo,
            "branch": self.branch,
            "filename": self.filename,
        }

@dataclass(frozen=True, slots=True)
class ResolvedModel:
    """Canonical local model record used by matching and workflow updates."""

    path: str = ""
    filename: str = ""
    relative_path: str = ""
    category: str = ""
    base_directory: str = ""
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        for field_name in (
            "path",
            "filename",
            "relative_path",
            "category",
            "base_directory",
        ):
            object.__setattr__(
                self,
                field_name,
                _as_contract_text(
                    getattr(self, field_name),
                    f"ResolvedModel {field_name}",
                ),
            )
        object.__setattr__(
            self,
            "extra",
            _freeze_value(
                {
                    key: item
                    for key, item in _as_contract_mapping(
                        self.extra,
                        "ResolvedModel extra",
                    ).items()
                    if key not in _RESOLVED_MODEL_INPUT_KEYS
                }
            ),
        )
        object.__setattr__(
            self,
            "raw",
            _freeze_value(_as_contract_mapping(self.raw, "ResolvedModel raw")),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ResolvedModel":
        """Normalize a scanner or frontend model mapping."""
        raw = _require_mapping(value, "ResolvedModel")
        model = cls(
            path=_contract_text_from_mapping(
                raw,
                "path",
                ("resolved_path",),
                contract_name="ResolvedModel",
            ),
            filename=_contract_text_from_mapping(
                raw,
                "filename",
                ("name",),
                contract_name="ResolvedModel",
            ),
            relative_path=_contract_text_from_mapping(
                raw,
                "relative_path",
                contract_name="ResolvedModel",
            ),
            category=_contract_text_from_mapping(
                raw,
                "category",
                contract_name="ResolvedModel",
            ),
            base_directory=_contract_text_from_mapping(
                raw,
                "base_directory",
                contract_name="ResolvedModel",
            ),
            extra={
                key: item
                for key, item in raw.items()
                if key not in _RESOLVED_MODEL_INPUT_KEYS
            },
            raw=raw,
        )
        if not (model.path or model.filename or model.relative_path):
            raise ValueError("ResolvedModel requires a path or filename")
        return model

    def to_dict(self) -> Dict[str, Any]:
        """Serialize while preserving provider/scanner-specific fields."""
        result = _thaw_value(
            {
                key: item
                for key, item in self.raw.items()
                if key not in _RESOLVED_MODEL_INPUT_KEYS
            }
        )
        result.update(
            _thaw_value(
                {
                    key: item
                    for key, item in self.extra.items()
                    if key not in _RESOLVED_MODEL_INPUT_KEYS
                }
            )
        )
        if self.path:
            result["path"] = self.path
        if self.filename:
            result["filename"] = self.filename
        if self.relative_path:
            result["relative_path"] = self.relative_path
        if self.category:
            result["category"] = self.category
        if self.base_directory:
            result["base_directory"] = self.base_directory
        return result

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read an optional scanner/provider field explicitly."""
        return self.extra.get(key, default)

    def with_extra(self, **values: Any) -> "ResolvedModel":
        """Return a copy enriched with local scan or download metadata."""
        extra = {
            key: value
            for key, value in self.extra.items()
            if key not in _RESOLVED_MODEL_INPUT_KEYS
        }
        extra.update(
            {
                key: value
                for key, value in values.items()
                if key not in _RESOLVED_MODEL_INPUT_KEYS
            }
        )
        return replace(self, extra=extra)

    def with_updates(self, **values: Any) -> "ResolvedModel":
        """Return a copy with canonical model fields replaced immutably."""
        canonical_updates = {
            key: value
            for key, value in values.items()
            if key in _RESOLVED_MODEL_CANONICAL_KEYS
        }
        extra = {
            key: value
            for key, value in self.extra.items()
            if key not in _RESOLVED_MODEL_INPUT_KEYS
        }
        extra.update(
            {
                key: value
                for key, value in values.items()
                if key not in _RESOLVED_MODEL_INPUT_KEYS
            }
        )
        return replace(self, extra=extra, **canonical_updates)


@dataclass(frozen=True, slots=True)
class ModelMatch:
    """Canonical local match returned for a workflow model reference."""

    model: ResolvedModel
    filename: str = ""
    similarity: float = 0.0
    confidence: float = 0.0
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        model = self.model
        if not _is_contract_instance(model, ResolvedModel) and isinstance(
            model,
            Mapping,
        ):
            model = ResolvedModel.from_mapping(model)
        if not _is_contract_instance(model, ResolvedModel):
            raise TypeError("ModelMatch model must be a model object")
        object.__setattr__(self, "model", model)
        filename = self.filename
        if filename is None or filename == "":
            filename = model.filename
        object.__setattr__(
            self,
            "filename",
            _as_contract_text(filename, "ModelMatch filename"),
        )
        object.__setattr__(
            self,
            "similarity",
            _as_contract_float(self.similarity, "ModelMatch similarity"),
        )
        object.__setattr__(
            self,
            "confidence",
            _as_contract_float(self.confidence, "ModelMatch confidence"),
        )
        object.__setattr__(
            self,
            "extra",
            _freeze_value(_as_contract_mapping(self.extra, "ModelMatch extra")),
        )
        object.__setattr__(
            self,
            "raw",
            _freeze_value(_as_contract_mapping(self.raw, "ModelMatch raw")),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ModelMatch":
        """Normalize a fuzzy or hash match mapping."""
        raw = _require_mapping(value, "ModelMatch")
        model_value = raw.get("model")
        if _is_contract_instance(model_value, ResolvedModel):
            model = model_value
        elif isinstance(model_value, Mapping):
            model = ResolvedModel.from_mapping(model_value)
        else:
            raise TypeError("ModelMatch model must be a model object")
        known_keys = {"model", "filename", "similarity", "confidence"}
        return cls(
            model=model,
            filename=raw.get("filename"),
            similarity=raw.get("similarity"),
            confidence=raw.get("confidence"),
            extra={key: item for key, item in raw.items() if key not in known_keys},
            raw=raw,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize using the existing local-match response shape."""
        result = _thaw_value(self.raw)
        result.update(_thaw_value(self.extra))
        result["model"] = self.model.to_dict()
        result["filename"] = self.filename
        result["similarity"] = self.similarity
        result["confidence"] = self.confidence
        return result

    def with_extra(self, **values: Any) -> "ModelMatch":
        """Return a copy enriched with local-match metadata."""
        extra = dict(self.extra)
        extra.update(values)
        return replace(self, extra=extra)

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read an optional local-match field explicitly."""
        return self.extra.get(key, default)


@dataclass(frozen=True, slots=True)
class MissingModel:
    """Grouped workflow model reference with typed local matches."""

    reference: ModelReference
    reference_count: Optional[int] = None
    all_node_refs: Tuple[ModelReference, ...] = ()
    matches: Optional[Tuple[ModelMatch, ...]] = None
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        reference = self.reference
        if not _is_contract_instance(reference, ModelReference) and isinstance(
            reference,
            Mapping,
        ):
            reference = ModelReference.from_mapping(reference)
        if not _is_contract_instance(reference, ModelReference):
            raise TypeError("MissingModel reference must be a model reference")
        object.__setattr__(self, "reference", reference)

        raw_refs = self.all_node_refs
        if not isinstance(raw_refs, (list, tuple)):
            raise TypeError("MissingModel all_node_refs must be an array")
        if not raw_refs:
            raw_refs = (reference,)
        normalized_refs = []
        for item in raw_refs:
            if _is_contract_instance(item, ModelReference):
                normalized_refs.append(item)
            elif isinstance(item, Mapping):
                normalized_refs.append(ModelReference.from_mapping(item))
            else:
                raise TypeError("MissingModel all_node_refs must contain model references")
        object.__setattr__(self, "all_node_refs", tuple(normalized_refs))

        if self.reference_count is None:
            reference_count = len(normalized_refs)
        else:
            reference_count = _require_non_negative_int(
                self.reference_count,
                "MissingModel reference_count",
            )
            if reference_count < 1:
                raise ValueError(
                    "MissingModel reference_count must be a positive integer"
                )
            if reference_count != len(normalized_refs):
                raise ValueError(
                    "MissingModel reference_count must match all_node_refs"
                )
        object.__setattr__(self, "reference_count", reference_count)

        raw_matches = self.matches
        if raw_matches is None:
            normalized_matches = None
        else:
            if not isinstance(raw_matches, (list, tuple)):
                raise TypeError("MissingModel matches must be an array")
            normalized_matches = []
            for item in raw_matches:
                if _is_contract_instance(item, ModelMatch):
                    normalized_matches.append(item)
                elif isinstance(item, Mapping):
                    normalized_matches.append(ModelMatch.from_mapping(item))
                else:
                    raise TypeError("MissingModel matches must contain model matches")
        object.__setattr__(
            self,
            "matches",
            None if normalized_matches is None else tuple(normalized_matches),
        )
        object.__setattr__(
            self,
            "extra",
            _freeze_value(
                {
                    key: item
                    for key, item in _as_contract_mapping(
                        self.extra,
                        "MissingModel extra",
                    ).items()
                    if key not in _MISSING_MODEL_RESERVED_KEYS
                }
            ),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "MissingModel":
        """Build a grouped missing-model value from raw workflow data."""
        raw = _require_mapping(value, "MissingModel")
        raw_refs_value = raw.get("all_node_refs")
        if raw_refs_value is None:
            raw_refs = (raw,)
        elif isinstance(raw_refs_value, (list, tuple)):
            raw_refs = tuple(raw_refs_value) or (raw,)
        else:
            raise TypeError("MissingModel all_node_refs must be an array")

        normalized_refs = []
        for item in raw_refs:
            if _is_contract_instance(item, ModelReference):
                normalized_refs.append(item)
            elif isinstance(item, Mapping):
                normalized_refs.append(ModelReference.from_mapping(item))
            else:
                raise TypeError(
                    "MissingModel all_node_refs must contain model references"
                )

        raw_matches = raw.get("matches")
        matches = None
        if raw_matches is not None:
            if not isinstance(raw_matches, (list, tuple)):
                raise TypeError("MissingModel matches must be an array")
            normalized_matches = []
            for item in raw_matches:
                if _is_contract_instance(item, ModelMatch):
                    normalized_matches.append(item)
                    continue
                if not isinstance(item, Mapping):
                    raise TypeError(
                        "MissingModel matches must contain model matches"
                    )
                normalized_matches.append(ModelMatch.from_mapping(item))
            matches = tuple(normalized_matches)

        known_keys = _MISSING_MODEL_RESERVED_KEYS
        raw_reference_count = raw.get("reference_count")
        if raw_reference_count is None:
            reference_count = len(normalized_refs)
        else:
            reference_count = _require_non_negative_int(
                raw_reference_count,
                "MissingModel reference_count",
            )
            if reference_count < 1:
                raise ValueError(
                    "MissingModel reference_count must be a positive integer"
                )

        return cls(
            reference=ModelReference.from_mapping(raw),
            reference_count=reference_count,
            all_node_refs=tuple(normalized_refs),
            matches=matches,
            extra={key: item for key, item in raw.items() if key not in known_keys},
        )

    def with_extra(self, **values: Any) -> "MissingModel":
        """Return a copy with workflow-enrichment fields merged in."""
        extra = {
            key: item
            for key, item in self.extra.items()
            if key not in _MISSING_MODEL_RESERVED_KEYS
        }
        extra.update(
            {
                key: value
                for key, value in values.items()
                if key not in _MISSING_MODEL_RESERVED_KEYS
            }
        )
        return replace(self, extra=extra)

    def with_matches(self, matches: List[ModelMatch]) -> "MissingModel":
        """Return a copy with normalized local matches attached."""
        return replace(self, matches=tuple(matches))

    def with_references(self, references: Sequence[ModelReference]) -> "MissingModel":
        """Return a copy with all workflow occurrences attached."""
        normalized = tuple(references)
        if not normalized:
            raise ValueError("MissingModel requires at least one reference")
        return replace(
            self,
            reference=normalized[0],
            reference_count=len(normalized),
            all_node_refs=normalized,
        )

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read an optional workflow-enrichment value explicitly."""
        return self.extra.get(key, default)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to the workflow-analysis HTTP response shape."""
        result = self.reference.to_dict()
        result["reference_count"] = self.reference_count
        result["all_node_refs"] = [item.to_dict() for item in self.all_node_refs]
        if self.matches is not None:
            result["matches"] = [item.to_dict() for item in self.matches]
        canonical = dict(result)
        result = _thaw_value(
            {
                key: item
                for key, item in self.extra.items()
                if key not in _MISSING_MODEL_RESERVED_KEYS
            }
        )
        result.update(canonical)
        return result

@dataclass(frozen=True, slots=True)
class WorkflowAnalysisResult:
    """Typed internal result serialized at the workflow HTTP boundary."""

    missing_models: Tuple[MissingModel, ...] = ()
    resolved_models: Tuple[ModelReference, ...] = ()
    total_resolved: int = 0
    total_missing: int = 0
    total_models_analyzed: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.missing_models, (list, tuple)):
            raise TypeError(
                "WorkflowAnalysisResult missing_models must be an array"
            )
        if not isinstance(self.resolved_models, (list, tuple)):
            raise TypeError(
                "WorkflowAnalysisResult resolved_models must be an array"
            )

        normalized_missing = []
        for item in self.missing_models:
            if _is_contract_instance(item, MissingModel):
                normalized_missing.append(item)
            elif isinstance(item, Mapping):
                normalized_missing.append(MissingModel.from_mapping(item))
            else:
                raise TypeError("WorkflowAnalysisResult missing_models must contain missing models")

        normalized_resolved = []
        for item in self.resolved_models:
            if _is_contract_instance(item, ModelReference):
                normalized_resolved.append(item)
            elif isinstance(item, Mapping):
                normalized_resolved.append(ModelReference.from_mapping(item))
            else:
                raise TypeError("WorkflowAnalysisResult resolved_models must contain model references")

        object.__setattr__(self, "missing_models", tuple(normalized_missing))
        object.__setattr__(self, "resolved_models", tuple(normalized_resolved))
        for field_name in (
            "total_resolved",
            "total_missing",
            "total_models_analyzed",
        ):
            object.__setattr__(
                self,
                field_name,
                _require_non_negative_int(
                    getattr(self, field_name),
                    f"WorkflowAnalysisResult {field_name}",
                ),
            )

        if self.total_missing != len(self.missing_models):
            raise ValueError(
                "WorkflowAnalysisResult total_missing must equal the number "
                "of missing_models"
            )
        if self.total_resolved != len(self.resolved_models):
            raise ValueError(
                "WorkflowAnalysisResult total_resolved must equal the number "
                "of resolved_models"
            )
        if self.total_models_analyzed < self.total_missing + self.total_resolved:
            raise ValueError(
                "WorkflowAnalysisResult total_models_analyzed must be at least "
                "total_missing plus total_resolved"
            )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the complete analysis response for the frontend."""
        return {
            "missing_models": [item.to_dict() for item in self.missing_models],
            "resolved_models": [
                {**item.to_dict(), "matches": []}
                for item in self.resolved_models
            ],
            "total_resolved": self.total_resolved,
            "total_missing": self.total_missing,
            "total_models_analyzed": self.total_models_analyzed,
        }


@dataclass(frozen=True, slots=True)
class WorkflowModelInventory:
    """Typed shared workflow inventory used by resolver and HTTP services."""

    available_models: Tuple[ResolvedModel, ...] = ()
    model_refs: Tuple[ModelReference, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.available_models, (list, tuple)):
            raise TypeError("WorkflowModelInventory available_models must be an array")
        if not isinstance(self.model_refs, (list, tuple)):
            raise TypeError("WorkflowModelInventory model_refs must be an array")
        object.__setattr__(
            self,
            "available_models",
            tuple(
                item
                if _is_contract_instance(item, ResolvedModel)
                else ResolvedModel.from_mapping(item)
                for item in self.available_models
            ),
        )
        object.__setattr__(
            self,
            "model_refs",
            tuple(
                item
                if _is_contract_instance(item, ModelReference)
                else ModelReference.from_mapping(item)
                for item in self.model_refs
            ),
        )


@dataclass(frozen=True, slots=True)
class SearchResult:
    """Canonical model-search result shared by all supported providers."""

    source: str
    model_id: int | str | None = None
    version_id: int | str | None = None
    name: str = ""
    version_name: str = ""
    model_type: str = ""
    filename: str = ""
    url: str = ""
    download_url: Optional[str] = None
    size: Optional[int] = None
    base_model: Optional[str] = None
    tags: Tuple[Any, ...] = ()
    match_type: str = "similar"
    confidence: float = 0.0
    sha256: Optional[str] = None
    hashes: Mapping[str, Any] = field(default_factory=dict)
    trained_words: Tuple[Any, ...] = ()
    images: Tuple[Any, ...] = ()
    details_source: Optional[str] = None
    version_url: Optional[str] = None
    custom_url: bool = False
    result_mode: str = "search"
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        """Defensively copy mutable payload fields at the boundary."""
        object.__setattr__(
            self,
            "model_id",
            _as_contract_identifier(self.model_id, "SearchResult model_id"),
        )
        object.__setattr__(
            self,
            "version_id",
            _as_contract_identifier(self.version_id, "SearchResult version_id"),
        )
        source = _as_contract_text(self.source, "SearchResult source").strip()
        if not source:
            raise ValueError("SearchResult source is required")
        object.__setattr__(self, "source", source)
        for field_name in (
            "name",
            "version_name",
            "model_type",
            "filename",
            "url",
            "match_type",
            "result_mode",
        ):
            object.__setattr__(
                self,
                field_name,
                _as_contract_text(
                    getattr(self, field_name),
                    f"SearchResult {field_name}",
                ),
            )
        for field_name in (
            "download_url",
            "base_model",
            "sha256",
            "details_source",
            "version_url",
        ):
            object.__setattr__(
                self,
                field_name,
                _as_nullable_contract_text(
                    getattr(self, field_name),
                    f"SearchResult {field_name}",
                ),
            )
        object.__setattr__(
            self,
            "tags",
            _freeze_value(_as_contract_sequence(self.tags, "SearchResult tags")),
        )
        object.__setattr__(
            self,
            "hashes",
            _freeze_value(_as_contract_mapping(self.hashes, "SearchResult hashes")),
        )
        object.__setattr__(
            self,
            "trained_words",
            _freeze_value(
                _as_contract_sequence(
                    self.trained_words,
                    "SearchResult trained_words",
                )
            ),
        )
        object.__setattr__(
            self,
            "images",
            _freeze_value(_as_contract_sequence(self.images, "SearchResult images")),
        )
        object.__setattr__(
            self,
            "custom_url",
            _as_contract_bool(self.custom_url, "SearchResult custom_url"),
        )
        object.__setattr__(
            self,
            "extra",
            _freeze_value(
                {
                    key: item
                    for key, item in _as_contract_mapping(
                        self.extra,
                        "SearchResult extra",
                    ).items()
                    if key not in _SEARCH_RESULT_RESERVED_EXTRA_KEYS
                }
            ),
        )
        object.__setattr__(
            self,
            "confidence",
            _as_contract_float(self.confidence, "SearchResult confidence"),
        )
        object.__setattr__(
            self,
            "size",
            _as_contract_size(self.size, "SearchResult size"),
        )

        if self.result_mode not in {
            "search",
            "custom_url",
            "compact_custom_url",
        }:
            raise ValueError(f"Unsupported model result mode: {self.result_mode}")

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
        *,
        source: Optional[str] = None,
    ) -> "SearchResult":
        """Normalize common provider aliases into a canonical search result.

        This adapter is intentionally conservative: unknown provider fields are
        retained in ``extra`` so adding metadata does not break the API.
        """
        raw = _require_mapping(value, "SearchResult")
        raw_hashes = raw.get("hashes")
        nested_hashes = _as_contract_mapping(
            raw_hashes,
            "SearchResult hashes",
        )
        known_keys = _SEARCH_RESULT_INPUT_KEYS
        size = raw.get("size", raw.get("size_bytes"))
        if size is None and raw.get("sizeKB") is not None:
            try:
                if isinstance(raw["sizeKB"], bool):
                    raise TypeError
                size = int(float(raw["sizeKB"]) * 1024)
            except (TypeError, ValueError):
                raise ValueError(
                    "SearchResult size must be a non-negative size"
                ) from None

        custom_url = _as_contract_bool(
            raw.get("custom_url", False),
            "SearchResult custom_url",
        )
        result_mode = _provider_text(
            raw,
            ("result_mode",),
            field_name="result_mode",
        )
        if not result_mode and custom_url:
            full_custom_url_keys = {
                "version_name",
                "versionName",
                "type",
                "model_type",
                "size",
                "size_bytes",
                "sizeKB",
                "tags",
                "sha256",
                "SHA256",
                "hash",
                "hashes",
                "trained_words",
                "trainedWords",
                "images",
            }
            result_mode = (
                "custom_url"
                if full_custom_url_keys.intersection(raw)
                else "compact_custom_url"
            )
        if not result_mode:
            result_mode = "search"

        model_id = raw.get("model_id")
        if model_id is None:
            model_id = raw.get("modelId")
        version_id = raw.get("version_id")
        if version_id is None:
            version_id = raw.get("versionId")
        if version_id is None:
            version_id = raw.get("modelVersionId")
        sha256_value = _first_provider_value(
            raw,
            (
                "sha256",
                "SHA256",
                "hash",
            ),
        )
        if sha256_value is None:
            sha256_value = _first_provider_value(
                nested_hashes,
                ("sha256", "SHA256"),
            )
        if sha256_value is None:
            sha256_value = _first_provider_value_preserving_empty(
                raw,
                ("sha256", "SHA256", "hash"),
            )
        if sha256_value is None:
            sha256_value = _first_provider_value_preserving_empty(
                nested_hashes,
                ("sha256", "SHA256"),
            )

        return cls(
            source=(
                _provider_text(
                    raw,
                    ("source",),
                    field_name="source",
                )
                if source is None
                else source
            ),
            model_id=model_id,
            version_id=version_id,
            name=_provider_text(
                raw,
                ("name", "model_name", "modelName"),
                field_name="name",
            ),
            version_name=_provider_text(
                raw,
                ("version_name", "versionName"),
                field_name="version_name",
            ),
            model_type=_provider_text(
                raw,
                ("type", "model_type"),
                field_name="model_type",
            ),
            filename=_provider_text(
                raw,
                ("filename", "file_name", "fileName", "name"),
                field_name="filename",
            ),
            url=_provider_text(
                raw,
                ("url", "page_url"),
                field_name="url",
            ),
            download_url=_provider_optional_text(
                raw,
                ("download_url", "downloadUrl", "downloadURL"),
                field_name="download_url",
            ),
            size=_as_contract_size(size, "SearchResult size"),
            base_model=_provider_optional_text(
                raw,
                ("base_model", "baseModel"),
                field_name="base_model",
            ),
            tags=_as_contract_sequence(raw.get("tags"), "SearchResult tags"),
            match_type=_provider_text(
                raw,
                ("match_type",),
                field_name="match_type",
            ) or "similar",
            confidence=raw.get("confidence", 0.0),
            sha256=_as_nullable_contract_text(
                sha256_value,
                "SearchResult sha256",
            ),
            hashes=nested_hashes,
            trained_words=_as_contract_sequence(
                _first_provider_value(raw, ("trained_words", "trainedWords")),
                "SearchResult trained_words",
            ),
            images=_as_contract_sequence(raw.get("images"), "SearchResult images"),
            details_source=_provider_optional_text(
                raw,
                ("details_source",),
                field_name="details_source",
            ),
            version_url=_provider_optional_text(
                raw,
                ("version_url", "versionUrl"),
                field_name="version_url",
            ),
            custom_url=custom_url,
            result_mode=result_mode,
            extra={key: item for key, item in raw.items() if key not in known_keys},
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize using the existing Model Resolver result contract."""
        if self.result_mode == "compact_custom_url":
            result: Dict[str, Any] = {
                "source": self.source,
                "details_source": self.details_source or self.source,
                "name": self.name,
                "filename": self.filename,
                "url": self.url,
                "version_url": self.version_url or self.url,
                "download_url": self.download_url,
                "match_type": self.match_type,
                "custom_url": self.custom_url,
            }
            if self.model_id is not None:
                result["model_id"] = self.model_id
            if self.version_id is not None:
                result["version_id"] = self.version_id
            canonical = dict(result)
            result = _thaw_value(
                {
                    key: item
                    for key, item in self.extra.items()
                    if key not in _SEARCH_RESULT_RESERVED_EXTRA_KEYS
                }
            )
            result.update(canonical)
            return result

        result = {
            "source": self.source,
            "model_id": self.model_id,
            "version_id": self.version_id,
            "name": self.name,
            "version_name": self.version_name,
            "type": self.model_type,
            "filename": self.filename,
            "url": self.url,
            "download_url": self.download_url,
            "size": self.size,
            "base_model": self.base_model,
            "tags": _thaw_value(self.tags or ()),
            "match_type": self.match_type,
            "confidence": self.confidence,
            "sha256": self.sha256,
            "hashes": _thaw_value(self.hashes or {}),
            "trained_words": _thaw_value(self.trained_words or ()),
            "images": _thaw_value(self.images or ()),
        }

        if self.result_mode == "custom_url":
            result.pop("confidence", None)
            result.update(
                {
                    "details_source": self.details_source or self.source,
                    "version_url": self.version_url or self.url,
                    "match_type": "custom_url",
                    "custom_url": self.custom_url,
                }
            )
        else:
            if self.details_source is not None:
                result["details_source"] = self.details_source
            if self.version_url is not None:
                result["version_url"] = self.version_url
            if self.custom_url:
                result["custom_url"] = True

        canonical = dict(result)
        result = _thaw_value(
            {
                key: item
                for key, item in self.extra.items()
                if key not in _SEARCH_RESULT_RESERVED_EXTRA_KEYS
            }
        )
        result.update(canonical)
        return result

    def with_extra(self, **values: Any) -> "SearchResult":
        """Return a copy enriched with provider-specific fields."""
        extra = {
            key: item
            for key, item in self.extra.items()
            if key not in _SEARCH_RESULT_RESERVED_EXTRA_KEYS
        }
        extra.update(
            {
                key: value
                for key, value in values.items()
                if key not in _SEARCH_RESULT_RESERVED_EXTRA_KEYS
            }
        )
        return replace(self, extra=extra)

    def with_updates(self, **values: Any) -> "SearchResult":
        """Return a copy with canonical fields replaced immutably."""
        return replace(self, **values)

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read a provider-specific field without falling back to a mapping API."""
        return self.extra.get(key, default)


@dataclass(frozen=True, slots=True)
class ModelCatalogEntry:
    """Validated entry returned by the local popular-model catalog."""

    filename: str = ""
    name: str = ""
    url: str = ""
    download_url: Optional[str] = None
    model_type: str = ""
    size: Optional[int] = None
    directory: str = ""
    match_type: str = "exact"
    confidence: float = 0.0
    extra: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)

    def __post_init__(self) -> None:
        for field_name in (
            "filename",
            "name",
            "url",
            "model_type",
            "directory",
            "match_type",
        ):
            object.__setattr__(
                self,
                field_name,
                _as_contract_text(
                    getattr(self, field_name),
                    f"ModelCatalogEntry {field_name}",
                ).strip(),
            )
        object.__setattr__(
            self,
            "download_url",
            _as_nullable_contract_text(
                self.download_url,
                "ModelCatalogEntry download_url",
            ),
        )
        object.__setattr__(
            self,
            "size",
            _as_contract_size(self.size, "ModelCatalogEntry size"),
        )
        object.__setattr__(
            self,
            "confidence",
            _as_contract_float(
                self.confidence,
                "ModelCatalogEntry confidence",
            ),
        )
        object.__setattr__(
            self,
            "extra",
            _freeze_value(
                {
                    key: item
                    for key, item in _as_contract_mapping(
                        self.extra,
                        "ModelCatalogEntry extra",
                    ).items()
                    if key
                    not in {
                        "filename",
                        "name",
                        "url",
                        "download_url",
                        "type",
                        "model_type",
                        "size",
                        "match_type",
                        "confidence",
                        "directory",
                    }
                }
            ),
        )

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
        *,
        filename: str = "",
    ) -> "ModelCatalogEntry":
        """Build a catalog entry from the source database mapping."""
        raw = _require_mapping(value, "ModelCatalogEntry")
        raw_filename = raw.get("filename")
        if raw_filename is None:
            raw_filename = filename
        name = _provider_text(
            raw,
            ("name",),
            field_name="name",
            contract_name="ModelCatalogEntry",
        )
        if not name:
            name = _as_contract_text(raw_filename, "ModelCatalogEntry filename")
        size = raw.get("size")
        if size is None and raw.get("sizeKB") is not None:
            size = raw.get("sizeKB")
            if not isinstance(size, bool):
                try:
                    size = float(size) * 1024
                except (TypeError, ValueError):
                    raise ValueError(
                        "ModelCatalogEntry size must be a non-negative size"
                    ) from None
        return cls(
            filename=_as_contract_text(
                raw_filename,
                "ModelCatalogEntry filename",
            ),
            name=name,
            url=_provider_optional_text(
                raw,
                ("url", "page_url"),
                field_name="url",
                contract_name="ModelCatalogEntry",
            )
            or "",
            download_url=_provider_optional_text(
                raw,
                ("download_url", "downloadUrl", "downloadURL"),
                field_name="download_url",
                contract_name="ModelCatalogEntry",
            ),
            model_type=_provider_text(
                raw,
                ("type", "model_type"),
                field_name="model_type",
                contract_name="ModelCatalogEntry",
            ),
            size=_as_contract_size(size, "ModelCatalogEntry size"),
            directory=_provider_text(
                raw,
                ("directory",),
                field_name="directory",
                contract_name="ModelCatalogEntry",
            ),
            match_type=_provider_text(
                raw,
                ("match_type",),
                field_name="match_type",
                contract_name="ModelCatalogEntry",
            )
            or "exact",
            confidence=raw.get("confidence", 0.0),
            extra={
                key: item
                for key, item in raw.items()
                if key
                not in {
                    "filename",
                    "name",
                    "url",
                    "page_url",
                    "download_url",
                    "downloadUrl",
                    "downloadURL",
                    "type",
                    "model_type",
                    "size",
                    "sizeKB",
                    "match_type",
                    "confidence",
                    "directory",
                }
            },
        )

    def extra_value(self, key: str, default: Any = None) -> Any:
        """Read catalog-specific metadata explicitly."""
        return self.extra.get(key, default)

    def with_extra(self, **values: Any) -> "ModelCatalogEntry":
        """Return a catalog entry enriched with source-specific metadata."""
        extra = dict(self.extra)
        extra.update(values)
        return replace(self, extra=extra)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the catalog entry for compatibility with source payloads."""
        result = _thaw_value(self.extra)
        if self.filename:
            result["filename"] = self.filename
        if self.name:
            result["name"] = self.name
        if self.url:
            result["url"] = self.url
        if self.download_url is not None:
            result["download_url"] = self.download_url
        if self.model_type:
            result["type"] = self.model_type
        if self.size is not None:
            result["size"] = self.size
        if self.directory:
            result["directory"] = self.directory
        if self.match_type:
            result["match_type"] = self.match_type
        if self.confidence:
            result["confidence"] = self.confidence
        return result


@dataclass(frozen=True, slots=True)
class DownloadSpec:
    """Validated internal description of a model download request."""

    url: str
    filename: str
    category: str
    headers: Mapping[str, str] = field(default_factory=dict, repr=False, compare=False)
    subfolder: str = ""
    base_directory: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)
    expected_sha256: Optional[str] = None

    def __post_init__(self) -> None:
        for field_name in (
            "url",
            "filename",
            "category",
            "subfolder",
            "base_directory",
        ):
            value = getattr(self, field_name)
            if not isinstance(value, str):
                raise TypeError(f"DownloadSpec {field_name} must be a string")
            object.__setattr__(self, field_name, value.strip())
        expected_sha256 = self.expected_sha256
        if expected_sha256 is not None:
            if not isinstance(expected_sha256, str):
                raise TypeError(
                    "DownloadSpec expected_sha256 must be a string"
                )
            expected_sha256 = expected_sha256.strip() or None
        object.__setattr__(self, "expected_sha256", expected_sha256)
        object.__setattr__(
            self,
            "headers",
            _freeze_value(_require_string_mapping(self.headers, "DownloadSpec headers")),
        )
        object.__setattr__(
            self,
            "metadata",
            _freeze_value(_require_mapping(self.metadata, "DownloadSpec metadata")),
        )

        if not self.url:
            raise ValueError("Download URL is required")
        if not self.filename:
            raise ValueError("Download filename is required")
        if not self.category:
            raise ValueError("Download category is required")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "DownloadSpec":
        """Build a download specification from an HTTP/provider payload."""
        raw = _require_mapping(value, "DownloadSpec")
        metadata = raw.get("metadata")
        if metadata is None:
            metadata = raw.get("download_metadata")
        if metadata is None:
            metadata = {}
        expected_sha256 = raw.get("expected_sha256")
        if expected_sha256 is None or (
            isinstance(expected_sha256, str) and not expected_sha256.strip()
        ):
            expected_sha256 = raw.get("sha256")
        return cls(
            url=_download_text_from_mapping(raw, "url", ("download_url",)),
            filename=_download_text_from_mapping(raw, "filename", ("name",)),
            category=_download_text_from_mapping(raw, "category"),
            headers=raw.get("headers"),
            subfolder=_download_text_from_mapping(raw, "subfolder"),
            base_directory=_download_text_from_mapping(raw, "base_directory"),
            metadata=metadata,
            expected_sha256=expected_sha256,
        )

    def to_kwargs(self) -> Dict[str, Any]:
        """Return arguments accepted by the existing background downloader."""
        metadata = _thaw_value(self.metadata)
        if self.expected_sha256 and not metadata.get("sha256"):
            metadata["sha256"] = self.expected_sha256
        return {
            "url": self.url,
            "filename": self.filename,
            "category": self.category,
            "headers": _thaw_value(self.headers) if self.headers else None,
            "subfolder": self.subfolder,
            "base_directory": self.base_directory,
            "metadata": metadata,
        }


@dataclass(frozen=True, slots=True)
class CustomNodeMetadata:
    """Typed metadata passed from workflow references to custom-node adapters."""

    adapter_id: str = ""
    original_identity: str = ""
    is_legacy_lora_manager: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "adapter_id",
            _as_contract_text(
                self.adapter_id,
                "CustomNodeMetadata adapter_id",
            ).strip(),
        )
        object.__setattr__(
            self,
            "original_identity",
            _as_contract_text(
                self.original_identity,
                "CustomNodeMetadata original_identity",
            ).strip(),
        )
        object.__setattr__(
            self,
            "is_legacy_lora_manager",
            _as_contract_bool(
                self.is_legacy_lora_manager,
                "CustomNodeMetadata is_legacy_lora_manager",
            ),
        )

    @classmethod
    def from_mapping(cls, value: Any) -> "CustomNodeMetadata":
        """Normalize serialized adapter metadata into the typed contract."""
        if value is None:
            return cls()
        if _is_contract_instance(value, cls):
            return value
        raw = _require_mapping(value, "CustomNodeMetadata")
        return cls(
            adapter_id=_contract_text_from_mapping(
                raw,
                "custom_node_adapter",
                ("adapter_id",),
                contract_name="CustomNodeMetadata",
            ),
            original_identity=_contract_text_from_mapping(
                raw,
                "custom_node_original_identity",
                (
                    "original_lora_name",
                    "original_identity",
                    "name",
                    "original_path",
                ),
                contract_name="CustomNodeMetadata",
            ),
            is_legacy_lora_manager=raw.get(
                "is_legacy_lora_manager",
                raw.get("is_lora_v2", False),
            ),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize adapter metadata for the legacy workflow-update boundary."""
        result: Dict[str, Any] = {}
        if self.adapter_id:
            result["custom_node_adapter"] = self.adapter_id
        if self.original_identity:
            result["custom_node_original_identity"] = self.original_identity
        if self.is_legacy_lora_manager:
            result["is_lora_v2"] = True
        return result


@dataclass(frozen=True, slots=True)
class Resolution:
    """Validated workflow replacement passed through the typed update flow."""

    node_id: int | str | None = None
    widget_index: Optional[int] = None
    resolved_path: Optional[str] = None
    category: Optional[str] = None
    base_directory: Optional[str] = None
    resolved_model: Optional[ResolvedModel] = None
    subgraph_id: Optional[str] = None
    is_top_level: Optional[bool] = None
    nested_key: Optional[str] = None
    promoted_widget_name: Optional[str] = None
    reference: Optional[ModelReference] = None
    custom_node_metadata: CustomNodeMetadata = field(
        default_factory=CustomNodeMetadata,
        repr=False,
        compare=False,
    )

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "node_id",
            _as_contract_identifier(self.node_id, "Resolution node_id"),
        )
        object.__setattr__(
            self,
            "widget_index",
            _as_optional_non_negative_int(
                self.widget_index,
                "Resolution widget_index",
            ),
        )
        for field_name in (
            "resolved_path",
            "category",
            "base_directory",
            "subgraph_id",
            "nested_key",
            "promoted_widget_name",
        ):
            object.__setattr__(
                self,
                field_name,
                _as_nullable_contract_text(
                    getattr(self, field_name),
                    f"Resolution {field_name}",
                ),
            )

        resolved_model = self.resolved_model
        if not _is_contract_instance(resolved_model, ResolvedModel) and isinstance(
            resolved_model,
            Mapping,
        ):
            resolved_model = ResolvedModel.from_mapping(resolved_model)
        if resolved_model is not None and not _is_contract_instance(
            resolved_model,
            ResolvedModel,
        ):
            raise TypeError("Resolution resolved_model must be a model object")
        object.__setattr__(self, "resolved_model", resolved_model)

        reference = self.reference
        if not _is_contract_instance(reference, ModelReference) and isinstance(
            reference,
            Mapping,
        ):
            reference = ModelReference.from_mapping(reference)
        if reference is not None and not _is_contract_instance(
            reference,
            ModelReference,
        ):
            raise TypeError("Resolution reference must be a model reference")
        object.__setattr__(self, "reference", reference)
        object.__setattr__(
            self,
            "is_top_level",
            _as_optional_bool(self.is_top_level, "Resolution is_top_level"),
        )
        object.__setattr__(
            self,
            "custom_node_metadata",
            CustomNodeMetadata.from_mapping(self.custom_node_metadata),
        )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "Resolution":
        """Deserialize a workflow resolution request from JSON."""
        raw = _require_mapping(value, "Resolution")
        resolved_model = raw.get("resolved_model")
        if resolved_model is not None and not isinstance(
            resolved_model,
            Mapping,
        ) and not _is_contract_instance(resolved_model, ResolvedModel):
            raise ValueError("resolved_model must be an object")
        if isinstance(resolved_model, Mapping):
            for path_key in ("path", "resolved_path"):
                path_value = resolved_model.get(path_key)
                if path_value is not None and not isinstance(path_value, str):
                    raise ValueError(
                        f"resolved_model.{path_key} must be a string"
                    )
        _as_contract_identifier(raw.get("node_id"), "Resolution node_id")
        _as_optional_non_negative_int(
            raw.get("widget_index"),
            "Resolution widget_index",
        )
        for field_name in (
            "resolved_path",
            "category",
            "base_directory",
            "subgraph_id",
            "nested_key",
            "promoted_widget_name",
        ):
            field_value = raw.get(field_name)
            if field_value is not None and not isinstance(field_value, str):
                raise TypeError(f"Resolution {field_name} must be a string")

        return cls(
            node_id=raw.get("node_id"),
            widget_index=raw.get("widget_index"),
            resolved_path=raw.get("resolved_path"),
            category=raw.get("category"),
            base_directory=raw.get("base_directory"),
            resolved_model=(
                resolved_model
                if _is_contract_instance(resolved_model, ResolvedModel)
                else ResolvedModel.from_mapping(resolved_model)
                if resolved_model is not None
                else None
            ),
            subgraph_id=raw.get("subgraph_id"),
            is_top_level=_as_optional_bool(
                raw.get("is_top_level"),
                "Resolution is_top_level",
            ),
            nested_key=raw.get("nested_key"),
            promoted_widget_name=raw.get("promoted_widget_name"),
            reference=ModelReference.from_mapping(raw),
            custom_node_metadata=CustomNodeMetadata.from_mapping(
                raw.get("custom_node_metadata")
            ),
        )

    def with_custom_node_metadata(
        self,
        metadata: CustomNodeMetadata | Mapping[str, Any],
    ) -> "Resolution":
        """Return a copy enriched with adapter metadata for workflow updates."""
        return replace(
            self,
            custom_node_metadata=CustomNodeMetadata.from_mapping(metadata),
        )

    def with_base_directory(self, base_directory: Optional[str]) -> "Resolution":
        """Return a copy with a derived model base directory."""
        return replace(self, base_directory=base_directory)

    def validate(self) -> None:
        """Validate fields required by the workflow updater."""
        if self.node_id is None:
            raise ValueError("Resolution requires node_id")
        if isinstance(self.node_id, bool) or not isinstance(
            self.node_id,
            (int, str),
        ):
            raise ValueError("Resolution node_id must be an integer or string")
        if isinstance(self.node_id, str) and not self.node_id.strip():
            raise ValueError("Resolution node_id cannot be empty")

        if not isinstance(self.widget_index, int) or isinstance(
            self.widget_index,
            bool,
        ):
            raise ValueError("Resolution widget_index must be a non-negative integer")
        if self.widget_index < 0:
            raise ValueError("Resolution widget_index must be a non-negative integer")

        if self.resolved_path is not None and not isinstance(
            self.resolved_path,
            str,
        ):
            raise ValueError("Resolution resolved_path must be a string")
        if self.resolved_model is not None and not _is_contract_instance(
            self.resolved_model,
            ResolvedModel,
        ):
            raise ValueError("Resolution resolved_model must be a model object")

        resolved_model_path = self.resolved_model.path if self.resolved_model else ""
        if resolved_model_path and not isinstance(resolved_model_path, str):
            raise ValueError("Resolution resolved_model.path must be a string")
        if not (self.resolved_path or resolved_model_path):
            raise ValueError("Resolution requires resolved_path or resolved_model.path")

        for field_name in (
            "category",
            "base_directory",
            "subgraph_id",
            "nested_key",
            "promoted_widget_name",
        ):
            value = getattr(self, field_name)
            if value is not None and not isinstance(value, str):
                raise ValueError(f"Resolution {field_name} must be a string")

        if self.is_top_level is not None and not isinstance(self.is_top_level, bool):
            raise ValueError("Resolution is_top_level must be a boolean")
        if self.reference is not None and not _is_contract_instance(
            self.reference,
            ModelReference,
        ):
            raise ValueError("Resolution reference must be a model reference")
        if not _is_contract_instance(
            self.custom_node_metadata,
            CustomNodeMetadata,
        ):
            raise ValueError(
                "Resolution custom_node_metadata must be typed metadata"
            )

"""Timestamping and cache helpers for source search results."""

from datetime import datetime, timezone
from typing import Any

SEARCH_RESULT_KEYS = (
    "popular",
    "model_list",
    "huggingface",
    "civitai",
    "civarchive",
    "lora_manager_archive",
)


class SearchResultCache:
    """Keep stable timestamps for equivalent search results."""

    def __init__(self, timestamps: dict[str, str]):
        self._timestamps = timestamps

    @staticmethod
    def _current_timestamp() -> str:
        return (
            datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
        )

    @staticmethod
    def _result_signature(source_key: str, result: Any) -> str:
        if isinstance(result, list):
            return "|".join(
                SearchResultCache._result_signature(source_key, item)
                for item in result
            )
        if not isinstance(result, dict):
            return ""

        parts = [
            source_key,
            result.get("download_url")
            or result.get("url")
            or result.get("model_url")
            or "",
            result.get("filename") or result.get("path") or "",
            result.get("repo_id") or result.get("repo") or "",
            result.get("model_id") or "",
            result.get("version_id") or "",
            result.get("name") or "",
        ]
        return "::".join(str(part).strip() for part in parts)

    def stamp_result(
        self,
        source_key: str,
        result: Any,
        *,
        force_search: bool,
    ) -> Any:
        if isinstance(result, list):
            return [
                self.stamp_result(
                    source_key,
                    item,
                    force_search=force_search,
                )
                for item in result
            ]
        if not isinstance(result, dict):
            return result

        signature = self._result_signature(source_key, result)
        if not signature:
            return result

        timestamp = (
            result.get("searched_at")
            or result.get("searchedAt")
            or (
                None
                if force_search
                else self._timestamps.get(signature)
            )
        )
        if not timestamp:
            timestamp = self._current_timestamp()
        if force_search:
            self._timestamps[signature] = timestamp
        else:
            self._timestamps.setdefault(signature, timestamp)
        result["searched_at"] = timestamp
        return result

    def stamp_results(self, payload: dict[str, Any], *, force_search: bool):
        """Stamp all provider result collections in a search response."""
        for source_key in SEARCH_RESULT_KEYS:
            if payload.get(source_key):
                payload[source_key] = self.stamp_result(
                    source_key,
                    payload[source_key],
                    force_search=force_search,
                )
        return payload

"""
LoRA Manager Archive Source Module

Search archived CivitAI metadata stored by comfyui-lora-manager.
"""

import json
import os
import sqlite3
import re
import time
from typing import Any, Dict, List, Optional

from ..matcher import calculate_similarity_with_normalization, normalize_filename
from ..log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)

DEFAULT_LORA_MANAGER_DIR = "comfyui-lora-manager"
DEFAULT_DB_RELATIVE_PATH = os.path.join("civitai", "civitai.sqlite")

_search_cache: Dict[str, Any] = {}
_db_path_cache: Optional[str] = None
GENERIC_FILENAME_TOKENS = {
    "safetensors",
    "ckpt",
    "pt",
    "pth",
    "bin",
    "onnx",
    "gguf",
    "fp16",
    "fp32",
    "bf16",
    "e4m3fn",
    "scaled",
    "pruned",
    "emaonly",
}


def clear_search_cache():
    """Clear cached LoRA Manager archive search results."""
    global _search_cache
    _search_cache.clear()


def get_lora_manager_archive_db_path() -> Optional[str]:
    """Resolve the local comfyui-lora-manager archive database path."""
    global _db_path_cache

    if _db_path_cache is not None:
        return _db_path_cache if os.path.exists(_db_path_cache) else None

    env_path = os.environ.get("MODEL_LINKER_LORA_MANAGER_ARCHIVE_DB", "").strip()
    candidates: List[str] = []
    if env_path:
        candidates.append(env_path)

    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    custom_nodes_dir = os.path.dirname(repo_root)
    candidates.append(
        os.path.join(
            custom_nodes_dir,
            DEFAULT_LORA_MANAGER_DIR,
            DEFAULT_DB_RELATIVE_PATH,
        )
    )

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            _db_path_cache = os.path.abspath(candidate)
            log_info(
                f"LoRA Manager archive DB found at {_db_path_cache}"
            )
            return _db_path_cache

    log_debug("LoRA Manager archive DB not found")
    return None


def is_lora_manager_archive_available() -> bool:
    """Return True when the comfyui-lora-manager archive DB is available."""
    return get_lora_manager_archive_db_path() is not None


def _connect_readonly() -> Optional[sqlite3.Connection]:
    """Open the archive DB in read-only mode."""
    db_path = get_lora_manager_archive_db_path()
    if not db_path:
        return None

    try:
        uri = f"file:{db_path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        log_warn(f"Failed to open LoRA Manager archive DB: {e}")
        return None


def _normalize_model_type(model_type: Optional[str]) -> str:
    value = str(model_type or "").strip().lower()
    type_map = {
        "lora": "lora",
        "loras": "lora",
        "lycoris": "lycoris",
        "checkpoint": "checkpoint",
        "checkpoints": "checkpoint",
        "vae": "vae",
        "controlnet": "controlnet",
        "embedding": "textualinversion",
        "embeddings": "textualinversion",
        "textualinversion": "textualinversion",
        "upscaler": "upscaler",
        "upscale_models": "upscaler",
    }
    return type_map.get(value, value)


def _calculate_confidence(
    query: str, model_name: str, version_name: str = "", filename: str = ""
) -> float:
    candidates = [value for value in [model_name, version_name, filename] if value]
    if not candidates:
        return 0.0

    query_norm = normalize_filename(query)
    best = 0.0

    for candidate in candidates:
        candidate_norm = normalize_filename(candidate)
        if query_norm == candidate_norm:
            return 100.0

        similarity = calculate_similarity_with_normalization(query, candidate)
        similarity_no_ext = calculate_similarity_with_normalization(
            os.path.splitext(query)[0], os.path.splitext(candidate)[0]
        )
        candidate_score = max(similarity, similarity_no_ext)

        if query_norm in candidate_norm or candidate_norm in query_norm:
            candidate_score = max(candidate_score, 0.85)

        best = max(best, candidate_score)

    return round(best * 100, 1)


def _extract_search_tokens(query: str) -> Dict[str, List[str]]:
    """Split filename/model query into useful content/version tokens."""
    base_query = os.path.splitext(os.path.basename(query or ""))[0]
    raw_tokens = [
        token.lower()
        for token in re.split(r"[^a-zA-Z0-9]+", base_query)
        if token and token.strip()
    ]

    content_terms: List[str] = []
    version_terms: List[str] = []
    seen = set()

    for token in raw_tokens:
        if token in seen:
            continue
        seen.add(token)

        if token in GENERIC_FILENAME_TOKENS:
            continue
        if re.fullmatch(r"v\d+", token):
            version_terms.append(token)
            continue
        if re.fullmatch(r"\d+", token):
            continue
        if len(token) < 3:
            continue

        content_terms.append(token)

    return {
        "content_terms": content_terms,
        "version_terms": version_terms,
    }


def _extract_primary_file(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not files:
        return None

    for file_info in files:
        if file_info.get("primary"):
            return file_info

    for file_info in files:
        if str(file_info.get("type", "")).lower() == "model":
            return file_info

    return files[0]


def _load_version_files(
    conn: sqlite3.Connection, version_id: int
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT data
        FROM model_files
        WHERE version_id = ? AND type = 'Model'
        ORDER BY id ASC
        """,
        (version_id,),
    ).fetchall()

    files: List[Dict[str, Any]] = []
    for row in rows:
        try:
            data = json.loads(row["data"])
        except Exception:
            continue

        if not isinstance(data, dict):
            continue

        mirrors = data.get("mirrors") or []
        if not isinstance(mirrors, list):
            mirrors = [mirrors]

        available_mirror = next(
            (
                mirror
                for mirror in mirrors
                if isinstance(mirror, dict) and mirror.get("deletedAt") is None
            ),
            None,
        )

        download_url = data.get("downloadUrl") or (
            available_mirror.get("url") if available_mirror else None
        )
        file_name = data.get("name") or (
            available_mirror.get("filename") if available_mirror else None
        )

        files.append(
            {
                "id": data.get("id"),
                "name": file_name,
                "type": data.get("type"),
                "sizeKB": data.get("sizeKB"),
                "downloadUrl": download_url,
                "primary": bool(data.get("primary", False)),
                "hashes": data.get("hashes", {}),
                "metadata": data.get("metadata"),
            }
        )

    return files


def _query_candidate_rows(
    conn: sqlite3.Connection,
    query: str,
    model_type: str,
    limit: int,
) -> List[sqlite3.Row]:
    """Query a limited pool of candidate rows using selective token filters."""
    tokens = _extract_search_tokens(query)
    content_terms = tokens["content_terms"]
    version_terms = tokens["version_terms"]

    if not content_terms and not version_terms:
        return []

    candidate_limit = max(limit * 20, 50)
    first_term = content_terms[0] if content_terms else ""
    second_term = content_terms[1] if len(content_terms) > 1 else ""
    version_term = version_terms[0] if version_terms else ""

    query_plans = []

    if first_term and second_term and version_term:
        query_plans.append(
            (
                """
                SELECT
                    m.id AS model_id,
                    m.name AS model_name,
                    m.type AS model_type,
                    v.id AS version_id,
                    v.name AS version_name,
                    v.base_model AS base_model,
                    v.position AS position
                FROM models m
                JOIN model_versions v ON v.model_id = m.id
                WHERE m.name LIKE ? COLLATE NOCASE
                  AND m.name LIKE ? COLLATE NOCASE
                  AND v.name LIKE ? COLLATE NOCASE
                """,
                [f"%{first_term}%", f"%{second_term}%", f"%{version_term}%"],
            )
        )

    if first_term and second_term:
        query_plans.append(
            (
                """
                SELECT
                    m.id AS model_id,
                    m.name AS model_name,
                    m.type AS model_type,
                    v.id AS version_id,
                    v.name AS version_name,
                    v.base_model AS base_model,
                    v.position AS position
                FROM models m
                JOIN model_versions v ON v.model_id = m.id
                WHERE m.name LIKE ? COLLATE NOCASE
                  AND m.name LIKE ? COLLATE NOCASE
                """,
                [f"%{first_term}%", f"%{second_term}%"],
            )
        )

    if first_term and version_term:
        query_plans.append(
            (
                """
                SELECT
                    m.id AS model_id,
                    m.name AS model_name,
                    m.type AS model_type,
                    v.id AS version_id,
                    v.name AS version_name,
                    v.base_model AS base_model,
                    v.position AS position
                FROM models m
                JOIN model_versions v ON v.model_id = m.id
                WHERE m.name LIKE ? COLLATE NOCASE
                  AND v.name LIKE ? COLLATE NOCASE
                """,
                [f"%{first_term}%", f"%{version_term}%"],
            )
        )

    if first_term:
        query_plans.append(
            (
                """
                SELECT
                    m.id AS model_id,
                    m.name AS model_name,
                    m.type AS model_type,
                    v.id AS version_id,
                    v.name AS version_name,
                    v.base_model AS base_model,
                    v.position AS position
                FROM models m
                JOIN model_versions v ON v.model_id = m.id
                WHERE m.name LIKE ? COLLATE NOCASE
                """,
                [f"%{first_term}%"],
            )
        )

    if version_term:
        query_plans.append(
            (
                """
                SELECT
                    m.id AS model_id,
                    m.name AS model_name,
                    m.type AS model_type,
                    v.id AS version_id,
                    v.name AS version_name,
                    v.base_model AS base_model,
                    v.position AS position
                FROM models m
                JOIN model_versions v ON v.model_id = m.id
                WHERE v.name LIKE ? COLLATE NOCASE
                """,
                [f"%{version_term}%"],
            )
        )

    seen_versions = set()
    candidates: List[sqlite3.Row] = []

    for sql, params in query_plans:
        if model_type:
            sql += " AND m.type = ?"
            params.append(model_type.upper())
        sql += " ORDER BY m.id ASC, COALESCE(v.position, 999999) ASC LIMIT ?"
        params.append(candidate_limit)

        rows = conn.execute(sql, tuple(params)).fetchall()
        for row in rows:
            version_id = row["version_id"]
            if version_id in seen_versions:
                continue
            seen_versions.add(version_id)
            candidates.append(row)

        if len(candidates) >= candidate_limit:
            break

    return candidates


def _load_full_rows_for_versions(
    conn: sqlite3.Connection, version_ids: List[int]
) -> Dict[int, sqlite3.Row]:
    """Fetch full JSON payload rows for selected version ids."""
    if not version_ids:
        return {}

    placeholders = ",".join("?" for _ in version_ids)
    rows = conn.execute(
        f"""
        SELECT
            m.id AS model_id,
            m.name AS model_name,
            m.type AS model_type,
            m.data AS model_data,
            v.id AS version_id,
            v.name AS version_name,
            v.base_model AS base_model,
            v.data AS version_data,
            v.position AS position
        FROM models m
        JOIN model_versions v ON v.model_id = m.id
        WHERE v.id IN ({placeholders})
        """,
        tuple(version_ids),
    ).fetchall()
    return {row["version_id"]: row for row in rows}


def _build_result_from_row(
    conn: sqlite3.Connection, row: sqlite3.Row, query: str
) -> Optional[Dict[str, Any]]:
    try:
        model_data = json.loads(row["model_data"] or "{}")
    except Exception:
        model_data = {}

    try:
        version_data = json.loads(row["version_data"] or "{}")
    except Exception:
        version_data = {}

    model_id = row["model_id"]
    version_id = row["version_id"]
    files = _load_version_files(conn, version_id)
    primary_file = _extract_primary_file(files)
    filename = (
        primary_file.get("name")
        if primary_file
        else version_data.get("files", [{}])[0].get("name", "")
        if isinstance(version_data.get("files"), list) and version_data.get("files")
        else ""
    )

    tags = model_data.get("tags", [])
    if not isinstance(tags, list):
        tags = [tags] if tags else []

    trained_words = version_data.get("trainedWords", [])
    if isinstance(trained_words, str):
        trained_words = [trained_words]
    elif not isinstance(trained_words, list):
        trained_words = []

    confidence = _calculate_confidence(
        query,
        row["model_name"] or "",
        row["version_name"] or "",
        filename,
    )
    match_type = "exact" if confidence == 100.0 else "similar"

    return {
        "source": "lora_manager_archive",
        "model_id": model_id,
        "version_id": version_id,
        "name": row["model_name"],
        "version_name": row["version_name"],
        "type": row["model_type"],
        "filename": filename,
        "url": f"https://civitai.com/models/{model_id}?modelVersionId={version_id}",
        "download_url": primary_file.get("downloadUrl") if primary_file else None,
        "size": (
            int((primary_file.get("sizeKB") or 0) * 1024)
            if primary_file and primary_file.get("sizeKB") is not None
            else None
        ),
        "base_model": row["base_model"] or version_data.get("baseModel"),
        "tags": tags,
        "trained_words": trained_words,
        "images": version_data.get("images", []),
        "description": model_data.get("description", ""),
        "model_description": model_data.get("description", ""),
        "creator": model_data.get("creator", {}),
        "files": files,
        "match_type": match_type,
        "confidence": confidence,
    }


def search_lora_manager_archive(
    query: str, model_type: Optional[str] = None, limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Search the local comfyui-lora-manager CivitAI archive by model name.

    Args:
        query: Model name or filename fragment
        model_type: Optional CivitAI model type filter
        limit: Maximum number of results

    Returns:
        Matching archived models sorted by confidence
    """
    normalized_query = (query or "").strip()
    if not normalized_query:
        return []

    normalized_type = _normalize_model_type(model_type)
    cache_key = f"search::{normalized_query.lower()}::{normalized_type}::{limit}"
    if cache_key in _search_cache:
        return list(_search_cache[cache_key])

    conn = _connect_readonly()
    if conn is None:
        return []

    try:
        started_at = time.perf_counter()
        candidate_rows = _query_candidate_rows(
            conn, normalized_query, normalized_type, limit
        )
        if not candidate_rows:
            elapsed = time.perf_counter() - started_at
            log_info(
                f"LoRA Manager archive search: query={normalized_query}, type={normalized_type or 'all'}, results=0, candidates=0, elapsed={elapsed:.3f}s"
            )
            _search_cache[cache_key] = []
            return []

        scored_candidates = []
        for row in candidate_rows:
            confidence = _calculate_confidence(
                normalized_query,
                row["model_name"] or "",
                row["version_name"] or "",
                "",
            )
            if confidence < 40:
                continue
            scored_candidates.append((confidence, row))

        scored_candidates.sort(
            key=lambda item: (
                item[0],
                1 if item[1]["version_name"] else 0,
            ),
            reverse=True,
        )
        selected_version_ids = [
            row["version_id"] for _, row in scored_candidates[: max(limit * 3, limit)]
        ]
        full_rows = _load_full_rows_for_versions(conn, selected_version_ids)

        results = []
        for _, candidate_row in scored_candidates:
            version_id = candidate_row["version_id"]
            full_row = full_rows.get(version_id)
            if not full_row:
                continue
            result = _build_result_from_row(conn, full_row, normalized_query)
            if not result or result["confidence"] < 40:
                continue
            results.append(result)

        results.sort(
            key=lambda item: (
                item.get("confidence", 0),
                1 if item.get("match_type") == "exact" else 0,
            ),
            reverse=True,
        )
        results = results[:limit]
        _search_cache[cache_key] = list(results)
        elapsed = time.perf_counter() - started_at
        log_info(
            f"LoRA Manager archive search: query={normalized_query}, type={normalized_type or 'all'}, results={len(results)}, candidates={len(candidate_rows)}, elapsed={elapsed:.3f}s"
        )
        return results
    except Exception as e:
        log_exception(f"LoRA Manager archive search error for {query}: {e}")
        return []
    finally:
        conn.close()


def search_lora_manager_archive_for_file(
    filename: str,
    model_type: Optional[str] = None,
    exact_only: bool = False,
    limit: int = 10,
) -> Optional[Dict[str, Any]]:
    """
    Search the archive for the best model/version match for a filename.
    """
    search_query = os.path.splitext(os.path.basename(filename or ""))[0]
    if not search_query:
        return None

    cache_key = (
        f"file::{filename.lower()}::{_normalize_model_type(model_type)}::{exact_only}::{limit}"
    )
    if cache_key in _search_cache:
        return _search_cache[cache_key]

    candidates = search_lora_manager_archive(
        search_query, model_type=model_type, limit=limit
    )
    best_match = None
    best_confidence = 0.0

    for candidate in candidates:
        candidate_filename = candidate.get("filename", "")
        confidence = _calculate_confidence(filename, candidate.get("name", ""), candidate.get("version_name", ""), candidate_filename)
        if exact_only and confidence < 100.0:
            continue
        if confidence > best_confidence:
            best_confidence = confidence
            best_match = dict(candidate)
            best_match["confidence"] = confidence
            best_match["match_type"] = "exact" if confidence == 100.0 else "similar"
        if confidence == 100.0:
            break

    if best_match is None and exact_only:
        _search_cache[cache_key] = None
        return None

    _search_cache[cache_key] = best_match
    return best_match

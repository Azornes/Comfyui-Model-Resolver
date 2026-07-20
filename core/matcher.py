"""
Fuzzy Matcher Module

Implements fuzzy string matching to find similar model names.
"""

import heapq
import os
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple

from .log_system import create_module_logger

log = create_module_logger(__name__)

from .path_utils import get_filename_from_path

try:
    from rapidfuzz import fuzz as rapidfuzz_fuzz
except ImportError:
    rapidfuzz_fuzz = None


MODEL_TITLE_MATCH_THRESHOLD = 82.0


def normalize_filename(filename: str) -> str:
    """
    Normalize a filename for comparison.

    Removes file extension, converts to lowercase, and normalizes
    separators (underscores, hyphens, spaces).

    Args:
        filename: Filename to normalize

    Returns:
        Normalized string for comparison
    """
    # Remove file extension
    base = os.path.splitext(filename)[0]

    # Convert to lowercase
    base = base.lower()

    # Normalize separators: replace underscores, hyphens, dots, and spaces with a single space
    base = re.sub(r"[_\-\.\s]+", " ", base)

    # Strip whitespace
    base = base.strip()

    return base


def calculate_similarity(str1: str, str2: str) -> float:
    """
    Calculate similarity score between two strings (0.0 to 1.0).

    Uses RapidFuzz when available, with SequenceMatcher as a fallback.

    Args:
        str1: First string
        str2: Second string

    Returns:
        Similarity score from 0.0 (completely different) to 1.0 (identical)
    """
    if rapidfuzz_fuzz is not None:
        return rapidfuzz_fuzz.ratio(str1, str2) / 100.0

    return SequenceMatcher(None, str1, str2).ratio()


def calculate_similarity_with_normalization(str1: str, str2: str) -> float:
    """
    Calculate similarity score with filename normalization.

    Normalizes both strings before comparing.

    Args:
        str1: First string (typically model filename)
        str2: Second string (typically candidate model filename)

    Returns:
        Similarity score from 0.0 to 1.0
    """
    norm1 = normalize_filename(str1)
    norm2 = normalize_filename(str2)
    return calculate_similarity(norm1, norm2)


def find_matches(
    target_model: str,
    candidate_models: List[Dict[str, str]],
    threshold: float = 0.0,
    max_results: int = 10,
) -> List[Dict[str, any]]:
    """
    Find similar models using fuzzy matching.

    Args:
        target_model: The target model filename/path to match
        candidate_models: List of candidate model dictionaries with 'filename' or 'path' key
        threshold: Minimum similarity score (0.0 to 1.0) to include in results
        max_results: Maximum number of results to return

    Returns:
        List of match dictionaries sorted by similarity (highest first):
        {
            'model': original model dict from candidates,
            'filename': model filename,
            'similarity': similarity score (0.0 to 1.0),
            'confidence': confidence percentage (0 to 100)
        }
    """
    # Keep only the best N matches instead of collecting and sorting everything.
    best_matches = []
    match_counter = 0

    # Normalize path separators in target_model based on current OS
    # This ensures paths with \ vs / separators are treated as identical
    target_model_normalized = os.path.normpath(target_model) if target_model else ""

    # Extract just the filename from target_model (remove any subfolder paths)
    # target_model might be just a filename or might include subfolder paths
    target_filename = get_filename_from_path(target_model_normalized)

    # Normalize target filename once for exact match comparisons
    target_norm = normalize_filename(target_filename)

    for candidate in candidate_models:
        # Get filename from candidate (prefer 'filename' key, fallback to extracting from 'path' or 'relative_path')
        candidate_filename = candidate.get("filename")
        candidate_path = candidate.get("path", "") or candidate.get("relative_path", "")

        # If no filename key, try to extract from path or relative_path
        if not candidate_filename and candidate_path:
            candidate_filename = get_filename_from_path(candidate_path)

        if not candidate_filename:
            continue

        # Normalize candidate path separators based on current OS
        # This ensures paths with \ vs / separators are treated as identical
        candidate_path_normalized = candidate.get("_match_path_norm")
        if candidate_path_normalized is None:
            candidate_path_normalized = (
                os.path.normpath(candidate_path) if candidate_path else ""
            )
            candidate["_match_path_norm"] = candidate_path_normalized

        candidate_relative_path = candidate.get("relative_path", "")
        candidate_relative_path_normalized = candidate.get("_match_relative_path_norm")
        if candidate_relative_path_normalized is None:
            candidate_relative_path_normalized = (
                os.path.normpath(candidate_relative_path) if candidate_relative_path else ""
            )
            candidate["_match_relative_path_norm"] = candidate_relative_path_normalized

        # Check if normalized paths are identical (100% match)
        # This handles cases where paths differ only by separator (e.g., path/to/model vs path\to\model)
        # Compare both absolute paths and relative paths
        path_match = False
        if candidate_path_normalized and target_model_normalized:
            if candidate_path_normalized == target_model_normalized:
                path_match = True
        elif (
            candidate_relative_path_normalized
            and target_model_normalized
            and candidate_relative_path_normalized == target_model_normalized
        ):
            # Also check if relative path matches the target (which might be relative)
            path_match = True

        if path_match:
            # Exact path match after normalization = 100% confidence
            similarity = 1.0
            match = {
                "model": candidate,
                "filename": candidate_filename,
                "similarity": similarity,
                "confidence": round(similarity * 100, 1),
            }
            if max_results <= 0:
                return []
            entry = (similarity, match_counter, match)
            match_counter += 1
            if len(best_matches) < max_results:
                heapq.heappush(best_matches, entry)
            elif similarity > best_matches[0][0]:
                heapq.heapreplace(best_matches, entry)
            continue

        # Calculate similarity comparing just filenames (not paths)
        # This ensures we're comparing apples to apples

        # First check for exact match (after normalization) - should be 100%
        # Only exact matches should get 100% confidence
        candidate_norm = candidate.get("_match_filename_norm")
        if candidate_norm is None:
            candidate_norm = normalize_filename(candidate_filename)
            candidate["_match_filename_norm"] = candidate_norm

        if target_norm == candidate_norm:
            similarity = 1.0
            confidence = 100.0
        else:
            confidence = calculate_filename_confidence(target_filename, candidate_filename)
            similarity = confidence / 100.0

        # Only include if above threshold
        if similarity >= threshold:
            match = {
                "model": candidate,
                "filename": candidate_filename,
                "similarity": similarity,
                "confidence": confidence,
            }
            if max_results <= 0:
                return []
            entry = (similarity, match_counter, match)
            match_counter += 1
            if len(best_matches) < max_results:
                heapq.heappush(best_matches, entry)
            elif similarity > best_matches[0][0]:
                heapq.heapreplace(best_matches, entry)

    return [match for _, _, match in sorted(best_matches, key=lambda x: x[0], reverse=True)]


def normalize_base_model(value: str) -> str:
    """
    Normalize a base model name to standard alphanumeric lowercase format.
    
    Args:
        value: The base model name to normalize
        
    Returns:
        Normalized base model name
    """
    from .type_utils import normalize_alphanumeric_key
    return normalize_alphanumeric_key(value)


def base_model_matches(candidate: str, preferred: Optional[str]) -> bool:
    """
    Check if a candidate base model matches a preferred base model family.
    
    Args:
        candidate: Candidate base model name
        preferred: Preferred base model name
        
    Returns:
        True if the candidate base model is a match for the preferred family, False otherwise.
    """
    preferred_norm = normalize_base_model(preferred or "")
    if not preferred_norm:
        return True

    candidate_norm = normalize_base_model(candidate or "")
    if not candidate_norm:
        return False

    from .sources.popular import load_base_model_aliases
    aliases = load_base_model_aliases()
    # Exact alias membership check - avoids false positives from substring matching
    # e.g. prevents "zimage" (Z-Image alias) from matching "zimagebase" (ZImageBase)
    preferred_tokens = aliases.get(preferred_norm, [preferred_norm])
    if candidate_norm in preferred_tokens:
        return True
    # Symmetric check: if preferred is an alias of candidate's model family
    candidate_tokens = aliases.get(candidate_norm, [candidate_norm])
    return preferred_norm in candidate_tokens


def base_model_score(candidate: str, preferred: Optional[str]) -> float:
    """
    Calculate a score for a base model match (1000.0 if matches, -1000.0 otherwise).
    
    Args:
        candidate: Candidate base model name
        preferred: Preferred base model name
        
    Returns:
        Match score
    """
    if not preferred:
        return 0.0
    return 1000.0 if base_model_matches(candidate, preferred) else -1000.0


# ==================== CENTRALIZED MATCHING & CONFIDENCE HELPERS ====================

from .type_utils import MODEL_EXTENSIONS, TECHNICAL_MODEL_SUFFIXES, get_version_sort_key

MODEL_FILE_EXTENSIONS = MODEL_EXTENSIONS

_TECHNICAL_VARIANT_TOKENS = {
    *TECHNICAL_MODEL_SUFFIXES,
}
_TECHNICAL_VARIANT_TOKEN_RE = re.compile(
    r"^(?:(?:bf|bfloat|fp|float|int|uint|f|i)\d+|"
    r"(?:i?q|tq)\d+|(?:mxfp|nvfp)\d+|e\d+m\d+(?:fnuz|fn)?|bnb\d+)$",
    re.IGNORECASE,
)
_QUANTIZATION_HEAD_TOKEN_RE = re.compile(r"^(?:i?q|tq)\d+$", re.IGNORECASE)
_QUANTIZATION_TAIL_TOKENS = {
    "0",
    "1",
    "4",
    "8",
    "k",
    "m",
    "s",
    "l",
    "xl",
    "xs",
    "xxs",
    "nl",
}
_MODEL_CAPACITY_TOKEN_RE = re.compile(r"^\d+(?:\.\d+)?[bmk]$", re.IGNORECASE)


def strip_known_model_extension(filename: str) -> str:
    """Strip only known model extensions, preserving names like v4.0."""
    if not isinstance(filename, str):
        return ""

    lowered = filename.lower()
    for ext in MODEL_FILE_EXTENSIONS:
        if lowered.endswith(ext):
            return filename[: -len(ext)]
    return filename


def has_known_model_extension(filename: str) -> bool:
    """Check if a filename ends with a known model extension."""
    return strip_known_model_extension(filename) != filename


def normalize_model_title(value: str) -> str:
    """Normalize model title for comparison."""
    value = strip_known_model_extension(str(value or "")).lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_model_family_filename(filename: str) -> str:
    """Normalize a filename while ignoring precision and quantization variants."""
    normalized_filename = normalize_filename(filename)
    normalized_filename = re.sub(r"\bema\s+only\b", "emaonly", normalized_filename)
    tokens = normalized_filename.split()
    family_tokens = []
    quantization_tail = False

    for token in tokens:
        token_lower = token.lower()
        is_quantization_token = bool(
            _TECHNICAL_VARIANT_TOKEN_RE.fullmatch(token_lower)
        )
        if token_lower in _TECHNICAL_VARIANT_TOKENS or is_quantization_token:
            quantization_tail = bool(
                _QUANTIZATION_HEAD_TOKEN_RE.fullmatch(token_lower)
            )
            continue
        if quantization_tail and token_lower in _QUANTIZATION_TAIL_TOKENS:
            continue

        quantization_tail = False
        family_tokens.append(token_lower)

    return " ".join(family_tokens)


def _get_model_family_signature(normalized_family_name: str) -> Optional[Tuple[str, str]]:
    """Return the architecture prefix and parameter count when both are available."""
    tokens = normalized_family_name.split()
    for index, token in enumerate(tokens):
        if not _MODEL_CAPACITY_TOKEN_RE.fullmatch(token):
            continue
        architecture = "".join(tokens[:index])
        if len(architecture) >= 3 and re.search(r"[a-z]", architecture):
            return architecture, token
    return None


def _architectures_have_numeric_conflict(left: str, right: str) -> bool:
    """Detect otherwise-identical architecture names with different generations."""
    left_digits = re.findall(r"\d+", left)
    right_digits = re.findall(r"\d+", right)
    if not left_digits or not right_digits or left_digits == right_digits:
        return False
    return re.sub(r"\d+", "", left) == re.sub(r"\d+", "", right)


def calculate_model_title_confidence(query: str, model_name: str) -> float:
    """Calculate confidence score (0.0 to 100.0) for a model title matching a query."""
    query_norm = normalize_model_title(query)
    model_norm = normalize_model_title(model_name)
    if not query_norm or not model_norm:
        return 0.0

    if query_norm == model_norm:
        return 100.0

    return round(
        max(
            calculate_similarity_with_normalization(query_norm, model_norm),
            calculate_similarity_with_normalization(
                query_norm.replace(" ", ""), model_norm.replace(" ", "")
            ),
        )
        * 100,
        1,
    )


def calculate_filename_confidence(target_filename: str, candidate_filename: str) -> float:
    """Calculate similarity confidence percentage (0.0 to 100.0) between two filenames."""
    target_norm = normalize_filename(target_filename)
    candidate_norm = normalize_filename(candidate_filename)

    if target_norm == candidate_norm:
        return 100.0

    best_similarity = calculate_similarity(target_norm, candidate_norm)
    target_family = normalize_model_family_filename(target_filename)
    candidate_family = normalize_model_family_filename(candidate_filename)

    if target_family and candidate_family:
        family_similarity = calculate_similarity(target_family, candidate_family)
        target_signature = _get_model_family_signature(target_family)
        candidate_signature = _get_model_family_signature(candidate_family)

        if target_family == candidate_family:
            # Same model name with a different precision or quantization is a
            # strong alternative, but remains below an exact filename match.
            best_similarity = max(best_similarity, 0.94)
        else:
            best_similarity = max(best_similarity, family_similarity)

        if (
            target_family != candidate_family
            and target_signature
            and target_signature == candidate_signature
        ):
            target_tokens = set(target_family.split())
            candidate_tokens = set(candidate_family.split())
            if target_tokens.issubset(candidate_tokens) or candidate_tokens.issubset(
                target_tokens
            ):
                # One filename adds a semantic variant such as "abliterated".
                best_similarity = max(best_similarity, 0.90)
            else:
                # The architecture and size agree, but both names contain
                # different semantic modifiers such as "base" and "heretic".
                best_similarity = max(best_similarity, 0.84)
        elif (
            target_family != candidate_family
            and target_signature
            and candidate_signature
        ):
            target_architecture, target_capacity = target_signature
            candidate_architecture, candidate_capacity = candidate_signature
            if target_architecture == candidate_architecture and target_capacity != candidate_capacity:
                # A 4B model is not an interchangeable precision variant of 8B.
                best_similarity = min(best_similarity, 0.69)
            elif (
                target_capacity == candidate_capacity
                and _architectures_have_numeric_conflict(
                    target_architecture, candidate_architecture
                )
            ):
                # Keep adjacent generations such as Qwen2 and Qwen3 out of the
                # visible recommendation threshold unless another exact signal exists.
                best_similarity = min(best_similarity, 0.69)

    # Cap similarity at 0.999 for non-exact matches to prevent false 100% scores
    if best_similarity >= 0.999:
        best_similarity = 0.999

    return round(best_similarity * 100, 1)


def calculate_archived_model_confidence(
    query: str,
    model_name: str = "",
    version_name: str = "",
    filename: str = "",
) -> float:
    """Calculate confidence score (0.0 to 100.0) for a model in an archive matching a query."""
    candidates = [value for value in [filename, model_name, version_name] if value]
    if not candidates:
        return 0.0

    query_norm = normalize_filename(query)
    best = 0.0
    for candidate in candidates:
        candidate_norm = normalize_filename(candidate)
        if query_norm == candidate_norm:
            return 100.0

        score = calculate_filename_confidence(query, candidate) / 100.0
        if query_norm and candidate_norm and (
            query_norm in candidate_norm or candidate_norm in query_norm
        ):
            score = max(score, 0.85)
        best = max(best, score)

    return round(best * 100, 1)


def calculate_candidate_rank(
    confidence: float,
    base_model: Optional[str],
    base_model_context: Optional[str],
) -> Tuple[bool, float]:
    """Calculate whether base model matches context and compute candidate's final rank score."""
    matches = base_model_matches(base_model, base_model_context)
    score = base_model_score(base_model, base_model_context)
    return matches, confidence + score


def build_filename_search_queries(filename: str) -> List[str]:
    """
    Build a list of candidate search queries from a filename by stripping
    extensions and common precision/format suffixes (e.g. fp16, bf16, pruned).
    """
    basename = get_filename_from_path(filename).strip()
    if not basename:
        return []

    stem = os.path.splitext(basename)[0].strip()
    stem_lower = stem.lower()

    literal_suffixes = sorted(
        (re.escape(token) for token in TECHNICAL_MODEL_SUFFIXES),
        key=len,
        reverse=True,
    )
    technical_token_pattern = (
        r"(?:^|[-_.\s])(?:"
        + "|".join(
            [
                *literal_suffixes,
                r"(?:bf|bfloat|fp|float|int|uint|f|i)\d+",
                r"(?:i?q|tq)\d+",
                r"(?:mxfp|nvfp)\d+",
                r"e\d+m\d+(?:fnuz|fn)?",
                r"bnb\d+",
            ]
        )
        + r")(?=$|[-_.\s])"
    )

    technical_match = re.search(technical_token_pattern, stem, flags=re.IGNORECASE)
    cleaned = (
        stem[: technical_match.start()] if technical_match else stem
    ).strip(" -_.")
    cleaned_lower = cleaned.lower()

    simplified = cleaned_lower

    queries = []
    for query in [basename, stem, stem_lower, cleaned, cleaned_lower, simplified]:
        query_val = (query or "").strip(" -_")
        if query_val and query_val not in queries:
            queries.append(query_val)

    return queries


def match_model_by_title_generic(
    model_id: int,
    title_query: str,
    model_name: str,
    versions: list,
    base_model_context: Optional[str],
    get_base_model_fn,
    select_file_fn,
    build_result_fn,
    hydrate_version_fn=None,
    log_prefix: str = "ModelResolver",
) -> Optional[Dict[str, Any]]:
    """Generic helper to resolve extensionless workflow values by model title across CivitAI and CivArchive."""

    title_confidence = calculate_model_title_confidence(title_query, model_name)
    if title_confidence < MODEL_TITLE_MATCH_THRESHOLD:
        log.debug(
            f"{log_prefix} title candidate rejected: model_id={model_id}, query={title_query}, model_name={model_name}, confidence={title_confidence}"
        )
        return None

    if not versions:
        return None

    # Sort versions
    versions = sorted(versions, key=get_version_sort_key, reverse=True)
    rejected_by_base_model = False

    for version in versions:
        hydrated_version = hydrate_version_fn(version) if hydrate_version_fn else version

        # Check base model context
        if base_model_context:
            base_model = get_base_model_fn(hydrated_version)
            if not base_model_matches(base_model, base_model_context):
                rejected_by_base_model = True
                continue

        # Select file
        file_info = select_file_fn(hydrated_version)
        if not file_info:
            continue

        # Build result
        result = build_result_fn(hydrated_version, file_info, title_confidence)
        if not result:
            continue

        result["confidence"] = title_confidence
        result["title_confidence"] = title_confidence

        log.info(
            f"{log_prefix} model-title match: query={title_query}, model_id={model_id}, model_name={model_name}, version_id={result.get('version_id')}, filename={result.get('filename')}, confidence={title_confidence}, base={result.get('base_model')}"
        )
        return result

    if rejected_by_base_model:
        log.debug(
            f"{log_prefix} title candidate rejected by base model: model_id={model_id}, base={base_model_context}"
        )

    return None


def should_update_best_match(
    confidence: float,
    base_model: Optional[str],
    base_model_context: Optional[str],
    best_rank: float,
    exact_only: bool = False,
) -> Tuple[bool, float, bool]:
    """
    Check if a candidate match is better than the current best.
    Returns (should_update, candidate_rank, base_model_matches).
    """
    if exact_only and confidence < 100.0:
        return False, -9999.0, False
    bm_matches, rank = calculate_candidate_rank(
        confidence, base_model, base_model_context
    )
    if rank > best_rank:
        return True, rank, bm_matches
    return False, rank, bm_matches


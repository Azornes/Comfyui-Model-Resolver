"""
Fuzzy Matcher Module

Implements fuzzy string matching to find similar model names.
"""

import os
import re
import heapq
from typing import List, Dict, Tuple, Optional
from difflib import SequenceMatcher

from .log_system import create_module_logger
log = create_module_logger(__name__)

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
    target_filename = os.path.basename(target_model_normalized)

    # Normalize target filename once for exact match comparisons
    target_norm = normalize_filename(target_filename)
    target_base = os.path.splitext(target_filename)[0]

    for candidate in candidate_models:
        # Get filename from candidate (prefer 'filename' key, fallback to extracting from 'path' or 'relative_path')
        candidate_filename = candidate.get("filename")
        candidate_path = candidate.get("path", "") or candidate.get("relative_path", "")

        # If no filename key, try to extract from path or relative_path
        if not candidate_filename:
            if candidate_path:
                candidate_filename = os.path.basename(candidate_path)

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
        elif candidate_relative_path_normalized and target_model_normalized:
            # Also check if relative path matches the target (which might be relative)
            if candidate_relative_path_normalized == target_model_normalized:
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
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


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

from .type_utils import MODEL_EXTENSIONS, PRECISION_FORMAT_SUFFIXES
MODEL_FILE_EXTENSIONS = MODEL_EXTENSIONS


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

    best_similarity = calculate_similarity_with_normalization(
        target_filename, candidate_filename
    )
    
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

        score = calculate_similarity_with_normalization(query, candidate)
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


def clean_filename_for_search(filename: str) -> str:
    """
    Clean up filename for better search results.
    Remove common suffixes that might prevent matches.
    """
    if not filename:
        return ""
    basename = os.path.basename(filename).strip()
    base = os.path.splitext(basename)[0]
    pattern = r"[-_]?(" + "|".join(PRECISION_FORMAT_SUFFIXES) + r").*$"
    return re.sub(pattern, "", base, flags=re.IGNORECASE).strip(" -_")


def build_filename_search_queries(filename: str) -> List[str]:
    """
    Build a list of candidate search queries from a filename by stripping
    extensions and common precision/format suffixes (e.g. fp16, bf16, pruned).
    """
    basename = os.path.basename(filename or "").strip()
    if not basename:
        return []
        
    stem = os.path.splitext(basename)[0].strip()
    stem_lower = stem.lower()
    
    # Pattern to match common precision/format suffixes
    pattern = r"[-_]?(" + "|".join(PRECISION_FORMAT_SUFFIXES) + r")"
    
    # 1. Strip suffix followed by any other characters (like clean_filename_for_search)
    cleaned = re.sub(pattern + r".*$", "", stem, flags=re.IGNORECASE).strip(" -_")
    cleaned_lower = cleaned.lower()
    
    # 2. Strip suffix at the end of the stem (like simplified in search queries)
    simplified = re.sub(pattern + r"$", "", stem_lower, flags=re.IGNORECASE).strip(" -_")
    
    queries = []
    for query in [basename, stem, stem_lower, cleaned, cleaned_lower, simplified]:
        query_val = (query or "").strip(" -_")
        if query_val and query_val not in queries:
            queries.append(query_val)
            
    return queries

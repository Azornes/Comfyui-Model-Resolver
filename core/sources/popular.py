"""
Popular Models Database

Curated list of common models with known download URLs.
"""

import os
import json
import re
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

from ..log_system.log_funcs import (
    log_debug,
    log_info,
    log_warn,
    log_error,
    log_exception,
)

# Path to metadata directory
METADATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "metadata"
)
POPULAR_MODELS_FILE = os.path.join(METADATA_DIR, "popular-models.json")
MODEL_ALIASES_FILE = os.path.join(METADATA_DIR, "model-aliases.json")
BASE_MODELS_FILE = os.path.join(METADATA_DIR, "base-models.json")

# Cache for loaded data
_popular_models_cache: Optional[Dict] = None
_model_aliases_cache: Optional[Dict] = None
_base_models_aliases_cache: Optional[Dict[str, List[str]]] = None


def _load_popular_models() -> Dict[str, Any]:
    """Load popular models database."""
    global _popular_models_cache

    if _popular_models_cache is not None:
        return _popular_models_cache

    try:
        if os.path.exists(POPULAR_MODELS_FILE):
            with open(POPULAR_MODELS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _popular_models_cache = data.get("models", {})
                return _popular_models_cache
    except Exception as e:
        log_error(f"Error loading popular models: {e}")

    _popular_models_cache = {}
    return _popular_models_cache


def _load_model_aliases() -> Dict[str, List[str]]:
    """Load model aliases database."""
    global _model_aliases_cache

    if _model_aliases_cache is not None:
        return _model_aliases_cache

    try:
        if os.path.exists(MODEL_ALIASES_FILE):
            with open(MODEL_ALIASES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _model_aliases_cache = data.get("aliases", {})
                return _model_aliases_cache
    except Exception as e:
        log_error(f"Error loading model aliases: {e}")

    _model_aliases_cache = {}
    return _model_aliases_cache


def _normalize_base_model(value: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def load_base_model_aliases() -> Dict[str, List[str]]:
    """Load and normalize base model aliases from base-models.json."""
    global _base_models_aliases_cache

    if _base_models_aliases_cache is not None:
        return _base_models_aliases_cache

    aliases_dict = {}
    try:
        if os.path.exists(BASE_MODELS_FILE):
            with open(BASE_MODELS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                base_models = data.get("base_models", [])
                for model in base_models:
                    name = model.get("name", "")
                    normalized_name = _normalize_base_model(name)
                    if not normalized_name:
                        continue

                    aliases = model.get("aliases", [])
                    # Normalize each alias token and deduplicate
                    normalized_tokens = []
                    seen_tokens = set()
                    for alias in aliases:
                        if not alias:
                            continue
                        normalized_alias = _normalize_base_model(alias)
                        if normalized_alias and normalized_alias not in seen_tokens:
                            seen_tokens.add(normalized_alias)
                            normalized_tokens.append(normalized_alias)

                    # Ensure normalized name itself is in preferred tokens if not already
                    if normalized_name not in seen_tokens:
                        normalized_tokens.append(normalized_name)

                    aliases_dict[normalized_name] = normalized_tokens
    except Exception as e:
        log_error(f"Error loading base model aliases: {e}")

    # Fallback to hardcoded defaults if file is missing/corrupted
    if not aliases_dict:
        aliases_dict = {
            "zimage": ["zimage", "zimageturbo"],
            "pony": ["pony", "ponyxl"],
            "illustrious": ["illustrious", "illustriousxl"],
            "sdxl10": ["sdxl", "sdxl10", "sdxl100", "sdxl1"],
            "sd15": ["sd15", "sd1", "stablediffusion15"],
            "flux1d": ["flux", "flux1", "flux1d", "fluxdev"],
            "flux1s": ["flux1s", "fluxschnell"],
            "qwenimage": ["qwenimage"],
            "hunyuan1": ["hunyuan", "hunyuan1"],
            "wanvideo": ["wan", "wanvideo"],
            "noobai": ["noobai"],
            "hidream": ["hidream"],
        }

    _base_models_aliases_cache = aliases_dict
    return _base_models_aliases_cache


def get_popular_model_url(filename: str) -> Optional[Dict[str, Any]]:
    """
    Look up a model filename in the popular models database.

    Args:
        filename: Model filename to look up

    Returns:
        Dictionary with url, type, directory if found, None otherwise
    """
    models = _load_popular_models()

    # Direct lookup
    if filename in models:
        return models[filename].copy()

    # Try lowercase
    filename_lower = filename.lower()
    for name, info in models.items():
        if name.lower() == filename_lower:
            return info.copy()

    # Try aliases
    aliases = _load_model_aliases()
    for canonical, alias_list in aliases.items():
        if filename in alias_list or filename_lower in [a.lower() for a in alias_list]:
            if canonical in models:
                result = models[canonical].copy()
                result["canonical_name"] = canonical
                return result

    return None


def search_popular_models(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Search popular models database by filename pattern.

    Args:
        query: Search query (partial filename)
        limit: Maximum results to return

    Returns:
        List of matching models with url info
    """
    models = _load_popular_models()
    query_lower = query.lower()

    results = []
    for name, info in models.items():
        if query_lower in name.lower():
            result = info.copy()
            result["filename"] = name
            results.append(result)

            if len(results) >= limit:
                break

    return results


def get_all_popular_models() -> Dict[str, Any]:
    """Get all popular models."""
    return _load_popular_models().copy()


def reload_databases():
    """Force reload of all databases."""
    global _popular_models_cache, _model_aliases_cache, _base_models_aliases_cache
    _popular_models_cache = None
    _model_aliases_cache = None
    _base_models_aliases_cache = None
    _load_popular_models()
    _load_model_aliases()
    load_base_model_aliases()


BASE_MODELS_META_FILE = os.path.join(METADATA_DIR, "base-models.meta.json")


def get_base_models_config() -> Dict[str, Any]:
    """Return the raw base-models config (base_models array) for the frontend dropdown."""
    return _read_base_models_file()


def _read_base_models_file() -> Dict[str, Any]:
    try:
        if os.path.exists(BASE_MODELS_FILE):
            with open(BASE_MODELS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        log_warn(f"Error reading base-models.json: {e}")
    return {"base_models": []}


def _read_base_models_meta() -> Dict[str, Any]:
    try:
        if os.path.exists(BASE_MODELS_META_FILE):
            with open(BASE_MODELS_META_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        log_warn(f"Error reading base-models.meta.json: {e}")
    return {}


def generate_aliases(name: str) -> List[str]:
    aliases = {name.lower()}
    
    # Replace dots, dashes, underscores with spaces, then normalize spaces
    normalized = re.sub(r"[\._\-]+", " ", name.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    aliases.add(normalized)
    version_trimmed = re.sub(r"(\d+)(?:[\s\._\-]+0)+(?!\d)", r"\1", normalized)
    aliases.add(version_trimmed)
    
    # Remove all spaces/dashes/dots/underscores
    collapsed = re.sub(r"[\s\._\-]+", "", name.lower())
    aliases.add(collapsed)
    aliases.add(re.sub(r"[\s\._\-]+", "", version_trimmed))
    
    # If there are dots/dashes/underscores, add specific clean replacements
    if "." in name:
        aliases.add(name.lower().replace(".", ""))
        aliases.add(name.lower().replace(".", " "))
    if "-" in name:
        aliases.add(name.lower().replace("-", ""))
        aliases.add(name.lower().replace("-", " "))
    if "_":
        aliases.add(name.lower().replace("_", ""))
        aliases.add(name.lower().replace("_", " "))

    # Extract first word if it has multiple words
    words = name.lower().split()
    if len(words) > 1:
        first_word = words[0]
        if len(first_word) > 2 and first_word not in {"stable", "flux", "pony", "sdxl"}:
            aliases.add(first_word)
            
    return sorted(list({a for a in aliases if len(a) > 1}))


def get_base_models_status(check_remote: bool = False) -> Dict[str, Any]:
    """Return local base-models metadata and optionally compare with CivitAI."""
    local_data = _read_base_models_file()
    base_models = local_data.get("base_models", [])
    meta = _read_base_models_meta()
    
    local_count = len(base_models)
    local_updated_at = meta.get("updated_at") or ""
    
    status = {
        "local_count": local_count,
        "local_updated_at": local_updated_at,
        "remote_checked_at": meta.get("last_checked_at") or "",
        "update_available": False,
    }
    
    if check_remote:
        try:
            import requests
            # Fetch from CivitAI API
            response = requests.get("https://civitai.com/api/v1/enums", timeout=15)
            if response.status_code == 200:
                enums = response.json()
                remote_models = enums.get("BaseModel", [])
                
                # Check if there are new models by comparing normalized names and aliases
                all_existing_normalized = set()
                for m in base_models:
                    all_existing_normalized.add(_normalize_base_model(m.get("name", "")))
                    for alias in m.get("aliases", []):
                        all_existing_normalized.add(_normalize_base_model(alias))
                
                new_models_found = False
                for remote_name in remote_models:
                    norm_remote = _normalize_base_model(remote_name)
                    if norm_remote and norm_remote not in all_existing_normalized:
                        new_models_found = True
                        break
                
                status.update({
                    "remote_checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                    "update_available": new_models_found
                })
        except Exception as e:
            log_warn(f"Error checking remote base models: {e}")
            
    return status


def update_base_models_from_remote() -> Dict[str, Any]:
    """Fetch live BaseModel enums from CivitAI and merge into base-models.json."""
    import requests
    response = requests.get("https://civitai.com/api/v1/enums", timeout=15)
    if response.status_code != 200:
        raise ValueError(f"CivitAI enums endpoint returned HTTP {response.status_code}")
        
    enums = response.json()
    remote_names = enums.get("BaseModel", [])
    if not remote_names or not isinstance(remote_names, list):
        raise ValueError("CivitAI enums did not return a valid BaseModel list")
        
    local_data = _read_base_models_file()
    base_models = local_data.get("base_models", [])
    
    # 1. Build a set of all normalized aliases currently in base-models.json
    all_known_normalized = set()
    for m in base_models:
        for alias in m.get("aliases", []):
            all_known_normalized.add(_normalize_base_model(alias))
        all_known_normalized.add(_normalize_base_model(m.get("name", "")))
        
    updated_models = list(base_models)
    new_added_count = 0
    new_added_names = []
    
    for name in remote_names:
        norm_name = _normalize_base_model(name)
        if not norm_name:
            continue
            
        # If the normalized name is already a known alias or name, skip it
        if norm_name in all_known_normalized:
            continue
            
        # Generate candidate aliases
        candidates = generate_aliases(name)
        
        # Filter out aliases that are already registered/known
        filtered_aliases = []
        for alias in candidates:
            norm_alias = _normalize_base_model(alias)
            if norm_alias not in all_known_normalized:
                filtered_aliases.append(alias)
                all_known_normalized.add(norm_alias)
                
        # If we have valid aliases, add the new base model entry
        if filtered_aliases:
            if name.lower() not in [a.lower() for a in filtered_aliases]:
                filtered_aliases.insert(0, name)
                all_known_normalized.add(norm_name)
                
            updated_models.append({
                "name": name,
                "aliases": filtered_aliases
            })
            new_added_count += 1
            new_added_names.append(name)
            
    # Write updated models to base-models.json atomically
    os.makedirs(METADATA_DIR, exist_ok=True)
    
    # Backup existing
    if os.path.exists(BASE_MODELS_FILE):
        shutil.copy2(BASE_MODELS_FILE, f"{BASE_MODELS_FILE}.bak")
        
    # Write atomically
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(BASE_MODELS_FILE)}.",
        suffix=".tmp",
        dir=os.path.dirname(BASE_MODELS_FILE),
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"base_models": updated_models}, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp_path, BASE_MODELS_FILE)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
        
    # Write meta file
    now_str = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    meta = {
        "updated_at": now_str,
        "last_checked_at": now_str,
        "local_count": len(updated_models),
        "new_models_added": new_added_count,
        "new_models_added_list": new_added_names
    }
    
    fd_meta, tmp_meta_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(BASE_MODELS_META_FILE)}.",
        suffix=".tmp",
        dir=os.path.dirname(BASE_MODELS_META_FILE),
        text=True,
    )
    try:
        with os.fdopen(fd_meta, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp_meta_path, BASE_MODELS_META_FILE)
    except Exception:
        try:
            os.remove(tmp_meta_path)
        except OSError:
            pass
        raise
        
    # Force reload database in-memory cache
    reload_databases()
    
    return {
        "local_count": len(updated_models),
        "local_updated_at": now_str,
        "new_models_added": new_added_count,
        "new_models_added_list": new_added_names,
        "updated": True
    }

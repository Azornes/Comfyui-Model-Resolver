"""
Exporter Module

Prepares a workflow for sharing: finds a public download link for every
model, builds a "Model links" note in the layout of ComfyUI's official
templates, and hashes local files to identify models the name lookup
can't find.
"""

import hashlib
import os
import threading
import uuid
from typing import Any, Dict, List, Optional

from .log_system import create_module_logger
from .network_utils import strip_secrets

log = create_module_logger(__name__)

# Order of folders in the note, following ComfyUI's official templates;
# anything else follows alphabetically
CATEGORY_ORDER = [
    "checkpoints",
    "diffusion_models",
    "unet",
    "text_encoders",
    "clip",
    "clip_vision",
    "vae",
    "loras",
    "controlnet",
    "model_patches",
    "upscale_models",
    "embeddings",
    "style_models",
    "ipadapter",
    "audio_encoders",
    "latent_upscale_models",
]

_hash_jobs: Dict[str, Dict[str, Any]] = {}
_hash_cache: Dict[tuple, str] = {}
_hash_lock = threading.Lock()
_MAX_HASH_JOBS = 128
_MAX_HASH_CACHE = 512


def _category_sort_key(category: str):
    if category in CATEGORY_ORDER:
        return (0, CATEGORY_ORDER.index(category), "")
    return (1, 0, category)


def _display_path(name: str) -> List[str]:
    """Path parts of a model name, separators normalized."""
    return [part for part in name.replace("\\", "/").split("/") if part]


def _markdown_link_text(text: str) -> str:
    return text.replace("[", "\\[").replace("]", "\\]")


def _markdown_url(url: str) -> str:
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def build_model_links_markdown(models: List[Dict[str, Any]]) -> str:
    """
    Markdown for a "Model links" note, e.g.

        ## Model links

        **diffusion_models**

        - [flux1-dev.safetensors](https://huggingface.co/...)

        ## Model storage location

        ```
        📂 ComfyUI/
        ├── 📂 models/
        │   └── 📂 diffusion_models/
        │       └── flux1-dev.safetensors
        ```

    models: [{name, url, directory}], name may include a subfolder.
    """
    groups: Dict[str, List[Dict[str, Any]]] = {}
    seen = set()
    for model in models:
        name = (model.get("name") or "").strip()
        directory = (model.get("directory") or "unknown").strip() or "unknown"
        if not name or (directory, name) in seen:
            continue
        seen.add((directory, name))
        groups.setdefault(directory, []).append(model)

    categories = sorted(groups, key=_category_sort_key)
    for category in categories:
        groups[category].sort(key=lambda m: m["name"].lower())

    lines = ["## Model links", ""]
    for category in categories:
        lines += [f"**{category}**", ""]
        for model in groups[category]:
            parts = _display_path(model["name"])
            filename = parts[-1] if parts else model["name"]
            url = strip_secrets(model.get("url") or "")
            if url:
                lines.append(f"- [{_markdown_link_text(filename)}]({_markdown_url(url)})")
            else:
                lines.append(f"- {filename} (no public link)")
        lines.append("")

    lines += ["## Model storage location", "", "```", "📂 ComfyUI/", "├── 📂 models/"]
    for cat_index, category in enumerate(categories):
        last_category = cat_index == len(categories) - 1
        lines.append(f"│   {'└──' if last_category else '├──'} 📂 {category}/")
        child_prefix = "│   " + ("    " if last_category else "│   ")
        for model_index, model in enumerate(groups[category]):
            last_model = model_index == len(groups[category]) - 1
            parts = _display_path(model["name"])
            display_name = "/".join(parts) if parts else model["name"]
            lines.append(f"{child_prefix}{'└──' if last_model else '├──'} {display_name}")
    lines += ["```", "", "*Prepared with [Model Resolver](https://github.com/Azornes/Comfyui-Model-Resolver)*"]
    return "\n".join(lines)


def is_inside_model_dirs(path: str) -> bool:
    """True if path is a file under one of ComfyUI's model folders."""
    try:
        import folder_paths
    except ImportError:
        return False
    if not path or not os.path.isfile(path):
        return False
    real = os.path.normcase(os.path.realpath(path))
    for category, entry in getattr(folder_paths, "folder_names_and_paths", {}).items():
        if category in ("custom_nodes", "configs"):
            continue
        for base in entry[0]:
            base_real = os.path.normcase(os.path.realpath(base))
            if real.startswith(base_real.rstrip(os.sep) + os.sep):
                return True
    return False


def find_download_source(
    filename: str,
    category: str = "",
    workflow_url: str = "",
    sha256: str = "",
) -> Optional[Dict[str, Any]]:
    """Look up public download source for a model by URL, hash, or filename."""
    if workflow_url:
        return {
            "url": workflow_url,
            "source": "workflow",
            "url_source": "workflow",
            "match_type": "exact",
        }

    # 1. Exact hash lookups
    if sha256:
        # Civitai hash lookup
        try:
            from .sources.civitai import search_civitai_for_file
            civitai_match = search_civitai_for_file(filename, sha256=sha256)
            if civitai_match and (civitai_match.download_url or civitai_match.url):
                return {
                    "url": civitai_match.download_url or civitai_match.url,
                    "source": "civitai",
                    "url_source": "civitai_hash",
                    "match_type": "hash",
                }
        except Exception as exc:
            log.debug(f"CivitAI hash lookup skipped for {filename}: {exc}")

        # CivArchive hash lookup
        try:
            from .sources.civarchive import search_civarchive_for_file
            civarchive_match = search_civarchive_for_file(filename, sha256=sha256)
            if civarchive_match and civarchive_match.download_url:
                return {
                    "url": civarchive_match.download_url,
                    "source": "civarchive",
                    "url_source": "civarchive",
                    "match_type": "hash",
                }
        except Exception as exc:
            log.debug(f"CivArchive hash lookup skipped for {filename}: {exc}")

        # HuggingFace hash lookup
        try:
            from .sources.huggingface import search_huggingface_for_file
            hf_match = search_huggingface_for_file(filename, sha256=sha256)
            if hf_match and hf_match.download_url:
                return {
                    "url": hf_match.download_url,
                    "source": "huggingface",
                    "url_source": "hf_hash",
                    "match_type": "hash",
                }
        except Exception as exc:
            log.debug(f"HuggingFace hash lookup skipped for {filename}: {exc}")

    # 2. Filename exact match lookups
    if filename:
        # Popular models list
        try:
            from .sources.popular import search_popular_models
            pop_matches = search_popular_models(filename)
            for m in pop_matches or []:
                if m.filename.lower() == filename.lower() and m.download_url:
                    return {
                        "url": m.download_url,
                        "source": "popular",
                        "url_source": "popular",
                        "match_type": "exact",
                    }
        except Exception as exc:
            log.debug(f"Popular models lookup skipped for {filename}: {exc}")

        # Model list database (ComfyUI Manager list)
        try:
            from .sources.model_list import search_model_list
            ml_match = search_model_list(filename, exact_only=True)
            if ml_match and ml_match.match_mode == "exact" and ml_match.download_url:
                return {
                    "url": ml_match.download_url,
                    "source": "model_list",
                    "url_source": "model_list",
                    "match_type": "exact",
                }
        except Exception as exc:
            log.debug(f"Model list lookup skipped for {filename}: {exc}")

        # HuggingFace filename search
        try:
            from .sources.huggingface import search_huggingface_for_file
            hf_file_match = search_huggingface_for_file(filename, exact_only=True)
            if hf_file_match and hf_file_match.match_mode == "exact" and hf_file_match.download_url:
                return {
                    "url": hf_file_match.download_url,
                    "source": "huggingface",
                    "url_source": "huggingface",
                    "match_type": "exact",
                }
        except Exception as exc:
            log.debug(f"HuggingFace search skipped for {filename}: {exc}")

        # CivitAI filename search
        try:
            from .sources.civitai import search_civitai_for_file
            civ_file_match = search_civitai_for_file(
                filename,
                exact_only=True,
                model_type=category or None,
            )
            if (
                civ_file_match
                and civ_file_match.match_mode == "exact"
                and (civ_file_match.download_url or civ_file_match.url)
            ):
                return {
                    "url": civ_file_match.download_url or civ_file_match.url,
                    "source": "civitai",
                    "url_source": "civitai",
                    "match_type": "exact",
                }
        except Exception as exc:
            log.debug(f"CivitAI search skipped for {filename}: {exc}")

    return None


def lookup_export_links(models: List[Dict[str, Any]]) -> List[Optional[Dict[str, Any]]]:
    """Find public download link for each model."""
    results = []
    for model in models:
        filename = model.get("filename") or model.get("name") or ""
        existing = strip_secrets(model.get("existing_url") or "")
        try:
            source = find_download_source(
                filename,
                category=model.get("category", ""),
                workflow_url=existing,
                sha256=model.get("sha256", ""),
            )
        except Exception as e:
            log.warning(f"Model Resolver: link lookup failed for {filename}: {e}")
            source = None
        if source and source.get("url"):
            results.append({
                "url": strip_secrets(source["url"]),
                "source": source.get("source", ""),
                "url_source": source.get("url_source", ""),
                "match_type": source.get("match_type", ""),
            })
        else:
            results.append(None)
    return results


def compute_sha256(path: str, job_id: Optional[str] = None) -> str:
    """SHA-256 of a file, cached by path, size and modification time."""
    stat = os.stat(path)
    cache_key = (os.path.normcase(os.path.realpath(path)), stat.st_size, stat.st_mtime)
    with _hash_lock:
        cached = _hash_cache.get(cache_key)
        if cached is not None:
            return cached

    digest = hashlib.sha256()
    done = 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            done += len(chunk)
            if job_id and stat.st_size:
                with _hash_lock:
                    if job_id in _hash_jobs:
                        _hash_jobs[job_id]["progress"] = done / stat.st_size

    sha256 = digest.hexdigest()
    with _hash_lock:
        if len(_hash_cache) >= _MAX_HASH_CACHE:
            _hash_cache.pop(next(iter(_hash_cache)), None)
        _hash_cache[cache_key] = sha256
    return sha256


def _prune_hash_jobs_locked() -> None:
    """Keep the background hash job registry bounded."""
    if len(_hash_jobs) < _MAX_HASH_JOBS:
        return
    terminal_ids = [
        jid
        for jid, info in _hash_jobs.items()
        if info.get("status") in ("done", "error")
    ]
    for jid in terminal_ids[: max(1, len(_hash_jobs) - _MAX_HASH_JOBS + 1)]:
        _hash_jobs.pop(jid, None)


def start_hash_job(path: str) -> str:
    """Hash a local model file in the background, then look the hash up."""
    job_id = uuid.uuid4().hex[:12]
    with _hash_lock:
        _prune_hash_jobs_locked()
        _hash_jobs[job_id] = {
            "status": "hashing",
            "progress": 0.0,
            "sha256": None,
            "result": None,
            "error": None,
        }

    def run():
        try:
            sha256 = compute_sha256(path, job_id)
            with _hash_lock:
                if job_id in _hash_jobs:
                    _hash_jobs[job_id].update(
                        {"status": "looking_up", "progress": 1.0, "sha256": sha256}
                    )
            result = find_download_source(
                os.path.basename(path),
                sha256=sha256,
            )
            if result and result.get("url"):
                result = {
                    "url": strip_secrets(result["url"]),
                    "source": result.get("source", ""),
                    "url_source": result.get("url_source", ""),
                    "match_type": result.get("match_type") or "hash",
                }
            else:
                result = None
            with _hash_lock:
                if job_id in _hash_jobs:
                    _hash_jobs[job_id].update({"status": "done", "result": result})
        except Exception as e:
            log.warning(f"Model Resolver: hashing {path} failed: {e}")
            with _hash_lock:
                if job_id in _hash_jobs:
                    _hash_jobs[job_id].update({"status": "error", "error": str(e)})

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_hash_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _hash_lock:
        job = _hash_jobs.get(job_id)
        return dict(job) if job else None

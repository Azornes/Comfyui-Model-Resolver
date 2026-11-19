"""Hugging Face Cache Lifecycle and Cleanup Utilities."""

import os
import shutil
from typing import Optional

from ..log_system import create_module_logger

log = create_module_logger(__name__)


def get_hf_cache_dir() -> str:
    """Return the base cache directory for huggingface_hub."""
    try:
        from huggingface_hub.constants import HF_HUB_CACHE
        return HF_HUB_CACHE
    except Exception:
        return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def clear_hf_cache_for_repo(repo_id: str) -> None:
    """Remove cached revisions and incomplete blobs for a specific HF repo to free disk space."""
    normalized_repo = str(repo_id or "").strip()
    if not normalized_repo:
        return

    # 1. Use scan_cache_dir to delete revisions if huggingface_hub supports it
    try:
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()
        commit_hashes = []
        for repo in getattr(cache_info, "repos", []) or []:
            repo_key = str(getattr(repo, "repo_id", "") or "").strip()
            if repo_key.lower() != normalized_repo.lower():
                continue
            for revision in getattr(repo, "revisions", []) or []:
                commit_hash = str(getattr(revision, "commit_hash", "") or "").strip()
                if commit_hash:
                    commit_hashes.append(commit_hash)

        for commit_hash in commit_hashes:
            try:
                delete_strategy = cache_info.delete_revisions(commit_hash)
                delete_strategy.execute()
                log.debug(f"Deleted cached HF revision {commit_hash} for {normalized_repo}")
            except Exception as inner:
                log.debug(f"Failed to delete HF revision {commit_hash}: {inner}")
    except Exception as e:
        log.debug(f"scan_cache_dir revision cleanup skipped for {normalized_repo}: {e}")

    # 2. Cleanup orphaned .incomplete blobs and empty repo cache folder
    try:
        cache_root = get_hf_cache_dir()
        repo_folder = f"models--{normalized_repo.replace('/', '--')}"
        repo_cache_dir = os.path.join(cache_root, repo_folder)
        blobs_dir = os.path.join(repo_cache_dir, "blobs")
        if os.path.isdir(blobs_dir):
            for name in os.listdir(blobs_dir):
                if name.endswith(".incomplete"):
                    blob_file = os.path.join(blobs_dir, name)
                    try:
                        os.remove(blob_file)
                        log.debug(f"Removed incomplete HF blob: {blob_file}")
                    except Exception:
                        pass
        if os.path.isdir(repo_cache_dir):
            shutil.rmtree(repo_cache_dir, ignore_errors=True)
            log.debug(f"Removed HF repo cache directory: {repo_cache_dir}")
    except Exception as e:
        log.debug(f"Direct HF repo cache cleanup skipped for {normalized_repo}: {e}")


def clear_hf_cache_for_path(downloaded_path: str) -> None:
    """Remove cache revisions matching a specific downloaded snapshot path or file."""
    if not downloaded_path:
        return
    try:
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()
        for repo in getattr(cache_info, "repos", []) or []:
            for revision in getattr(repo, "revisions", []) or []:
                snapshot_path = str(getattr(revision, "snapshot_path", "") or "")
                files = getattr(revision, "files", []) or []
                if snapshot_path == downloaded_path or any(str(getattr(f, "file_path", "")) == downloaded_path for f in files):
                    commit_hash = getattr(revision, "commit_hash", "")
                    if commit_hash:
                        delete_strategy = cache_info.delete_revisions(commit_hash)
                        delete_strategy.execute()
                        log.debug(f"Deleted cached HF revision {commit_hash} for path {downloaded_path}")
                        return
    except Exception as e:
        log.debug(f"clear_hf_cache_for_path failed: {e}")


def cleanup_hf_incomplete_blobs(cache_dir: Optional[str] = None) -> int:
    """Walk HF cache directory and delete all orphaned .incomplete files left by aborted downloads."""
    root_dir = cache_dir or get_hf_cache_dir()
    if not os.path.isdir(root_dir):
        return 0

    cleaned = 0
    try:
        for dirpath, _, filenames in os.walk(root_dir):
            for name in filenames:
                if name.endswith(".incomplete"):
                    full_path = os.path.join(dirpath, name)
                    try:
                        os.remove(full_path)
                        cleaned += 1
                    except Exception:
                        pass
        if cleaned > 0:
            log.info(f"Cleaned up {cleaned} orphaned .incomplete HF blob(s) in {root_dir}")
    except Exception as e:
        log.debug(f"cleanup_hf_incomplete_blobs encountered an error: {e}")
    return cleaned

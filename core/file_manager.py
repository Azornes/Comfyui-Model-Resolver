"""Cross-platform helpers for revealing local files and opening directories."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any, Dict

from .path_utils import normalize_absolute_path

LAUNCH_HANDOFF_TIMEOUT_SECONDS = 2.0


class FileManagerError(RuntimeError):
    """Base error raised when a local file manager cannot be opened."""


class FileManagerUnavailableError(FileManagerError):
    """Raised when the platform has no supported file-manager launcher."""


class UnsupportedFileManagerPlatformError(FileManagerError):
    """Raised when the current operating system is not supported."""


def _normalized_absolute_path(path_value: str) -> str:
    return normalize_absolute_path(path_value)


def normalize_file_manager_path(path_value: Any) -> str:
    """Normalize a local path and recover UI-style separators when necessary.

    Legacy frontend state may contain backslashes as subfolder separators. On
    POSIX, a backslash is also a valid filename character, so the literal path
    is always checked first. It is interpreted as a separator only when the
    literal path does not exist and the converted path does.
    """
    if not isinstance(path_value, (str, os.PathLike)):
        raise ValueError("path must be a string")

    raw_path = os.fspath(path_value)
    if isinstance(raw_path, bytes):
        raise ValueError("path must be a string")
    if not raw_path.strip():
        raise ValueError("path is required")
    if "\x00" in raw_path:
        raise ValueError("path contains a null byte")

    normalized_path = _normalized_absolute_path(raw_path)
    if os.path.exists(normalized_path):
        return normalized_path

    if os.name != "nt" and "\\" in raw_path:
        separator_path = _normalized_absolute_path(raw_path.replace("\\", os.sep))
        if os.path.exists(separator_path):
            return separator_path

    return normalized_path


def _find_windows_explorer() -> str:
    explorer = shutil.which("explorer.exe") or shutil.which("explorer")
    if explorer:
        return explorer

    system_root = str(os.environ.get("SYSTEMROOT") or "").strip()
    if system_root:
        candidate = os.path.join(system_root, "explorer.exe")
        if os.path.isfile(candidate):
            return candidate

    raise FileManagerUnavailableError("Windows Explorer could not be found.")


def _find_launcher(*names: str) -> tuple[str, str]:
    for name in names:
        executable = shutil.which(name)
        if executable:
            return name, executable
    raise FileManagerUnavailableError(
        f"No supported file manager launcher was found ({', '.join(names)})."
    )


def _launch(command: list[str], check_exit_code: bool = True) -> None:
    kwargs: Dict[str, Any] = {
        "shell": False,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        process = subprocess.Popen(command, **kwargs)
    except (OSError, ValueError) as exc:
        raise FileManagerError(f"Could not start the system file manager: {exc}") from exc

    # Explorer commonly delegates the request to an existing shell process and
    # exits with code 1 even though the folder opened successfully. A successful
    # process creation is therefore the only reliable Windows signal.
    if not check_exit_code:
        return

    # Most launcher commands exit immediately after handing the request to the
    # desktop. Catch a fast failure without waiting for a long-running manager.
    try:
        return_code = process.wait(timeout=LAUNCH_HANDOFF_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        return
    except OSError as exc:
        raise FileManagerError(
            f"Could not confirm that the system file manager started: {exc}"
        ) from exc
    if return_code != 0:
        raise FileManagerError(
            f"The system file manager launcher exited with code {return_code}."
        )


def open_in_file_manager(path_value: Any, system: str | None = None) -> Dict[str, Any]:
    """Reveal a file or open a directory using the host operating system."""
    target_path = normalize_file_manager_path(path_value)
    if not os.path.exists(target_path):
        raise FileNotFoundError(f"Path does not exist: {target_path}")

    is_file = os.path.isfile(target_path)
    is_directory = os.path.isdir(target_path)
    if not is_file and not is_directory:
        raise FileManagerError("Only regular files and directories can be opened.")

    platform_name = str(system or platform.system()).strip().lower()
    opened_path = os.path.dirname(target_path) if is_file else target_path
    selected = False

    if platform_name == "windows":
        explorer = _find_windows_explorer()
        command = (
            [explorer, "/select,", target_path]
            if is_file
            else [explorer, target_path]
        )
        selected = is_file
        launcher = "explorer"
    elif platform_name == "darwin":
        launcher, executable = _find_launcher("open")
        command = [executable, "-R", target_path] if is_file else [executable, target_path]
        selected = is_file
    elif platform_name == "linux":
        launcher, executable = _find_launcher("xdg-open", "gio")
        command = (
            [executable, opened_path]
            if launcher == "xdg-open"
            else [executable, "open", opened_path]
        )
    else:
        display_name = system or platform.system() or "unknown"
        raise UnsupportedFileManagerPlatformError(
            f"Opening folders is not supported on {display_name}."
        )

    _launch(command, check_exit_code=platform_name != "windows")
    return {
        "platform": platform_name,
        "launcher": launcher,
        "opened_path": opened_path,
        "selected": selected,
    }

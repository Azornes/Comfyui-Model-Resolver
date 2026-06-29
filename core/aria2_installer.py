"""Install aria2c from official aria2 GitHub releases."""

from __future__ import annotations

import platform
import shutil
import stat
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from .path_utils import is_path_within


ARIA2_RELEASE_API_URL = "https://api.github.com/repos/aria2/aria2/releases/latest"
REQUEST_HEADERS = {"User-Agent": "ComfyUI-Model-Resolver"}
CUSTOM_NODE_ROOT = Path(__file__).resolve().parents[1]
ARIA2_INSTALL_ROOT = CUSTOM_NODE_ROOT / "tools" / "aria2"


class Aria2InstallError(RuntimeError):
    """Raised when aria2 cannot be installed automatically."""


def _safe_name(value: Any) -> str:
    text = str(value or "").strip()
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in text)
    return safe.strip("._") or "aria2"


def _machine_bits(machine: str) -> str:
    machine = str(machine or "").lower()
    if machine in {"amd64", "x86_64", "x64", "arm64", "aarch64"}:
        return "64"
    if machine in {"x86", "i386", "i686"}:
        return "32"
    return "64"


def _platform_tokens() -> Dict[str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        bits = _machine_bits(machine)
        return {
            "system": "windows",
            "machine": machine,
            "label": f"Windows {bits}-bit",
            "required": "win",
            "arch": f"{bits}bit",
            "exe_name": "aria2c.exe",
        }

    if system == "darwin":
        return {
            "system": "darwin",
            "machine": machine,
            "label": "macOS",
            "required": "mac",
            "arch": "",
            "exe_name": "aria2c",
        }

    if system == "linux":
        return {
            "system": "linux",
            "machine": machine,
            "label": f"Linux {machine or 'unknown'}",
            "required": "linux",
            "arch": "",
            "exe_name": "aria2c",
        }

    raise Aria2InstallError(
        f"Automatic aria2 install is not supported on {platform.system() or 'this OS'}."
    )


def _asset_name(asset: Dict[str, Any]) -> str:
    return str(asset.get("name") or "").strip()


def _asset_url(asset: Dict[str, Any]) -> str:
    return str(asset.get("browser_download_url") or "").strip()


def _is_source_archive(name: str) -> bool:
    lower = name.lower()
    return lower.endswith((".tar.gz", ".tar.bz2", ".tar.xz")) and "build" not in lower


def _score_asset(asset: Dict[str, Any], tokens: Dict[str, str]) -> int:
    name = _asset_name(asset)
    lower = name.lower()
    if not name or not _asset_url(asset):
        return -1
    if _is_source_archive(name):
        return -1
    if tokens["system"] != "linux" and "android" in lower:
        return -1

    score = 0
    arch = tokens.get("arch") or ""

    if tokens["system"] == "windows":
        if "win" not in lower:
            return -1
        score += 50
        if arch and arch in lower:
            score += 30
        if lower.endswith(".zip"):
            score += 10
        return score

    if tokens["system"] == "darwin":
        if not any(token in lower for token in ("mac", "darwin", "osx", "os-x")):
            return -1
        score += 50
        if lower.endswith((".zip", ".tar.gz", ".tar.xz", ".tar.bz2")):
            score += 10
        return score

    if tokens["system"] == "linux":
        if "linux" not in lower or "android" in lower:
            return -1
        score += 50
        machine = tokens.get("machine") or ""
        if machine and machine in lower:
            score += 10
        if lower.endswith((".zip", ".tar.gz", ".tar.xz", ".tar.bz2")):
            score += 10
        return score

    return -1


def _select_release_asset(release: Dict[str, Any], tokens: Dict[str, str]) -> Dict[str, Any]:
    assets = release.get("assets") or []
    if not isinstance(assets, list) or not assets:
        raise Aria2InstallError("The latest aria2 release does not expose downloadable assets.")

    scored = [
        (score, asset)
        for asset in assets
        for score in [_score_asset(asset, tokens)]
        if score >= 0
    ]
    if not scored:
        release_name = release.get("tag_name") or release.get("name") or "latest release"
        asset_names = ", ".join(_asset_name(asset) for asset in assets if _asset_name(asset))
        raise Aria2InstallError(
            f"No prebuilt aria2 desktop binary for {tokens['label']} was found in {release_name}. "
            "Install aria2 with your system package manager or configure aria2c_path manually. "
            f"Available assets: {asset_names or 'none'}"
        )

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def _fetch_latest_release() -> Dict[str, Any]:
    try:
        response = requests.get(ARIA2_RELEASE_API_URL, headers=REQUEST_HEADERS, timeout=(10, 30))
        response.raise_for_status()
    except requests.RequestException as exc:
        raise Aria2InstallError(
            "Could not contact GitHub to check the latest aria2 release. "
            "Check your internet connection, firewall/proxy settings, or configure aria2c_path manually. "
            f"Details: {exc}"
        ) from exc
    data = response.json()
    if not isinstance(data, dict):
        raise Aria2InstallError("GitHub returned an invalid aria2 release response.")
    return data


def _assert_within_install_root(path: Path) -> None:
    install_root = ARIA2_INSTALL_ROOT.resolve()
    target = path.resolve()
    if target == install_root:
        return
    if not is_path_within(str(target), str(install_root)):
        raise Aria2InstallError(f"Refusing to write outside aria2 install root: {target}")


def _safe_extract_zip(archive_path: Path, destination: Path) -> None:
    destination_abs = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            target = destination_abs / member.filename
            target_abs = target.resolve()
            if not is_path_within(str(target_abs), str(destination_abs)) and target_abs != destination_abs:
                raise Aria2InstallError(f"Unsafe path in aria2 archive: {member.filename}")
        archive.extractall(destination_abs)


def _safe_extract_tar(archive_path: Path, destination: Path) -> None:
    destination_abs = destination.resolve()
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            target = destination_abs / member.name
            target_abs = target.resolve()
            if not is_path_within(str(target_abs), str(destination_abs)) and target_abs != destination_abs:
                raise Aria2InstallError(f"Unsafe path in aria2 archive: {member.name}")
        archive.extractall(destination_abs)


def _extract_archive(archive_path: Path, destination: Path) -> None:
    name = archive_path.name.lower()
    if name.endswith(".zip"):
        _safe_extract_zip(archive_path, destination)
        return
    if name.endswith((".tar.gz", ".tgz", ".tar.xz", ".tar.bz2")):
        _safe_extract_tar(archive_path, destination)
        return
    raise Aria2InstallError(f"Unsupported aria2 archive format: {archive_path.name}")


def _find_executable(root: Path, exe_name: str) -> Optional[Path]:
    if not root.exists():
        return None
    expected = exe_name.lower()
    for path in root.rglob("*"):
        if path.is_file() and path.name.lower() == expected:
            return path
    return None


def _find_existing_install(exe_name: str) -> Optional[Path]:
    candidates = []
    expected = exe_name.lower()
    if not ARIA2_INSTALL_ROOT.exists():
        return None
    for path in ARIA2_INSTALL_ROOT.rglob("*"):
        if path.is_file() and path.name.lower() == expected:
            candidates.append(path)
    if not candidates:
        return None
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return candidates[0]


def _existing_install_metadata(executable: Path) -> Dict[str, str]:
    try:
        relative = executable.relative_to(ARIA2_INSTALL_ROOT)
        parts = relative.parts
    except ValueError:
        parts = ()

    return {
        "version": parts[0] if parts else "",
        "asset": parts[1] if len(parts) > 1 else "",
        "install_dir": str(executable.parent),
    }


def _download_file(url: str, destination: Path) -> int:
    total = 0
    try:
        with requests.get(url, headers=REQUEST_HEADERS, stream=True, timeout=(10, 120)) as response:
            response.raise_for_status()
            with destination.open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    handle.write(chunk)
                    total += len(chunk)
    except requests.RequestException as exc:
        raise Aria2InstallError(
            "Could not download the aria2 release asset from GitHub. "
            "Check your internet connection, firewall/proxy settings, or configure aria2c_path manually. "
            f"Details: {exc}"
        ) from exc
    return total


def _chmod_executable(path: Path) -> None:
    if platform.system().lower() == "windows":
        return
    try:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass


def install_aria2_engine(force: bool = False) -> Dict[str, Any]:
    """Download and install aria2c for the current platform."""
    tokens = _platform_tokens()
    if not force:
        existing_executable = _find_existing_install(tokens["exe_name"])
        if existing_executable and existing_executable.exists():
            _chmod_executable(existing_executable)
            existing_metadata = _existing_install_metadata(existing_executable)
            return {
                "success": True,
                "already_installed": True,
                "aria2c_path": str(existing_executable),
                "version": existing_metadata["version"],
                "asset": existing_metadata["asset"],
                "platform": tokens["label"],
                "install_dir": existing_metadata["install_dir"],
            }

    release = _fetch_latest_release()
    asset = _select_release_asset(release, tokens)
    tag_name = str(release.get("tag_name") or "latest").strip() or "latest"
    asset_name = _asset_name(asset)
    asset_url = _asset_url(asset)
    if not asset_url:
        raise Aria2InstallError(f"aria2 release asset {asset_name or '<unknown>'} has no download URL.")

    install_dir = ARIA2_INSTALL_ROOT / _safe_name(tag_name) / _safe_name(Path(asset_name).stem)
    _assert_within_install_root(install_dir)
    existing_executable = _find_executable(install_dir, tokens["exe_name"])
    if existing_executable and existing_executable.exists() and not force:
        _chmod_executable(existing_executable)
        return {
            "success": True,
            "already_installed": True,
            "aria2c_path": str(existing_executable),
            "version": tag_name,
            "asset": asset_name,
            "platform": tokens["label"],
            "install_dir": str(install_dir),
        }

    ARIA2_INSTALL_ROOT.mkdir(parents=True, exist_ok=True)
    install_dir.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="model-resolver-aria2-") as tmp_dir_text:
        tmp_dir = Path(tmp_dir_text)
        archive_path = tmp_dir / asset_name
        downloaded_bytes = _download_file(asset_url, archive_path)

        if install_dir.exists():
            _assert_within_install_root(install_dir)
            shutil.rmtree(install_dir)
        install_dir.mkdir(parents=True, exist_ok=True)
        _extract_archive(archive_path, install_dir)

    executable = _find_executable(install_dir, tokens["exe_name"])
    if not executable:
        raise Aria2InstallError(
            f"Installed aria2 archive did not contain {tokens['exe_name']}."
        )
    _chmod_executable(executable)

    return {
        "success": True,
        "already_installed": False,
        "aria2c_path": str(executable),
        "version": tag_name,
        "asset": asset_name,
        "platform": tokens["label"],
        "install_dir": str(install_dir),
        "downloaded_bytes": downloaded_bytes,
        "download_url": asset_url,
    }

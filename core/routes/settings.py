"""Settings and backend-log HTTP routes."""

import asyncio
import os
import time

from ..log_system import LogLevel
from ..log_system import logger as backend_log_controller
from ..log_system.config import LOG_LEVEL as BACKEND_DEFAULT_LOG_LEVEL
from ..log_system.logger import parse_rotated_log_filename
from ..settings import bool_setting as resolver_bool_setting
from ..settings import get_settings_schema
from ..settings import load_settings as load_resolver_settings
from ..settings import save_settings as save_resolver_settings


def _flush_backend_log_handlers():
    for handler in getattr(backend_log_controller, "file_handlers", {}).values():
        try:
            handler.flush()
        except Exception:
            pass


def _backend_log_sort_key(path):
    name = os.path.basename(path)
    parsed_name = parse_rotated_log_filename(name)
    if parsed_name is None:
        return (name.lower(), 999)
    base_name, rotation = parsed_name
    return (base_name.lower(), rotation)


def _collect_backend_log_files(log_dir):
    if not log_dir or not os.path.isdir(log_dir):
        return []

    files = []
    for entry in os.listdir(log_dir):
        name = str(entry or "")
        if not name.startswith("azlogs_"):
            continue
        if parse_rotated_log_filename(name) is None:
            continue

        path = os.path.abspath(os.path.join(log_dir, name))
        try:
            if os.path.commonpath([log_dir, path]) != log_dir:
                continue
        except ValueError:
            continue
        if os.path.isfile(path):
            files.append(path)
    return sorted(files, key=_backend_log_sort_key)


def _build_backend_log_export():
    _flush_backend_log_handlers()
    raw_log_dir = str(backend_log_controller.config.get("log_dir") or "")
    log_dir = os.path.abspath(raw_log_dir) if raw_log_dir else ""
    exported_at = time.strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "Model Resolver Backend Logs",
        f"Exported: {exported_at}",
        f"Log directory: {log_dir or 'not configured'}",
        f"File logging: {bool(backend_log_controller.config.get('log_to_file'))}",
        "",
    ]

    log_files = _collect_backend_log_files(log_dir)
    if not log_files:
        lines.append("No backend log files found.")
        lines.append("")
        return "\n".join(lines)

    for path in log_files:
        name = os.path.basename(path)
        try:
            stat = os.stat(path)
            modified_at = time.strftime(
                "%Y-%m-%d %H:%M:%S",
                time.localtime(stat.st_mtime),
            )
            lines.append(
                f"===== {name} ({stat.st_size} bytes, modified {modified_at}) ====="
            )
            with open(path, encoding="utf-8", errors="replace") as log_file:
                lines.append(log_file.read().rstrip())
        except OSError as exc:
            lines.append(f"===== {name} =====")
            lines.append(f"Could not read log file: {exc}")
        lines.append("")

    return "\n".join(lines)


def _log_level_setting(value, default: str = BACKEND_DEFAULT_LOG_LEVEL) -> LogLevel:
    normalized = str(value or default or "INFO").strip().upper()
    if hasattr(LogLevel, normalized):
        return getattr(LogLevel, normalized)
    fallback = str(default or "INFO").strip().upper()
    return getattr(LogLevel, fallback, LogLevel.INFO)


def _apply_backend_logging_settings(settings: dict) -> None:
    enabled = resolver_bool_setting(settings.get("backend_logs_enabled"), True)
    level = _log_level_setting(settings.get("backend_log_level"))
    backend_log_controller.set_enabled(enabled)
    backend_log_controller.set_global_level(level)


def register_settings_routes(routes, web, json_api_endpoint):
    """Register settings persistence and backend-log export endpoints."""
    _apply_backend_logging_settings(load_resolver_settings())

    @routes.get("/model_resolver/logs/backend/export")
    @json_api_endpoint("backend log export")
    async def export_backend_logs_route(request):
        """Download Model Resolver backend logs as a text file."""
        content = await asyncio.to_thread(_build_backend_log_export)
        filename = f"model_resolver_backend_logs_{time.strftime('%Y%m%d_%H%M%S')}.txt"
        return web.Response(
            text=content,
            content_type="text/plain",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-store",
            },
        )

    @routes.get("/model_resolver/settings")
    @json_api_endpoint("settings GET")
    async def get_settings_route(request):
        """Return persisted settings (API keys, preferences)."""
        data = await asyncio.to_thread(load_resolver_settings)
        return web.json_response({"settings": data, "schema": get_settings_schema()})

    @routes.post("/model_resolver/settings")
    @json_api_endpoint("settings POST")
    async def save_settings_route(request):
        """Persist settings (API keys, preferences) to disk."""
        payload = await request.json()
        if not isinstance(payload, dict):
            return web.json_response({"error": "Expected JSON object"}, status=400)
        settings = await asyncio.to_thread(save_resolver_settings, payload)
        _apply_backend_logging_settings(settings)
        return web.json_response({"success": True})

"""Settings persistence and backend log export used by HTTP routes."""

import asyncio
import os
import time

from ..log_system import LogLevel
from ..log_system.config import LOG_LEVEL as BACKEND_DEFAULT_LOG_LEVEL
from ..log_system.logger import parse_rotated_log_filename


def _flush_backend_log_handlers(backend_log_controller):
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


def build_backend_log_export(backend_log_controller):
    """Build a text export from the configured backend log files."""
    _flush_backend_log_handlers(backend_log_controller)
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


def apply_backend_logging_settings(backend_log_controller, settings: dict) -> None:
    """Apply persisted backend logging settings to the active logger."""
    from ..settings import bool_setting as resolver_bool_setting

    enabled = resolver_bool_setting(settings.get("backend_logs_enabled"), True)
    level = _log_level_setting(settings.get("backend_log_level"))
    backend_log_controller.set_enabled(enabled)
    backend_log_controller.set_global_level(level)


class SettingsService:
    """Implement settings persistence and backend log export endpoints."""

    def __init__(
        self,
        routes,
        web,
        json_api_endpoint,
        load_settings,
        save_settings,
        get_settings_schema,
        apply_logging_settings,
        build_log_export,
    ):
        self.asyncio = asyncio
        self.apply_logging_settings = apply_logging_settings
        self.build_log_export = build_log_export
        self.get_settings_schema = get_settings_schema
        self.json_api_endpoint = json_api_endpoint
        self.load_settings = load_settings
        self.routes = routes
        self.save_settings = save_settings
        self.web = web

    def register(self):
        """Register settings and backend log export routes."""
        self.apply_logging_settings(self.load_settings())

        @self.routes.get("/model_resolver/logs/backend/export")
        @self.json_api_endpoint("backend log export")
        async def export_backend_logs_route(request):
            """Download Model Resolver backend logs as a text file."""
            content = await self.asyncio.to_thread(self.build_log_export)
            filename = (
                "model_resolver_backend_logs_"
                f"{time.strftime('%Y%m%d_%H%M%S')}.txt"
            )
            return self.web.Response(
                text=content,
                content_type="text/plain",
                headers={
                    "Content-Disposition": (
                        f'attachment; filename="{filename}"'
                    ),
                    "Cache-Control": "no-store",
                },
            )

        @self.routes.get("/model_resolver/settings")
        @self.json_api_endpoint("settings GET")
        async def get_settings_route(request):
            """Return persisted settings (API keys, preferences)."""
            data = await self.asyncio.to_thread(self.load_settings)
            return self.web.json_response(
                {"settings": data, "schema": self.get_settings_schema()}
            )

        @self.routes.post("/model_resolver/settings")
        @self.json_api_endpoint("settings POST")
        async def save_settings_route(request):
            """Persist settings (API keys, preferences) to disk."""
            payload = await request.json()
            if not isinstance(payload, dict):
                return self.web.json_response(
                    {"error": "Expected JSON object"}, status=400
                )
            settings = await self.asyncio.to_thread(self.save_settings, payload)
            self.apply_logging_settings(settings)
            return self.web.json_response({"success": True})

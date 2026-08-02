"""Settings and backend-log HTTP route registration."""

from ..log_system import logger as backend_log_controller
from ..services.settings_service import (
    SettingsService,
    apply_backend_logging_settings,
    build_backend_log_export,
)
from ..settings import get_settings_schema
from ..settings import load_settings as load_resolver_settings
from ..settings import save_settings as save_resolver_settings


def _apply_backend_logging_settings(settings: dict) -> None:
    """Apply backend logging settings through the logging service."""
    apply_backend_logging_settings(backend_log_controller, settings)


def _build_backend_log_export():
    """Build the backend log export through the logging service."""
    return build_backend_log_export(backend_log_controller)


def register_settings_routes(routes, web, json_api_endpoint):
    """Register settings persistence and backend-log export endpoints."""
    service = SettingsService(
        routes=routes,
        web=web,
        json_api_endpoint=json_api_endpoint,
        load_settings=load_resolver_settings,
        save_settings=save_resolver_settings,
        get_settings_schema=get_settings_schema,
        apply_logging_settings=_apply_backend_logging_settings,
        build_log_export=_build_backend_log_export,
    )
    service.register()

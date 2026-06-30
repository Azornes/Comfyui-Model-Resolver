"""
@author: Azornes
@title: AzLogs
@version: 2.0.0
@description: Logging Initializer
"""
# ruff: noqa: T201
import os
import traceback
import logging

_logger = logging.getLogger(__name__)
_initialized = False
_project_root = None
_default_module_name = __name__

try:
    from .logger import logger, LogLevel, debug, info, warn, error, exception
    from .config import LOG_LEVEL, LOG_MODULE_NAME, USE_COLORS, PROJECT_ALIASES

    def _find_project_root(start_path):
        current = os.path.dirname(os.path.abspath(start_path))
        while current:
            if os.path.isdir(os.path.join(current, ".git")):
                return current
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent
        return os.path.dirname(os.path.dirname(os.path.abspath(start_path)))

    _project_root = _find_project_root(__file__)
    _default_module_name = (
        LOG_MODULE_NAME
        if LOG_MODULE_NAME is not None
        else os.path.basename(_project_root)
    )

    logger.set_global_level(LogLevel[LOG_LEVEL])

    logger.configure(
        {
            "log_to_file": True,
            "log_dir": os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"),
            "use_colors": (
                    logger.config["use_colors"]
                    if "AZLOGS_USE_COLORS" in os.environ
                    else USE_COLORS
            ),
        }
    )

    _initialized = True
except ImportError as e:
    _initialized = False
    _logger.error(f"Failed to initialize logger: {e}")
    # Provide fallback values when import fails
    LOG_MODULE_NAME = None
    PROJECT_ALIASES = []


def _normalize_module_name(module_name):
    """Normalize a dotted module name for display in logs.

    Strips common prefixes (custom_nodes, project aliases) and __init__
    suffixes to produce a clean, readable module path.
    """
    module_name = str(module_name or "").strip()
    if not module_name:
        return _default_module_name

    if module_name == "__main__":
        return _default_module_name

    # If it is a path (contains slashes or is absolute), normalize it to a relative dotted path first
    if os.sep in module_name or "/" in module_name or os.path.isabs(module_name):
        normalized_path = module_name.replace("/", os.sep).replace("\\", os.sep)
        path_no_ext = os.path.splitext(normalized_path)[0]
        if _project_root:
            try:
                relative_path = os.path.relpath(path_no_ext, _project_root)
            except ValueError:
                relative_path = os.path.basename(path_no_ext)
        else:
            relative_path = os.path.basename(path_no_ext)

        if relative_path == ".":
            module_name = ""
        else:
            module_name = relative_path.replace(os.sep, ".")

    if not module_name:
        return _default_module_name

    parts = [part for part in module_name.split(".") if part]
    if not parts:
        return _default_module_name

    # Strip __init__ suffix
    if parts[-1] == "__init__":
        parts = parts[:-1]

    # Strip LOG_MODULE_NAME prefix if present (re-added later)
    if LOG_MODULE_NAME and parts and parts[0] == LOG_MODULE_NAME:
        parts = parts[1:]

    # Strip custom_nodes.<package_name> prefix
    if "custom_nodes" in parts:
        parts = parts[parts.index("custom_nodes") + 2:]

    # Strip project aliases from config
    for alias in PROJECT_ALIASES:
        if alias in parts:
            parts = parts[parts.index(alias) + 1:]
            break

    # Re-insert LOG_MODULE_NAME prefix at the start
    package_name = LOG_MODULE_NAME or os.path.basename(_project_root or "")
    if package_name and (not parts or parts[0] != package_name):
        parts.insert(0, package_name)

    cleaned = ".".join(parts).strip(".")
    return cleaned or _default_module_name


class ModuleLogger:
    """Per-module logger with a fixed module name.

    Usage:
        log = create_module_logger(__name__)
        log.debug("message")
        log.info("message")
    """

    def __init__(self, module_name):
        self.module_name = module_name

    def debug(self, *args, **kwargs):
        if _initialized:
            kwargs.setdefault("stacklevel", 4)
            debug(self.module_name, *args, **kwargs)
        else:
            print(f"[DEBUG] [{self.module_name}]", *args)

    def info(self, *args, **kwargs):
        if _initialized:
            kwargs.setdefault("stacklevel", 4)
            info(self.module_name, *args, **kwargs)
        else:
            print(f"[INFO] [{self.module_name}]", *args)

    def warning(self, *args, **kwargs):
        if _initialized:
            kwargs.setdefault("stacklevel", 4)
            warn(self.module_name, *args, **kwargs)
        else:
            print(f"[WARN] [{self.module_name}]", *args)

    def warn(self, *args, **kwargs):
        self.warning(*args, **kwargs)

    def error(self, *args, **kwargs):
        if _initialized:
            kwargs.setdefault("stacklevel", 4)
            error(self.module_name, *args, **kwargs)
        else:
            print(f"[ERROR] [{self.module_name}]", *args)

    def exception(self, *args):
        if _initialized:
            exception(self.module_name, *args, stacklevel=4)
        else:
            print(f"[ERROR] [{self.module_name}]", *args)
            traceback.print_exc()


def create_module_logger(module_name=None):
    """Create a ModuleLogger with a normalized module name.

    Args:
        module_name: Dotted module name, typically ``__name__``.
            Required for proper module identification.

    Returns:
        A :class:`ModuleLogger` instance.
    """
    resolved_name = _normalize_module_name(module_name or _default_module_name)
    return ModuleLogger(resolved_name)



"""
AzLogs - Central logging system

Provides colored console logging, file rotation, and per-module log levels.
"""

from .log_funcs import create_module_logger
from .logger import LogLevel, logger

__all__ = [
    "LogLevel",
    "create_module_logger",
    "logger",
]

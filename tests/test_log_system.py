import io
import logging

from core.log_system.logger import DirectConsoleHandler


def test_console_handler_replaces_characters_unsupported_by_windows_encoding():
    buffer = io.BytesIO()
    stream = io.TextIOWrapper(buffer, encoding="cp1250", errors="strict")
    handler = DirectConsoleHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))

    handler.emit(
        logging.LogRecord(
            "test",
            logging.INFO,
            __file__,
            1,
            "Download complete ✓",
            (),
            None,
        )
    )
    stream.flush()

    assert "Download complete ?" in buffer.getvalue().decode("cp1250")

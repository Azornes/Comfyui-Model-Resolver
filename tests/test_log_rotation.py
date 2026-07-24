import logging
import os
import tempfile
import unittest

from core.log_system.logger import (
    SafeRotatingFileHandler,
    parse_rotated_log_filename,
    rotated_log_filename,
)


class RotatedLogFilenameTests(unittest.TestCase):
    def test_places_rotation_before_log_extension(self):
        path = os.path.join("logs", "azlogs_MResolver.log.3")
        self.assertEqual(
            rotated_log_filename(path),
            os.path.join("logs", "azlogs_MResolver.3.log"),
        )

    def test_leaves_unrelated_filename_unchanged(self):
        path = os.path.join("logs", "azlogs_MResolver.log")
        self.assertEqual(rotated_log_filename(path), path)

    def test_parser_accepts_current_style(self):
        expected = ("azlogs_MResolver", 2)
        self.assertEqual(
            parse_rotated_log_filename("azlogs_MResolver.2.log"),
            expected,
        )
        self.assertEqual(
            parse_rotated_log_filename("azlogs_MResolver.log"),
            ("azlogs_MResolver", 0),
        )

    def test_parser_rejects_non_log_and_legacy_files(self):
        self.assertIsNone(parse_rotated_log_filename("other.txt"))
        self.assertIsNone(parse_rotated_log_filename("azlogs_MResolver.log.2"))
        self.assertIsNone(parse_rotated_log_filename("azlogs_MResolver.log2"))


class SafeRotatingFileHandlerTests(unittest.TestCase):
    def test_rollover_keeps_log_as_the_final_extension(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = os.path.join(temp_dir, "azlogs_MResolver.log")
            logger = logging.getLogger(f"test-log-rotation-{id(self)}")
            logger.handlers.clear()
            logger.propagate = False
            logger.setLevel(logging.INFO)
            handler = SafeRotatingFileHandler(
                log_path,
                maxBytes=32,
                backupCount=2,
                encoding="utf-8",
            )
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)

            try:
                logger.info("first message large enough to rotate")
                logger.info("second message large enough to rotate")
                logger.info("third message large enough to rotate")
                handler.flush()
            finally:
                logger.removeHandler(handler)
                handler.close()

            files = set(os.listdir(temp_dir))
            self.assertIn("azlogs_MResolver.log", files)
            self.assertIn("azlogs_MResolver.1.log", files)
            self.assertIn("azlogs_MResolver.2.log", files)
            self.assertNotIn("azlogs_MResolver.3.log", files)
            self.assertNotIn("azlogs_MResolver.log.1", files)


if __name__ == "__main__":
    unittest.main()

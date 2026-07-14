import unittest
import sqlite3
import json
from core.sources.lora_manager_archive import (
    _normalize_model_type,
    _extract_search_tokens,
    _query_candidate_rows,
    _load_full_rows_for_versions,
    _build_result_from_row,
)

class LoraManagerArchiveTests(unittest.TestCase):

    def test_normalize_model_type(self):
        self.assertEqual(_normalize_model_type("Loras"), "lora")
        self.assertEqual(_normalize_model_type("Checkpoints"), "checkpoint")
        self.assertEqual(_normalize_model_type("Embedding"), "textualinversion")
        self.assertEqual(_normalize_model_type("Custom"), "custom")

    def test_extract_search_tokens(self):
        tokens = _extract_search_tokens("my_awesome_model_v1.safetensors")
        self.assertIn("awesome", tokens["content_terms"])
        self.assertIn("model", tokens["content_terms"])
        self.assertIn("v1", tokens["version_terms"])

        # Test that generic tokens and extensions are filtered out
        tokens_generic = _extract_search_tokens("my_awesome_model_fp8_v1.sft")
        self.assertNotIn("fp8", tokens_generic["content_terms"])
        self.assertNotIn("sft", tokens_generic["content_terms"])
        self.assertIn("awesome", tokens_generic["content_terms"])
        self.assertIn("model", tokens_generic["content_terms"])
        self.assertIn("v1", tokens_generic["version_terms"])

    def test_database_operations_with_in_memory_sqlite(self):
        # Create an in-memory database
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row

        # Create tables
        conn.execute("""
            CREATE TABLE models (
                id INTEGER PRIMARY KEY,
                name TEXT,
                type TEXT,
                data TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE model_versions (
                id INTEGER PRIMARY KEY,
                model_id INTEGER,
                name TEXT,
                base_model TEXT,
                position INTEGER,
                data TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE model_files (
                id INTEGER PRIMARY KEY,
                version_id INTEGER,
                type TEXT,
                data TEXT
            )
        """)

        # Insert dummy data
        conn.execute("INSERT INTO models VALUES (1, 'ghost_checkpoint', 'CHECKPOINT', ?)", (json.dumps({"tags": ["anime"]}),))
        conn.execute("INSERT INTO model_versions VALUES (10, 1, 'v1.0', 'SD 1.5', 1, ?)", (json.dumps({"trainedWords": ["ghost_word"]}),))
        conn.execute("INSERT INTO model_files VALUES (100, 10, 'Model', ?)", (json.dumps({"name": "ghost_v1.safetensors"}),))
        conn.commit()

        # Test querying candidates
        candidates = _query_candidate_rows(conn, "ghost_v1.safetensors", "checkpoint", 10)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["version_id"], 10)

        # Test loading full version rows
        full_rows = _load_full_rows_for_versions(conn, [10])
        self.assertIn(10, full_rows)
        row = full_rows[10]
        self.assertEqual(row["model_name"], "ghost_checkpoint")
        self.assertEqual(row["version_name"], "v1.0")

        # Test building result from row
        result = _build_result_from_row(conn, row, "ghost_checkpoint")
        self.assertIsNotNone(result)
        self.assertEqual(result["filename"], "ghost_v1.safetensors")
        self.assertEqual(result["name"], "ghost_checkpoint")
        self.assertEqual(result["trained_words"], ["ghost_word"])

        conn.close()

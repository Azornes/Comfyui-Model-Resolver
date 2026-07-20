import unittest
from core.matcher import (
    build_filename_search_queries,
    calculate_archived_model_confidence,
    calculate_filename_confidence,
    calculate_similarity,
    find_matches,
    normalize_filename,
    normalize_model_family_filename,
)
from core.sources.model_list import search_model_list, search_model_list_multiple
from core.progress import report_progress
from core.type_utils import (
    MODEL_CONTAINER_SUFFIXES,
    MODEL_VARIANT_SUFFIXES,
    NUMERIC_PRECISION_SUFFIXES,
    QUANTIZATION_LEVEL_SUFFIXES,
    QUANTIZATION_SCHEME_SUFFIXES,
    TECHNICAL_MODEL_SUFFIXES,
    as_dict,
    as_list,
    format_size_bytes,
)
class MatcherTests(unittest.TestCase):
    def test_normalize_filename_removes_extension_and_converts_lowercase(self):
        self.assertEqual("test model", normalize_filename("Test_Model.safetensors"))
        self.assertEqual("test model", normalize_filename("test-model.ckpt"))

    def test_normalize_filename_replaces_dots_and_separators(self):
        self.assertEqual("test model v1 0", normalize_filename("test.model.v1.0.safetensors"))
        self.assertEqual("my cool model 1 2 3", normalize_filename("My_Cool-Model.1.2.3.ckpt"))

    def test_calculate_similarity_identical(self):
        self.assertEqual(1.0, calculate_similarity("hello", "hello"))

    def test_calculate_similarity_different(self):
        self.assertLess(calculate_similarity("hello", "world"), 0.5)

    def test_find_matches_exact_and_fuzzy(self):
        candidates = [
            {"filename": "sd_xl_base_1.0.safetensors"},
            {"filename": "pony Diffusion.safetensors"},
        ]
        matches = find_matches("sd_xl_base_1.0.safetensors", candidates)
        self.assertEqual(2, len(matches))
        self.assertEqual("sd_xl_base_1.0.safetensors", matches[0]["filename"])
        self.assertEqual(1.0, matches[0]["similarity"])

        # With higher threshold, only the best match should be returned
        matches_filtered = find_matches("sd_xl_base_1.0.safetensors", candidates, threshold=0.7)
        self.assertEqual(1, len(matches_filtered))

    def test_model_family_normalization_ignores_precision_and_quantization(self):
        self.assertEqual(
            "qwen3vl 4b abliterated",
            normalize_model_family_filename(
                "qwen3vl-4b-abliterated_fp8_e4m3fn_scaled.safetensors"
            ),
        )
        self.assertEqual(
            "qwen3vl 4b abliterated",
            normalize_model_family_filename(
                "qwen3vl-4b-abliterated_int8_conv.safetensors"
            ),
        )
        self.assertEqual(
            "qwen3vl 4b",
            normalize_model_family_filename("qwen3vl_4b_iq4_nl.gguf"),
        )

    def test_model_family_normalization_handles_common_technical_families(self):
        suffixes = [
            "float16",
            "half",
            "e4m3fnuz",
            "e5m2fnuz",
            "e2m1",
            "nf4",
            "q4_0",
            "q3_k_m",
            "iq2_xxs",
            "iq4_nl",
            "tq1_0",
            "mxfp4",
            "nvfp4",
            "gptq",
            "awq",
            "exl2",
            "hqq",
            "aqlm",
            "bnb4",
            "ema-only",
            "pruned",
        ]

        for suffix in suffixes:
            with self.subTest(suffix=suffix):
                self.assertEqual(
                    "qwen3vl 4b",
                    normalize_model_family_filename(
                        f"qwen3vl_4b_{suffix}.safetensors"
                    ),
                )

    def test_filename_confidence_prioritizes_family_and_size_over_precision(self):
        target = "qwen3vl-4b-abliterated_fp8_e4m3fn.safetensors"

        self.assertEqual(
            94.0,
            calculate_filename_confidence(
                target, "qwen3vl-4b-abliterated_int8.safetensors"
            ),
        )
        self.assertGreaterEqual(
            calculate_filename_confidence(target, "qwen3vl_4b_int8.safetensors"),
            90.0,
        )
        self.assertGreaterEqual(
            calculate_filename_confidence(
                target, "qwen3vl-4b-heretic_int8.safetensors"
            ),
            84.0,
        )
        self.assertLess(
            calculate_filename_confidence(
                target, "qwen_image_fp8_e4m3fn.safetensors"
            ),
            calculate_filename_confidence(
                target, "qwen3vl-4b-heretic_int8.safetensors"
            ),
        )

    def test_filename_confidence_does_not_merge_different_sizes_or_generations(self):
        target = "qwen3vl-4b_fp8_e4m3fn.safetensors"

        self.assertLess(
            calculate_filename_confidence(target, "qwen3vl-8b_int8.safetensors"),
            70.0,
        )
        self.assertLess(
            calculate_filename_confidence(target, "qwen2vl-4b_int8.safetensors"),
            70.0,
        )

    def test_find_matches_includes_compatible_qwen_precision_variants(self):
        target = "qwen3vl-4b-abliterated_fp8_e4m3fn.safetensors"
        candidates = [
            {"filename": "qwen3vl-4b-abliterated_int8.safetensors"},
            {"filename": "qwen3vl_4b_int8.safetensors"},
            {"filename": "qwen3vl-4b-heretic_int8.safetensors"},
            {"filename": "qwen3vl-8b_int8.safetensors"},
            {"filename": "qwen_image_fp8_e4m3fn.safetensors"},
        ]

        matches = find_matches(target, candidates, threshold=0.7)

        self.assertEqual(
            [
                "qwen3vl-4b-abliterated_int8.safetensors",
                "qwen3vl_4b_int8.safetensors",
                "qwen3vl-4b-heretic_int8.safetensors",
                "qwen_image_fp8_e4m3fn.safetensors",
            ],
            [match["filename"] for match in matches],
        )

    def test_search_model_list_unification(self):
        try:
            search_model_list("nonexistent_model_name_xyz.safetensors", exact_only=True)
            search_model_list_multiple("nonexistent_model_name_xyz.safetensors")
        except Exception as e:
            self.fail(f"search_model_list failed with exception: {e}")

    def test_build_filename_search_queries(self):
        # Verify that common precisions are extracted correctly
        queries = build_filename_search_queries("sdxl_ep10_fp16.safetensors")
        self.assertIn("sdxl_ep10_fp16.safetensors", queries)
        self.assertIn("sdxl_ep10_fp16", queries)
        self.assertIn("sdxl_ep10", queries)

        queries_simple = build_filename_search_queries("model.ckpt")
        self.assertIn("model.ckpt", queries_simple)
        self.assertIn("model", queries_simple)

        queries_int8 = build_filename_search_queries(
            "qwen3vl_4b_abliterated_int8.safetensors"
        )
        self.assertIn("qwen3vl_4b_abliterated", queries_int8)

        for filename in [
            "qwen3vl_4b_q4_k_m.gguf",
            "qwen3vl_4b_iq2_xxs.gguf",
            "qwen3vl_4b_e4m3fnuz.safetensors",
            "qwen3vl_4b_exl2.safetensors",
        ]:
            with self.subTest(filename=filename):
                self.assertIn("qwen3vl_4b", build_filename_search_queries(filename))

    def test_archived_model_confidence_uses_model_family_variants(self):
        target = "qwen3vl-4b-abliterated_fp8_e4m3fn.safetensors"

        self.assertEqual(
            94.0,
            calculate_archived_model_confidence(
                target,
                filename="qwen3vl-4b-abliterated_int8.safetensors",
            ),
        )
        self.assertGreaterEqual(
            calculate_archived_model_confidence(
                target,
                filename="qwen3vl-4b-heretic_int8.safetensors",
            ),
            84.0,
        )
        self.assertLess(
            calculate_archived_model_confidence(
                target,
                filename="qwen3vl-8b_int8.safetensors",
            ),
            70.0,
        )





class ProgressTests(unittest.TestCase):
    def test_report_progress_calls_callback(self):
        called_payload = None

        def callback(payload):
            nonlocal called_payload
            called_payload = payload

        report_progress(
            callback,
            stage="test_stage",
            message="test_message",
            percent=50.0,
            foo="bar"
        )

        self.assertIsNotNone(called_payload)
        self.assertEqual("test_stage", called_payload.get("stage"))
        self.assertEqual("test_message", called_payload.get("message"))
        self.assertEqual(50.0, called_payload.get("percent"))
        self.assertEqual("bar", called_payload.get("foo"))

    def test_report_progress_handles_exceptions(self):
        def bad_callback(payload):
            raise ValueError("Boom")

        # Should not raise exception
        try:
            report_progress(bad_callback, "stage", "msg")
        except Exception as e:
            self.fail(f"report_progress raised exception: {e}")

    def test_report_progress_handles_none_callback(self):
        # Should do nothing and not raise exception
        try:
            report_progress(None, "stage", "msg")
        except Exception as e:
            self.fail(f"report_progress raised exception with None callback: {e}")


class TypeUtilsTests(unittest.TestCase):
    def test_technical_suffix_categories_are_disjoint_and_combined(self):
        precision = set(NUMERIC_PRECISION_SUFFIXES)
        quantization_levels = set(QUANTIZATION_LEVEL_SUFFIXES)
        quantization_schemes = set(QUANTIZATION_SCHEME_SUFFIXES)
        containers = set(MODEL_CONTAINER_SUFFIXES)
        variants = set(MODEL_VARIANT_SUFFIXES)
        categories = [
            precision,
            quantization_levels,
            quantization_schemes,
            containers,
            variants,
        ]

        for index, category in enumerate(categories):
            for other_category in categories[index + 1 :]:
                self.assertTrue(category.isdisjoint(other_category))
        self.assertEqual(
            set().union(*categories),
            set(TECHNICAL_MODEL_SUFFIXES),
        )

    def test_as_dict_returns_dict_when_dict(self):
        d = {"a": 1}
        self.assertEqual(d, as_dict(d))

    def test_as_dict_returns_empty_dict_when_not_dict(self):
        self.assertEqual({}, as_dict("not a dict"))
        self.assertEqual({}, as_dict(None))

    def test_as_list_returns_filtered_list(self):
        self.assertEqual([1, 2], as_list([1, None, "", 2]))

    def test_as_list_handles_tuples_and_sets(self):
        self.assertEqual([1, 2], as_list((1, None, "", 2)))
        self.assertEqual([1, 2], as_list({1, "", 2}))

    def test_as_list_handles_comma_separated_strings(self):
        self.assertEqual(["a", "b", "c"], as_list("a, b,, c"))

    def test_as_list_returns_empty_list_otherwise(self):
        self.assertEqual([], as_list(None))
        self.assertEqual([], as_list(123))

    def test_format_size_bytes(self):
        self.assertEqual("1.5 GB", format_size_bytes(1.5 * 1024 * 1024 * 1024))
        self.assertEqual("1.5GB", format_size_bytes(1.5 * 1024 * 1024 * 1024, include_space=False))
        self.assertEqual("0 B", format_size_bytes(0))
        self.assertEqual("0B", format_size_bytes(0, include_space=False))
        self.assertIsNone(format_size_bytes(None))
        self.assertIsNone(format_size_bytes(""))
        self.assertEqual("invalid_str", format_size_bytes("invalid_str"))
        self.assertEqual("500.0 KB", format_size_bytes("512000"))


if __name__ == "__main__":
    unittest.main()

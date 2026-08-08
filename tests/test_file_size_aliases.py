import unittest

from core.metadata_audit import extract_metadata_size
from core.type_utils import extract_file_size, extract_file_size_detail


class FileSizeAliasTests(unittest.TestCase):

    def test_byte_aliases_are_supported_by_both_extractors(self):
        byte_aliases = ("size", "sizeBytes", "size_bytes", "fileSize", "file_size", "bytes")

        for key in byte_aliases:
            with self.subTest(key=key):
                self.assertEqual(2048, extract_file_size({key: 2048}))
                self.assertEqual((2048, key), extract_metadata_size({key: 2048}, "model.safetensors"))

    def test_kibibyte_aliases_are_supported_by_both_extractors(self):
        for key in ("sizeKB", "size_kb"):
            with self.subTest(key=key):
                self.assertEqual(2048, extract_file_size({key: 2}))
                self.assertEqual((2048, key), extract_metadata_size({key: 2}, "model.safetensors"))

    def test_lfs_byte_aliases_remain_supported(self):
        for key in ("size", "sizeBytes", "size_bytes"):
            with self.subTest(key=key):
                self.assertEqual(2048, extract_file_size({"lfs": {key: 2048}}))

    def test_existing_extractor_precedence_is_preserved_when_aliases_collide(self):
        metadata = {"size": 1024, "sizeBytes": 2048}

        self.assertEqual(2048, extract_file_size(metadata))
        self.assertEqual((2048, "sizeBytes"), extract_file_size_detail(metadata))
        self.assertEqual((2048, "sizeBytes"), extract_metadata_size(metadata, "model.safetensors"))

    def test_detail_keeps_legacy_direct_field_matching_order(self):
        self.assertEqual(
            (2048, "size"),
            extract_file_size_detail({"size": 2048, "sizeBytes": 2048}),
        )
        self.assertEqual(
            (2048, "sizeBytes"),
            extract_file_size_detail({"sizeKB": 2, "sizeBytes": 2048}),
        )
        self.assertEqual(
            (300, None),
            extract_file_size_detail({"lfs": {"size": 300}}),
        )


if __name__ == "__main__":
    unittest.main()

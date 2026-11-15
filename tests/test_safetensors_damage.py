import json
import struct
import pytest
from core.path_utils import check_safetensors_damage


def _make_safetensors(tmp_path, filename, header_dict, data_payload_bytes):
    header_json = json.dumps(header_dict).encode("utf-8")
    header_len = len(header_json)
    file_bytes = struct.pack("<Q", header_len) + header_json + data_payload_bytes
    p = tmp_path / filename
    p.write_bytes(file_bytes)
    return str(p)


def test_safetensors_damage_valid(tmp_path):
    header = {
        "__metadata__": {"format": "pt"},
        "weight_a": {
            "dtype": "F16",
            "shape": [10, 10],
            "data_offsets": [0, 100],
        },
    }
    path = _make_safetensors(tmp_path, "valid.safetensors", header, b"x" * 100)
    assert check_safetensors_damage(path) == ""


def test_safetensors_damage_truncated(tmp_path):
    header = {
        "weight_a": {
            "dtype": "F16",
            "shape": [10, 10],
            "data_offsets": [0, 1000],
        },
    }
    # File only has 200 bytes of tensor data instead of 1000
    path = _make_safetensors(tmp_path, "truncated.safetensors", header, b"x" * 200)
    assert check_safetensors_damage(path) == "truncated"


def test_safetensors_damage_short(tmp_path):
    p = tmp_path / "short.safetensors"
    p.write_bytes(b"123")
    assert check_safetensors_damage(str(p)) == "short"


def test_safetensors_damage_header_size(tmp_path):
    # Header size claims 50000000 bytes, file is much smaller
    p = tmp_path / "huge_header.safetensors"
    p.write_bytes(struct.pack("<Q", 50_000_000) + b"some_data")
    assert check_safetensors_damage(str(p)) == "header_size"


def test_safetensors_damage_invalid_json_header(tmp_path):
    bad_header = b"{this is not valid json!}"
    p = tmp_path / "corrupt_header.safetensors"
    p.write_bytes(struct.pack("<Q", len(bad_header)) + bad_header + b"payload")
    assert check_safetensors_damage(str(p)) == "header"


def test_safetensors_damage_invalid_tensor_offsets(tmp_path):
    header = {
        "weight_a": {
            "data_offsets": "not-a-list",
        },
    }
    path = _make_safetensors(tmp_path, "bad_offsets.safetensors", header, b"x" * 50)
    assert check_safetensors_damage(path) == "header"


def test_safetensors_damage_ignores_non_safetensors(tmp_path):
    p = tmp_path / "model.ckpt"
    p.write_bytes(b"arbitrary binary data")
    assert check_safetensors_damage(str(p)) == ""

"""Tests for modern base model inferences and GGUF header reading."""

import json
import struct

from core import path_utils


def _create_synthetic_safetensors(tmp_path, filename, metadata=None, tensor_keys=None):
    file_path = tmp_path / filename
    header = {}
    if metadata:
        header["__metadata__"] = metadata
    if tensor_keys:
        for k in tensor_keys:
            header[k] = {"dtype": "F16", "shape": [1, 1], "data_offsets": [0, 2]}

    header_bytes = json.dumps(header).encode("utf-8")
    header_len = len(header_bytes)

    with open(file_path, "wb") as f:
        f.write(header_len.to_bytes(8, byteorder="little"))
        f.write(header_bytes)
        f.write(b"\x00\x00")  # dummy payload
    return str(file_path)


def _create_synthetic_gguf(tmp_path, filename, arch="wan", name="Wan2.1-Test"):
    file_path = tmp_path / filename
    data = bytearray(b"GGUF")
    data += struct.pack("<I", 3)  # version
    data += struct.pack("<Q", 0)  # tensor count
    data += struct.pack("<Q", 2)  # kv count

    # kv 1: general.architecture
    key1 = b"general.architecture"
    data += struct.pack("<Q", len(key1)) + key1
    data += struct.pack("<I", 8)  # STRING
    val1 = arch.encode("utf-8")
    data += struct.pack("<Q", len(val1)) + val1

    # kv 2: general.name
    key2 = b"general.name"
    data += struct.pack("<Q", len(key2)) + key2
    data += struct.pack("<I", 8)  # STRING
    val2 = name.encode("utf-8")
    data += struct.pack("<Q", len(val2)) + val2

    with open(file_path, "wb") as f:
        f.write(data)
    return str(file_path)


def test_infer_safetensors_modern_architectures_via_metadata(tmp_path):
    wan_path = _create_synthetic_safetensors(tmp_path, "wan_test.safetensors", metadata={"architecture": "wan"})
    assert path_utils.infer_safetensors_base_model(wan_path) == "Wan Video"

    hy_path = _create_synthetic_safetensors(tmp_path, "hy_test.safetensors", metadata={"modelspec.architecture": "hunyuan-video"})
    assert path_utils.infer_safetensors_base_model(hy_path) == "Hunyuan Video"

    cosmos_path = _create_synthetic_safetensors(tmp_path, "cosmos_test.safetensors", metadata={"ss_base_model_version": "cosmos"})
    assert path_utils.infer_safetensors_base_model(cosmos_path) == "Cosmos"

    qwen_path = _create_synthetic_safetensors(tmp_path, "qwen_test.safetensors", metadata={"architecture": "qwen_image"})
    assert path_utils.infer_safetensors_base_model(qwen_path) == "Qwen Image"


def test_infer_safetensors_modern_architectures_via_tensor_keys(tmp_path):
    hy_path = _create_synthetic_safetensors(tmp_path, "hy_tensors.safetensors", tensor_keys=["individual_token_refiner.weight"])
    assert path_utils.infer_safetensors_base_model(hy_path) == "Hunyuan Video"

    wan_path = _create_synthetic_safetensors(
        tmp_path,
        "wan_tensors.safetensors",
        tensor_keys=["blocks.0.self_attn.weight", "blocks.0.cross_attn.weight"],
    )
    assert path_utils.infer_safetensors_base_model(wan_path) == "Wan Video"

    cosmos_path = _create_synthetic_safetensors(tmp_path, "cosmos_tensors.safetensors", tensor_keys=["adaln_modulation_self_attn.weight"])
    assert path_utils.infer_safetensors_base_model(cosmos_path) == "Cosmos"


def test_gguf_metadata_parsing_and_base_model_inference(tmp_path):
    gguf_wan = _create_synthetic_gguf(tmp_path, "model.gguf", arch="wan")
    meta = path_utils.read_gguf_header(gguf_wan)
    assert meta is not None
    assert meta.get("general.architecture") == "wan"
    assert path_utils.infer_gguf_base_model(gguf_wan) == "Wan Video"

    gguf_flux = _create_synthetic_gguf(tmp_path, "flux.gguf", arch="flux")
    assert path_utils.infer_gguf_base_model(gguf_flux) == "Flux.1 D"

    # Test unified helper
    assert path_utils.infer_model_base_model(gguf_wan) == "Wan Video"
    assert path_utils.infer_model_base_model(gguf_flux) == "Flux.1 D"

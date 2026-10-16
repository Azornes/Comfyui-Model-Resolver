import asyncio
import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from core.routes.context import RouteContext
from core.services.image_metadata_service import (
    ImageMetadataService,
    inspect_civitai_image,
    inspect_image_bytes,
    inspect_workflow_json,
)
from core.workflow.formats import (
    API_WORKFLOW_FORMAT,
    UI_WORKFLOW_FORMAT,
    detect_workflow_format,
    normalize_workflow_payload,
)


def api_workflow():
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "models/checkpoint.safetensors"},
            "_meta": {"title": "Checkpoint"},
        },
        "2": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "seed": 123,
                "steps": 20,
            },
        },
    }


def png_with_metadata(metadata):
    image = Image.new("RGB", (32, 16), color=(20, 30, 40))
    png_info = PngInfo()
    for key, value in metadata.items():
        png_info.add_text(key, value)
    output = io.BytesIO()
    image.save(output, format="PNG", pnginfo=png_info)
    return output.getvalue()


def jpeg_with_nested_user_comment(comment):
    image = Image.new("RGB", (32, 16), color=(20, 30, 40))
    exif = Image.Exif()
    exif[34665] = {
        37510: b"UNICODE\x00\x00" + comment.encode("utf-16le"),
    }
    output = io.BytesIO()
    image.save(output, format="JPEG", exif=exif)
    return output.getvalue()


def test_api_workflow_is_detected_and_normalized_for_existing_analyzer():
    api = api_workflow()

    assert detect_workflow_format(api) == API_WORKFLOW_FORMAT
    normalized, workflow_format = normalize_workflow_payload(api)

    assert workflow_format == API_WORKFLOW_FORMAT
    assert [node["type"] for node in normalized["nodes"]] == [
        "CheckpointLoaderSimple",
        "KSampler",
    ]
    assert normalized["nodes"][0]["widgets_values"] == [
        "models/checkpoint.safetensors"
    ]
    assert normalized["nodes"][0]["outputs"][0]["links"] == [1]
    assert normalized["nodes"][1]["inputs"][0]["link"] == 1


def test_image_metadata_reads_comfyui_api_prompt():
    result = inspect_image_bytes(
        png_with_metadata({"prompt": json.dumps(api_workflow())}),
        "generated.png",
    )

    assert result["filename"] == "generated.png"
    assert result["image"] == {
        "format": "PNG",
        "width": 32,
        "height": 16,
        "mode": "RGB",
    }
    assert result["workflow_format"] == API_WORKFLOW_FORMAT
    assert result["workflow_source"] == "prompt"
    assert result["workflow_node_count"] == 2
    assert result["metadata"]["has_workflow"] is True


def test_image_without_workflow_still_returns_safe_image_metadata():
    result = inspect_image_bytes(
        png_with_metadata({"parameters": "seed: 123, steps: 20"}),
        "plain.png",
    )

    assert result["workflow"] is None
    assert result["workflow_format"] == ""
    assert result["metadata"]["parameters"] == "seed: 123, steps: 20"


def test_jpeg_nested_exif_reads_civitai_metadata_and_resources():
    named_resources = [
        {
            "type": "checkpoint",
            "modelVersionId": 3072332,
            "modelName": "Krea 2 Turbo",
            "modelVersionName": "v1.0",
        },
        {
            "type": "lora",
            "weight": 0.5,
            "modelVersionId": 3220691,
            "modelName": "SNOFS",
            "modelVersionName": "Krea 2 v1.3D",
        },
    ]
    civitai_metadata = {
        "workflow": "txt2img",
        "prompt": "a pilot",
        "resources": [
            {
                "modelVersionId": 3072332,
                "strength": 1,
                "type": "Checkpoint",
            },
            {
                "modelVersionId": 3220691,
                "strength": 0.5,
                "type": "LORA",
            },
        ],
    }
    comment = (
        "a pilot\n"
        "Negative prompt: \n"
        "Steps: 8, Sampler: euler, CFG scale: 1\n"
        f"Civitai resources: {json.dumps(named_resources)}\n"
        f"Civitai metadata: {json.dumps(civitai_metadata)}"
    )

    result = inspect_image_bytes(jpeg_with_nested_user_comment(comment), "civitai.jpg")

    assert "EXIF:UserComment" in result["metadata"]["keys"]
    assert "Civitai metadata" in result["metadata"]["keys"]
    assert "Civitai resources" in result["metadata"]["keys"]
    assert result["metadata"]["parameters"].startswith("a pilot")
    assert result["civitai_workflow"] == "txt2img"
    assert result["workflow"] is None
    assert result["workflow_format"] == ""
    assert result["civitai_metadata"]["prompt"] == "a pilot"
    assert [resource["name"] for resource in result["civitai_resources"]] == [
        "Krea 2 Turbo",
        "SNOFS",
    ]
    assert [resource["category"] for resource in result["civitai_resources"]] == [
        "checkpoints",
        "loras",
    ]
    assert result["civitai_resources"][1]["strength"] == 0.5


def test_json_inspection_accepts_ui_and_api_workflows():
    ui = {"nodes": [{"id": 1, "type": "CheckpointLoaderSimple", "widgets_values": []}]}

    ui_result = inspect_workflow_json(ui, filename="workflow.json")
    api_result = inspect_workflow_json(json.dumps(api_workflow()))

    assert ui_result["workflow_format"] == UI_WORKFLOW_FORMAT
    assert ui_result["workflow_node_count"] == 1
    assert api_result["workflow_format"] == API_WORKFLOW_FORMAT
    assert api_result["workflow_node_count"] == 2


def test_json_inspection_rejects_unrelated_json():
    with pytest.raises(ValueError, match="Unsupported workflow JSON"):
        inspect_workflow_json({"settings": {"theme": "dark"}})


@pytest.mark.asyncio
async def test_metadata_service_accepts_image_data_url():
    raw = png_with_metadata({"prompt": json.dumps(api_workflow())})
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "source_type": "image",
                "filename": "generated.png",
                "data_url": data_url,
            }
        )
    )
    service = ImageMetadataService(
        RouteContext({"asyncio": asyncio, "web": web})
    )

    response = await service.inspect_metadata(request)
    body = json.loads(response.text)

    assert response.status == 200
    assert body["workflow_format"] == API_WORKFLOW_FORMAT
    assert body["workflow_node_count"] == 2


def civitai_html_payload(meta=None, resources=None, img_data=None):
    if meta is None:
        meta = {
            "prompt": "cyberpunk woman, glowing neon",
            "negativePrompt": "blurry, low quality",
            "cfgScale": 7.0,
            "steps": 25,
            "sampler": "Euler a",
            "seed": 42,
            "Size": "1024x1024",
            "civitaiResources": [
                {
                    "type": "checkpoint",
                    "modelId": 12345,
                    "modelVersionId": 67890,
                    "modelName": "CyberRealistic",
                    "versionName": "v4.0",
                    "strength": 1.0,
                }
            ],
        }
    if resources is None:
        resources = [
            {
                "id": 9999,
                "modelId": 54321,
                "name": "NeonGlow LoRA",
                "modelType": "LORA",
                "strength": 0.8,
            }
        ]
    if img_data is None:
        img_data = {
            "id": 145110824,
            "name": "cyberpunk_image.jpeg",
            "width": 1024,
            "height": 1024,
            "mimeType": "image/jpeg",
        }

    next_data = {
        "props": {
            "pageProps": {
                "trpcState": {
                    "json": {
                        "queries": [
                            {
                                "queryKey": [["image", "get"], {"input": {"id": 145110824}}],
                                "state": {"data": img_data},
                            },
                            {
                                "queryKey": [["image", "getGenerationData"], {"input": {"id": 145110824}}],
                                "state": {
                                    "data": {
                                        "meta": meta,
                                        "resources": resources,
                                    }
                                },
                            },
                        ]
                    }
                }
            }
        }
    }

    return (
        '<!DOCTYPE html><html><head>'
        f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(next_data)}</script>'
        '</head><body></body></html>'
    )


def mock_civitai_version_request(name, url, **kwargs):
    if "67890" in url:
        return {
            "name": "v4.0",
            "model": {"name": "CyberRealistic"},
            "files": [
                {
                    "name": "cyberrealistic_v40.safetensors",
                    "primary": True,
                    "type": "Model",
                    "hashes": {"SHA256": "ABC123"},
                }
            ],
        }
    if "9999" in url or "54321" in url:
        return {
            "name": "v1.0",
            "model": {"name": "NeonGlow LoRA"},
            "files": [
                {
                    "name": "neon_glow_lora_v1.safetensors",
                    "primary": True,
                    "type": "Model",
                    "hashes": {"SHA256": "DEF456"},
                }
            ],
        }
    return None


def test_inspect_civitai_image_extracts_metadata_and_resources():
    html = civitai_html_payload()
    with patch(
        "core.services.image_metadata_service.request_source_response",
        return_value=SimpleNamespace(status_code=200, text=html),
    ), patch(
        "core.services.image_metadata_service.execute_provider_json_request",
        side_effect=mock_civitai_version_request,
    ):
        result = inspect_civitai_image(145110824, url="https://civitai.red/images/145110824")

    assert result["source_type"] == "civitai"
    assert result["civitai_image_id"] == 145110824
    assert result["civitai_metadata"]["prompt"] == "cyberpunk woman, glowing neon"
    assert result["civitai_metadata"]["negativePrompt"] == "blurry, low quality"
    assert len(result["civitai_resources"]) == 2
    categories = {res["category"] for res in result["civitai_resources"]}
    assert categories == {"checkpoints", "loras"}
    assert "cyberpunk woman" in result["metadata"]["parameters"]
    assert "Civitai metadata" in result["metadata"]["keys"]
    assert "Civitai resources" in result["metadata"]["keys"]

    # Verify filenames were intelligently resolved from version details
    ckpt_res = next(r for r in result["civitai_resources"] if r["category"] == "checkpoints")
    assert ckpt_res["filename"] == "cyberrealistic_v40.safetensors"
    assert ckpt_res["model_name"] == "CyberRealistic"
    lora_res = next(r for r in result["civitai_resources"] if r["category"] == "loras")
    assert lora_res["filename"] == "neon_glow_lora_v1.safetensors"
    assert lora_res["model_name"] == "NeonGlow LoRA"
    assert "Model: cyberrealistic_v40.safetensors" in result["metadata"]["parameters"]


def test_inspect_civitai_image_normalizes_prompt_lora_tags():
    meta = {
        "prompt": "portrait of woman <lora:NeonGlow LoRA:0.85> in neon city",
        "civitaiResources": [
            {
                "type": "lora",
                "modelId": 54321,
                "modelVersionId": 9999,
                "modelName": "NeonGlow LoRA",
                "strength": 0.85,
            }
        ],
    }
    html = civitai_html_payload(meta=meta, resources=[])
    with patch(
        "core.services.image_metadata_service.request_source_response",
        return_value=SimpleNamespace(status_code=200, text=html),
    ), patch(
        "core.services.image_metadata_service.execute_provider_json_request",
        side_effect=mock_civitai_version_request,
    ):
        result = inspect_civitai_image(145110824)

    assert "<lora:neon_glow_lora_v1:0.85>" in result["civitai_metadata"]["prompt"]


def test_inspect_civitai_image_with_embedded_comfy_workflow():
    meta = {
        "prompt": "prompt with workflow",
        "comfy": api_workflow(),
    }
    html = civitai_html_payload(meta=meta)
    with patch(
        "core.services.image_metadata_service.request_source_response",
        return_value=SimpleNamespace(status_code=200, text=html),
    ), patch(
        "core.services.image_metadata_service.execute_provider_json_request",
        side_effect=mock_civitai_version_request,
    ):
        result = inspect_civitai_image(145110824)

    assert result["workflow_format"] == API_WORKFLOW_FORMAT
    assert result["workflow_node_count"] == 2
    assert result["workflow_source"] == "Civitai generation data"


@pytest.mark.asyncio
async def test_metadata_service_accepts_civitai_source_type():
    html = civitai_html_payload()
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "source_type": "civitai",
                "image_id": 145110824,
                "url": "https://civitai.red/images/145110824",
            }
        )
    )
    service = ImageMetadataService(
        RouteContext({"asyncio": asyncio, "web": web})
    )

    with patch(
        "core.services.image_metadata_service.request_source_response",
        return_value=SimpleNamespace(status_code=200, text=html),
    ), patch(
        "core.services.image_metadata_service.execute_provider_json_request",
        side_effect=mock_civitai_version_request,
    ):
        response = await service.inspect_metadata(request)

    body = json.loads(response.text)
    assert response.status == 200
    assert body["source_type"] == "civitai"
    assert body["civitai_image_id"] == 145110824
    assert len(body["civitai_resources"]) == 2


@pytest.mark.asyncio
async def test_metadata_service_workflow_source_detects_civitai_url():
    html = civitai_html_payload()
    request = SimpleNamespace(
        json=AsyncMock(
            return_value={
                "source_type": "workflow",
                "json_text": "https://civitai.com/images/145110824",
            }
        )
    )
    service = ImageMetadataService(
        RouteContext({"asyncio": asyncio, "web": web})
    )

    with patch(
        "core.services.image_metadata_service.request_source_response",
        return_value=SimpleNamespace(status_code=200, text=html),
    ), patch(
        "core.services.image_metadata_service.execute_provider_json_request",
        side_effect=mock_civitai_version_request,
    ):
        response = await service.inspect_metadata(request)

    body = json.loads(response.text)
    assert response.status == 200
    assert body["source_type"] == "civitai"
    assert body["civitai_image_id"] == 145110824


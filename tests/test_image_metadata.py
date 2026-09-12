import asyncio
import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from core.routes.context import RouteContext
from core.services.image_metadata_service import (
    ImageMetadataService,
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

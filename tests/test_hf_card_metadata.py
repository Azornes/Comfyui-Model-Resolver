from unittest.mock import patch
from core.sources.huggingface import (
    extract_huggingface_card_metadata,
    get_huggingface_card_metadata,
    get_huggingface_model_details,
    clear_search_cache,
)


def test_extract_huggingface_card_metadata_widget():
    model_data = {
        "cardData": {
            "instance_prompt": "photo of ohwx dog",
            "base_model": "stabilityai/stable-diffusion-xl-base-1.0",
            "widget": [
                {
                    "text": "photo of ohwx dog in a park",
                    "output": {"url": "samples/sample1.png"},
                },
                {
                    "text": "photo of ohwx dog at the beach",
                    "output": {"url": "https://example.com/external.jpg"},
                },
            ],
        }
    }
    meta = extract_huggingface_card_metadata(model_data, repo_id="user/my-lora", branch="main")

    assert len(meta["images"]) == 2
    assert meta["preview_url"] == "https://huggingface.co/user/my-lora/resolve/main/samples/sample1.png"
    assert meta["images"][1]["url"] == "https://example.com/external.jpg"
    assert meta["trained_words"] == ["photo of ohwx dog"]
    assert meta["example_prompts"] == [
        "photo of ohwx dog in a park",
        "photo of ohwx dog at the beach",
    ]
    assert meta["base_model"] == "stabilityai/stable-diffusion-xl-base-1.0"


def test_extract_huggingface_card_metadata_siblings_fallback():
    model_data = {
        "cardData": {
            "instance_prompt": ["token_a", "token_b"],
        },
        "siblings": [
            {"rfilename": "model.safetensors"},
            {"rfilename": "preview.png"},
            {"rfilename": "sample.jpeg"},
            {"rfilename": "notes.txt"},
        ],
    }
    meta = extract_huggingface_card_metadata(model_data, repo_id="user/my-lora")

    assert len(meta["images"]) == 2
    assert meta["preview_url"] == "https://huggingface.co/user/my-lora/resolve/main/preview.png"
    assert meta["trained_words"] == ["token_a", "token_b"]


def test_get_huggingface_card_metadata_caching():
    clear_search_cache()
    mock_payload = {
        "cardData": {
            "instance_prompt": "test-token",
        },
        "siblings": [{"rfilename": "sample.png"}],
    }

    with patch("core.sources.huggingface.execute_provider_json_request", return_value=mock_payload) as mock_req:
        res1 = get_huggingface_card_metadata("author/repo1")
        assert res1["trained_words"] == ["test-token"]
        assert mock_req.call_count == 1

        # Second call should use cache
        res2 = get_huggingface_card_metadata("author/repo1")
        assert res2["trained_words"] == ["test-token"]
        assert mock_req.call_count == 1


def test_get_huggingface_model_details_enriches_preview_and_triggers():
    clear_search_cache()
    mock_tree = [
        {"type": "file", "path": "test-repo.safetensors", "size": 123456}
    ]
    mock_payload = {
        "id": "author/test-repo",
        "cardData": {
            "instance_prompt": "my_trigger",
            "widget": [{"output": {"url": "sample.png"}}],
        },
        "siblings": [
            {
                "rfilename": "test-repo.safetensors",
                "size": 123456,
                "lfs": {"sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
            }
        ],
    }

    with patch("core.sources.huggingface._get_repo_tree", return_value=mock_tree), \
         patch("core.sources.huggingface.execute_provider_json_request", return_value=mock_payload):
        details = get_huggingface_model_details("author/test-repo")
        assert details is not None
        assert details.get("preview_url") == "https://huggingface.co/author/test-repo/resolve/main/sample.png"
        assert details.get("trained_words") == ["my_trigger"]

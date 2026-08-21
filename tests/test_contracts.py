import pytest

from core.contracts import (
    CustomNodeMetadata,
    DownloadSpec,
    HuggingFaceFileReference,
    MissingModel,
    ModelCatalogEntry,
    ModelMatch,
    ModelReference,
    ProviderUrlReference,
    Resolution,
    ResolvedModel,
    SearchResult,
    WorkflowAnalysisResult,
    WorkflowModelInventory,
)
from core.custom_nodes.base import CustomNodeModelAdapter
from core.custom_nodes.registry import (
    get_custom_node_adapter_for_reference,
    get_custom_node_resolution_metadata,
)
from core.resolver import apply_resolution
from core.services.search_orchestrator import SearchOrchestrator


def test_search_result_normalizes_provider_aliases_and_preserves_extra_fields():
    result = SearchResult.from_mapping(
        {
            "source": "huggingface",
            "name": "model.safetensors",
            "downloadUrl": "https://example.test/model.safetensors",
            "sizeKB": 2,
            "hashes": {"SHA256": "abc123"},
            "repository": "author/model",
        }
    )

    serialized = result.to_dict()

    assert result.source == "huggingface"
    assert result.filename == "model.safetensors"
    assert result.download_url == "https://example.test/model.safetensors"
    assert result.size == 2048
    assert result.sha256 == "abc123"
    assert serialized["repository"] == "author/model"
    assert serialized["type"] == ""


def test_provider_url_reference_validates_and_serializes_identity():
    reference = ProviderUrlReference.from_mapping(
        {"modelId": "123", "modelVersionId": 456}
    )

    assert reference.model_id == 123
    assert reference.version_id == 456
    assert reference.to_dict() == {"model_id": 123, "version_id": 456}

    with pytest.raises(ValueError, match="model_id must be an integer"):
        ProviderUrlReference(model_id="not-a-number")


def test_huggingface_file_reference_requires_typed_repository_path():
    reference = HuggingFaceFileReference(
        repo="org/repo",
        filename="models/model.safetensors",
    )

    assert reference.to_dict() == {
        "repo": "org/repo",
        "branch": "main",
        "filename": "models/model.safetensors",
    }
    with pytest.raises(TypeError, match="repo must be a string"):
        HuggingFaceFileReference(repo=123, filename="model.safetensors")


def test_model_catalog_entry_validates_source_fields_and_preserves_extra():
    entry = ModelCatalogEntry.from_mapping(
        {
            "url": "https://example.test/model",
            "download_url": "https://example.test/download",
            "type": "checkpoints",
            "directory": "checkpoints",
            "size": 2048,
            "canonical_name": "model",
        },
        filename="model.safetensors",
    )

    assert entry.filename == "model.safetensors"
    assert entry.model_type == "checkpoints"
    assert entry.extra_value("canonical_name") == "model"
    assert entry.to_dict()["download_url"] == "https://example.test/download"

    with pytest.raises(TypeError, match="ModelCatalogEntry url"):
        ModelCatalogEntry.from_mapping(
            {"url": 123},
            filename="model.safetensors",
        )


def test_search_result_normalizes_legacy_identity_and_file_aliases():
    result = SearchResult.from_mapping(
        {
            "source": "civitai",
            "modelName": "Example model",
            "modelVersionId": 456,
            "fileName": "example.safetensors",
            "versionUrl": "https://example.test/models/123?modelVersionId=456",
            "SHA256": "abc123",
        }
    )

    assert result.name == "Example model"
    assert result.version_id == 456
    assert result.filename == "example.safetensors"
    assert result.version_url.endswith("modelVersionId=456")
    assert result.sha256 == "abc123"
    assert "modelName" not in result.to_dict()


def test_search_result_preserves_explicit_empty_provider_hash():
    result = SearchResult.from_mapping(
        {"source": "huggingface", "sha256": ""}
    )

    assert result.sha256 == ""
    assert result.to_dict()["sha256"] == ""


def test_search_result_mapping_source_override_is_strict():
    with pytest.raises(TypeError, match="SearchResult source"):
        SearchResult.from_mapping({"name": "model"}, source=123)


def test_search_result_normalizes_human_readable_size_to_bytes():
    result = SearchResult(source="model_list", size="12 MB")

    assert result.size == 12 * 1024**2
    assert result.to_dict()["size"] == 12 * 1024**2


@pytest.mark.parametrize(
    "field_name",
    [
        "name",
        "version_name",
        "model_type",
        "filename",
        "url",
        "download_url",
        "base_model",
        "sha256",
        "details_source",
        "version_url",
        "match_type",
    ],
)
def test_search_result_rejects_non_string_canonical_text_fields(field_name):
    with pytest.raises(TypeError, match=f"SearchResult {field_name}"):
        SearchResult(source="test", **{field_name: 123})

    with pytest.raises(TypeError, match="SearchResult download_url"):
        SearchResult.from_mapping(
            {"source": "test", "download_url": 123}
        )


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("tags", 0),
        ("trained_words", "trigger"),
        ("images", {}),
        ("hashes", []),
        ("extra", []),
    ],
)
def test_search_result_rejects_non_collection_canonical_fields(field_name, value):
    with pytest.raises(TypeError, match=f"SearchResult {field_name}"):
        SearchResult(source="test", **{field_name: value})


@pytest.mark.parametrize(
    ("field_name", "value"),
    [("tags", 0), ("trained_words", "trigger"), ("images", {}), ("hashes", [])],
)
def test_search_result_mapping_adapter_rejects_non_collection_fields(
    field_name,
    value,
):
    with pytest.raises(TypeError, match=f"SearchResult {field_name}"):
        SearchResult.from_mapping({"source": "test", field_name: value})


@pytest.mark.parametrize(
    ("payload", "field_name"),
    [
        ({"source": "test", "name": 123}, "name"),
        ({"source": "test", "sha256": 123}, "sha256"),
        ({"source": "test", "sizeKB": "invalid"}, "size"),
    ],
)
def test_search_result_mapping_adapter_rejects_invalid_provider_scalars(
    payload,
    field_name,
):
    with pytest.raises((TypeError, ValueError), match=field_name):
        SearchResult.from_mapping(payload)


def test_search_result_mapping_adapter_rejects_invalid_provider_source():
    with pytest.raises(TypeError, match="SearchResult source"):
        SearchResult.from_mapping({"source": {"name": "civitai"}})


def test_search_result_rejects_malformed_numeric_fields():
    with pytest.raises(ValueError, match="SearchResult confidence"):
        SearchResult(source="test", confidence="not-a-number")
    with pytest.raises(ValueError, match="SearchResult size"):
        SearchResult(source="test", size="not-a-size")


def test_search_result_round_trip_preserves_custom_url_modes():
    compact = SearchResult(
        source="civitai",
        name="Compact result",
        filename="compact.safetensors",
        url="https://example.test/models/1",
        result_mode="compact_custom_url",
        custom_url=True,
    )
    full = SearchResult(
        source="civitai",
        name="Full result",
        filename="full.safetensors",
        url="https://example.test/models/2",
        result_mode="custom_url",
        custom_url=True,
    )

    assert SearchResult.from_mapping(compact.to_dict()).result_mode == (
        "compact_custom_url"
    )
    assert SearchResult.from_mapping(full.to_dict()).result_mode == "custom_url"


def test_search_result_rejects_unknown_result_modes():
    with pytest.raises(ValueError, match="Unsupported model result mode"):
        SearchResult(source="civitai", result_mode="unknown")


def test_contract_adapters_reject_malformed_payloads():
    with pytest.raises(TypeError, match="SearchResult must be an object"):
        SearchResult.from_mapping(None)
    with pytest.raises(ValueError, match="model identity"):
        ModelReference.from_mapping({})
    with pytest.raises(ValueError, match="path or filename"):
        ResolvedModel.from_mapping({})
    with pytest.raises(TypeError, match="model object"):
        ModelMatch.from_mapping({"model": None})


def test_extra_fields_cannot_override_canonical_contract_fields():
    reference = ModelReference(
        node_id=1,
        original_path="canonical.safetensors",
        category="checkpoints",
        extra={"category": "wrong"},
    )
    model = ResolvedModel(
        path="canonical.safetensors",
        filename="canonical.safetensors",
        extra={"path": "wrong.safetensors"},
    )
    result = SearchResult(
        source="civitai",
        filename="canonical.safetensors",
        extra={"filename": "wrong.safetensors"},
    )

    assert reference.to_dict()["category"] == "checkpoints"
    assert model.to_dict()["path"] == "canonical.safetensors"
    assert result.to_dict()["filename"] == "canonical.safetensors"


def test_extra_fields_cannot_create_empty_canonical_values():
    model = ResolvedModel(filename="model.safetensors").with_extra(
        path="wrong.safetensors",
        category="wrong",
        provider="test",
    )
    reference = ModelReference(
        node_id=1,
        original_path="model.safetensors",
        extra={"subgraph_id": "wrong", "provider": "test"},
    )

    serialized_model = model.to_dict()
    serialized_reference = reference.to_dict()

    assert "path" not in serialized_model
    assert "category" not in serialized_model
    assert serialized_model["provider"] == "test"
    assert "subgraph_id" not in serialized_reference
    assert serialized_reference["provider"] == "test"


def test_resolved_model_aliases_cannot_leak_through_extra_or_raw_payloads():
    model = ResolvedModel(
        path="canonical.safetensors",
        filename="canonical.safetensors",
        raw={
            "resolved_path": "wrong.safetensors",
            "name": "wrong.safetensors",
        },
    ).with_extra(
        resolved_path="another-wrong.safetensors",
        name="another-wrong.safetensors",
        provider="scanner",
    )

    serialized = model.to_dict()

    assert serialized["path"] == "canonical.safetensors"
    assert serialized["filename"] == "canonical.safetensors"
    assert "resolved_path" not in serialized
    assert "name" not in serialized
    assert serialized["provider"] == "scanner"


def test_search_result_extra_cannot_restore_omitted_mode_fields():
    custom = SearchResult(
        source="civitai",
        filename="custom.safetensors",
        result_mode="custom_url",
        custom_url=True,
    ).with_extra(
        confidence=99,
        result_mode="search",
        filename="wrong.safetensors",
        provider="civitai",
    )
    compact = SearchResult(
        source="civitai",
        filename="compact.safetensors",
        result_mode="compact_custom_url",
        custom_url=True,
    ).with_extra(
        confidence=99,
        size=123,
        type="wrong",
        provider="civitai",
    )

    custom_payload = custom.to_dict()
    compact_payload = compact.to_dict()

    assert "confidence" not in custom_payload
    assert "result_mode" not in custom_payload
    assert custom_payload["filename"] == "custom.safetensors"
    assert custom_payload["provider"] == "civitai"
    assert "confidence" not in compact_payload
    assert "size" not in compact_payload
    assert "type" not in compact_payload
    assert compact_payload["filename"] == "compact.safetensors"


def test_missing_model_extra_cannot_inject_matches_when_unset():
    missing = MissingModel.from_mapping(
        {
            "node_id": 1,
            "original_path": "missing.safetensors",
        }
    ).with_extra(
        matches=[{"bad": True}],
        reference_count=99,
        provider="workflow",
    )

    serialized = missing.to_dict()

    assert "matches" not in serialized
    assert serialized["reference_count"] == 1
    assert serialized["provider"] == "workflow"


def test_missing_model_requires_consistent_reference_collection():
    with pytest.raises(TypeError, match="all_node_refs"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "all_node_refs": [
                    {"node_id": 1, "original_path": "missing.safetensors"},
                    None,
                ],
            }
        )

    with pytest.raises(ValueError, match="reference_count"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "all_node_refs": [
                    {"node_id": 1, "original_path": "missing.safetensors"}
                ],
                "reference_count": 2,
            }
        )


def test_missing_model_rejects_malformed_matches_in_mapping():
    with pytest.raises(TypeError, match="MissingModel matches"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "matches": [None],
            }
        )

    with pytest.raises(TypeError, match="MissingModel matches"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "matches": {"bad": True},
            }
        )


def test_missing_model_derives_direct_reference_count():
    reference = ModelReference(node_id=1, original_path="missing.safetensors")
    missing = MissingModel(
        reference=reference,
        all_node_refs=(reference, reference),
    )

    assert missing.reference_count == 2
    assert len(missing.all_node_refs) == 2


@pytest.mark.parametrize("value", ["1", 1.5, True])
def test_missing_model_rejects_non_integer_reference_count(value):
    reference = ModelReference(node_id=1, original_path="missing.safetensors")

    with pytest.raises(TypeError, match="reference_count"):
        MissingModel(reference=reference, reference_count=value)

    with pytest.raises(TypeError, match="reference_count"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "reference_count": value,
            }
        )


def test_missing_model_rejects_non_positive_reference_count():
    reference = ModelReference(node_id=1, original_path="missing.safetensors")

    with pytest.raises(ValueError, match="reference_count"):
        MissingModel(reference=reference, reference_count=0)

    with pytest.raises(ValueError, match="reference_count"):
        MissingModel.from_mapping(
            {
                "node_id": 1,
                "original_path": "missing.safetensors",
                "reference_count": -1,
            }
        )


def test_contract_boolean_adapters_do_not_use_string_truthiness():
    reference = ModelReference.from_mapping(
        {
            "node_id": 1,
            "original_path": "missing.safetensors",
            "exists": "false",
            "is_top_level": "false",
        }
    )
    result = SearchResult.from_mapping(
        {
            "source": "civitai",
            "custom_url": "false",
        }
    )

    assert reference.exists is False
    assert reference.is_top_level is False
    assert result.custom_url is False
    assert result.result_mode == "search"

    metadata = CustomNodeMetadata.from_mapping(
        {"is_legacy_lora_manager": "false"}
    )
    assert metadata.is_legacy_lora_manager is False

    legacy_reference = ModelReference.from_mapping(
        {
            "node_id": 2,
            "original_path": "legacy.safetensors",
            "is_lora_v2": "false",
        }
    )
    assert get_custom_node_adapter_for_reference(legacy_reference) is None
    assert (
        get_custom_node_resolution_metadata(legacy_reference).is_legacy_lora_manager
        is False
    )

    legacy_v2_reference = ModelReference.from_mapping(
        {
            "node_id": 4,
            "original_path": "legacy-v2.safetensors",
            "is_lora_v2": "true",
        }
    )
    assert get_custom_node_adapter_for_reference(legacy_v2_reference) is not None
    assert (
        get_custom_node_resolution_metadata(legacy_v2_reference).is_legacy_lora_manager
        is True
    )

    workflow_flags = ModelReference.from_mapping(
        {
            "node_id": 3,
            "original_path": "workflow.safetensors",
            "active": "false",
            "auto_download_capable": "false",
            "auto_download_candidate": "false",
            "connected": "false",
            "input_choice_matches_value": "false",
            "is_legacy_lora_manager": "false",
            "is_lora_v2": "false",
            "is_urn": "false",
            "locate_is_top_level": "false",
            "locate_via_promoted_widget": "false",
        }
    )
    for flag in (
        "active",
        "auto_download_capable",
        "auto_download_candidate",
        "connected",
        "input_choice_matches_value",
        "is_legacy_lora_manager",
        "is_lora_v2",
        "is_urn",
        "locate_is_top_level",
        "locate_via_promoted_widget",
    ):
        assert workflow_flags.extra_value(flag) is False


def test_custom_node_metadata_preserves_canonical_legacy_flag():
    reference = ModelReference.from_mapping(
        {
            "node_id": 2,
            "original_path": "old-lora",
            "is_legacy_lora_manager": "true",
        }
    )

    metadata = get_custom_node_resolution_metadata(reference)

    assert metadata.adapter_id == "lora-manager"
    assert metadata.is_legacy_lora_manager is True


def test_direct_contract_constructors_normalize_nested_values():
    reference = ModelReference(
        node_id=1,
        original_path="model.safetensors",
        exists="false",
        is_top_level="true",
    )
    assert reference.exists is False
    assert reference.is_top_level is True

    match = ModelMatch(
        model={"path": "models/model.safetensors"},
        similarity="0.25",
    )
    assert isinstance(match.model, ResolvedModel)
    assert match.similarity == 0.25

    missing = MissingModel(
        reference={"node_id": 1, "original_path": "missing.safetensors"},
        all_node_refs=[
            {"node_id": 1, "original_path": "missing.safetensors"}
        ],
        matches=[
            {"model": {"path": "models/model.safetensors"}}
        ],
    )
    assert isinstance(missing.reference, ModelReference)
    assert isinstance(missing.all_node_refs[0], ModelReference)
    assert isinstance(missing.matches[0], ModelMatch)

    analysis = WorkflowAnalysisResult(
        missing_models=[
            {"node_id": 1, "original_path": "missing.safetensors"}
        ],
        resolved_models=[
            {"node_id": 2, "original_path": "loaded.safetensors"}
        ],
        total_missing=1,
        total_resolved=1,
        total_models_analyzed=2,
    )
    assert isinstance(analysis.missing_models[0], MissingModel)
    assert isinstance(analysis.resolved_models[0], ModelReference)

    resolution = Resolution(
        node_id=1,
        widget_index=0,
        resolved_path="new.safetensors",
        resolved_model={"path": "new.safetensors"},
        reference={"node_id": 1, "original_path": "old.safetensors"},
        is_top_level="false",
    )
    assert isinstance(resolution.resolved_model, ResolvedModel)
    assert isinstance(resolution.reference, ModelReference)
    assert resolution.is_top_level is False

    with pytest.raises(TypeError, match="ModelMatch model"):
        ModelMatch(model=None)
    with pytest.raises(TypeError, match="MissingModel reference"):
        MissingModel(reference=None)


@pytest.mark.parametrize("value", ["maybe", 2, [], {}])
def test_boolean_contracts_reject_unknown_values(value):
    with pytest.raises(ValueError, match="exists"):
        ModelReference.from_mapping(
            {
                "node_id": 1,
                "original_path": "model.safetensors",
                "exists": value,
            }
        )


@pytest.mark.parametrize("value", [123, [], {}])
def test_model_reference_known_text_extras_reject_non_text_values(value):
    with pytest.raises(TypeError, match="ModelReference full_path"):
        ModelReference.from_mapping(
            {
                "node_id": 1,
                "original_path": "model.safetensors",
                "full_path": value,
            }
        )

    with pytest.raises(ValueError, match="is_top_level"):
        ModelReference.from_mapping(
            {
                "node_id": 1,
                "original_path": "model.safetensors",
                "is_top_level": value,
            }
        )

    with pytest.raises(ValueError, match="custom_url"):
        SearchResult.from_mapping(
            {"source": "test", "custom_url": value}
        )

    with pytest.raises(ValueError, match="is_legacy_lora_manager"):
        CustomNodeMetadata.from_mapping(
            {"is_legacy_lora_manager": value}
        )

    with pytest.raises(ValueError, match="is_top_level"):
        Resolution.from_mapping(
            {
                "node_id": 1,
                "widget_index": 0,
                "original_path": "missing.safetensors",
                "resolved_path": "model.safetensors",
                "is_top_level": value,
            }
        )


def test_canonical_boolean_contracts_reject_explicit_null():
    assert (
        ModelReference.from_mapping(
            {"node_id": 1, "original_path": "model.safetensors"}
        ).exists
        is False
    )
    assert SearchResult.from_mapping({"source": "test"}).custom_url is False
    assert (
        CustomNodeMetadata.from_mapping({}).is_legacy_lora_manager is False
    )

    with pytest.raises(ValueError, match="exists"):
        ModelReference.from_mapping(
            {
                "node_id": 1,
                "original_path": "model.safetensors",
                "exists": None,
            }
        )

    with pytest.raises(ValueError, match="custom_url"):
        SearchResult.from_mapping({"source": "test", "custom_url": None})

    with pytest.raises(ValueError, match="is_legacy_lora_manager"):
        CustomNodeMetadata.from_mapping(
            {"is_legacy_lora_manager": None}
        )


@pytest.mark.parametrize("value", [None, "maybe", 2, [], {}])
def test_model_reference_boolean_extras_reject_invalid_values(value):
    with pytest.raises(ValueError, match="ModelReference active"):
        ModelReference.from_mapping(
            {
                "node_id": 1,
                "original_path": "model.safetensors",
                "active": value,
            }
        )


def test_lora_manager_adapter_normalizes_external_boolean_values():
    from core.custom_nodes.lora_manager import analyze_references

    references = analyze_references(
        {
            "id": 1,
            "type": "LoraLoaderV2",
            "widgets_values": [
                "",
                "",
                [{"name": "character", "active": None, "strength": 1.0}],
            ],
        },
        available_models=[],
        is_active=False,
        get_widget_name_hint=lambda _node, _index: "lora_name",
    )

    assert references[0].extra_value("active") is True
    assert references[0].extra_value("connected") is False


@pytest.mark.parametrize(
    ("factory", "payload", "message"),
    [
        (
            ModelReference.from_mapping,
            {"node_id": 1, "original_path": 123},
            "ModelReference original_path",
        ),
        (
            ResolvedModel.from_mapping,
            {"path": 123},
            "ResolvedModel path",
        ),
        (
            ResolvedModel.from_mapping,
            {"path": 0, "resolved_path": "valid.safetensors"},
            "ResolvedModel path",
        ),
    ],
)
def test_model_contracts_reject_non_string_text_fields(factory, payload, message):
    with pytest.raises(TypeError, match=message):
        factory(payload)


@pytest.mark.parametrize(
    ("factory", "payload", "message"),
    [
        (
            ModelReference.from_mapping,
            {"node_id": True, "original_path": "model.safetensors"},
            "ModelReference node_id",
        ),
        (
            ModelReference.from_mapping,
            {
                "node_id": 1,
                "widget_index": "0",
                "original_path": "model.safetensors",
            },
            "ModelReference widget_index",
        ),
        (
            SearchResult.from_mapping,
            {"source": "test", "model_id": False},
            "SearchResult model_id",
        ),
        (
            Resolution.from_mapping,
            {
                "node_id": True,
                "widget_index": 0,
                "resolved_path": "model.safetensors",
            },
            "Resolution node_id",
        ),
    ],
)
def test_identifier_contracts_reject_invalid_types(factory, payload, message):
    with pytest.raises(TypeError, match=message):
        factory(payload)


def test_identifier_contracts_normalize_string_ids():
    reference = ModelReference.from_mapping(
        {
            "node_id": " 12 ",
            "widget_index": 0,
            "original_path": "model.safetensors",
        }
    )
    result = SearchResult.from_mapping(
        {"source": "test", "model_id": " 12 ", "version_id": " 34 "}
    )

    assert reference.node_id == "12"
    assert result.model_id == "12"
    assert result.version_id == "34"


@pytest.mark.parametrize(
    ("factory", "payload", "message"),
    [
        (
            ModelMatch.from_mapping,
            {
                "model": {"path": "models/model.safetensors"},
                "filename": 123,
            },
            "ModelMatch filename",
        ),
        (
            CustomNodeMetadata.from_mapping,
            {"adapter_id": 123},
            "CustomNodeMetadata adapter_id",
        ),
        (
            CustomNodeMetadata.from_mapping,
            {"original_identity": 123},
            "CustomNodeMetadata original_identity",
        ),
        (
            Resolution.from_mapping,
            {
                "node_id": 1,
                "widget_index": 0,
                "resolved_path": 123,
            },
            "Resolution resolved_path",
        ),
        (
            Resolution.from_mapping,
            {
                "node_id": 1,
                "widget_index": 0,
                "resolved_path": "model.safetensors",
                "category": 123,
            },
            "Resolution category",
        ),
    ],
)
def test_nested_contracts_reject_non_string_canonical_fields(
    factory,
    payload,
    message,
):
    with pytest.raises((TypeError, ValueError), match=message):
        factory(payload)


def test_contract_collections_reject_falsey_non_arrays():
    reference = ModelReference(node_id=1, original_path="model.safetensors")

    with pytest.raises(TypeError, match="all_node_refs"):
        MissingModel(reference=reference, all_node_refs=0)
    with pytest.raises(TypeError, match="missing_models"):
        WorkflowAnalysisResult(missing_models=0)
    with pytest.raises(TypeError, match="available_models"):
        WorkflowModelInventory(available_models=0)


@pytest.mark.parametrize("field_name", ["similarity", "confidence"])
def test_model_match_rejects_malformed_numeric_fields(field_name):
    with pytest.raises(ValueError, match=field_name):
        ModelMatch.from_mapping(
            {
                "model": {"path": "models/model.safetensors"},
                field_name: "not-a-number",
            }
        )


def test_model_contracts_are_not_mapping_compatibility_wrappers():
    reference = ModelReference(node_id=1, original_path="model.safetensors")
    model = ResolvedModel(path="models/model.safetensors")

    with pytest.raises(TypeError):
        reference["original_path"]
    with pytest.raises(TypeError):
        model["path"]


def test_contract_collections_are_immutable_and_thaw_at_json_boundary():
    result = SearchResult(
        source="civitai",
        tags=["tag-a"],
        hashes={"SHA256": "abc123"},
        extra={"nested": {"values": ["one"]}},
    )

    assert result.tags == ("tag-a",)
    serialized = result.to_dict()
    assert serialized["tags"] == ["tag-a"]
    assert serialized["hashes"] == {"SHA256": "abc123"}
    assert serialized["nested"]["values"] == ["one"]
    assert result.extra_value("nested")["values"] == ("one",)

    with pytest.raises(AttributeError):
        result.tags.append("tag-b")
    with pytest.raises(TypeError):
        result.hashes["MD5"] = "hash"
    with pytest.raises(TypeError):
        result.extra_value("nested")["values"] = ("two",)

    model = ResolvedModel.from_mapping(
        {
            "path": "models/model.safetensors",
            "extra": {"nested": {"values": ["one"]}},
        }
    )
    assert model.to_dict()["extra"]["nested"]["values"] == ["one"]
    with pytest.raises(TypeError):
        model.raw["path"] = "other.safetensors"


def test_workflow_inventory_and_custom_node_metadata_are_typed_and_immutable():
    model = ResolvedModel(path="models/model.safetensors")
    reference = ModelReference(
        node_id=1,
        original_path="model.safetensors",
        category="checkpoints",
    )
    inventory = WorkflowModelInventory(
        available_models=[model],
        model_refs=[reference],
    )
    assert inventory.available_models == (model,)
    assert inventory.model_refs == (reference,)
    with pytest.raises(AttributeError):
        inventory.available_models.append(model)

    metadata = get_custom_node_resolution_metadata(
        ModelReference.from_mapping(
            {
                "node_id": 2,
                "original_path": "old-lora",
                "custom_node_adapter": "lora-manager",
                "custom_node_original_identity": "old-lora",
            }
        )
    )
    assert isinstance(metadata, CustomNodeMetadata)
    assert metadata.adapter_id == "lora-manager"
    assert metadata.original_identity == "old-lora"

    adapter = CustomNodeModelAdapter(
        adapter_id="test",
        node_types=["TestLoader"],
        widget_categories={0: "loras"},
    )
    assert adapter.node_types == ("TestLoader",)
    assert adapter.widget_categories == {0: "loras"}
    with pytest.raises(TypeError):
        adapter.widget_categories[1] = "checkpoints"

    with pytest.raises(TypeError, match="node_types"):
        CustomNodeModelAdapter(
            adapter_id="test",
            node_types=0,
            widget_categories={},
        )
    with pytest.raises(TypeError, match="widget_categories"):
        CustomNodeModelAdapter(
            adapter_id="test",
            node_types=("TestLoader",),
            widget_categories=[],
        )
    with pytest.raises(TypeError, match="update_model_path"):
        CustomNodeModelAdapter(
            adapter_id="test",
            node_types=("TestLoader",),
            widget_categories={},
            update_model_path="not-callable",
        )


def test_search_orchestrator_normalizes_and_serializes_typed_result():
    typed = SearchResult(
        source="civitai",
        name="Model",
        filename="model.safetensors",
        download_url="https://example.test/model",
        size=4096,
    )
    result = SearchOrchestrator.normalize_search_result(
        "civitai",
        typed,
    )

    assert result is typed
    assert result.source == "civitai"
    assert SearchOrchestrator.serialize_search_result(result)["size"] == 4096
    assert SearchOrchestrator.serialize_search_result(result)["download_url"] == (
        "https://example.test/model"
    )

    with pytest.raises(TypeError, match="untyped result"):
        SearchOrchestrator.normalize_search_result(
            "model_list",
            {"filename": "legacy.safetensors"},
        )


def test_missing_model_and_match_use_typed_contracts():
    missing = MissingModel.from_mapping(
        {
            "node_id": 4,
            "node_type": "CheckpointLoaderSimple",
            "widget_index": 0,
            "original_path": "missing.safetensors",
            "category": "checkpoints",
            "exists": False,
            "all_node_refs": [
                {
                    "node_id": 4,
                    "node_type": "CheckpointLoaderSimple",
                    "widget_index": 0,
                    "original_path": "missing.safetensors",
                    "category": "checkpoints",
                    "exists": False,
                }
            ],
            "matches": [
                {
                    "model": {
                        "path": "models/checkpoint.safetensors",
                        "filename": "checkpoint.safetensors",
                        "category": "checkpoints",
                    },
                    "filename": "checkpoint.safetensors",
                    "similarity": 0.9,
                    "confidence": 90,
                }
            ],
        }
    )

    assert isinstance(missing.reference, ModelReference)
    assert isinstance(missing.matches[0], ModelMatch)
    assert isinstance(missing.matches[0].model, ResolvedModel)
    assert missing.all_node_refs[0].node_id == 4
    assert missing.matches[0].model.path == "models/checkpoint.safetensors"
    assert missing.to_dict()["matches"][0]["model"]["path"] == (
        "models/checkpoint.safetensors"
    )


def test_model_match_keeps_typed_nested_resolved_model():
    model = ResolvedModel(
        path="models/checkpoint.safetensors",
        filename="checkpoint.safetensors",
    )

    match = ModelMatch.from_mapping(
        {
            "model": model,
            "filename": "checkpoint.safetensors",
            "similarity": 0.9,
        }
    )

    assert match.model is model
    assert match.model.path == "models/checkpoint.safetensors"


def test_workflow_analysis_result_serializes_typed_models():
    missing = MissingModel.from_mapping(
        {
            "node_id": 1,
            "widget_index": 0,
            "original_path": "missing.safetensors",
            "category": "checkpoints",
            "exists": False,
        }
    )
    result = WorkflowAnalysisResult(
        missing_models=(missing,),
        resolved_models=(
            ModelReference(
                node_id=2,
                widget_index=0,
                original_path="loaded.safetensors",
                category="checkpoints",
                exists=True,
            ),
        ),
        total_missing=1,
        total_resolved=1,
        total_models_analyzed=2,
    ).to_dict()

    assert result["total_missing"] == 1
    assert result["missing_models"][0]["original_path"] == "missing.safetensors"
    assert result["resolved_models"][0]["matches"] == []


@pytest.mark.parametrize(
    "field_name, value, error_type",
    [
        ("total_missing", "1", TypeError),
        ("total_resolved", 1.5, TypeError),
        ("total_models_analyzed", -1, ValueError),
    ],
)
def test_workflow_analysis_result_requires_non_negative_integer_counts(
    field_name, value, error_type
):
    with pytest.raises(error_type, match=field_name):
        WorkflowAnalysisResult(**{field_name: value})


def test_workflow_analysis_result_counts_match_model_collections():
    missing = MissingModel.from_mapping(
        {"node_id": 1, "original_path": "missing.safetensors"}
    )
    resolved = ModelReference(node_id=2, original_path="loaded.safetensors")

    with pytest.raises(ValueError, match="total_missing"):
        WorkflowAnalysisResult(
            missing_models=(missing,),
            total_missing=0,
        )

    with pytest.raises(ValueError, match="total_resolved"):
        WorkflowAnalysisResult(
            resolved_models=(resolved,),
            total_resolved=0,
        )

    with pytest.raises(ValueError, match="total_models_analyzed"):
        WorkflowAnalysisResult(
            missing_models=(missing,),
            total_missing=1,
            total_models_analyzed=0,
        )


def test_download_spec_normalizes_mapping_and_keeps_expected_hash_in_metadata():
    spec = DownloadSpec.from_mapping(
        {
            "download_url": " https://example.test/model.safetensors ",
            "name": " model.safetensors ",
            "category": "checkpoints",
            "expected_sha256": " abc123 ",
            "headers": {"Authorization": "Bearer token"},
        }
    )

    kwargs = spec.to_kwargs()

    assert spec.url == "https://example.test/model.safetensors"
    assert spec.filename == "model.safetensors"
    assert spec.expected_sha256 == "abc123"
    assert kwargs["headers"] == {"Authorization": "Bearer token"}
    assert kwargs["metadata"]["sha256"] == "abc123"


def test_download_spec_uses_sha256_alias_when_expected_hash_is_blank():
    spec = DownloadSpec.from_mapping(
        {
            "url": "https://example.test/model.safetensors",
            "filename": "model.safetensors",
            "category": "checkpoints",
            "expected_sha256": "  ",
            "sha256": " alias-hash ",
        }
    )

    assert spec.expected_sha256 == "alias-hash"
    assert spec.to_kwargs()["metadata"]["sha256"] == "alias-hash"


@pytest.mark.parametrize(
    "field_name, value",
    [
        ("url", 123),
        ("filename", 456),
        ("category", 789),
        ("subfolder", 123),
        ("base_directory", 456),
    ],
)
def test_download_spec_rejects_non_string_text_fields(field_name, value):
    payload = {
        "url": "https://example.test/model.safetensors",
        "filename": "model.safetensors",
        "category": "checkpoints",
        "subfolder": "",
        "base_directory": "",
    }
    payload[field_name] = value

    with pytest.raises(TypeError, match=rf"DownloadSpec {field_name}"):
        DownloadSpec(**payload)


@pytest.mark.parametrize(
    "field_name, value, alias_key",
    [
        ("url", 0, "download_url"),
        ("filename", False, "name"),
        ("category", 0, None),
        ("subfolder", 0, None),
        ("base_directory", False, None),
    ],
)
def test_download_spec_mapping_rejects_falsey_non_string_text_fields(
    field_name, value, alias_key
):
    payload = {
        "url": "https://example.test/model.safetensors",
        "filename": "model.safetensors",
        "category": "checkpoints",
    }
    payload[field_name] = value
    if alias_key:
        payload[alias_key] = (
            "https://example.test/model.safetensors"
            if alias_key == "download_url"
            else "model.safetensors"
        )

    with pytest.raises(TypeError, match=rf"DownloadSpec {field_name}"):
        DownloadSpec.from_mapping(payload)


def test_download_spec_rejects_non_string_headers():
    with pytest.raises(TypeError, match="DownloadSpec headers"):
        DownloadSpec(
            url="https://example.test/model.safetensors",
            filename="model.safetensors",
            category="checkpoints",
            headers={"X-Test": 123},
        )

    with pytest.raises(TypeError, match="DownloadSpec headers"):
        DownloadSpec(
            url="https://example.test/model.safetensors",
            filename="model.safetensors",
            category="checkpoints",
            headers=["invalid"],
        )

    with pytest.raises(TypeError, match="DownloadSpec headers"):
        DownloadSpec.from_mapping(
            {
                "url": "https://example.test/model.safetensors",
                "filename": "model.safetensors",
                "category": "checkpoints",
                "headers": [],
            }
        )


def test_download_spec_rejects_non_mapping_metadata():
    with pytest.raises(TypeError, match="DownloadSpec metadata"):
        DownloadSpec(
            url="https://example.test/model.safetensors",
            filename="model.safetensors",
            category="checkpoints",
            metadata=[],
        )

    with pytest.raises(TypeError, match="DownloadSpec metadata"):
        DownloadSpec.from_mapping(
            {
                "url": "https://example.test/model.safetensors",
                "filename": "model.safetensors",
                "category": "checkpoints",
                "metadata": [],
            }
        )


@pytest.mark.parametrize("value", [0, 123, True, [], {}])
def test_download_spec_rejects_non_string_expected_sha256(value):
    with pytest.raises(TypeError, match="DownloadSpec expected_sha256"):
        DownloadSpec(
            url="https://example.test/model.safetensors",
            filename="model.safetensors",
            category="checkpoints",
            expected_sha256=value,
        )

    with pytest.raises(TypeError, match="DownloadSpec expected_sha256"):
        DownloadSpec.from_mapping(
            {
                "url": "https://example.test/model.safetensors",
                "filename": "model.safetensors",
                "category": "checkpoints",
                "expected_sha256": value,
            }
        )


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"filename": "model.safetensors", "category": "checkpoints"}, "URL"),
        ({"url": "https://example.test/model.safetensors", "category": "checkpoints"}, "filename"),
        ({"url": "https://example.test/model.safetensors", "filename": "model.safetensors"}, "category"),
    ],
)
def test_download_spec_requires_core_fields(payload, message):
    with pytest.raises(ValueError, match=message):
        DownloadSpec.from_mapping(payload)


def test_resolution_uses_model_reference_and_preserves_workflow_context():
    resolution = Resolution.from_mapping(
        {
            "node_id": 7,
            "widget_index": 1,
            "original_path": "old.safetensors",
            "resolved_path": "new.safetensors",
            "category": "checkpoints",
            "subgraph_id": "group-1",
            "is_top_level": False,
            "nested_key": "model",
        }
    )

    resolution.validate()
    resolution = resolution.with_custom_node_metadata(
        {"custom_node_adapter": "test"}
    )

    assert isinstance(resolution.reference, ModelReference)
    assert resolution.reference.original_path == "old.safetensors"
    assert resolution.node_id == 7
    assert resolution.widget_index == 1
    assert resolution.subgraph_id == "group-1"
    assert resolution.nested_key == "model"
    assert isinstance(resolution.custom_node_metadata, CustomNodeMetadata)
    assert resolution.custom_node_metadata.adapter_id == "test"


def test_resolution_accepts_path_from_resolved_model():
    resolution = Resolution.from_mapping(
        {
            "node_id": 1,
            "widget_index": 0,
            "resolved_model": {"path": "models/checkpoint.safetensors"},
        }
    )

    resolution.validate()


@pytest.mark.parametrize(
    "payload",
    [
        {
            "node_id": 1,
            "widget_index": "0",
            "resolved_path": "new.safetensors",
        },
        {
            "node_id": 1,
            "widget_index": -1,
            "resolved_path": "new.safetensors",
        },
        {
            "node_id": 1,
            "widget_index": 0,
            "resolved_path": 123,
        },
        {
            "node_id": 1,
            "widget_index": 0,
            "resolved_model": {"path": 123},
        },
    ],
)
def test_resolution_rejects_invalid_field_types(payload):
    with pytest.raises((TypeError, ValueError)):
        Resolution.from_mapping(payload).validate()


def test_apply_resolution_accepts_typed_resolution():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "CheckpointLoaderSimple",
                "widgets_values": ["old.safetensors"],
            }
        ]
    }

    resolution = Resolution.from_mapping(
        {
            "node_id": 1,
            "widget_index": 0,
            "resolved_path": "new.safetensors",
            "category": "checkpoints",
            "resolved_model": {
                "path": "new.safetensors",
                "base_directory": "models",
            },
        }
    )
    updated = apply_resolution(workflow, [resolution])

    assert updated["nodes"][0]["widgets_values"] == ["new.safetensors"]


def test_apply_resolution_skips_invalid_payload_without_raising():
    workflow = {"nodes": []}

    updated = apply_resolution(workflow, [Resolution()])

    assert updated == workflow

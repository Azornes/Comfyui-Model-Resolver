import importlib


def test_node_definitions_expose_stable_model_resolver_metadata():
    module = importlib.import_module("core.node_definitions")

    assert module.MODEL_RESOLVER_DEPENDENCY_NODE_TYPE == (
        "ModelResolverDependency"
    )
    assert module.MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY == (
        "Model Resolver/Workflow"
    )
    assert module.MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME == (
        "Model Resolver Opener"
    )
    assert "ModelResolverDependencyNode" in dir(module)


def test_node_definitions_preserve_runtime_specific_exports():
    module = importlib.import_module("core.node_definitions")

    if module.ComfyExtension is not None and module.io is not None:
        assert callable(module.comfy_entrypoint)
        assert "comfy_entrypoint" in module.__all__
    else:
        assert module.NODE_CLASS_MAPPINGS[module.MODEL_RESOLVER_DEPENDENCY_NODE_TYPE]
        assert module.NODE_DISPLAY_NAME_MAPPINGS[
            module.MODEL_RESOLVER_DEPENDENCY_NODE_TYPE
        ] == module.MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME

import importlib


def test_workflow_package_imports_each_split_component():
    component_names = (
        "analysis",
        "dynamic_widgets",
        "inventory",
        "references",
        "subgraphs",
        "widgets",
    )

    workflow_package = importlib.import_module("core.workflow")

    for component_name in component_names:
        component = importlib.import_module(f"core.workflow.{component_name}")

        assert component.__package__ == "core.workflow"
        assert getattr(workflow_package, component_name, component) is component


def test_top_level_entrypoint_preserves_comfyui_runtime_exports():
    entrypoint = importlib.import_module("comfyui-model-resolver")

    assert entrypoint.WEB_DIRECTORY == "./web"

    if entrypoint.ComfyExtension is not None and entrypoint.io is not None:
        assert callable(entrypoint.comfy_entrypoint)
        assert entrypoint.__all__ == ["WEB_DIRECTORY", "comfy_entrypoint"]
    else:
        assert entrypoint.NODE_CLASS_MAPPINGS
        assert entrypoint.NODE_DISPLAY_NAME_MAPPINGS
        assert entrypoint.__all__ == [
            "NODE_CLASS_MAPPINGS",
            "NODE_DISPLAY_NAME_MAPPINGS",
            "WEB_DIRECTORY",
        ]

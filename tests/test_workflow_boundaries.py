import ast
from pathlib import Path

WORKFLOW_COMPONENTS = {
    "widgets": set(),
    "dynamic_widgets": {"widgets"},
    "references": {"dynamic_widgets", "widgets"},
    "subgraphs": {"references", "widgets"},
    "traversal": set(),
    "analysis": {"references", "subgraphs", "traversal"},
    "inventory": {"analysis"},
}


def _sibling_imports(module_path):
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    imports = set()

    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or node.level != 1:
            continue
        if node.module:
            imports.add(node.module.split(".", 1)[0])
        else:
            imports.update(alias.name.split(".", 1)[0] for alias in node.names)

    return imports


def test_workflow_components_follow_the_declared_dependency_layers():
    workflow_directory = Path(__file__).parents[1] / "core" / "workflow"

    for component_name, allowed_imports in WORKFLOW_COMPONENTS.items():
        imports = _sibling_imports(workflow_directory / f"{component_name}.py")

        assert imports <= allowed_imports, (
            f"{component_name} imports unexpected workflow components: "
            f"{sorted(imports - allowed_imports)}"
        )


def test_workflow_package_does_not_restore_the_removed_flat_module():
    legacy_module = Path(__file__).parents[1] / "core" / "workflow_analyzer.py"

    assert not legacy_module.exists()

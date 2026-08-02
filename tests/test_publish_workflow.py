from pathlib import Path


WORKFLOW_PATH = Path(__file__).parents[1] / ".github" / "workflows" / "publish.yml"


def test_publish_workflow_skips_versions_already_in_the_registry():
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "id: registry_version_check" in workflow
    assert "https://api.comfy.org/nodes/" in workflow
    assert 'echo "exists=true" >> "$GITHUB_OUTPUT"' in workflow
    assert "if: steps.registry_version_check.outputs.exists != 'true'" in workflow
    assert "already published" in workflow.lower()


def test_publish_workflow_uses_current_python_runtime_without_the_external_wrapper():
    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "actions/setup-python@v6" in workflow
    assert "Comfy-Org/publish-node-action@main" not in workflow
    assert "comfy node publish --token" in workflow

"""ComfyUI node definitions and runtime compatibility exports."""

try:
    from comfy_api.latest import ComfyExtension, io
except Exception:
    ComfyExtension = None
    io = None

MODEL_RESOLVER_DEPENDENCY_NODE_TYPE = "ModelResolverDependency"
MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME = "Model Resolver Opener"
MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY = "Model Resolver/Workflow"
MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION = (
    "This passive node declares Model Resolver as a workflow dependency and opens "
    "its tools. It does not process images, models, or prompts. To stop adding it "
    "automatically, open Model Resolver, go to Options -> Defaults -> and disable "
    "'Embed opener node'. We recommend keeping it in an unobtrusive part of the "
    "canvas: it helps ComfyUI-Manager identify and offer Model Resolver on other "
    "ComfyUI installations, making the workflow easier to use in the future."
)


if ComfyExtension is not None and io is not None:

    class ModelResolverDependencyNode(io.ComfyNode):
        """Canvas node that declares Model Resolver and opens its workflow tools."""

        @classmethod
        def define_schema(cls) -> io.Schema:
            return io.Schema(
                node_id=MODEL_RESOLVER_DEPENDENCY_NODE_TYPE,
                display_name=MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME,
                category=MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY,
                description=MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION,
                inputs=[],
                outputs=[],
            )

        @classmethod
        def execute(cls) -> io.NodeOutput:
            return io.NodeOutput()

    class ModelResolverNodeExtension(ComfyExtension):
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [ModelResolverDependencyNode]

    async def comfy_entrypoint() -> ComfyExtension:
        return ModelResolverNodeExtension()

    __all__ = ["comfy_entrypoint"]
else:

    class ModelResolverDependencyNode:
        """Legacy fallback for ComfyUI builds without the v3 custom-node API."""

        DESCRIPTION = MODEL_RESOLVER_DEPENDENCY_NODE_DESCRIPTION
        RETURN_TYPES = ()
        FUNCTION = "noop"
        CATEGORY = MODEL_RESOLVER_DEPENDENCY_NODE_CATEGORY

        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {}}

        def noop(self):
            return ()

    NODE_CLASS_MAPPINGS = {
        MODEL_RESOLVER_DEPENDENCY_NODE_TYPE: ModelResolverDependencyNode,
    }
    NODE_DISPLAY_NAME_MAPPINGS = {
        MODEL_RESOLVER_DEPENDENCY_NODE_TYPE: MODEL_RESOLVER_DEPENDENCY_NODE_DISPLAY_NAME,
    }

    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

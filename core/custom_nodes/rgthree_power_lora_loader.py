"""Backend adapter metadata for rgthree Power Lora Loader."""

from .base import CustomNodeModelAdapter

ADAPTER_ID = "rgthree-power-lora-loader"
NODE_TYPES = ("Power Lora Loader (rgthree)",)

ADAPTER = CustomNodeModelAdapter(
    adapter_id=ADAPTER_ID,
    node_types=NODE_TYPES,
    category_hint="loras",
)

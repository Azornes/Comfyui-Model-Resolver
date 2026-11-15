"""Monkeypatch for ComfyUI native LoRA stack node validation."""

from typing import Any

from ..log_system import create_module_logger

log = create_module_logger(__name__)


def patch_lora_stack_nodes() -> None:
    """
    Patch LoadLoraModel and LoadLoraTextEncoder (from comfy_extras)
    to define validate_inputs(cls, **kwargs).

    By default in ComfyUI core, these nodes inherit io.ComfyNode without overriding
    validate_inputs. As a result, ComfyUI's execution.py performs a generic combo
    check (value_not_in_list) against every dynamic row, even when enabled=False or
    strength=0, which blocks prompt execution and workflow runs when uninstalled LoRAs
    are present but disabled.
    """
    try:
        classes_to_patch = []
        try:
            import comfy_extras.nodes_lora_stack as nls

            if hasattr(nls, "LoadLoraModel"):
                classes_to_patch.append(nls.LoadLoraModel)
            if hasattr(nls, "LoadLoraTextEncoder"):
                classes_to_patch.append(nls.LoadLoraTextEncoder)
        except Exception:
            pass

        try:
            import nodes

            mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {})
            for name in (
                "LoadLoraModel",
                "LoadLoraTextEncoder",
                "Load LoRA (Model)",
                "Load LoRA (Text Encoder)",
            ):
                cls = mappings.get(name)
                if cls and cls not in classes_to_patch:
                    classes_to_patch.append(cls)
        except Exception:
            pass

        if not classes_to_patch:
            return

        @classmethod
        def _validate_dynamic_loras(cls: Any, *args: Any, **kwargs: Any) -> Any:
            loras = kwargs.get("loras")
            if loras is None and args:
                for arg in args:
                    if isinstance(arg, list) and (not arg or isinstance(arg[0], dict)):
                        loras = arg
                        break
            if isinstance(loras, list):
                try:
                    import folder_paths
                except Exception:
                    folder_paths = None

                for row in loras:
                    if not isinstance(row, dict):
                        continue
                    enabled = row.get("enabled", True)
                    if enabled is False or str(enabled).strip().lower() in ("false", "0"):
                        continue
                    strength = row.get("strength", 1.0)
                    try:
                        if float(strength) == 0.0:
                            continue
                    except (TypeError, ValueError):
                        pass
                    lora_name = row.get("lora_name")
                    if lora_name and folder_paths:
                        available = folder_paths.get_filename_list("loras")
                        if lora_name not in available:
                            return f"Value not in list: {lora_name}"
            return True

        for target_cls in classes_to_patch:
            if not getattr(target_cls, "_model_resolver_patched", False):
                target_cls.validate_inputs = _validate_dynamic_loras
                target_cls._model_resolver_patched = True
    except Exception as e:
        log.debug(f"Failed to patch lora stack nodes: {e}")

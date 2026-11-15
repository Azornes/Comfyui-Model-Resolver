"""AST scanner for discovering model widget schemas in custom nodes."""

from __future__ import annotations

import ast
import os
import threading
from typing import Any, Dict, List, Optional, Set

from ..log_system import create_module_logger
from ..type_utils import normalize_download_category

log = create_module_logger(__name__)

# Cache for scanned custom node widget schemas: node_class_name -> list of {"name": str, "folders": list[str]}
_node_widget_schema_hints_cache: Optional[Dict[str, List[Dict[str, Any]]]] = None
_schema_lock = threading.RLock()

# Built-in fallbacks for standard ComfyUI nodes or known multi-model loaders
_BUILTIN_NODE_WIDGET_SCHEMA_HINTS: Dict[str, List[Dict[str, Any]]] = {
    "LTXAVTextEncoderLoader": [
        {"name": "text_encoder", "folders": ["text_encoders"]},
        {"name": "ckpt_name", "folders": ["checkpoints"]},
    ],
    "CheckpointLoader": [
        {"name": "config_name", "folders": ["configs"]},
        {"name": "ckpt_name", "folders": ["checkpoints"]},
    ],
}


def _dedupe_preserve_order(values: List[str]) -> List[str]:
    """Deduplicate strings while preserving original order."""
    seen: Set[str] = set()
    result: List[str] = []
    for value in values:
        val = str(value or "").strip()
        if not val or val in seen:
            continue
        seen.add(val)
        result.append(val)
    return result


def _extract_folder_names_from_ast_expr(
    expr: Optional[ast.AST],
    folder_vars: Dict[str, List[str]],
) -> List[str]:
    """Extract model directory/folder names from an AST expression."""
    if expr is None:
        return []

    if isinstance(expr, ast.Call):
        fn = expr.func
        # folder_paths.get_filename_list("checkpoints") or folder_paths.get_folder_paths("vae")
        if (
            isinstance(fn, ast.Attribute)
            and fn.attr in {"get_filename_list", "get_folder_paths"}
            and isinstance(fn.value, ast.Name)
            and fn.value.id == "folder_paths"
            and expr.args
            and isinstance(expr.args[0], ast.Constant)
            and isinstance(expr.args[0].value, str)
        ):
            return _dedupe_preserve_order([expr.args[0].value])

        # list(...), tuple(...), sorted(...), set(...)
        if isinstance(fn, ast.Name) and fn.id in {"list", "tuple", "set", "sorted"} and expr.args:
            return _extract_folder_names_from_ast_expr(expr.args[0], folder_vars)
        return []

    # Subscript like folder_paths.folder_names_and_paths["checkpoints"][0]
    if isinstance(expr, ast.Subscript):
        curr: Optional[ast.AST] = expr
        while isinstance(curr, ast.Subscript):
            slice_node = curr.slice
            if isinstance(slice_node, ast.Constant) and isinstance(slice_node.value, str):
                val = curr.value
                if (
                    isinstance(val, ast.Attribute)
                    and val.attr == "folder_names_and_paths"
                    and isinstance(val.value, ast.Name)
                    and val.value.id == "folder_paths"
                ):
                    return _dedupe_preserve_order([slice_node.value])
            curr = curr.value

    if isinstance(expr, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
        combined: List[str] = []
        for gen in expr.generators:
            combined.extend(_extract_folder_names_from_ast_expr(gen.iter, folder_vars))
        combined.extend(_extract_folder_names_from_ast_expr(expr.elt, folder_vars))
        return _dedupe_preserve_order(combined)

    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
        left = _extract_folder_names_from_ast_expr(expr.left, folder_vars)
        right = _extract_folder_names_from_ast_expr(expr.right, folder_vars)
        return _dedupe_preserve_order(left + right)

    if isinstance(expr, ast.Name):
        return list(folder_vars.get(expr.id, []))

    if isinstance(expr, (ast.List, ast.Tuple, ast.Set)):
        combined = []
        for item in expr.elts:
            combined.extend(_extract_folder_names_from_ast_expr(item, folder_vars))
        return _dedupe_preserve_order(combined)

    if isinstance(expr, ast.IfExp):
        body = _extract_folder_names_from_ast_expr(expr.body, folder_vars)
        orelse = _extract_folder_names_from_ast_expr(expr.orelse, folder_vars)
        return _dedupe_preserve_order(body + orelse)

    return []


def _resolve_ast_dict_expr(
    expr: Optional[ast.AST],
    dict_vars: Dict[str, ast.Dict],
) -> Optional[ast.Dict]:
    """Resolve an AST dictionary expression, dereferencing local variables if needed."""
    if isinstance(expr, ast.Dict):
        return expr
    if isinstance(expr, ast.Name):
        return dict_vars.get(expr.id)
    return None


def _extract_widget_schema_from_input_types_ast(
    fn: ast.FunctionDef,
) -> List[Dict[str, Any]]:
    """Parse an INPUT_TYPES function AST to extract widget definitions and target model folders."""
    folder_vars: Dict[str, List[str]] = {}
    dict_vars: Dict[str, ast.Dict] = {}
    return_expr: Optional[ast.AST] = None

    for stmt in fn.body:
        if isinstance(stmt, ast.Assign):
            folders = _extract_folder_names_from_ast_expr(stmt.value, folder_vars)
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    if folders:
                        folder_vars[target.id] = folders
                    if isinstance(stmt.value, ast.Dict):
                        dict_vars[target.id] = stmt.value
                    elif isinstance(stmt.value, ast.Name) and stmt.value.id in dict_vars:
                        dict_vars[target.id] = dict_vars[stmt.value.id]
        elif isinstance(stmt, ast.AnnAssign):
            target = stmt.target
            value = stmt.value
            if isinstance(target, ast.Name) and value is not None:
                folders = _extract_folder_names_from_ast_expr(value, folder_vars)
                if folders:
                    folder_vars[target.id] = folders
                if isinstance(value, ast.Dict):
                    dict_vars[target.id] = value
                elif isinstance(value, ast.Name) and value.id in dict_vars:
                    dict_vars[target.id] = dict_vars[value.id]
        elif isinstance(stmt, ast.Return):
            return_expr = stmt.value
            break

    top_dict = _resolve_ast_dict_expr(return_expr, dict_vars)
    if top_dict is None:
        return []

    schema: List[Dict[str, Any]] = []
    for key_node, section_expr in zip(top_dict.keys, top_dict.values, strict=False):
        if not isinstance(key_node, ast.Constant) or not isinstance(key_node.value, str):
            continue
        if key_node.value not in {"required", "optional"}:
            continue

        section_dict = _resolve_ast_dict_expr(section_expr, dict_vars)
        if section_dict is None:
            continue

        for widget_key_node, widget_value_expr in zip(section_dict.keys, section_dict.values, strict=False):
            if not isinstance(widget_key_node, ast.Constant) or not isinstance(widget_key_node.value, str):
                continue

            widget_name = widget_key_node.value
            first_expr = widget_value_expr
            if isinstance(widget_value_expr, ast.Tuple) and widget_value_expr.elts:
                first_expr = widget_value_expr.elts[0]

            folders = _extract_folder_names_from_ast_expr(first_expr, folder_vars)
            if folders:
                normalized_folders = _dedupe_preserve_order(
                    [normalize_download_category(folder) for folder in folders if folder]
                )
                if normalized_folders:
                    schema.append({
                        "name": widget_name,
                        "folders": normalized_folders,
                    })

    return schema


def get_custom_nodes_search_directories() -> List[str]:
    """Return all detected ComfyUI custom_nodes directories to scan."""
    candidates: List[str] = []

    try:
        import folder_paths
        paths = folder_paths.get_folder_paths("custom_nodes")
        if paths:
            candidates.extend(paths)
        base = getattr(folder_paths, "base_path", None)
        if base:
            cn_dir = os.path.join(base, "custom_nodes")
            if cn_dir not in candidates and os.path.isdir(cn_dir):
                candidates.append(cn_dir)
    except Exception:
        pass

    # Fallback to navigating relative to this file: comfyui-model-resolver/core/custom_nodes -> ComfyUI/custom_nodes
    try:
        parent_custom_nodes = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        if (
            os.path.basename(parent_custom_nodes).lower() == "custom_nodes"
            and os.path.isdir(parent_custom_nodes)
            and parent_custom_nodes not in candidates
        ):
            candidates.append(parent_custom_nodes)
    except Exception:
        pass

    return [p for p in candidates if os.path.isdir(p)]


def scan_custom_node_widget_schemas(
    custom_nodes_dirs: Optional[List[str]] = None,
    max_depth: int = 2,
) -> Dict[str, List[Dict[str, Any]]]:
    """Scan custom node Python source files and extract (NodeClass -> widget schema hints) mappings."""
    search_dirs = custom_nodes_dirs if custom_nodes_dirs is not None else get_custom_nodes_search_directories()
    hints: Dict[str, List[Dict[str, Any]]] = {}
    skip_dirs = {
        ".git",
        "__pycache__",
        "venv",
        ".venv",
        "node_modules",
        "web",
        "assets",
        "docs",
        "models",
        "checkpoints",
        "loras",
        "temp",
        "output",
        "input",
        ".cache",
    }

    for search_dir in search_dirs:
        if not os.path.isdir(search_dir):
            continue
        for root, dirs, files in os.walk(search_dir, followlinks=False):
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
            rel_path = os.path.relpath(root, search_dir)
            depth = 0 if rel_path == "." else len(rel_path.split(os.sep))
            if depth >= max_depth:
                dirs[:] = []

            for filename in files:
                if not filename.endswith(".py"):
                    continue

                filepath = os.path.join(root, filename)
                try:
                    if os.path.getsize(filepath) > 500_000:
                        continue
                    with open(filepath, encoding="utf-8", errors="replace") as f:
                        source = f.read()
                    if "INPUT_TYPES" not in source:
                        continue
                    tree = ast.parse(source, filename=filepath)
                except Exception:
                    continue

                for node in tree.body:
                    if not isinstance(node, ast.ClassDef):
                        continue
                    input_types_fn = None
                    for child in node.body:
                        if isinstance(child, ast.FunctionDef) and child.name == "INPUT_TYPES":
                            input_types_fn = child
                            break
                    if input_types_fn is None:
                        continue

                    schema = _extract_widget_schema_from_input_types_ast(input_types_fn)
                    if not schema:
                        continue

                    existing = hints.get(node.name)
                    if not existing:
                        hints[node.name] = schema
                        continue

                    existing_scored = sum(1 for item in existing if item.get("folders"))
                    schema_scored = sum(1 for item in schema if item.get("folders"))
                    if schema_scored > existing_scored:
                        hints[node.name] = schema

    return hints


def get_node_widget_schema_hints() -> Dict[str, List[Dict[str, Any]]]:
    """Return the cached widget schema hints discovered from custom nodes, with fallbacks."""
    global _node_widget_schema_hints_cache
    with _schema_lock:
        if _node_widget_schema_hints_cache is not None:
            return _node_widget_schema_hints_cache

        try:
            scanned = scan_custom_node_widget_schemas()
            for k, v in _BUILTIN_NODE_WIDGET_SCHEMA_HINTS.items():
                scanned.setdefault(k, v)
            _node_widget_schema_hints_cache = scanned
            log.debug(f"Scanned AST widget schema hints for {len(_node_widget_schema_hints_cache)} node classes")
        except Exception as e:
            log.debug(f"Failed to scan custom node widget schemas: {e}")
            _node_widget_schema_hints_cache = dict(_BUILTIN_NODE_WIDGET_SCHEMA_HINTS)
        return _node_widget_schema_hints_cache


def clear_node_widget_schema_hints_cache() -> None:
    """Clear the cached widget schema hints."""
    global _node_widget_schema_hints_cache
    with _schema_lock:
        _node_widget_schema_hints_cache = None


def resolve_ast_node_widget_category(
    node_type: str,
    widget_index: Optional[int] = None,
    widget_name: Optional[str] = None,
) -> Optional[str]:
    """
    Resolve a model category for a given node type and widget using scanned AST schemas.

    Matches by widget_index (position in declared schema) or by widget_name.
    """
    if not node_type:
        return None

    hints = get_node_widget_schema_hints().get(node_type)
    if not hints:
        return None

    # First attempt: match by widget_name if provided
    if widget_name:
        normalized_target_name = widget_name.strip().lower()
        for entry in hints:
            if str(entry.get("name") or "").strip().lower() == normalized_target_name:
                folders = entry.get("folders") or []
                if folders:
                    return folders[0]

    # Second attempt: match by widget_index if in range
    if widget_index is not None and 0 <= widget_index < len(hints):
        entry = hints[widget_index]
        folders = entry.get("folders") or []
        if folders:
            return folders[0]

    return None

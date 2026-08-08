"""Local model metadata and hash calculation service."""

import os
import time
import uuid

from .. import path_utils
from ..local_hash_matches import collect_local_hash_matches_for_result
from ..request_utils import extract_request_sha256, validate_workflow_payload
from ..routes.context import RouteContext


class HashService:
    """Implement local model hash operations used by HTTP routes."""

    def __init__(self, context: RouteContext):
        self.file_manager_error = context.require("FileManagerError")
        self.file_manager_unavailable_error = context.require(
            "FileManagerUnavailableError"
        )
        self.metadata_schema = context.require("MODEL_RESOLVER_METADATA_SCHEMA")
        self.metadata_schema_version = context.require(
            "MODEL_RESOLVER_METADATA_SCHEMA_VERSION"
        )
        self.unsupported_file_manager_error = context.require(
            "UnsupportedFileManagerPlatformError"
        )
        self.asyncio = context.require("asyncio")
        self.cancel_progress_response = context.require("cancel_progress_response")
        self.get_existing_model_preview_path = context.get(
            "get_existing_model_preview_path"
        )
        self.get_filename_from_path = context.require("get_filename_from_path")
        self.get_local_model_hash_metadata = context.require(
            "get_local_model_hash_metadata"
        )
        self.get_progress_response = context.require("get_progress_response")
        self.get_safe_model_resolver_sidecar_path = context.require(
            "get_safe_model_resolver_sidecar_path"
        )
        self.get_workflow_model_inventory = context.require(
            "get_workflow_model_inventory"
        )
        self.is_path_in_configured_model_roots = context.require(
            "is_path_in_configured_model_roots"
        )
        self.load_resolver_settings = context.require("load_resolver_settings")
        self.normalize_file_manager_path = context.require(
            "normalize_file_manager_path"
        )
        self.normalize_sha256 = context.require("normalize_sha256")
        self.open_in_file_manager = context.require("open_in_file_manager")
        self.os = context.get("os") or os
        self.read_json_safe = context.require("read_json_safe")
        self.resolver_bool_setting = context.require("resolver_bool_setting")
        self.run_in_background_thread = context.require("run_in_background_thread")
        self.search_local_matches_by_hash = context.require(
            "search_local_matches_by_hash"
        )
        self.extension = context.require("self")
        self.time = context.get("time") or time
        self.to_bool = context.require("to_bool")
        self.to_int = context.require("to_int")
        self.web = context.require("web")
        self.write_json_atomic = context.require("write_json_atomic")

    @property
    def hash_tracker(self):
        return self.extension.hash_tracker

    @property
    def logger(self):
        return self.extension.logger

    def _normalize_path(self, path):
        return path_utils.normalize_absolute_path(
            path,
            path_module=self.os.path,
        )

    def _normalize_model_path(self, path):
        normalized_path = self._normalize_path(path)
        return normalized_path, self.is_path_in_configured_model_roots(normalized_path)

    async def local_model_hashes(self, request):
        """Return SHA256 hashes already stored in local sidecar metadata."""
        data = await request.json()
        model = data.get("model") if isinstance(data.get("model"), dict) else {}
        path = (
            data.get("path")
            or data.get("file_path")
            or data.get("resolved_path")
            or model.get("path")
            or model.get("resolved_path")
            or ""
        )

        if not path:
            return self.web.json_response(
                {"error": "path is required"}, status=400
            )

        normalized_path, is_configured_model_path = self._normalize_model_path(path)
        if not is_configured_model_path:
            return self.web.json_response(
                {"error": "path is outside configured model directories"},
                status=403,
            )

        return self.web.json_response(
            self.get_local_model_hash_metadata(normalized_path, model=model)
        )

    async def get_model_preview(self, request):
        """Serve an adjacent model preview from a configured model directory."""
        model_path = str(request.query.get("path") or "").strip()
        is_preview_probe = str(getattr(request, "method", "")).upper() == "HEAD"
        if not model_path:
            return self.web.Response(text="path is required", status=400)

        try:
            normalized_path, is_configured_model_path = self._normalize_model_path(
                model_path
            )
        except (OSError, TypeError, ValueError):
            return self.web.Response(text="invalid model path", status=400)
        if not self.os.path.isfile(normalized_path):
            if is_preview_probe:
                return self.web.Response(status=204)
            return self.web.Response(text="model file does not exist", status=404)
        if not is_configured_model_path:
            return self.web.Response(
                text="path is outside configured model directories",
                status=403,
            )

        preview_path = self.get_existing_model_preview_path(normalized_path)
        if not preview_path:
            if is_preview_probe:
                return self.web.Response(status=204)
            return self.web.Response(text="preview not found", status=404)
        _, is_configured_preview_path = self._normalize_model_path(preview_path)
        if not is_configured_preview_path:
            return self.web.Response(
                text="preview is outside configured model directories",
                status=403,
            )

        return self.web.FileResponse(
            preview_path,
            headers={"Cache-Control": "private, no-cache"},
        )

    async def workflow_model_hashes(self, request):
        """Return hash metadata for existing local models used by a workflow."""
        data = await request.json()
        workflow_json, workflow_error = validate_workflow_payload(
            data.get("workflow"),
            none_is_missing=False,
        )
        if workflow_error:
            return self.web.json_response(
                {"error": workflow_error}, status=400
            )

        settings = await self.asyncio.to_thread(self.load_resolver_settings)
        if not self.resolver_bool_setting(
            settings.get("workflow_hash_metadata_enabled"), True
        ):
            return self.web.json_response(
                {
                    "success": True,
                    "enabled": False,
                    "models": [],
                    "by_node": {},
                    "by_path": {},
                    "count": 0,
                }
            )

        inventory = await self.asyncio.to_thread(
            self.get_workflow_model_inventory,
            workflow_json,
        )
        refs = inventory["model_refs"]

        by_node = {}
        by_path = {}
        models = []
        seen = set()

        for ref in refs:
            if not isinstance(ref, dict) or not ref.get("exists"):
                continue
            full_path = str(ref.get("full_path") or "").strip()
            if not full_path:
                continue
            model_info = {
                "path": full_path,
                "filename": self.get_filename_from_path(full_path),
                "relative_path": ref.get("original_path") or "",
                "category": ref.get("category") or "",
            }
            metadata = self.get_local_model_hash_metadata(
                full_path,
                model=model_info,
            )
            sha256 = self.normalize_sha256(metadata.get("sha256"))
            if not sha256:
                continue

            entry = {
                "node_id": ref.get("node_id"),
                "node_type": ref.get("node_type") or "",
                "widget_index": ref.get("widget_index"),
                "widget_name": ref.get("widget_name") or "",
                "path": ref.get("original_path") or "",
                "filename": self.get_filename_from_path(
                    ref.get("original_path") or full_path
                ),
                "category": ref.get("category") or "",
                "sha256": sha256,
                "size": metadata.get("size") or 0,
            }
            entry_key = (
                str(entry.get("node_id")),
                str(entry.get("widget_index")),
                entry.get("path"),
                sha256,
            )
            if entry_key in seen:
                continue
            seen.add(entry_key)
            models.append(entry)

            path_key = str(entry.get("path") or entry.get("filename") or "")
            if path_key:
                by_path[path_key] = entry
                by_path[self.get_filename_from_path(path_key)] = entry
            node_key = f"{entry.get('node_id')}:{entry.get('widget_index')}"
            by_node[node_key] = entry

        return self.web.json_response(
            {
                "success": True,
                "enabled": True,
                "models": models,
                "by_node": by_node,
                "by_path": by_path,
                "count": len(models),
            }
        )

    async def local_matches_by_hash(self, request):
        """Search local model metadata sidecars for a remote SHA256."""
        data = await request.json()
        sha256 = extract_request_sha256(
            data,
            keys=("sha256", "hash", "SHA256"),
        )
        if not sha256:
            return self.web.json_response(
                {"error": "sha256 is required"}, status=400
            )

        category = data.get("category", "")
        source = str(
            data.get("source")
            or data.get("hash_lookup_source")
            or "download_source"
        ).strip().lower().replace("-", "_")
        filename = (
            data.get("filename")
            or data.get("path")
            or data.get("model_name")
            or ""
        )
        max_matches = self.to_int(data.get("max_matches"), 20)
        force_rescan = self.to_bool(data.get("force_rescan"), False)

        enriched_matches = collect_local_hash_matches_for_result(
            sha256,
            search_local_matches_by_hash=self.search_local_matches_by_hash,
            category=category or None,
            max_matches=max_matches,
            force_rescan=force_rescan,
            source=source or "download_source",
            filename=filename,
        )
        return self.web.json_response(
            {
                "sha256": sha256,
                "local_hash_matches": enriched_matches,
                "matches": enriched_matches,
            }
        )

    async def open_containing_folder(self, request):
        """Reveal a file or open a directory in the host file manager."""
        try:
            data = await request.json()
        except Exception as exc:
            return self.web.json_response(
                {"success": False, "error": f"invalid JSON body: {exc}"},
                status=400,
            )
        if not isinstance(data, dict):
            return self.web.json_response(
                {"success": False, "error": "JSON body must be an object"},
                status=400,
            )
        target_path = data.get("path", "")

        try:
            normalized_path = self.normalize_file_manager_path(target_path)
        except ValueError as exc:
            return self.web.json_response(
                {"success": False, "error": str(exc)}, status=400
            )

        if not self.os.path.exists(normalized_path):
            return self.web.json_response(
                {"success": False, "error": "path does not exist"},
                status=404,
            )
        if not self.is_path_in_configured_model_roots(normalized_path):
            return self.web.json_response(
                {
                    "success": False,
                    "error": "path is outside configured model directories",
                },
                status=403,
            )

        try:
            result = await self.asyncio.to_thread(
                self.open_in_file_manager,
                normalized_path,
            )
        except FileNotFoundError:
            return self.web.json_response(
                {"success": False, "error": "path no longer exists"},
                status=404,
            )
        except self.unsupported_file_manager_error as exc:
            return self.web.json_response(
                {"success": False, "error": str(exc)}, status=501
            )
        except self.file_manager_unavailable_error as exc:
            return self.web.json_response(
                {
                    "success": False,
                    "error": (
                        f"{exc} The ComfyUI host may be running without "
                        "a graphical desktop session."
                    ),
                },
                status=503,
            )
        except self.file_manager_error as exc:
            return self.web.json_response(
                {"success": False, "error": str(exc)}, status=500
            )

        return self.web.json_response({"success": True, **result})

    def resolve_hash_file_request(self, data):
        """Validate and normalize a file path accepted by hash endpoints."""
        file_path = (
            data.get("file_path")
            or data.get("resolved_path")
            or data.get("path")
            or ""
        )
        if not file_path:
            return "", "file_path is required"

        normalized_path, is_configured_model_path = self._normalize_model_path(file_path)
        if (
            not self.os.path.exists(normalized_path)
            or not self.os.path.isfile(normalized_path)
        ):
            return "", "file does not exist"
        if not is_configured_model_path:
            return "", "file is outside configured model directories"
        return normalized_path, ""

    async def _get_validated_hash_file_request(self, request):
        """Read and validate the file request shared by hash endpoints."""
        data = await request.json()
        normalized_path, error = self.resolve_hash_file_request(data)
        if not error:
            return normalized_path, None

        status = 400 if error == "file_path is required" else (
            403
            if error == "file is outside configured model directories"
            else 404
        )
        return "", self.web.json_response({"error": error}, status=status)

    def write_calculated_hash_metadata(
        self,
        normalized_path,
        sha256,
        sha256_source="file",
    ):
        """Persist calculated SHA256 metadata next to a local model."""
        resolved_metadata_path = self.get_safe_model_resolver_sidecar_path(
            normalized_path
        )

        metadata_updated = False
        try:
            metadata = self.read_json_safe(resolved_metadata_path, {})
            if not isinstance(metadata, dict):
                metadata = {}

            filename = self.get_filename_from_path(normalized_path)
            stem, _ext = self.os.path.splitext(filename)
            hashes = metadata.get("hashes")
            if not isinstance(hashes, dict):
                hashes = {}
            hashes["SHA256"] = sha256

            metadata["schema"] = self.metadata_schema
            metadata["schema_version"] = self.metadata_schema_version
            metadata["managed_by"] = self.metadata_schema
            metadata["sha256"] = sha256
            metadata["hashes"] = hashes
            metadata["hash_status"] = "completed"
            metadata["sha256_source"] = sha256_source or "file"
            metadata["last_checked_at"] = self.time.time()
            metadata.setdefault("file_name", stem)
            metadata.setdefault("model_name", stem)
            metadata.setdefault(
                "file_path",
                normalized_path.replace("\\", "/"),
            )
            try:
                metadata.setdefault("size", self.os.path.getsize(normalized_path))
            except Exception:
                pass

            self.write_json_atomic(resolved_metadata_path, metadata, indent=2)
            metadata_updated = True
            self.logger.info(
                f"Stored SHA256 and updated metadata: {resolved_metadata_path}"
            )
        except Exception as metadata_error:
            self.logger.warning(
                "Could not update metadata with calculated SHA256 for "
                f"{normalized_path}: {metadata_error}"
            )

        return resolved_metadata_path, metadata_updated

    def calculate_sha256_with_progress(self, normalized_path, progress_id=""):
        """Calculate a SHA256 while updating and honoring hash progress."""
        total_bytes = max(0, self.os.path.getsize(normalized_path))

        self.hash_tracker.update(
            progress_id,
            status="running",
            stage="header",
            message="Checking safetensors header...",
            percent=0,
            bytes_read=0,
            total_bytes=total_bytes,
        )

        if self.hash_tracker.is_cancelled(progress_id):
            raise path_utils.HashCalculationCancelled()

        hash_source = ["file"]
        stage_transitioned = [False]
        bytes_read_state = [0]
        last_update = [0.0]

        def on_progress(bytes_read, callback_total_bytes):
            bytes_read_state[0] = bytes_read
            if not stage_transitioned[0]:
                stage_transitioned[0] = True
                self.logger.info(
                    "No SHA256 found in safetensors header; calculating full "
                    f"file SHA256: {normalized_path}"
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="hashing",
                    message="Calculating SHA256...",
                    percent=0,
                    bytes_read=0,
                    total_bytes=callback_total_bytes,
                )

            now = self.time.time()
            if (
                now - last_update[0] >= 0.15
                or bytes_read >= callback_total_bytes
            ):
                percent = (
                    98
                    if callback_total_bytes <= 0
                    else min(98, (bytes_read / callback_total_bytes) * 98)
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="hashing",
                    message="Calculating SHA256...",
                    percent=percent,
                    bytes_read=bytes_read,
                    total_bytes=callback_total_bytes,
                )
                last_update[0] = now

        def is_cancelled():
            if self.hash_tracker.is_cancelled(progress_id):
                percent = (
                    0
                    if total_bytes <= 0
                    else min(98, (bytes_read_state[0] / total_bytes) * 98)
                )
                self.hash_tracker.update(
                    progress_id,
                    status="cancelled",
                    stage="cancelled",
                    message="Hash calculation cancelled",
                    percent=percent,
                    bytes_read=bytes_read_state[0],
                    total_bytes=total_bytes,
                )
                return True
            return False

        def on_hash_source(source_name):
            hash_source[0] = source_name
            if source_name == "safetensors_header":
                self.logger.info(
                    f"Found SHA256 in safetensors header: {normalized_path}"
                )
                self.hash_tracker.update(
                    progress_id,
                    status="running",
                    stage="header",
                    message="Found SHA256 in safetensors header",
                    percent=98,
                    bytes_read=0,
                    total_bytes=total_bytes,
                    sha256_source="safetensors_header",
                )

        sha256 = path_utils.calculate_file_sha256(
            normalized_path,
            chunk_size=1024 * 1024 * 4,
            on_progress=on_progress,
            is_cancelled=is_cancelled,
            use_safetensors_header=True,
            on_hash_source=on_hash_source,
        )

        if is_cancelled():
            raise path_utils.HashCalculationCancelled()

        return sha256, hash_source[0]

    async def calculate_file_hash(self, request):
        """Calculate SHA256 for a local model and persist sidecar metadata."""
        normalized_path, error_response = await self._get_validated_hash_file_request(
            request
        )
        if error_response:
            return error_response

        sha256, sha256_source = self.calculate_sha256_with_progress(normalized_path)
        if not sha256:
            return self.web.json_response(
                {"error": "could not calculate hash"}, status=500
            )
        resolved_metadata_path, metadata_updated = (
            self.write_calculated_hash_metadata(
                normalized_path,
                sha256,
                sha256_source,
            )
        )

        return self.web.json_response(
            {
                "success": True,
                "sha256": sha256,
                "hash": sha256,
                "sha256_source": sha256_source,
                "file_path": normalized_path,
                "metadata_path": resolved_metadata_path,
                "metadata_updated": metadata_updated,
            }
        )

    async def calculate_file_hash_start(self, request):
        """Start SHA256 calculation in a background thread."""
        normalized_path, error_response = await self._get_validated_hash_file_request(
            request
        )
        if error_response:
            return error_response

        self.hash_tracker.cleanup()
        progress_id = f"hash_{uuid.uuid4().hex}"
        self.hash_tracker.update(
            progress_id,
            status="queued",
            stage="queued",
            message="Preparing hash calculation...",
            percent=0,
            file_path=normalized_path,
        )

        def run_hash_task():
            sha256, sha256_source = self.calculate_sha256_with_progress(
                normalized_path,
                progress_id=progress_id,
            )
            if self.hash_tracker.is_cancelled(progress_id):
                raise path_utils.HashCalculationCancelled()
            self.hash_tracker.update(
                progress_id,
                status="running",
                stage="metadata",
                message="Saving metadata...",
                percent=99,
            )
            resolved_metadata_path, metadata_updated = (
                self.write_calculated_hash_metadata(
                    normalized_path,
                    sha256,
                    sha256_source,
                )
            )
            return sha256, sha256_source, resolved_metadata_path, metadata_updated

        def on_success(result):
            (
                sha256,
                sha256_source,
                resolved_metadata_path,
                metadata_updated,
            ) = result
            self.hash_tracker.update(
                progress_id,
                status="done",
                stage="done",
                message="Hash calculated",
                percent=100,
                sha256=sha256,
                hash=sha256,
                sha256_source=sha256_source,
                file_path=normalized_path,
                metadata_path=resolved_metadata_path,
                metadata_updated=metadata_updated,
            )

        def on_cancel(result=None):
            del result
            self.hash_tracker.update(
                progress_id,
                status="cancelled",
                stage="cancelled",
                message="Hash calculation cancelled",
            )

        self.run_in_background_thread(
            self.hash_tracker,
            progress_id,
            run_hash_task,
            on_success,
            on_cancel,
            error_log_msg=f"Hash calculation failed for {normalized_path}",
        )
        return self.web.json_response(
            {
                "success": True,
                "progress_id": progress_id,
            }
        )

    async def calculate_file_hash_progress(self, request):
        """Return progress for a background SHA256 calculation."""
        return self.get_progress_response(
            self.hash_tracker,
            request,
            not_found_status=404,
        )

    async def calculate_file_hash_cancel(self, request):
        """Cancel a background SHA256 calculation."""
        return self.cancel_progress_response(
            self.hash_tracker,
            request,
            cancel_message="Stopping hash calculation...",
        )

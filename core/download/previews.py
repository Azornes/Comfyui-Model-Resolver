"""Preview media handling for downloaded models."""

import os
import tempfile
from io import BytesIO
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse, urlunparse

import requests

from ..log_system import create_module_logger
from ..path_utils import get_filename_from_path
from ..type_utils import as_dict, as_list

log = create_module_logger("core.downloader")

MODEL_PREVIEW_WIDTH = 480
MODEL_PREVIEW_MAX_HEIGHT = 4096
MODEL_PREVIEW_QUALITY = 85
MODEL_PREVIEW_MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024
MODEL_PREVIEW_VIDEO_MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
MODEL_PREVIEW_EXTENSIONS = (
    ".mp4",
    ".webm",
    ".preview.mp4",
    ".preview.webm",
    ".webp",
    ".jpeg",
    ".jpg",
    ".png",
    ".preview.webp",
    ".preview.jpeg",
    ".preview.jpg",
    ".preview.png",
)


def _require_dependencies(dependencies: Any) -> Any:
    """Return explicitly supplied services for preview downloads."""
    if dependencies is None:
        raise RuntimeError("preview download dependencies were not provided")
    return dependencies


def get_existing_model_preview_path(dest_path: str) -> str:
    """Return the first adjacent preview media file available for a model."""
    model_base_path, _model_ext = os.path.splitext(dest_path)
    for extension in MODEL_PREVIEW_EXTENSIONS:
        candidate = f"{model_base_path}{extension}"
        if os.path.isfile(candidate):
            return candidate
    return ""


def _preview_media_type(url: str, declared_type: Any = "") -> str:
    media_type = str(declared_type or "").strip().lower()
    if media_type == "video":
        return "video"
    extension = os.path.splitext(urlparse(str(url or "")).path)[1].lower()
    return "video" if extension in {".mp4", ".webm"} else "image"


def _first_model_preview_asset(metadata: Dict[str, Any]) -> Tuple[str, str]:
    candidates = []
    image_sources = [
        metadata.get("images"),
        as_dict(metadata.get("civitai")).get("images"),
        as_dict(metadata.get("selected_version")).get("images"),
        as_dict(metadata.get("civitai_details")).get("images"),
        as_dict(as_dict(metadata.get("civitai_details")).get("civitai")).get(
            "images"
        ),
    ]
    for images in image_sources:
        for image in as_list(images):
            if not isinstance(image, dict):
                continue
            declared_type = image.get("type") or image.get("mediaType")
            candidates.extend(
                (value, declared_type)
                for value in (
                    image.get("url"),
                    image.get("imageUrl"),
                    image.get("src"),
                )
            )
    candidates.extend(
        [
            (metadata.get("preview_url"), metadata.get("preview_type")),
            (metadata.get("previewUrl"), metadata.get("previewType")),
            (metadata.get("thumbnail_url"), metadata.get("thumbnail_type")),
            (metadata.get("thumbnailUrl"), metadata.get("thumbnailType")),
        ]
    )

    for value, declared_type in candidates:
        url = str(value or "").strip()
        if url.startswith(("http://", "https://")):
            return url, _preview_media_type(url, declared_type)
    return "", ""


def _rewrite_civitai_preview_url(url: str, media_type: str) -> str:
    parsed = urlparse(str(url or ""))
    hostname = (parsed.hostname or "").lower()
    if not (hostname == "civitai.com" or hostname.endswith(".civitai.com")):
        return url
    if "/original=true" not in parsed.path:
        return url

    transform = (
        "/transcode=true,width=450,optimized=true"
        if media_type == "video"
        else "/width=450,optimized=true"
    )
    return urlunparse(parsed._replace(path=parsed.path.replace("/original=true", transform, 1)))


def _download_preview_asset(
    url: str,
    media_type: str = "image",
    *,
    dependencies: Any = None,
) -> bytes:
    facade = _require_dependencies(dependencies)
    max_bytes = (
        MODEL_PREVIEW_VIDEO_MAX_DOWNLOAD_BYTES
        if media_type == "video"
        else MODEL_PREVIEW_MAX_DOWNLOAD_BYTES
    )
    accept_header = (
        "video/mp4,video/webm,video/*,*/*;q=0.8"
        if media_type == "video"
        else "image/avif,image/webp,image/*,*/*;q=0.8"
    )

    response = None
    try:
        response, _final_url, _final_headers = facade.request_public_url(
            "GET",
            url,
            headers={
                "User-Agent": facade.DOWNLOAD_USER_AGENT,
                "Accept": accept_header,
            },
            timeout=20,
            stream=True,
        )
        response.raise_for_status()
        content_length = int(response.headers.get("Content-Length") or 0)
        if content_length > max_bytes:
            raise ValueError("Preview media exceeds the download size limit")

        chunks = []
        downloaded = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            downloaded += len(chunk)
            if downloaded > max_bytes:
                raise ValueError("Preview media exceeds the download size limit")
            chunks.append(chunk)
        return b"".join(chunks)
    except requests.exceptions.SSLError:
        if media_type == "image":
            return facade._download_preview_image_with_system_trust(url)
        return facade._download_preview_asset_with_system_trust(
            url,
            media_type=media_type,
        )
    finally:
        if response is not None:
            response.close()


def _download_preview_image(
    url: str,
    *,
    dependencies: Any = None,
) -> bytes:
    """Download an image preview, retained for compatibility with callers."""
    return _download_preview_asset(
        url,
        media_type="image",
        dependencies=dependencies,
    )


def _download_preview_asset_with_system_trust(
    url: str,
    media_type: str = "image",
    *,
    dependencies: Any = None,
) -> bytes:
    import ssl
    from urllib.request import (
        HTTPRedirectHandler,
        HTTPSHandler,
        Request,
        build_opener,
    )

    facade = _require_dependencies(dependencies)
    max_bytes = (
        MODEL_PREVIEW_VIDEO_MAX_DOWNLOAD_BYTES
        if media_type == "video"
        else MODEL_PREVIEW_MAX_DOWNLOAD_BYTES
    )
    accept_header = (
        "video/mp4,video/webm,video/*,*/*;q=0.8"
        if media_type == "video"
        else "image/avif,image/webp,image/*,*/*;q=0.8"
    )

    class ValidatedRedirectHandler(HTTPRedirectHandler):
        max_redirections = 5

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            validated_url = facade.validate_public_http_url(newurl)
            return super().redirect_request(
                req,
                fp,
                code,
                msg,
                headers,
                validated_url,
            )

    validated_url = facade.validate_public_http_url(url)
    request = Request(
        validated_url,
        headers={
            "User-Agent": facade.DOWNLOAD_USER_AGENT,
            "Accept": accept_header,
        },
        method="GET",
    )
    opener = build_opener(
        HTTPSHandler(context=ssl.create_default_context()),
        ValidatedRedirectHandler(),
    )
    with opener.open(request, timeout=20) as response:
        content_length = int(response.headers.get("Content-Length") or 0)
        if content_length > max_bytes:
            raise ValueError("Preview media exceeds the download size limit")

        chunks = []
        downloaded = 0
        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            downloaded += len(chunk)
            if downloaded > max_bytes:
                raise ValueError("Preview media exceeds the download size limit")
            chunks.append(chunk)
        return b"".join(chunks)


def _download_preview_image_with_system_trust(
    url: str,
    *,
    dependencies: Any = None,
) -> bytes:
    """Download an image through the Windows trust store fallback."""
    return _download_preview_asset_with_system_trust(
        url,
        media_type="image",
        dependencies=dependencies,
    )


def _save_preview_video(video_data: bytes, preview_path: str) -> None:
    if not video_data:
        raise ValueError("Preview video is empty")

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=os.path.dirname(preview_path),
            prefix=f".{os.path.basename(preview_path)}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = temp_file.name
            temp_file.write(video_data)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, preview_path)
        temp_path = ""
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _save_optimized_jpeg(image_data: bytes, preview_path: str) -> None:
    from PIL import Image, ImageOps

    temp_path = ""
    try:
        with Image.open(BytesIO(image_data)) as source_image:
            source_image.seek(0)
            oriented_image = ImageOps.exif_transpose(source_image)
            width, height = oriented_image.size
            if width <= 0 or height <= 0:
                raise ValueError("Preview image has invalid dimensions")

            resize_scale = min(
                MODEL_PREVIEW_WIDTH / width,
                MODEL_PREVIEW_MAX_HEIGHT / height,
            )
            target_width = max(1, round(width * resize_scale))
            target_height = max(1, round(height * resize_scale))
            resampling = getattr(Image, "Resampling", Image)
            resized_image = oriented_image.resize(
                (target_width, target_height),
                resampling.LANCZOS,
            )

            if resized_image.mode in {"RGBA", "LA"} or (
                resized_image.mode == "P" and "transparency" in resized_image.info
            ):
                rgba_image = resized_image.convert("RGBA")
                output_image = Image.new("RGB", rgba_image.size, "white")
                output_image.paste(rgba_image, mask=rgba_image.getchannel("A"))
            else:
                output_image = resized_image.convert("RGB")

            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=os.path.dirname(preview_path),
                prefix=f".{os.path.basename(preview_path)}.",
                suffix=".tmp",
                delete=False,
            ) as temp_file:
                temp_path = temp_file.name
                output_image.save(
                    temp_file,
                    format="JPEG",
                    quality=MODEL_PREVIEW_QUALITY,
                    optimize=True,
                    progressive=True,
                )
            os.replace(temp_path, preview_path)
            temp_path = ""
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def create_model_preview(
    dest_path: str,
    metadata: Optional[Dict[str, Any]] = None,
    *,
    dependencies: Any = None,
) -> str:
    """Create adjacent preview media using LoRA Manager-compatible behavior."""
    dependencies = _require_dependencies(dependencies)
    existing_path = get_existing_model_preview_path(dest_path)
    source = metadata if isinstance(metadata, dict) else {}
    preview_url, media_type = _first_model_preview_asset(source)
    if not preview_url:
        return existing_path

    existing_type = _preview_media_type(existing_path) if existing_path else ""
    if existing_path and not (media_type == "video" and existing_type != "video"):
        return existing_path

    model_base_path, _model_ext = os.path.splitext(dest_path)
    if media_type == "video":
        source_extension = os.path.splitext(urlparse(preview_url).path)[1].lower()
        preview_extension = source_extension if source_extension in {".mp4", ".webm"} else ".mp4"
        preview_path = f"{model_base_path}{preview_extension}"
        attempts = []
        for candidate in (
            _rewrite_civitai_preview_url(preview_url, media_type),
            preview_url,
        ):
            if candidate and candidate not in attempts:
                attempts.append(candidate)

        for candidate in attempts:
            try:
                video_data = _download_preview_asset(
                    candidate,
                    media_type="video",
                    dependencies=dependencies,
                )
                _save_preview_video(video_data, preview_path)
                log.info(f"Video preview saved: {preview_path}")
                return preview_path
            except Exception as exc:
                log.warning(
                    "Could not download video preview "
                    f"for {get_filename_from_path(dest_path)} from {candidate}: {exc}"
                )
        return existing_path

    preview_path = f"{model_base_path}.jpeg"
    attempts = []
    for candidate in (
        _rewrite_civitai_preview_url(preview_url, media_type),
        preview_url,
    ):
        if candidate and candidate not in attempts:
            attempts.append(candidate)
    for candidate in attempts:
        try:
            image_data = _download_preview_image(
                candidate,
                dependencies=dependencies,
            )
            if not image_data:
                continue
            _save_optimized_jpeg(image_data, preview_path)
            log.info(f"Preview saved: {preview_path}")
            return preview_path
        except Exception as exc:
            log.warning(
                "Could not create image preview "
                f"for {get_filename_from_path(dest_path)} from {candidate}: {exc}"
            )
    return existing_path

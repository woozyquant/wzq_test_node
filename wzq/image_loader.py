"""Interactive multi-image loader for the WZQ custom-node package."""

from __future__ import annotations

import base64
import hashlib
import io
import os
from pathlib import Path

import numpy as np
import torch
from aiohttp import web
from PIL import Image, ImageOps

import folder_paths
import node_helpers
from server import PromptServer


IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg", ".avif"
}
THUMB_SIZE = 512
_thumb_dir: str | None = None


def _directory(source: str) -> str:
    getters = {
        "input": folder_paths.get_input_directory,
        "output": folder_paths.get_output_directory,
        "temp": folder_paths.get_temp_directory,
    }
    directory = getters[source]()
    if not directory:
        directory = os.path.join(getattr(folder_paths, "models_dir", os.getcwd()), source)
    os.makedirs(directory, exist_ok=True)
    return os.path.abspath(directory)


def _normalise_annotation(name: str) -> str:
    name = (name or "").strip()
    for suffix in ("[input]", "[output]", "[temp]"):
        if name.endswith(suffix) and not name.endswith(" " + suffix):
            return name[: -len(suffix)] + " " + suffix
    return name


def _strip_annotation(name: str) -> tuple[str, str]:
    name = _normalise_annotation(name)
    for source in ("input", "output", "temp"):
        suffix = f" [{source}]"
        if name.endswith(suffix):
            return name[: -len(suffix)], source
    return name, "input"


def _safe_file(source: str, relative_name: str) -> str | None:
    base = _directory(source)
    candidate = os.path.abspath(os.path.join(base, relative_name.replace("/", os.sep)))
    try:
        if os.path.commonpath((base, candidate)) != base:
            return None
    except ValueError:
        return None
    return candidate


def _safe_folder(source: str, relative_folder: str) -> str | None:
    base = os.path.realpath(_directory(source))
    relative_folder = (relative_folder or "").replace("/", os.sep)
    candidate = os.path.realpath(os.path.join(base, relative_folder))
    try:
        if os.path.commonpath((base, candidate)) != base:
            return None
    except ValueError:
        return None
    return candidate if os.path.isdir(candidate) else None


def _annotated_path(name: str) -> str | None:
    name = _normalise_annotation(name)
    try:
        path = folder_paths.get_annotated_filepath(name)
    except Exception:
        relative_name, source = _strip_annotation(name)
        path = _safe_file(source, relative_name)
    return path if path and os.path.isfile(path) else None


def _thumb_cache() -> str:
    global _thumb_dir
    if _thumb_dir is None:
        _thumb_dir = os.path.join(_directory("temp"), "wzq_image_loader_thumbs")
        os.makedirs(_thumb_dir, exist_ok=True)
    return _thumb_dir


def _routes():
    """Use ComfyUI routes, with a no-op fallback for import-time tooling/tests."""
    instance = getattr(PromptServer, "instance", None)
    if instance is not None:
        return instance.routes

    class _FallbackRoutes:
        def get(self, _path):
            return lambda handler: handler

        def post(self, _path):
            return lambda handler: handler

    return _FallbackRoutes()


routes = _routes()


@routes.get("/wzq/image-loader/files")
async def wzq_image_loader_files(request):
    source = request.rel_url.query.get("source", "input")
    if source not in ("input", "output"):
        return web.json_response({"error": "invalid source"}, status=400)
    base = _directory(source)
    requested_folder = request.rel_url.query.get("folder", "").strip("/\\")
    current = _safe_folder(source, requested_folder)
    if current is None:
        return web.json_response({"error": "invalid folder"}, status=400)

    current_folder = os.path.relpath(current, base).replace("\\", "/")
    if current_folder == ".":
        current_folder = ""
    folders = []
    files = []
    try:
        entries = list(os.scandir(current))
    except OSError as error:
        return web.json_response({"error": str(error)}, status=500)

    for entry in entries:
        relative_name = os.path.relpath(entry.path, base).replace("\\", "/")
        try:
            if entry.is_dir(follow_symlinks=False):
                folders.append({"name": entry.name, "path": relative_name})
                continue
            if not entry.is_file(follow_symlinks=False):
                continue
            if Path(entry.name).suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            stat = entry.stat(follow_symlinks=False)
            files.append({
                "name": relative_name,
                "display_name": entry.name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
        except OSError:
            continue

    folders.sort(key=lambda item: item["name"].lower())
    files.sort(key=lambda item: (-item["mtime"], item["name"].lower()))
    parent = current_folder.rsplit("/", 1)[0] if "/" in current_folder else ""
    return web.json_response({
        "folder": current_folder,
        "parent": parent,
        "folders": folders,
        "files": files,
    })


@routes.get("/wzq/image-loader/thumb")
async def wzq_image_loader_thumb(request):
    name = _normalise_annotation(request.rel_url.query.get("name", ""))
    # All previews share one cache entry: longest edge 512 px, aspect ratio preserved.
    size = THUMB_SIZE
    path = _annotated_path(name)
    if not path:
        return web.Response(text="image not found", status=404)

    stat = os.stat(path)
    digest = hashlib.sha256(f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{size}".encode()).hexdigest()
    cache_path = os.path.join(_thumb_cache(), digest + ".jpg")
    if request.headers.get("If-None-Match") == digest:
        return web.Response(status=304)
    try:
        if os.path.isfile(cache_path):
            with open(cache_path, "rb") as handle:
                data = handle.read()
        else:
            image = node_helpers.pillow(Image.open, path)
            image = ImageOps.exif_transpose(image)
            if getattr(image, "n_frames", 1) > 1:
                image.seek(0)
            image = image.convert("RGB")
            image.thumbnail((size, size), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=88)
            data = buffer.getvalue()
            with open(cache_path, "wb") as handle:
                handle.write(data)
    except Exception as error:
        return web.Response(text=str(error), status=500)
    return web.Response(
        body=data,
        content_type="image/jpeg",
        headers={"Cache-Control": "no-cache", "ETag": digest},
    )


@routes.post("/wzq/image-loader/delete")
async def wzq_image_loader_delete(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    source = payload.get("source", "input")
    if source not in ("input", "output"):
        return web.json_response({"error": "invalid source"}, status=400)
    deleted, errors = [], []
    for name in payload.get("files", []):
        path = _safe_file(source, str(name))
        if not path:
            errors.append(f"{name}: invalid path")
            continue
        try:
            os.remove(path)
            deleted.append(name)
        except OSError as error:
            errors.append(f"{name}: {error}")
    return web.json_response({"deleted": deleted, "errors": errors})


def _load_tensor(name: str) -> torch.Tensor | None:
    path = _annotated_path(name)
    if not path:
        return None
    try:
        image = node_helpers.pillow(Image.open, path)
        image = ImageOps.exif_transpose(image)
        if getattr(image, "n_frames", 1) > 1:
            image.seek(0)
        array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
        return torch.from_numpy(array).unsqueeze(0)
    except Exception as error:
        print(f"[WZQ Image Loader] Failed to load {name!r}: {error}")
        return None


def _decode_mask(mask_data: str, height: int, width: int) -> torch.Tensor:
    if not mask_data:
        return torch.zeros((height, width), dtype=torch.float32)
    try:
        encoded = mask_data.split(",", 1)[1] if mask_data.startswith("data:") else mask_data
        image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("L")
        if image.size != (width, height):
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        return torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)
    except Exception as error:
        print(f"[WZQ Image Loader] Failed to decode mask: {error}")
        return torch.zeros((height, width), dtype=torch.float32)


class WZQImageLoader:
    """Load one or more images selected by the accompanying gallery widget."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_list": ("STRING", {"default": "", "multiline": True}),
                "index": ("INT", {"default": 0, "min": 0, "max": 999999}),
                "batch_mode": ("BOOLEAN", {"default": True}),
            },
            "hidden": {
                "mask_data": ("STRING", {"default": ""}),
                "upload_mode": ("STRING", {"default": "append"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("图像", "单图", "遮罩")
    OUTPUT_IS_LIST = (True, False, False)
    FUNCTION = "load_images"
    CATEGORY = "WZQ/图像"

    def load_images(self, image_list, index, batch_mode, mask_data="", upload_mode="append"):
        del upload_mode
        names = [_normalise_annotation(name) for name in (image_list or "").splitlines() if name.strip()]
        images = [image for name in names if (image := _load_tensor(name)) is not None]
        if not images:
            empty_image = torch.zeros((1, 1, 1, 3), dtype=torch.float32)
            empty_mask = torch.zeros((1, 1), dtype=torch.float32)
            return ([], empty_image, empty_mask)

        selected = max(0, min(int(index), len(images) - 1))
        selected_image = images[selected]
        if not batch_mode:
            _, height, width, _ = images[selected].shape
            return (images, selected_image, _decode_mask(mask_data, height, width))

        max_height = max(image.shape[1] for image in images)
        max_width = max(image.shape[2] for image in images)
        fitted = []
        for image in images:
            _, height, width, _ = image.shape
            if (height, width) == (max_height, max_width):
                fitted.append(image)
                continue
            scale = max(max_height / height, max_width / width)
            resized_width = max(max_width, round(width * scale))
            resized_height = max(max_height, round(height * scale))
            pil = Image.fromarray((image[0].numpy() * 255).round().astype(np.uint8))
            pil = pil.resize((resized_width, resized_height), Image.Resampling.LANCZOS)
            left = (resized_width - max_width) // 2
            top = (resized_height - max_height) // 2
            pil = pil.crop((left, top, left + max_width, top + max_height))
            fitted.append(torch.from_numpy(np.asarray(pil, dtype=np.float32) / 255.0).unsqueeze(0))

        return (
            [torch.cat(fitted, dim=0)],
            selected_image,
            _decode_mask(mask_data, max_height, max_width),
        )


NODE_CLASS_MAPPINGS = {"WZQImageLoader": WZQImageLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"WZQImageLoader": "WZQ 图像加载器"}

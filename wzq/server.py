"""
Wzq test node 服务端路由。

提供 lora 文件大小等信息查询，供前端 info dialog 使用。
"""

import asyncio
import hashlib
import ipaddress
import mimetypes
import os
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse

import aiohttp
from aiohttp import web
from server import PromptServer
import folder_paths


_MEDIA_CACHE_LOCKS = {}
_MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024
_MEDIA_EXTENSIONS = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


def _media_cache_dir() -> Path:
    """Return a persistent cache directory outside the LoRA model folders."""
    get_user_directory = getattr(folder_paths, "get_user_directory", None)
    root = Path(get_user_directory()) if callable(get_user_directory) else Path(__file__).resolve().parent.parent
    cache_dir = root / "wzq_test_node" / "lora_media_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def _cached_media_path(cache_key: str):
    for path in _media_cache_dir().glob(f"{cache_key}.*"):
        if path.is_file() and not path.name.endswith(".part"):
            return path
    return None


def _is_public_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified
    )


async def _validate_remote_media_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise web.HTTPBadRequest(text="Only HTTP(S) media URLs are supported.")
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo, parsed.hostname, parsed.port, type=socket.SOCK_STREAM
        )
    except OSError as error:
        raise web.HTTPBadGateway(text="Unable to resolve the media host.") from error
    if not addresses or any(not _is_public_address(item[4][0]) for item in addresses):
        raise web.HTTPForbidden(text="Local or private media hosts are not allowed.")


def _media_extension(url: str, content_type: str) -> str:
    extension = _MEDIA_EXTENSIONS.get(content_type)
    if extension:
        return extension
    url_extension = Path(urlparse(url).path).suffix.lower()
    if url_extension in set(_MEDIA_EXTENSIONS.values()):
        return url_extension
    return mimetypes.guess_extension(content_type) or ".bin"


def _media_file_response(path: Path):
    return web.FileResponse(
        path, headers={"Cache-Control": "public, max-age=31536000, immutable"}
    )


@PromptServer.instance.routes.get("/wzq/api/loras")
async def api_get_loras(request):
    """Return the current LoRA list for the dynamic loader UI."""
    return web.json_response({"loras": folder_paths.get_filename_list("loras")})


@PromptServer.instance.routes.get("/wzq/api/lora_size")
async def api_get_lora_size(request):
    """返回 lora 文件的大小（字节数）。

    通过 query 参数 `file` 指定 lora 名称（与 ComfyUI 的 lora_name 一致）。
    """
    file_param = request.rel_url.query.get("file")
    if not file_param:
        return web.json_response({"status": 400, "error": "Missing 'file' parameter."}, status=400)

    file_path = folder_paths.get_full_path("loras", file_param)
    if not file_path or not os.path.isfile(file_path):
        return web.json_response(
            {"status": 404, "error": f"LoRA file not found: {file_param}"}, status=404
        )

    try:
        size_bytes = os.path.getsize(file_path)
    except OSError as e:
        return web.json_response({"status": 500, "error": str(e)}, status=500)

    return web.json_response({"status": 200, "file": file_param, "sizeBytes": size_bytes})


@PromptServer.instance.routes.get("/wzq/api/lora_media")
async def api_get_lora_media(request):
    """Serve remote LoRA preview media from a persistent, URL-keyed disk cache."""
    url = request.rel_url.query.get("url", "").strip()
    if not url:
        raise web.HTTPBadRequest(text="Missing 'url' parameter.")

    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    cached_path = _cached_media_path(cache_key)
    if cached_path:
        return _media_file_response(cached_path)

    lock = _MEDIA_CACHE_LOCKS.setdefault(cache_key, asyncio.Lock())
    async with lock:
        cached_path = _cached_media_path(cache_key)
        if cached_path:
            return _media_file_response(cached_path)

        timeout = aiohttp.ClientTimeout(total=300, connect=60, sock_read=120)
        try:
            # Match browser/ComfyUI networking on systems that require an HTTP(S) proxy.
            async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
                current_url = url
                response = None
                for _ in range(6):
                    await _validate_remote_media_url(current_url)
                    response = await session.get(
                        current_url,
                        allow_redirects=False,
                        headers={
                            "Accept": "image/*,video/*;q=0.9,*/*;q=0.1",
                            "User-Agent": "ComfyUI-wzq-test-node/1.0",
                        },
                    )
                    if response.status not in {301, 302, 303, 307, 308}:
                        break
                    location = response.headers.get("Location")
                    response.release()
                    if not location:
                        raise web.HTTPBadGateway(text="Media redirect has no destination.")
                    current_url = urljoin(current_url, location)
                else:
                    raise web.HTTPBadGateway(text="Too many media redirects.")

                async with response:
                    response.raise_for_status()
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                    if not content_type.startswith(("image/", "video/")):
                        raise web.HTTPUnsupportedMediaType(
                            text=f"Unsupported preview media type: {content_type or 'unknown'}"
                        )
                    if response.content_length and response.content_length > _MEDIA_CACHE_MAX_BYTES:
                        raise web.HTTPRequestEntityTooLarge(
                            max_size=_MEDIA_CACHE_MAX_BYTES, actual_size=response.content_length
                        )

                    destination = _media_cache_dir() / (
                        cache_key + _media_extension(str(response.url), content_type)
                    )
                    temporary = destination.with_suffix(destination.suffix + ".part")
                    size = 0
                    try:
                        with temporary.open("wb") as output:
                            async for chunk in response.content.iter_chunked(256 * 1024):
                                size += len(chunk)
                                if size > _MEDIA_CACHE_MAX_BYTES:
                                    raise web.HTTPRequestEntityTooLarge(
                                        max_size=_MEDIA_CACHE_MAX_BYTES, actual_size=size
                                    )
                                output.write(chunk)
                        os.replace(temporary, destination)
                    finally:
                        if temporary.exists():
                            temporary.unlink()
        except web.HTTPException:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as error:
            raise web.HTTPBadGateway(text=f"Unable to cache LoRA preview media: {error}") from error
        finally:
            _MEDIA_CACHE_LOCKS.pop(cache_key, None)

        return _media_file_response(destination)

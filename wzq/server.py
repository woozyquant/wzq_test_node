"""
Wzq test node 服务端路由。

提供 lora 文件大小等信息查询，供前端 info dialog 使用。
"""

import os
from aiohttp import web
from server import PromptServer
import folder_paths


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

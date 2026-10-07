"""Folder shortcuts operated directly from the node's frontend panel."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

from . import categories


def _directory(value):
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise ValueError("请输入有效的文件夹路径。")
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    path = Path(os.path.expandvars(os.path.expanduser(value)))
    if not path.is_absolute():
        raise ValueError("请填写文件夹的绝对路径。")
    path = path.resolve()
    if not path.is_dir():
        raise FileNotFoundError("文件夹不存在，或该路径指向文件。")
    return path


def _open_directory(path):
    directory = os.fspath(path)
    if sys.platform == "win32":
        os.startfile(directory, "open")
    else:
        command = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([command, directory])


@PromptServer.instance.routes.get("/wzq/folder-shortcuts/defaults")
async def folder_shortcuts_defaults(request):
    return web.json_response({"items": [
        {"name": "输出文件夹", "path": folder_paths.get_output_directory()},
        {"name": "输入素材", "path": folder_paths.get_input_directory()},
        {"name": "模型目录", "path": folder_paths.models_dir},
        {"name": "插件目录", "path": os.fspath(Path(__file__).resolve().parent.parent)},
    ]})


@PromptServer.instance.routes.post("/wzq/folder-shortcuts/open")
async def folder_shortcuts_open(request):
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise ValueError("请求内容必须是 JSON 对象。")
        path = await asyncio.to_thread(_directory, payload.get("path"))
        await asyncio.to_thread(_open_directory, path)
        return web.json_response({"status": "ok", "path": os.fspath(path)})
    except (ValueError, TypeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=404)
    except (OSError, RuntimeError) as error:
        return web.json_response({"error": f"打开文件夹失败：{error}"}, status=500)


class WZQFolderShortcuts:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    CATEGORY = categories.TOOLS
    DESCRIPTION = "点击按钮打开本机文件夹；在管理路径中配置按钮，配置随工作流保存。"

    def execute(self):
        return ()

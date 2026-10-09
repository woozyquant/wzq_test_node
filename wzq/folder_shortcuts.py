"""Folder shortcuts operated directly from the node's frontend panel."""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import folder_paths
from aiohttp import web
from server import PromptServer

from . import categories


CONFIG_PATH = Path(__file__).resolve().parent.parent / "folder_shortcuts.json"
_config_lock = threading.Lock()


def _resolve_path(value):
    if not isinstance(value, str) or not value.strip() or "\0" in value:
        raise ValueError("请输入有效的文件夹路径。")
    value = value.strip()
    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1]
    if not value.strip() or "://" in value:
        raise ValueError("请输入有效的文件夹路径。")
    path = Path(os.path.expandvars(os.path.expanduser(value)))
    if not path.is_absolute():
        path = Path(folder_paths.base_path) / path
    return path


def _directory(value):
    path = _resolve_path(value).resolve()
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


def _default_config():
    return {"items": [
        {"name": "输出文件夹", "path": folder_paths.get_output_directory()},
        {"name": "输入素材", "path": folder_paths.get_input_directory()},
        {"name": "模型目录", "path": folder_paths.models_dir},
        {"name": "插件目录", "path": os.fspath(Path(__file__).resolve().parent.parent)},
    ]}


def _validate_config(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("JSON 必须是包含 items 数组的对象。")
    items = []
    for index, item in enumerate(payload["items"], 1):
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            raise ValueError(f"第 {index} 条路径缺少按钮名称。")
        _resolve_path(item.get("path"))
        items.append({"name": item["name"].strip(), "path": item["path"].strip()})
    return {"items": items}


def _write_config(config):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=CONFIG_PATH.parent,
            prefix=".folder_shortcuts-", suffix=".tmp", delete=False,
        ) as output:
            temporary = Path(output.name)
            json.dump(config, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, CONFIG_PATH)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _load_config():
    with _config_lock:
        if not CONFIG_PATH.exists():
            config = _default_config()
            _write_config(config)
            return config
        return _validate_config(json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig")))


def _save_config(payload):
    config = _validate_config(payload)
    with _config_lock:
        _write_config(config)
    return config


@PromptServer.instance.routes.get("/wzq/folder-shortcuts/config")
async def folder_shortcuts_config(request):
    try:
        config = await asyncio.to_thread(_load_config)
        return web.json_response({**config, "config_path": os.fspath(CONFIG_PATH)})
    except (ValueError, OSError) as error:
        return web.json_response({"error": f"读取 folder_shortcuts.json 失败：{error}"}, status=500)


@PromptServer.instance.routes.post("/wzq/folder-shortcuts/config")
async def folder_shortcuts_save(request):
    try:
        config = await asyncio.to_thread(_save_config, await request.json())
        return web.json_response({**config, "config_path": os.fspath(CONFIG_PATH)})
    except (ValueError, TypeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except OSError as error:
        return web.json_response({"error": f"保存 folder_shortcuts.json 失败：{error}"}, status=500)


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
    DESCRIPTION = "点击按钮打开本机文件夹；相对路径以 ComfyUI 基础目录为准。用户配置保存至插件目录的 folder_shortcuts.json。"

    def execute(self):
        return ()

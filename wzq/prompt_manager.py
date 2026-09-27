"""Prompt library node and local prompt-file API.

The library lives in ``<custom-node>/prompts``.  Every subdirectory is exposed
as a category and supported text files inside it are exposed as saved prompts.
All path handling is deliberately rooted in that directory so requests cannot
read or write arbitrary files on the ComfyUI host.
"""

from __future__ import annotations

import asyncio
import os
import re
import threading
import uuid
from pathlib import Path, PurePosixPath

from aiohttp import web
from server import PromptServer

from . import categories


PROMPTS_ROOT = Path(__file__).resolve().parent.parent / "prompts"
PROMPT_EXTENSIONS = {".txt", ".md", ".prompt"}
MAX_PROMPT_BYTES = 2 * 1024 * 1024
MAX_NAME_LENGTH = 128
_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_write_lock = threading.RLock()
_index_lock = threading.RLock()
_index_cache: dict | None = None


def _ensure_prompt_root() -> Path:
    PROMPTS_ROOT.mkdir(parents=True, exist_ok=True)
    return PROMPTS_ROOT


def _safe_path(relative_path: str, *, require_file: bool = False) -> Path:
    """Resolve a browser-supplied POSIX path under ``PROMPTS_ROOT``."""
    raw = str(relative_path or "").strip().replace("\\", "/")
    pure = PurePosixPath(raw)
    if not raw or pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("无效的提示词路径。")

    root = _ensure_prompt_root().resolve()
    candidate = root.joinpath(*pure.parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("提示词路径超出了 prompts 目录。") from error

    if require_file and candidate.suffix.lower() not in PROMPT_EXTENSIONS:
        raise ValueError("仅支持 .txt、.md 和 .prompt 文件。")
    return candidate


def _category_path(relative_path: str) -> Path:
    raw = str(relative_path or "").strip().replace("\\", "/")
    if not raw:
        return _ensure_prompt_root().resolve()
    return _safe_path(raw)


def _prompt_name(raw_name: str, default_suffix: str = ".txt") -> str:
    name = str(raw_name or "").strip()
    if not name:
        raise ValueError("请输入提示词名称。")
    if name.startswith("."):
        raise ValueError("提示词名称不能以句点开头。")
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"提示词名称不能超过 {MAX_NAME_LENGTH} 个字符。")
    if _INVALID_NAME.search(name) or name in {".", ".."}:
        raise ValueError("提示词名称包含无效字符。")

    path = Path(name)
    suffix = path.suffix.lower()
    if suffix and suffix not in PROMPT_EXTENSIONS:
        raise ValueError("文件扩展名必须是 .txt、.md 或 .prompt。")
    stem = path.stem if suffix else name
    if stem.rstrip(" .").upper() in _WINDOWS_RESERVED_NAMES:
        raise ValueError("该名称是系统保留名称，请换一个名称。")
    if name.endswith((" ", ".")):
        raise ValueError("提示词名称不能以空格或句点结尾。")
    return name if suffix else f"{name}{default_suffix}"


def _display_name(path: Path) -> str:
    return path.stem if path.suffix.lower() in PROMPT_EXTENSIONS else path.name


def _relative(path: Path) -> str:
    return path.relative_to(_ensure_prompt_root()).as_posix()


def _scan_library() -> dict:
    root = _ensure_prompt_root()
    directories: list[Path] = []
    files_by_directory: dict[Path, list[Path]] = {}
    pending = [root]

    # DirEntry caches file-type information, avoiding the repeated Path.stat()
    # calls produced by rglob + a second iterdir pass over every directory.
    while pending:
        directory = pending.pop()
        child_directories: list[Path] = []
        prompt_files: list[Path] = []
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.startswith(".") or entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    child_directories.append(Path(entry.path))
                elif (
                    entry.is_file(follow_symlinks=False)
                    and Path(entry.name).suffix.lower() in PROMPT_EXTENSIONS
                ):
                    prompt_files.append(Path(entry.path))
        child_directories.sort(key=lambda path: path.name.casefold(), reverse=True)
        prompt_files.sort(key=lambda path: path.name.casefold())
        pending.extend(child_directories)
        directories.extend(child_directories)
        files_by_directory[directory] = prompt_files

    directories.sort(key=lambda path: _relative(path).casefold())
    categories_payload = []
    for directory in directories:
        relative = _relative(directory)
        files = files_by_directory.get(directory, [])
        categories_payload.append(
            {
                "name": directory.name,
                "path": relative,
                "depth": len(PurePosixPath(relative).parts) - 1,
                "prompts": [
                    {
                        "name": _display_name(path),
                        "filename": path.name,
                        "path": _relative(path),
                    }
                    for path in files
                ],
            }
        )

    root_files = files_by_directory.get(root, [])
    if root_files:
        categories_payload.insert(
            0,
            {
                "name": "未分类",
                "path": "",
                "depth": 0,
                "prompts": [
                    {
                        "name": _display_name(path),
                        "filename": path.name,
                        "path": _relative(path),
                    }
                    for path in root_files
                ],
            },
        )
    return {"categories": categories_payload}


def _library_payload(force_refresh: bool = False) -> dict:
    global _index_cache
    with _index_lock:
        if _index_cache is None or force_refresh:
            _index_cache = _scan_library()
        return _index_cache


def _cache_saved_prompt(path: Path) -> None:
    """Update an existing cached category without rescanning the filesystem."""
    global _index_cache
    relative_path = _relative(path)
    category_path = _relative(path.parent) if path.parent != _ensure_prompt_root() else ""
    prompt = {
        "name": _display_name(path),
        "filename": path.name,
        "path": relative_path,
    }
    with _index_lock:
        if _index_cache is None:
            return
        for category in _index_cache.get("categories", []):
            if category.get("path") != category_path:
                continue
            prompts = category.setdefault("prompts", [])
            prompts[:] = [item for item in prompts if item.get("path") != relative_path]
            prompts.append(prompt)
            prompts.sort(key=lambda item: str(item.get("filename", "")).casefold())
            return
        # This is only expected for root-level files when the uncategorized
        # entry did not exist at the time the cache was built.
        if not category_path:
            _index_cache.setdefault("categories", []).insert(
                0,
                {"name": "未分类", "path": "", "depth": 0, "prompts": [prompt]},
            )


def _cache_renamed_prompt(source: Path, destination: Path) -> None:
    """Replace a renamed prompt in the cached category."""
    global _index_cache
    source_path = _relative(source)
    destination_path = _relative(destination)
    category_path = _relative(destination.parent) if destination.parent != _ensure_prompt_root() else ""
    with _index_lock:
        if _index_cache is None:
            return
        for category in _index_cache.get("categories", []):
            if category.get("path") != category_path:
                continue
            prompts = category.setdefault("prompts", [])
            for prompt in prompts:
                if prompt.get("path") != source_path:
                    continue
                prompt.update(
                    {
                        "name": _display_name(destination),
                        "filename": destination.name,
                        "path": destination_path,
                    }
                )
                prompts.sort(key=lambda item: str(item.get("filename", "")).casefold())
                return
        _index_cache = None


def _error(message: str, status: int = 400):
    return web.json_response({"error": message}, status=status)


@PromptServer.instance.routes.get("/wzq/prompt-manager/list")
async def prompt_manager_list(_request):
    try:
        force_refresh = _request.rel_url.query.get("refresh") == "1"
        payload = await asyncio.to_thread(_library_payload, force_refresh)
        return web.json_response(payload)
    except OSError as error:
        return _error(f"读取提示词目录失败：{error}", 500)


@PromptServer.instance.routes.get("/wzq/prompt-manager/read")
async def prompt_manager_read(request):
    try:
        path = _safe_path(request.rel_url.query.get("path", ""), require_file=True)
        if not path.is_file():
            return _error("提示词文件不存在。", 404)
        if path.stat().st_size > MAX_PROMPT_BYTES:
            return _error("提示词文件过大。", 413)
        content = path.read_text(encoding="utf-8-sig")
        return web.json_response(
            {
                "path": _relative(path),
                "name": _display_name(path),
                "category": _relative(path.parent) if path.parent != _ensure_prompt_root() else "",
                "content": content,
            }
        )
    except ValueError as error:
        return _error(str(error))
    except UnicodeDecodeError:
        return _error("提示词文件不是有效的 UTF-8 文本。", 422)
    except OSError as error:
        return _error(f"读取提示词失败：{error}", 500)


@PromptServer.instance.routes.post("/wzq/prompt-manager/save")
async def prompt_manager_save(request):
    try:
        payload = await request.json()
    except Exception:
        return _error("请求内容必须是 JSON。")
    if not isinstance(payload, dict):
        return _error("请求内容必须是 JSON 对象。")

    try:
        category = str(payload.get("category", "")).strip().replace("\\", "/")
        directory = _category_path(category)
        if not directory.is_dir():
            return _error("所选分类不存在，请刷新提示词列表。", 404)

        filename = _prompt_name(payload.get("name", ""))
        destination = directory / filename
        destination = _safe_path(_relative(destination), require_file=True)
        content = str(payload.get("content", ""))
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_PROMPT_BYTES:
            return _error("提示词内容过大。", 413)

        overwrite = bool(payload.get("overwrite", False))
        with _write_lock:
            if destination.exists() and not overwrite:
                return web.json_response(
                    {"error": "同名提示词已存在。", "exists": True, "path": _relative(destination)},
                    status=409,
                )
            temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
            try:
                temporary.write_bytes(encoded)
                os.replace(temporary, destination)
            finally:
                if temporary.exists():
                    temporary.unlink()

        await asyncio.to_thread(_cache_saved_prompt, destination)

        return web.json_response(
            {
                "status": "ok",
                "path": _relative(destination),
                "name": _display_name(destination),
                "category": category,
            }
        )
    except ValueError as error:
        return _error(str(error))
    except OSError as error:
        return _error(f"保存提示词失败：{error}", 500)


@PromptServer.instance.routes.post("/wzq/prompt-manager/rename")
async def prompt_manager_rename(request):
    try:
        payload = await request.json()
    except Exception:
        return _error("请求内容必须是 JSON。")
    if not isinstance(payload, dict):
        return _error("请求内容必须是 JSON 对象。")

    try:
        source = _safe_path(payload.get("path", ""), require_file=True)
        if not source.is_file():
            return _error("提示词文件不存在。", 404)

        filename = _prompt_name(payload.get("name", ""), source.suffix)
        destination = _safe_path(_relative(source.with_name(filename)), require_file=True)
        source_text = os.fspath(source)
        destination_text = os.fspath(destination)
        same_filesystem_path = os.path.normcase(source_text) == os.path.normcase(destination_text)

        if source_text != destination_text:
            with _write_lock:
                if destination.exists() and not same_filesystem_path:
                    return web.json_response(
                        {"error": "同名提示词已存在。", "exists": True, "path": _relative(destination)},
                        status=409,
                    )
                if same_filesystem_path:
                    temporary = source.with_name(f".{source.name}.{uuid.uuid4().hex}.rename")
                    os.replace(source, temporary)
                    try:
                        os.replace(temporary, destination)
                    except OSError:
                        if temporary.exists() and not source.exists():
                            os.replace(temporary, source)
                        raise
                else:
                    os.replace(source, destination)

        await asyncio.to_thread(_cache_renamed_prompt, source, destination)
        category = _relative(destination.parent) if destination.parent != _ensure_prompt_root() else ""
        return web.json_response(
            {
                "status": "ok",
                "path": _relative(destination),
                "name": _display_name(destination),
                "category": category,
            }
        )
    except ValueError as error:
        return _error(str(error))
    except OSError as error:
        return _error(f"重命名提示词失败：{error}", 500)


class WZQPromptManager:
    """Edit a prompt and reuse text snippets stored under ``prompts/``."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": True,
                    },
                )
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("提示词",)
    FUNCTION = "output_prompt"
    CATEGORY = categories.TEXT
    DESCRIPTION = "管理 prompts 子目录中的提示词文件，并输出当前编辑内容。"
    OUTPUT_TOOLTIPS = ("当前提示词文本。",)

    def output_prompt(self, prompt):
        return (str(prompt or ""),)


_ensure_prompt_root()

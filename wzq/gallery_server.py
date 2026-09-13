"""Local LoRA Gallery 服务端。

前端的 ``js/Local_Lora_Only_Gallery.js`` 依赖一组 ``/localloragallery/*`` 接口
（列出 LoRA、标签、预设、UI 状态、元数据、Civitai 同步、预览图）。这些接口在本
仓库中原本并不存在，导致节点初始化时 ``get_loras`` 返回空 body、前端
``response.json()`` 解析失败，图库永远不显示任何 LoRA。本模块补齐这套后端。

前端契约（与 js/Local_Lora_Only_Gallery.js 对应）：

- ``GET  /localloragallery/get_loras``      -> {loras, folders, total_pages, current_page}
- ``GET  /localloragallery/get_all_tags``   -> {tags}
- ``GET  /localloragallery/get_presets``    -> {name: [stack...]}          （直接是预设字典）
- ``GET  /localloragallery/get_ui_state``   -> {lora_stack, filter_tag, filter_mode, filter_folder, is_collapsed}
- ``POST /localloragallery/set_ui_state``   -> {status}
- ``POST /localloragallery/update_metadata``-> {status}
- ``POST /localloragallery/save_preset``    -> {presets}
- ``POST /localloragallery/delete_preset``  -> {presets}
- ``POST /localloragallery/sync_civitai``   -> {status, metadata}
- ``GET  /localloragallery/preview``        -> 本地 LoRA 同目录的预览图/视频

持久化：``<user>/wzq_test_node/lora_gallery.json``，与模型目录分离，避免污染 LoRA 目录。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from aiohttp import web
from server import PromptServer
import folder_paths


PAGE_SIZE = 60
PREVIEW_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm")
VIDEO_EXTENSIONS = {".mp4", ".webm"}
CIVITAI_API = "https://civitai.com/api/v1"
MAX_HEADER_BYTES = 64 * 1024 * 1024

_store_lock = threading.RLock()


# --------------------------------------------------------------------------- #
# 持久化
# --------------------------------------------------------------------------- #

def _store_path() -> Path:
    get_user_directory = getattr(folder_paths, "get_user_directory", None)
    root = Path(get_user_directory()) if callable(get_user_directory) else Path(__file__).resolve().parent.parent
    directory = root / "wzq_test_node"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / "lora_gallery.json"


def _empty_store() -> dict:
    return {"metadata": {}, "presets": {}, "ui_state": {}}


def _load_store() -> dict:
    path = _store_path()
    if not path.is_file():
        return _empty_store()
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return _empty_store()
    if not isinstance(data, dict):
        return _empty_store()
    store = _empty_store()
    for key in store:
        if isinstance(data.get(key), dict):
            store[key] = data[key]
    return store


def _save_store(store: dict) -> None:
    path = _store_path()
    temporary = path.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, ensure_ascii=False, indent=1)
    os.replace(temporary, path)


def _mutate_store(mutator):
    """Read-modify-write under a lock so concurrent requests cannot clobber each other."""
    with _store_lock:
        store = _load_store()
        result = mutator(store)
        _save_store(store)
        return result


# --------------------------------------------------------------------------- #
# LoRA 扫描与元数据
# --------------------------------------------------------------------------- #

def _list_lora_names() -> list[str]:
    try:
        return list(folder_paths.get_filename_list("loras"))
    except Exception:
        return []


def _preview_candidates(relative_path: str) -> list[str]:
    """Return existing preview file names next to a LoRA, best match first."""
    full_path = folder_paths.get_full_path("loras", relative_path)
    if not full_path:
        return []
    stem = Path(full_path).stem
    directory = Path(full_path).parent

    ordered: list[str] = []
    for extension in PREVIEW_EXTENSIONS:
        ordered.append(stem + extension)
        ordered.append(stem + ".preview" + extension)
    for extension in PREVIEW_EXTENSIONS:
        ordered.append("preview" + extension)

    result: list[str] = []
    for name in ordered:
        if name in result:
            continue
        if (directory / name).is_file():
            result.append(name)
    return result


def _read_safetensors_metadata(full_path: str) -> dict:
    """Parse the JSON header of a .safetensors file to read its embedded metadata.

    Format: 8-byte little-endian header length, then that many bytes of JSON with
    a ``__metadata__`` key. Any malformed file degrades to an empty dict.
    """
    try:
        with open(full_path, "rb") as handle:
            raw_length = handle.read(8)
            if len(raw_length) != 8:
                return {}
            header_length = int.from_bytes(raw_length, "little")
            if header_length <= 0 or header_length > MAX_HEADER_BYTES:
                return {}
            header = handle.read(header_length)
    except OSError:
        return {}
    try:
        parsed = json.loads(header.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    meta = parsed.get("__metadata__") if isinstance(parsed, dict) else None
    return meta if isinstance(meta, dict) else {}


def _embedded_metadata(relative_path: str) -> dict:
    """Read safetensors-embedded metadata (ss_tag_frequency etc.) when available."""
    full_path = folder_paths.get_full_path("loras", relative_path)
    if not full_path or Path(full_path).suffix.lower() != ".safetensors":
        return {}
    return _read_safetensors_metadata(full_path)


def _tags_from_embedded(meta: dict) -> list[str]:
    """Derive tag names from ss_tag_frequency, which maps tag -> {count: n}."""
    raw = meta.get("ss_tag_frequency")
    if not raw:
        return []
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, dict):
        return []
    counts: dict[str, float] = {}
    for bucket in parsed.values():
        if not isinstance(bucket, dict):
            continue
        for tag, count in bucket.items():
            try:
                counts[tag] = counts.get(tag, 0) + float(count)
            except (TypeError, ValueError):
                continue
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [tag for tag, _ in ordered[:30]]


def _normalise_tags(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,\n]", value)
    elif isinstance(value, (list, tuple, set)):
        parts = list(value)
    else:
        return []
    result = []
    for part in parts:
        tag = str(part).strip()
        if tag and tag not in result:
            result.append(tag)
    return result


def _folder_of(relative_path: str) -> str:
    parent = str(Path(relative_path).parent)
    if parent in (".", ""):
        return ""
    return parent.replace("\\", "/")


def _preview_route(relative_path: str, preview_name: str) -> str:
    query = urllib.parse.urlencode({"file": relative_path, "name": preview_name})
    return f"/localloragallery/preview?{query}"


def _build_entry(relative_path: str, metadata: dict) -> dict:
    entry = {
        "name": relative_path,
        "folder": _folder_of(relative_path),
        "tags": [],
        "trigger_words": "",
        "download_url": "",
        "preview_url": "",
        "preview_type": "none",
    }
    previews = _preview_candidates(relative_path)
    if previews:
        entry["preview_url"] = _preview_route(relative_path, previews[0])
        entry["preview_type"] = "video" if Path(previews[0]).suffix.lower() in VIDEO_EXTENSIONS else "image"

    stored = metadata.get(relative_path)
    if isinstance(stored, dict):
        if stored.get("tags") is not None:
            entry["tags"] = _normalise_tags(stored.get("tags"))
        if stored.get("trigger_words") is not None:
            entry["trigger_words"] = str(stored.get("trigger_words") or "")
        if stored.get("download_url") is not None:
            entry["download_url"] = str(stored.get("download_url") or "")
        if stored.get("preview_url"):
            entry["preview_url"] = str(stored["preview_url"])
            entry["preview_type"] = str(stored.get("preview_type") or "image")

    if not entry["tags"] or not entry["trigger_words"]:
        embedded = _embedded_metadata(relative_path)
        if embedded:
            if not entry["tags"]:
                entry["tags"] = _tags_from_embedded(embedded)
            if not entry["trigger_words"]:
                entry["trigger_words"] = str(embedded.get("ss_training_comment") or "")

    return entry


def _all_entries() -> list[dict]:
    store = _load_store()
    metadata = store["metadata"] if isinstance(store["metadata"], dict) else {}
    return [_build_entry(name, metadata) for name in _list_lora_names()]


# --------------------------------------------------------------------------- #
# 过滤与分页
# --------------------------------------------------------------------------- #

def _matches_tags(entry: dict, wanted: list[str], mode: str) -> bool:
    if not wanted:
        return True
    have = {tag.lower() for tag in entry.get("tags") or []}
    if mode == "AND":
        return all(tag.lower() in have for tag in wanted)
    return any(tag.lower() in have for tag in wanted)


def _parse_selected(request) -> list[str]:
    values = request.rel_url.query.getall("selected_loras", [])
    result = []
    for value in values:
        for part in str(value).split(","):
            name = part.strip()
            if name and name not in result:
                result.append(name)
    return result


# --------------------------------------------------------------------------- #
# 路由
# --------------------------------------------------------------------------- #

@PromptServer.instance.routes.get("/localloragallery/get_loras")
async def localloragallery_get_loras(request):
    query = request.rel_url.query
    filter_tag = _normalise_tags(query.get("filter_tag", ""))
    mode = (query.get("mode", "OR") or "OR").upper()
    folder = (query.get("folder", "") or "").replace("\\", "/").strip("/")
    name_filter = (query.get("name_filter", "") or "").strip().lower()
    try:
        page = max(1, int(query.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    selected = _parse_selected(request)

    def build():
        entries = _all_entries()
        folders = sorted({entry["folder"] for entry in entries if entry["folder"]})
        filtered = []
        selected_set = set(selected)
        for entry in entries:
            if folder and entry["folder"] != folder:
                continue
            if name_filter and name_filter not in entry["name"].lower():
                continue
            if not _matches_tags(entry, filter_tag, mode) and entry["name"] not in selected_set:
                continue
            filtered.append(entry)
        # 勾选中的 LoRA 永远排在最前，避免翻页后被过滤掉而"消失"
        filtered.sort(key=lambda item: (item["name"] not in selected_set, item["name"].lower()))
        total_pages = max(1, (len(filtered) + PAGE_SIZE - 1) // PAGE_SIZE)
        start = (page - 1) * PAGE_SIZE
        return {
            "loras": filtered[start:start + PAGE_SIZE],
            "folders": folders,
            "total_pages": total_pages,
            "current_page": page,
            "total": len(filtered),
        }

    try:
        return web.json_response(await asyncio.to_thread(build))
    except Exception as error:  # 返回 JSON 错误体，避免前端 json() 解析失败
        return web.json_response({"error": str(error)}, status=500)


@PromptServer.instance.routes.get("/localloragallery/preview")
async def localloragallery_preview(request):
    """Serve a preview file that sits next to a LoRA model."""
    relative = request.rel_url.query.get("file", "")
    name = request.rel_url.query.get("name", "")
    if not relative or not name:
        raise web.HTTPBadRequest(text="Missing 'file' or 'name' parameter.")
    if Path(name).name != name or "/" in name or "\\" in name:
        raise web.HTTPBadRequest(text="Invalid preview name.")

    def locate():
        full_path = folder_paths.get_full_path("loras", relative)
        if not full_path:
            return None
        candidate = Path(full_path).parent / name
        if not candidate.is_file():
            return None
        # 确认仍在 LoRA 目录内，避免路径穿越
        if Path(full_path).parent.resolve() != candidate.parent.resolve():
            return None
        return candidate

    path = await asyncio.to_thread(locate)
    if path is None:
        raise web.HTTPNotFound(text="Preview not found.")
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return web.FileResponse(path, headers={
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=3600",
    })


@PromptServer.instance.routes.get("/localloragallery/get_all_tags")
async def localloragallery_get_all_tags(request):
    def collect():
        counts: dict[str, int] = {}
        for entry in _all_entries():
            for tag in entry.get("tags") or []:
                counts[tag] = counts.get(tag, 0) + 1
        ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        return {"tags": [tag for tag, _ in ordered]}

    try:
        return web.json_response(await asyncio.to_thread(collect))
    except Exception as error:
        return web.json_response({"tags": [], "error": str(error)}, status=500)


@PromptServer.instance.routes.post("/localloragallery/update_metadata")
async def localloragallery_update_metadata(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="Invalid JSON body.")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="Body must be an object.")

    lora_name = str(body.get("lora_name") or "").strip()
    if not lora_name:
        raise web.HTTPBadRequest(text="Missing 'lora_name'.")

    payload = {key: value for key, value in body.items() if key != "lora_name"}
    if "tags" in payload:
        payload["tags"] = _normalise_tags(payload["tags"])

    def mutate(store: dict):
        entry = store["metadata"].get(lora_name)
        if not isinstance(entry, dict):
            entry = {}
            store["metadata"][lora_name] = entry
        entry.update(payload)
        return {"status": "ok"}

    return web.json_response(await asyncio.to_thread(_mutate_store, mutate))


@PromptServer.instance.routes.get("/localloragallery/get_presets")
async def localloragallery_get_presets(request):
    def read():
        presets = _load_store()["presets"]
        return presets if isinstance(presets, dict) else {}

    return web.json_response(await asyncio.to_thread(read))


@PromptServer.instance.routes.post("/localloragallery/save_preset")
async def localloragallery_save_preset(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="Invalid JSON body.")
    name = str((body or {}).get("name") or "").strip()
    if not name:
        raise web.HTTPBadRequest(text="Missing preset 'name'.")
    data = (body or {}).get("data")
    if not isinstance(data, list):
        data = []

    def mutate(store: dict):
        store["presets"][name] = data
        return {"presets": store["presets"]}

    return web.json_response(await asyncio.to_thread(_mutate_store, mutate))


@PromptServer.instance.routes.post("/localloragallery/delete_preset")
async def localloragallery_delete_preset(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="Invalid JSON body.")
    name = str((body or {}).get("name") or "").strip()

    def mutate(store: dict):
        store["presets"].pop(name, None)
        return {"presets": store["presets"]}

    return web.json_response(await asyncio.to_thread(_mutate_store, mutate))


@PromptServer.instance.routes.get("/localloragallery/get_ui_state")
async def localloragallery_get_ui_state(request):
    node_id = str(request.rel_url.query.get("node_id", ""))
    gallery_id = str(request.rel_url.query.get("gallery_id", ""))
    key = f"{node_id}:{gallery_id}"

    def read():
        default = {
            "lora_stack": [],
            "filter_tag": "",
            "filter_mode": "OR",
            "filter_folder": "",
            "is_collapsed": False,
        }
        state = _load_store()["ui_state"].get(key)
        if isinstance(state, dict):
            default.update(state)
        return default

    return web.json_response(await asyncio.to_thread(read))


@PromptServer.instance.routes.post("/localloragallery/set_ui_state")
async def localloragallery_set_ui_state(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="Invalid JSON body.")
    body = body or {}
    key = f"{body.get('node_id', '')}:{body.get('gallery_id', '')}"
    state = body.get("state")
    if not isinstance(state, dict):
        state = {}

    def mutate(store: dict):
        store["ui_state"][key] = state
        return {"status": "ok"}

    return web.json_response(await asyncio.to_thread(_mutate_store, mutate))


# --------------------------------------------------------------------------- #
# Civitai 同步（尽力而为：失败时返回 status=error，不抛异常）
# --------------------------------------------------------------------------- #

def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _civitai_request(url: str) -> dict:
    request = urllib.request.Request(url, headers={
        "User-Agent": "ComfyUI-wzq-test-node/1.0",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _civitai_metadata(relative_path: str) -> dict:
    full_path = folder_paths.get_full_path("loras", relative_path)
    if not full_path or not Path(full_path).is_file():
        raise FileNotFoundError(f"LoRA not found: {relative_path}")

    payload = None
    try:
        digest = _sha256_of(Path(full_path))
        payload = _civitai_request(f"{CIVITAI_API}/model-versions/by-hash/{digest}")
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    if not payload:
        stem = Path(relative_path).stem
        search = urllib.parse.quote(stem)
        listing = _civitai_request(f"{CIVITAI_API}/models?limit=1&query={search}")
        items = listing.get("items") if isinstance(listing, dict) else None
        if items:
            versions = items[0].get("modelVersions") or []
            if versions:
                payload = versions[0]
    if not payload:
        raise LookupError(f"Civitai 上找不到该模型：{Path(relative_path).name}")

    preview_url = ""
    preview_type = "none"
    images = payload.get("images") or []
    chosen = None
    for image in images:
        if isinstance(image, dict) and image.get("url"):
            chosen = image
            break
    if chosen:
        preview_url = str(chosen["url"])
        media_type = str(chosen.get("type") or "image")
        preview_type = "video" if media_type == "video" else "image"

    tags = []
    for key in ("trainedWords", "tags"):
        for value in payload.get(key) or []:
            text = str(value).strip()
            if text and text not in tags:
                tags.append(text)

    return {
        "preview_url": preview_url,
        "preview_type": preview_type,
        "trigger_words": ", ".join(str(word) for word in (payload.get("trainedWords") or [])),
        "download_url": str(payload.get("downloadUrl") or ""),
        "tags": tags[:30],
        "civitai": {
            "model_id": payload.get("modelId"),
            "version_id": payload.get("id"),
            "name": payload.get("name"),
            "base_model": payload.get("baseModel"),
        },
    }


@PromptServer.instance.routes.post("/localloragallery/sync_civitai")
async def localloragallery_sync_civitai(request):
    try:
        body = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="Invalid JSON body.")
    lora_name = str((body or {}).get("lora_name") or "").strip()
    if not lora_name:
        raise web.HTTPBadRequest(text="Missing 'lora_name'.")

    try:
        metadata = await asyncio.to_thread(_civitai_metadata, lora_name)
    except Exception as error:
        message = str(error) or error.__class__.__name__
        return web.json_response({"status": "error", "message": f"Civitai 同步失败：{message}"}, status=200)

    def mutate(store: dict):
        entry = store["metadata"].get(lora_name)
        if not isinstance(entry, dict):
            entry = {}
            store["metadata"][lora_name] = entry
        for key in ("preview_url", "preview_type", "trigger_words", "download_url", "tags", "civitai"):
            if metadata.get(key) not in (None, "", []):
                entry[key] = metadata[key]
        return metadata

    saved = await asyncio.to_thread(_mutate_store, mutate)
    return web.json_response({"status": "ok", "metadata": saved})

"""Browse the external clothing library and output its original images."""
import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from aiohttp import web
from PIL import Image, ImageOps
from comfy_api.latest import IO
from server import PromptServer

from .categories import IMAGE


LIBRARY = Path(os.environ.get(
    "WZQ_CLOTHING_GALLERY_LIBRARY",
    r"E:\AI2027\素材库离线版带网页预览\AI服装素材库_离线版",
)).expanduser().resolve()
PAGE = Path(__file__).with_name("clothing_gallery.html")
DEFAULT_CLOTHING = "SPR-0001"


def browser_row(row, details=True):
    fields = ("id", "category_id", "category_zh", "category_en", "keywords_en",
              "tags_zh", "tags_en", "system_tags_zh")
    if details:
        fields += ("prompt_zh", "prompt_en", "prompt_note_zh", "negative_prompt_zh", "negative_prompt_en")
    return {**{key: row[key] for key in fields}, "files": row["files"]}


@lru_cache(maxsize=1)
def _read_catalog(source, modified, size):
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    rows = data["items"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("服装清单为空或格式错误：data/catalog.json")
    index = {row["id"]: row for row in rows}
    body = json.dumps({"total": len(rows), "categories": data["categories"],
                       "items": [browser_row(row, details=False) for row in rows]},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return index, body, 'W/"' + hashlib.sha256(body).hexdigest() + '"'


def catalog_data():
    source = LIBRARY / "data" / "catalog.json"
    try:
        stat = source.stat()
    except FileNotFoundError:
        raise FileNotFoundError(f"找不到服装清单：{source}。请检查图库目录或 WZQ_CLOTHING_GALLERY_LIBRARY。") from None
    return _read_catalog(source, stat.st_mtime_ns, stat.st_size)


def clothing(clothing_id):
    index = catalog_data()[0]
    if not isinstance(clothing_id, str) or clothing_id not in index:
        raise ValueError(f"未知服装 ID：{clothing_id}")
    return index[clothing_id]


def asset(kind, filename):
    if kind not in ("original", "display", "thumb") or not filename or any(c in filename for c in ("/", "\\", ":", "\0")):
        raise ValueError("无效的服装图片路径")
    clothing_id, suffix = os.path.splitext(filename)
    row = clothing(clothing_id)
    relative = f"assets/{kind}/{filename}"
    if row["files"][kind] != relative or suffix.lower() != (".png" if kind == "original" else ".webp"):
        raise ValueError("图片不在服装清单中")
    target = (LIBRARY / relative).resolve()
    if not target.is_relative_to(LIBRARY):
        raise ValueError("图片路径超出服装库目录")
    if not target.is_file():
        raise FileNotFoundError(f"服装图片缺失：{target}")
    return target


def original(clothing_id):
    row = clothing(clothing_id)
    return asset("original", row["files"]["original"].removeprefix("assets/original/"))


class WZQClothingGallery(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="wzq-clothing-gallery",
            display_name="wzq-clothing-gallery 服装图库",
            category=IMAGE,
            description="浏览本地服装素材库，按分类、中文标签及英文关键词搜索，输出所选服装原图。",
            inputs=[IO.String.Input("clothing_id", default=DEFAULT_CLOTHING, multiline=False,
                                    tooltip="点击浏览服装图库选择图片，或填写服装 ID。")],
            outputs=[IO.Image.Output("image"), IO.Int.Output("width"), IO.Int.Output("height"),
                     IO.String.Output("clothing_id"), IO.String.Output("description")],
        )

    @classmethod
    def validate_inputs(cls, clothing_id):
        try:
            original(clothing_id)
        except (OSError, ValueError, KeyError) as exc:
            return str(exc)
        return True

    @classmethod
    def fingerprint_inputs(cls, clothing_id):
        digest = hashlib.sha256(original(clothing_id).read_bytes())
        digest.update(json.dumps(clothing(clothing_id), ensure_ascii=False, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()

    @classmethod
    def execute(cls, clothing_id):
        row = clothing(clothing_id)
        with Image.open(original(clothing_id)) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image = Image.alpha_composite(Image.new("RGBA", image.size, "white"), image).convert("RGB")
            width, height = image.size
            tensor = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0).unsqueeze(0)
        description = f'{row["category_zh"]} / {"、".join(row["tags_zh"])}'
        return IO.NodeOutput(tensor, width, height, clothing_id, description)


routes = PromptServer.instance.routes


@routes.get("/wzq/clothing-gallery/")
async def gallery_page(request):
    return web.FileResponse(PAGE, headers={"Cache-Control": "no-cache"})


@routes.get("/wzq/clothing-gallery/catalog")
async def gallery_catalog(request):
    try:
        _, body, etag = catalog_data()
        headers = {"Cache-Control": "private, no-cache", "ETag": etag, "Vary": "Accept-Encoding"}
        if request.headers.get("If-None-Match") == etag:
            return web.Response(status=304, headers=headers)
        response = web.Response(body=body, content_type="application/json", charset="utf-8", headers=headers)
        response.enable_compression()
        return response
    except (OSError, ValueError, KeyError) as exc:
        return web.json_response({"error": str(exc)}, status=503)


@routes.get("/wzq/clothing-gallery/clothing/{clothing_id}")
async def gallery_clothing(request):
    try:
        clothing_id = request.match_info["clothing_id"]
        with Image.open(original(clothing_id)) as image:
            width, height = image.size
            if image.getexif().get(274) in (5, 6, 7, 8):
                width, height = height, width
        return web.json_response({**browser_row(clothing(clothing_id)), "width": width, "height": height},
                                 headers={"Cache-Control": "no-cache"})
    except (OSError, ValueError, KeyError) as exc:
        return web.json_response({"error": str(exc)}, status=404)


@routes.get("/wzq/clothing-gallery/assets/{kind}/{filename}")
async def gallery_asset(request):
    kind, filename = request.match_info["kind"], request.match_info["filename"]
    try:
        try:
            target = asset(kind, filename)
        except FileNotFoundError:
            if kind not in ("thumb", "display"):
                raise
            target = original(os.path.splitext(filename)[0])
    except (OSError, ValueError, KeyError):
        raise web.HTTPNotFound() from None
    return web.FileResponse(target, headers={"Cache-Control": "no-cache"})

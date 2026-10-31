"""Local pose catalogue, ComfyUI node and read-only gallery routes."""
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
    "WZQ_POSE_GALLERY_LIBRARY",
    r"E:\AI2027\素材库离线版带网页预览\AI姿势素材库_离线版",
)).expanduser().resolve()
PAGE = Path(__file__).with_name("pose_gallery.html")
DEFAULT_POSE = "full_sexy_P031_front"


@lru_cache(maxsize=1)
def _read_catalog(source, modified, size):
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    rows = data["items"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("姿势清单为空或格式错误：data/catalog.json")
    index = {row["id"]: row for row in rows}
    body = json.dumps([browser_row(row, details=False) for row in rows],
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return index, body, 'W/"' + hashlib.sha256(body).hexdigest() + '"'


def catalog_data():
    source = LIBRARY / "data" / "catalog.json"
    try:
        stat = source.stat()
    except FileNotFoundError:
        raise FileNotFoundError(f"找不到姿势清单：{source}。请检查图库目录或 WZQ_POSE_GALLERY_LIBRARY。") from None
    return _read_catalog(source, stat.st_mtime_ns, stat.st_size)


def catalog():
    return catalog_data()[0]


def pose(pose_id):
    index = catalog()
    if not isinstance(pose_id, str) or pose_id not in index:
        raise ValueError(f"未知姿势 ID：{pose_id}")
    return index[pose_id]


def asset(kind, filename):
    if kind not in ("img", "thumbs") or not filename or any(c in filename for c in ("/", "\\", ":", "\0")):
        raise ValueError("无效的姿势图片路径")
    pose_id, suffix = os.path.splitext(filename)
    row = pose(pose_id)
    relative = f"{kind}/{filename}"
    expected = row["原图" if kind == "img" else "缩略图"]
    if relative != expected or suffix.lower() != (".png" if kind == "img" else ".jpg"):
        raise ValueError("图片不在姿势清单中")
    target = (LIBRARY / relative).resolve()
    if not target.is_relative_to(LIBRARY):
        raise ValueError("图片路径超出姿势库目录")
    if not target.is_file():
        raise FileNotFoundError(f"姿势图片缺失：{target}。请检查本地素材库。")
    return target


def original(pose_id):
    row = pose(pose_id)
    return asset("img", row["原图"].removeprefix("img/"))


def browser_row(row, details=True):
    fields = ("id", "体系", "姿势编号", "分类", "姿势名称", "角度", "group_id")
    if details:
        fields += ("prompt_zh", "prompt_en", "prompt_note_zh", "negative_prompt_zh", "negative_prompt_en")
    result = {key: row.get(key, "") for key in fields}
    result.update({key: f"assets/{row[key]}" for key in ("原图", "缩略图")})
    return result


class WZQPoseGallery(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="wzq-pose-gallery",
            display_name="wzq-pose-gallery 姿势图库",
            category=IMAGE,
            description="浏览本地中文姿势库，搜索、分类筛选及多视角预览，输出所选原图。",
            inputs=[IO.String.Input("pose_id", default=DEFAULT_POSE, multiline=False,
                                    tooltip="点击浏览姿势图库选择图片，或填写姿势 ID。")],
            outputs=[IO.Image.Output("image"), IO.Int.Output("width"), IO.Int.Output("height"),
                     IO.String.Output("pose_id"), IO.String.Output("description")],
        )

    @classmethod
    def validate_inputs(cls, pose_id):
        try:
            original(pose_id)
        except (OSError, ValueError, KeyError) as exc:
            return str(exc)
        return True

    @classmethod
    def fingerprint_inputs(cls, pose_id):
        digest = hashlib.sha256(original(pose_id).read_bytes())
        digest.update(json.dumps(pose(pose_id), ensure_ascii=False, sort_keys=True).encode("utf-8"))
        return digest.hexdigest()

    @classmethod
    def execute(cls, pose_id):
        row = pose(pose_id)
        with Image.open(original(pose_id)) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            image = Image.alpha_composite(background, image).convert("RGB")
            width, height = image.size
            tensor = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0).unsqueeze(0)
        description = " / ".join(row.get(key, "") for key in ("体系", "分类", "姿势名称", "角度"))
        return IO.NodeOutput(tensor, width, height, pose_id, description)


routes = PromptServer.instance.routes


@routes.get("/wzq/pose-gallery/")
async def gallery_page(request):
    return web.FileResponse(PAGE, headers={"Cache-Control": "no-cache"})


@routes.get("/wzq/pose-gallery/catalog")
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


@routes.get("/wzq/pose-gallery/pose/{pose_id}")
async def gallery_pose(request):
    try:
        pose_id = request.match_info["pose_id"]
        target = original(pose_id)
        with Image.open(target) as image:
            width, height = image.size
            if image.getexif().get(274) in (5, 6, 7, 8):
                width, height = height, width
        return web.json_response({**browser_row(pose(pose_id)), "width": width, "height": height},
                                 headers={"Cache-Control": "no-cache"})
    except (OSError, ValueError, KeyError) as exc:
        return web.json_response({"error": str(exc)}, status=404)


@routes.get("/wzq/pose-gallery/assets/{kind}/{filename}")
async def gallery_asset(request):
    kind, filename = request.match_info["kind"], request.match_info["filename"]
    try:
        try:
            target = asset(kind, filename)
        except FileNotFoundError:
            if kind != "thumbs":
                raise
            target = original(os.path.splitext(filename)[0])
    except (OSError, ValueError, KeyError):
        raise web.HTTPNotFound() from None
    return web.FileResponse(target, headers={"Cache-Control": "no-cache"})

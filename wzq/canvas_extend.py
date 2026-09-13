"""Interactive crop / canvas extension backend for ComfyUI."""

from __future__ import annotations

import json
import re
from typing import Any

import torch

from . import categories


_HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{6})$")


class WZQCanvasExtend:
    """Crop an image or extend its canvas using offsets selected in the UI."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "extend_data": (
                    "STRING",
                    {"default": "", "multiline": False, "display": "hidden"},
                ),
                "fill_color": (
                    "STRING",
                    {"default": "#ffffff", "multiline": False, "display": "hidden"},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "MASK", "STRING")
    RETURN_NAMES = ("output_image", "extend_mask", "image_mask", "extend_data")
    FUNCTION = "process_canvas"
    CATEGORY = categories.IMAGE
    DESCRIPTION = (
        "在节点画布中交互式裁剪或扩展图像。extend_mask 标记新增画布，"
        "image_mask 在原图尺寸中标记裁剪框覆盖区域。"
    )
    OUTPUT_TOOLTIPS = (
        "裁剪或扩展后的图像。",
        "与输出图像同尺寸，新增画布区域为白色。",
        "与原图同尺寸，裁剪框覆盖到的原图区域为白色。",
        "left/right/top/bottom 四边参数的 JSON 字符串。",
    )

    @staticmethod
    def _parse_offsets(value: str) -> tuple[int, int, int, int]:
        try:
            data: dict[str, Any] = json.loads(value) if value and value.strip() else {}
        except (TypeError, ValueError, json.JSONDecodeError):
            data = {}
        if not isinstance(data, dict):
            data = {}

        def integer(name: str) -> int:
            try:
                number = float(data.get(name, 0))
                if not (-1e7 < number < 1e7):
                    return 0
                return int(round(number))
            except (TypeError, ValueError, OverflowError):
                return 0

        return integer("left"), integer("right"), integer("top"), integer("bottom")

    @staticmethod
    def _parse_color(value: str, channels: int, *, device, dtype) -> torch.Tensor:
        match = _HEX_COLOR.match(value or "")
        rgb = (
            tuple(int(match.group(1)[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
            if match
            else (0.0, 0.0, 0.0)
        )

        if channels == 1:
            components = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2],)
        elif channels <= 3:
            components = rgb[:channels]
        else:
            # ComfyUI IMAGE tensors are normally RGB. Preserve extra channels and
            # make a requested transparent extension actually transparent for RGBA.
            alpha = 0.0 if value == "transparent" else 1.0
            components = (*rgb, alpha, *((0.0,) * max(0, channels - 4)))

        return torch.tensor(components, device=device, dtype=dtype)

    def process_canvas(self, image: torch.Tensor, extend_data: str, fill_color: str):
        if not isinstance(image, torch.Tensor) or image.ndim not in (3, 4):
            raise ValueError("image 必须是 [H,W,C] 或 [B,H,W,C] 格式的 IMAGE tensor")

        if image.ndim == 3:
            image = image.unsqueeze(0)

        batch, image_height, image_width, channels = image.shape
        left, right, top, bottom = self._parse_offsets(extend_data)
        output_width = image_width + left + right
        output_height = image_height + top + bottom

        if output_width < 1 or output_height < 1:
            raise ValueError(
                f"裁剪区域无效：输出尺寸为 {output_width} x {output_height}，宽高必须至少为 1"
            )

        color = self._parse_color(fill_color, channels, device=image.device, dtype=image.dtype)
        output = color.view(1, 1, 1, channels).expand(
            batch, output_height, output_width, channels
        ).clone()

        # Original pixel (x, y) is placed at (x + left, y + top). Intersect that
        # rectangle with both the source image and the destination canvas.
        source_x0 = max(0, -left)
        source_y0 = max(0, -top)
        source_x1 = min(image_width, output_width - left)
        source_y1 = min(image_height, output_height - top)
        copy_width = max(0, source_x1 - source_x0)
        copy_height = max(0, source_y1 - source_y0)
        dest_x0 = source_x0 + left
        dest_y0 = source_y0 + top

        # White means newly extended pixels; copied image pixels are black.
        extend_mask = torch.ones(
            (batch, output_height, output_width), device=image.device, dtype=torch.float32
        )
        image_mask = torch.zeros(
            (batch, image_height, image_width), device=image.device, dtype=torch.float32
        )

        if copy_width and copy_height:
            output[
                :, dest_y0 : dest_y0 + copy_height, dest_x0 : dest_x0 + copy_width, :
            ] = image[:, source_y0:source_y1, source_x0:source_x1, :]
            extend_mask[
                :, dest_y0 : dest_y0 + copy_height, dest_x0 : dest_x0 + copy_width
            ] = 0.0
            image_mask[:, source_y0:source_y1, source_x0:source_x1] = 1.0

        normalized_data = json.dumps(
            {"left": left, "right": right, "top": top, "bottom": bottom},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        return output, extend_mask, image_mask, normalized_data


NODE_CLASS_MAPPINGS = {"WZQCanvasExtend": WZQCanvasExtend}
NODE_DISPLAY_NAME_MAPPINGS = {"WZQCanvasExtend": "WZQ交互式裁剪可扩展画布"}

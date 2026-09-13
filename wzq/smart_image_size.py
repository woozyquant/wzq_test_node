import math

import torch

import comfy.utils
from nodes import MAX_RESOLUTION

from . import categories


class WZQSmartImageSize:
    """Create a sized blank image or resize an image to a target pixel count."""

    ASPECT_RATIOS = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "9:21", "21:9"]
    UPSCALE_METHODS = ["nearest-exact", "bilinear", "area", "bicubic", "lanczos"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (["创建空白图", "缩放输入图"], {"default": "创建空白图"}),
                "aspect_ratio": (cls.ASPECT_RATIOS, {"default": "9:16"}),
                "megapixels": ("FLOAT", {"default": 0.5, "min": 0.01, "max": 64.0, "step": 0.01}),
                "multiple": ("INT", {"default": 32, "min": 1, "max": 256, "step": 1}),
                "upscale_method": (cls.UPSCALE_METHODS, {"default": "lanczos"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64, "step": 1}),
                "color": ("INT", {"default": 16777215, "min": 0, "max": 16777215, "step": 1}),
            },
            "optional": {
                "image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height", "batch_size")
    FUNCTION = "execute"
    CATEGORY = categories.IMAGE
    OUTPUT_NODE = True
    DESCRIPTION = "按画幅比例与目标百万像素创建纯色空白图，或把输入图缩放到目标像素。"
    OUTPUT_TOOLTIPS = ("生成的空白图或缩放后的图像。", "输出宽度。", "输出高度。", "输出批次数量。")

    @staticmethod
    def _ratio(aspect_ratio):
        try:
            width, height = aspect_ratio.split(":", 1)
            ratio = float(width) / float(height)
            return ratio if ratio > 0 else 1.0
        except (AttributeError, ValueError, ZeroDivisionError):
            return 1.0

    @staticmethod
    def _rounded(value, multiple):
        multiple = max(1, int(multiple))
        return max(multiple, int(round(value / multiple)) * multiple)

    @classmethod
    def _target_size(cls, ratio, megapixels, multiple):
        # Match ComfyUI's built-in Resolution Selector: its megapixel unit is
        # based on a 1024 x 1024 image rather than decimal one-million pixels.
        target_pixels = max(0.01, float(megapixels)) * 1024 * 1024
        ideal_width = math.sqrt(target_pixels * ratio)
        ideal_height = ideal_width / ratio
        width = cls._rounded(ideal_width, multiple)
        height = cls._rounded(ideal_height, multiple)
        if width > MAX_RESOLUTION or height > MAX_RESOLUTION:
            raise ValueError(
                f"目标尺寸 {width}x{height} 超过 ComfyUI 最大分辨率 {MAX_RESOLUTION}。"
            )
        return width, height

    @staticmethod
    def _color_tensor(color):
        color = max(0, min(0xFFFFFF, int(color)))
        return torch.tensor(
            [(color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF], dtype=torch.float32
        ).div_(255.0)

    def execute(
        self,
        mode,
        aspect_ratio,
        megapixels,
        multiple,
        upscale_method,
        batch_size,
        color,
        image=None,
    ):
        if mode == "缩放输入图":
            if image is None:
                raise ValueError("“缩放输入图”模式需要连接 image 输入。")
            if image.ndim != 4 or image.shape[-1] not in (3, 4):
                raise ValueError("image 必须是 ComfyUI 的 IMAGE 张量 [batch, height, width, channels]。")

            source_height, source_width = image.shape[1:3]
            width, height = self._target_size(source_width / max(1, source_height), megapixels, multiple)
            samples = image.movedim(-1, 1)
            resized = comfy.utils.common_upscale(samples, width, height, upscale_method, "disabled")
            output = resized.movedim(1, -1)
        else:
            width, height = self._target_size(self._ratio(aspect_ratio), megapixels, multiple)
            rgb = self._color_tensor(color)
            output = rgb.view(1, 1, 1, 3).expand(int(batch_size), height, width, 3).clone()

        actual_batch = int(output.shape[0])
        text = f"{mode} · {width} × {height} · Batch {actual_batch}"
        return {
            "ui": {"text": [text], "wzq_image_size": [[width, height, actual_batch]]},
            "result": (output, width, height, actual_batch),
        }

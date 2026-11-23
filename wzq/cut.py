"""Qwen image size preparation, ported from ComfyUI-BlueBox.

Source: https://github.com/zhoutingxi/ComfyUI-BlueBox
        nodes/cut_qwen_image_21.py
Copyright (c) zhoutingxi / ComfyUI-BlueBox contributors (MIT License).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

import math

import torch
from comfy_api.latest import io

from . import categories


MIN_RESOLUTION = 128
MAX_RESOLUTION = 4096
_STANDARD_RATIOS = (1.0, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 3 / 2, 2 / 3)


def _snap_resolution(value):
    return min(MAX_RESOLUTION, max(MIN_RESOLUTION, int(round(value / 32.0)) * 32))


def _generate_whitelist(resolution):
    n = resolution // 32
    pairs = []
    for k in range(1, n * 3):
        for m in range(1, n * 3):
            if abs(k * m - n * n) <= n:
                w, h = k * 32, m * 32
                if MIN_RESOLUTION <= w <= MAX_RESOLUTION and MIN_RESOLUTION <= h <= MAX_RESOLUTION:
                    pairs.append((w, h, k * m))
    return pairs


def _ratio_distance(a, b):
    return abs(math.log(a) - math.log(b))


def _score_candidate(candidate, resolution, input_ratio):
    w, h, prod = candidate
    ratio = w / h
    d_input = _ratio_distance(ratio, input_ratio)
    d_std = min(_ratio_distance(ratio, r) for r in _STANDARD_RATIOS)
    d_area = abs(prod * 1024 - resolution * resolution) / (resolution * resolution)
    return d_input + d_std * 0.6 + d_area * 0.4


def _verify_fixed_point(w, h, resolution):
    scale = math.sqrt((resolution * resolution) / (w * h))
    return _snap_resolution(w * scale), _snap_resolution(h * scale)


def _pick_target_size(width, height, resolution):
    input_ratio = width / height
    whitelist = _generate_whitelist(resolution)
    tw, th, _ = min(whitelist, key=lambda pair: _score_candidate(pair, resolution, input_ratio))
    if _verify_fixed_point(tw, th, resolution) == (tw, th):
        return tw, th

    fixed_points = [
        (w, h) for w, h, _ in whitelist
        if _verify_fixed_point(w, h, resolution) == (w, h)
    ]
    if fixed_points:
        return min(fixed_points, key=lambda pair: _ratio_distance(pair[0] / pair[1], input_ratio))
    return tw, th


def _resize_to(image, width, height, mode):
    batch, source_height, source_width, channels = image.shape
    if mode == "stretch":
        new_width, new_height = width, height
    else:
        scale = (min if mode == "pad" else max)(width / source_width, height / source_height)
        new_width = max(1, int(round(source_width * scale)))
        new_height = max(1, int(round(source_height * scale)))

    resized = torch.nn.functional.interpolate(
        image.permute(0, 3, 1, 2),
        size=(new_height, new_width),
        mode="bilinear",
        align_corners=False,
    ).permute(0, 2, 3, 1)

    if mode == "pad":
        output = image.new_zeros((batch, height, width, channels))
        top = (height - new_height) // 2
        left = (width - new_width) // 2
        output[:, top:top + new_height, left:left + new_width, :] = resized
        return output
    if mode == "stretch":
        return resized
    top = (new_height - height) // 2
    left = (new_width - width) // 2
    return resized[:, top:top + height, left:left + width, :].clone()


class WZQCut(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="wzq_cut",
            display_name="wzq_cut",
            category=categories.IMAGE,
            description="将图像调整到 Qwen 风格的 32 倍数稳定尺寸，支持中心裁切、黑色补边和拉伸。",
            inputs=[
                io.Image.Input("image"),
                io.Combo.Input(
                    "resolution_mode", options=["default", "manual"], default="default",
                    tooltip="default：按原图面积自动计算分辨率；manual：使用 resolution_value。",
                ),
                io.Int.Input(
                    "resolution_value", default=1024, min=MIN_RESOLUTION, max=MAX_RESOLUTION, step=32,
                    tooltip="仅 manual 模式使用，目标面积约为该值的平方，不代表长边长度。",
                ),
                io.Combo.Input(
                    "mode", options=["crop", "pad", "stretch"], default="crop",
                    tooltip="crop：等比缩放后居中裁切；pad：等比缩放后补黑边；stretch：直接拉伸。",
                ),
            ],
            outputs=[
                io.Image.Output(display_name="image"),
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
                io.Int.Output(display_name="resolution"),
            ],
        )

    @classmethod
    def execute(cls, image, resolution_mode, resolution_value, mode):
        _, height, width, _ = image.shape
        value = math.sqrt(float(width) * float(height)) if resolution_mode == "default" else int(resolution_value)
        resolution = _snap_resolution(value)
        target_width, target_height = _pick_target_size(width, height, resolution)
        output = _resize_to(image, target_width, target_height, mode)
        return io.NodeOutput(output, target_width, target_height, resolution)

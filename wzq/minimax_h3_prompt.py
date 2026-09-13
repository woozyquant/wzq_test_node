"""Prompt-only MiniMax H3 integration node.

This keeps the original Goohai rich prompt/media UI while deliberately
leaving model loading, VAE loading, canvas calculation and conditioning to
downstream nodes.
"""

from __future__ import annotations

import json
import math

from ..prompt_tags import prepare_prompt
from . import categories


MEDIA_SLOTS = (
    "first_frame",
    "last_frame",
    "hybrid_audio",
    *(f"ref_image_{index}" for index in range(1, 10)),
    *(f"ref_video_{index}" for index in range(1, 4)),
    *(f"ref_audio_{index}" for index in range(1, 4)),
)
IMAGE_SLOTS = ("first_frame", "last_frame", *(f"ref_image_{index}" for index in range(1, 10)))
VIDEO_SLOTS = tuple(f"ref_video_{index}" for index in range(1, 4))
AUDIO_SLOTS = ("hybrid_audio", *(f"ref_audio_{index}" for index in range(1, 4)))
MEDIA_TYPE = "WZQ_H3_MEDIA"


def _trim_value(raw, camel_name: str):
    snake_name = {
        "trimStart": "trim_start",
        "trimEnd": "trim_end",
        "originalDuration": "original_duration",
    }[camel_name]
    value = raw.get(camel_name, raw.get(snake_name))
    if value is None or value == "":
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def _slot_kind(slot: str) -> str:
    if slot in {"first_frame", "last_frame"} or slot.startswith("ref_image_"):
        return "image"
    if slot.startswith("ref_video_"):
        return "video"
    if slot == "hybrid_audio" or slot.startswith("ref_audio_"):
        return "audio"
    return "unknown"


def _normalize_media_bundle(media_in) -> dict:
    if media_in is None:
        return {"version": 1, "items": []}
    if not isinstance(media_in, dict):
        raise TypeError("media_in must be a WZQ_H3_MEDIA bundle")
    raw_items = media_in.get("items", [])
    if not isinstance(raw_items, (list, tuple)):
        raise TypeError("WZQ_H3_MEDIA items must be a list")
    items = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        slot = str(raw.get("slot") or "")
        if slot not in MEDIA_SLOTS:
            continue
        value = raw.get("value", raw.get("name"))
        if not _has_media(value):
            continue
        kind = str(raw.get("kind") or _slot_kind(slot)).lower()
        if kind not in {"image", "video", "audio"}:
            kind = _slot_kind(slot)
        item = {
            "slot": slot,
            "kind": kind,
            "value": value,
            "name": str(raw.get("name") or value) if isinstance(raw.get("name") or value, str) else "",
            "muted": bool(raw.get("muted", False)),
            "source": str(raw.get("source") or "media_in"),
        }
        if kind == "audio":
            item.update(
                {
                    "trimStart": _trim_value(raw, "trimStart") or 0.0,
                    "trimEnd": _trim_value(raw, "trimEnd"),
                    "originalDuration": _trim_value(raw, "originalDuration"),
                }
            )
        items.append(item)
    bundle = dict(media_in)
    bundle["version"] = 1
    bundle["items"] = items
    return bundle


def _merge_media(media_in, media_values, state) -> tuple[dict, dict, dict]:
    upstream = _normalize_media_bundle(media_in)
    by_slot = {item["slot"]: item for item in upstream["items"]}
    serialized = {}
    for item in state.get("media", []) if isinstance(state.get("media"), list) else []:
        if isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[0], str):
            serialized[item[0]] = item[1]
    for slot, value in media_values.items():
        if not _has_media(value):
            continue
        entry = serialized.get(slot) if isinstance(serialized.get(slot), dict) else {}
        item = {
            "slot": slot,
            "kind": str(entry.get("kind") or _slot_kind(slot)),
            "value": value,
            "name": str(entry.get("name") or value),
            "muted": bool(entry.get("muted", False)),
            "source": "local",
        }
        if item["kind"] == "audio":
            item.update(
                {
                    "trimStart": _trim_value(entry, "trimStart") or 0.0,
                    "trimEnd": _trim_value(entry, "trimEnd"),
                    "originalDuration": _trim_value(entry, "originalDuration"),
                }
            )
        by_slot[slot] = item
    items = [by_slot[slot] for slot in MEDIA_SLOTS if slot in by_slot]
    combined_values = {slot: "" for slot in MEDIA_SLOTS}
    for item in items:
        combined_values[item["slot"]] = item["value"]
    combined_state = dict(state)
    combined_state["media"] = [
        [
            item["slot"],
            {
                "name": item["name"],
                "kind": item["kind"],
                "muted": item["muted"],
                **(
                    {
                        "trimStart": item.get("trimStart", 0.0),
                        "trimEnd": item.get("trimEnd"),
                        "originalDuration": item.get("originalDuration"),
                    }
                    if item["kind"] == "audio"
                    else {}
                ),
            },
        ]
        for item in items
    ]
    merged = dict(upstream)
    merged["version"] = 1
    merged["items"] = items
    return merged, combined_values, combined_state


def _materialize_media(item):
    """Resolve panel-uploaded filenames to real ComfyUI media values."""
    if not item:
        return None
    value = item.get("value")
    kind = item.get("kind")
    if isinstance(value, str):
        if kind == "image":
            import nodes

            value = nodes.LoadImage().load_image(value)[0]
        elif kind == "audio":
            from comfy_extras import nodes_audio

            value = nodes_audio.LoadAudio.load(value)[0]
        elif kind == "video":
            import folder_paths
            from comfy_api.latest._input_impl import VideoFromFile

            value = VideoFromFile(folder_paths.get_annotated_filepath(value))
    if kind == "audio":
        value = _trim_audio(value, item)
    return value


def _trim_audio(audio, item):
    """Return a detached AUDIO value cropped to the panel's trim interval."""
    if not isinstance(audio, dict):
        return audio
    waveform = audio.get("waveform")
    try:
        sample_rate = int(audio.get("sample_rate"))
        sample_count = int(waveform.shape[-1])
    except (AttributeError, TypeError, ValueError, IndexError):
        return audio
    if sample_rate <= 0 or sample_count < 0:
        return audio

    start_seconds = _trim_value(item, "trimStart") or 0.0
    end_seconds = _trim_value(item, "trimEnd")
    start_sample = max(0, min(sample_count, int(round(start_seconds * sample_rate))))
    end_sample = sample_count if end_seconds is None else max(
        start_sample,
        min(sample_count, int(round(end_seconds * sample_rate))),
    )
    if start_sample == 0 and end_sample == sample_count:
        return audio

    cropped = waveform[..., start_sample:end_sample]
    if hasattr(cropped, "clone"):
        cropped = cropped.clone()
    elif hasattr(cropped, "copy"):
        cropped = cropped.copy()
    result = dict(audio)
    result["waveform"] = cropped
    return result


def _video_components(video):
    if video is None:
        return None
    if hasattr(video, "get_components"):
        return video.get_components()
    if isinstance(video, dict):
        return video
    return None


def _video_frames_at_24fps(video, components=None):
    """Convert a Comfy VIDEO to the IMAGE batch expected by MiniMax H3."""
    if components is None:
        components = _video_components(video)
    images = getattr(components, "images", None)
    frame_rate = getattr(components, "frame_rate", None)
    if isinstance(components, dict):
        images = components.get("images", images)
        frame_rate = components.get("frame_rate", frame_rate)
    if images is None:
        return None
    try:
        source_count = int(images.shape[0])
        source_fps = float(frame_rate)
    except (AttributeError, TypeError, ValueError, IndexError):
        return images
    if source_count <= 1 or source_fps <= 0 or abs(source_fps - 24.0) < 1e-6:
        return images

    import torch

    target_count = max(1, int(round(source_count * 24.0 / source_fps)))
    indices = torch.linspace(
        0,
        source_count - 1,
        target_count,
        device=images.device,
    ).round().long()
    return images.index_select(0, indices)


def _video_audio(video, components=None):
    if components is None:
        components = _video_components(video)
    if isinstance(components, dict):
        return components.get("audio")
    return getattr(components, "audio", None)


def _has_media(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value) and value != "(none)"
    return True


def _restore_state(state_json, main_mode, prompt, media_values):
    """Restore values owned by the DOM panel from the serialized workflow."""
    if not state_json or state_json == "(none)":
        return main_mode, prompt, media_values, {}
    try:
        state = json.loads(state_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return main_mode, prompt, media_values, {}
    if not isinstance(state, dict):
        return main_mode, prompt, media_values, {}

    restored_mode = state.get("mode")
    if restored_mode in {"text_keyframes", "all_reference"}:
        main_mode = restored_mode

    prompts = state.get("prompts")
    if isinstance(prompts, dict) and isinstance(prompts.get(main_mode), str):
        prompt = prompts[main_mode]
    elif isinstance(state.get("prompt"), str):
        prompt = state["prompt"]

    serialized_media = state.get("media")
    if isinstance(serialized_media, list):
        restored = {}
        for item in serialized_media:
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                continue
            slot, entry = item
            if slot not in media_values or not isinstance(entry, dict):
                continue
            name = entry.get("name")
            if _has_media(name):
                restored[slot] = name
        media_values = {slot: restored.get(slot, "") for slot in media_values}

    return main_mode, prompt, media_values, state


def _resolved_task(main_mode, media_values):
    if main_mode == "all_reference":
        return "ref2va"
    first = _has_media(media_values.get("first_frame"))
    last = _has_media(media_values.get("last_frame"))
    audio = _has_media(media_values.get("hybrid_audio"))
    if audio and (first or last):
        return "hybrid"
    if first and last:
        return "fl2va"
    if first:
        return "i2va"
    if last:
        return "l2va"
    return "t2va"


def _reference_counts(main_mode, media_values, state):
    if main_mode == "text_keyframes":
        return {
            "pictures": sum(_has_media(media_values.get(slot)) for slot in ("first_frame", "last_frame")),
            "videos": 0,
            "audios": int(_has_media(media_values.get("hybrid_audio"))),
        }

    muted = set()
    for item in state.get("media", []) if isinstance(state, dict) else []:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        slot, entry = item
        if isinstance(entry, dict) and entry.get("muted"):
            muted.add(slot)
    video_slots = [f"ref_video_{index}" for index in range(1, 4)]
    return {
        "pictures": sum(_has_media(media_values.get(f"ref_image_{index}")) for index in range(1, 10)),
        "videos": sum(_has_media(media_values.get(slot)) for slot in video_slots),
        "audios": (
            sum(_has_media(media_values.get(slot)) and slot not in muted for slot in video_slots)
            + sum(_has_media(media_values.get(f"ref_audio_{index}")) for index in range(1, 4))
        ),
    }


class WZQMiniMaxH3Prompt:
    """Rich MiniMax H3 prompt editor with a single final-prompt output."""

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "main_mode": (["text_keyframes", "all_reference"], {"default": "text_keyframes"}),
            "duration_seconds": ("FLOAT", {"default": 5.0, "min": 2.0, "max": 30.0, "step": 0.1}),
            "prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": True}),
            "first_frame": ("STRING", {"default": ""}),
            "last_frame": ("STRING", {"default": ""}),
            "hybrid_audio": ("STRING", {"default": ""}),
        }
        required.update({f"ref_image_{index}": ("STRING", {"default": ""}) for index in range(1, 10)})
        required.update({f"ref_video_{index}": ("STRING", {"default": ""}) for index in range(1, 4)})
        required.update({f"ref_audio_{index}": ("STRING", {"default": ""}) for index in range(1, 4)})
        required.update(
            {
                "task_type": (["auto", "t2va", "i2va", "l2va", "fl2va", "ref2va", "hybrid"], {"default": "auto"}),
                "audio_mode": (["native", "lock_source", "reference_only", "remix_source"], {"default": "lock_source"}),
                "audio_denoise_strength": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "drive_audio_ordinal": ("INT", {"default": 1, "min": 0, "max": 6, "step": 1}),
                "strict_prompt_tags": ("BOOLEAN", {"default": True}),
                "ref_image_size": (["match", "max"], {"default": "match"}),
                "gh_state_json": ("STRING", {"default": ""}),
            }
        )
        return {
            "required": required,
            "optional": {
                "prompt_override": ("STRING", {"forceInput": True}),
                "media_in": (MEDIA_TYPE,),
            },
        }

    RETURN_TYPES = ("STRING", MEDIA_TYPE)
    RETURN_NAMES = ("final_prompt", "media_out")
    FUNCTION = "final_prompt"
    CATEGORY = categories.MINIMAX_H3
    DESCRIPTION = "MiniMax H3 rich prompt editor with final_prompt and chainable media_out outputs."
    OUTPUT_TOOLTIPS = ("供下游 MiniMax H3 节点使用的最终提示词。", "可继续串联的媒体包。")

    def final_prompt(
        self,
        main_mode,
        duration_seconds,
        prompt,
        first_frame,
        last_frame,
        hybrid_audio,
        ref_image_1,
        ref_image_2,
        ref_image_3,
        ref_image_4,
        ref_image_5,
        ref_image_6,
        ref_image_7,
        ref_image_8,
        ref_image_9,
        ref_video_1,
        ref_video_2,
        ref_video_3,
        ref_audio_1,
        ref_audio_2,
        ref_audio_3,
        task_type,
        audio_mode,
        audio_denoise_strength,
        drive_audio_ordinal,
        strict_prompt_tags,
        ref_image_size,
        gh_state_json="",
        prompt_override=None,
        media_in=None,
    ):
        del task_type, audio_mode, audio_denoise_strength, drive_audio_ordinal, ref_image_size
        values = locals()
        media_values = {slot: values.get(slot, "") for slot in MEDIA_SLOTS}
        main_mode, prompt, media_values, state = _restore_state(
            gh_state_json, main_mode, prompt, media_values
        )
        if prompt_override is not None:
            prompt = str(prompt_override)

        media_out, media_values, state = _merge_media(media_in, media_values, state)

        final, _warnings = prepare_prompt(
            str(prompt or ""),
            _reference_counts(main_mode, media_values, state),
            strict=bool(strict_prompt_tags),
            task_type=_resolved_task(main_mode, media_values),
        )
        media_out.update(
            {
                "mode": main_mode,
                "duration_seconds": float(duration_seconds),
                "final_prompt": final,
            }
        )
        return final, media_out


class WZQMiniMaxH3MediaInput:
    """Pack multiple typed media inputs into a chainable H3 media bundle."""

    @classmethod
    def INPUT_TYPES(cls):
        optional = {"media_in": (MEDIA_TYPE,)}
        optional.update({slot: ("IMAGE",) for slot in IMAGE_SLOTS})
        optional.update({slot: ("VIDEO",) for slot in VIDEO_SLOTS})
        optional.update({slot: ("AUDIO",) for slot in AUDIO_SLOTS})
        return {
            "required": {},
            "optional": optional,
        }

    RETURN_TYPES = (MEDIA_TYPE,)
    RETURN_NAMES = ("media_out",)
    FUNCTION = "pack"
    CATEGORY = categories.MINIMAX_H3
    DESCRIPTION = "Packs multiple IMAGE, VIDEO, and AUDIO inputs into WZQ_H3_MEDIA."
    OUTPUT_TOOLTIPS = ("包含全部输入素材的媒体包。",)

    def pack(self, media_in=None, **kwargs):
        bundle = _normalize_media_bundle(media_in)
        by_slot = {item["slot"]: item for item in bundle["items"]}
        for slot in MEDIA_SLOTS:
            value = kwargs.get(slot)
            if not _has_media(value):
                continue
            by_slot[slot] = {
                "slot": slot,
                "kind": _slot_kind(slot),
                "value": value,
                "name": "",
                "muted": False,
                "source": "media_input",
            }
        bundle["version"] = 1
        bundle["items"] = [by_slot[slot] for slot in MEDIA_SLOTS if slot in by_slot]
        return (bundle,)


class WZQMiniMaxH3MediaOutput:
    """Unpack an H3 media bundle into multiple typed media outputs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"media_in": (MEDIA_TYPE,)}}

    RETURN_TYPES = (
        *("IMAGE" for _slot in IMAGE_SLOTS),
        *("IMAGE" for _slot in VIDEO_SLOTS),
        *("AUDIO" for _slot in AUDIO_SLOTS),
        *("VIDEO" for _slot in VIDEO_SLOTS),
        *("AUDIO" for _slot in VIDEO_SLOTS),
    )
    RETURN_NAMES = (
        *IMAGE_SLOTS,
        *VIDEO_SLOTS,
        *AUDIO_SLOTS,
        *(f"ref_video_file_{index}" for index in range(1, 4)),
        *(f"ref_video_audio_{index}" for index in range(1, 4)),
    )
    FUNCTION = "unpack"
    CATEGORY = categories.MINIMAX_H3
    DESCRIPTION = "Unpacks H3 media; ref_video outputs are 24 fps IMAGE batches compatible with MiniMax H3 Reference to Video."

    def unpack(self, media_in):
        bundle = _normalize_media_bundle(media_in)
        by_slot = {item["slot"]: item for item in bundle["items"]}
        images = tuple(_materialize_media(by_slot.get(slot)) for slot in IMAGE_SLOTS)
        videos = tuple(_materialize_media(by_slot.get(slot)) for slot in VIDEO_SLOTS)
        video_components = tuple(_video_components(video) for video in videos)
        video_frames = tuple(
            _video_frames_at_24fps(video, components)
            for video, components in zip(videos, video_components)
        )
        audios = tuple(_materialize_media(by_slot.get(slot)) for slot in AUDIO_SLOTS)
        video_audios = tuple(
            _video_audio(video, components)
            for video, components in zip(videos, video_components)
        )
        return (
            *images,
            *video_frames,
            *audios,
            *videos,
            *video_audios,
        )

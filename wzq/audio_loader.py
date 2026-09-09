"""WZQ audio loader with waveform preview and non-destructive trimming."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import torch
from aiohttp import web

import folder_paths
from server import PromptServer


AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus",
    ".amr", ".ac3", ".aiff", ".aif", ".au", ".mka", ".mp2", ".ra",
    ".voc", ".w64",
}
WAVEFORM_POINTS = 800
DEFAULT_SAMPLE_RATE = 44100


def _input_directory() -> str:
    directory = folder_paths.get_input_directory()
    if not directory:
        directory = os.path.join(getattr(folder_paths, "models_dir", os.getcwd()), "input")
    os.makedirs(directory, exist_ok=True)
    return os.path.abspath(directory)


def _audio_files() -> list[str]:
    root = _input_directory()
    files: list[str] = []
    for current, _directories, names in os.walk(root):
        for name in names:
            if Path(name).suffix.lower() in AUDIO_EXTENSIONS:
                files.append(os.path.relpath(os.path.join(current, name), root).replace("\\", "/"))
    return sorted(files, key=str.casefold)


def _ffmpeg_suitability(path: str) -> int:
    try:
        output = subprocess.run(
            [path, "-version"], check=True, capture_output=True, timeout=10
        ).stdout.decode("utf-8", "replace")
    except Exception:
        return 0
    return sum(weight for marker, weight in (
        ("libmp3lame", 20), ("libvorbis", 10), ("libopus", 10), ("flac", 5)
    ) if marker in output)


def _find_ffmpeg() -> str | None:
    forced = os.environ.get("VHS_FORCE_FFMPEG_PATH")
    if forced and os.path.isfile(forced):
        return forced

    candidates: list[str] = []
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        candidate = get_ffmpeg_exe()
        if candidate and os.path.isfile(candidate):
            candidates.append(candidate)
    except Exception:
        pass

    system = shutil.which("ffmpeg")
    if system:
        candidates.append(system)

    # Portable ComfyUI installations commonly keep ffmpeg beside ComfyUI.
    comfy_root = Path(__file__).resolve().parents[3]
    for candidate in (
        comfy_root / "ffmpeg" / "bin" / "ffmpeg.exe",
        comfy_root / "ffmpeg" / "bin" / "ffmpeg",
    ):
        if candidate.is_file():
            candidates.append(str(candidate))

    unique = list(dict.fromkeys(candidates))
    return max(unique, key=_ffmpeg_suitability) if unique else None


FFMPEG_PATH = _find_ffmpeg()


def _audio_path(filename: str) -> str | None:
    try:
        path = folder_paths.get_annotated_filepath(filename)
    except Exception:
        path = None
    return path if path and os.path.isfile(path) else None


def _file_hash(path: str | None) -> str:
    if not path:
        return "missing"
    try:
        stat = os.stat(path)
        return hashlib.sha256(f"{path}|{stat.st_mtime_ns}|{stat.st_size}".encode()).hexdigest()
    except OSError:
        return "missing"


def probe_audio(path: str) -> dict[str, float | int]:
    """Read duration and stream metadata from ffmpeg's diagnostic output."""
    if not FFMPEG_PATH:
        raise RuntimeError("未找到 FFmpeg，请安装 imageio-ffmpeg 或将 ffmpeg 加入 PATH")
    process = subprocess.run(
        [FFMPEG_PATH, "-hide_banner", "-i", path, "-f", "null", "-"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        check=False,
        timeout=60,
    )
    text = process.stderr.decode("utf-8", "replace")
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    duration = 0.0
    if duration_match:
        duration = (
            int(duration_match.group(1)) * 3600
            + int(duration_match.group(2)) * 60
            + float(duration_match.group(3))
        )
    audio_match = re.search(r"Audio:.*?(\d+)\s*Hz,\s*([^,]+)", text)
    sample_rate = int(audio_match.group(1)) if audio_match else DEFAULT_SAMPLE_RATE
    channel_text = audio_match.group(2).lower() if audio_match else "stereo"
    channel_match = re.search(r"(\d+)\s*channels?", channel_text)
    channels = int(channel_match.group(1)) if channel_match else (1 if "mono" in channel_text else 2)
    bitrate_match = re.search(r"bitrate:\s*(\d+)\s*kb/s", text)
    return {
        "duration": duration,
        "sample_rate": sample_rate,
        "channels": channels,
        "bitrate": int(bitrate_match.group(1)) if bitrate_match else 0,
    }


def decode_audio(
    path: str,
    *,
    start: float = 0.0,
    duration: float | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> torch.Tensor:
    """Decode to ComfyUI-compatible stereo float32 samples shaped [2, samples]."""
    if not FFMPEG_PATH:
        raise RuntimeError("未找到 FFmpeg，请安装 imageio-ffmpeg 或将 ffmpeg 加入 PATH")
    command = [FFMPEG_PATH, "-v", "error"]
    if start > 0:
        command.extend(("-ss", f"{start:.6f}"))
    command.extend(("-i", path))
    if duration is not None and duration > 0:
        command.extend(("-t", f"{duration:.6f}"))
    command.extend(("-vn", "-ac", "2", "-ar", str(sample_rate), "-f", "f32le", "-"))
    process = subprocess.run(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=600
    )
    if process.returncode != 0:
        message = process.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"FFmpeg 音频解码失败：{message[:500]}")
    samples = np.frombuffer(process.stdout, dtype="<f4")
    if samples.size < 2:
        return torch.empty((2, 0), dtype=torch.float32)
    if samples.size % 2:
        samples = samples[:-1]
    return torch.from_numpy(samples.reshape(-1, 2).T.copy())


def waveform_peaks(waveform: torch.Tensor, points: int = WAVEFORM_POINTS) -> list[list[float]]:
    if waveform.numel() == 0:
        return []
    mono = waveform.mean(dim=0).detach().cpu().numpy()
    count = min(max(1, int(points)), mono.size)
    edges = np.linspace(0, mono.size, count + 1, dtype=np.int64)
    result: list[list[float]] = []
    for index in range(count):
        chunk = mono[edges[index]:edges[index + 1]]
        result.append([float(chunk.min()), float(chunk.max())] if chunk.size else [0.0, 0.0])
    return result


def _routes():
    instance = getattr(PromptServer, "instance", None)
    if instance is not None:
        return instance.routes

    class _FallbackRoutes:
        def get(self, _path):
            return lambda handler: handler

    return _FallbackRoutes()


routes = _routes()


@routes.get("/wzq/audio-loader/waveform")
async def wzq_audio_waveform(request):
    filename = request.rel_url.query.get("filename", "")
    path = _audio_path(filename)
    if not path or Path(path).suffix.lower() not in AUDIO_EXTENSIONS:
        return web.json_response({"error": "audio file not found"}, status=404)
    try:
        info = probe_audio(path)
        waveform = decode_audio(path, sample_rate=int(info["sample_rate"]))
        return web.json_response({
            "filename": filename,
            **info,
            "peaks": waveform_peaks(waveform),
        })
    except Exception as error:
        return web.json_response({"error": str(error)}, status=500)


class WZQAudioLoader:
    """Load an input-directory audio file and return an optionally trimmed AUDIO value."""

    @classmethod
    def INPUT_TYPES(cls):
        files = _audio_files()
        # An empty placeholder keeps the node creatable before the first upload.
        return {
            "required": {
                # Uploading is handled by js/audio_loader.js.  Declaring
                # ``audio_upload`` here makes recent ComfyUI frontends create
                # an AUDIOUPLOAD widget before its DOM element exists, which
                # prevents the node itself from being added to the graph.
                "audio": (files or [""],),
                "start_time": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "duration": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 86400.0, "step": 0.01}),
                "volume": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 3.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("音频",)
    FUNCTION = "load"
    CATEGORY = "WZQ/音频"

    def load(self, audio: str, start_time: float, duration: float, volume: float):
        path = _audio_path(audio)
        if not path:
            raise ValueError(f"找不到音频文件：{audio}")
        if Path(path).suffix.lower() not in AUDIO_EXTENSIONS:
            raise ValueError(f"不支持的音频格式：{Path(path).suffix}")

        info = probe_audio(path)
        sample_rate = int(info["sample_rate"])
        total = float(info["duration"])
        start = max(0.0, float(start_time))
        if total > 0:
            start = min(start, max(0.0, total - 1.0 / sample_rate))
        cut_duration = float(duration) if float(duration) > 0 else None
        if cut_duration is not None and total > 0:
            cut_duration = min(cut_duration, max(1.0 / sample_rate, total - start))

        waveform = decode_audio(
            path, start=start, duration=cut_duration, sample_rate=sample_rate
        )
        gain = max(0.0, min(3.0, float(volume)))
        waveform = torch.clamp(waveform * gain, -1.0, 1.0)
        if waveform.numel() == 0:
            waveform = torch.zeros((2, 1), dtype=torch.float32)
        actual_duration = waveform.shape[-1] / sample_rate
        effective_duration = cut_duration if cut_duration is not None else max(0.0, total - start)

        return {
            "result": ({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},),
            "ui": {"audio_info": [{
                "filename": audio,
                "sample_rate": sample_rate,
                "channels": int(info["channels"]),
                "bitrate": int(info["bitrate"]),
                "total_duration": total,
                "start_time": start,
                "duration": effective_duration,
                "actual_duration": actual_duration,
            }]},
        }

    @classmethod
    def IS_CHANGED(cls, audio: str, **_kwargs):
        return _file_hash(_audio_path(audio))

    @classmethod
    def VALIDATE_INPUTS(cls, audio: str, **_kwargs):
        path = _audio_path(audio)
        if not path:
            return f"找不到音频文件：{audio}"
        if Path(path).suffix.lower() not in AUDIO_EXTENSIONS:
            return f"不支持的音频格式：{Path(path).suffix}"
        return True


NODE_CLASS_MAPPINGS = {"WZQAudioLoader": WZQAudioLoader}
NODE_DISPLAY_NAME_MAPPINGS = {"WZQAudioLoader": "WZQ 音频加载器"}

import importlib.util
import sys
import types
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

import torch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1]))

from comfy_api.latest import VideoComponents, VideoFromComponents
from comfy_execution.validation import validate_node_input


PACKAGE = "wzq_h3_media_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
spec = importlib.util.spec_from_file_location(
    f"{PACKAGE}.wzq.minimax_h3_prompt", ROOT / "wzq" / "minimax_h3_prompt.py"
)
h3 = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {PACKAGE: package}):
    spec.loader.exec_module(h3)


class MiniMaxH3MediaTests(unittest.TestCase):
    def setUp(self):
        self.input = h3.WZQMiniMaxH3MediaInput()
        self.output = h3.WZQMiniMaxH3MediaOutput()

    def unpack(self, **kwargs):
        bundle, = self.input.pack(**kwargs)
        return dict(zip(self.output.RETURN_NAMES, self.output.unpack(bundle)))

    def test_reference_sockets_accept_vhs_frames_and_native_video(self):
        optional = self.input.INPUT_TYPES()["optional"]
        for index in range(1, 4):
            socket_type = optional[f"ref_video_{index}"][0]
            self.assertTrue(validate_node_input("IMAGE", socket_type))
            self.assertTrue(validate_node_input("VIDEO", socket_type))
            self.assertFalse(validate_node_input("LATENT", socket_type))
            self.assertEqual(optional[f"ref_video_info_{index}"][0], "VHS_VIDEOINFO")
            self.assertEqual(optional[f"ref_video_audio_{index}"][0], "AUDIO")

    def test_vhs_loaded_fps_preserves_duration_and_audio(self):
        frames = torch.arange(30, dtype=torch.float32).reshape(30, 1, 1, 1).expand(-1, 2, 2, 3)
        audio = {"waveform": torch.zeros(1, 2, 48000), "sample_rate": 48000}
        result = self.unpack(
            ref_video_1=frames,
            ref_video_info_1={"source_fps": 60.0, "loaded_fps": 30.0},
            ref_video_audio_1=audio,
        )
        self.assertEqual(result["ref_video_1"].shape[0], 24)
        self.assertEqual(result["ref_video_1"][0, 0, 0, 0].item(), 0)
        self.assertEqual(result["ref_video_1"][-1, 0, 0, 0].item(), 29)
        components = result["ref_video_file_1"].get_components()
        self.assertIs(components.images, frames)
        self.assertEqual(components.frame_rate, Fraction(30))
        self.assertIs(result["ref_video_audio_1"], audio)

    def test_frames_without_info_default_to_24fps(self):
        frames = torch.zeros(24, 2, 2, 3)
        result = self.unpack(ref_video_2=frames)
        self.assertIs(result["ref_video_2"], frames)
        self.assertEqual(result["ref_video_file_2"].get_components().frame_rate, Fraction(24))
        self.assertIsNone(result["ref_video_audio_2"])

    def test_each_video_uses_its_own_info_and_audio(self):
        inputs = {}
        for index, fps in enumerate((24.0, 30.0, 29.97), 1):
            inputs[f"ref_video_{index}"] = torch.zeros(30, 2, 2, 3)
            inputs[f"ref_video_info_{index}"] = {"loaded_fps": fps}
            inputs[f"ref_video_audio_{index}"] = {
                "waveform": torch.zeros(1, 1, index * 100), "sample_rate": 48000
            }
        result = self.unpack(**inputs)
        for index, fps in enumerate((24.0, 30.0, 29.97), 1):
            components = result[f"ref_video_file_{index}"].get_components()
            self.assertEqual(components.frame_rate, Fraction(str(fps)))
            self.assertIs(components.audio, inputs[f"ref_video_audio_{index}"])
            self.assertEqual(result[f"ref_video_{index}"].shape[0], round(30 * 24 / fps))

    def test_native_video_and_other_media_remain_compatible(self):
        frames = torch.zeros(24, 2, 2, 3)
        video = VideoFromComponents(VideoComponents(images=frames, frame_rate=Fraction(24)))
        audio = {"waveform": torch.zeros(1, 1, 100), "sample_rate": 48000}
        result = self.unpack(ref_video_1=video, first_frame=frames[:1], hybrid_audio=audio)
        self.assertIs(result["ref_video_file_1"], video)
        self.assertIs(result["ref_video_1"], frames)
        self.assertIs(result["hybrid_audio"], audio)
        self.assertTrue(torch.equal(result["first_frame"], frames[:1]))
        self.assertIsNone(result["ref_video_3"])

    def test_bundle_chaining_and_prompt_merge_keep_vhs_components(self):
        frames = torch.zeros(30, 2, 2, 3)
        bundle, = self.input.pack(ref_video_1=frames, ref_video_info_1={"loaded_fps": 30.0})
        bundle, = self.input.pack(media_in=bundle, ref_image_1=frames[:1])
        merged, values, state = h3._merge_media(bundle, {}, {"mode": "all_reference"})
        self.assertEqual(h3._reference_counts("all_reference", values, state)["videos"], 1)
        result = dict(zip(self.output.RETURN_NAMES, self.output.unpack(merged)))
        self.assertIs(result["ref_video_file_1"].get_components().images, frames)
        self.assertEqual(result["ref_video_1"].shape[0], 24)


if __name__ == "__main__":
    unittest.main()

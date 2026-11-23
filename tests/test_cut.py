import ast
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import torch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1]))
PACKAGE = "wzq_cut_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "wzq")]
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.cut", ROOT / "wzq" / "cut.py")
cut = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {PACKAGE: package}):
    spec.loader.exec_module(cut)


class CutTests(unittest.TestCase):
    def test_schema_and_registration(self):
        schema = cut.WZQCut.GET_SCHEMA()
        self.assertEqual(schema.node_id, "wzq_cut")
        self.assertEqual(schema.display_name, "wzq_cut")
        self.assertEqual(schema.category, "WZQ/图像")
        self.assertEqual(list(cut.WZQCut.INPUT_TYPES()["required"]), [
            "image", "resolution_mode", "resolution_value", "mode",
        ])
        self.assertEqual(tuple(cut.WZQCut.RETURN_TYPES), ("IMAGE", "INT", "INT", "INT"))
        tree = ast.parse((ROOT / "__init__.py").read_text(encoding="utf-8"))
        mappings = {
            item.targets[0].id: item.value for item in tree.body
            if isinstance(item, ast.Assign) and isinstance(item.targets[0], ast.Name)
        }
        classes = mappings["NODE_CLASS_MAPPINGS"]
        names = mappings["NODE_DISPLAY_NAME_MAPPINGS"]
        self.assertEqual(dict(zip([k.value for k in classes.keys], classes.values))["wzq_cut"].id, "WZQCut")
        self.assertEqual(ast.literal_eval(names)["wzq_cut"], "wzq_cut")

    def test_upstream_size_examples(self):
        for width, height, resolution, expected in [
            (1920, 1080, 1024, (1376, 768)),
            (1920, 1080, 1440, (1920, 1088)),
            (1000, 1000, 992, (992, 992)),
            (1536, 1024, 1024, (1248, 832)),
        ]:
            with self.subTest(width=width, height=height, resolution=resolution):
                self.assertEqual(cut._pick_target_size(width, height, resolution), expected)

    def test_resolution_rounding_and_limits(self):
        for value, expected in [(1, 128), (1000, 992), (1040, 1024), (1072, 1088), (9000, 4096)]:
            self.assertEqual(cut._snap_resolution(value), expected)

    def test_automatic_resolution_ignores_manual_value(self):
        image = torch.ones(1, 180, 320, 3)
        first = cut.WZQCut.execute(image, "default", 1024, "crop").result
        second = cut.WZQCut.execute(image, "default", 4096, "crop").result
        self.assertEqual(first[3], 256)
        self.assertEqual(first[1:], second[1:])
        torch.testing.assert_close(first[0], second[0])

    def test_crop_pad_stretch_preserve_batch_and_pixels(self):
        for dtype in (torch.float32, torch.float16):
            image = torch.arange(256, dtype=dtype).view(1, 1, 256, 1).expand(2, 128, 256, 3).clone() / 256
            image[1] = 1 - image[0]
            original = image.clone()
            for mode in ("crop", "pad", "stretch"):
                with self.subTest(dtype=dtype, mode=mode):
                    output, width, height, resolution = cut.WZQCut.execute(image, "manual", 128, mode).result
                    self.assertEqual((width, height, resolution), (128, 128, 128))
                    self.assertEqual(output.shape, (2, 128, 128, 3))
                    self.assertEqual((output.dtype, output.device), (image.dtype, image.device))
                    if mode == "crop":
                        torch.testing.assert_close(output, image[:, :, 64:192])
                    elif mode == "pad":
                        self.assertEqual(torch.count_nonzero(output[:, :32]).item(), 0)
                        self.assertEqual(torch.count_nonzero(output[:, 96:]).item(), 0)
                        torch.testing.assert_close(output[:, 32:96].sum(dim=0), torch.ones_like(output[0, 32:96]))
                    else:
                        self.assertLess(output[0, 0, 0, 0].item(), 0.01)
                        self.assertGreater(output[0, -1, -1, 0].item(), 0.99)
                    torch.testing.assert_close(image, original)

    def test_selected_sizes_are_stable_and_aligned(self):
        for resolution in (128, 256, 1024, 1440, 4096):
            for width, height in ((1, 10000), (10000, 1), (1920, 1080), (1000, 1000)):
                target = cut._pick_target_size(width, height, resolution)
                self.assertTrue(all(128 <= side <= 4096 and side % 32 == 0 for side in target))
                self.assertEqual(cut._verify_fixed_point(*target, resolution), target)


if __name__ == "__main__":
    unittest.main()

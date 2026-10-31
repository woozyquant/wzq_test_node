import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parents[1]))
PACKAGE = "wzq_pose_gallery_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "wzq")]
routes = web.RouteTableDef()
server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.pose_gallery", ROOT / "wzq" / "pose_gallery.py")
gallery = importlib.util.module_from_spec(spec)
previous_server = sys.modules.get("server")
sys.modules[PACKAGE] = package
sys.modules["server"] = server
try:
    spec.loader.exec_module(gallery)
finally:
    if previous_server is None:
        sys.modules.pop("server", None)
    else:
        sys.modules["server"] = previous_server


class PoseGalleryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = Path(self.temp.name) / "中文 姿势库"
        for name in ("data", "img", "thumbs"):
            (self.library / name).mkdir(parents=True, exist_ok=True)
        self.pose_id = "full_sexy_P031_front"
        self.row = {"id": self.pose_id, "体系": "全身", "分类": "跪姿", "姿势名称": "双手脑后",
                    "角度": "正面", "原图": f"img/{self.pose_id}.png", "缩略图": f"thumbs/{self.pose_id}.jpg",
                    "prompt_zh": "中文参考提示词", "prompt_en": "English reference prompt"}
        self.write_catalog()
        Image.new("RGBA", (9, 12), (255, 0, 0, 0)).save(self.library / self.row["原图"])
        Image.new("RGB", (3, 4), "white").save(self.library / self.row["缩略图"])
        library_patch = patch.object(gallery, "LIBRARY", self.library.resolve())
        library_patch.start()
        self.addCleanup(library_patch.stop)
        gallery._read_catalog.cache_clear()
        self.addCleanup(gallery._read_catalog.cache_clear)

    def write_catalog(self):
        (self.library / "data/catalog.json").write_text(json.dumps({"items": [self.row]}), encoding="utf-8")

    def test_v3_schema_and_image_output(self):
        info = gallery.WZQPoseGallery.GET_NODE_INFO_V1()
        self.assertEqual(info["name"], "wzq-pose-gallery")
        self.assertEqual(info["output"], ["IMAGE", "INT", "INT", "STRING", "STRING"])
        self.assertIs(gallery.WZQPoseGallery.validate_inputs(self.pose_id), True)
        image, width, height, pose_id, description = gallery.WZQPoseGallery.execute(self.pose_id).result
        self.assertEqual(tuple(image.shape), (1, 12, 9, 3))
        self.assertEqual((width, height, pose_id), (9, 12, self.pose_id))
        self.assertEqual(str(image.dtype), "torch.float32")
        self.assertTrue(bool((image == 1).all()), "Transparent pixels must composite onto white")
        self.assertEqual(description, "全身 / 跪姿 / 双手脑后 / 正面")

    def test_untrusted_paths_and_ids(self):
        for kind, filename in (("data", "catalog.json"), ("img", "../catalog.json"),
                               ("img", "..\\catalog.json"), ("img", "C:secret.png"),
                               ("img", self.pose_id + ".jpg"), ("img", "unknown.png")):
            with self.subTest(kind=kind, filename=filename), self.assertRaises(ValueError):
                gallery.asset(kind, filename)
        self.assertIn("未知姿势", gallery.WZQPoseGallery.validate_inputs("../../secret"))
        with self.assertRaises(ValueError):
            gallery.WZQPoseGallery.execute("unknown")

    def test_metadata_cannot_point_outside_library(self):
        self.row["原图"] = "../secret.png"
        self.write_catalog()
        with self.assertRaises(ValueError):
            gallery.original(self.pose_id)

    def test_fingerprint_changes_with_image_and_metadata(self):
        first = gallery.WZQPoseGallery.fingerprint_inputs(self.pose_id)
        Image.new("RGB", (9, 12), "black").save(self.library / self.row["原图"])
        second = gallery.WZQPoseGallery.fingerprint_inputs(self.pose_id)
        self.assertNotEqual(first, second)
        self.row["姿势名称"] = "另一种姿势"
        self.write_catalog()
        self.assertNotEqual(second, gallery.WZQPoseGallery.fingerprint_inputs(self.pose_id))

    def test_missing_library_and_image(self):
        (self.library / self.row["原图"]).unlink()
        self.assertIn("图片缺失", gallery.WZQPoseGallery.validate_inputs(self.pose_id))
        (self.library / "data/catalog.json").unlink()
        self.assertIn("找不到姿势清单", gallery.WZQPoseGallery.validate_inputs(self.pose_id))

    def test_catalog_is_cached_without_scanning_images(self):
        with patch.object(gallery, "asset", side_effect=AssertionError("catalog must not check images")):
            first = gallery.catalog_data()
            second = gallery.catalog_data()
        self.assertIs(first, second)
        row = json.loads(first[1])[0]
        self.assertNotIn("prompt_zh", row)
        self.assertNotIn("prompt_en", row)
        self.assertEqual(row["原图"], f"assets/img/{self.pose_id}.png")
        self.row["姿势名称"] = "更新后的姿势名称"
        self.write_catalog()
        refreshed = gallery.catalog_data()
        self.assertNotEqual(first[2], refreshed[2])
        self.assertEqual(json.loads(refreshed[1])[0]["姿势名称"], self.row["姿势名称"])

    def test_symlink_escape(self):
        outside = Path(self.temp.name) / "outside.png"
        Image.new("RGB", (2, 2)).save(outside)
        target = self.library / self.row["原图"]
        target.unlink()
        try:
            target.symlink_to(outside)
        except OSError:
            self.skipTest("Windows requires developer mode or symlink privilege")
        with self.assertRaises(ValueError):
            gallery.original(self.pose_id)

    async def test_http_routes(self):
        application = web.Application()
        application.add_routes(routes)
        async with TestClient(TestServer(application)) as client:
            response = await client.get("/wzq/pose-gallery/")
            self.assertEqual(response.status, 200)
            self.assertIn('id="usePose"', await response.text())
            response = await client.get("/wzq/pose-gallery/catalog")
            self.assertEqual((await response.json())[0]["原图"], f"assets/img/{self.pose_id}.png")
            etag = response.headers["ETag"]
            response = await client.get("/wzq/pose-gallery/catalog", headers={"If-None-Match": etag})
            self.assertEqual(response.status, 304)
            self.assertEqual(await response.read(), b"")
            self.row["姿势名称"] = "更改后的姿势"
            self.write_catalog()
            response = await client.get("/wzq/pose-gallery/catalog", headers={"If-None-Match": etag})
            self.assertEqual(response.status, 200)
            self.assertNotEqual(response.headers["ETag"], etag)
            response = await client.get(f"/wzq/pose-gallery/pose/{self.pose_id}")
            data = await response.json()
            self.assertEqual((data["width"], data["height"]), (9, 12))
            self.assertEqual(data["prompt_zh"], self.row["prompt_zh"])
            image = Image.new("RGB", (9, 12))
            exif = Image.Exif()
            exif[274] = 6
            image.save(self.library / self.row["原图"], exif=exif)
            response = await client.get(f"/wzq/pose-gallery/pose/{self.pose_id}")
            data = await response.json()
            self.assertEqual((data["width"], data["height"]), (12, 9))
            response = await client.get(f"/wzq/pose-gallery/assets/img/{self.pose_id}.png")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "image/png")
            (self.library / self.row["缩略图"]).unlink()
            response = await client.get(f"/wzq/pose-gallery/assets/thumbs/{self.pose_id}.jpg")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "image/png")
            for url in ("pose/unknown", "assets/data/catalog.json", "assets/img/unknown.png"):
                response = await client.get("/wzq/pose-gallery/" + url)
                self.assertEqual(response.status, 404)
            (self.library / "data/catalog.json").unlink()
            response = await client.get("/wzq/pose-gallery/catalog")
            self.assertEqual(response.status, 503)
            self.assertIn("error", await response.json())


if __name__ == "__main__":
    unittest.main()

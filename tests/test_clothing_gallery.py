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
PACKAGE = "wzq_clothing_gallery_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "wzq")]
routes = web.RouteTableDef()
server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.clothing_gallery", ROOT / "wzq" / "clothing_gallery.py")
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


class ClothingGalleryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.library = Path(self.temp.name) / "中文 服装素材库"
        for name in ("data", "assets/original", "assets/display", "assets/thumb"):
            (self.library / name).mkdir(parents=True, exist_ok=True)
        self.clothing_id = "SPR-0001"
        self.row = {
            "id": self.clothing_id, "category_id": "spring", "category_zh": "春季", "category_en": "Spring",
            "keywords_en": ["white", "knit"], "tags_zh": ["白色", "针织"], "tags_en": ["white", "knit"],
            "system_tags_zh": ["无人物"], "prompt_zh": "中文服装提示词", "prompt_en": "English clothing prompt",
            "prompt_note_zh": "参考提示词", "negative_prompt_zh": "人物", "negative_prompt_en": "person",
            "files": {kind: f"assets/{kind}/{self.clothing_id}.{suffix}"
                      for kind, suffix in (("original", "png"), ("display", "webp"), ("thumb", "webp"))},
        }
        self.write_catalog()
        Image.new("RGBA", (10, 15), (255, 0, 0, 0)).save(self.library / self.row["files"]["original"])
        for kind in ("display", "thumb"):
            Image.new("RGB", (4, 6), "white").save(self.library / self.row["files"][kind])
        library_patch = patch.object(gallery, "LIBRARY", self.library.resolve())
        library_patch.start()
        self.addCleanup(library_patch.stop)
        gallery._read_catalog.cache_clear()
        self.addCleanup(gallery._read_catalog.cache_clear)

    def write_catalog(self):
        (self.library / "data/catalog.json").write_text(json.dumps({
            "items": [self.row], "categories": [{"id": "spring", "name_zh": "春季", "count": 1}],
        }), encoding="utf-8")

    def test_v3_output_uses_original_size_and_white_background(self):
        info = gallery.WZQClothingGallery.GET_NODE_INFO_V1()
        self.assertEqual(info["name"], "wzq-clothing-gallery")
        self.assertEqual(info["output"], ["IMAGE", "INT", "INT", "STRING", "STRING"])
        self.assertEqual(info["output_name"], ["image", "width", "height", "clothing_id", "description"])
        self.assertIs(gallery.WZQClothingGallery.validate_inputs(self.clothing_id), True)
        image, width, height, clothing_id, description = gallery.WZQClothingGallery.execute(self.clothing_id).result
        self.assertEqual(tuple(image.shape), (1, 15, 10, 3))
        self.assertEqual(str(image.dtype), "torch.float32")
        self.assertTrue(bool((image == 1).all()))
        self.assertEqual((width, height, clothing_id), (10, 15, self.clothing_id))
        self.assertEqual(description, "春季 / 白色、针织")

    def test_paths_are_checked_at_actual_image_access(self):
        for kind, filename in (("data", "catalog.json"), ("original", "../secret.png"),
                               ("thumb", "..\\secret.webp"), ("original", "C:secret.png"),
                               ("original", "unknown.png"), ("original", self.clothing_id + ".webp")):
            with self.subTest(kind=kind, filename=filename), self.assertRaises(ValueError):
                gallery.asset(kind, filename)
        outside = Path(self.temp.name) / "outside.png"
        with patch.object(Path, "resolve", return_value=outside), self.assertRaises(ValueError):
            gallery.original(self.clothing_id)
        self.row["files"]["original"] = "../secret.png"
        self.write_catalog()
        with self.assertRaises(ValueError):
            gallery.original(self.clothing_id)

    def test_catalog_cache_never_scans_asset_files(self):
        with patch.object(gallery, "asset", side_effect=AssertionError("catalog must not scan images")):
            first = gallery.catalog_data()
            second = gallery.catalog_data()
        self.assertIs(first, second)
        data = json.loads(first[1])
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["categories"][0]["id"], "spring")
        self.assertNotIn("prompt_zh", data["items"][0])
        self.row["tags_zh"].append("新增标签")
        self.write_catalog()
        self.assertNotEqual(first[2], gallery.catalog_data()[2])

    def test_fingerprint_updates_for_image_and_metadata(self):
        first = gallery.WZQClothingGallery.fingerprint_inputs(self.clothing_id)
        Image.new("RGB", (10, 15), "black").save(self.library / self.row["files"]["original"])
        second = gallery.WZQClothingGallery.fingerprint_inputs(self.clothing_id)
        self.assertNotEqual(first, second)
        self.row["tags_zh"].append("新标签")
        self.write_catalog()
        self.assertNotEqual(second, gallery.WZQClothingGallery.fingerprint_inputs(self.clothing_id))

    def test_invalid_id_and_missing_library_are_actionable(self):
        self.assertIn("未知服装", gallery.WZQClothingGallery.validate_inputs("unknown"))
        with self.assertRaises(ValueError):
            gallery.WZQClothingGallery.execute("unknown")
        (self.library / self.row["files"]["original"]).unlink()
        self.assertIn("图片缺失", gallery.WZQClothingGallery.validate_inputs(self.clothing_id))
        (self.library / "data/catalog.json").unlink()
        self.assertIn("WZQ_CLOTHING_GALLERY_LIBRARY", gallery.WZQClothingGallery.validate_inputs(self.clothing_id))

    async def test_gallery_routes_and_lazy_details(self):
        application = web.Application()
        application.add_routes(routes)
        async with TestClient(TestServer(application)) as client:
            response = await client.get("/wzq/clothing-gallery/")
            self.assertEqual(response.status, 200)
            self.assertIn('id="useClothing"', await response.text())
            response = await client.get("/wzq/clothing-gallery/catalog")
            etag = response.headers["ETag"]
            self.assertEqual((await response.json())["total"], 1)
            response = await client.get("/wzq/clothing-gallery/catalog", headers={"If-None-Match": etag})
            self.assertEqual(response.status, 304)
            self.row["tags_zh"].append("更新")
            self.write_catalog()
            response = await client.get("/wzq/clothing-gallery/catalog", headers={"If-None-Match": etag})
            self.assertEqual(response.status, 200)
            self.assertNotEqual(response.headers["ETag"], etag)
            response = await client.get(f"/wzq/clothing-gallery/clothing/{self.clothing_id}")
            row = await response.json()
            self.assertEqual(row["prompt_zh"], self.row["prompt_zh"])
            self.assertEqual((row["width"], row["height"]), (10, 15))
            exif = Image.Exif()
            exif[274] = 6
            Image.new("RGB", (10, 15)).save(self.library / self.row["files"]["original"], exif=exif)
            response = await client.get(f"/wzq/clothing-gallery/clothing/{self.clothing_id}")
            row = await response.json()
            self.assertEqual((row["width"], row["height"]), (15, 10))
            for kind, suffix in (("original", "png"), ("display", "webp")):
                response = await client.get(f"/wzq/clothing-gallery/assets/{kind}/{self.clothing_id}.{suffix}")
                self.assertEqual(response.status, 200)
                await response.read()
            (self.library / self.row["files"]["thumb"]).unlink()
            response = await client.get(f"/wzq/clothing-gallery/assets/thumb/{self.clothing_id}.webp")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.content_type, "image/png")
            await response.read()
            for path in ("clothing/unknown", "assets/data/catalog.json", "assets/original/unknown.png"):
                response = await client.get("/wzq/clothing-gallery/" + path)
                self.assertEqual(response.status, 404)
            (self.library / "data/catalog.json").unlink()
            response = await client.get("/wzq/clothing-gallery/catalog")
            self.assertEqual(response.status, 503)


if __name__ == "__main__":
    unittest.main()

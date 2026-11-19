import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request


ROOT = Path(__file__).resolve().parents[1]
routes = web.RouteTableDef()
server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
folders = types.SimpleNamespace(get_full_path=lambda category, name: None)
spec = importlib.util.spec_from_file_location("wzq_lora_gallery_test", ROOT / "wzq" / "gallery_server.py")
gallery = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"server": server, "folder_paths": folders}):
    spec.loader.exec_module(gallery)


class LoraGalleryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.entries = []
        for name, timestamp in (("z-old.safetensors", 1000), ("a-new.safetensors", 3000),
                                ("m-middle.safetensors", 2000), ("b-new.safetensors", 3000)):
            path = self.directory / name
            path.touch()
            os.utime(path, (timestamp, timestamp))
            self.entries.append({"name": name, "folder": "", "tags": ["test"]})
        for mock in (
            patch.object(gallery, "_all_entries", return_value=self.entries),
            patch.object(gallery.folder_paths, "get_full_path", side_effect=lambda category, name: str(self.directory / name)),
            patch.object(gallery, "_store_path", return_value=self.directory / "state.json"),
            patch.object(gallery, "__file__", str(self.directory / "wzq_test_node" / "wzq" / "gallery_server.py")),
        ):
            mock.start()
            self.addCleanup(mock.stop)

    async def listing(self, query=""):
        response = await gallery.localloragallery_get_loras(make_mocked_request("GET", "/?" + query))
        self.assertEqual(response.status, 200, response.text)
        return json.loads(response.text)

    async def test_date_sort_uses_file_mtime_with_name_tiebreaker(self):
        for order, expected in (
            ("date_desc", ["a-new.safetensors", "b-new.safetensors", "m-middle.safetensors", "z-old.safetensors"]),
            ("date_asc", ["z-old.safetensors", "m-middle.safetensors", "a-new.safetensors", "b-new.safetensors"]),
        ):
            with self.subTest(order=order):
                data = await self.listing(f"sort_order={order}&selected_loras=m-middle.safetensors")
                self.assertEqual([item["name"] for item in data["loras"]], expected)

    async def test_default_and_unknown_sort_keep_selected_first(self):
        for order in ("", "name", "unknown"):
            with self.subTest(order=order):
                data = await self.listing(f"sort_order={order}&selected_loras=z-old.safetensors")
                self.assertEqual([item["name"] for item in data["loras"]],
                                 ["z-old.safetensors", "a-new.safetensors", "b-new.safetensors", "m-middle.safetensors"])

    async def test_sort_precedes_pagination_and_works_with_filters(self):
        with patch.object(gallery, "PAGE_SIZE", 1):
            first = await self.listing("sort_order=date_desc&name_filter=new&filter_tag=test")
            second = await self.listing("sort_order=date_desc&name_filter=new&filter_tag=test&page=2")
        self.assertEqual(first["total_pages"], 2)
        self.assertEqual(first["loras"][0]["name"], "a-new.safetensors")
        self.assertEqual(second["loras"][0]["name"], "b-new.safetensors")

    async def test_unavailable_files_sort_last_in_both_directions(self):
        self.entries.append({"name": "missing.safetensors", "folder": "", "tags": []})
        self.entries.append({"name": "unresolved.safetensors", "folder": "", "tags": []})
        with patch.object(gallery.folder_paths, "get_full_path", side_effect=lambda category, name:
                          None if name == "unresolved.safetensors" else str(self.directory / name)):
            for order in ("date_desc", "date_asc"):
                with self.subTest(order=order):
                    data = await self.listing(f"sort_order={order}")
                    self.assertEqual([item["name"] for item in data["loras"]][-2:],
                                     ["missing.safetensors", "unresolved.safetensors"])

    async def test_sort_preference_survives_selection_and_collapse_updates(self):
        for state in ({"sort_order": "date_desc", "filter_tag": "test"},
                      {"lora_stack": [{"lora": "a-new.safetensors"}]}, {"is_collapsed": True}):
            request = types.SimpleNamespace(json=AsyncMock(return_value={
                "node_id": "1", "gallery_id": "gallery", "state": state,
            }))
            await gallery.localloragallery_set_ui_state(request)
        response = await gallery.localloragallery_get_ui_state(
            make_mocked_request("GET", "/?node_id=1&gallery_id=gallery"))
        state = json.loads(response.text)
        self.assertEqual(state["sort_order"], "date_desc")
        self.assertEqual(state["filter_tag"], "test")
        self.assertEqual(state["lora_stack"], [{"lora": "a-new.safetensors"}])
        self.assertTrue(state["is_collapsed"])

    async def test_routes_do_not_collide_with_other_gallery(self):
        app = web.Application()

        async def other_gallery(request):
            return web.json_response({"loras": [{"name": "other-gallery"}]})

        app.router.add_get("/localloragallery/get_loras", other_gallery)
        app.add_routes(routes)
        self.assertTrue(all(route.path.startswith("/wzq/localloragallery/") for route in routes))
        async with TestClient(TestServer(app)) as client:
            old = await client.get("/localloragallery/get_loras?sort_order=date_desc")
            self.assertEqual((await old.json())["loras"][0]["name"], "other-gallery")
            newest = await client.get("/wzq/localloragallery/get_loras?sort_order=date_desc")
            oldest = await client.get("/wzq/localloragallery/get_loras?sort_order=date_asc")
            self.assertEqual((await newest.json())["loras"][0]["name"], "a-new.safetensors")
            self.assertEqual((await oldest.json())["loras"][0]["name"], "z-old.safetensors")

    async def test_existing_gallery_data_is_imported_and_saved_independently(self):
        directory = self.directory / "ComfyUI_Local_Lora_Gallery"
        directory.mkdir()
        data = {
            "metadata": {"a-new.safetensors": {"tags": ["saved"], "trigger_words": "trigger"}},
            "presets": {"saved-preset": [{"lora": "a-new.safetensors"}]},
            "ui_state": {"gallery-with_under_1": {"filter_tag": "saved", "is_collapsed": True}},
        }
        for key, value in data.items():
            (directory / f"lora_gallery_{key}.json").write_text(json.dumps(value), encoding="utf-8")
        store = gallery._load_store()
        self.assertEqual(store["metadata"], data["metadata"])
        self.assertEqual(store["presets"], data["presets"])
        self.assertEqual(store["ui_state"]["1:gallery-with_under"], data["ui_state"]["gallery-with_under_1"])
        gallery._save_store(store)
        (directory / "lora_gallery_metadata.json").write_text("{}", encoding="utf-8")
        self.assertEqual(gallery._load_store(), store)


if __name__ == "__main__":
    unittest.main()

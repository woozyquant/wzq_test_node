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


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "wzq_prompt_manager_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "wzq")]
server = types.SimpleNamespace(
    PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef()))
)
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.prompt_manager", ROOT / "wzq" / "prompt_manager.py")
manager = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {PACKAGE: package, "server": server}):
    spec.loader.exec_module(manager)


class PromptManagerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.config_path = self.directory / "prompt_manager.json"
        for name, value in (
            ("CONFIG_PATH", self.config_path),
            ("PROMPTS_ROOT", self.directory / "prompts"),
            ("_index_cache", None),
        ):
            setting = patch.object(manager, name, value)
            setting.start()
            self.addCleanup(setting.stop)

    def configure(self, value):
        self.config_path.write_text(json.dumps({"prompts_dir": value}), encoding="utf-8")
        manager.PROMPTS_ROOT = manager._load_prompt_root()
        return manager.PROMPTS_ROOT

    def test_new_computer_creates_portable_default_config(self):
        self.assertEqual(manager._load_prompt_root(), self.directory / "prompts")
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8")), {"prompts_dir": "prompts"})
        self.assertTrue(manager._ensure_prompt_root().is_dir())

    def test_absolute_path_with_unicode_and_bom_preserves_config(self):
        expected = self.directory / "外部 提示词库"
        self.config_path.write_text(json.dumps({"prompts_dir": str(expected)}), encoding="utf-8-sig")
        original = self.config_path.read_bytes()
        manager.PROMPTS_ROOT = manager._load_prompt_root()
        self.assertEqual(manager._ensure_prompt_root(), expected)
        self.assertTrue(expected.is_dir())
        self.assertEqual(self.config_path.read_bytes(), original)

    def test_relative_path_uses_config_directory_instead_of_working_directory(self):
        with patch("os.getcwd", return_value=str(self.directory.parent)):
            self.assertEqual(self.configure("local/library"), self.directory / "local" / "library")

    def test_environment_variables_and_home_directory(self):
        with patch.dict(os.environ, {"WZQ_TEST_PROMPTS": str(self.directory)}):
            variable = "%WZQ_TEST_PROMPTS%" if os.name == "nt" else "$WZQ_TEST_PROMPTS"
            self.assertEqual(self.configure(variable), self.directory)
        self.assertEqual(self.configure("~/wzq-prompts"), (Path.home() / "wzq-prompts").resolve())

    def test_invalid_config_does_not_fall_back_or_overwrite(self):
        cases = ["{", "[]", "{}", '{"prompts_dir": null}', '{"prompts_dir": 123}',
                 '{"prompts_dir": " "}', '{"prompts_dir": "\\u0000"}']
        for content in cases:
            with self.subTest(content=content):
                self.config_path.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "prompt_manager.json"):
                    manager._load_prompt_root()
                self.assertEqual(self.config_path.read_text(encoding="utf-8"), content)
        self.assertFalse((self.directory / "prompts").exists())

    def test_path_pointing_to_file_reports_error(self):
        target = self.directory / "file.txt"
        target.write_text("keep", encoding="utf-8")
        self.configure(str(target))
        with self.assertRaises(FileExistsError):
            manager._ensure_prompt_root()
        self.assertEqual(target.read_text(encoding="utf-8"), "keep")
        self.assertFalse((self.directory / "prompts").exists())

    async def test_save_list_read_and_rename_use_configured_library(self):
        library = self.configure(str(self.directory / "外部库"))
        category = library / "通用"
        category.mkdir(parents=True)
        request = types.SimpleNamespace(json=AsyncMock(return_value={
            "category": "通用", "name": "风景", "content": "清晨的湖泊",
        }))
        response = await manager.prompt_manager_save(request)
        self.assertEqual(response.status, 200)
        self.assertEqual((category / "风景.txt").read_text(encoding="utf-8"), "清晨的湖泊")
        listing = manager._library_payload()
        self.assertEqual(listing["categories"][0]["prompts"][0]["path"], "通用/风景.txt")
        read_request = types.SimpleNamespace(rel_url=types.SimpleNamespace(query={"path": "通用/风景.txt"}))
        response = await manager.prompt_manager_read(read_request)
        self.assertEqual(json.loads(response.text)["content"], "清晨的湖泊")
        rename_request = types.SimpleNamespace(json=AsyncMock(return_value={
            "path": "通用/风景.txt", "name": "湖泊",
        }))
        response = await manager.prompt_manager_rename(rename_request)
        self.assertEqual(response.status, 200)
        self.assertEqual((category / "湖泊.txt").read_text(encoding="utf-8"), "清晨的湖泊")
        self.assertFalse((category / "风景.txt").exists())
        self.assertFalse((self.directory / "prompts").exists())

    def test_browser_paths_cannot_escape_configured_library(self):
        self.configure(str(self.directory / "external"))
        for value in ("../secret.txt", "category/../../secret.txt", "/secret.txt", str(self.config_path)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                manager._safe_path(value, require_file=True)


if __name__ == "__main__":
    unittest.main()

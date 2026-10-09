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
PACKAGE = "wzq_folder_shortcuts_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT / "wzq")]
routes = web.RouteTableDef()
server = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
folders = types.SimpleNamespace(
    get_output_directory=lambda: str(ROOT / "output"),
    get_input_directory=lambda: str(ROOT / "input"),
    models_dir=str(ROOT / "models"),
)
spec = importlib.util.spec_from_file_location(f"{PACKAGE}.folder_shortcuts", ROOT / "wzq" / "folder_shortcuts.py")
shortcuts = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {PACKAGE: package, "server": server, "folder_paths": folders}):
    spec.loader.exec_module(shortcuts)


class FolderShortcutsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / "中文 素材 & files"
        self.directory.mkdir()
        self.config_path = Path(self.temporary.name) / "folder_shortcuts.json"
        config_patch = patch.object(shortcuts, "CONFIG_PATH", self.config_path)
        config_patch.start()
        self.addCleanup(config_patch.stop)

    async def request(self, payload):
        return await shortcuts.folder_shortcuts_open(types.SimpleNamespace(json=AsyncMock(return_value=payload)))

    async def test_open_existing_directory(self):
        with patch.object(shortcuts, "_open_directory") as launch:
            response = await self.request({"path": str(self.directory)})
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.text)["path"], str(self.directory.resolve()))
        launch.assert_called_once_with(self.directory.resolve())

    async def test_invalid_paths_never_launch(self):
        file = self.directory / "file.txt"
        file.write_text("test", encoding="utf-8")
        cases = [
            ({"path": str(file)}, 404),
            ({"path": str(self.directory / "missing")}, 404),
            ({"path": "relative/path"}, 400),
            ({"path": "https://example.com"}, 400),
            ({"path": ""}, 400),
            ({"path": "\0"}, 400),
            ({"path": [str(self.directory)]}, 400),
            ({}, 400),
            ([], 400),
        ]
        with patch.object(shortcuts, "_open_directory") as launch:
            for payload, status in cases:
                with self.subTest(payload=payload):
                    response = await self.request(payload)
                    self.assertEqual(response.status, status)
                    self.assertIn("error", json.loads(response.text))
        launch.assert_not_called()

    def test_environment_variables_and_copied_quotes(self):
        with patch.dict(os.environ, {"WZQ_TEST_FOLDER": str(self.directory)}):
            variable = "%WZQ_TEST_FOLDER%" if os.name == "nt" else "$WZQ_TEST_FOLDER"
            self.assertEqual(shortcuts._directory(f'"{variable}"'), self.directory.resolve())

    async def test_malformed_json(self):
        request = types.SimpleNamespace(json=AsyncMock(side_effect=ValueError("Invalid JSON")))
        with patch.object(shortcuts, "_open_directory") as launch:
            response = await shortcuts.folder_shortcuts_open(request)
        self.assertEqual(response.status, 400)
        launch.assert_not_called()

    async def test_os_error_is_reported(self):
        with patch.object(shortcuts, "_open_directory", side_effect=PermissionError("denied")):
            response = await self.request({"path": str(self.directory)})
        self.assertEqual(response.status, 500)
        self.assertIn("denied", json.loads(response.text)["error"])

    def test_platform_launch_passes_path_without_a_shell(self):
        directory = str(self.directory)
        with patch.object(shortcuts.sys, "platform", "win32"), patch.object(shortcuts.os, "startfile", create=True) as start:
            shortcuts._open_directory(self.directory)
            start.assert_called_once_with(directory, "open")
        for platform, command in [("darwin", "open"), ("linux", "xdg-open")]:
            with patch.object(shortcuts.sys, "platform", platform), patch.object(shortcuts.subprocess, "Popen") as launch:
                shortcuts._open_directory(self.directory)
                launch.assert_called_once_with([command, directory])

    async def test_default_paths_and_ui_only_node(self):
        response = await shortcuts.folder_shortcuts_config(None)
        items = json.loads(response.text)["items"]
        self.assertEqual(len(items), 4)
        self.assertEqual(items[0]["path"], folders.get_output_directory())
        self.assertEqual(items[-1]["path"], str(ROOT))
        self.assertEqual(shortcuts.WZQFolderShortcuts.CATEGORY, "WZQ/工具")
        self.assertEqual(shortcuts.WZQFolderShortcuts().execute(), ())
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8"))["items"], items)

    async def save(self, payload):
        return await shortcuts.folder_shortcuts_save(types.SimpleNamespace(json=AsyncMock(return_value=payload)))

    async def test_json_save_and_reload(self):
        config = {"items": [{"name": "自定义 中文素材", "path": str(self.directory)}]}
        response = await self.save(config)
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8")), config)
        self.assertIn("自定义 中文素材", self.config_path.read_text(encoding="utf-8"))
        response = await shortcuts.folder_shortcuts_config(None)
        self.assertEqual(json.loads(response.text)["items"], config["items"])
        self.assertEqual(json.loads(response.text)["config_path"], str(self.config_path))

    async def test_manual_json_edit_and_empty_list(self):
        config = {"items": [{"name": "手工编辑", "path": str(self.directory)}]}
        self.config_path.write_text(json.dumps(config), encoding="utf-8-sig")
        response = await shortcuts.folder_shortcuts_config(None)
        self.assertEqual(json.loads(response.text)["items"], config["items"])
        self.assertEqual((await self.save({"items": []})).status, 200)
        response = await shortcuts.folder_shortcuts_config(None)
        self.assertEqual(json.loads(response.text)["items"], [])

    async def test_bad_json_is_reported_without_overwriting(self):
        for content in ["{bad json", '{"items": "invalid"}', '{"items": [{"name": "Bad", "path": "relative"}]}']:
            with self.subTest(content=content):
                self.config_path.write_text(content, encoding="utf-8")
                response = await shortcuts.folder_shortcuts_config(None)
                self.assertEqual(response.status, 500)
                self.assertEqual(self.config_path.read_text(encoding="utf-8"), content)

    async def test_invalid_save_preserves_previous_config(self):
        previous = {"items": [{"name": "原路径", "path": str(self.directory)}]}
        await self.save(previous)
        for payload in [None, [], {}, {"items": "invalid"}, {"items": [{}]}, {"items": [{"name": "", "path": str(self.directory)}]}, {"items": [{"name": "Bad", "path": "relative"}]}]:
            with self.subTest(payload=payload):
                response = await self.save(payload)
                self.assertEqual(response.status, 400)
                self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8")), previous)

    async def test_failed_replace_preserves_file_and_removes_temporary(self):
        previous = {"items": []}
        await self.save(previous)
        with patch.object(shortcuts.os, "replace", side_effect=PermissionError("denied")):
            response = await self.save({"items": [{"name": "素材", "path": str(self.directory)}]})
        self.assertEqual(response.status, 500)
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8")), previous)
        self.assertEqual(list(self.config_path.parent.glob(".folder_shortcuts-*.tmp")), [])

    async def test_save_environment_variable_and_offline_directory(self):
        with patch.dict(os.environ, {"WZQ_TEST_FOLDER": str(self.directory)}):
            variable = "%WZQ_TEST_FOLDER%" if os.name == "nt" else "$WZQ_TEST_FOLDER"
            config = {"items": [{"name": "环境变量", "path": variable}, {"name": "未挂载", "path": str(self.directory / "offline")} ]}
            self.assertEqual((await self.save(config)).status, 200)
        self.assertEqual(json.loads(self.config_path.read_text(encoding="utf-8")), config)


if __name__ == "__main__":
    unittest.main()

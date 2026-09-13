# lorainfo 前端模块架构说明

本文档描述 `js/lorainfo/` 的加载架构，以及它与 `js/lorainfo_loader.js` 的关系。

## 背景：ComfyUI 如何加载 WEB_DIRECTORY 下的 JS

`server.py` 的 `/extensions` 路由会**递归**收集扩展目录下的所有 `*.js`：

```python
files = glob.glob(os.path.join(glob.escape(dir), '**/*.js'), recursive=True)
```

前端 `loadExtensions()` 再对其中每一个执行 `import(fileURL(path))`。
也就是说 **`js/` 下每一个 `.js` 文件（含所有子目录）都会被当成一个独立的扩展模块加载**，
顺序不保证，也无法通过目录结构规避。

## 问题

如果让 `js/lorainfo/` 里的 8 个辅助文件各自作为顶层扩展被加载：

1. `/extensions` 列表里混入大量无意义的顶层模块；
2. 模块求值顺序不可控，只靠 ESM 依赖图偶然保证正确；
3. 目录里一旦存在断链或命名异常的文件（例如带空格的文件名），会直接产生加载报错。

## 方案：单点 loader

- `js/lorainfo_loader.js` 是 `js/` 根目录下唯一与本模块相关的扩展入口；
- 它用 ESM 静态 `import` 引入 `lorainfo.js`，依赖顺序交给依赖图，不手动编排；
- 加载完成后暴露稳定的 `window.lorainfoModules`，并派发 `lorainfo-modules-ready` 事件；
- 消费方通过导出的 `getLorainfoModules()` 获取类，不要直接 import `lorainfo/` 内部文件。

`js/lorainfo/` **保持原目录名不变**。目录内所有 import 都是相对路径（`./xxx.js`），
改成其他目录名不会带来任何收益，反而会与既有的 `injectCss` 绝对路径、文档和历史配置产生不一致。

## 目录结构

```
js/
├── lorainfo_loader.js          # 唯一入口：暴露 window.lorainfoModules + ready 事件
├── myLoraLoader.js             # 消费方
├── myMultiLoraLoader.js        # 消费方
├── Local_Lora_Only_Gallery.js  # 消费方
└── lorainfo/
    ├── lorainfo.js             # RgthreeLoraInfoDialog / RgthreeCheckpointInfoDialog
    ├── dialog.js               # RgthreeDialog 基类
    ├── menu.js                 # 菜单组件
    ├── model_info_service.js   # 模型信息服务
    ├── rgthree_api.js          # 本地化的模型信息 API
    ├── shared_utils.js         # 通用工具（injectCss 等）
    ├── svgs.js                 # SVG 图标
    ├── utils_dom.js            # DOM 工具
    └── css/
        └── dialog_model_info.css
```

## 消费方用法

```javascript
import { getLorainfoModules } from "./lorainfo_loader.js";

async function showLoraInfo(loraName) {
    const { RgthreeLoraInfoDialog } = await getLorainfoModules();
    new RgthreeLoraInfoDialog(loraName).show();
}
```

`getLorainfoModules()` 在 loader 未执行完时会等待 `lorainfo-modules-ready` 事件，
因此消费方的模块求值顺序不再重要。

## 验证

- 所有相对 import 均指向真实文件（`js/lorainfo/` 内部已逐一校验）；
- `injectCss` 自带 `link[href^=...]` 去重检查，样式只注入一次；
- 三个消费方均通过 `getLorainfoModules()` 取类，不再有 `/extensions/wzq_test_node/lorainfo/...` 硬编码静态 import。

## 历史说明

此前本文件曾描述过一套 `lorainfo_modules/` + `lorainfo_loader.js` 的重命名方案，
但该方案实际并未落地在仓库中（目录始终名为 `lorainfo/`），且把问题归因于"循环依赖"是不准确的：
当时的 import 图是完整的，真实缺陷是目录内存在一个带空格的备份文件 `lorainfo - 副本.js`，
会被 `/extensions` 当成一个模块加载。该文件已删除，本文件已按实际架构重写。

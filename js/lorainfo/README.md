# LoRA Info Dialog Module

从 rgthree-comfy 抽出的 `RgthreeLoraInfoDialog`，在 wzq_test_node 内独立运行。

## 加载方式

ComfyUI 的 `/extensions` 接口会**递归**收集 `WEB_DIRECTORY` 下所有 `.js`，前端把每一个都当作独立扩展模块 `import()`。
因此本目录不直接作为扩展入口，而是由上一层的 `js/lorainfo_loader.js` 单点加载：

```
js/lorainfo_loader.js          <- 唯一扩展入口，静态 import 本目录，暴露 window.lorainfoModules
js/lorainfo/
├── lorainfo.js                <- 主对话框实现（RgthreeLoraInfoDialog / RgthreeCheckpointInfoDialog）
├── dialog.js                  <- RgthreeDialog 基类
├── menu.js                    <- 菜单组件
├── model_info_service.js      <- 模型信息服务
├── rgthree_api.js             <- 模型信息 API（已本地化，不依赖 rgthree-comfy）
├── shared_utils.js            <- 通用工具（含 injectCss）
├── svgs.js                    <- SVG 图标
├── utils_dom.js               <- DOM 工具
└── css/dialog_model_info.css  <- 对话框样式
```

这样做的原因：模块求值顺序由 ESM 依赖图保证，且 `/extensions` 里不会出现一堆无意义的顶层模块。
本目录内所有 `import` 都是相对路径（`./xxx.js`），因此不受所在目录名影响。

## 使用方式

消费方不要直接 `import` 本目录，改从 loader 取模块：

```javascript
import { getLorainfoModules } from "./lorainfo_loader.js";

const { RgthreeLoraInfoDialog } = await getLorainfoModules();
new RgthreeLoraInfoDialog(loraName).show();
```

`getLorainfoModules()` 在 loader 尚未执行完时会等待 `lorainfo-modules-ready` 事件。
当前消费方：`myLoraLoader.js`、`myMultiLoraLoader.js`、`Local_Lora_Only_Gallery.js`。

## 已移除的外部依赖

- rgthree-comfy 的 API service → 本地 `rgthree_api.js`
- rgthree 全局对象 → 本地实现

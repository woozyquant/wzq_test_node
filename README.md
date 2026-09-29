# wzq_test_node

ComfyUI 自定义节点集合。

## 菜单结构

右键菜单里全部节点都在同一个 `WZQ` 顶层菜单下，按功能分为二级子菜单：

```
WZQ
├── 加载器            图像加载器、音频加载器
├── LoRA              LoRA Loader / Multi LoRA Loader / Local LoRA Gallery
├── 图像              智能尺寸、交互式裁剪画布、图像缩放、图像切块、遮罩合成、遮罩填孔
├── 尺寸与潜空间       Image Size、Size、Empty Latent、Empty Latent (Qwen)
├── 文本与工具         提示词管理器、Split SD Generation Data、Check String Empty、Batch Count、Easy Seed、Current Time
├── 工具              Reroute（3 个变体）
├── 视频              Video Combine V2
└── MiniMax H3         Prompt、Media Input、Media Output
```

分类只在 `wzq/categories.py` 里定义一处，各节点文件统一引用，避免再次出现同库被拆到多个顶层菜单的情况。

**注意：**节点在 `NODE_CLASS_MAPPINGS` 中的注册键（例如 `mySizexxx`、`wzq_image_out`）决定工作流里保存的节点类型，
已有工作流依赖这些键，**不要修改**。菜单位置由 `CATEGORY` 决定，节点标题由 `NODE_DISPLAY_NAME_MAPPINGS` 决定，两者都可以安全调整。

## 完整节点清单

| 菜单 | 节点显示名 | 注册键 | 作用 |
| --- | --- | --- | --- |
| 加载器 | WZQ 图像加载器 | `WZQImageLoader` | 浏览/上传/排序多张图像，输出图像列表、单图与遮罩 |
| 加载器 | WZQ 音频加载器 | `WZQAudioLoader` | 音频波形预览与非破坏性裁剪、音量调整 |
| LoRA | LoRA Loader (Model Only) | `myLoraLoaderModelOnlyxxx` | 给 MODEL 加载单个 LoRA，不改 CLIP |
| LoRA | Multi LoRA Loader (Model Only) | `myMultiLoraLoaderModelOnlyxxx` | 面板中动态增删任意数量 LoRA |
| LoRA | 🖼️Local LoRA Gallery | `myLocalLoraOnlyGalleryxxx` | 本地 LoRA 图库，输出所选 LoRA 名称 |
| 图像 | Smart Image Size | `wzq_image_out` | 创建空白图 / 缩放输入图到目标百万像素 |
| 图像 | 🖼️Interactive Canvas Crop / Extend | `myWZQCanvasExtend` | 交互式裁剪或扩展画布，输出扩展/裁剪遮罩 |
| 图像 | Image Resizer | `myImageResizer` | 把 A 缩放到 B 的尺寸 |
| 图像 | Image Tile Batch | `myImageTiled` | 按网格切分图像 |
| 图像 | 🎭Mask Applier and Combiner | `MaskApplierAndCombiner` | 多图按遮罩叠加合成，支持羽化 |
| 图像 | Mask Fill Holes | `myMaskFillHoles` | 填充遮罩内部孔洞 |
| 尺寸与潜空间 | Image Size | `myImageSizexxx` | 读取图像宽高，输出原图 + 两个整数 |
| 尺寸与潜空间 | Size (Width / Height) | `mySizexxx` | 只计算宽高：比例、覆盖、放大系数、倍数对齐 |
| 尺寸与潜空间 | Empty Latent (Resolution) | `myEmptyLatentxxx` | 按预设分辨率创建空白 LATENT |
| 尺寸与潜空间 | Empty Latent (Qwen Ratio) | `myEmptyLatentQwenxxx` | 按 Qwen 预设比例创建空白 LATENT |
| 文本与工具 | Split SD Generation Data | `mySplit` | 解析 SD / A1111 参数文本 |
| 文本与工具 | Check String Empty | `myCheckStringEmptyxxx` | 判断文本是否为空 |
| 文本与工具 | Batch Count | `myBatchCount` | 读取任意批次数据的数量 |
| 文本与工具 | Easy Seed | `myEasySeedxxx` | 输出种子整数 |
| 文本与工具 | Current Time | `myCurrentTimexxx` | 输出当前时间字符串 |
| 文本与工具 | 提示词管理器 | `WZQPromptManager` | 浏览、编辑并保存 `prompts/` 分类提示词，输出当前文本 |
| 工具 | Reroute (Any) | `myReroute` | 任意类型单路中继 |
| 工具 | Reroute (Any ×3) | `myReroute3` | 任意类型三路中继 |
| 工具 | Reroute (Model / VAE / CLIP) | `myReroutexxx` | 模型组三路中继 |
| 视频 | Video Combine V2 (WZQ) | `WZQVideoCombineV2` | 将图像帧合成 GIF/WebP/视频，可合并音频并保留元数据 |
| MiniMax H3 | MiniMax-H3 Prompt (WZQ) | `WZQMiniMaxH3Prompt` | 富文本提示词编辑，见下文 |
| MiniMax H3 | MiniMax-H3 Media Input (WZQ) | `WZQMiniMaxH3MediaInput` | 打包图像/视频/音频素材 |
| MiniMax H3 | MiniMax-H3 Media Output (WZQ) | `WZQMiniMaxH3MediaOutput` | 拆分素材包为多路输出 |

## 提示词管理器

节点左侧读取插件根目录下的 `prompts/` 文件夹：每个子文件夹会显示为分类，
其中的 `.txt`、`.md` 和 `.prompt` 文件会显示为提示词条目。单击条目会把 UTF-8
文本载入右侧编辑框；填写名称、选择按钮后的分类，可用“添加到提示词列表”保存为文件。
选中已有条目并修改名称后，可用“改名”直接重命名文件。同名文件不会静默覆盖；
保存时前端会先请求确认，改名时则会提示名称冲突。节点输出始终是右侧编辑框当前的文本。
载入、保存或改名后，点击底部状态栏显示的提示词路径，可在运行 ComfyUI 的电脑上打开该文件所在文件夹。

仓库默认提供空的 `prompts/通用/` 分类；也可以直接在 `prompts/` 下创建更多子文件夹，
再点击节点左上角的刷新按钮载入。

## wzq_image_out

用一个节点代替“分辨率选择器 / 空白图 / 缩放 / 图像尺寸获取”的常见组合。可在 `mode` 中选择：

- `创建空白图`：按画幅比例、目标百万像素和倍数对齐创建纯色图像；尺寸计算与 ComfyUI 内置 `Resolution Selector` 一致，1M 按 `1024 × 1024` 像素计算；
- `缩放输入图`：保留输入图的画幅比例，将其缩放至目标百万像素。

节点输出 `image`、`width`、`height` 和 `batch_size`。节点顶部会动态显示预估尺寸；缩放模式在无法从上游预览读取原图尺寸时，会在首次执行后改为显示实际输出尺寸。

## WZQ交互式裁剪可扩展画布

在节点内预览上游图像，通过八个控制点或直接输入宽高来裁剪/扩展画布。支持比例锁定、对齐、边界吸附、填充色、滚轮缩放和空格平移。

输出：

- `output_image`：裁剪或扩展后的图像。
- `extend_mask`：与输出图像同尺寸；新增区域为白色，原图像素为黑色。
- `image_mask`：与原图同尺寸；裁剪框覆盖到的原图区域为白色。
- `extend_data`：`left/right/top/bottom` 四边参数的 JSON 字符串。

修改或首次安装后需要重启 ComfyUI，并刷新浏览器前端资源。

## Video Combine V2 (WZQ)

从 FeiHou Toolbox 移植的 VHS 兼容视频合成节点，保留动态编码选项、节点内预览、
GIF/WebP、FFmpeg 视频、音频合并和 ComfyUI 工作流元数据。为避免与原插件冲突，
注册键为 `WZQVideoCombineV2`，预览接口使用独立的 `/wzq-vhs/*` 路由。

`frame_rate` 默认为 `24 FPS`，支持 `0.01–1000 FPS` 和三位小数步进，可直接使用 `23.976`、`29.97`、
`59.94` 等小数帧率。后端会拒绝零值、负值、NaN 和无穷值，FFmpeg 编码使用
rawvideo 输入的明确时间基，并用同一 FPS 计算音频补齐与裁切时长。GIF/WebP
会在各帧之间分摊时长取整误差，避免 `23.976 FPS` 因每帧固定取整而变成 `25 FPS`。

## MiniMax-H3 Prompt (WZQ)

从 Goohai MiniMax-H3 Integration 移植的提示词专用节点，保留：

- T2VA、I2VA、FL2VA、L2VA、Ref2VA 与 Hybrid 模式识别；
- 首尾帧、参考图像、参考视频、参考音频的上传、预览与素材标签；
- 富文本提示词编辑、素材标签校验与 API/本地视觉模型提示词优化；
- 浏览器本地代码片段管理；在提示词中输入完整的 `#片段名` 后进行精确匹配并插入，遇到空格或中英文标点时停止匹配。

代码片段窗口支持连续编辑：“保存”只保存并保持窗口打开，“保存并关闭”用于完成编辑；也可按 `Ctrl+S` 快速保存。

节点不包含 CLIP、video VAE、audio VAE、画幅或 megapixels 控件，也不创建
conditioning、latent 或 VAE 输出。输出包括 `final_prompt`（`STRING`）和可串联的
`media_out`（`WZQ_H3_MEDIA`），并可通过 `media_in` 合并上游媒体包。时长仍用于
提示词优化器理解目标视频长度；`duration_seconds` 为 `FLOAT` 输入，可连接外部浮点节点。
连接常量 Float/Primitive 节点时，面板中的时长显示会同步上游数值；动态计算型 Float
在执行时使用其实际输出值。也支持 EasyUse 的 `Set/Get` 虚拟变量链，会从 Get 按变量名
定位对应 Set，再继续读取其上游 Float。

高级选项仅显示并使用 `Strict prompt tags`。原 Integration 中的音频模式、音频重绘强度、
驱动音频序号和参考图尺寸属于 conditioning/latent 构建流程；本提示词节点不生成这些数据，
因此不再显示这些无效控件。旧工作流中的对应字段仍会保留，以免加载时发生字段错位。

配套节点：

- `MiniMax-H3 Media Input (WZQ)`：提供首尾帧、9路参考图片、3路参考视频、
  Hybrid 音频和3路参考音频输入，并打包为 `media_out`；
- `MiniMax-H3 Media Output (WZQ)`：接受 `media_in`，拆分输出11路 `IMAGE`、
  3路兼容内置 H3 节点的24 FPS视频帧 `IMAGE`、4路 `AUDIO`，并额外保留3路
  原始 `VIDEO` 和对应的3路视频音轨 `AUDIO`；在提示词面板中裁剪过的音频会按
  所选起止时间输出实际裁剪后的 waveform。

多个 Media Input 可通过 `media_in → media_out` 依次串联。主提示词节点会合并输入包与
面板上传素材；连接 `media_in` 后会自动读取上游槽位、切换到对应素材页并显示素材卡片。
若上游加载器提供可识别的文件名则直接显示预览，运行时生成的媒体会先显示接线占位卡片。
若槽位相同，以主节点面板中的本地素材为准。

提示词优化器的本地视觉模型模式需要安装 `requirements.txt` 中的可选推理依赖。
相关移植文件的第三方许可信息见 `THIRD_PARTY_NOTICES.md`。

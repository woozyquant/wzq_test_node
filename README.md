# wzq_test_node

ComfyUI 自定义节点集合。

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

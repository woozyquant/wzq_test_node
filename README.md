# wzq_test_node

ComfyUI 自定义节点集合。

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
- 富文本提示词编辑、素材标签校验与 API/本地视觉模型提示词优化。

节点不包含 CLIP、video VAE、audio VAE、画幅或 megapixels 控件，也不创建
conditioning、latent 或 VAE 输出。输出包括 `final_prompt`（`STRING`）和可串联的
`media_out`（`WZQ_H3_MEDIA`），并可通过 `media_in` 合并上游媒体包。时长仍用于
提示词优化器理解目标视频长度；`duration_seconds` 为 `FLOAT` 输入，可连接外部浮点节点。
连接常量 Float/Primitive 节点时，面板中的时长显示会同步上游数值；动态计算型 Float
在执行时使用其实际输出值。也支持 EasyUse 的 `Set/Get` 虚拟变量链，会从 Get 按变量名
定位对应 Set，再继续读取其上游 Float。

配套节点：

- `MiniMax-H3 Media Input (WZQ)`：提供首尾帧、9路参考图片、3路参考视频、
  Hybrid 音频和3路参考音频输入，并打包为 `media_out`；
- `MiniMax-H3 Media Output (WZQ)`：接受 `media_in`，拆分输出11路 `IMAGE`、
  3路 `VIDEO` 和4路 `AUDIO`；在提示词面板中裁剪过的音频会按所选起止时间输出
  实际裁剪后的 waveform。

多个 Media Input 可通过 `media_in → media_out` 依次串联。主提示词节点会合并输入包与
面板上传素材；连接 `media_in` 后会自动读取上游槽位、切换到对应素材页并显示素材卡片。
若上游加载器提供可识别的文件名则直接显示预览，运行时生成的媒体会先显示接线占位卡片。
若槽位相同，以主节点面板中的本地素材为准。

提示词优化器的本地视觉模型模式需要安装 `requirements.txt` 中的可选推理依赖。
相关移植文件的第三方许可信息见 `THIRD_PARTY_NOTICES.md`。

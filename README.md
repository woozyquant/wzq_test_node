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

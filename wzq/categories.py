"""节点分类（右键菜单路径）的唯一定义源。

ComfyUI 会用 ``CATEGORY`` 里的 ``/`` 拆出多级菜单，因此这里把每个分组
定义为 ``WZQ/<中文子菜单>``，保证整个库只出现一个 ``WZQ`` 顶层菜单。

注意：分类只影响菜单显示位置和节点上的分类标签。节点在 ``__init__.py``
``NODE_CLASS_MAPPINGS`` 里的注册键决定了工作流中保存的节点类型，修改注册键
会让已有工作流丢失节点，因此不要因为调整分类而改动注册键。
"""

LOADERS = "WZQ/加载器"
LORA = "WZQ/LoRA"
IMAGE = "WZQ/图像"
SIZE = "WZQ/尺寸与潜空间"
TEXT = "WZQ/文本与工具"
TOOLS = "WZQ/工具"
MINIMAX_H3 = "WZQ/MiniMax H3"

# 从py中引入一个类作为引用依据
# from py名称 import 类1，类2，类3
# from .a000_example.a1基础格式 import a1
# from .a000_example.a2基础数据类型 import a2
# from .a000_example.a3基础调用流程 import a3
from .wzq.a4 import mySplit
from .wzq.a4 import myReroute
from .wzq.a4 import myReroute3
from .wzq.a4 import myReroutexxx
from .wzq.a4 import myImageSize
from .wzq.a4 import myEasySeed
from .wzq.a4 import myCurrentTime
from .wzq.a4 import myEmptyLatent
from .wzq.a4 import myEmptyLatentQwen
from .wzq.a4 import mySize
from .wzq.a4 import myCheckStringEmpty
from .wzq.a4 import myBatchCount
from .wzq.my_image import ImageResizer
from .wzq.my_image import ImageTileBatch
from .wzq.Mask_Func import MaskApplierAndCombiner
from .wzq.Mask_Func import Mask_Fill_Region
from .wzq.my_lora_node import MyLoraLoaderModelOnly
from .wzq.my_lora_node import MyMultiLoraLoaderModelOnly
from .wzq.my_lora_node import MyLocalLoraOnlyGallery
from .wzq.canvas_extend import WZQCanvasExtend
from .wzq.image_loader import WZQImageLoader
from .wzq.audio_loader import WZQAudioLoader
from .wzq.smart_image_size import WZQSmartImageSize
from .wzq.video_combine_v2 import VideoCombineV2
from .wzq.minimax_h3_prompt import (
    WZQMiniMaxH3MediaInput,
    WZQMiniMaxH3MediaOutput,
    WZQMiniMaxH3Prompt,
)
from .wzq.prompt_manager import WZQPromptManager
from .wzq.folder_shortcuts import WZQFolderShortcuts

# 导入服务端路由模块，注册 /wzq/api/lora_size 等接口（模块级装饰器在此执行）
from .wzq import server as _wzq_server  # noqa: F401
# Local LoRA Gallery 依赖的 /localloragallery/* 接口
from .wzq import gallery_server as _wzq_gallery_server  # noqa: F401
from . import minimax_h3_prompt_optimizer as _minimax_h3_prompt_optimizer  # noqa: F401

# （必填）填写 import的类名称，命名需要唯一，key或value与其他插件冲突可能引用不了。这是决定是否能引用的关键。
# key(自定义):value(import的类名称)
NODE_CLASS_MAPPINGS = {

    "mySplit": mySplit,
    "myReroute": myReroute,
    "myReroute3": myReroute3,
    "myReroutexxx": myReroutexxx,    
    "myImageSizexxx": myImageSize,        
    "myEasySeedxxx": myEasySeed,        
    "myCurrentTimexxx": myCurrentTime,
    "myEmptyLatentxxx": myEmptyLatent,   
    "myEmptyLatentQwenxxx": myEmptyLatentQwen,
    "mySizexxx": mySize,
    "myImageResizer": ImageResizer,
    "myImageTiled":ImageTileBatch, 
    "MaskApplierAndCombiner": MaskApplierAndCombiner,
    "myMaskFillHoles": Mask_Fill_Region,
    "myLoraLoaderModelOnlyxxx": MyLoraLoaderModelOnly,
    "myMultiLoraLoaderModelOnlyxxx": MyMultiLoraLoaderModelOnly,
    "myLocalLoraOnlyGalleryxxx": MyLocalLoraOnlyGallery,
    "myCheckStringEmptyxxx": myCheckStringEmpty,
    "myBatchCount": myBatchCount,
    "myWZQCanvasExtend": WZQCanvasExtend,
    "WZQImageLoader": WZQImageLoader,
    "WZQAudioLoader": WZQAudioLoader,
    "wzq_image_out": WZQSmartImageSize,
    "WZQMiniMaxH3Prompt": WZQMiniMaxH3Prompt,
    "WZQMiniMaxH3MediaInput": WZQMiniMaxH3MediaInput,
    "WZQMiniMaxH3MediaOutput": WZQMiniMaxH3MediaOutput,
    "WZQVideoCombineV2": VideoCombineV2,
    "WZQPromptManager": WZQPromptManager,
    "WZQFolderShortcuts": WZQFolderShortcuts,
}


# （可不写）填写 ui界面显示名称，命名会显示在节点ui左上角，如不写会用类的名称显示在节点ui上
# key(自定义):value(ui显示的名称)
# 注意：这里的 key 必须和 NODE_CLASS_MAPPINGS 的 key 逐字一致，否则该条会被静默忽略，
# 节点只能显示裸类名（例如 mySizexxx）。注册 key 本身带有历史遗留的 xxx / my 前缀，
# 已保存的工作流依赖它们，因此只改显示名，不改 key。
NODE_DISPLAY_NAME_MAPPINGS = {

    # 文本与工具
    "mySplit": "Split SD Generation Data",
    "myCheckStringEmptyxxx": "Check String Empty",
    "myBatchCount": "Batch Count",
    "myEasySeedxxx": "Easy Seed",
    "myCurrentTimexxx": "Current Time",

    # 工具
    "myReroute": "Reroute (Any)",
    "myReroute3": "Reroute (Any ×3)",
    "myReroutexxx": "Reroute (Model / VAE / CLIP)",
    "WZQFolderShortcuts": "文件夹快捷打开",

    # 尺寸与潜空间
    "myImageSizexxx": "Image Size",
    "mySizexxx": "Size (Width / Height)",
    "myEmptyLatentxxx": "Empty Latent (Resolution)",
    "myEmptyLatentQwenxxx": "Empty Latent (Qwen Ratio)",

    # 图像
    "wzq_image_out": "Smart Image Size",
    "myWZQCanvasExtend": "🖼️Interactive Canvas Crop / Extend",
    "myImageResizer": "Image Resizer",
    "myImageTiled": "Image Tile Batch",
    "MaskApplierAndCombiner": "🎭Mask Applier and Combiner",
    "myMaskFillHoles": "Mask Fill Holes",

    # LoRA
    "myLoraLoaderModelOnlyxxx": "LoRA Loader (Model Only)",
    "myMultiLoraLoaderModelOnlyxxx": "Multi LoRA Loader (Model Only)",
    "myLocalLoraOnlyGalleryxxx": "🖼️Local LoRA Gallery",

    # 加载器
    "WZQImageLoader": "WZQ 图像加载器",
    "WZQAudioLoader": "WZQ 音频加载器",

    # MiniMax H3
    "WZQMiniMaxH3Prompt": "MiniMax-H3 Prompt (WZQ)",
    "WZQMiniMaxH3MediaInput": "MiniMax-H3 Media Input (WZQ)",
    "WZQMiniMaxH3MediaOutput": "MiniMax-H3 Media Output (WZQ)",
    "WZQVideoCombineV2": "Video Combine V2 (WZQ)",
    "WZQPromptManager": "提示词管理器",
}

WEB_DIRECTORY = "./js"

# 引入以上3个字典的内容
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', "WEB_DIRECTORY"]

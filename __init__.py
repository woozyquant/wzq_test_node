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
from .wzq.a4 import myCheckStringEmpty
from .wzq.a4 import myBatchCount
from .wzq.my_image import ImageResizer
from .wzq.my_image import ImageTileBatch
from .wzq.Mask_Func import MaskApplierAndCombiner
from .wzq.Mask_Func import Mask_Fill_Region
from .wzq.my_lora_node import MyLoraLoaderModelOnly
from .wzq.my_lora_node import MyLocalLoraOnlyGallery

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
    "ImageResizer": ImageResizer,
    "myImageTiled":ImageTileBatch, 
    "MaskApplierAndCombiner": MaskApplierAndCombiner,
    "myMaskFillHoles": Mask_Fill_Region,
    "myLoraLoaderModelOnlyxxx": MyLoraLoaderModelOnly,
    "myLocalLoraOnlyGalleryxxx": MyLocalLoraOnlyGallery,    
    "myCheckStringEmptyxxx": myCheckStringEmpty,
    "myBatchCount": myBatchCount,
}


# （可不写）填写 ui界面显示名称，命名会显示在节点ui左上角，如不写会用类的名称显示在节点ui上
# key(自定义):value(ui显示的名称)
NODE_DISPLAY_NAME_MAPPINGS = {

    "mySplit":"SplitSDGenerationData",
    "ImageResizer": "Image Resizer",
    "MaskApplierAndCombiner": "🎭Mask Applier and Combiner",
    "myLocalLoraOnlyGalleryxxx": "🖼️Local Lora Gallery",
}

WEB_DIRECTORY = "./js"

# 引入以上3个字典的内容
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', "WEB_DIRECTORY"]
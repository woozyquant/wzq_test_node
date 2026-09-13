import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
import scipy

from . import categories

def pil2tensor(image: Image) -> torch.Tensor:
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def tensor2pil(t_image: torch.Tensor) -> Image:
    return Image.fromarray(np.clip(255.0 * t_image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

# PIL to Mask
def pil2mask(image):
    image_np = np.array(image.convert("L")).astype(np.float32) / 255.0
    mask = torch.from_numpy(image_np)
    return 1.0 - mask

def mask_to_pil(mask) -> Image:
    if isinstance(mask, torch.Tensor):
        mask_np = mask.squeeze().cpu().numpy()
    elif isinstance(mask, np.ndarray):
        mask_np = mask
    else:
        raise TypeError("Unsupported mask type")
    mask_pil = Image.fromarray((mask_np * 255).astype(np.uint8))
    return mask_pil

class MaskApplierAndCombiner:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "masks": ("MASK",),
                "feather_amount": ("INT", {
                    "default": 0, 
                    "min": 0, 
                    "max": 100,
                    "step": 1
                }),
            },
            "optional": {}
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("combined_image",)
    FUNCTION = 'apply_masks_and_combine'
    CATEGORY = categories.IMAGE
    DESCRIPTION = "把多张图像按各自遮罩叠加合成到第一张图上，可对遮罩做羽化过渡。"
    OUTPUT_TOOLTIPS = ("合成后的图像。",)

    def apply_masks_and_combine(self, images, masks, feather_amount):
        if len(images) != len(masks):
            raise ValueError("The number of images and masks must be the same.")

        # Convert the first image to PIL for processing
        base_image_pil = tensor2pil(torch.unsqueeze(images[0], 0)).convert('RGBA')
        
        for i in range(1, len(images)):
            image_pil = tensor2pil(torch.unsqueeze(images[i], 0)).convert('RGBA')
            mask_pil = mask_to_pil(masks[i]).convert('L')
            
            # Convert mask to numpy array
            mask_np = np.array(mask_pil)
            
            # Normalize the mask to ensure it's in the range [0, 255]
            mask_np = cv2.normalize(mask_np, None, 0, 255, cv2.NORM_MINMAX)
            
            if feather_amount > 0:
                # Create a feathered version of the mask
                kernel = np.ones((feather_amount, feather_amount), np.uint8)
                mask_eroded = cv2.erode(mask_np, kernel, iterations=1)
                mask_dilated = cv2.dilate(mask_np, kernel, iterations=1)
                
                # Create a gradient for smooth transition
                mask_feathered = mask_np.astype(float)
                mask_feathered = np.maximum(mask_feathered, mask_eroded)
                mask_feathered = np.minimum(mask_feathered, mask_dilated)
                
                # Normalize the feathered mask
                mask_feathered = (mask_feathered - mask_feathered.min()) / (mask_feathered.max() - mask_feathered.min()) * 255
                mask_np = mask_feathered.astype(np.uint8)
            
            # Create an RGBA mask
            mask_rgba = np.dstack((np.ones_like(mask_np) * 255, np.ones_like(mask_np) * 255, np.ones_like(mask_np) * 255, mask_np))
            mask_rgba_pil = Image.fromarray(mask_rgba.astype(np.uint8), 'RGBA')
            
            # Apply the mask to the image
            masked_image_pil = Image.composite(image_pil, Image.new("RGBA", image_pil.size, (0,0,0,0)), mask_rgba_pil)
            
            # Combine the masked image with the base image
            base_image_pil = Image.alpha_composite(base_image_pil, masked_image_pil)

        # Convert the combined PIL image back to tensor
        combined_image_tensor = pil2tensor(base_image_pil.convert('RGB'))
        
        return (combined_image_tensor,)

class Masking:

    @staticmethod
    def fill_region(image):
        from scipy.ndimage import binary_fill_holes
        image = image.convert("L")
        binary_mask = np.array(image) > 0
        filled_mask = binary_fill_holes(binary_mask)
        filled_image = Image.fromarray(filled_mask.astype(np.uint8) * 255, mode="L")
        return ImageOps.invert(filled_image.convert("RGB"))

class Mask_Fill_Region:

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
                    "required": {
                        "masks": ("MASK",),
                    }
                }

    CATEGORY = categories.IMAGE

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("MASKS",)

    FUNCTION = "fill_region"
    DESCRIPTION = "填充遮罩内部的孔洞：把遮罩中封闭区域补实，用于修整不完整的分区遮罩。"
    OUTPUT_TOOLTIPS = ("填充孔洞后的遮罩。",)

    def fill_region(self, masks):
        if masks.ndim > 3:
            regions = []
            for mask in masks:
                mask_np = np.clip(255. * mask.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
                pil_image = Image.fromarray(mask_np, mode="L")
                region_mask = Masking.fill_region(pil_image)
                region_tensor = pil2mask(region_mask).unsqueeze(0).unsqueeze(1)
                regions.append(region_tensor)
            regions_tensor = torch.cat(regions, dim=0)
            return (regions_tensor,)
        else:
            mask_np = np.clip(255. * masks.cpu().numpy().squeeze(), 0, 255).astype(np.uint8)
            pil_image = Image.fromarray(mask_np, mode="L")
            region_mask = Masking.fill_region(pil_image)
            region_tensor = pil2mask(region_mask).unsqueeze(0).unsqueeze(1)
            return (region_tensor,)

#NODE_CLASS_MAPPINGS = {
#    "MaskApplierAndCombiner": MaskApplierAndCombiner,
#}

#NODE_DISPLAY_NAME_MAPPINGS = {
#    "MaskApplierAndCombiner": "🎭Mask Applier and Combiner"
#}

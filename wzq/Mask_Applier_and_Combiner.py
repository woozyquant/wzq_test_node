import cv2
import numpy as np
from PIL import Image
import torch

def pil2tensor(image: Image) -> torch.Tensor:
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)

def tensor2pil(t_image: torch.Tensor) -> Image:
    return Image.fromarray(np.clip(255.0 * t_image.cpu().numpy().squeeze(), 0, 255).astype(np.uint8))

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
    CATEGORY = 'Image Processing'

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

#NODE_CLASS_MAPPINGS = {
#    "MaskApplierAndCombiner": MaskApplierAndCombiner,
#}

#NODE_DISPLAY_NAME_MAPPINGS = {
#    "MaskApplierAndCombiner": "🎭Mask Applier and Combiner"
#}

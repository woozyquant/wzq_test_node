# LoRA Info Dialog Module

This module contains the extracted `RgthreeLoraInfoDialog` from rgthree-comfy, made independent for use in wzq_test_node.

## Files Structure

- `lorainfo.js` - Main dialog implementation
- `utils_dom.js` - DOM utility functions
- `dialog.js` - Base dialog class
- `svgs.js` - SVG icons
- `shared_utils.js` - Shared utility functions
- `menu.js` - Menu component
- `rgthree_api.js` - API service for model info
- `model_info_service.js` - Model info service
- `css/dialog_model_info.css` - Dialog styles

## Usage

```javascript
import { LoraInfoDialog } from './lorainfo/lorainfo.js';

// Show dialog
const dialog = new LoraInfoDialog(loraName).show();
```

## Dependencies Removed

The following external dependencies have been removed or replaced:
- rgthree-comfy API service → Local rgthree_api.js (simplified)
- rgthree global object → Local implementation

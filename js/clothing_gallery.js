import { registerImageGallery } from "./common/image_gallery.js";

registerImageGallery({
    nodeName: "wzq-clothing-gallery", extensionName: "wzq.clothing_gallery",
    base: "/wzq/clothing-gallery/", itemRoute: "clothing", idField: "clothing_id",
    subject: "服装", previewProperty: "_wzqClothingPreview", widgetName: "wzq_clothing_preview",
    browseLabel: "浏览服装图库 · 搜索 / 分类 / 标签",
    image: row => row.files.original,
    caption: row => `${row.id} · ${row.category_zh}`,
});

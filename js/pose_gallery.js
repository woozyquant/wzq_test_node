import { registerImageGallery } from "./common/image_gallery.js";

registerImageGallery({
    nodeName: "wzq-pose-gallery", extensionName: "wzq.pose_gallery",
    base: "/wzq/pose-gallery/", itemRoute: "pose", idField: "pose_id",
    subject: "姿势", previewProperty: "_wzqPosePreview", widgetName: "wzq_pose_preview",
    browseLabel: "浏览姿势图库 · 搜索 / 分类 / 多视角",
    image: row => row.原图,
    caption: row => `${row.姿势名称} · ${row.角度}`,
});

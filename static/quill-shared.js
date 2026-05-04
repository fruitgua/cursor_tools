/**
 * 日记与学习笔记共用的 Quill Snow 工具栏与图片插入（工具栏选图 + 粘贴剪贴板图片）。
 * 依赖全局 Quill（由 quill.min.js 提供）。须在 quill.min.js 之后、各页面逻辑之前加载。
 */
(function (global) {
    "use strict";

    /** 与知识库常见能力对齐的 Snow 工具栏（两端页面共用） */
    var SNOW_TOOLBAR = [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ align: [] }],
        ["link", "image"],
        ["clean"],
    ];

    function snowToolbarModules(getQuill) {
        return {
            toolbar: {
                container: SNOW_TOOLBAR,
                handlers: {
                    image: function quillSharedImageHandler() {
                        var q = typeof getQuill === "function" ? getQuill() : null;
                        if (!q || typeof q.getSelection !== "function") return;
                        var input = document.createElement("input");
                        input.setAttribute("type", "file");
                        input.setAttribute("accept", "image/*");
                        input.click();
                        input.onchange = function () {
                            var file = input.files && input.files[0];
                            if (!file) return;
                            var reader = new FileReader();
                            reader.onload = function (e) {
                                var range = q.getSelection(true);
                                var idx = range && typeof range.index === "number" ? range.index : (q.getLength() || 1) - 1;
                                q.insertEmbed(idx, "image", e.target.result);
                                q.setSelection(idx + 1);
                            };
                            reader.readAsDataURL(file);
                        };
                    },
                },
            },
        };
    }

    function attachImagePasteFromClipboard(quill) {
        if (!quill || !quill.root) return;
        quill.root.addEventListener("paste", function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.type && item.type.indexOf("image") !== -1) {
                    e.preventDefault();
                    var file = item.getAsFile();
                    if (!file) return;
                    var reader = new FileReader();
                    reader.onload = function (ev) {
                        var range = quill.getSelection(true);
                        var idx = range && typeof range.index === "number" ? range.index : (quill.getLength() || 1) - 1;
                        quill.insertEmbed(idx, "image", ev.target.result);
                        quill.setSelection(idx + 1);
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        });
    }

    global.AppQuillShared = {
        SNOW_TOOLBAR: SNOW_TOOLBAR,
        snowToolbarModules: snowToolbarModules,
        attachImagePasteFromClipboard: attachImagePasteFromClipboard,
    };
})(typeof window !== "undefined" ? window : this);

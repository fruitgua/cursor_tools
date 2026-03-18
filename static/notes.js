/**
 * Study notes page logic.
 */

let quill = null;
let currentNoteId = null;
let saveTimeout = null;
let allNotes = [];
let categories = ["AI", "系统使用", "读书笔记", "其他"];
let editingCategoryName = null;
let saveEnabled = true;
let lastSavedSnapshot = null;
let autoSubmitTimer = null;
let isSubmittingNewNote = false;
let isDirty = false;
let autoSaveTimer = null;
let confirmModalOnOk = null;

function getCurrentNoteSnapshot() {
    if (currentNoteId == null) return null;
    const titleEl = document.getElementById("note-title");
    const catEl = document.getElementById("note-category");
    const title = titleEl ? (titleEl.value || "") : "";
    const category = catEl ? (catEl.value || "") : "";
    const content = quill ? (quill.root.innerHTML || "") : "";
    return {
        id: currentNoteId,
        title,
        category,
        content,
    };
}

function snapshotEquals(a, b) {
    if (!a || !b) return false;
    return (
        a.id === b.id &&
        a.title === b.title &&
        a.category === b.category &&
        a.content === b.content
    );
}

function uniqCategories(arr) {
    const out = [];
    const seen = new Set();
    (arr || []).forEach((x) => {
        const s = String(x || "").trim();
        if (!s) return;
        if (seen.has(s)) return;
        seen.add(s);
        out.push(s);
    });
    return out;
}

function setSelectOptions(selectEl, options, includeAllOrPlaceholder) {
    if (!selectEl) return;
    const curVal = selectEl.value;
    const opts = uniqCategories(options);
    const parts = [];
    if (includeAllOrPlaceholder === "all") {
        parts.push('<option value="">全部</option>');
    } else if (includeAllOrPlaceholder === "placeholder") {
        parts.push('<option value="">请选择</option>');
    }
    opts.forEach((c) => {
        parts.push(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
    });
    selectEl.innerHTML = parts.join("");

    // restore value if still valid
    const stillExists =
        Array.from(selectEl.options || []).some((o) => String(o.value) === String(curVal)) ||
        curVal === "";
    if (!stillExists) selectEl.value = "";
    // trigger ui-select panel rebuild
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
}

function refreshCategorySelects() {
    const filterEl = document.getElementById("notes-filter-category");
    const formEl = document.getElementById("note-category");
    setSelectOptions(filterEl, categories, "all");
    setSelectOptions(formEl, categories, "placeholder");
}

function loadCategories(callback) {
    fetch("/api/notes/categories")
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success && data.data && Array.isArray(data.data.items)) {
                categories = uniqCategories(data.data.items);
                if (!categories.length) categories = ["AI", "系统使用", "读书笔记", "其他"];
                refreshCategorySelects();
                if (typeof callback === "function") callback();
            } else {
                refreshCategorySelects();
                if (typeof callback === "function") callback();
            }
        })
        .catch(() => {
            refreshCategorySelects();
            if (typeof callback === "function") callback();
        });
}

function showToast(text, type) {
    const container = document.getElementById("toast-container");
    if (!container || !text) return;
    const toast = document.createElement("div");
    toast.className = "toast " + (type === "error" ? "toast-error" : "toast-info");
    toast.textContent = text;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
            if (toast.parentNode === container) container.removeChild(toast);
        }, 300);
    }, 2500);
}

function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function initQuill() {
    if (quill) return quill;
    const editor = document.getElementById("note-editor");
    if (!editor) return null;
    if (typeof Quill === "undefined") {
        console.error("Quill 未加载，请检查网络连接");
        return null;
    }

    quill = new Quill("#note-editor", {
        theme: "snow",
        modules: {
            toolbar: {
                container: [
                    [{ header: [1, 2, 3, false] }],
                    ["bold", "italic", "underline", "strike"],
                    [{ color: [] }, { background: [] }],
                    [{ list: "ordered" }, { list: "bullet" }],
                    [{ align: [] }],
                    ["link", "image"],
                    ["clean"],
                ],
                handlers: {
                    image: imageHandler,
                },
            },
        },
    });

    quill.root.addEventListener("paste", (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.indexOf("image") !== -1) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const range = quill.getSelection(true);
                    quill.insertEmbed(range.index, "image", ev.target.result);
                    quill.setSelection(range.index + 1);
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });

    return quill;
}

function imageHandler() {
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*");
    input.click();
    input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const range = quill.getSelection(true);
            quill.insertEmbed(range.index, "image", e.target.result);
            quill.setSelection(range.index + 1);
        };
        reader.readAsDataURL(file);
    };
}

function getFilteredNotes() {
    const filterEl = document.getElementById("notes-filter-category");
    const filterVal = filterEl ? filterEl.value : "";
    if (!filterVal) return allNotes;
    return allNotes.filter((item) => (item.category || "") === filterVal);
}

function renderNotesList(items) {
    const list = document.getElementById("notes-list");
    if (!list) return;

    const countEl = document.getElementById("notes-count-num");
    if (countEl) countEl.textContent = String(items ? items.length : 0);

    if (!items || items.length === 0) {
        list.innerHTML = '<li class="notes-list-empty">暂无笔记，点击上方“新增笔记”添加</li>';
        return;
    }

    list.innerHTML = items
        .map(
            (item) => `
        <li class="notes-list-item" data-id="${item.id}" title="${escapeHtml(item.title || "")}">
            <span class="notes-list-title">${escapeHtml(item.title || "(无标题)")}</span>
        </li>
    `
        )
        .join("");
}

function loadNotesList(callback) {
    fetch("/api/notes")
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                allNotes = data.items || [];
                applyFilterAndRender();
                if (typeof callback === "function") callback();
            } else {
                showToast(data.message || "加载失败", "error");
            }
        })
        .catch((err) => showToast("加载失败：" + (err.message || "网络错误"), "error"));
}

function applyFilterAndRender() {
    const filtered = getFilteredNotes();
    renderNotesList(filtered);
}

function formatDateTimeToMinute(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
    );
}

function setLastUpdatedLabel(dateObj) {
    const el = document.getElementById("notes-last-updated");
    if (!el) return;
    if (!dateObj) {
        el.textContent = "上次更新时间：-";
        return;
    }
    el.textContent = "上次更新时间：" + formatDateTimeToMinute(dateObj);
}

function parseDbTimeToDate(ts) {
    if (ts == null) return null;
    if (typeof ts === "number" && isFinite(ts)) {
        // DB created_at/updated_at is seconds since epoch
        return new Date(ts * 1000);
    }
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    return null;
}

function markDirty() {
    if (currentNoteId == null) return;
    if (!saveEnabled) return;
    isDirty = true;
}

function saveCurrentNoteSilently() {
    if (currentNoteId == null) return Promise.resolve(false);
    if (!saveEnabled) return Promise.resolve(false);
    const snap = getCurrentNoteSnapshot();
    if (!snap) return Promise.resolve(false);
    if (lastSavedSnapshot && snapshotEquals(snap, lastSavedSnapshot)) {
        isDirty = false;
        return Promise.resolve(false);
    }
    const title = snap.title;
    const category = snap.category;
    const content = snap.content;
    return fetch("/api/notes/" + currentNoteId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, content }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success) {
                lastSavedSnapshot = snap;
                isDirty = false;
                setLastUpdatedLabel(new Date());
                loadNotesList();
                return true;
            }
            return false;
        })
        .catch(() => false);
}

function startAutoSaveTimer() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
        if (currentNoteId == null) return;
        if (!saveEnabled) return;
        if (!isDirty) return;
        // 每 60 秒尝试保存一次（无 toast）
        saveCurrentNoteSilently();
    }, 60000);
}

function showPlaceholder() {
    document.getElementById("notes-detail-placeholder").style.display = "block";
    document.getElementById("notes-detail-form").style.display = "none";
    document.getElementById("notes-actions").style.display = "none";
    setLastUpdatedLabel(null);
}

function showAddForm() {
    saveEnabled = false;
    currentNoteId = null;
    isDirty = false;
    document.getElementById("notes-detail-placeholder").style.display = "none";
    document.getElementById("notes-detail-form").style.display = "block";
    document.getElementById("notes-actions").style.display = "block";
    document.getElementById("btn-clear").style.display = "inline-block";
    document.getElementById("btn-submit").style.display = "inline-block";
    document.getElementById("btn-delete").style.display = "none";
    const saveNowBtn = document.getElementById("btn-save-now");
    if (saveNowBtn) saveNowBtn.style.display = "none";
    setLastUpdatedLabel(null);

    document.getElementById("note-title").value = "";
    document.getElementById("note-category").value = "";

    initQuillLazy();
    if (quill) quill.root.innerHTML = "";

    document.querySelectorAll(".notes-list-item").forEach((el) => el.classList.remove("active"));

    // 初始填充完成后再允许自动保存
    saveEnabled = true;
    lastSavedSnapshot = null;
}

function showEditForm(note) {
    saveEnabled = false;
    currentNoteId = note.id;
    isDirty = false;
    document.getElementById("notes-detail-placeholder").style.display = "none";
    document.getElementById("notes-detail-form").style.display = "block";
    document.getElementById("notes-actions").style.display = "block";
    document.getElementById("btn-clear").style.display = "none";
    document.getElementById("btn-submit").style.display = "none";
    document.getElementById("btn-delete").style.display = "inline-block";
    const saveNowBtn = document.getElementById("btn-save-now");
    if (saveNowBtn) saveNowBtn.style.display = "inline-block";

    document.getElementById("note-title").value = note.title || "";
    const rawCat = note.category || "";
    if (rawCat && !categories.includes(rawCat)) {
        // 笔记里有历史分类但当前列表没有时，自动补入分类列表
        categories = uniqCategories(categories.concat(rawCat));
        refreshCategorySelects();
    }
    const catEl = document.getElementById("note-category");
    if (catEl) {
        catEl.value = rawCat;
        // 通知 ui-select 重建展示文本，但此时 saveEnabled=false，不会触发自动保存
        catEl.dispatchEvent(new Event("change", { bubbles: true }));
    }

    initQuillLazy();
    if (quill) quill.root.innerHTML = note.content || "";

    document.querySelectorAll(".notes-list-item").forEach((el) => {
        el.classList.toggle("active", parseInt(el.getAttribute("data-id"), 10) === note.id);
    });

    // 仅在用户后续编辑时触发自动保存
    saveEnabled = true;
    lastSavedSnapshot = {
        id: note.id,
        title: note.title || "",
        category: rawCat,
        content: note.content || "",
    };
    setLastUpdatedLabel(parseDbTimeToDate(note.updated_at) || parseDbTimeToDate(note.created_at) || new Date());
    startAutoSaveTimer();
}

function openCatsDrawer() {
    document.getElementById("notes-cats-drawer-overlay").classList.add("open");
    document.getElementById("notes-cats-drawer").classList.add("open");
    renderCatsList();
}

function closeCatsDrawer() {
    document.getElementById("notes-cats-drawer-overlay").classList.remove("open");
    document.getElementById("notes-cats-drawer").classList.remove("open");
}

function renderCatsList() {
    const wrap = document.getElementById("notes-cats-list");
    if (!wrap) return;
    const countByCategory = (name) =>
        allNotes.filter((n) => String(n.category || "") === String(name || "")).length;
    wrap.innerHTML = categories
        .map((c, idx) => {
            const isEditing = editingCategoryName === c;
            const cnt = countByCategory(c);
            return `
            <div class="notes-cat-card" data-name="${escapeHtml(c)}">
                ${
                    isEditing
                        ? `<input type="text" class="field-control notes-cat-edit-input" data-old="${escapeHtml(c)}" value="${escapeHtml(c)}" />`
                        : `<div class="notes-cat-name">${escapeHtml(c)}</div>`
                }
                <div class="notes-cat-actions">
                    <span class="notes-cat-count">笔记数量：<span class="notes-cat-count-num">${cnt}</span></span>
                    ${
                        isEditing
                            ? `<button type="button" class="btn primary notes-cat-save" data-idx="${idx}">保存</button>
                               <button type="button" class="btn notes-cat-cancel" data-idx="${idx}">取消</button>`
                            : `<button type="button" class="btn notes-cat-move-up" data-idx="${idx}">上移</button>
                               <button type="button" class="btn notes-cat-edit" data-idx="${idx}">编辑</button>
                               <button type="button" class="btn notes-cat-delete" data-idx="${idx}">删除</button>`
                    }
                </div>
            </div>
        `;
        })
        .join("");

    // editing mode handlers
    wrap.querySelectorAll(".notes-cat-edit-input").forEach((input) => {
        try {
            input.focus();
            input.setSelectionRange(0, input.value.length);
        } catch (_) {}
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const card = e.target.closest(".notes-cat-card");
                const idx = Number(card.querySelector(".notes-cat-save")?.dataset?.idx || "-1");
                if (idx >= 0) card.querySelector(".notes-cat-save")?.click();
            } else if (e.key === "Escape") {
                e.preventDefault();
                editingCategoryName = null;
                renderCatsList();
            }
        });
    });

    wrap.querySelectorAll(".notes-cat-save").forEach((btn) => {
        btn.addEventListener("click", () => {
            const card = btn.closest(".notes-cat-card");
            const i = Number(btn.dataset.idx);
            const oldName = categories[i];
            const input = card ? card.querySelector(".notes-cat-edit-input") : null;
            const newName = String((input && input.value) || "").trim();
            if (!newName) return;
            if (newName === oldName) {
                editingCategoryName = null;
                renderCatsList();
                return;
            }
            if (categories.includes(newName)) {
                showToast("分类已存在", "error");
                return;
            }
            editingCategoryName = null;
            renameCategory(oldName, newName);
        });
    });
    wrap.querySelectorAll(".notes-cat-cancel").forEach((btn) => {
        btn.addEventListener("click", () => {
            editingCategoryName = null;
            renderCatsList();
        });
    });

    wrap.querySelectorAll(".notes-cat-move-up").forEach((btn) => {
        btn.addEventListener("click", () => {
            const i = Number(btn.dataset.idx);
            if (!(i > 0)) return;
            const next = categories.slice();
            const tmp = next[i - 1];
            next[i - 1] = next[i];
            next[i] = tmp;
            saveCategories(next);
        });
    });
    wrap.querySelectorAll(".notes-cat-edit").forEach((btn) => {
        btn.addEventListener("click", () => {
            const i = Number(btn.dataset.idx);
            const oldName = categories[i];
            if (!oldName) return;
            editingCategoryName = oldName;
            renderCatsList();
        });
    });
    wrap.querySelectorAll(".notes-cat-delete").forEach((btn) => {
        btn.addEventListener("click", () => {
            const i = Number(btn.dataset.idx);
            const name = categories[i];
            if (!name) return;
            // 前端先校验：当前分类下有笔记则禁止删除
            const cnt = allNotes.filter((n) => (n.category || "") === name).length;
            if (cnt > 0) {
                showToast("操作失败，当前分类正在使用。", "error");
                return;
            }
            if (typeof window.openConfirmModalDynamic === "function") {
                window.openConfirmModalDynamic("确定要删除分类「", name, "」吗？", () => deleteCategory(name));
            } else {
                openConfirmModal(`确定要删除分类「${name}」吗？`, () => deleteCategory(name));
            }
        });
    });
}

function saveCategories(nextCats) {
    const items = uniqCategories(nextCats);
    if (!items.length) return;
    fetch("/api/notes/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success && data.data && Array.isArray(data.data.items)) {
                categories = uniqCategories(data.data.items);
                refreshCategorySelects();
                renderCatsList();
            } else {
                showToast((data && data.message) || "保存失败", "error");
            }
        })
        .catch((err) => showToast("保存失败：" + (err.message || "网络错误"), "error"));
}

function renameCategory(from, to) {
    fetch("/api/notes/categories/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success && data.data && Array.isArray(data.data.items)) {
                categories = uniqCategories(data.data.items);
                // 更新本地 notes 列表中的 category，避免 UI 不一致
                allNotes = allNotes.map((n) => {
                    if ((n.category || "") === from) return { ...n, category: to };
                    return n;
                });
                refreshCategorySelects();
                applyFilterAndRender();
                renderCatsList();
                showToast("分类已更新");
            } else {
                showToast((data && data.message) || "更新失败", "error");
            }
        })
        .catch((err) => showToast("更新失败：" + (err.message || "网络错误"), "error"));
}

function deleteCategory(name) {
    fetch("/api/notes/categories/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success && data.data && Array.isArray(data.data.items)) {
                categories = uniqCategories(data.data.items);
                refreshCategorySelects();
                renderCatsList();
                showToast("分类已删除。");
            } else {
                showToast((data && data.message) || "删除失败", "error");
            }
        })
        .catch((err) => showToast("删除失败：" + (err.message || "网络错误"), "error"));
}

function loadNote(id) {
    fetch("/api/notes/" + id)
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showEditForm(data.item);
                // 确保左侧列表选中项可见
                setTimeout(() => {
                    const active = document.querySelector(".notes-list-item.active");
                    try {
                        active?.scrollIntoView({ block: "nearest" });
                    } catch (_) {}
                }, 0);
            } else {
                showToast(data.message || "加载失败", "error");
            }
        })
        .catch((err) => showToast("加载失败：" + (err.message || "网络错误"), "error"));
}

function debouncedSave() {
    // 兼容旧调用：不再立刻保存，只标记脏数据，等待 60 秒自动保存或用户手动提交
    markDirty();
}

function clearForm() {
    document.getElementById("note-title").value = "";
    document.getElementById("note-category").value = "";
    if (quill) quill.root.innerHTML = "";
    showToast("已清空");
}

function isContentEmpty(html) {
    if (!html || !html.trim()) return true;
    const div = document.createElement("div");
    div.innerHTML = html;
    const text = div.textContent || "";
    return !text.trim();
}

function submitNote() {
    if (isSubmittingNewNote) return;
    const title = document.getElementById("note-title").value.trim();
    const categoryEl = document.getElementById("note-category");
    const category = categoryEl ? categoryEl.value : "";
    const content = quill ? quill.root.innerHTML : "";

    if (!title || !category || isContentEmpty(content)) {
        showToast("×请填写必填项。", "error");
        return;
    }

    isSubmittingNewNote = true;
    fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, content }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                // 新增成功后进入“编辑态”（正常保存机制：每 60 秒自动保存 + 手动提交）
                const newId = data.id;
                if (newId != null) {
                    // 先刷新左侧列表，再选中并打开新笔记，确保列表可见且高亮
                    loadNotesList(() => loadNote(newId));
                } else {
                    loadNotesList();
                    showAddForm();
                }
            } else {
                showToast(data.message || "添加失败", "error");
            }
        })
        .catch((err) => showToast("添加失败：" + (err.message || "网络错误"), "error"))
        .finally(() => {
            isSubmittingNewNote = false;
        });
}

function scheduleAutoSubmitNewNote() {
    // 仅在“新增笔记”模式下自动提交（currentNoteId == null）
    if (currentNoteId != null) return;
    if (!saveEnabled) return;
    if (isSubmittingNewNote) return;
    if (autoSubmitTimer) clearTimeout(autoSubmitTimer);
    autoSubmitTimer = setTimeout(() => {
        autoSubmitTimer = null;
        if (currentNoteId != null) return;
        if (!saveEnabled || isSubmittingNewNote) return;
        const titleEl = document.getElementById("note-title");
        const catEl = document.getElementById("note-category");
        const title = titleEl ? String(titleEl.value || "").trim() : "";
        const category = catEl ? String(catEl.value || "").trim() : "";
        const content = quill ? (quill.root.innerHTML || "") : "";
        if (!title || !category || isContentEmpty(content)) return;
        submitNote();
    }, 300);
}

function deleteNote() {
    if (currentNoteId == null) return;
    const titleEl = document.getElementById("note-title");
    const title = String((titleEl && titleEl.value) || "").trim();
    const msg = title ? `确定要删除笔记「${title}」吗？` : "确定要删除这条笔记吗？";
    if (typeof window.openConfirmModal === "function") {
        if (title && typeof window.openConfirmModalDynamic === "function") {
            window.openConfirmModalDynamic("确定要删除笔记「", title, "」吗？", () => doDeleteNote());
        } else {
            window.openConfirmModal(msg, () => doDeleteNote());
        }
    } else {
        // fallback
        if (!confirm(msg)) return;
        doDeleteNote();
    }
}

function doDeleteNote() {
    fetch("/api/notes/" + currentNoteId, { method: "DELETE" })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("已删除");
                currentNoteId = null;
                loadNotesList();
                showPlaceholder();
            } else {
                showToast(data.message || "删除失败", "error");
            }
        })
        .catch((err) => showToast("删除失败：" + (err.message || "网络错误"), "error"));
}

function bindEvents() {
    document.getElementById("btn-go-home").onclick = () => {
        window.location.href = "/home";
    };

    document.getElementById("btn-add-note").onclick = showAddForm;

    document.getElementById("notes-filter-category").addEventListener("change", applyFilterAndRender);

    const btnManage = document.getElementById("btn-manage-categories");
    if (btnManage) btnManage.addEventListener("click", openCatsDrawer);
    document.getElementById("notes-cats-drawer-close").addEventListener("click", closeCatsDrawer);
    document.getElementById("notes-cats-drawer-overlay").addEventListener("click", closeCatsDrawer);
    document.getElementById("notes-cats-drawer-ok").addEventListener("click", closeCatsDrawer);
    document.getElementById("notes-cat-add-btn").addEventListener("click", () => {
        const input = document.getElementById("notes-cat-new-name");
        const name = String(input.value || "").trim();
        if (!name) return;
        if (categories.includes(name)) {
            showToast("分类已存在", "error");
            return;
        }
        const next = categories.concat(name);
        input.value = "";
        saveCategories(next);
    });

    document.getElementById("btn-clear").onclick = clearForm;
    document.getElementById("btn-submit").onclick = submitNote;
    document.getElementById("btn-delete").onclick = deleteNote;
    const saveNowBtn = document.getElementById("btn-save-now");
    if (saveNowBtn) {
        saveNowBtn.onclick = () => {
            // 手动提交一次当前笔记内容并更新“上次更新时间”（无 toast）
            markDirty();
            saveCurrentNoteSilently();
        };
    }

    document.getElementById("notes-list").addEventListener("click", (e) => {
        const item = e.target.closest(".notes-list-item");
        if (item && !item.classList.contains("notes-list-empty")) {
            const id = parseInt(item.getAttribute("data-id"), 10);
            loadNote(id);
        }
    });

    document.getElementById("note-title").addEventListener("input", () => {
        debouncedSave();
        scheduleAutoSubmitNewNote();
    });
    document.getElementById("note-title").addEventListener("blur", debouncedSave);
    document.getElementById("note-category").addEventListener("change", () => {
        debouncedSave();
        scheduleAutoSubmitNewNote();
    });

    // UI 规范：确认弹窗（用于分类删除等确认）
    const confirmModal = document.getElementById("notes-confirm-modal");
    const confirmText = document.getElementById("notes-confirm-text");
    const btnCancel = document.getElementById("notes-confirm-cancel");
    const btnOk = document.getElementById("notes-confirm-ok");

    function closeConfirmModal() {
        if (confirmModal) confirmModal.classList.add("hidden");
        confirmModalOnOk = null;
    }

    window.openConfirmModal = function(message, onOk) {
        if (!confirmModal || !confirmText) return;
        confirmText.textContent = String(message || "");
        confirmModalOnOk = typeof onOk === "function" ? onOk : null;
        confirmModal.classList.remove("hidden");
    };

    window.openConfirmModalDynamic = function(prefix, dynamicValue, suffix, onOk) {
        if (!confirmModal || !confirmText) return;
        const pre = String(prefix || "");
        const suf = String(suffix || "");
        const dyn = escapeHtml(String(dynamicValue || ""));
        // 仅动态值使用主色高亮，其余文本按默认颜色展示
        confirmText.innerHTML = escapeHtml(pre) + '<span class="ui-modal-dynamic">' + dyn + "</span>" + escapeHtml(suf);
        confirmModalOnOk = typeof onOk === "function" ? onOk : null;
        confirmModal.classList.remove("hidden");
    };

    if (btnCancel) btnCancel.addEventListener("click", closeConfirmModal);
    if (confirmModal) {
        confirmModal.addEventListener("click", (e) => {
            if (e.target === confirmModal) closeConfirmModal();
        });
    }
    if (btnOk) {
        btnOk.addEventListener("click", () => {
            const fn = confirmModalOnOk;
            closeConfirmModal();
            if (fn) fn();
        });
    }
}

function initQuillLazy() {
    if (quill) return quill;
    try {
        if (typeof Quill === "undefined") {
            throw new Error("Quill 脚本未加载，请检查网络或使用 VPN");
        }
        initQuill();
        if (quill) {
            quill.on("text-change", debouncedSave);
            quill.on("text-change", scheduleAutoSubmitNewNote);
        } else {
            throw new Error("编辑器元素未找到");
        }
    } catch (err) {
        console.error("Quill 初始化失败:", err);
        showToast("富文本编辑器加载失败: " + (err.message || "请刷新页面重试"), "error");
    }
    return quill;
}

function initNotes() {
    loadCategories(() => {
        loadNotesList();
        bindEvents();
    });
}

document.addEventListener("DOMContentLoaded", initNotes);

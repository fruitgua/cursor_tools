/**
 * Bookmarks management page logic.
 */

let allBookmarks = [];
let currentCategory = "";

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
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 2500);
}

function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function getExistingCategories() {
    const cats = new Set();
    allBookmarks.forEach((b) => {
        const c = (b.category || "").trim();
        if (c) cats.add(c);
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
}

function updateCategoryDatalist() {
    const list = document.getElementById("add-category-list");
    if (!list) return;
    const cats = getExistingCategories();
    list.innerHTML = cats.map((c) => '<option value="' + escapeHtml(c) + '">').join("");
}

function getCategoriesWithCounts() {
    const counts = {};
    counts[""] = 0;
    allBookmarks.forEach((b) => {
        const cat = (b.category || "").trim();
        const key = cat === "" ? "" : cat;
        counts[key] = (counts[key] || 0) + 1;
    });
    const otherKeys = Object.keys(counts).filter((k) => k !== "");
    otherKeys.sort((a, b) => a.localeCompare(b));
    const result = otherKeys.map((k) => ({ name: k, key: k, count: counts[k] || 0 }));
    result.push({ name: "未分类", key: "", count: counts[""] || 0 });
    return result;
}

function renderCategoryList() {
    const list = document.getElementById("bookmarks-category-list");
    if (!list) return;

    const cats = getCategoriesWithCounts();
    list.innerHTML = cats
        .map(
            (c) =>
                '<li class="bookmarks-category-item' +
                (c.key === currentCategory ? " active" : "") +
                '" data-category="' +
                escapeHtml(c.key) +
                '">' +
                '<span class="category-name">' +
                escapeHtml(c.name) +
                "</span>" +
                '<span class="category-count">' +
                c.count +
                "</span></li>"
        )
        .join("");
}

function getFilteredBookmarks() {
    if (currentCategory === "") {
        return allBookmarks.filter((b) => !(b.category || "").trim());
    }
    return allBookmarks.filter((b) => (b.category || "").trim() === currentCategory);
}

function renderBookmarks() {
    const tbody = document.getElementById("bookmarks-tbody");
    if (!tbody) return;

    const items = getFilteredBookmarks();
    if (!items || items.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="4" class="placeholder">暂无数据，请点击左侧“添加”录入书签。</td></tr>';
        return;
    }

    tbody.innerHTML = items
        .map(
            (item, index) => `
        <tr data-id="${item.id}" data-index="${index}">
            <td class="cell-title">${escapeHtml(item.title)}</td>
            <td class="cell-url"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="bookmark-url-link">${escapeHtml(item.url)}</a></td>
            <td class="cell-category">${escapeHtml(item.category || "")}</td>
            <td class="cell-actions">
                <div class="actions-wrap">
                    ${index > 0 ? '<button class="btn operation-btn btn-move-up" data-id="' + item.id + '">上移</button>' : ""}
                    <button class="btn operation-btn btn-edit" data-id="${item.id}">编辑</button>
                    <button class="btn operation-btn btn-delete" data-id="${item.id}">删除</button>
                </div>
            </td>
        </tr>
    `
        )
        .join("");
}

function switchToRenameMode(row) {
    const id = row.getAttribute("data-id");
    const titleCell = row.querySelector(".cell-title");
    const urlCell = row.querySelector(".cell-url");
    const categoryCell = row.querySelector(".cell-category");
    const opCell = row.querySelector(".cell-actions");

    const item = allBookmarks.find((b) => b.id === parseInt(id, 10));
    if (!item) return;

    const titleVal = item.title || "";
    const urlVal = item.url || "";
    const categoryVal = item.category || "";

    titleCell.innerHTML =
        '<input type="text" class="edit-input" data-field="title" value="' +
        escapeHtml(titleVal) +
        '" placeholder="名称" />';
    urlCell.innerHTML =
        '<input type="text" class="edit-input" data-field="url" value="' +
        escapeHtml(urlVal) +
        '" placeholder="网址" />';
    categoryCell.innerHTML =
        '<input type="text" class="edit-input" data-field="category" value="' +
        escapeHtml(categoryVal) +
        '" placeholder="分类" />';
    opCell.innerHTML =
        '<div class="actions-wrap">' +
        '<button class="btn operation-btn btn-save" data-id="' +
        id +
        '">保存</button>' +
        '<button class="btn operation-btn btn-cancel" data-id="' +
        id +
        '">取消</button></div>';
}

function loadBookmarks(callback) {
    fetch("/api/bookmarks")
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                allBookmarks = data.items || [];
                const cats = getCategoriesWithCounts();
                currentCategory = cats.length > 0 ? cats[0].key : "";
                renderCategoryList();
                updateCategoryDatalist();
                renderBookmarks();
                bindCategoryEvents();
                bindRowEvents();
                if (typeof callback === "function") callback();
            } else {
                showToast(data.message || "加载失败", "error");
            }
        })
        .catch((err) => {
            showToast("加载失败：" + (err.message || "网络错误"), "error");
        });
}

function addBookmark() {
    const title = document.getElementById("add-title").value.trim();
    const url = document.getElementById("add-url").value.trim();
    const category = document.getElementById("add-category").value.trim();

    if (!title || !url) {
        showToast("请输入标题和网址", "error");
        return;
    }

    fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, url, category }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                document.getElementById("add-title").value = "";
                document.getElementById("add-url").value = "";
                document.getElementById("add-category").value = "";
                showToast("添加成功");
                loadBookmarks(bindCategoryEvents);
            } else {
                showToast(data.message || "添加失败", "error");
            }
        })
        .catch((err) => {
            showToast("添加失败：" + (err.message || "网络错误"), "error");
        });
}

function updateBookmark(id, title, url, category) {
    fetch("/api/bookmarks/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, url, category }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("更新成功");
                loadBookmarks(bindCategoryEvents);
            } else {
                showToast(data.message || "更新失败", "error");
            }
        })
        .catch((err) => {
            showToast("更新失败：" + (err.message || "网络错误"), "error");
        });
}

function moveUpBookmark(id) {
    fetch("/api/bookmarks/" + id + "/move-up", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("上移成功");
                loadBookmarks(bindCategoryEvents);
            } else {
                showToast(data.message || "上移失败", "error");
            }
        })
        .catch((err) => {
            showToast("上移失败：" + (err.message || "网络错误"), "error");
        });
}

function exportBookmarksToHtml() {
    if (!allBookmarks || allBookmarks.length === 0) {
        showToast("暂无书签可导出", "error");
        return;
    }
    const addDate = Math.floor(Date.now() / 1000);
    const lines = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>书签导出</TITLE>",
        "<H1>书签</H1>",
        "<DL><p>",
    ];
    const byCategory = {};
    allBookmarks.forEach((b) => {
        const cat = (b.category || "").trim() || "未分类";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(b);
    });
    const cats = Object.keys(byCategory).sort((a, b) => {
        if (a === "未分类") return -1;
        if (b === "未分类") return 1;
        return a.localeCompare(b);
    });
    cats.forEach((cat) => {
        lines.push('    <DT><H3>' + escapeHtml(cat) + "</H3>");
        lines.push("    <DL><p>");
        byCategory[cat].forEach((b) => {
            const url = escapeHtml(b.url || "");
            const title = escapeHtml(b.title || "无标题");
            lines.push('        <DT><A HREF="' + url + '" ADD_DATE="' + addDate + '">' + title + "</A>");
        });
        lines.push("    </DL><p>");
    });
    lines.push("</DL><p>");
    const blob = new Blob([lines.join("\n")], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bookmarks_" + new Date().toISOString().slice(0, 10) + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("导出成功");
}

function deleteBookmark(id) {
    if (!confirm("确定要删除这条书签吗？")) return;

    fetch("/api/bookmarks/" + id, { method: "DELETE" })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("删除成功");
                loadBookmarks(bindCategoryEvents);
            } else {
                showToast(data.message || "删除失败", "error");
            }
        })
        .catch((err) => {
            showToast("删除失败：" + (err.message || "网络错误"), "error");
        });
}

function bindCategoryEvents() {
    const list = document.getElementById("bookmarks-category-list");
    if (!list) return;

    list.querySelectorAll(".bookmarks-category-item").forEach((li) => {
        li.onclick = () => {
            currentCategory = li.getAttribute("data-category") || "";
            list.querySelectorAll(".bookmarks-category-item").forEach((el) => el.classList.remove("active"));
            li.classList.add("active");
            renderBookmarks();
            bindRowEvents();
        };
    });
}

function bindRowEvents() {
    const tbody = document.getElementById("bookmarks-tbody");
    if (!tbody) return;

    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            const row = tbody.querySelector('tr[data-id="' + id + '"]');
            if (row) switchToRenameMode(row);
            bindRowEvents();
        };
    });

    tbody.querySelectorAll(".btn-move-up").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            moveUpBookmark(parseInt(id, 10));
        };
    });

    tbody.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            deleteBookmark(parseInt(id, 10));
        };
    });

    tbody.querySelectorAll(".btn-save").forEach((btn) => {
        btn.onclick = () => {
            const id = parseInt(btn.getAttribute("data-id"), 10);
            const row = tbody.querySelector('tr[data-id="' + id + '"]');
            if (!row) return;
            const title = row.querySelector('[data-field="title"]')?.value || "";
            const url = row.querySelector('[data-field="url"]')?.value || "";
            const category = row.querySelector('[data-field="category"]')?.value?.trim() || "";
            updateBookmark(id, title, url, category);
        };
    });

    tbody.querySelectorAll(".btn-cancel").forEach((btn) => {
        btn.onclick = () => {
            loadBookmarks(bindCategoryEvents);
        };
    });
}

function initBookmarks() {
    document.getElementById("btn-go-home").onclick = () => {
        window.location.href = "/home";
    };

    document.getElementById("btn-add").onclick = addBookmark;
    document.getElementById("btn-export").onclick = exportBookmarksToHtml;

    loadBookmarks(bindCategoryEvents);
}

document.addEventListener("DOMContentLoaded", initBookmarks);

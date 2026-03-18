// Global state for pagination and filters
let currentDirectory = "/Users/a53828/Documents";
let currentPage = 1;
let totalPages = 1;
const perPage = 200;
let currentSortBy = "name";
let currentSortOrder = "asc";
let currentFileType = "";
let currentSearchKeyword = "";

/**
 * Set status message or show toast.
 * @param {string} text - Status text.
 * @param {"info"|"success"|"error"|""} level - Status level.
 */
function setStatus(text, level = "") {
    const statusEl = document.getElementById("status-message");
    const loadingText = "正在扫描，请稍候...";

    // 仅在扫描时在页面固定位置展示加载提示
    if (text === loadingText && level === "info") {
        if (statusEl) {
            statusEl.textContent = loadingText;
            statusEl.className = "status-message info";
        }
        return;
    }

    // 其他情况清空固定位置提示，使用 toast 弹出
    if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "status-message";
    }

    if (!text) {
        return;
    }

    const container = document.getElementById("toast-container");
    if (!container) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    if (level === "success") {
        toast.classList.add("toast-success");
    } else if (level === "error") {
        toast.classList.add("toast-error");
    } else {
        toast.classList.add("toast-info");
    }
    toast.textContent = text;
    container.appendChild(toast);

    // 自动隐藏并移除
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 2500);
}

/**
 * Escape HTML special characters to prevent XSS when rendering strings.
 * @param {string} str - Raw string.
 * @returns {string} Escaped string safe for innerHTML.
 */
function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Call backend API to scan current directory.
 */
async function scanDirectory() {
    const inputEl = document.getElementById("selected-dir");
    if (inputEl) {
        currentDirectory = inputEl.value.trim();
    }

    if (!currentDirectory) {
        setStatus("请先在“文件夹路径”中输入要扫描的目录。", "error");
        return;
    }

    const loadingModal = document.getElementById("scan-loading-modal");
    if (loadingModal) loadingModal.classList.remove("hidden");

    try {
        const resp = await fetch("/api/scan", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ directory: currentDirectory }),
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "扫描失败。", "error");
            document.getElementById("file-table-body").innerHTML =
                '<tr><td colspan="8" class="placeholder">没有符合条件的查询结果。</td></tr>';
            return;
        }

        if (data.total === 0) {
            setStatus("扫描完成，没有符合条件的查询结果。", "success");
            document.getElementById("file-table-body").innerHTML =
                '<tr><td colspan="8" class="placeholder">没有符合条件的查询结果。</td></tr>';
        } else {
            setStatus("扫描完成，共找到 " + data.total + " 个文件。", "success");
            currentPage = 1;
            await loadFiles();
        }
    } catch (err) {
        console.error(err);
        setStatus("扫描失败，请检查控制台日志。", "error");
    } finally {
        if (loadingModal) loadingModal.classList.add("hidden");
    }
}

/**
 * Load file list from backend with current filters and pagination.
 * @param {number} [page] - Optional page number to load.
 */
async function loadFiles(page) {
    if (typeof page === "number") {
        currentPage = page;
    }

    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    params.set("per_page", String(perPage));
    params.set("sort_by", currentSortBy);
    params.set("sort_order", currentSortOrder);
    if (currentFileType) {
        params.set("file_type", currentFileType);
    }
    if (currentSearchKeyword) {
        params.set("search", currentSearchKeyword);
    }

    try {
        const resp = await fetch("/api/files?" + params.toString());
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "获取文件列表失败。", "error");
            return;
        }
        renderTable(data.items || []);
        updatePagination(data.page, data.total_pages, data.total);
    } catch (err) {
        console.error(err);
        setStatus("获取文件列表失败，请检查控制台日志。", "error");
    }
}

/**
 * Render file table body with given items.
 * @param {Array<Object>} items - File items.
 */
function renderTable(items) {
    const tbody = document.getElementById("file-table-body");
    if (!items.length) {
        tbody.innerHTML =
            '<tr><td colspan="8" class="placeholder">没有符合条件的查询结果。</td></tr>';
        return;
    }

    const rows = items
        .map((item) => {
            const hiddenClass = item.is_hidden ? "hidden-file" : "";
            const typeDisplay = escapeHtml(item.extension + (item.is_hidden ? "（隐藏）" : ""));
            const nameDisplay = escapeHtml(item.name);
            const sizeDisplay = escapeHtml(item.size_display);

            const createdParts = (item.created_at || "").split(" ");
            const createdDate = escapeHtml(createdParts[0] || "");
            const createdTime = escapeHtml(createdParts[1] || "");
            const createdAt = createdTime ? `${createdDate}<br>${createdTime}` : createdDate;

            const modifiedParts = (item.modified_at || "").split(" ");
            const modifiedDate = escapeHtml(modifiedParts[0] || "");
            const modifiedTime = escapeHtml(modifiedParts[1] || "");
            const modifiedAt = modifiedTime ? `${modifiedDate}<br>${modifiedTime}` : modifiedDate;
            const folderPath = escapeHtml(item.folder_path);
            const remark = escapeHtml(item.remark || "");
            const fullPath = escapeHtml(item.full_path);

            return (
                `<tr data-full-path="${fullPath}">` +
                `<td class="${hiddenClass}">${nameDisplay}<button class="rename-icon" title="编辑文件名">✎</button></td>` +
                `<td>${sizeDisplay}</td>` +
                `<td>${typeDisplay}</td>` +
                `<td><input class="remark-input" type="text" value="${remark}" data-full-path="${fullPath}" /></td>` +
                `<td>${createdAt}</td>` +
                `<td>${modifiedAt}</td>` +
                `<td title="${folderPath}">${folderPath}</td>` +
                `<td>` +
                `<button class="btn operation-btn open-btn">打开</button>` +
                `<button class="btn operation-btn delete-btn">删除</button>` +
                `</td>` +
                `</tr>`
            );
        })
        .join("");

    tbody.innerHTML = rows;
}

/**
 * Update pagination controls and text.
 * @param {number} page - Current page number.
 * @param {number} totalPageCount - Total pages.
 * @param {number} totalItems - Total item count.
 */
function updatePagination(page, totalPageCount, totalItems) {
    currentPage = page;
    totalPages = totalPageCount;

    const info = document.getElementById("pagination-info");
    info.textContent =
        "共 " +
        totalItems +
        " 条记录，每页 " +
        perPage +
        " 条，当前第 " +
        page +
        " / " +
        totalPageCount +
        " 页。";

    const detail = document.getElementById("pagination-page-detail");
    detail.textContent = "第 " + page + " / " + totalPageCount + " 页";

    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");

    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= totalPageCount;
}

/**
 * Handle column header clicks for sorting.
 * @param {MouseEvent} event - Click event.
 */
function handleSortClick(event) {
    const target = event.target.closest("th");
    if (!target) return;
    const sortField = target.getAttribute("data-sort");
    if (!sortField) return;

    if (currentSortBy === sortField) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
    } else {
        currentSortBy = sortField;
        currentSortOrder = "asc";
    }

    // Update indicator arrows
    document.querySelectorAll(".file-table th").forEach((th) => {
        const span = th.querySelector(".sort-indicator");
        if (!span) return;
        const key = th.getAttribute("data-sort");
        if (key === currentSortBy) {
            span.textContent = currentSortOrder === "asc" ? "▲" : "▼";
        } else {
            span.textContent = "";
        }
    });

    loadFiles(1);
}

/**
 * Save comment (注释) for a single file.
 * @param {string} fullPath - Absolute file path.
 * @param {string} remark - Remark text.
 */
async function saveRemark(fullPath, remark) {
    try {
        const resp = await fetch("/api/file/remark", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: fullPath, remark }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "保存备注失败。", "error");
        } else {
            setStatus("备注已保存。", "success");
        }
    } catch (err) {
        console.error(err);
        setStatus("保存备注失败，请检查控制台日志。", "error");
    }
}

/**
 * Delete a file via backend API.
 * @param {string} fullPath - Absolute file path.
 */
let pendingDeleteFilePath = null;

async function deleteFile(fullPath) {
    pendingDeleteFilePath = fullPath;
    const modal = document.getElementById("file-delete-confirm-modal");
    if (modal) modal.classList.remove("hidden");
}

async function confirmDeleteFile() {
    const fullPath = pendingDeleteFilePath;
    if (!fullPath) return;
    pendingDeleteFilePath = null;
    try {
        const resp = await fetch("/api/file/delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: fullPath }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "删除文件失败。", "error");
        } else {
            setStatus("文件已移动到废纸篓。", "success");
            await loadFiles(currentPage);
        }
    } catch (err) {
        console.error(err);
        setStatus("删除文件失败，请检查控制台日志。", "error");
    }
}

/**
 * Open a file via backend API using system default application.
 * @param {string} fullPath - Absolute file path.
 */
async function openFile(fullPath) {
    try {
        const resp = await fetch("/api/file/open", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: fullPath }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "打开文件失败。", "error");
        } else {
            setStatus(data.message || "已尝试打开文件。", "success");
        }
    } catch (err) {
        console.error(err);
        setStatus("打开文件失败，请检查控制台日志。", "error");
    }
}

/**
 * Rename a file via backend API.
 * @param {string} fullPath - Original absolute file path.
 */
async function renameFile(fullPath) {
    const currentName = fullPath.split("/").pop() || "";
    const newName = window.prompt("请输入新的文件名：", currentName);
    if (!newName || newName.trim() === currentName) {
        return;
    }
    try {
        const resp = await fetch("/api/file/rename", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: fullPath, new_name: newName.trim() }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            setStatus(data.message || "重命名失败。", "error");
        } else {
            setStatus("重命名成功。", "success");
            await loadFiles(currentPage);
        }
    } catch (err) {
        console.error(err);
        setStatus("重命名失败，请检查控制台日志。", "error");
    }
}

/**
 * Initialize all event listeners when DOM is ready.
 */
function initEvents() {
    document.getElementById("btn-scan").addEventListener("click", scanDirectory);

    const goHomeBtn = document.getElementById("btn-go-home");
    if (goHomeBtn) {
        goHomeBtn.addEventListener("click", function () {
            window.location.href = "/home";
        });
    }

    document
        .getElementById("filter-type")
        .addEventListener("change", function (e) {
            currentFileType = e.target.value;
            loadFiles(1);
        });

    document
        .getElementById("search-keyword")
        .addEventListener("keyup", function (e) {
            if (e.key === "Enter") {
                currentSearchKeyword = e.target.value.trim();
                loadFiles(1);
            }
        });

    document
        .getElementById("btn-prev-page")
        .addEventListener("click", function () {
            if (currentPage > 1) {
                loadFiles(currentPage - 1);
            }
        });

    document
        .getElementById("btn-next-page")
        .addEventListener("click", function () {
            if (currentPage < totalPages) {
                loadFiles(currentPage + 1);
            }
        });

    // Column sort
    document
        .querySelector(".file-table thead")
        .addEventListener("click", handleSortClick);

    // Delegate for remark change, rename and delete buttons
    document
        .getElementById("file-table-body")
        .addEventListener("change", function (e) {
            if (e.target.classList.contains("remark-input")) {
                const fullPath = e.target.getAttribute("data-full-path");
                const remark = e.target.value;
                saveRemark(fullPath, remark);
            }
        });

    document
        .getElementById("file-table-body")
        .addEventListener("click", function (e) {
            const row = e.target.closest("tr");
            if (!row) return;
            const fullPath = row.getAttribute("data-full-path");
            if (!fullPath) return;

            if (e.target.classList.contains("delete-btn")) {
                deleteFile(fullPath);
            } else if (e.target.classList.contains("rename-icon")) {
                renameFile(fullPath);
            } else if (e.target.classList.contains("open-btn")) {
                openFile(fullPath);
            }
        });

    // 删除文件确认弹窗按钮
    const deleteModal = document.getElementById("file-delete-confirm-modal");
    const btnDeleteCancel = document.getElementById("btn-file-delete-cancel");
    const btnDeleteConfirm = document.getElementById("btn-file-delete-confirm");
    if (btnDeleteCancel && deleteModal) {
        btnDeleteCancel.addEventListener("click", () => {
            deleteModal.classList.add("hidden");
            pendingDeleteFilePath = null;
        });
    }
    if (btnDeleteConfirm && deleteModal) {
        btnDeleteConfirm.addEventListener("click", async () => {
            deleteModal.classList.add("hidden");
            await confirmDeleteFile();
        });
    }
}

document.addEventListener("DOMContentLoaded", function () {
    initEvents();
});


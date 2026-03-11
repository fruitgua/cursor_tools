(function () {
    "use strict";

    const STORAGE_KEY = "todo_items_v1";

    let state = {
        items: [],
        editingId: null,
        doneFilter: "all",
    };

    async function syncToServer(items) {
        try {
            await fetch("/api/todos/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items }),
            });
        } catch (e) {
            console.warn("同步待办数据到服务端失败", e);
        }
    }

    function saveToStorage(items) {
        state.items = items.slice();
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch (e) {
            console.warn("保存到 localStorage 失败", e);
        }
        // 同步到后端，保证多浏览器共享
        syncToServer(items);
    }

    function loadFromStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const arr = JSON.parse(raw) || [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            console.warn("读取 localStorage 失败", e);
            return [];
        }
    }

    function formatDateTimeForDisplay(date) {
        if (!date) return "";
        const d = date instanceof Date ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return "";
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${y}/${m}/${day} ${hh}:${mm}`;
    }

    function formatDateOnly(d) {
        const date = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(date.getTime())) return "";
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${y}/${m}/${day}`;
    }

    function parseDisplayDateTime(str) {
        if (!str) return null;
        const cleaned = str.replace(/\//g, "-").replace(" ", "T");
        const d = new Date(cleaned);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function dateToDatetimeLocalValue(d) {
        const date = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(date.getTime())) return "";
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hh = String(date.getHours() + 0).toString().padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        return `${y}-${m}-${day}T${hh}:${mm}`;
    }

    function categoryLabel(cat) {
        switch (cat) {
            case "work":
                return "工作";
            case "study":
                return "学习";
            case "organize":
                return "整理";
            case "life":
                return "生活";
            case "shopping":
                return "购物";
            default:
                return "其他";
        }
    }

    function categoryBadgeClass(cat) {
        switch (cat) {
            case "work":
                return "badge-work";
            case "study":
                return "badge-study";
            case "organize":
                return "badge-other";
            case "life":
                return "badge-life";
            case "shopping":
                return "badge-shopping";
            default:
                return "badge-other";
        }
    }

    function sortItemsForTodo(items) {
        return items.slice().sort((a, b) => {
            const da = parseDisplayDateTime(a.dueTime) || new Date(8640000000000000);
            const db = parseDisplayDateTime(b.dueTime) || new Date(8640000000000000);
            return da - db;
        });
    }

    function sortItemsForDone(items) {
        return items.slice().sort((a, b) => {
            const da = a.completeDate ? new Date(a.completeDate.replace(/\//g, "-")) : new Date(0);
            const db = b.completeDate ? new Date(b.completeDate.replace(/\//g, "-")) : new Date(0);
            return db - da;
        });
    }

    function escapeHtml(str) {
        if (str == null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderTodoList() {
        const container = document.getElementById("todo-list");
        const todos = sortItemsForTodo(state.items.filter((it) => it.status === "todo"));
        if (!todos.length) {
            container.innerHTML =
                '<div class="empty-state">暂无待办事项，试着添加一个吧。</div>';
            return;
        }
        container.innerHTML = todos
            .map((it) => {
                const due = it.dueTime || "";
                const metaRight = due ? `预计：${due}` : "未设置时间";
                return `
                <div class="todo-card" data-id="${it.id}">
                    <div class="card-actions">
                        <button type="button" class="card-action-btn edit">编辑</button>
                        <button type="button" class="card-action-btn delete">删除</button>
                    </div>
                    <div class="todo-card-header">
                        <div class="todo-card-header-left">
                            <input type="checkbox" class="todo-checkbox" data-id="${it.id}" />
                            <span class="category-badge ${categoryBadgeClass(
                                it.category
                            )}">${categoryLabel(it.category)}</span>
                            <span class="todo-meta">${metaRight}</span>
                        </div>
                    </div>
                    <div class="todo-card-content">${escapeHtml(it.content || "")}</div>
                </div>
            `;
            })
            .join("");

        container.querySelectorAll(".todo-checkbox").forEach((cb) => {
            cb.addEventListener("change", onToggleTodoStatus);
        });
        container.querySelectorAll(".card-action-btn.edit").forEach((btn) => {
            btn.addEventListener("click", onEditClick);
        });
        container.querySelectorAll(".card-action-btn.delete").forEach((btn) => {
            btn.addEventListener("click", onDeleteClick);
        });
    }

    function renderDoneList() {
        const container = document.getElementById("done-list");
        let dones = state.items.filter((it) => it.status === "done");
        if (state.doneFilter !== "all") {
            dones = dones.filter((it) => it.category === state.doneFilter);
        }
        dones = sortItemsForDone(dones);
        if (!dones.length) {
            container.innerHTML =
                '<div class="empty-state">暂无已完成事项。</div>';
            return;
        }
        container.innerHTML = dones
            .map((it) => {
                const cat = categoryLabel(it.category);
                const completeStr = it.completeDate
                    ? `${it.completeDate.replace(/\//g, "-")}完成`
                    : "";
                return `
                <div class="done-item" data-id="${it.id}">
                    <div class="done-top">
                        <div class="done-top-left">
                            <span class="category-badge ${categoryBadgeClass(
                                it.category
                            )}">${cat}</span>
                            <span class="done-content">${escapeHtml(it.content || "")}</span>
                        </div>
                        <span class="done-date">${completeStr}</span>
                    </div>
                </div>
            `;
            })
            .join("");
    }

    function renderAll() {
        renderTodoList();
        renderDoneList();
    }

    function onToggleTodoStatus(e) {
        const id = e.target.getAttribute("data-id");
        if (!id) return;
        const items = state.items.slice();
        const idx = items.findIndex((it) => it.id === id);
        if (idx === -1) return;
        const item = items[idx];
        if (item.status === "todo") {
            item.status = "done";
            item.completeDate = formatDateOnly(new Date());
        } else {
            item.status = "todo";
            item.completeDate = "";
        }
        saveToStorage(items);
        renderAll();
    }

    function onDeleteClick(e) {
        const card = e.target.closest(".todo-card, .done-item");
        if (!card) return;
        const id = card.getAttribute("data-id");
        if (!id) return;
        if (!confirm("确定要删除这条待办事项吗？")) return;
        const items = state.items.filter((it) => it.id !== id);
        saveToStorage(items);
        renderAll();
    }

    function onEditClick(e) {
        const card = e.target.closest(".todo-card");
        if (!card) return;
        const id = card.getAttribute("data-id");
        if (!id) return;
        openEditModal(id);
    }

    function parseDueRaw(dueRaw) {
        if (!dueRaw) return { display: "", hasTime: false };
        const m = dueRaw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
        if (m) {
            const y = Number(m[1]);
            const mo = Number(m[2]) - 1;
            const d = Number(m[3]);
            const hh = m[4] != null ? Number(m[4]) : 0;
            const mm = m[5] != null ? Number(m[5]) : 0;
            const date = new Date(y, mo, d, hh, mm);
            if (!Number.isNaN(date.getTime())) {
                return {
                    display: m[4] != null ? formatDateTimeForDisplay(date) : formatDateOnly(date),
                    hasTime: m[4] != null,
                };
            }
        }
        const fallback = new Date(dueRaw);
        if (!Number.isNaN(fallback.getTime())) {
            return {
                display: formatDateTimeForDisplay(fallback),
                hasTime: true,
            };
        }
        return { display: "", hasTime: false };
    }

    function onAddTodo() {
        const categoryEl = document.getElementById("new-category");
        const contentEl = document.getElementById("new-content");
        const dueEl = document.getElementById("new-due");

        const category = categoryEl.value || "other";
        const content = (contentEl.value || "").trim();
        let dueRaw = dueEl.value;

        if (!content) {
            alert("请填写待办内容。");
            return;
        }

        const now = new Date();
        if (dueRaw && dueRaw.length === 10) {
            // 仅选择了日期，默认时间补为 12:00
            dueRaw = dueRaw + "T12:00";
        }
        const parsedDue = parseDueRaw(dueRaw);
        const dueStr = parsedDue.display;

        const newItem = {
            id: "todo_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
            category,
            content,
            dueTime: dueStr,
            status: "todo",
            createTime: now.toISOString(),
            completeDate: "",
        };

        const items = state.items.concat(newItem);
        saveToStorage(items);
        contentEl.value = "";
        // 新增后重置为当前日期 +7 天的 12:00
        if (dueEl) {
            const next = new Date();
            next.setDate(next.getDate() + 7);
            next.setHours(12, 0, 0, 0);
            dueEl.value = dateToDatetimeLocalValue(next);
        }
        renderAll();
    }

    function onFilterChange(e) {
        state.doneFilter = e.target.value || "all";
        renderDoneList();
    }

    function openEditModal(id) {
        const item = state.items.find((it) => it.id === id);
        if (!item) return;
        state.editingId = id;

        const overlay = document.getElementById("edit-modal-overlay");
        const catEl = document.getElementById("edit-category");
        const contentEl = document.getElementById("edit-content");
        const dueEl = document.getElementById("edit-due");

        catEl.value = item.category || "other";
        contentEl.value = item.content || "";
        dueEl.value = item.dueTime
            ? dateToDatetimeLocalValue(parseDisplayDateTime(item.dueTime))
            : "";

        overlay.classList.add("open");
    }

    function closeEditModal() {
        state.editingId = null;
        document.getElementById("edit-modal-overlay").classList.remove("open");
    }

    function onEditSave() {
        if (!state.editingId) {
            closeEditModal();
            return;
        }
        const catEl = document.getElementById("edit-category");
        const contentEl = document.getElementById("edit-content");
        const dueEl = document.getElementById("edit-due");

        const category = catEl.value || "other";
        const content = (contentEl.value || "").trim();
        let dueRaw = dueEl.value;

        if (!content) {
            alert("内容不能为空。");
            return;
        }

        if (dueRaw && dueRaw.length === 10) {
            dueRaw = dueRaw + "T12:00";
        }
        const parsedDue = parseDueRaw(dueRaw);
        const dueStr = parsedDue.display;

        const items = state.items.slice();
        const idx = items.findIndex((it) => it.id === state.editingId);
        if (idx === -1) {
            closeEditModal();
            return;
        }
        const item = items[idx];
        item.category = category;
        item.content = content;
        item.dueTime = dueStr;

        saveToStorage(items);
        closeEditModal();
        renderAll();
    }

    async function loadFromServerAndMerge() {
        const localItems = loadFromStorage();
        let serverItems = [];
        try {
            const res = await fetch("/api/todos/state");
            if (res && res.ok) {
                const json = await res.json();
                if (json && json.success && json.data && Array.isArray(json.data.items)) {
                    serverItems = json.data.items;
                }
            }
        } catch (e) {
            console.warn("从服务端读取待办数据失败", e);
        }

        // 三种情况合并：只本地、只服务端、两边都有。有本地数据时要 await 上传，保证历史数据同步到服务端。
        let merged = [];
        if (!serverItems.length && !localItems.length) {
            merged = [];
        } else if (!serverItems.length && localItems.length) {
            // 仅有本地数据（含历史）：先上传到服务器，再更新界面
            merged = localItems.slice();
            await syncToServer(merged);
        } else if (serverItems.length && !localItems.length) {
            // 仅有服务端数据：写入本地
            merged = serverItems.slice();
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch (e) {
                console.warn("保存服务端待办数据到 localStorage 失败", e);
            }
        } else {
            // 两边都有：合并（服务端 + 本地独有），上传合并结果，保证历史数据进服务端
            const byId = {};
            serverItems.forEach((it) => {
                if (it && it.id) byId[it.id] = it;
            });
            localItems.forEach((it) => {
                if (it && it.id && !byId[it.id]) {
                    byId[it.id] = it;
                }
            });
            merged = Object.values(byId);
            await syncToServer(merged);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch (e) {
                console.warn("保存合并后的待办数据到 localStorage 失败", e);
            }
        }

        state.items = merged.slice();
        renderAll();
    }

    function init() {
        // 先加载本地，确保旧数据立即可见
        state.items = loadFromStorage();
        document
            .getElementById("btn-add-todo")
            .addEventListener("click", onAddTodo);
        document
            .getElementById("done-filter")
            .addEventListener("change", onFilterChange);

        // 新增待办时，预计完成时间默认设置为今天 12:00
        const newDueEl = document.getElementById("new-due");
        if (newDueEl && !newDueEl.value) {
            const now = new Date();
            // 默认设置为当日 + 7 天的 12:00
            now.setDate(now.getDate() + 7);
            now.setHours(12, 0, 0, 0);
            newDueEl.value = dateToDatetimeLocalValue(now);
        }

        document
            .getElementById("edit-modal-close")
            .addEventListener("click", closeEditModal);
        document
            .getElementById("edit-modal-cancel")
            .addEventListener("click", closeEditModal);
        document
            .getElementById("edit-modal-save")
            .addEventListener("click", onEditSave);
        document
            .getElementById("edit-modal-overlay")
            .addEventListener("click", (e) => {
                if (e.target.id === "edit-modal-overlay") {
                    closeEditModal();
                }
            });

        const btnHome = document.getElementById("btn-go-home");
        if (btnHome) {
            btnHome.addEventListener("click", () => {
                window.location.href = "/home";
            });
        }

        renderAll();

        // 然后与服务端数据合并 & 同步，支持多浏览器共享
        loadFromServerAndMerge();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();


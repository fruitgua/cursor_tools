let quill = null;
let saveEnabled = true;
let isDirty = false;
let autoSaveTimer = null;
let diaryItems = [];
let currentDate = "";
let lastSavedSnapshot = null;

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

function parseDbTimeToDate(ts) {
    if (ts == null) return null;
    if (typeof ts === "number" && isFinite(ts)) return new Date(ts * 1000);
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    return null;
}

function formatYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** 默认筛选：最近 3 个月（含当日），即 [今日−3个月, 今日] */
function setDefaultDateRangeFilters() {
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth() - 3, end.getDate());
    const startEl = document.getElementById("diary-filter-start");
    const endEl = document.getElementById("diary-filter-end");
    if (startEl) startEl.value = formatYMD(start);
    if (endEl) endEl.value = formatYMD(end);
}

function setLastUpdatedLabel(dateObj) {
    const el = document.getElementById("diary-last-updated");
    if (!el) return;
    el.textContent = dateObj ? "上次更新时间：" + formatDateTimeToMinute(dateObj) : "上次更新时间：-";
}

function setWordCountLabel(text) {
    const el = document.getElementById("diary-word-count");
    if (!el) return;
    el.textContent = "总字数: " + (text || "-");
}

function refreshWordCount() {
    if (!quill) return setWordCountLabel("-");
    const raw = String(quill.getText ? quill.getText() || "" : quill.root?.textContent || "");
    setWordCountLabel(String(raw.replace(/\s+/g, "").length));
}

function initQuill() {
    if (quill) return quill;
    if (typeof Quill === "undefined") {
        console.error("Quill 未加载");
        return null;
    }
    if (typeof globalThis.AppQuillShared === "undefined") {
        console.error("quill-shared.js 未加载");
        return null;
    }
    quill = new Quill("#diary-editor", {
        theme: "snow",
        modules: globalThis.AppQuillShared.snowToolbarModules(() => quill),
    });
    globalThis.AppQuillShared.attachImagePasteFromClipboard(quill);
    quill.on("text-change", () => {
        markDirty();
        refreshWordCount();
    });
    return quill;
}

function getCurrentSnapshot() {
    if (!currentDate) return null;
    return {
        date: currentDate,
        title: document.getElementById("diary-title").value || "",
        today_diet: document.getElementById("diary-today-diet")?.value || "",
        exercise_summary: document.getElementById("diary-exercise-summary")?.value || "",
        content: quill ? quill.root.innerHTML || "" : "",
    };
}

function snapshotEquals(a, b) {
    if (!a || !b) return false;
    return (
        a.date === b.date &&
        a.title === b.title &&
        (a.today_diet || "") === (b.today_diet || "") &&
        (a.exercise_summary || "") === (b.exercise_summary || "") &&
        a.content === b.content
    );
}

function markDirty() {
    if (!saveEnabled || !currentDate) return;
    isDirty = true;
}

function renderDiaryList(items) {
    const list = document.getElementById("diary-list");
    const count = document.getElementById("diary-count-num");
    if (!list) return;
    if (count) count.textContent = String((items || []).length);
    if (!items || !items.length) {
        list.innerHTML = '<li class="notes-list-empty">暂无日记</li>';
        return;
    }
    list.innerHTML = items
        .map(
            (it) =>
                `<li class="notes-list-item" data-date="${it.date}">
                    <span class="notes-list-title">${escapeHtml((it.date || "") + "  " + (it.title || "(无今日小结)"))}</span>
                </li>`
        )
        .join("");
    document.querySelectorAll(".notes-list-item").forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-date") === currentDate);
    });
}

function getFilteredItems() {
    const start = String(document.getElementById("diary-filter-start")?.value || "").trim();
    const end = String(document.getElementById("diary-filter-end")?.value || "").trim();
    if (!start && !end) return diaryItems;
    let from = start || end;
    let to = end || start;
    if (from > to) {
        const t = from;
        from = to;
        to = t;
    }
    return diaryItems.filter((x) => {
        const d = String(x.date || "");
        if (!d) return false;
        return d >= from && d <= to;
    });
}

function applyFilterAndRender() {
    renderDiaryList(getFilteredItems());
}

function setEditorByItem(item, dateStr) {
    saveEnabled = false;
    currentDate = dateStr;
    document.getElementById("diary-date").value = dateStr;
    document.getElementById("diary-title").value = (item && item.title) || "";
    const dietEl = document.getElementById("diary-today-diet");
    if (dietEl) dietEl.value = (item && item.today_diet) || "";
    const exEl = document.getElementById("diary-exercise-summary");
    if (exEl) exEl.value = (item && item.exercise_summary) || "";
    if (quill) quill.root.innerHTML = (item && item.content) || "";
    refreshWordCount();
    setLastUpdatedLabel(item ? parseDbTimeToDate(item.updated_at) || parseDbTimeToDate(item.created_at) : null);
    lastSavedSnapshot = getCurrentSnapshot();
    isDirty = false;
    saveEnabled = true;
    applyFilterAndRender();
}

function loadDiary(dateStr) {
    fetch("/api/diaries/" + encodeURIComponent(dateStr))
        .then((r) => r.json())
        .then((data) => {
            if (data && data.success && data.item) {
                setEditorByItem(data.item, dateStr);
            } else {
                setEditorByItem(null, dateStr);
            }
        })
        .catch(() => setEditorByItem(null, dateStr));
}

function loadDiaryList(callback) {
    fetch("/api/diaries")
        .then((r) => r.json())
        .then((data) => {
            if (!data || !data.success) throw new Error((data && data.message) || "加载失败");
            diaryItems = Array.isArray(data.items) ? data.items : [];
            applyFilterAndRender();
            if (typeof callback === "function") callback();
        })
        .catch((e) => showToast(e.message || "加载失败", "error"));
}

function notifyCalendarDiarySaved(dateStr) {
    const payload = JSON.stringify({ date: dateStr, ts: Date.now() });
    try {
        localStorage.setItem("calendar-diary-updated", payload);
    } catch (_) {}
    window.dispatchEvent(new CustomEvent("calendar-diary-updated", { detail: { date: dateStr } }));
}

function saveCurrentDiarySilently() {
    if (!currentDate || !saveEnabled) return Promise.resolve(false);
    const snap = getCurrentSnapshot();
    if (!snap) return Promise.resolve(false);
    if (String(snap.today_diet || "").length > 200) {
        showToast("今日饮食不能超过200字", "error");
        return Promise.resolve(false);
    }
    if (String(snap.exercise_summary || "").length > 500) {
        showToast("锻炼小结不能超过500字", "error");
        return Promise.resolve(false);
    }
    if (lastSavedSnapshot && snapshotEquals(snap, lastSavedSnapshot)) {
        isDirty = false;
        return Promise.resolve(false);
    }
    return fetch("/api/diaries/" + encodeURIComponent(currentDate), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            title: snap.title,
            content: snap.content,
            today_diet: snap.today_diet || "",
            exercise_summary: snap.exercise_summary || "",
        }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (!data || !data.success) return false;
            lastSavedSnapshot = snap;
            isDirty = false;
            setLastUpdatedLabel(new Date());
            loadDiaryList();
            notifyCalendarDiarySaved(currentDate);
            return true;
        })
        .catch(() => false);
}

function startAutoSaveTimer() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
        if (!isDirty) return;
        saveCurrentDiarySilently();
    }, 60000);
}

function ensureCurrentDate() {
    if (currentDate) return currentDate;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function bindEvents() {
    document.getElementById("btn-go-home").onclick = () => {
        window.location.href = "/home";
    };
    document.getElementById("diary-filter-start")?.addEventListener("change", applyFilterAndRender);
    document.getElementById("diary-filter-end")?.addEventListener("change", applyFilterAndRender);
    document.getElementById("diary-list").addEventListener("click", (e) => {
        const item = e.target.closest(".notes-list-item");
        if (!item) return;
        const dateStr = item.getAttribute("data-date");
        if (!dateStr) return;
        loadDiary(dateStr);
    });
    document.getElementById("diary-title").addEventListener("input", markDirty);
    document.getElementById("diary-today-diet")?.addEventListener("input", markDirty);
    document.getElementById("diary-exercise-summary")?.addEventListener("input", markDirty);
    document.getElementById("btn-save-diary-now").addEventListener("click", () => {
        markDirty();
        saveCurrentDiarySilently();
    });
}

function initDiary() {
    if (!initQuill()) {
        showToast("富文本编辑器加载失败，请刷新页面", "error");
        return;
    }
    setDefaultDateRangeFilters();
    bindEvents();
    loadDiaryList(() => {
        const filtered = getFilteredItems();
        const first =
            (filtered[0] && filtered[0].date) ||
            (diaryItems[0] && diaryItems[0].date) ||
            ensureCurrentDate();
        loadDiary(first);
    });
    startAutoSaveTimer();
}

document.addEventListener("DOMContentLoaded", initDiary);

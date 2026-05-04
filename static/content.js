(() => {
    const WATCH_CATEGORIES = ["短剧", "长剧", "电影", "TV动画", "剧场动画", "AI漫剧"];
    const BOOK_CATEGORIES = ["书籍"];
    let contentConfirmCallback = null;

    const state = {
        items: [],
        tags: [],
        selectedId: null,
        editingTagId: null,
        selectedTagIds: [],
        creatorChips: [],
        relatedRecordRefs: [],
        extJsonBase: {},
        relatedSuggestTimer: null,
        creatorSuggestTimer: null,
        relatedOriginalCache: {},
        lastAutoOriginalWork: "",
        page: 1,
        pageSize: 20,
        total: 0,
    };

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
        }, 2200);
    }

    function esc(s) {
        const div = document.createElement("div");
        div.textContent = s == null ? "" : String(s);
        return div.innerHTML;
    }

    function escAttr(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;")
            .replace(/</g, "&lt;");
    }

    const CONTENT_RECORD_PUBLIC_ID_RE = /^(DR|RE)\d{6}$/i;

    /** @returns {string} normalized DR###### / RE######, or "" if invalid */
    function normalizeContentRecordPublicId(raw) {
        const s = String(raw == null ? "" : raw).trim().toUpperCase();
        if (!CONTENT_RECORD_PUBLIC_ID_RE.test(s)) return "";
        return s.slice(0, 2) + s.slice(2);
    }

    function recordTypeFromWatchBookChecks(wChecked, bChecked) {
        if (wChecked && bChecked) return "all";
        if (wChecked) return "watch";
        if (bChecked) return "book";
        return "";
    }

    function tagTypeMarkersHtml(rt) {
        const r = String(rt || "").toLowerCase();
        if (r === "all") {
            return (
                '<span class="content-tag-rt-mark">追剧</span><span class="content-tag-rt-mark">读书</span>'
            );
        }
        if (r === "book") return '<span class="content-tag-rt-mark">读书</span>';
        return '<span class="content-tag-rt-mark">追剧</span>';
    }

    function today() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function formatDateTimeToMinute(d) {
        return (
            d.getFullYear() +
            "-" +
            pad2(d.getMonth() + 1) +
            "-" +
            pad2(d.getDate()) +
            " " +
            pad2(d.getHours()) +
            ":" +
            pad2(d.getMinutes())
        );
    }

    function formatRecordTs(raw) {
        if (raw == null || raw === "") return "-";
        let d;
        if (typeof raw === "number" && Number.isFinite(raw)) {
            // DB 存 Unix 秒（strftime '%s'）；Date 构造函数需要毫秒
            d = new Date(raw < 1e12 ? raw * 1000 : raw);
        } else {
            const n = Number(raw);
            if (Number.isFinite(n) && /^\s*\d+(\.\d+)?\s*$/.test(String(raw))) {
                d = new Date(n < 1e12 ? n * 1000 : n);
            } else {
                d = new Date(raw);
            }
        }
        if (!Number.isFinite(d.getTime())) {
            const s = String(raw).trim();
            return s || "-";
        }
        return formatDateTimeToMinute(d);
    }

    function setFormRecordMeta(item) {
        const c = document.getElementById("content-meta-created");
        const u = document.getElementById("content-meta-updated");
        if (!c || !u) return;
        if (!item) {
            c.textContent = "创建时间：-";
            u.textContent = "更新时间：-";
            return;
        }
        c.textContent = "创建时间：" + formatRecordTs(item.created_at);
        u.textContent = "更新时间：" + formatRecordTs(item.updated_at);
    }

    function updateFormActionBar() {
        const isEdit = !!state.selectedId;
        const delBtn = document.getElementById("btn-content-delete");
        const resetBtn = document.getElementById("btn-content-form-reset");
        const saveBtn = document.getElementById("btn-content-save");
        const leftWrap = document.getElementById("content-drawer-actions-left");
        if (delBtn) delBtn.hidden = !isEdit;
        if (resetBtn) resetBtn.hidden = isEdit;
        if (saveBtn) saveBtn.textContent = "保存";
        if (leftWrap) leftWrap.hidden = !isEdit;
    }

    function openContentConfirm(message, onOk) {
        const modal = document.getElementById("content-confirm-modal");
        const textEl = document.getElementById("content-confirm-text");
        if (!modal || !textEl) {
            if (window.confirm(message)) void Promise.resolve().then(() => onOk());
            return;
        }
        textEl.textContent = message;
        contentConfirmCallback = onOk;
        modal.classList.remove("hidden");
    }

    function closeContentConfirm() {
        contentConfirmCallback = null;
        document.getElementById("content-confirm-modal")?.classList.add("hidden");
    }

    function bindContentConfirmModal() {
        document.getElementById("content-confirm-cancel")?.addEventListener("click", () => closeContentConfirm());
        document.getElementById("content-confirm-ok")?.addEventListener("click", async () => {
            const fn = contentConfirmCallback;
            contentConfirmCallback = null;
            document.getElementById("content-confirm-modal")?.classList.add("hidden");
            if (typeof fn === "function") await fn();
        });
    }

    function openRecordDrawer() {
        document.getElementById("content-record-drawer-overlay")?.classList.add("open");
        document.getElementById("content-record-drawer")?.classList.add("open");
        document.getElementById("content-record-drawer-overlay")?.setAttribute("aria-hidden", "false");
    }

    function closeRecordDrawer() {
        document.getElementById("content-record-drawer-overlay")?.classList.remove("open");
        document.getElementById("content-record-drawer")?.classList.remove("open");
        document.getElementById("content-record-drawer-overlay")?.setAttribute("aria-hidden", "true");
        state.selectedId = null;
        renderCardGrid();
        updateFormActionBar();
    }

    function resetCoverPreview() {
        const urlEl = document.getElementById("f-cover-url");
        const img = document.getElementById("f-cover-preview");
        const ph = document.getElementById("f-cover-placeholder");
        if (urlEl) urlEl.value = "";
        if (img) {
            img.removeAttribute("src");
            img.style.display = "none";
        }
        if (ph) ph.style.display = "block";
    }

    function applyCoverUrlToPreview(url) {
        const u = String(url || "").trim();
        const urlEl = document.getElementById("f-cover-url");
        const img = document.getElementById("f-cover-preview");
        const ph = document.getElementById("f-cover-placeholder");
        if (urlEl) urlEl.value = u;
        if (!u) {
            resetCoverPreview();
            return;
        }
        if (img) {
            img.src = u;
            img.style.display = "block";
        }
        if (ph) ph.style.display = "none";
    }

    async function uploadCoverBlob(blob) {
        const fd = new FormData();
        const ext = (blob.type || "").includes("png")
            ? "image.png"
            : (blob.type || "").includes("webp")
              ? "image.webp"
              : (blob.type || "").includes("gif")
                ? "image.gif"
                : "image.jpg";
        fd.append("file", blob, ext);
        const res = await fetch("/api/content/cover", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success || !data.url) {
            showToast((data && data.message) || "封面上传失败", "error");
            return;
        }
        applyCoverUrlToPreview(data.url);
        showToast("封面已更新");
    }

    function bindCoverPaste() {
        const zone = document.getElementById("f-cover-paste");
        if (!zone || zone.dataset.boundCover === "1") return;
        zone.dataset.boundCover = "1";
        zone.addEventListener("click", () => zone.focus());
        zone.addEventListener("paste", (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items || !items.length) return;
            let blob = null;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.kind === "file" && it.type && it.type.indexOf("image/") === 0) {
                    blob = it.getAsFile();
                    break;
                }
            }
            if (!blob) return;
            e.preventDefault();
            void uploadCoverBlob(blob);
        });
    }

    function parseLegacyRelatedText(text) {
        const t = String(text || "").trim();
        if (!t) return [];
        const parts = t.split(/\s*[·｜|、,，;；/\n]+\s*/).map((s) => s.trim()).filter(Boolean);
        return (parts.length ? parts : [t]).map((title) => ({ id: null, title, record_type: "" }));
    }

    function parseRelatedRecordRefsFromItem(item) {
        if (!item) return [];
        try {
            const ext = JSON.parse(item.ext_json || "{}");
            if (Array.isArray(ext.related_record_refs)) {
                return ext.related_record_refs
                    .map((r) => {
                        const nid = normalizeContentRecordPublicId(r && r.id);
                        return {
                            id: nid || null,
                            title: String(r && r.title != null ? r.title : "").trim(),
                            record_type: String(r && r.record_type != null ? r.record_type : "").trim(),
                        };
                    })
                    .filter((r) => r.title);
            }
        } catch {
            /* ignore */
        }
        return parseLegacyRelatedText(String(item.related_series || "").trim());
    }

    function relatedRefKey(r) {
        const nid = r && r.id != null ? normalizeContentRecordPublicId(r.id) : "";
        if (nid) return `id:${nid}`;
        return `t:${String(r && r.title ? r.title : "")}`;
    }

    async function tryPrefillOriginalWorkFromRelated(ref) {
        const id = ref && ref.id != null ? normalizeContentRecordPublicId(ref.id) : "";
        if (!id) return;
        const owEl = document.getElementById("f-original-work");
        if (!owEl) return;
        const current = String(owEl.value || "").trim();
        const autoPrev = String(state.lastAutoOriginalWork || "").trim();
        // 用户已经手动输入时，不再覆盖；仅把它当默认值自动带入
        if (current && current !== autoPrev) return;

        let relatedOw = state.relatedOriginalCache[id];
        if (relatedOw === undefined) {
            try {
                const res = await fetch(`/api/content/records/${encodeURIComponent(id)}`);
                const data = await res.json().catch(() => ({}));
                relatedOw =
                    data && data.success && data.item ? String(data.item.original_work || "").trim() : "";
            } catch {
                relatedOw = "";
            }
            state.relatedOriginalCache[id] = relatedOw;
        }

        if (!relatedOw) return;
        owEl.value = relatedOw;
        state.lastAutoOriginalWork = relatedOw;
    }

    function addRelatedRecordRef(ref) {
        const title = String(ref && ref.title != null ? ref.title : "").trim();
        if (!title) return;
        const id = ref && ref.id != null ? normalizeContentRecordPublicId(ref.id) || null : null;
        const record_type = String(ref && ref.record_type != null ? ref.record_type : "").trim();
        const next = (state.relatedRecordRefs || []).slice();
        const k = relatedRefKey({ id, title });
        if (next.some((x) => relatedRefKey(x) === k)) return;
        next.push({ id, title, record_type });
        state.relatedRecordRefs = next;
        renderRelatedChips();
        void tryPrefillOriginalWorkFromRelated({ id });
    }

    function renderRelatedChips() {
        const mount = document.getElementById("f-related-selected");
        if (!mount) return;
        mount.querySelectorAll(".content-related-chip").forEach((c) => c.remove());
        (state.relatedRecordRefs || []).forEach((r, idx) => {
            const chip = document.createElement("span");
            chip.className = "content-related-chip content-creator-chip";
            const sub = r.record_type === "book" ? "读书" : r.record_type === "watch" ? "追剧" : "";
            const subHtml = sub ? ` <small class="content-related-chip-sub">${esc(sub)}</small>` : "";
            chip.innerHTML = `${esc(r.title || "")}${subHtml} <button type="button" aria-label="移除" data-related-idx="${idx}">×</button>`;
            mount.appendChild(chip);
        });
    }

    function hideRelatedDropdown() {
        const dd = document.getElementById("f-related-dropdown");
        if (dd) dd.style.display = "none";
    }

    async function fetchRelatedTitleSuggest() {
        const input = document.getElementById("f-related-input");
        const dd = document.getElementById("f-related-dropdown");
        if (!input || !dd) return;
        const q = String(input.value || "").trim();
        if (!q) {
            dd.innerHTML = "";
            dd.style.display = "none";
            return;
        }
        const excludeNorm = state.selectedId ? normalizeContentRecordPublicId(state.selectedId) : "";
        const pickedIds = new Set(
            (state.relatedRecordRefs || [])
                .map((r) => (r && r.id != null ? normalizeContentRecordPublicId(r.id) : ""))
                .filter(Boolean)
        );
        const params = new URLSearchParams({ q, limit: "30" });
        if (excludeNorm) params.set("exclude_id", excludeNorm);
        const res = await fetch(`/api/content/title-suggest?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success || !Array.isArray(data.items)) {
            dd.innerHTML = "";
            dd.style.display = "none";
            return;
        }
        const rows = data.items.filter((it) => it && !pickedIds.has(normalizeContentRecordPublicId(it.id)));
        if (!rows.length) {
            dd.innerHTML = `<div class="content-related-option content-related-option-empty">无匹配记录</div>`;
            dd.style.display = "block";
            return;
        }
        dd.innerHTML = rows
            .map((it) => {
                const sub = it.record_type === "book" ? "读书" : it.record_type === "watch" ? "追剧" : "";
                const subHtml = sub ? `<span class="content-related-opt-type">${esc(sub)}</span>` : "";
                const tEnc = encodeURIComponent(String(it.title || ""));
                const rtEnc = encodeURIComponent(String(it.record_type || ""));
                return `<button type="button" class="content-related-option" data-pick-id="${escAttr(
                    String(it.id || "")
                )}" data-pick-title="${tEnc}" data-pick-rt="${rtEnc}">
                    <span class="content-related-opt-title">${esc(it.title || "")}</span>${subHtml}
                </button>`;
            })
            .join("");
        dd.style.display = "block";
    }

    function scheduleRelatedSuggest() {
        if (state.relatedSuggestTimer) clearTimeout(state.relatedSuggestTimer);
        state.relatedSuggestTimer = setTimeout(() => {
            state.relatedSuggestTimer = null;
            fetchRelatedTitleSuggest();
        }, 200);
    }

    function readPickAttrs(btn) {
        if (!btn) return null;
        let title = "";
        let record_type = "";
        try {
            title = decodeURIComponent(String(btn.getAttribute("data-pick-title") || ""));
        } catch {
            title = String(btn.getAttribute("data-pick-title") || "");
        }
        try {
            record_type = decodeURIComponent(String(btn.getAttribute("data-pick-rt") || ""));
        } catch {
            record_type = String(btn.getAttribute("data-pick-rt") || "");
        }
        const idRaw = String(btn.getAttribute("data-pick-id") || "").trim();
        const id = normalizeContentRecordPublicId(idRaw) || null;
        if (!title.trim()) return null;
        return { id, title: title.trim(), record_type: record_type.trim() };
    }

    function pickFirstRelatedOption() {
        const dd = document.getElementById("f-related-dropdown");
        if (!dd || dd.style.display === "none") return;
        const btn = dd.querySelector("button.content-related-option[data-pick-id]");
        const picked = readPickAttrs(btn);
        if (!picked) return;
        addRelatedRecordRef(picked);
        const input = document.getElementById("f-related-input");
        if (input) input.value = "";
        hideRelatedDropdown();
    }

    function bindRelatedWorkPicker() {
        const searchWrap = document.getElementById("f-related-search-wrap");
        const selected = document.getElementById("f-related-selected");
        const input = document.getElementById("f-related-input");
        const dd = document.getElementById("f-related-dropdown");
        const field = document.getElementById("f-related-field");
        if (!searchWrap || !input || !dd || !field) return;
        if (field.dataset.boundRelated === "1") return;
        field.dataset.boundRelated = "1";

        input.addEventListener("input", () => {
            scheduleRelatedSuggest();
        });
        input.addEventListener("focus", () => {
            if (String(input.value || "").trim()) scheduleRelatedSuggest();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                pickFirstRelatedOption();
            } else if (e.key === "Escape") {
                hideRelatedDropdown();
            }
        });
        input.addEventListener("blur", () => {
            setTimeout(() => hideRelatedDropdown(), 180);
        });

        dd.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const btn = e.target.closest("button.content-related-option[data-pick-id]");
            if (!btn) return;
            const picked = readPickAttrs(btn);
            if (!picked) return;
            addRelatedRecordRef(picked);
            input.value = "";
            hideRelatedDropdown();
        });

        selected?.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-related-idx]");
            if (!btn) return;
            const idx = Number(btn.getAttribute("data-related-idx"));
            if (!Number.isFinite(idx)) return;
            state.relatedRecordRefs.splice(idx, 1);
            renderRelatedChips();
        });

        document.addEventListener("click", (e) => {
            if (!field || !dd) return;
            if (!field.contains(e.target)) hideRelatedDropdown();
        });
    }

    function parseCreatorNamesFromItem(item) {
        if (!item) return [];
        try {
            const ext = JSON.parse(item.ext_json || "{}");
            if (Array.isArray(ext.creator_names)) {
                return ext.creator_names.map((s) => String(s || "").trim()).filter(Boolean);
            }
        } catch {
            /* ignore */
        }
        const raw = String(item.creator || "").trim();
        if (!raw) return [];
        const parts = raw.split(/\s*[·｜|、,，;；/\n]+\s*/).map((s) => s.trim()).filter(Boolean);
        return parts.length > 1 ? parts : [raw];
    }

    /** 列表卡片：主演/作者仅展示前两位（与 parseCreatorNamesFromItem 拆分规则一致） */
    function formatCreatorForCard(item) {
        const names = parseCreatorNamesFromItem(item);
        if (!names.length) return "—";
        return names.slice(0, 2).join(" · ");
    }

    function renderCreatorChips() {
        const wrap = document.getElementById("f-creator-wrap");
        const anchor = document.getElementById("f-creator-search-wrap");
        const input = document.getElementById("f-creator-input");
        if (!wrap || !input) return;
        wrap.querySelectorAll(".content-creator-chip").forEach((c) => c.remove());
        const beforeEl = anchor || input;
        (state.creatorChips || []).forEach((val, idx) => {
            const chip = document.createElement("span");
            chip.className = "content-creator-chip";
            chip.innerHTML = `${esc(val)} <button type="button" aria-label="移除" data-creator-idx="${idx}">×</button>`;
            wrap.insertBefore(chip, beforeEl);
        });
    }

    function hideCreatorDropdown() {
        if (state.creatorSuggestTimer) {
            clearTimeout(state.creatorSuggestTimer);
            state.creatorSuggestTimer = null;
        }
        const dd = document.getElementById("f-creator-dropdown");
        if (dd) {
            dd.innerHTML = "";
            dd.style.display = "none";
        }
    }

    function addCreatorChip(name) {
        const v = String(name || "").trim();
        if (!v) return;
        const next = (state.creatorChips || []).slice();
        if (next.some((x) => String(x).trim().toLowerCase() === v.toLowerCase())) return;
        next.push(v);
        state.creatorChips = next;
        renderCreatorChips();
    }

    function flushCreatorInputToChips() {
        const input = document.getElementById("f-creator-input");
        if (!input) return;
        const raw = String(input.value || "").trim();
        if (!raw) return;
        raw.split(/[,，;；]+/).forEach((seg) => {
            const v = String(seg || "").trim().replace(/[，,]$/, "");
            if (v) addCreatorChip(v);
        });
        input.value = "";
        hideCreatorDropdown();
        renderCreatorChips();
    }

    async function fetchCreatorSuggest() {
        const input = document.getElementById("f-creator-input");
        const dd = document.getElementById("f-creator-dropdown");
        if (!input || !dd) return;
        const q = String(input.value || "").trim();
        const rtEl = document.getElementById("f-record-type");
        const rt = rtEl && rtEl.value === "book" ? "book" : "watch";
        if (!q) {
            hideCreatorDropdown();
            return;
        }
        const params = new URLSearchParams({ q, record_type: rt, limit: "30" });
        (state.creatorChips || []).forEach((n) => {
            const s = String(n || "").trim();
            if (s) params.append("exclude", s);
        });
        const res = await fetch(`/api/content/person-suggest?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success || !Array.isArray(data.items)) {
            dd.innerHTML = "";
            dd.style.display = "none";
            return;
        }
        const rows = data.items.filter((it) => it && String(it.display_name || "").trim());
        if (!rows.length) {
            dd.innerHTML = `<div class="content-related-option content-related-option-empty">无匹配人物，按回车添加「${esc(q)}」</div>`;
            dd.style.display = "block";
            return;
        }
        dd.innerHTML = rows
            .map((it) => {
                const nm = String(it.display_name || "").trim();
                const sub =
                    rt === "book"
                        ? '<span class="content-related-opt-type">读书</span>'
                        : '<span class="content-related-opt-type">追剧</span>';
                return `<button type="button" class="content-related-option content-creator-suggest-option" data-creator-pick-name="${escAttr(nm)}" aria-label="添加 ${escAttr(nm)}">
                    <span class="content-related-opt-title">${esc(nm)}</span>${sub}
                </button>`;
            })
            .join("");
        dd.style.display = "block";
    }

    function scheduleCreatorSuggest() {
        if (state.creatorSuggestTimer) clearTimeout(state.creatorSuggestTimer);
        state.creatorSuggestTimer = setTimeout(() => {
            state.creatorSuggestTimer = null;
            void fetchCreatorSuggest();
        }, 200);
    }

    function buildExtJsonPayload() {
        const base =
            state.extJsonBase && typeof state.extJsonBase === "object" && !Array.isArray(state.extJsonBase)
                ? { ...state.extJsonBase }
                : {};
        const names = (state.creatorChips || []).slice();
        if (names.length) base.creator_names = names;
        else delete base.creator_names;
        const refs = (state.relatedRecordRefs || [])
            .map((r) => ({
                id: r && r.id != null ? normalizeContentRecordPublicId(r.id) || null : null,
                title: String(r && r.title != null ? r.title : "").trim(),
                record_type: String(r && r.record_type != null ? r.record_type : "").trim(),
            }))
            .filter((r) => r.title);
        if (refs.length) base.related_record_refs = refs;
        else delete base.related_record_refs;
        try {
            return JSON.stringify(base);
        } catch {
            return "{}";
        }
    }

    function bindCreatorChips() {
        const input = document.getElementById("f-creator-input");
        const wrap = document.getElementById("f-creator-wrap");
        const dd = document.getElementById("f-creator-dropdown");
        const field = document.getElementById("f-creator-field");
        if (!input || !wrap) return;
        if (wrap.dataset.boundCreators === "1") return;
        wrap.dataset.boundCreators = "1";
        input.addEventListener("input", () => {
            scheduleCreatorSuggest();
        });
        input.addEventListener("focus", () => {
            if (String(input.value || "").trim()) scheduleCreatorSuggest();
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                const hasBtn = dd && dd.style.display !== "none" && dd.querySelector("button.content-creator-suggest-option");
                if (hasBtn) return;
                const raw = String(input.value || "").trim();
                if (raw) addCreatorChip(raw);
                input.value = "";
                hideCreatorDropdown();
                renderCreatorChips();
                return;
            }
            if (e.key === "," || e.key === "，") {
                e.preventDefault();
                flushCreatorInputToChips();
            } else if (e.key === "Escape") {
                hideCreatorDropdown();
            }
        });
        input.addEventListener("blur", () => {
            setTimeout(() => hideCreatorDropdown(), 180);
            setTimeout(() => {
                const ain = document.getElementById("f-creator-input");
                if (!ain) return;
                const raw = String(ain.value || "").trim();
                if (!raw) return;
                flushCreatorInputToChips();
            }, 220);
        });
        dd?.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const btn = e.target.closest("button.content-creator-suggest-option[data-creator-pick-name]");
            if (!btn) return;
            const name = String(btn.getAttribute("data-creator-pick-name") || "").trim();
            if (!name) return;
            addCreatorChip(name);
            input.value = "";
            hideCreatorDropdown();
            renderCreatorChips();
        });
        wrap.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-creator-idx]");
            if (!btn) return;
            const idx = Number(btn.getAttribute("data-creator-idx"));
            if (!Number.isFinite(idx)) return;
            state.creatorChips.splice(idx, 1);
            renderCreatorChips();
        });
        document.addEventListener("click", (e) => {
            if (!field || !dd) return;
            if (!field.contains(e.target)) hideCreatorDropdown();
        });
    }

    function getCategoriesByType(recordType) {
        return recordType === "watch" ? WATCH_CATEGORIES : BOOK_CATEGORIES;
    }

    function fillCategoryOptions(recordType, value) {
        const sel = document.getElementById("f-category");
        if (!sel) return;
        const list = getCategoriesByType(recordType);
        sel.innerHTML = list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
        if (value && list.includes(value)) sel.value = value;
        else sel.selectedIndex = 0;
    }

    function fillFilterCategoryOptions(recordType) {
        const sel = document.getElementById("flt-category");
        if (!sel) return;
        const old = sel.value;
        const list = recordType ? getCategoriesByType(recordType) : [];
        sel.innerHTML = `<option value="">全部类型</option>` + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
        if (old && list.includes(old)) sel.value = old;
        else sel.value = "";
    }

    async function loadTags() {
        const res = await fetch("/api/content/tags?record_type=all");
        const data = await res.json().catch(() => ({}));
        state.tags = data && data.success && Array.isArray(data.items) ? data.items : [];
    }

    function getVisibleTagsForType(recordType) {
        return state.tags.filter((t) => !recordType || t.record_type === "all" || t.record_type === recordType);
    }

    function fillFilterTagOptions(recordType) {
        const sel = document.getElementById("flt-tag");
        if (!sel) return;
        const old = sel.value;
        const list = getVisibleTagsForType(recordType);
        sel.innerHTML = `<option value="">全部标签</option>` + list.map((t) => `<option value="${esc(t.name || "")}">${esc(t.name || "")}</option>`).join("");
        if (old && list.some((t) => String(t.name || "") === old)) sel.value = old;
        else sel.value = "";
    }

    function renderTagChecks() {
        const mount = document.getElementById("f-tags");
        const rt = document.getElementById("f-record-type").value;
        if (!mount) return;
        const tags = getVisibleTagsForType(rt);
        const selectedSet = new Set((state.selectedTagIds || []).map((x) => Number(x)));
        if (!tags.length) {
            mount.innerHTML = `<div class="content-empty">暂无标签</div>`;
            return;
        }
        mount.innerHTML = tags
            .map((t) => {
                const sel = selectedSet.has(Number(t.id)) ? " content-tag-chip-selected" : "";
                return `<button type="button" class="content-tag-chip${sel}" data-add-tag-id="${t.id}" aria-pressed="${selectedSet.has(Number(t.id)) ? "true" : "false"}">${esc(t.name || "")}</button>`;
            })
            .join("");
    }

    function openTagsDrawer() {
        document.getElementById("content-tags-drawer-overlay")?.classList.add("open");
        document.getElementById("content-tags-drawer")?.classList.add("open");
        state.editingTagId = null;
        const w = document.getElementById("content-tag-apply-watch");
        const b = document.getElementById("content-tag-apply-book");
        if (w) w.checked = true;
        if (b) b.checked = true;
        renderTagsDrawerList();
    }

    function closeTagsDrawer() {
        document.getElementById("content-tags-drawer-overlay")?.classList.remove("open");
        document.getElementById("content-tags-drawer")?.classList.remove("open");
        state.editingTagId = null;
    }

    function renderTagsDrawerList() {
        const mount = document.getElementById("content-tags-list");
        if (!mount) return;
        const list = (state.tags || [])
            .filter((t) => {
                const r = String(t.record_type || "").toLowerCase();
                return r === "watch" || r === "book" || r === "all";
            })
            .slice()
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"));
        if (!list.length) {
            mount.innerHTML = `<div class="content-empty">暂无标签</div>`;
            return;
        }
        mount.innerHTML = list
            .map((t) => {
                const editing = Number(state.editingTagId) === Number(t.id);
                const markers = tagTypeMarkersHtml(t.record_type);
                const refCount = Number(t.ref_count || 0);
                const rlow = String(t.record_type || "").toLowerCase();
                const wChecked = rlow !== "book";
                const bChecked = rlow !== "watch";
                return `<div class="notes-cat-card" data-tag-id="${t.id}">
                    ${
                        editing
                            ? `<div class="content-tag-name-row">
                                   <input type="text" class="field-control content-tag-edit-input" value="${esc(t.name || "")}" />
                                   <div class="content-tag-edit-types">
                                       <label><input type="checkbox" class="content-tag-edit-cb-watch" ${wChecked ? "checked" : ""} /> 追剧</label>
                                       <label><input type="checkbox" class="content-tag-edit-cb-book" ${bChecked ? "checked" : ""} /> 读书</label>
                                   </div>
                               </div>`
                            : `<div class="content-tag-name-row">
                                   <div class="notes-cat-name">${esc(t.name || "")}</div>
                                   <div class="content-tag-name-markers">${markers}</div>
                               </div>`
                    }
                    <div class="notes-cat-actions">
                        <span class="content-tag-count">关联数量：<span class="content-tag-count-num">${esc(String(refCount))}</span></span>
                        ${
                            editing
                                ? `<button type="button" class="btn primary content-tag-save">保存</button><button type="button" class="btn content-tag-cancel">取消</button>`
                                : `<button type="button" class="btn content-tag-edit">编辑</button><button type="button" class="btn content-tag-delete">删除</button>`
                        }
                    </div>
                </div>`;
            })
            .join("");
    }

    async function addTagFromDrawer() {
        const w = document.getElementById("content-tag-apply-watch");
        const b = document.getElementById("content-tag-apply-book");
        const rt = recordTypeFromWatchBookChecks(w && w.checked, b && b.checked);
        const input = document.getElementById("content-tag-new-name");
        const name = String(input?.value || "").trim();
        if (!name) return showToast("请输入标签名称", "error");
        if (!rt) return showToast("请至少勾选「追剧」或「读书」之一", "error");
        const res = await fetch("/api/content/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, record_type: rt }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "新增失败", "error");
        input.value = "";
        await loadTags();
        fillFilterTagOptions(document.getElementById("flt-record-type").value);
        renderTagChecks();
        renderTagsDrawerList();
        showToast("已添加");
    }

    async function saveTagApi(tagId, patch) {
        const res = await fetch(`/api/content/tags/${encodeURIComponent(String(tagId))}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "更新失败", "error");
        await loadTags();
        fillFilterTagOptions(document.getElementById("flt-record-type").value);
        renderTagChecks();
        state.editingTagId = null;
        renderTagsDrawerList();
        showToast("已更新");
    }

    async function deleteTag(tagId) {
        const tag = (state.tags || []).find((x) => Number(x.id) === Number(tagId));
        const refCount = Number((tag && tag.ref_count) || 0);
        if (refCount > 0) {
            showToast("该标签已被记录引用，无法删除", "error");
            return;
        }
        if (!window.confirm("确认删除该标签？")) return;
        const res = await fetch(`/api/content/tags/${encodeURIComponent(String(tagId))}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "删除失败", "error");
        await loadTags();
        fillFilterTagOptions(document.getElementById("flt-record-type").value);
        renderTagChecks();
        renderTagsDrawerList();
        showToast("已删除");
    }

    function getFilterParams() {
        const p = new URLSearchParams();
        const rt = document.getElementById("flt-record-type").value;
        const title = document.getElementById("flt-title").value.trim();
        const creator = document.getElementById("flt-creator").value.trim();
        const category = document.getElementById("flt-category").value;
        const rating = document.getElementById("flt-rating").value;
        const tag = document.getElementById("flt-tag").value;
        const start = document.getElementById("flt-start").value;
        const end = document.getElementById("flt-end").value;
        if (rt) p.set("record_type", rt);
        const listStatus = document.getElementById("flt-list-status")?.value || "";
        if (listStatus) p.set("list_status", listStatus);
        if (title) p.set("title", title);
        if (creator) p.set("creator", creator);
        if (category) p.set("category", category);
        if (rating) p.set("rating", rating);
        if (tag) p.set("tag", tag);
        if (start) p.set("submit_start", start);
        if (end) p.set("submit_end", end);
        p.set("page", String(Math.max(1, Number(state.page) || 1)));
        p.set("page_size", String(Math.max(1, Number(state.pageSize) || 20)));
        return p;
    }

    function totalPages() {
        const t = Number(state.total) || 0;
        const ps = Math.max(1, Number(state.pageSize) || 20);
        return Math.max(1, Math.ceil(t / ps));
    }

    async function loadList() {
        const res = await fetch("/api/content/records?" + getFilterParams().toString());
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "加载失败", "error");
        state.items = Array.isArray(data.items) ? data.items : [];
        state.total = typeof data.total === "number" ? data.total : Number(data.total) || 0;
        if (typeof data.page === "number" && data.page > 0) state.page = data.page;
        if (typeof data.page_size === "number" && data.page_size > 0) state.pageSize = data.page_size;
        const tp = totalPages();
        if (state.page > tp) {
            state.page = Math.max(1, tp);
            return loadList();
        }
        if (!state.items.length && state.total > 0 && state.page > 1) {
            state.page -= 1;
            return loadList();
        }
        renderCardGrid();
        renderPagination();
    }

    function renderPagination() {
        const totalEl = document.getElementById("content-total-num");
        const statusEl = document.getElementById("content-page-status");
        const prev = document.getElementById("content-prev-page");
        const next = document.getElementById("content-next-page");
        const t = Number(state.total) || 0;
        const tp = totalPages();
        const pg = Math.min(Math.max(1, Number(state.page) || 1), tp);
        state.page = pg;
        if (totalEl) totalEl.textContent = String(t);
        if (statusEl) statusEl.textContent = `第 ${pg} / ${tp} 页`;
        if (prev) prev.disabled = pg <= 1;
        if (next) next.disabled = pg >= tp;
    }

    function renderCardGrid() {
        const mount = document.getElementById("content-cards-grid");
        if (!mount) return;
        if (!state.items.length) {
            mount.innerHTML = `<div class="content-empty" style="grid-column: 1 / -1;">暂无记录</div>`;
            return;
        }
        mount.innerHTML = state.items
            .map((it) => {
                const idStr = String(it.id != null ? it.id : "");
                const active = idStr && idStr === String(state.selectedId != null ? state.selectedId : "") ? " active" : "";
                const typeBadge =
                    it.record_type === "book"
                        ? `<span class="content-card-badge content-card-badge--book">读书</span>`
                        : `<span class="content-card-badge content-card-badge--watch">追剧</span>`;
                const listBadge =
                    it.list_status === "wishlist"
                        ? `<span class="content-card-badge content-card-badge--wish">心愿</span>`
                        : `<span class="content-card-badge content-card-badge--done">已看完</span>`;
                const cover = String(it.cover_url || "").trim();
                const imgHtml = cover
                    ? `<img src="${escAttr(cover)}" alt="" loading="lazy" />`
                    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:12px;color:#9ca3af;">无封面</div>`;
                const ratingTxt = !Number(it.rating) ? "未评分" : `${Number(it.rating)}星`;
                const creator = formatCreatorForCard(it);
                const cat = String(it.category || "").trim() || "—";
                const midLine = esc(it.submit_date || "—");
                return `<div class="content-card${active}" data-id="${escAttr(idStr)}" role="button" tabindex="0">
                    <div class="content-card-thumb">
                        <div class="content-card-thumb-badges">${typeBadge}${listBadge}</div>
                        ${imgHtml}
                    </div>
                    <div class="content-card-main">
                        <div>
                            <div class="content-card-title">${esc(it.title || "")}</div>
                            <div class="content-card-mid">${midLine}</div>
                        </div>
                        <div class="content-card-foot">
                            <div>${esc(creator)}</div>
                            <div class="content-card-foot-row2">${esc(ratingTxt)}　·　${esc(cat)}</div>
                        </div>
                    </div>
                </div>`;
            })
            .join("");
    }

    function clearForm(options) {
        const closeDrawer = !options || options.closeDrawer !== false;
        state.selectedId = null;
        state.selectedTagIds = [];
        const titleEl = document.getElementById("content-drawer-title");
        if (titleEl) titleEl.textContent = "新增记录";
        const ridEl = document.getElementById("content-drawer-record-id");
        if (ridEl) {
            ridEl.textContent = "";
            ridEl.hidden = true;
        }
        document.getElementById("f-record-type").value = "watch";
        document.getElementById("f-submit-date").value = today();
        document.getElementById("f-title").value = "";
        const epEl = document.getElementById("f-episode-count");
        if (epEl) epEl.value = "";
        state.creatorChips = [];
        state.relatedRecordRefs = [];
        state.extJsonBase = {};
        state.lastAutoOriginalWork = "";
        renderCreatorChips();
        renderRelatedChips();
        const creatorIn = document.getElementById("f-creator-input");
        if (creatorIn) creatorIn.value = "";
        const relIn = document.getElementById("f-related-input");
        if (relIn) relIn.value = "";
        hideRelatedDropdown();
        hideCreatorDropdown();
        fillCategoryOptions("watch");
        document.getElementById("f-rating").value = "0";
        const ls = document.getElementById("f-list-status");
        if (ls) ls.value = "done";
        const relEl = document.getElementById("f-release-date");
        if (relEl) relEl.value = "";
        const owEl = document.getElementById("f-original-work");
        if (owEl) owEl.value = "";
        document.getElementById("f-summary").value = "";
        document.getElementById("f-review").value = "";
        resetCoverPreview();
        renderTagChecks();
        setFormRecordMeta(null);
        if (closeDrawer) closeRecordDrawer();
        renderCardGrid();
        updateFormActionBar();
    }

    function openAddDrawer() {
        clearForm({ closeDrawer: false });
        const titleEl = document.getElementById("content-drawer-title");
        if (titleEl) titleEl.textContent = "新增记录";
        openRecordDrawer();
        updateFormActionBar();
    }

    function openEditDrawer(item) {
        if (!item) return;
        fillForm(item);
        openRecordDrawer();
    }

    function fillForm(item) {
        if (!item) return clearForm();
        state.selectedId = normalizeContentRecordPublicId(item.id) || String(item.id != null ? item.id : "");
        const titleEl = document.getElementById("content-drawer-title");
        if (titleEl) titleEl.textContent = "编辑记录";
        const ridEl = document.getElementById("content-drawer-record-id");
        if (ridEl) {
            const rid = state.selectedId || String(item.id != null ? item.id : "").trim();
            ridEl.textContent = rid;
            ridEl.hidden = !rid;
        }
        document.getElementById("f-record-type").value = item.record_type || "watch";
        document.getElementById("f-submit-date").value = item.submit_date || today();
        document.getElementById("f-title").value = item.title || "";
        const owFill = document.getElementById("f-original-work");
        if (owFill) owFill.value = String(item.original_work || "").trim();
        state.lastAutoOriginalWork = "";
        const epFill = document.getElementById("f-episode-count");
        if (epFill) epFill.value = String(item.episode_count || "").trim();
        try {
            state.extJsonBase = JSON.parse(item.ext_json || "{}");
            if (!state.extJsonBase || typeof state.extJsonBase !== "object" || Array.isArray(state.extJsonBase)) {
                state.extJsonBase = {};
            }
        } catch {
            state.extJsonBase = {};
        }
        state.creatorChips = parseCreatorNamesFromItem(item);
        renderCreatorChips();
        const creatorInEd = document.getElementById("f-creator-input");
        if (creatorInEd) creatorInEd.value = "";
        fillCategoryOptions(item.record_type || "watch", item.category || "");
        document.getElementById("f-rating").value = String(item.rating || 0);
        const lsEl = document.getElementById("f-list-status");
        if (lsEl) lsEl.value = item.list_status === "wishlist" ? "wishlist" : "done";
        const relIn = document.getElementById("f-release-date");
        if (relIn) relIn.value = String(item.release_date || "").trim();
        state.relatedRecordRefs = parseRelatedRecordRefsFromItem(item);
        renderRelatedChips();
        const relPickIn = document.getElementById("f-related-input");
        if (relPickIn) relPickIn.value = "";
        hideRelatedDropdown();
        document.getElementById("f-summary").value = item.summary || "";
        document.getElementById("f-review").value = item.review || "";
        state.selectedTagIds = (item.tags || []).map((t) => Number(t.id)).filter((x) => Number.isFinite(x));
        renderTagChecks();
        setFormRecordMeta(item);
        applyCoverUrlToPreview(String(item.cover_url || "").trim());
        renderCardGrid();
        updateFormActionBar();
    }

    function collectPayload() {
        const ids = (state.selectedTagIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
        return {
            record_type: document.getElementById("f-record-type").value,
            submit_date: document.getElementById("f-submit-date").value,
            title: document.getElementById("f-title").value.trim(),
            creator: (state.creatorChips || []).length ? (state.creatorChips || []).join(" · ") : "",
            category: document.getElementById("f-category").value,
            rating: Number(document.getElementById("f-rating").value || 0),
            episode_count: String(document.getElementById("f-episode-count")?.value || "").trim(),
            summary: document.getElementById("f-summary").value.trim(),
            review: document.getElementById("f-review").value.trim(),
            original_work: String(document.getElementById("f-original-work")?.value || "").trim(),
            related_series: "",
            release_date: String(document.getElementById("f-release-date")?.value || "").trim(),
            cover_url: String(document.getElementById("f-cover-url")?.value || "").trim(),
            ext_json: buildExtJsonPayload(),
            list_status: (document.getElementById("f-list-status") && document.getElementById("f-list-status").value) || "done",
            tag_ids: ids,
        };
    }

    async function saveForm() {
        const payload = collectPayload();
        if (!payload.submit_date || !payload.title) return showToast("请填写标记日期和标题", "error");
        const isEdit = !!state.selectedId;
        const url = isEdit ? `/api/content/records/${encodeURIComponent(String(state.selectedId))}` : "/api/content/records";
        const res = await fetch(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "保存失败", "error");
        showToast("已保存");
        closeRecordDrawer();
        if (!isEdit) state.page = 1;
        await loadList();
    }

    async function deleteCurrentExecute() {
        if (!state.selectedId) return;
        const res = await fetch(`/api/content/records/${encodeURIComponent(String(state.selectedId))}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "删除失败", "error");
        showToast("已删除");
        clearForm();
        await loadList();
    }

    function deleteCurrent() {
        if (!state.selectedId) return showToast("请先选择记录", "error");
        openContentConfirm("确认删除该记录？", deleteCurrentExecute);
    }

    function bindEvents() {
        document.getElementById("btn-go-home").addEventListener("click", () => (window.location.href = "/home"));
        document.getElementById("btn-content-search").addEventListener("click", () => {
            state.page = 1;
            void loadList();
        });
        document.getElementById("flt-title").addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                state.page = 1;
                void loadList();
            }
        });
        document.getElementById("flt-creator").addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                state.page = 1;
                void loadList();
            }
        });
        document.getElementById("flt-record-type").addEventListener("change", (e) => {
            fillFilterCategoryOptions(e.target.value);
            fillFilterTagOptions(e.target.value);
        });
        document.getElementById("btn-content-reset").addEventListener("click", () => {
            document.getElementById("flt-record-type").value = "";
            const fls = document.getElementById("flt-list-status");
            if (fls) fls.value = "";
            document.getElementById("flt-title").value = "";
            document.getElementById("flt-creator").value = "";
            document.getElementById("flt-category").value = "";
            document.getElementById("flt-rating").value = "";
            document.getElementById("flt-tag").value = "";
            document.getElementById("flt-start").value = "";
            document.getElementById("flt-end").value = "";
            fillFilterCategoryOptions("");
            fillFilterTagOptions("");
            state.page = 1;
            void loadList();
        });
        document.getElementById("btn-content-add").addEventListener("click", () => openAddDrawer());
        document.getElementById("btn-content-tags").addEventListener("click", openTagsDrawer);
        document.getElementById("btn-content-save").addEventListener("click", saveForm);
        document.getElementById("btn-content-delete").addEventListener("click", deleteCurrent);
        document.getElementById("btn-content-form-reset").addEventListener("click", () => clearForm({ closeDrawer: false }));
        bindContentConfirmModal();
        bindCreatorChips();
        bindRelatedWorkPicker();
        document.getElementById("f-original-work")?.addEventListener("input", () => {
            state.lastAutoOriginalWork = "";
        });
        document.getElementById("f-record-type").addEventListener("change", (e) => {
            fillCategoryOptions(e.target.value);
            renderTagChecks();
            hideCreatorDropdown();
            const ci = document.getElementById("f-creator-input");
            if (ci && String(ci.value || "").trim()) scheduleCreatorSuggest();
        });
        document.getElementById("f-tags")?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-add-tag-id]");
            if (!btn) return;
            const id = Number(btn.getAttribute("data-add-tag-id"));
            if (!Number.isFinite(id)) return;
            const set = new Set((state.selectedTagIds || []).map((x) => Number(x)));
            if (set.has(id)) set.delete(id);
            else set.add(id);
            state.selectedTagIds = Array.from(set);
            renderTagChecks();
        });
        document.getElementById("content-cards-grid").addEventListener("click", (e) => {
            const card = e.target.closest(".content-card");
            if (!card) return;
            const rawId = card.getAttribute("data-id");
            const idKey = String(rawId || "");
            const found = state.items.find((x) => String(x.id) === idKey);
            if (found) openEditDrawer(found);
        });
        document.getElementById("content-prev-page")?.addEventListener("click", () => {
            if (state.page <= 1) return;
            state.page -= 1;
            void loadList();
        });
        document.getElementById("content-next-page")?.addEventListener("click", () => {
            if (state.page >= totalPages()) return;
            state.page += 1;
            void loadList();
        });
        document.getElementById("content-record-drawer-close")?.addEventListener("click", () => closeRecordDrawer());
        document.getElementById("content-record-drawer-overlay")?.addEventListener("click", () => closeRecordDrawer());
        document.getElementById("content-tags-drawer-close")?.addEventListener("click", closeTagsDrawer);
        document.getElementById("content-tags-drawer-overlay")?.addEventListener("click", closeTagsDrawer);
        document.getElementById("content-tags-drawer-ok")?.addEventListener("click", closeTagsDrawer);
        document.getElementById("content-tag-add-btn")?.addEventListener("click", addTagFromDrawer);
        document.getElementById("content-tag-new-name")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") addTagFromDrawer();
        });
        document.getElementById("content-tags-list")?.addEventListener("click", async (e) => {
            const card = e.target.closest(".notes-cat-card");
            if (!card) return;
            const tagId = Number(card.getAttribute("data-tag-id"));
            if (!Number.isFinite(tagId)) return;
            if (e.target.closest(".content-tag-edit")) {
                state.editingTagId = tagId;
                renderTagsDrawerList();
                return;
            }
            if (e.target.closest(".content-tag-cancel")) {
                state.editingTagId = null;
                renderTagsDrawerList();
                return;
            }
            if (e.target.closest(".content-tag-save")) {
                const input = card.querySelector(".content-tag-edit-input");
                const name = String((input && input.value) || "").trim();
                if (!name) return showToast("请输入标签名称", "error");
                const wCb = card.querySelector(".content-tag-edit-cb-watch");
                const bCb = card.querySelector(".content-tag-edit-cb-book");
                const rt = recordTypeFromWatchBookChecks(wCb && wCb.checked, bCb && bCb.checked);
                if (!rt) return showToast("请至少勾选「追剧」或「读书」之一", "error");
                await saveTagApi(tagId, { name, record_type: rt });
                return;
            }
            if (e.target.closest(".content-tag-delete")) await deleteTag(tagId);
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        bindEvents();
        bindCoverPaste();
        updateFormActionBar();
        await loadTags();
        fillFilterCategoryOptions("");
        fillFilterTagOptions("");
        const params = new URLSearchParams(window.location.search);
        const sd = String(params.get("submit_date") || "").trim();
        const fromCalendar = params.get("add") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(sd);
        if (fromCalendar) {
            clearForm({ closeDrawer: false });
            const dateEl = document.getElementById("f-submit-date");
            if (dateEl) dateEl.value = sd;
            openRecordDrawer();
            updateFormActionBar();
            history.replaceState({}, "", window.location.pathname);
        } else {
            clearForm();
        }
        await loadList();
    });
})();

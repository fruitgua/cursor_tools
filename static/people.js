(() => {
    const PAGE_SIZE = 80;
    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    const state = {
        items: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        letter: "",
        selectedId: null,
        drawerPerson: null,
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

    function professionLabels(jsonStr) {
        let arr = [];
        try {
            const v = JSON.parse(jsonStr || "[]");
            if (Array.isArray(v)) arr = v.map((x) => String(x || "").trim()).filter(Boolean);
        } catch {
            arr = [];
        }
        const map = { actor: "演员", author: "作者", director: "导演", writer: "脚本", musician: "音乐人", voice_actor: "声优" };
        return arr.map((k) => map[k] || k).join("、") || "—";
    }

    function totalPages() {
        const t = Number(state.total) || 0;
        const ps = Math.max(1, Number(state.pageSize) || PAGE_SIZE);
        return Math.max(1, Math.ceil(t / ps));
    }

    function renderLetterTabs() {
        const mount = document.getElementById("people-letter-tabs");
        if (!mount) return;
        const tabs = [{ key: "", label: "全部" }].concat(LETTERS.map((L) => ({ key: L, label: L })));
        mount.innerHTML = tabs
            .map((t) => {
                const active = (state.letter || "") === t.key ? " people-letter-tab-active" : "";
                return `<button type="button" role="tab" class="people-letter-tab${active}" data-letter="${esc(t.key)}" aria-selected="${(state.letter || "") === t.key ? "true" : "false"}">${esc(t.label)}</button>`;
            })
            .join("");
    }

    function renderPagination() {
        const totalEl = document.getElementById("people-total-num");
        const statusEl = document.getElementById("people-page-status");
        const prev = document.getElementById("people-prev-page");
        const next = document.getElementById("people-next-page");
        const t = Number(state.total) || 0;
        const tp = totalPages();
        const pg = Math.min(Math.max(1, Number(state.page) || 1), tp);
        state.page = pg;
        if (totalEl) totalEl.textContent = String(t);
        if (statusEl) statusEl.textContent = `第 ${pg} / ${tp} 页`;
        if (prev) prev.disabled = pg <= 1;
        if (next) next.disabled = pg >= tp;
    }

    function renderGrid() {
        const mount = document.getElementById("people-grid");
        const empty = document.getElementById("people-empty");
        if (!mount || !empty) return;
        if (!state.items.length) {
            mount.innerHTML = "";
            empty.hidden = false;
            return;
        }
        empty.hidden = true;
        mount.innerHTML = state.items
            .map((it) => {
                const n = Number(it.work_count) || 0;
                const line2 = `${professionLabels(it.professions_json)} · ${n}部作品`;
                const liked = Number(it.liked) === 1;
                const heart = liked ? `<span class="people-card-like" aria-hidden="true">♥</span>` : "";
                return `<button type="button" class="people-card" data-person-id="${esc(it.id)}" aria-label="查看 ${esc(it.display_name || "")}">
                    ${heart}
                    <div class="people-card-name">${esc(it.display_name || "")}</div>
                    <div class="people-card-meta">${esc(line2)}</div>
                </button>`;
            })
            .join("");
    }

    function buildListQuery() {
        const p = new URLSearchParams();
        const scope = document.getElementById("flt-people-scope")?.value || "";
        const name = String(document.getElementById("flt-people-name")?.value || "").trim();
        if (scope) p.set("scope", scope);
        if (name) p.set("name", name);
        if (state.letter) p.set("letter", state.letter);
        p.set("page", String(Math.max(1, Number(state.page) || 1)));
        p.set("page_size", String(Math.max(1, Number(state.pageSize) || PAGE_SIZE)));
        return p.toString();
    }

    async function loadList() {
        const res = await fetch("/api/content/persons?" + buildListQuery());
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
        renderGrid();
        renderPagination();
    }

    function closePeopleDeleteConfirm() {
        const m = document.getElementById("people-delete-confirm-modal");
        if (m) m.classList.add("hidden");
    }

    function updateDeletePersonButton() {
        const btn = document.getElementById("btn-people-delete-person");
        const p = state.drawerPerson;
        if (!btn) return;
        if (!p || !state.selectedId) {
            btn.disabled = true;
            btn.removeAttribute("title");
            return;
        }
        const wc = Number(p.work_count) || 0;
        if (wc > 0) {
            btn.disabled = true;
            btn.title = `该人物仍关联 ${wc} 部作品，无法删除`;
            return;
        }
        btn.disabled = false;
        btn.removeAttribute("title");
    }

    function closeDrawer() {
        closePeopleDeleteConfirm();
        const ov = document.getElementById("people-drawer-overlay");
        const dr = document.getElementById("people-drawer");
        if (ov) {
            ov.classList.remove("open");
            ov.setAttribute("aria-hidden", "true");
        }
        if (dr) dr.classList.remove("open");
        state.selectedId = null;
        state.drawerPerson = null;
        updateDeletePersonButton();
    }

    function openDrawer() {
        const ov = document.getElementById("people-drawer-overlay");
        const dr = document.getElementById("people-drawer");
        if (ov) {
            ov.classList.add("open");
            ov.setAttribute("aria-hidden", "false");
        }
        if (dr) dr.classList.add("open");
    }

    function syncLikeButton() {
        const btn = document.getElementById("people-profile-like");
        const p = state.drawerPerson;
        if (!btn || !p) return;
        const on = Number(p.liked) === 1;
        btn.textContent = on ? "♥" : "♡";
        btn.classList.toggle("people-like-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.setAttribute("aria-label", on ? "取消喜欢" : "喜欢");
        btn.title = on ? "取消喜欢" : "喜欢";
    }

    function fillProfileForm(p) {
        document.getElementById("pf-gender").value = String(p.gender || "");
        document.getElementById("pf-education").value = String(p.education || "");
        document.getElementById("pf-birthday").value = String(p.birthday || "");
        document.getElementById("pf-real-name").value = String(p.real_name || "");
        document.getElementById("pf-bio").value = String(p.bio_note || "");
    }

    function ratingLabel(r) {
        const n = Number(r) || 0;
        if (!n) return "未评分";
        return `${n}星`;
    }

    function setWorksTotalCount(n) {
        const el = document.getElementById("people-works-total");
        if (!el) return;
        if (n === null) {
            el.textContent = "共 — 条";
            return;
        }
        const x = Math.max(0, Number(n) || 0);
        el.textContent = `共 ${x} 条`;
    }

    function renderWorksList(rows) {
        const mount = document.getElementById("people-works-list");
        if (!mount) return;
        const list = Array.isArray(rows) ? rows : [];
        setWorksTotalCount(list.length);
        if (!list.length) {
            mount.innerHTML = `<div class="people-empty" style="padding:20px;">暂无关联作品</div>`;
            return;
        }
        mount.innerHTML = list
            .map((w) => {
                const title = esc(String(w.title || "").trim());
                const date = esc(String(w.submit_date || "").trim() || "—");
                const rt = esc(ratingLabel(w.rating));
                const typeBadge =
                    w.record_type === "book"
                        ? `<span class="content-card-badge content-card-badge--book">读书</span>`
                        : `<span class="content-card-badge content-card-badge--watch">追剧</span>`;
                const listBadge =
                    w.list_status === "wishlist"
                        ? `<span class="content-card-badge content-card-badge--wish">心愿</span>`
                        : `<span class="content-card-badge content-card-badge--done">已看完</span>`;
                const metaLine = `${rt}　·　${date}`;
                const rid = String(w.id != null ? w.id : "").trim();
                const ridAttr = rid ? ` data-record-id="${esc(rid)}"` : "";
                return `<div class="people-work-card"${ridAttr}>
                    <div class="people-work-title-row">
                        <span class="people-work-badges">${typeBadge}${listBadge}</span>
                        <span class="people-work-title">${title}</span>
                    </div>
                    <div class="people-work-meta-line">${metaLine}</div>
                </div>`;
            })
            .join("");
    }

    function patchListItemLiked(personId, liked) {
        const it = state.items.find((x) => String(x.id) === String(personId));
        if (it) it.liked = liked ? 1 : 0;
        renderGrid();
    }

    function setDrawerTitleLine(displayName, personId, roleLabel) {
        const nameEl = document.getElementById("people-drawer-name");
        const idEl = document.getElementById("people-drawer-id");
        const typeEl = document.getElementById("people-drawer-type");
        const sepAfterName = document.getElementById("people-drawer-sep-name");
        const sepAfterId = document.getElementById("people-drawer-sep-id");
        if (!nameEl || !idEl || !typeEl || !sepAfterName || !sepAfterId) return;
        const nm = String(displayName || "").trim() || "—";
        const idStr = personId != null && String(personId).trim() !== "" ? String(personId).trim() : "";
        const typ = String(roleLabel || "").trim();
        nameEl.textContent = nm;
        idEl.textContent = idStr;
        typeEl.textContent = typ;
        const hasId = Boolean(idStr);
        const hasType = Boolean(typ);
        idEl.hidden = !hasId;
        idEl.setAttribute("aria-hidden", hasId ? "false" : "true");
        typeEl.hidden = !hasType;
        typeEl.setAttribute("aria-hidden", hasType ? "false" : "true");
        sepAfterName.hidden = !hasId && !hasType;
        sepAfterId.hidden = !(hasId && hasType);
    }

    async function openPersonDrawer(person) {
        if (!person || !person.id) return;
        state.selectedId = person.id;
        state.drawerPerson = null;
        updateDeletePersonButton();
        openDrawer();
        setDrawerTitleLine(person.display_name, "", "");
        setWorksTotalCount(null);
        document.getElementById("people-works-list").innerHTML = `<div class="people-empty" style="padding:16px;">加载中…</div>`;

        const [resP, resW] = await Promise.all([
            fetch(`/api/content/persons/${encodeURIComponent(String(person.id))}`),
            fetch(`/api/content/persons/${encodeURIComponent(String(person.id))}/works`),
        ]);
        const dataP = await resP.json().catch(() => ({}));
        const dataW = await resW.json().catch(() => ({}));
        if (!dataP || !dataP.success || !dataP.item) {
            showToast((dataP && dataP.message) || "加载人物失败", "error");
            closeDrawer();
            return;
        }
        const p = dataP.item;
        state.drawerPerson = p;
        setDrawerTitleLine(p.display_name, p.id, p.primary_role_label);
        fillProfileForm(p);
        syncLikeButton();
        updateDeletePersonButton();

        if (!dataW || !dataW.success || !Array.isArray(dataW.items)) {
            setWorksTotalCount(0);
            document.getElementById("people-works-list").innerHTML = `<div class="people-empty">作品加载失败</div>`;
            return;
        }
        renderWorksList(dataW.items);
    }

    async function saveProfile() {
        const id = state.selectedId;
        if (!id) return;
        const body = {
            gender: String(document.getElementById("pf-gender")?.value || "").trim(),
            education: String(document.getElementById("pf-education")?.value || "").trim(),
            birthday: String(document.getElementById("pf-birthday")?.value || "").trim(),
            real_name: String(document.getElementById("pf-real-name")?.value || "").trim(),
            bio_note: String(document.getElementById("pf-bio")?.value || "").trim(),
        };
        const res = await fetch(`/api/content/persons/${encodeURIComponent(String(id))}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "保存失败", "error");
        state.drawerPerson = data.item;
        updateDeletePersonButton();
        showToast("已保存");
    }

    function openPeopleDeleteConfirm() {
        const p = state.drawerPerson;
        const id = state.selectedId;
        if (!p || !id) return;
        const wc = Number(p.work_count) || 0;
        if (wc > 0) return showToast("该人物仍有关联作品，无法删除", "error");
        const textEl = document.getElementById("people-delete-confirm-text");
        if (textEl) {
            const name = String(p.display_name || "").trim() || "—";
            textEl.textContent = `确定删除人物「${name}」（${id}）吗？此操作不可恢复；编号不会留给后续新建人物复用。`;
        }
        const m = document.getElementById("people-delete-confirm-modal");
        if (m) m.classList.remove("hidden");
    }

    async function executePeopleDelete() {
        const id = state.selectedId;
        if (!id) return;
        const res = await fetch(`/api/content/persons/${encodeURIComponent(String(id))}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        closePeopleDeleteConfirm();
        if (!data || !data.success) {
            showToast((data && data.message) || "删除失败", "error");
            return;
        }
        showToast("已删除");
        if (window.ContentRecordViewDrawer && typeof window.ContentRecordViewDrawer.close === "function") {
            window.ContentRecordViewDrawer.close();
        }
        closeDrawer();
        void loadList();
    }

    async function toggleDrawerLike() {
        const id = state.selectedId;
        if (!id) return;
        const res = await fetch(`/api/content/persons/${encodeURIComponent(String(id))}/like`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!data || !data.success) return showToast((data && data.message) || "操作失败", "error");
        const liked = Number(data.liked) === 1 ? 1 : 0;
        if (state.drawerPerson) state.drawerPerson.liked = liked;
        syncLikeButton();
        patchListItemLiked(id, liked);
    }

    function bindEvents() {
        document.getElementById("btn-go-home")?.addEventListener("click", () => {
            window.location.href = "/home";
        });
        document.getElementById("btn-go-content")?.addEventListener("click", () => {
            window.location.href = "/content";
        });
        document.getElementById("btn-people-query")?.addEventListener("click", () => {
            state.page = 1;
            void loadList();
        });
        document.getElementById("flt-people-scope")?.addEventListener("change", () => {
            state.page = 1;
            void loadList();
        });
        document.getElementById("flt-people-name")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                state.page = 1;
                void loadList();
            }
        });

        document.getElementById("people-letter-tabs")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".people-letter-tab[data-letter]");
            if (!btn) return;
            state.letter = String(btn.getAttribute("data-letter") || "");
            state.page = 1;
            renderLetterTabs();
            void loadList();
        });

        document.getElementById("people-prev-page")?.addEventListener("click", () => {
            if (state.page <= 1) return;
            state.page -= 1;
            void loadList();
        });
        document.getElementById("people-next-page")?.addEventListener("click", () => {
            if (state.page >= totalPages()) return;
            state.page += 1;
            void loadList();
        });

        document.getElementById("people-grid")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".people-card[data-person-id]");
            if (!btn) return;
            const id = btn.getAttribute("data-person-id");
            const found = state.items.find((x) => String(x.id) === String(id));
            if (found) void openPersonDrawer(found);
        });

        document.getElementById("people-drawer-close")?.addEventListener("click", closeDrawer);
        document.getElementById("people-drawer-overlay")?.addEventListener("click", closeDrawer);
        document.getElementById("people-profile-like")?.addEventListener("click", (e) => {
            e.stopPropagation();
            void toggleDrawerLike();
        });
        document.getElementById("btn-people-profile-save")?.addEventListener("click", () => void saveProfile());
        document.getElementById("btn-people-delete-person")?.addEventListener("click", () => openPeopleDeleteConfirm());
        document.getElementById("people-delete-confirm-cancel")?.addEventListener("click", closePeopleDeleteConfirm);
        document.getElementById("people-delete-confirm-ok")?.addEventListener("click", () => void executePeopleDelete());
        document.getElementById("people-delete-confirm-modal")?.addEventListener("click", (e) => {
            if (e.target && e.target.id === "people-delete-confirm-modal") closePeopleDeleteConfirm();
        });

        document.getElementById("people-works-list")?.addEventListener("click", (e) => {
            const card = e.target.closest(".people-work-card[data-record-id]");
            if (!card) return;
            const rid = String(card.getAttribute("data-record-id") || "").trim();
            if (!rid || !window.ContentRecordViewDrawer) return;
            void window.ContentRecordViewDrawer.open(rid);
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (window.ContentRecordViewDrawer) window.ContentRecordViewDrawer.init({ notify: showToast });
        renderLetterTabs();
        bindEvents();
        void loadList();
    });
})();

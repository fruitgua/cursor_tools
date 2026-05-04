/**
 * 只读：光影文卷单条记录右侧抽屉。日历页独立打开；人物库页叠在人物抽屉之上。
 */
(function () {
    let bound = false;
    let fetchSeq = 0;
    let notify = function (msg, type) {
        if (typeof window.showToast === "function") window.showToast(msg, type);
    };

    function esc(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function escAttr(s) {
        return esc(s).replace(/'/g, "&#39;");
    }

    function toast(msg, type) {
        notify(msg, type);
    }

    function ratingLabel(n) {
        const x = Number(n) || 0;
        if (!x) return "未评分";
        return `${x}星`;
    }

    function listLabel(ls) {
        return String(ls || "").trim() === "wishlist" ? "心愿" : "已看完";
    }

    function renderBody(it) {
        const typeBadge =
            it.record_type === "book"
                ? `<span class="content-card-badge content-card-badge--book">读书</span>`
                : `<span class="content-card-badge content-card-badge--watch">追剧</span>`;
        const listBadge =
            it.list_status === "wishlist"
                ? `<span class="content-card-badge content-card-badge--wish">心愿</span>`
                : `<span class="content-card-badge content-card-badge--done">已看完</span>`;
        const cover = String(it.cover_url || "").trim();
        const posterInner = cover
            ? `<div class="crv-poster-slot"><img src="${escAttr(cover)}" alt="" loading="lazy" /></div>`
            : `<div class="crv-poster-slot crv-poster-slot--empty">无封面</div>`;
        const tags = Array.isArray(it.tags) ? it.tags : [];
        const tagHtml = tags.length
            ? `<div class="crv-section"><div class="crv-label">标签</div><div class="crv-tags">${tags
                  .map((t) => `<span class="crv-tag-chip">${esc(String(t.name || "").trim())}</span>`)
                  .join("")}</div></div>`
            : "";

        function block(label, val) {
            const v = String(val || "").trim();
            if (!v) return "";
            return `<div class="crv-row"><span class="crv-k">${esc(label)}</span><span class="crv-v">${esc(v)}</span></div>`;
        }

        function prose(label, val) {
            const v = String(val || "").trim();
            if (!v) return "";
            return `<div class="crv-section"><div class="crv-label">${esc(label)}</div><div class="crv-prose">${esc(v)}</div></div>`;
        }

        return `
            <div class="crv-main-row">
                <div class="crv-meta-col">
                    <div class="crv-badges">${typeBadge}${listBadge}</div>
                    <div class="crv-meta">
                        ${block("记录编号", it.id)}
                        ${block("标记日期", it.submit_date)}
                        ${block("评分", ratingLabel(it.rating))}
                        ${block("清单", listLabel(it.list_status))}
                        ${block("分类", it.category)}
                        ${block("创作者", it.creator)}
                        ${block("追踪 / 集数", it.episode_count)}
                        ${block("原著", it.original_work)}
                        ${block("首播日期", it.release_date)}
                        ${block("关联系列", it.related_series)}
                    </div>
                </div>
                <div class="crv-poster-col">${posterInner}</div>
            </div>
            ${tagHtml}
            ${prose("简介", it.summary)}
            ${prose("剧评 / 书评", it.review)}
        `;
    }

    function getEls() {
        return {
            ov: document.getElementById("content-record-view-overlay"),
            dr: document.getElementById("content-record-view-drawer"),
            body: document.getElementById("content-record-view-body"),
            title: document.getElementById("content-record-view-title-text"),
        };
    }

    function openUi() {
        const { ov, dr } = getEls();
        if (ov) {
            ov.classList.add("open");
            ov.setAttribute("aria-hidden", "false");
        }
        if (dr) {
            dr.classList.add("open");
            dr.setAttribute("aria-hidden", "false");
        }
    }

    function closeUi() {
        const { ov, dr } = getEls();
        if (ov) {
            ov.classList.remove("open");
            ov.setAttribute("aria-hidden", "true");
        }
        if (dr) {
            dr.classList.remove("open");
            dr.setAttribute("aria-hidden", "true");
        }
    }

    async function open(recordId) {
        const rid = String(recordId || "").trim();
        if (!rid) return;
        const { body, title } = getEls();
        if (!body || !title) return;
        const seq = ++fetchSeq;
        title.textContent = "加载中…";
        body.innerHTML = `<div class="crv-loading">加载中…</div>`;
        openUi();
        try {
            const res = await fetch(`/api/content/records/${encodeURIComponent(rid)}`);
            const data = await res.json().catch(() => ({}));
            if (seq !== fetchSeq) return;
            if (!data || !data.success || !data.item) {
                toast((data && data.message) || "加载记录失败", "error");
                closeUi();
                return;
            }
            const it = data.item;
            title.textContent = String(it.title || "").trim() || "—";
            body.innerHTML = renderBody(it);
        } catch {
            if (seq !== fetchSeq) return;
            toast("加载记录失败", "error");
            closeUi();
        }
    }

    function close() {
        fetchSeq += 1;
        closeUi();
    }

    function init(opts) {
        if (opts && typeof opts.notify === "function") notify = opts.notify;
        if (bound) return;
        bound = true; /* 每页只绑定一次；notify 可在未 bound 前通过多次 init 更新 */
        document.getElementById("content-record-view-close")?.addEventListener("click", (e) => {
            e.preventDefault();
            close();
        });
        document.getElementById("content-record-view-overlay")?.addEventListener("click", (e) => {
            if (e.target === e.currentTarget) close();
        });
        document.getElementById("content-record-view-drawer")?.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    window.ContentRecordViewDrawer = { init, open, close };
})();

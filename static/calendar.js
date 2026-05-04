// 新版独立日历前端逻辑（仅负责展示与抽屉数据拉取）

(function () {
    const state = {
        current: new Date(),
        selectedDate: null,
        summary: null,
        dayDetail: null,
        checkinState: null, // /api/checkin/state snapshot (events/records/dateLabels)
        loadingSummary: false,
        loadingDay: false,
        savingCheckinState: false,
        diaryQuill: null,
        diaryDrawerMode: null, // "add" | "edit"
        ledgerTags: { income: [], expense: [] },
        ledgerDrawerOpen: false,
        ledgerModalEditingId: null,
        ledgerConfirmOnOk: null,
        ledgerRetentionStart: "",
        ledgerServerDate: "",
    };

    /** 并发 loadDayDetail 时只应用最后一次结果 */
    let dayDetailFetchSeq = 0;

    function formatDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function formatMonth(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}`;
    }

    /** 记账金额展示：去掉末尾无意义的 0（如 12000、12.5、12.34） */
    function formatLedgerAmountDisplay(num) {
        const n = Number(num);
        if (!isFinite(n)) return "0";
        return String(Number(n.toFixed(2)));
    }

    /** 月历格角标：仅正数时展示金额字符串 */
    function formatLedgerAmountForCalendarCell(num) {
        const n = Number(num);
        if (!isFinite(n) || n <= 0) return "";
        return formatLedgerAmountDisplay(n);
    }

    function setTitle(year, month) {
        const el = document.getElementById("calendar-title");
        if (el) el.textContent = `${year}年${month}月`;
    }

    function getSummaryItemByDate(dateStr) {
        if (!state.summary || !Array.isArray(state.summary.days)) return null;
        return state.summary.days.find((d) => d.date === dateStr) || null;
    }

    function renderCalendarGrid() {
        const grid = document.getElementById("calendar-grid");
        if (!grid || !state.summary) return;

        const y = state.summary.year;
        const m = state.summary.month - 1; // 0-based

        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const startWeekday = (firstDay.getDay() + 6) % 7; // 周一=0
        const daysInMonth = lastDay.getDate();

        setTitle(state.summary.year, state.summary.month);

        const todayStr = formatDate(new Date());
        const cells = [];

        const prevMonth = m === 0 ? 11 : m - 1;
        const prevYear = m === 0 ? y - 1 : y;
        const prevLastDay = new Date(prevYear, prevMonth + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            const dayNum = prevLastDay - startWeekday + i + 1;
            const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            cells.push({ dateStr, dayNum, otherMonth: true });
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
            cells.push({ dateStr, dayNum: i, otherMonth: false });
        }

        const remaining = 42 - cells.length;
        const nextMonth = m === 11 ? 0 : m + 1;
        const nextYear = m === 11 ? y + 1 : y;
        for (let i = 1; i <= remaining; i++) {
            const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
            cells.push({ dateStr, dayNum: i, otherMonth: true });
        }

        const html = cells
            .map((c) => {
                const summary = getSummaryItemByDate(c.dateStr) || {};
                const isToday = c.dateStr === todayStr;
                const isSelected = c.dateStr === state.selectedDate;
                const isPast = c.dateStr < todayStr;
                const cls = [
                    "calendar-day",
                    c.otherMonth ? "other-month" : "",
                    isToday ? "today" : "",
                    isSelected ? "selected" : "",
                    isPast ? "past" : "",
                ]
                    .filter(Boolean)
                    .join(" ");

                const colors = Array.isArray(summary.checkin_completed_colors)
                    ? summary.checkin_completed_colors.filter(Boolean)
                    : [];
                const dotsHtml = colors.length
                    ? colors
                          .map((c) => `<span class="dot" style="background:${escapeHtml(c)}"></span>`)
                          .join("")
                    : "";

                const labels = Array.isArray(summary.labels) ? summary.labels : [];

                const reminders = Array.isArray(summary.reminders) ? summary.reminders : [];
                const iconMap = {
                    payment: "💰",
                    bill: "🧾",
                    activity: "🎭",
                    sale: "🎫",
                    party: "🎉",
                    work: "💼",
                    normal: "🔔",
                };
                const reminderRows = reminders.map((r) => {
                        const completed = !!r.completed;
                        const rt = String(r.reminderType || "normal");
                        const icon = completed ? "✓" : (iconMap[rt] || "🔔");
                        const iconClass = completed ? "day-reminder-icon day-reminder-icon-completed" : "day-reminder-icon";
                        return `<span class="${iconClass}" aria-hidden="true">${icon}</span><span class="day-reminder-name">${escapeHtml(r.name || "")}</span>`;
                    })
                    .slice(0, 2);

                // row2~row3：按当前优先级展示“日期标签 -> 提醒事件”，最多两行
                const rowItems = labels
                    .map(
                        (l) =>
                            `<span class="day-label-icon" aria-hidden="true">${(l.addType === "sync") ? "☁️" : "🏷️"}</span><span class="day-label">${escapeHtml(l.name || "")}</span>`
                    )
                    .concat(reminderRows)
                    .slice(0, 2);
                const row2Html = rowItems[0]
                    ? `<div class="day-info-row">${rowItems[0]}</div>`
                    : `<div class="day-info-row day-info-row-empty"></div>`;
                const row3Html = rowItems[1]
                    ? `<div class="day-info-row">${rowItems[1]}</div>`
                    : `<div class="day-info-row day-info-row-empty"></div>`;

                const hasDiary = !!(summary.hasDiary || summary.has_diary);
                const incAmt = Number(summary.income_total || 0);
                const expAmt = Number(summary.expense_total || 0);
                const incomeStr = incAmt > 0 ? formatLedgerAmountForCalendarCell(incAmt) : "";
                const expenseStr = expAmt > 0 ? formatLedgerAmountForCalendarCell(expAmt) : "";
                const watchCount = Number(summary.watch_count || 0);
                const bookCount = Number(summary.book_count || 0);
                const pendingTodos = Number(summary.todo_pending_count || 0);
                const leftFooterHtml = isToday
                    ? `<span class="day-row5-todo">待办 ${escapeHtml(String(Math.max(0, pendingTodos)))}</span>`
                    : "";
                const rightFooterParts = [];
                if (watchCount > 0) {
                    rightFooterParts.push(
                        `<span class="day-row5-badge" title="已看完 · 追剧">🎬${escapeHtml(String(watchCount))}</span>`
                    );
                }
                if (bookCount > 0) {
                    rightFooterParts.push(
                        `<span class="day-row5-badge" title="已看完 · 读书">📚${escapeHtml(String(bookCount))}</span>`
                    );
                }
                if (hasDiary) {
                    rightFooterParts.push(`<span class="day-diary-mark" title="有日记" aria-label="有日记">📝</span>`);
                }
                const rightFooterHtml = rightFooterParts.join("");
                const incomeExpenseHtml = `<div class="day-income-expense-row">${
                    incomeStr ? `<span class="day-amount income">${escapeHtml(incomeStr)}</span>` : ""
                }${
                    expenseStr ? `<span class="day-amount expense">${escapeHtml(expenseStr)}</span>` : ""
                }</div>`;

                return `<div class="${cls}" data-date="${c.dateStr}">
                    <div class="day-top-row">
                        <div class="day-dots">${dotsHtml}</div>
                        <div class="day-top-right">
                            <span class="day-num">${c.dayNum}</span>
                        </div>
                    </div>
                    ${row2Html}
                    ${row3Html}
                    ${incomeExpenseHtml}
                    <div class="day-bottom-row">
                        <div class="day-bottom-left">${leftFooterHtml}</div>
                        <div class="day-bottom-right">${rightFooterHtml}</div>
                    </div>
                </div>`;
            })
            .join("");

        grid.innerHTML = html;
    }

    function escapeHtml(str) {
        if (str == null) return "";
        const div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    }

    function getIconForReminderType(reminderType) {
        const rt = String(reminderType || "normal");
        const iconMap = {
            payment: "💰",
            bill: "🧾",
            activity: "🎭",
            sale: "🎫",
            party: "🎉",
            work: "💼",
            normal: "🔔",
        };
        return iconMap[rt] || "🔔";
    }

    function stripHtmlToPreview(html) {
        if (!html || !String(html).trim()) return "";
        const div = document.createElement("div");
        div.innerHTML = String(html);
        const t = (div.textContent || "").replace(/\s+/g, " ").trim();
        return t.length > 120 ? t.slice(0, 120) + "…" : t;
    }

    function formatDateTimeToMinuteFromDb(ts) {
        if (ts == null || ts === "") return "-";
        let d = null;
        if (typeof ts === "number" && isFinite(ts)) d = new Date(ts * 1000);
        else {
            const x = new Date(ts);
            if (!isNaN(x.getTime())) d = x;
        }
        if (!d) return "-";
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

    async function loadLedgerRetentionMeta() {
        try {
            const r = await fetch("/api/ledger/meta");
            const d = await r.json().catch(() => ({}));
            if (!d || !d.success) return;
            state.ledgerRetentionStart = String(d.retention_start_date || "").trim();
            state.ledgerServerDate = String(d.server_date || "").trim() || formatDate(new Date());
            const el = document.getElementById("calendar-ledger-entry-date");
            if (el) {
                if (state.ledgerRetentionStart) el.min = state.ledgerRetentionStart;
                if (state.ledgerServerDate) el.max = state.ledgerServerDate;
            }
        } catch (e) {
            console.error("loadLedgerRetentionMeta", e);
        }
    }

    function ledgerDateAllowedForWrite(ds) {
        if (!ds) return false;
        const max = state.ledgerServerDate || formatDate(new Date());
        const min = state.ledgerRetentionStart || "";
        if (ds > max) return false;
        if (min && ds < min) return false;
        return true;
    }

    async function loadLedgerTagsIntoState() {
        const [expRes, incRes] = await Promise.all([
            fetch("/api/ledger/tags?kind=expense"),
            fetch("/api/ledger/tags?kind=income"),
        ]);
        const exp = await expRes.json().catch(() => ({}));
        const inc = await incRes.json().catch(() => ({}));
        state.ledgerTags.expense = exp && exp.success && Array.isArray(exp.items) ? exp.items : [];
        state.ledgerTags.income = inc && inc.success && Array.isArray(inc.items) ? inc.items : [];
    }

    function fillCalLedgerTagSelect(selectEl, kind, selectedId) {
        if (!selectEl) return;
        const list = kind === "income" ? state.ledgerTags.income : state.ledgerTags.expense;
        selectEl.innerHTML = "";
        if (!list.length) {
            const o = document.createElement("option");
            o.value = "";
            o.textContent = "请先在记账本中添加标签";
            o.disabled = true;
            o.selected = true;
            selectEl.appendChild(o);
            return;
        }
        list.forEach((t) => {
            const o = document.createElement("option");
            o.value = String(t.id);
            o.textContent = t.name || "";
            if (selectedId != null && String(selectedId) === String(t.id)) o.selected = true;
            selectEl.appendChild(o);
        });
        if (selectedId == null) {
            selectEl.selectedIndex = 0;
        } else if (![...selectEl.options].some((o) => o.selected)) {
            selectEl.selectedIndex = 0;
        }
    }

    function setLedgerDrawerOpen(open) {
        const overlay = document.getElementById("calendar-ledger-drawer-overlay");
        const drawer = document.getElementById("calendar-ledger-drawer");
        if (!overlay || !drawer) return;
        state.ledgerDrawerOpen = !!open;
        if (open) {
            overlay.classList.add("open");
            drawer.classList.add("open");
            overlay.setAttribute("aria-hidden", "false");
        } else {
            overlay.classList.remove("open");
            drawer.classList.remove("open");
            overlay.setAttribute("aria-hidden", "true");
        }
    }

    /**
     * 从 /api/ledger/entries 拉取单日流水并写入 state.dayDetail.ledger。
     * 解决 loadDayDetail 并发时结果被丢弃、抽屉合计与卡片不刷新的问题。
     */
    async function pullLedgerForSelectedDateIntoState(dateStr) {
        if (!dateStr) return;
        const d = String(dateStr);
        try {
            const res = await fetch(
                `/api/ledger/entries?start_date=${encodeURIComponent(d)}&end_date=${encodeURIComponent(d)}`
            );
            const data = await res.json().catch(() => ({}));
            if (!data || !data.success) return;
            if (String(state.selectedDate || "") !== d) return;
            if (!state.dayDetail) state.dayDetail = { date: d };
            const t = data.totals || {};
            state.dayDetail.ledger = {
                entries: Array.isArray(data.entries) ? data.entries : [],
                income_total: Number(t.income_total || 0),
                expense_total: Number(t.expense_total || 0),
            };
        } catch (e) {
            console.error("pullLedgerForSelectedDateIntoState", e);
        }
    }

    function syncCalLedgerAddExpenseNature() {
        const kind = String(document.getElementById("cal-ledger-add-kind")?.value || "expense");
        const sel = document.getElementById("cal-ledger-add-expense-nature");
        if (!sel) return;
        if (kind === "income") {
            sel.disabled = true;
            sel.value = "";
        } else {
            sel.disabled = false;
            if (!sel.value) sel.value = "daily";
        }
    }

    function refreshLedgerDrawerFromState() {
        const ledger = (state.dayDetail && state.dayDetail.ledger) || {};
        const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
        const incEl = document.getElementById("cal-ledger-drawer-income");
        const expEl = document.getElementById("cal-ledger-drawer-expense");
        if (incEl) incEl.textContent = "￥" + formatLedgerAmountDisplay(ledger.income_total || 0);
        if (expEl) expEl.textContent = "￥" + formatLedgerAmountDisplay(ledger.expense_total || 0);
        syncCalLedgerAddExpenseNature();
        const sub = document.getElementById("btn-cal-ledger-add-submit");
        if (sub) sub.disabled = !ledgerDateAllowedForWrite(state.selectedDate);
        const mount = document.getElementById("cal-ledger-cards-mount");
        if (!mount) return;
        if (!entries.length) {
            mount.innerHTML =
                '<div class="calendar-ledger-table-empty"><p class="muted" style="margin:0">暂无记账记录</p></div>';
            return;
        }
        const headHtml = `<div class="calendar-ledger-table-head calendar-ledger-table-row" role="row">
                <div class="calendar-ledger-cell" role="columnheader">类型</div>
                <div class="calendar-ledger-cell" role="columnheader">支出性质</div>
                <div class="calendar-ledger-cell" role="columnheader">标签</div>
                <div class="calendar-ledger-cell" role="columnheader">明细</div>
                <div class="calendar-ledger-cell" role="columnheader">批注</div>
                <div class="calendar-ledger-cell" role="columnheader">金额</div>
                <div class="calendar-ledger-cell" role="columnheader">操作</div>
            </div>`;
        const rowsHtml = entries
            .map((e) => {
                const kind = String(e.kind || "");
                const isIncome = kind === "income";
                const natureRaw = String(e.expense_nature || "").toLowerCase();
                const natureText = isIncome ? "—" : natureRaw === "fixed" ? "固定" : "日常";
                const amt = formatLedgerAmountDisplay(e.amount || 0);
                const tagName = escapeHtml(String(e.tag_name || "").trim() || "未命名");
                const desc = escapeHtml(String(e.description || "").trim() || "（无明细）");
                const ann = escapeHtml(String(e.annotation || "").trim());
                const kindText = isIncome ? "收入" : "支出";
                return `<div class="calendar-ledger-table-data calendar-ledger-table-row" role="row" data-ledger-entry-id="${escapeHtml(String(e.id))}">
                    <div class="calendar-ledger-cell">${escapeHtml(kindText)}</div>
                    <div class="calendar-ledger-cell">${escapeHtml(natureText)}</div>
                    <div class="calendar-ledger-cell">${tagName}</div>
                    <div class="calendar-ledger-cell">${desc}</div>
                    <div class="calendar-ledger-cell">${ann}</div>
                    <div class="calendar-ledger-cell calendar-ledger-cell-amt ${isIncome ? "income" : "expense"}">￥${escapeHtml(amt)}</div>
                    <div class="calendar-ledger-cell calendar-ledger-cell-actions">
                        <button type="button" class="calendar-ledger-action-btn" data-ledger-action="edit" aria-label="编辑" title="编辑">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button type="button" class="calendar-ledger-action-btn" data-ledger-action="delete" aria-label="删除" title="删除">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>`;
            })
            .join("");
        mount.innerHTML = headHtml + rowsHtml;
    }

    async function openLedgerDrawer() {
        if (!state.selectedDate) return;
        try {
            await Promise.all([loadLedgerRetentionMeta(), loadLedgerTagsIntoState()]);
        } catch (e) {
            console.error(e);
            showToast("加载标签失败", "error");
            return;
        }
        const kindEl = document.getElementById("cal-ledger-add-kind");
        if (kindEl) kindEl.value = "expense";
        const addNat = document.getElementById("cal-ledger-add-expense-nature");
        if (addNat) {
            addNat.value = "daily";
            addNat.disabled = false;
        }
        fillCalLedgerTagSelect(document.getElementById("cal-ledger-add-tag"), kindEl ? kindEl.value : "expense", null);
        const amtEl = document.getElementById("cal-ledger-add-amount");
        const descEl = document.getElementById("cal-ledger-add-desc");
        const annEl = document.getElementById("cal-ledger-add-annotation");
        if (amtEl) amtEl.value = "";
        if (descEl) descEl.value = "";
        if (annEl) annEl.value = "";
        const d = state.selectedDate;
        for (let attempt = 0; attempt < 3; attempt++) {
            await loadDayDetail(d);
            if (state.dayDetail && state.dayDetail.date === d) break;
        }
        await pullLedgerForSelectedDateIntoState(d);
        setLedgerDrawerOpen(true);
        refreshLedgerDrawerFromState();
    }

    function closeLedgerDrawer() {
        setLedgerDrawerOpen(false);
    }

    async function submitCalLedgerAdd() {
        const date = state.selectedDate;
        if (!date) return;
        if (!ledgerDateAllowedForWrite(date)) {
            showToast("该日期不在系统可记账范围内（最近12个自然月）", "error");
            return;
        }
        const kind = String(document.getElementById("cal-ledger-add-kind")?.value || "expense");
        const tagId = String(document.getElementById("cal-ledger-add-tag")?.value || "");
        const amount = Number(document.getElementById("cal-ledger-add-amount")?.value);
        const description = String(document.getElementById("cal-ledger-add-desc")?.value || "").trim();
        const annotation = String(document.getElementById("cal-ledger-add-annotation")?.value || "").trim();
        if (!tagId) {
            showToast("请选择标签", "error");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast("金额必须为正数", "error");
            return;
        }
        if (!description) {
            showToast("请填写明细", "error");
            return;
        }
        if (description.length > 200) {
            showToast("明细不能超过200字", "error");
            return;
        }
        if (annotation.length > 30) {
            showToast("批注不能超过30字", "error");
            return;
        }
        let expenseNature = "daily";
        if (kind === "expense") {
            expenseNature = String(document.getElementById("cal-ledger-add-expense-nature")?.value || "daily");
            if (expenseNature !== "daily" && expenseNature !== "fixed") {
                showToast("请选择支出性质", "error");
                return;
            }
        }
        try {
            const body = {
                date,
                kind,
                tag_id: Number(tagId),
                amount: Number(amount.toFixed(2)),
                description,
                annotation,
            };
            if (kind === "expense") {
                body.expense_nature = expenseNature;
            }
            const res = await fetch("/api/ledger/entries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!data || !data.success) {
                showToast((data && data.message) || "新增失败", "error");
                return;
            }
            showToast("已新增");
            if (document.getElementById("cal-ledger-add-amount")) document.getElementById("cal-ledger-add-amount").value = "";
            if (document.getElementById("cal-ledger-add-desc")) document.getElementById("cal-ledger-add-desc").value = "";
            if (document.getElementById("cal-ledger-add-annotation")) document.getElementById("cal-ledger-add-annotation").value = "";
            await loadDayDetail(date);
            if (state.ledgerDrawerOpen) await pullLedgerForSelectedDateIntoState(date);
            await loadSummary(state.current);
            refreshLedgerDrawerFromState();
        } catch (e) {
            console.error(e);
            showToast("新增失败，请稍后重试", "error");
        }
    }

    function openLedgerEntryModal() {
        document.getElementById("calendar-ledger-entry-modal")?.classList.remove("hidden");
    }

    function closeLedgerEntryModal() {
        state.ledgerModalEditingId = null;
        document.getElementById("calendar-ledger-entry-modal")?.classList.add("hidden");
    }

    async function openLedgerEditModal(entry) {
        if (!entry || entry.id == null) return;
        state.ledgerModalEditingId = entry.id;
        try {
            await Promise.all([loadLedgerRetentionMeta(), loadLedgerTagsIntoState()]);
        } catch (e) {
            showToast("加载标签失败", "error");
            return;
        }
        const kind = String(entry.kind || "expense");
        document.getElementById("calendar-ledger-entry-modal-title").textContent = "编辑记账";
        document.getElementById("calendar-ledger-entry-kind").value = kind;
        let dv = String(entry.date || state.selectedDate || "");
        const mx = state.ledgerServerDate || formatDate(new Date());
        const mn = state.ledgerRetentionStart || "";
        if (mn && dv < mn) dv = mn;
        if (dv > mx) dv = mx;
        const dEl = document.getElementById("calendar-ledger-entry-date");
        if (dEl) dEl.value = dv;
        document.getElementById("calendar-ledger-entry-amount").value = String(Number(entry.amount || 0).toFixed(2));
        document.getElementById("calendar-ledger-entry-desc").value = String(entry.description || "");
        const annEl = document.getElementById("calendar-ledger-entry-annotation");
        if (annEl) annEl.value = String(entry.annotation || "");
        const en = String(entry.expense_nature || "daily").toLowerCase();
        const enEl = document.getElementById("calendar-ledger-entry-expense-nature");
        if (enEl) enEl.value = en === "fixed" ? "fixed" : "daily";
        const enWrap = document.getElementById("calendar-ledger-entry-nature-wrap");
        if (enWrap) enWrap.style.display = kind === "expense" ? "" : "none";
        fillCalLedgerTagSelect(document.getElementById("calendar-ledger-entry-tag"), kind, entry.tag_id);
        openLedgerEntryModal();
    }

    async function saveLedgerEntryModal() {
        const id = state.ledgerModalEditingId;
        if (id == null) return;
        const kind = String(document.getElementById("calendar-ledger-entry-kind")?.value || "");
        const date = String(document.getElementById("calendar-ledger-entry-date")?.value || "").trim();
        const tagId = String(document.getElementById("calendar-ledger-entry-tag")?.value || "");
        const amount = Number(document.getElementById("calendar-ledger-entry-amount")?.value);
        const description = String(document.getElementById("calendar-ledger-entry-desc")?.value || "").trim();
        const annotation = String(document.getElementById("calendar-ledger-entry-annotation")?.value || "").trim();
        if (!date) {
            showToast("请选择日期", "error");
            return;
        }
        if (!ledgerDateAllowedForWrite(date)) {
            showToast("该日期不在系统可记账范围内（最近12个自然月）", "error");
            return;
        }
        if (!tagId) {
            showToast("请选择标签", "error");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast("金额必须为正数", "error");
            return;
        }
        if (!description) {
            showToast("请填写明细", "error");
            return;
        }
        if (description.length > 200) {
            showToast("明细不能超过200字", "error");
            return;
        }
        if (annotation.length > 30) {
            showToast("批注不能超过30字", "error");
            return;
        }
        const expenseNature = String(document.getElementById("calendar-ledger-entry-expense-nature")?.value || "daily");
        if (kind === "expense" && expenseNature !== "daily" && expenseNature !== "fixed") {
            showToast("请选择支出性质", "error");
            return;
        }
        try {
            const body = {
                date,
                kind,
                tag_id: Number(tagId),
                amount: Number(amount.toFixed(2)),
                description,
                annotation,
            };
            if (kind === "expense") {
                body.expense_nature = expenseNature;
            }
            const res = await fetch("/api/ledger/entries/" + encodeURIComponent(String(id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!data || !data.success) {
                showToast((data && data.message) || "保存失败", "error");
                return;
            }
            showToast("已保存");
            closeLedgerEntryModal();
            const d = state.selectedDate;
            if (d) {
                await loadDayDetail(d);
                if (state.ledgerDrawerOpen) await pullLedgerForSelectedDateIntoState(d);
                await loadSummary(state.current);
                refreshLedgerDrawerFromState();
            }
        } catch (e) {
            console.error(e);
            showToast("保存失败，请稍后重试", "error");
        }
    }

    function openLedgerConfirm(text, onOk) {
        const el = document.getElementById("calendar-ledger-confirm-text");
        if (el) el.textContent = text || "";
        state.ledgerConfirmOnOk = typeof onOk === "function" ? onOk : null;
        document.getElementById("calendar-ledger-confirm-modal")?.classList.remove("hidden");
    }

    function closeLedgerConfirm() {
        state.ledgerConfirmOnOk = null;
        document.getElementById("calendar-ledger-confirm-modal")?.classList.add("hidden");
    }

    async function deleteLedgerEntryById(entryId) {
        const date = state.selectedDate;
        try {
            const res = await fetch("/api/ledger/entries/" + encodeURIComponent(String(entryId)), { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            if (!data || !data.success) {
                showToast((data && data.message) || "删除失败", "error");
                return;
            }
            showToast("已删除");
            if (date) {
                await loadDayDetail(date);
                if (state.ledgerDrawerOpen) await pullLedgerForSelectedDateIntoState(date);
                await loadSummary(state.current);
                refreshLedgerDrawerFromState();
            }
        } catch (e) {
            console.error(e);
            showToast("删除失败，请稍后重试", "error");
        }
    }

    function notifyCalendarDiarySaved(dateStr) {
        const payload = JSON.stringify({ date: dateStr, ts: Date.now() });
        try {
            localStorage.setItem("calendar-diary-updated", payload);
        } catch (_) {}
        window.dispatchEvent(new CustomEvent("calendar-diary-updated", { detail: { date: dateStr } }));
    }

    function calendarDiaryImageHandler() {
        const q = state.diaryQuill;
        if (!q) return;
        const input = document.createElement("input");
        input.setAttribute("type", "file");
        input.setAttribute("accept", "image/*");
        input.click();
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const range = q.getSelection(true);
                q.insertEmbed(range.index, "image", e.target.result);
                q.setSelection(range.index + 1);
            };
            reader.readAsDataURL(file);
        };
    }

    function initDiaryQuill() {
        if (state.diaryQuill) return state.diaryQuill;
        const host = document.getElementById("calendar-diary-editor");
        if (!host || typeof Quill === "undefined") return null;
        state.diaryQuill = new Quill("#calendar-diary-editor", {
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
                        image: calendarDiaryImageHandler,
                    },
                },
            },
        });
        state.diaryQuill.root.addEventListener("paste", (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            const q = state.diaryQuill;
            if (!q) return;
            for (const item of items) {
                if (item.type.indexOf("image") !== -1) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const range = q.getSelection(true);
                        q.insertEmbed(range.index, "image", ev.target.result);
                        q.setSelection(range.index + 1);
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        });
        return state.diaryQuill;
    }

    function setDiaryDrawerOpen(open) {
        const overlay = document.getElementById("calendar-diary-drawer-overlay");
        const drawer = document.getElementById("calendar-diary-drawer");
        if (!overlay || !drawer) return;
        if (open) {
            overlay.classList.add("open");
            drawer.classList.add("open");
            overlay.setAttribute("aria-hidden", "false");
        } else {
            overlay.classList.remove("open");
            drawer.classList.remove("open");
            overlay.setAttribute("aria-hidden", "true");
        }
    }

    function openDiaryDrawer(mode) {
        const dateStr = state.selectedDate;
        if (!dateStr) return;
        state.diaryDrawerMode = mode;
        const diary = state.dayDetail && state.dayDetail.diary ? state.dayDetail.diary : null;
        const titleEl = document.getElementById("calendar-diary-drawer-title-text");
        const footerLeft = document.getElementById("calendar-diary-drawer-footer-left");
        const inputTitle = document.getElementById("calendar-diary-title");
        const inputDiet = document.getElementById("calendar-diary-today-diet");
        const inputExercise = document.getElementById("calendar-diary-exercise-summary");

        if (titleEl) titleEl.textContent = mode === "add" ? "添加日记" : "编辑日记";
        if (footerLeft) {
            if (mode === "edit" && diary) {
                footerLeft.textContent =
                    "上次更新时间：" + formatDateTimeToMinuteFromDb(diary.updated_at != null ? diary.updated_at : diary.created_at);
            } else {
                footerLeft.textContent = "";
            }
        }

        initDiaryQuill();
        const q = state.diaryQuill;
        if (!q) {
            if (typeof Quill === "undefined") {
                showToast("富文本编辑器未加载，请刷新页面重试", "error");
            } else {
                showToast("编辑器初始化失败，请刷新页面重试", "error");
            }
            return;
        }
        if (inputTitle) inputTitle.value = mode === "edit" && diary ? diary.title || "" : "";
        if (inputDiet) inputDiet.value = mode === "edit" && diary ? diary.today_diet || "" : "";
        if (inputExercise) inputExercise.value = mode === "edit" && diary ? diary.exercise_summary || "" : "";
        if (q) q.root.innerHTML = mode === "edit" && diary ? diary.content || "" : "";

        setDiaryDrawerOpen(true);
        requestAnimationFrame(() => {
            if (state.diaryQuill && typeof state.diaryQuill.update === "function") {
                try {
                    state.diaryQuill.update();
                } catch (_) {}
            }
            if (inputTitle) {
                try {
                    inputTitle.focus();
                } catch (_) {}
            }
        });
    }

    function closeDiaryDrawer() {
        state.diaryDrawerMode = null;
        setDiaryDrawerOpen(false);
    }

    async function submitDiaryFromDrawer() {
        const dateStr = state.selectedDate;
        if (!dateStr) return;
        const title = String(document.getElementById("calendar-diary-title")?.value || "");
        const todayDiet = String(document.getElementById("calendar-diary-today-diet")?.value || "");
        const exerciseSummary = String(document.getElementById("calendar-diary-exercise-summary")?.value || "");
        if (todayDiet.length > 200) {
            showToast("今日饮食不能超过200字", "error");
            return;
        }
        if (exerciseSummary.length > 500) {
            showToast("锻炼小结不能超过500字", "error");
            return;
        }
        const q = state.diaryQuill;
        const content = q ? String(q.root.innerHTML || "") : "";
        try {
            const res = await fetch("/api/diaries/" + encodeURIComponent(dateStr), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, content, today_diet: todayDiet, exercise_summary: exerciseSummary }),
            });
            const data = await res.json();
            if (!data || !data.success) {
                showToast((data && data.message) || "保存失败", "error");
                return;
            }
            showToast("已保存");
            notifyCalendarDiarySaved(dateStr);
            closeDiaryDrawer();
            await loadDayDetail(dateStr);
            await loadSummary(state.current);
        } catch (e) {
            console.error("submitDiaryFromDrawer", e);
            showToast("保存失败，请稍后重试", "error");
        }
    }

    function showToast(text, type) {
        const el = document.getElementById("toast");
        if (!el || !text) return;
        el.textContent = String(text);
        let variant = "toast-success";
        if (type === "error") variant = "toast-error";
        else if (type === "info") variant = "toast-info";
        el.className = "toast " + variant;
        el.style.opacity = "1";
        clearTimeout(el._timer);
        el._timer = setTimeout(() => {
            el.style.opacity = "0";
        }, 1800);
    }

    async function ensureCheckinStateLoaded() {
        if (state.checkinState) return state.checkinState;
        const res = await fetch("/api/checkin/state");
        const data = await res.json();
        if (!data || !data.success) throw new Error("读取打卡状态失败");
        const snap = data.data || {};
        snap.events = Array.isArray(snap.events) ? snap.events : [];
        snap.records = Array.isArray(snap.records) ? snap.records : [];
        snap.dateLabels = snap.dateLabels || { specific: {}, annual: {} };
        state.checkinState = snap;
        return snap;
    }

    function isFutureDate(dateStr) {
        const todayStr = formatDate(new Date());
        return String(dateStr || "") > todayStr;
    }

    function toggleRecordInSnapshot(snapshot, eventId, dateStr) {
        if (!snapshot || !Array.isArray(snapshot.records)) return;
        const eid = String(eventId || "");
        const d = String(dateStr || "");
        if (!eid || !d) return;
        const idx = snapshot.records.findIndex(
            (r) => String(r.eventId || "") === eid && String(r.date || "") === d
        );
        if (idx >= 0) snapshot.records.splice(idx, 1);
        else snapshot.records.push({ eventId: eid, date: d });
    }

    async function saveCheckinSnapshot(snapshot) {
        if (state.savingCheckinState) return false;
        state.savingCheckinState = true;
        try {
            const res = await fetch("/api/checkin/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    events: snapshot.events || [],
                    records: snapshot.records || [],
                    dateLabels: snapshot.dateLabels || { specific: {}, annual: {} },
                }),
            });
            const data = await res.json();
            if (!data || !data.success) {
                const msg = (data && data.message) || "保存失败";
                showToast(msg, "error");
                return false;
            }
            return true;
        } catch (e) {
            console.error("saveCheckinSnapshot error", e);
            showToast("保存失败，请稍后重试", "error");
            return false;
        } finally {
            state.savingCheckinState = false;
        }
    }

    async function loadSummary(forDate) {
        if (state.loadingSummary) return;
        state.loadingSummary = true;
        try {
            const monthStr = formatMonth(forDate || state.current);
            const res = await fetch(`/api/calendar/summary?month=${encodeURIComponent(monthStr)}`);
            const data = await res.json();
            if (!data || !data.success) return;
            state.summary = data;
            renderCalendarGrid();
        } catch (e) {
            console.error("loadSummary error", e);
        } finally {
            state.loadingSummary = false;
        }
    }

    async function loadDayDetail(dateStr) {
        if (!dateStr) return;
        const seq = ++dayDetailFetchSeq;
        state.loadingDay = true;
        try {
            const res = await fetch(`/api/calendar/day?date=${encodeURIComponent(dateStr)}`);
            const data = await res.json();
            if (seq !== dayDetailFetchSeq) return;
            if (!data || !data.success) return;
            state.dayDetail = data;
            state.selectedDate = dateStr;
            renderCalendarGrid();
            renderDayDetail();
            if (state.ledgerDrawerOpen && String(state.selectedDate || "") === String(dateStr || "")) {
                await pullLedgerForSelectedDateIntoState(dateStr);
                refreshLedgerDrawerFromState();
            }
        } catch (e) {
            console.error("loadDayDetail error", e);
        } finally {
            if (seq === dayDetailFetchSeq) state.loadingDay = false;
        }
    }

    function renderDayDetail() {
        const detailTitle = document.getElementById("detail-title");
        const panel = document.getElementById("detail-panel");
        if (!panel) return;
        const data = state.dayDetail;
        if (!data) {
            if (detailTitle) detailTitle.textContent = "选择日期";
            panel.innerHTML = `<p class="muted">请点击左侧日历选择日期</p>`;
            return;
        }
        if (detailTitle) detailTitle.textContent = data.date || "";

        const dateStr = data.date || state.selectedDate || "";
        const detailFuture = isFutureDate(dateStr);
        const serverTodayStr = String(data.server_today || formatDate(new Date())).slice(0, 10);
        const isServerTodayForTodos = String(dateStr || "").slice(0, 10) === serverTodayStr;
        const isBeforeServerToday = String(dateStr || "") < serverTodayStr;

        const labels = Array.isArray(data.labels) ? data.labels : [];
        const checkins = Array.isArray(data.checkins) ? data.checkins : [];
        const reminders = Array.isArray(data.reminders) ? data.reminders : [];
        const todosDone = Array.isArray(data.todos_done) ? data.todos_done : [];
        const doneTodoIds = new Set(todosDone.map((t) => Number(t.id)));
        const todosPendingRaw = Array.isArray(data.todos_pending) ? data.todos_pending : [];
        const todosPending = todosPendingRaw.filter((t) => !doneTodoIds.has(Number(t.id)));
        const ledger = data.ledger || {};
        const diary = data.diary || null;
        const contentItems = Array.isArray(data.content_items) ? data.content_items : [];

        const labelsHtml =
            labels.length > 0
                ? `<div class="detail-section">
                    <div class="detail-section-title">日期标签</div>
                    <div class="detail-list">
                        ${labels
                            .map(
                                (l) =>
                                    `<div class="detail-item">
                                        <div class="detail-item-left">
                                            <span class="detail-item-status" aria-hidden="true">${(l.addType === "sync") ? "☁️" : "🏷️"}</span>
                                            <div class="detail-item-title">${escapeHtml(l.name || "")}</div>
                                        </div>
                                    </div>`
                            )
                            .join("")}
                    </div>
                   </div>`
                : "";

        const checkinsHtml =
            `<div class="detail-section">
                <div class="detail-section-title">打卡</div>
                <div class="detail-list">
                    ${
                        checkins.length === 0
                            ? `<p class="muted">当日没有打卡事件。</p>`
                            : checkins
                                  .map((c) => {
                                      const completed = !!c.completed;
                                      const disabledClass = detailFuture ? " disabled" : "";
                                      return `<div class="detail-event-item${
                                          completed ? " checked" : ""
                                      }${disabledClass}" data-kind="checkin" data-id="${escapeHtml(c.id)}">
                                                <span class="dot" style="background:${escapeHtml(
                                                    c.color || "#16a34a"
                                                )}"></span>
                                                <div class="detail-event-item-content-wrap">
                                                    <span class="detail-event-item-name">${escapeHtml(
                                                        c.name || ""
                                                    )}</span>
                                                </div>
                                                ${
                                                    completed
                                                        ? '<span class="detail-complete-icon" aria-hidden="true">✓</span>'
                                                        : ""
                                                }
                                            </div>`;
                                  })
                                  .join("")
                    }
                </div>
               </div>`;

        const remindersHtml =
            `<div class="detail-section">
                <div class="detail-section-title">提醒</div>
                <div class="detail-list">
                    ${
                        reminders.length === 0
                            ? `<p class="muted">当日暂无提醒。</p>`
                            : reminders
                                  .map((c) => {
                                      const completed = !!c.completed;
                                      const raw = c.raw || {};
                                      const rt =
                                          raw.reminderType != null ? String(raw.reminderType) : "normal";
                                      const icon = getIconForReminderType(rt);
                                      const dt = String(raw.dateType || "specific");
                                      const timeStr =
                                          dt === "specific" &&
                                          (raw.hour != null || raw.minute != null)
                                              ? `${String(raw.hour ?? 0).padStart(2, "0")}:${String(
                                                    raw.minute ?? 0
                                                ).padStart(2, "0")} `
                                              : "";
                                      const displayText = timeStr + (c.name || "");
                                      const disabledClass = detailFuture ? " disabled" : "";
                                      return `<div class="detail-event-item detail-reminder-item${
                                          completed ? " checked" : ""
                                      }${disabledClass}" data-kind="reminder" data-id="${escapeHtml(c.id)}">
                                                <span class="detail-reminder-icon" aria-hidden="true">${icon}</span>
                                                <div class="detail-event-item-content-wrap">
                                                    <span class="detail-event-item-name">${escapeHtml(
                                                        displayText
                                                    )}</span>
                                                </div>
                                                ${
                                                    completed
                                                        ? '<span class="detail-complete-icon" aria-hidden="true">✓</span>'
                                                        : ""
                                                }
                                            </div>`;
                                  })
                                  .join("")
                    }
                </div>
               </div>`;

        const ledgerHtml =
            `<div class="detail-section detail-section-ledger">
                <div class="detail-section-title">记账</div>
                <button type="button" id="btn-calendar-open-ledger" class="btn primary">我要记账</button>
                <p class="muted detail-ledger-totals">
                    收入合计：<span style="color:#047857;">￥${escapeHtml(
                        formatLedgerAmountDisplay(ledger.income_total || 0)
                    )}</span>，
                    支出合计：<span style="color:#b91c1c;">￥${escapeHtml(
                        formatLedgerAmountDisplay(ledger.expense_total || 0)
                    )}</span>
                </p>
               </div>`;

        let pendingTodosHtml = "";
        let doneTodosHtml = "";
        if (!detailFuture) {
            doneTodosHtml = `<div class="detail-section">
                <div class="detail-section-title">已完成待办</div>
                ${
                    todosDone.length === 0
                        ? `<p class="muted">暂无已完成待办。</p>`
                        : `<div class="detail-list">
                            ${todosDone
                                .map(
                                    (t) =>
                                        `<div class="detail-event-item detail-todo-item checked${
                                            isBeforeServerToday ? " disabled" : ""
                                        }" data-kind="todo" data-id="${escapeHtml(String(t.id))}">
                                                <div class="detail-event-item-content-wrap">
                                                    <span class="detail-event-item-name">${escapeHtml(
                                                        t.content_snapshot || ""
                                                    )}</span>
                                                </div>
                                                <span class="detail-complete-icon" aria-hidden="true">✓</span>
                                            </div>`
                                )
                                .join("")}
                           </div>`
                }
               </div>`;

            if (isServerTodayForTodos) {
                // 与接口一致：仅服务端「今天」生成待办区块（避免与本地日历日期判断错位）
                pendingTodosHtml = `<div class="detail-section">
                    <div class="detail-section-title">待办事项</div>
                    ${
                        todosPending.length === 0
                            ? `<p class="muted">暂无未完成待办。</p>`
                            : `<div class="detail-list">
                                ${todosPending
                                    .map(
                                        (t) =>
                                            `<div class="detail-event-item detail-todo-item" data-kind="todo" data-id="${escapeHtml(
                                                String(t.id)
                                            )}">
                                                    <div class="detail-event-item-content-wrap">
                                                        <span class="detail-event-item-name">${escapeHtml(
                                                            t.content_snapshot || ""
                                                        )}</span>
                                                    </div>
                                                </div>`
                                    )
                                    .join("")}
                               </div>`
                    }
                   </div>`;
            }
        }

        const diaryHtml =
            `<div class="detail-section" id="calendar-diary-section">
                <div class="detail-section-title">日记</div>
                ${
                    diary
                        ? `<button type="button" class="calendar-diary-summary-card" data-calendar-diary-open="1" aria-label="编辑日记">
                                <div class="calendar-diary-summary-title">${escapeHtml(diary.title || "(无今日小结)")}</div>
                                <p class="calendar-diary-summary-preview">${escapeHtml(
                                    stripHtmlToPreview(diary.content || "")
                                )}</p>
                           </button>`
                        : `<button type="button" id="btn-calendar-add-diary" class="btn primary">添加日记</button>`
                }
               </div>`;

        const contentHtml =
            `<div class="detail-section" id="calendar-content-section">
                <div class="detail-section-title">光影问卷</div>
                <button type="button" id="btn-calendar-open-content" class="btn primary">新增记录</button>
                ${
                    contentItems.length
                        ? `<div class="detail-list" style="margin-top:10px;">
                            ${contentItems
                                .slice(0, 6)
                                .map((it) => {
                                    const kindText = String(it.record_type || "") === "book" ? "📚 读书" : "🎬 追剧";
                                    const listPrefix =
                                        String(it.list_status || "") === "wishlist" ? "心愿 · " : "";
                                    const rid = String(it.id != null ? it.id : "").trim();
                                    const ridAttr = rid ? ` data-content-record-id="${escapeHtml(rid)}"` : "";
                                    return `<button type="button" class="detail-item detail-item--content"${ridAttr}>
                                        <div class="detail-item-left">
                                            <div class="detail-item-title">${escapeHtml(it.title || "")}</div>
                                        </div>
                                        <div class="detail-item-right">
                                            <span class="detail-item-status">${escapeHtml(listPrefix)}${escapeHtml(kindText)} · ${escapeHtml(String(it.rating || 0))}星</span>
                                        </div>
                                    </button>`;
                                })
                                .join("")}
                           </div>`
                        : `<p class="muted" style="margin-top:10px;">当日暂无记录。</p>`
                }
               </div>`;

        // 右侧详情区顺序：
        // … -> 待办事项(仅服务端「今天」且非未来) -> 已完成待办(今日或历史，非未来) -> 日记 -> …
        panel.innerHTML =
            labelsHtml +
            ledgerHtml +
            checkinsHtml +
            remindersHtml +
            (!detailFuture && isServerTodayForTodos ? pendingTodosHtml : "") +
            (!detailFuture ? doneTodosHtml : "") +
            diaryHtml +
            contentHtml;
    }

    function bindEvents() {
        const grid = document.getElementById("calendar-grid");
        grid?.addEventListener("click", (e) => {
            const dayEl = e.target.closest(".calendar-day");
            if (!dayEl || !dayEl.dataset.date) return;
            const dateStr = dayEl.dataset.date;
            loadDayDetail(dateStr);
        });

        document.getElementById("btn-prev-month")?.addEventListener("click", () => {
            const d = state.current;
            state.current = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            loadSummary(state.current);
        });

        document.getElementById("btn-next-month")?.addEventListener("click", () => {
            const d = state.current;
            state.current = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            loadSummary(state.current);
        });

        document.getElementById("btn-goto-today")?.addEventListener("click", () => {
            state.current = new Date();
            loadSummary(state.current);
            const todayStr = formatDate(new Date());
            loadDayDetail(todayStr);
        });

        document.getElementById("btn-go-home")?.addEventListener("click", () => {
            window.location.href = "/home";
        });

        document.getElementById("detail-panel")?.addEventListener("click", (e) => {
            const contentBtn = e.target.closest("button[data-content-record-id]");
            if (contentBtn) {
                const rid = String(contentBtn.getAttribute("data-content-record-id") || "").trim();
                if (rid && window.ContentRecordViewDrawer) void window.ContentRecordViewDrawer.open(rid);
                return;
            }
            if (e.target.closest("#btn-calendar-open-ledger")) {
                openLedgerDrawer();
                return;
            }
            if (e.target.closest("#btn-calendar-add-diary")) {
                openDiaryDrawer("add");
                return;
            }
            if (e.target.closest("#btn-calendar-open-content")) {
                window.location.href = "/content";
                return;
            }
            if (e.target.closest("[data-calendar-diary-open]")) {
                openDiaryDrawer("edit");
            }
        });

        document.getElementById("calendar-ledger-drawer-close")?.addEventListener("click", closeLedgerDrawer);
        document.getElementById("calendar-ledger-drawer-overlay")?.addEventListener("click", closeLedgerDrawer);
        document.getElementById("btn-cal-ledger-add-submit")?.addEventListener("click", () => {
            submitCalLedgerAdd();
        });
        document.getElementById("cal-ledger-add-kind")?.addEventListener("change", () => {
            const kind = String(document.getElementById("cal-ledger-add-kind")?.value || "expense");
            fillCalLedgerTagSelect(document.getElementById("cal-ledger-add-tag"), kind, null);
            syncCalLedgerAddExpenseNature();
        });

        document.getElementById("cal-ledger-cards-mount")?.addEventListener("click", (e) => {
            const btn = e.target.closest("button[data-ledger-action]");
            if (!btn) return;
            const card = e.target.closest(".calendar-ledger-table-data[data-ledger-entry-id]");
            const idRaw = card && card.getAttribute("data-ledger-entry-id");
            const entryId = idRaw != null ? Number(idRaw) : NaN;
            if (!Number.isFinite(entryId)) return;
            const ledger = (state.dayDetail && state.dayDetail.ledger) || {};
            const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
            const entry = entries.find((x) => Number(x.id) === entryId);
            const action = btn.getAttribute("data-ledger-action");
            if (action === "edit" && entry) {
                openLedgerEditModal(entry);
            } else if (action === "delete") {
                openLedgerConfirm("确认删除这条记账记录？", () => deleteLedgerEntryById(entryId));
            }
        });

        document.getElementById("calendar-ledger-entry-kind")?.addEventListener("change", () => {
            const kind = String(document.getElementById("calendar-ledger-entry-kind")?.value || "expense");
            fillCalLedgerTagSelect(document.getElementById("calendar-ledger-entry-tag"), kind, null);
            const w = document.getElementById("calendar-ledger-entry-nature-wrap");
            if (w) w.style.display = kind === "expense" ? "" : "none";
        });
        document.getElementById("calendar-ledger-entry-cancel")?.addEventListener("click", closeLedgerEntryModal);
        document.getElementById("calendar-ledger-entry-save")?.addEventListener("click", () => {
            saveLedgerEntryModal();
        });
        document.getElementById("calendar-ledger-entry-modal")?.addEventListener("click", (e) => {
            if (e.target === document.getElementById("calendar-ledger-entry-modal")) closeLedgerEntryModal();
        });

        document.getElementById("calendar-ledger-confirm-cancel")?.addEventListener("click", closeLedgerConfirm);
        document.getElementById("calendar-ledger-confirm-ok")?.addEventListener("click", async () => {
            const fn = state.ledgerConfirmOnOk;
            closeLedgerConfirm();
            if (fn) await fn();
        });
        document.getElementById("calendar-ledger-confirm-modal")?.addEventListener("click", (e) => {
            if (e.target === document.getElementById("calendar-ledger-confirm-modal")) closeLedgerConfirm();
        });

        document.getElementById("calendar-diary-drawer-close")?.addEventListener("click", closeDiaryDrawer);
        document.getElementById("calendar-diary-drawer-overlay")?.addEventListener("click", closeDiaryDrawer);
        document.getElementById("calendar-diary-btn-cancel")?.addEventListener("click", closeDiaryDrawer);
        document.getElementById("calendar-diary-btn-submit")?.addEventListener("click", () => {
            submitDiaryFromDrawer();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            const ledgerConfirm = document.getElementById("calendar-ledger-confirm-modal");
            if (ledgerConfirm && !ledgerConfirm.classList.contains("hidden")) {
                closeLedgerConfirm();
                return;
            }
            const ledgerEntryModal = document.getElementById("calendar-ledger-entry-modal");
            if (ledgerEntryModal && !ledgerEntryModal.classList.contains("hidden")) {
                closeLedgerEntryModal();
                return;
            }
            const ledgerDrawer = document.getElementById("calendar-ledger-drawer");
            if (ledgerDrawer && ledgerDrawer.classList.contains("open")) {
                closeLedgerDrawer();
                return;
            }
            const diaryDrawer = document.getElementById("calendar-diary-drawer");
            if (diaryDrawer && diaryDrawer.classList.contains("open")) closeDiaryDrawer();
        });

        // 当其他页面（如 diary 页）保存后，跨页同步刷新当前日历视图。
        window.addEventListener("storage", (e) => {
            if (e.key !== "calendar-diary-updated" || !e.newValue) return;
            try {
                const payload = JSON.parse(e.newValue);
                const changedDate = String((payload && payload.date) || "");
                if (!changedDate) return;
                loadSummary(state.current);
                if (state.selectedDate === changedDate) {
                    loadDayDetail(changedDate);
                }
            } catch (_) {}
        });

        window.addEventListener("calendar-diary-updated", (e) => {
            const changedDate = String((e.detail && e.detail.date) || "");
            if (!changedDate) return;
            loadSummary(state.current);
            if (state.selectedDate === changedDate) {
                loadDayDetail(changedDate);
            }
        });

        // 右侧详情：打卡/提醒切换完成态（复用 /api/checkin/state，修改 records）
        document.getElementById("detail-panel")?.addEventListener("click", async (e) => {
            const item = e.target.closest(".detail-event-item");
            if (!item) return;
            const kind = item.getAttribute("data-kind");
            if (kind !== "checkin" && kind !== "reminder" && kind !== "todo") return;

            const dateStr = state.selectedDate;
            const eventId = item.getAttribute("data-id");
            if (!dateStr || !eventId) return;
            if (item.classList.contains("disabled")) return;
            if ((kind === "checkin" || kind === "reminder") && isFutureDate(dateStr)) {
                showToast("未来日期不可操作", "error");
                return;
            }

            try {
                if (kind === "todo") {
                    const st = String((state.dayDetail && state.dayDetail.server_today) || formatDate(new Date())).slice(
                        0,
                        10
                    );
                    if (String(dateStr || "") < st && item.classList.contains("checked")) {
                        showToast("过往日期的已完成待办不可修改", "error");
                        return;
                    }
                    const isCompleted = item.classList.contains("checked");
                    const newStatus = isCompleted ? "pending" : "done";
                    // 完成日记录「实际勾选日」用服务端今天，避免在 18 号格子里操作却写入 complete_date=18、却在 19 号才完成
                    const completeDateForApi = newStatus === "done" ? st : "";
                    const res = await fetch(`/api/todo-instances/${encodeURIComponent(eventId)}/status`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: newStatus, complete_date: completeDateForApi }),
                    });
                    const out = await res.json();
                    if (!out || !out.success) {
                        showToast((out && out.message) || "操作失败", "error");
                        return;
                    }
                    showToast("已更新");
                } else {
                    const snap = await ensureCheckinStateLoaded();
                    toggleRecordInSnapshot(snap, eventId, dateStr);
                    const ok = await saveCheckinSnapshot(snap);
                    if (!ok) return;
                    showToast("已更新");
                }
                // 刷新：当天抽屉 + 当月 summary（badge 会变化）
                await loadDayDetail(dateStr);
                await loadSummary(state.current);
            } catch (err) {
                console.error("toggle completed error", err);
                showToast("操作失败，请稍后重试", "error");
            }
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        if (window.ContentRecordViewDrawer) window.ContentRecordViewDrawer.init({ notify: showToast });
        bindEvents();
        loadLedgerRetentionMeta()
            .catch(() => {})
            .finally(() => {
                loadSummary(state.current).then(() => {
                    const todayStr = formatDate(new Date());
                    loadDayDetail(todayStr);
                });
            });
    });
})();


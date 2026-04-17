(function() {
    "use strict";
    const STORAGE_KEY = "checkin_data";
    const REMINDER_TYPES = [
        { value: "payment", label: "生活缴费", icon: "💰" },
        { value: "bill", label: "银行账单", icon: "🧾" },
        { value: "activity", label: "活动/演出", icon: "🎭" },
        { value: "sale", label: "开售抢购", icon: "🎫" },
        { value: "party", label: "聚会", icon: "🎉" },
        { value: "work", label: "工作", icon: "💼" },
        { value: "normal", label: "普通", icon: "🔔" }
    ];

    function getIconForReminderType(reminderType) {
        const t = REMINDER_TYPES.find(r => r.value === reminderType);
        return t ? t.icon : "🔔";
    }

    function getDateTypeForReminderType(reminderType) {
        if (reminderType === "bill" || reminderType === "payment") return "monthly";
        if (reminderType === "sale" || reminderType === "activity" || reminderType === "party") return "specific";
        return null;
    }

    function updateReminderFormByType() {
        const reminderType = document.getElementById("reminder-type")?.value || "normal";
        const dateTypeEl = document.getElementById("reminder-date-type");
        const iconEl = document.getElementById("reminder-type-icon");

        if (iconEl) iconEl.textContent = getIconForReminderType(reminderType);

        const forcedDateType = getDateTypeForReminderType(reminderType);
        if (forcedDateType && dateTypeEl) {
            dateTypeEl.value = forcedDateType;
            dateTypeEl.disabled = true;
        } else if (dateTypeEl) {
            dateTypeEl.disabled = false;
        }
        updateReminderDateFields();
    }

    function updateReminderDateFields() {
        const type = document.getElementById("reminder-date-type")?.value || "specific";
        const spec = document.getElementById("reminder-specific-fields");
        const mon = document.getElementById("reminder-monthly-fields");
        if (spec) spec.style.display = type === "specific" ? "" : "none";
        if (mon) mon.style.display = type === "monthly" ? "" : "none";
    }

    function updateLabelDateFields() {
        const type = document.getElementById("label-type")?.value || "annual";
        const spec = document.getElementById("label-specific-fields");
        const ann = document.getElementById("label-annual-fields");
        const annRange = document.getElementById("label-annual-range-fields");
        if (spec) spec.style.display = type === "specific" ? "" : "none";
        if (ann) ann.style.display = type === "annual" ? "" : "none";
        if (annRange) annRange.style.display = type === "annual" ? "" : "none";
        requestAnimationFrame(() => {
            if (typeof window.refreshUiSelectComboboxVisibility === "function") {
                window.refreshUiSelectComboboxVisibility();
            }
        });
    }

    function initCustomSelects(root) {
        root = root || document;
        root.querySelectorAll(".custom-select-trigger").forEach(trigger => {
            if (trigger._customSelectInit) return;
            trigger._customSelectInit = true;
            const wrap = trigger.closest(".custom-select-wrap");
            const dropdown = wrap?.querySelector(".custom-select-dropdown");
            const select = wrap?.querySelector(".custom-select-hidden");
            if (!wrap || !dropdown || !select) return;
            trigger.addEventListener("click", (e) => {
                e.stopPropagation();
                document.querySelectorAll(".custom-select-dropdown.open").forEach(d => {
                    if (d !== dropdown) d.classList.remove("open");
                });
                dropdown.classList.toggle("open");
            });
            dropdown.querySelectorAll(".custom-select-option").forEach(opt => {
                opt.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const val = opt.dataset.value || "";
                    const text = opt.textContent || "";
                    select.value = val;
                    trigger.textContent = text;
                    dropdown.classList.remove("open");
                });
            });
        });
        const syncTriggerFromSelect = (selectEl) => {
            const wrap = selectEl?.closest(".custom-select-wrap");
            const trigger = wrap?.querySelector(".custom-select-trigger");
            const opt = wrap?.querySelector(`.custom-select-option[data-value="${selectEl.value}"]`);
            if (trigger && opt) trigger.textContent = opt.textContent;
        };
        root.querySelectorAll(".custom-select-hidden").forEach(sel => {
            syncTriggerFromSelect(sel);
        });
    }

    /* 打卡数据和事件数据存储在 localStorage，仅通过用户操作（取消打卡、删除事件）修改，不会自动删除 */

    const DEFAULT_MONTHLY_START = "2025-01-01";
    const DEFAULT_MONTHLY_END = "2028-12-31";
    const DEFAULT_LABEL_ANNUAL_START = "1900-01-01";
    const DEFAULT_LABEL_ANNUAL_END = "2099-12-31";

    /** 与后端 _checkin_state_snapshot_has_data 一致：是否有事件/记录/有效日期标签 */
    function hasCheckinDataSnapshot(data) {
        if (!data || typeof data !== "object") return false;
        const ev = data.events || [];
        const rec = data.records || [];
        if (ev.length > 0 || rec.length > 0) return true;
        const dl = data.dateLabels || {};
        const spec = dl.specific || {};
        const ann = dl.annual || {};
        return Object.keys(spec).length > 0 || Object.keys(ann).length > 0;
    }

    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                const events = (data.events || []).map(evt => {
                    const base = {
                        ...evt,
                        type: evt.type || "checkin",
                        dateStart: evt.dateStart || null,
                        dateEnd: evt.dateEnd || null
                    };
                    if (base.type === "reminder" && base.dateType === "monthly") {
                        base.monthlyStartDate = base.monthlyStartDate || DEFAULT_MONTHLY_START;
                        base.monthlyEndDate = base.monthlyEndDate || DEFAULT_MONTHLY_END;
                    }
                    return base;
                });
                const dateLabels = migrateDateLabels(data.dateLabels || {});
                return {
                    events,
                    records: data.records || [],
                    dateLabels
                };
            }
        } catch (e) { console.warn("loadData error", e); }
        return { events: [], records: [], dateLabels: { specific: {}, annual: {} } };
    }

    function normalizeLabelEntry(v) {
        const norm = (x) => ({
            name: x?.name || "",
            addType: x?.addType || "custom",
            annualStartDate: x?.annualStartDate || DEFAULT_LABEL_ANNUAL_START,
            annualEndDate: x?.annualEndDate || DEFAULT_LABEL_ANNUAL_END
        });
        if (Array.isArray(v)) return v.map(norm);
        if (v && typeof v === "object" && v.name) return [norm(v)];
        if (typeof v === "string") return [norm({ name: v, addType: "custom" })];
        return [];
    }

    function migrateDateLabels(old) {
        if (!old || typeof old !== "object") return { specific: {}, annual: {} };
        const result = { specific: {}, annual: {} };
        const hasNewFormat = old.specific !== undefined || old.annual !== undefined;
        if (hasNewFormat) {
            for (const [k, v] of Object.entries(old.specific || {})) {
                result.specific[k] = normalizeLabelEntry(v);
            }
            for (const [k, v] of Object.entries(old.annual || {})) {
                result.annual[k] = normalizeLabelEntry(v);
            }
            return result;
        }
        for (const [dateStr, name] of Object.entries(old)) {
            if (!dateStr || !name) continue;
            const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
            if (m) {
                const mmdd = m[1] + "-" + m[2];
                result.annual[mmdd] = [{ name: String(name), addType: "custom" }];
            }
        }
        return result;
    }

    async function saveDataToServer(data) {
        try {
            await fetch("/api/checkin/state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
        } catch (e) {
            console.warn("saveDataToServer error", e);
        }
    }

    function saveData(data) {
        /* 仅覆盖写入，不调用 removeItem/clear，数据持久保存；同时同步到服务端 */
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn("localStorage saveData error", e);
        }
        // Fire-and-forget 同步到服务端
        saveDataToServer(data);
    }

    function genId() {
        return "evt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    }

    function formatDate(d) {
        if (typeof d === "string") return d.split("T")[0] || d;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function formatDateDisplay(dateStr) {
        if (!dateStr) return "";
        const [y, m, d] = dateStr.split("-");
        return `${y}年${m}月${d}日`;
    }

    function isEventActiveForDate(evt, dateStr) {
        if (!evt.dateStart && !evt.dateEnd) return true;
        if (evt.dateStart && dateStr < evt.dateStart) return false;
        if (evt.dateEnd && dateStr > evt.dateEnd) return false;
        return true;
    }

    function countEventActiveDaysInMonth(evt, y, m) {
        if (!evt.dateStart && !evt.dateEnd) return new Date(y, m, 0).getDate();
        const firstOfMonth = `${y}-${String(m).padStart(2,"0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const lastOfMonth = `${y}-${String(m).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;
        const start = evt.dateStart ? (evt.dateStart > lastOfMonth ? null : (evt.dateStart < firstOfMonth ? firstOfMonth : evt.dateStart)) : firstOfMonth;
        const end = evt.dateEnd ? (evt.dateEnd < firstOfMonth ? null : (evt.dateEnd > lastOfMonth ? lastOfMonth : evt.dateEnd)) : lastOfMonth;
        if (!start || !end || start > end) return 0;
        const [sy, sm, sd] = start.split("-").map(Number);
        const [ey, em, ed] = end.split("-").map(Number);
        const d1 = new Date(sy, sm - 1, sd);
        const d2 = new Date(ey, em - 1, ed);
        return Math.floor((d2 - d1) / 86400000) + 1;
    }

    function escapeHtml(s) {
        if (s == null) return "";
        const div = document.createElement("div");
        div.textContent = String(s);
        return div.innerHTML;
    }

    function parseColorToHex(str) {
        if (!str || typeof str !== "string") return null;
        const s = str.trim();
        if (/^#[0-9a-fA-F]{3}$/.test(s)) {
            const r = s[1] + s[1], g = s[2] + s[2], b = s[3] + s[3];
            return "#" + r + g + b;
        }
        if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
        const rgb = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
        if (rgb) {
            const hex = (n) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0");
            return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
        }
        return null;
    }

    function toast(msg, type) {
        const el = document.getElementById("toast");
        if (!el) return;
        el.textContent = msg;
        el.className = "toast-" + (type || "info");
        el.classList.add("show");
        clearTimeout(el._toastTimer);
        el._toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
    }

    let state = {
        data: loadData(),
        activePage: "events",
        eventTypeTab: "checkin",
        reminderTypeFilter: "",
        reminderValidityFilter: "valid",
        checkinValidityFilter: "valid",
        holidays: {},
        calendarDate: new Date(),
        selectedDate: formatDate(new Date()),
        editingId: null,
        editingIds: new Set(),
        statsSelectedEventId: null,
        deleteEventId: null,
        deleteLabelTarget: null,
        editingLabelKeys: new Set(),
        dateLabelFilter: "custom"
    };

    function getCheckinEvents() {
        return state.data.events.filter(e => e.type === "checkin");
    }

    function isReminderExpired(evt) {
        const today = formatDate(new Date());
        if (evt.dateType === "specific") {
            const eventDate = evt.specificDate || "";
            if (!eventDate) return false;
            return today > eventDate;
        }
        if (evt.dateType === "monthly") {
            const endDate = evt.monthlyEndDate || DEFAULT_MONTHLY_END;
            return today > endDate;
        }
        return false;
    }

    function isCheckinExpired(evt) {
        const dateEnd = evt.dateEnd || "";
        if (!dateEnd) return false;
        const today = formatDate(new Date());
        return today > dateEnd;
    }

    function getLabelsForDate(dateStr) {
        const out = [];
        if (!dateStr) return out;
        const labels = state.data.dateLabels || { specific: {}, annual: {} };
        const specific = labels.specific?.[dateStr];
        if (Array.isArray(specific)) {
            out.push(...specific.filter(x => x && x.name));
        } else if (specific) {
            out.push({ name: String(specific), addType: "custom" });
        }
        const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})$/);
        if (m) {
            const [, mm, dd] = m;
            const mmdd = mm + "-" + dd;
            const isInAnnualRange = (item) => {
                const start = item?.annualStartDate || DEFAULT_LABEL_ANNUAL_START;
                const end = item?.annualEndDate || DEFAULT_LABEL_ANNUAL_END;
                return dateStr >= start && dateStr <= end;
            };
            let annual = labels.annual?.[mmdd];
            if (Array.isArray(annual)) {
                out.push(...annual.filter(x => x && x.name && isInAnnualRange(x)));
            } else if (annual) {
                const item = typeof annual === "object" ? annual : { name: String(annual), addType: "custom" };
                if (isInAnnualRange(item)) out.push(item);
            } else {
                const [y, mo, day] = dateStr.split("-").map(Number);
                const lastDay = new Date(y, mo, 0).getDate();
                if (day === lastDay && lastDay < 31) {
                    for (let d = lastDay + 1; d <= 31; d++) {
                        const key = mm + "-" + String(d).padStart(2, "0");
                        annual = labels.annual?.[key];
                        if (Array.isArray(annual)) out.push(...annual.filter(x => x && x.name && isInAnnualRange(x)));
                        else if (annual) {
                            const item = typeof annual === "object" ? annual : { name: String(annual), addType: "custom" };
                            if (isInAnnualRange(item)) out.push(item);
                        }
                    }
                }
            }
        }
        const holiday = state.holidays[dateStr];
        if (holiday && !out.some(x => x.name === holiday)) out.push({ name: holiday, addType: "sync" });
        return out.sort((a, b) => (a.addType === "custom" ? 0 : 1) - (b.addType === "custom" ? 0 : 1));
    }

    function getFilteredEvents() {
        let list = state.data.events.filter(e => e.type === state.eventTypeTab);
        if (state.eventTypeTab === "checkin") {
            if (state.checkinValidityFilter === "valid") {
                list = list.filter(e => !isCheckinExpired(e));
            } else if (state.checkinValidityFilter === "expired") {
                list = list.filter(e => isCheckinExpired(e));
            }
        }
        if (state.eventTypeTab === "reminder") {
            if (state.reminderTypeFilter) {
                list = list.filter(e => (e.reminderType || "normal") === state.reminderTypeFilter);
            }
            if (state.reminderValidityFilter === "valid") {
                list = list.filter(e => !isReminderExpired(e));
            } else if (state.reminderValidityFilter === "expired") {
                list = list.filter(e => isReminderExpired(e));
            }
            return list.slice().sort((a, b) => {
                const typeOrderA = REMINDER_TYPES.findIndex(t => t.value === (a.reminderType || "normal"));
                const typeOrderB = REMINDER_TYPES.findIndex(t => t.value === (b.reminderType || "normal"));
                const typeA = typeOrderA >= 0 ? typeOrderA : 999;
                const typeB = typeOrderB >= 0 ? typeOrderB : 999;
                if (typeA !== typeB) return typeA - typeB;
                if (a.dateType === "monthly" && b.dateType === "monthly") {
                    const dA = a.dayOfMonth != null ? Math.max(1, Math.min(31, parseInt(a.dayOfMonth, 10))) : 31;
                    const dB = b.dayOfMonth != null ? Math.max(1, Math.min(31, parseInt(b.dayOfMonth, 10))) : 31;
                    return dA - dB;
                }
                if (a.dateType === "specific" && b.dateType === "specific") {
                    const dateA = (a.specificDate || "9999-12-31").replace(/-/g, "");
                    const dateB = (b.specificDate || "9999-12-31").replace(/-/g, "");
                    if (dateA !== dateB) return parseInt(dateA, 10) - parseInt(dateB, 10);
                    const hA = a.hour != null ? parseInt(a.hour, 10) : 0;
                    const hB = b.hour != null ? parseInt(b.hour, 10) : 0;
                    if (hA !== hB) return hA - hB;
                    const mA = a.minute != null ? parseInt(a.minute, 10) : 0;
                    const mB = b.minute != null ? parseInt(b.minute, 10) : 0;
                    return mA - mB;
                }
                const keyA = a.dateType === "monthly" ? 1000000000 + (a.dayOfMonth ?? 31) : parseInt((a.specificDate || "9999-12-31").replace(/-/g, ""), 10);
                const keyB = b.dateType === "monthly" ? 1000000000 + (b.dayOfMonth ?? 31) : parseInt((b.specificDate || "9999-12-31").replace(/-/g, ""), 10);
                return keyA - keyB;
            });
        }
        return list;
    }

    function getActiveEventsForDate(dateStr) {
        if (!dateStr) return [];
        return getCheckinEvents().filter(evt => isEventActiveForDate(evt, dateStr));
    }

    function getRemindersForDate(dateStr) {
        if (!dateStr) return [];
        const reminders = state.data.events.filter(e => e.type === "reminder");
        return reminders.filter(evt => {
            if (evt.dateType === "specific") return (evt.specificDate || "") === dateStr;
            if (evt.dateType === "monthly") {
                const day = parseInt(dateStr.split("-")[2], 10);
                if (evt.dayOfMonth == null || parseInt(evt.dayOfMonth, 10) !== day) return false;
                const start = evt.monthlyStartDate || DEFAULT_MONTHLY_START;
                const end = evt.monthlyEndDate || DEFAULT_MONTHLY_END;
                return dateStr >= start && dateStr <= end;
            }
            return false;
        });
    }

    function getStats() {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const lastDay = new Date(y, m, 0);
        const daysInMonth = lastDay.getDate();
        const checkinRecords = getCheckinRecords();
        const monthRecords = checkinRecords.filter(r => {
            const [ry, rm] = r.date.split("-").map(Number);
            return ry === y && rm === m;
        });
        const uniqueDays = new Set(monthRecords.map(r => r.date));
        const monthlyRate = daysInMonth > 0 ? Math.round((uniqueDays.size / daysInMonth) * 100) : 0;
        let streak = 0;
        const todayStr = formatDate(now);
        const allDates = [...new Set(checkinRecords.map(r => r.date))].sort();
        let checkDate = new Date(todayStr);
        while (true) {
            const dStr = formatDate(checkDate);
            if (allDates.includes(dStr)) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else break;
        }
        const taskRates = getCheckinEvents().map(evt => {
            const count = monthRecords.filter(r =>
                r.eventId === evt.id && isEventActiveForDate(evt, r.date)
            ).length;
            const daysActive = countEventActiveDaysInMonth(evt, y, m);
            const pct = daysActive > 0 ? Math.round((count / daysActive) * 100) : 0;
            return { evt, pct };
        });
        return { monthlyRate, streak, taskRates };
    }

    function isChecked(eventId, dateStr) {
        return state.data.records.some(r => r.eventId === eventId && r.date === dateStr);
    }

    function getCheckinRecords() {
        const checkinIds = new Set(getCheckinEvents().map(e => e.id));
        return state.data.records.filter(r => checkinIds.has(r.eventId));
    }

    function toggleCheck(eventId) {
        const idx = state.data.records.findIndex(r => r.eventId === eventId && r.date === state.selectedDate);
        if (idx >= 0) state.data.records.splice(idx, 1);
        else state.data.records.push({ eventId, date: state.selectedDate });
        saveData(state.data);
        showDetailPanel(state.selectedDate);
    }

    function renderCalendar() {
        const grid = document.getElementById("calendar-grid");
        const titleEl = document.getElementById("calendar-title");
        if (!grid || !titleEl) return;

        const d = state.calendarDate;
        const y = d.getFullYear();
        const m = d.getMonth();
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const startWeekday = (firstDay.getDay() + 6) % 7;
        const daysInMonth = lastDay.getDate();

        titleEl.textContent = `${y}年${m + 1}月`;

        const todayStr = formatDate(new Date());
        const cells = [];

        const prevMonth = m === 0 ? 11 : m - 1;
        const prevYear = m === 0 ? y - 1 : y;
        const prevLastDay = new Date(prevYear, prevMonth + 1, 0).getDate();

        for (let i = 0; i < startWeekday; i++) {
            const dayNum = prevLastDay - startWeekday + i + 1;
            const dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2,"0")}-${String(dayNum).padStart(2,"0")}`;
            cells.push({ dateStr, dayNum, otherMonth: true });
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = `${y}-${String(m + 1).padStart(2,"0")}-${String(i).padStart(2,"0")}`;
            cells.push({ dateStr, dayNum: i, otherMonth: false });
        }

        const remaining = 42 - cells.length;
        const nextMonth = m === 11 ? 0 : m + 1;
        const nextYear = m === 11 ? y + 1 : y;
        for (let i = 1; i <= remaining; i++) {
            const dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2,"0")}-${String(i).padStart(2,"0")}`;
            cells.push({ dateStr, dayNum: i, otherMonth: true });
        }

        grid.innerHTML = cells.map(c => {
            const dayRecordsForDate = state.data.records.filter(r => r.date === c.dateStr);
            const checked = dayRecordsForDate
                .map(r => state.data.events.find(e => e.id === r.eventId))
                .filter(evt => evt && evt.type === "checkin" && isEventActiveForDate(evt, c.dateStr));

            const cls = [
                "calendar-day",
                c.otherMonth ? "other-month" : "",
                c.dateStr === todayStr ? "today" : "",
                c.dateStr === state.selectedDate ? "selected" : "",
                c.dateStr < todayStr ? "past" : ""
            ].filter(Boolean).join(" ");

            /* 只显示当日已完成打卡的圆标，不显示未完成的 */
            const dotsHtml = checked.length > 0
                ? checked.filter(evt => evt && evt.color).map(evt => `<span class="dot" style="background:${evt.color}"></span>`).join("")
                : "";

            const labels = getLabelsForDate(c.dateStr);
            const reminders = getRemindersForDate(c.dateStr);
            const labelIcon = (addType) => addType === "sync" ? "☁️" : "🏷️";

            // 按顺序组装单元格中的标签/提醒行：自定义标签 -> 同步标签 -> 事件提醒，上限 3 条
            const customLabels = labels.filter(l => l.addType !== "sync");
            const syncLabels = labels.filter(l => l.addType === "sync");
            const itemsHtml = [];

            const pushLabelRows = (arr) => {
                for (const l of arr) {
                    if (itemsHtml.length >= 3) break;
                    itemsHtml.push(
                        `<div class="day-label-row"><span class="day-label-icon" aria-hidden="true">${labelIcon(l.addType)}</span><span class="day-label">${escapeHtml(l.name)}</span></div>`
                    );
                }
            };

            pushLabelRows(customLabels);
            if (itemsHtml.length < 3) pushLabelRows(syncLabels);

            if (itemsHtml.length < 3) {
                for (const evt of reminders) {
                    if (itemsHtml.length >= 3) break;
                    const completed = isChecked(evt.id, c.dateStr);
                    const icon = completed ? "✓" : getIconForReminderType(evt.reminderType || "normal");
                    const iconClass = completed ? "day-reminder-icon day-reminder-icon-completed" : "day-reminder-icon";
                    itemsHtml.push(
                        `<div class="day-reminder-row"><span class="${iconClass}" aria-hidden="true">${icon}</span><span class="day-reminder-name">${escapeHtml(evt.name || "")}</span></div>`
                    );
                }
            }

            const cellRowsHtml = itemsHtml.join("");
            return `<div class="${cls}" data-date="${c.dateStr}">
                <div class="day-top-row">
                    <div class="day-dots">${dotsHtml}</div>
                    <div class="day-top-right">
                        <span class="day-num">${c.dayNum}</span>
                    </div>
                </div>
                ${cellRowsHtml}
            </div>`;
        }).join("");
    }

    function showDetailPanel(dateStr) {
        const titleEl = document.getElementById("detail-title");
        const panelEl = document.getElementById("detail-panel");
        if (!titleEl || !panelEl) return;

        const todayStr = formatDate(new Date());
        const isFutureDate = dateStr > todayStr;

        state.selectedDate = dateStr;
        renderCalendar();

        titleEl.textContent = formatDateDisplay(dateStr);

        const labels = getLabelsForDate(dateStr);
        const activeEvents = getActiveEventsForDate(dateStr);
        const reminders = getRemindersForDate(dateStr);

        const labelsHtml = labels.length > 0
            ? `<div class="detail-labels-row">
                ${labels.map(l => `<span class="detail-label-tag">${escapeHtml(l.name)}</span>`).join("")}
               </div>`
            : "";

        const checkinHtml = `
            <div class="detail-section">
                <h4 class="detail-section-title">打卡</h4>
                <div class="detail-section-content">
                    ${activeEvents.length === 0
                        ? '<p class="add-event-hint">当日没有打卡事件。</p>'
                        : activeEvents.map(evt => {
                            const checked = isChecked(evt.id, dateStr);
                            const disabledClass = isFutureDate ? " disabled" : "";
                            return `<div class="detail-event-item ${checked ? "checked" : ""}${disabledClass}" data-event-id="${evt.id}" data-disabled="${isFutureDate}">
                                <span class="dot" style="background:${evt.color}"></span>
                                <div class="detail-event-item-content-wrap">
                                    <span class="detail-event-item-name">${evt.name}</span>
                                </div>
                                ${checked ? '<span class="detail-complete-icon" aria-hidden="true">✓</span>' : ''}
                            </div>`;
                        }).join("")}
                </div>
            </div>`;

        const reminderHtml = `
            <div class="detail-section">
                <h4 class="detail-section-title">提醒</h4>
                <div class="detail-section-content">
                    ${reminders.length === 0
                        ? '<p class="add-event-hint">当日暂无提醒。</p>'
                        : reminders.map(evt => {
                            const checked = isChecked(evt.id, dateStr);
                            const disabledClass = isFutureDate ? " disabled" : "";
                            const icon = getIconForReminderType(evt.reminderType || "normal");
                            const timeStr = evt.dateType === "specific" && (evt.hour != null || evt.minute != null)
                                ? (String(evt.hour ?? 0).padStart(2, "0") + ":" + String(evt.minute ?? 0).padStart(2, "0") + " ")
                                : "";
                            const displayText = timeStr + (evt.name || "");
                            return `<div class="detail-event-item detail-reminder-item ${checked ? "checked" : ""}${disabledClass}" data-event-id="${evt.id}" data-disabled="${isFutureDate}">
                                <span class="detail-reminder-icon" aria-hidden="true">${icon}</span>
                                <div class="detail-event-item-content-wrap">
                                    <span class="detail-event-item-name">${escapeHtml(displayText)}</span>
                                </div>
                                ${checked ? '<span class="detail-complete-icon" aria-hidden="true">✓</span>' : ''}
                            </div>`;
                        }).join("")}
                </div>
            </div>`;

        panelEl.innerHTML = labelsHtml + checkinHtml + reminderHtml;

        panelEl.querySelectorAll(".detail-event-item").forEach(el => {
            el.addEventListener("click", () => {
                if (el.dataset.disabled === "true") return;
                const id = el.dataset.eventId;
                if (id) toggleCheck(id);
            });
        });
    }

    function labelKeyStr(type, key, index) {
        return `${type}:${key}:${index}`;
    }

    function syncEditingLabelsToState() {
        const listEl = document.getElementById("event-list");
        if (!listEl) return;
        listEl.querySelectorAll(".event-item-label-editing").forEach(row => {
            const origType = row.dataset.type;
            const origKey = row.dataset.key;
            const origIndex = parseInt(row.dataset.index, 10) || 0;
            const typeSelect = row.querySelector(".edit-inline-label-type");
            const nameIn = row.querySelector(".edit-inline-label-name");
            const dateIn = row.querySelector(".edit-inline-label-date");
            const monthSelect = row.querySelector(".edit-inline-label-month");
            const daySelect = row.querySelector(".edit-inline-label-day");
            const annStartIn = row.querySelector(".edit-inline-label-annual-start");
            const annEndIn = row.querySelector(".edit-inline-label-annual-end");
            const labelType = typeSelect?.value || "annual";
            const name = (nameIn?.value || "").trim();
            if (!name) return;
            const addType = (() => {
                const arr = origType === "specific" ? (state.data.dateLabels?.specific?.[origKey]) : (state.data.dateLabels?.annual?.[origKey]);
                const item = Array.isArray(arr) ? arr[origIndex] : null;
                return item?.addType || "custom";
            })();
            if (!state.data.dateLabels) state.data.dateLabels = { specific: {}, annual: {} };
            if (labelType === "specific") {
                const dateStr = dateIn?.value;
                if (!dateStr) return;
                const arr = state.data.dateLabels.specific?.[origKey];
                if (Array.isArray(arr) && arr[origIndex]) {
                    arr[origIndex] = { name, addType };
                }
            } else {
                const month = monthSelect?.value;
                const day = daySelect?.value;
                if (!month || !day) return;
                const mm = String(parseInt(month, 10)).padStart(2, "0");
                const dd = String(parseInt(day, 10)).padStart(2, "0");
                const mmdd = mm + "-" + dd;
                const annualStart = annStartIn?.value || DEFAULT_LABEL_ANNUAL_START;
                const annualEnd = annEndIn?.value || DEFAULT_LABEL_ANNUAL_END;
                const arr = state.data.dateLabels.annual?.[origKey];
                if (Array.isArray(arr) && arr[origIndex]) {
                    arr[origIndex] = { name, addType, annualStartDate: annualStart, annualEndDate: annualEnd };
                }
            }
        });
    }

    function renderLabelsList(listEl, titleEl) {
        titleEl.textContent = "日期标签列表";
        const labels = state.data.dateLabels || { specific: {}, annual: {} };
        const specificEntries = [];
        for (const [k, v] of Object.entries(labels.specific || {})) {
            const arr = Array.isArray(v) ? v : (v ? [{ name: String(v), addType: "custom" }] : []);
            arr.forEach((item, i) => specificEntries.push({ type: "specific", key: k, index: i, name: item.name, addType: item.addType }));
        }
        const annualEntries = [];
        for (const [k, v] of Object.entries(labels.annual || {})) {
            const arr = Array.isArray(v) ? v : (v ? [{ name: String(v), addType: "custom" }] : []);
            arr.forEach((item, i) => annualEntries.push({
                type: "annual", key: k, index: i, name: item.name, addType: item.addType,
                annualStartDate: item.annualStartDate || DEFAULT_LABEL_ANNUAL_START,
                annualEndDate: item.annualEndDate || DEFAULT_LABEL_ANNUAL_END
            }));
        }
        let entries = [...specificEntries, ...annualEntries].sort((a, b) => {
            const sortKeyA = a.type === "specific" ? a.key : "9999-" + a.key;
            const sortKeyB = b.type === "specific" ? b.key : "9999-" + b.key;
            const cmp = sortKeyA.localeCompare(sortKeyB);
            if (cmp !== 0) return cmp;
            return a.index - b.index;
        });
        const filter = state.dateLabelFilter || "custom";
        entries = entries.filter(e => e.addType === filter);
        if (entries.length === 0) {
            const emptyMsg = filter === "custom" ? "暂无自定义日期标签，请先添加" : "暂无同步日期标签";
            listEl.innerHTML = `<p class="empty-state">${emptyMsg}</p>`;
            return;
        }
        const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1)
            .map(m => `<div class="custom-select-option" data-value="${m}">${m}</div>`).join("");
        const dayOpts = Array.from({ length: 31 }, (_, i) => i + 1)
            .map(d => `<div class="custom-select-option" data-value="${d}">${d}</div>`).join("");
        if (state.editingLabelKeys.size > 0) {
            syncEditingLabelsToState();
        }
        listEl.innerHTML = entries.map(({ type, key, index, name, addType, annualStartDate, annualEndDate }) => {
            const isEditing = state.editingLabelKeys.has(labelKeyStr(type, key, index));
            if (isEditing) {
                const [mm, dd] = type === "annual" ? key.split("-") : ["", ""];
                const specDisplay = type === "specific" ? "" : "none";
                const annDisplay = type === "annual" ? "" : "none";
                const dateVal = type === "specific" ? key : "";
                const monthVal = mm ? parseInt(mm, 10) : "";
                const dayVal = dd ? parseInt(dd, 10) : "";
                const annStart = type === "annual" ? (annualStartDate || DEFAULT_LABEL_ANNUAL_START) : "";
                const annEnd = type === "annual" ? (annualEndDate || DEFAULT_LABEL_ANNUAL_END) : "";
                const typeOpts = `<option value="annual" ${type === "annual" ? "selected" : ""}>每年固定日期</option><option value="specific" ${type === "specific" ? "selected" : ""}>指定日期</option>`;
                return `
            <div class="event-item event-item-label-editing" data-type="${type}" data-key="${escapeHtml(key)}" data-index="${index}">
                <div class="event-form-checkin-row event-form-labels-row event-list-edit-row">
                    <div class="event-form-field">
                        <select class="event-form-select edit-inline-label-type">
                            ${typeOpts}
                        </select>
                    </div>
                    <div class="event-form-field-group edit-inline-label-specific" style="display:${specDisplay}">
                        <div class="event-form-field">
                            <input type="date" class="edit-inline-label-date" value="${escapeHtml(dateVal)}">
                        </div>
                    </div>
                    <div class="event-form-field-group edit-inline-label-annual" style="display:${annDisplay}">
                        <div class="event-form-field">
                            <div class="custom-select-wrap">
                                <div class="custom-select-trigger edit-inline-label-month-trigger" data-target="edit-inline-label-month">月</div>
                                <div class="custom-select-dropdown edit-inline-label-month-dropdown">
                                    <div class="custom-select-option" data-value="">月</div>${monthOpts}
                                </div>
                                <select class="event-form-select custom-select-hidden edit-inline-label-month" aria-hidden="true">
                                    <option value="">月</option>
                                    ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}">${m}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                        <div class="event-form-field">
                            <div class="custom-select-wrap">
                                <div class="custom-select-trigger edit-inline-label-day-trigger" data-target="edit-inline-label-day">日</div>
                                <div class="custom-select-dropdown edit-inline-label-day-dropdown">
                                    <div class="custom-select-option" data-value="">日</div>${dayOpts}
                                </div>
                                <select class="event-form-select custom-select-hidden edit-inline-label-day" aria-hidden="true">
                                    <option value="">日</option>
                                    ${Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}">${d}</option>`).join("")}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="event-form-field">
                        <input type="text" class="edit-inline-label-name" value="${escapeHtml(name)}" placeholder="如：国庆节">
                    </div>
                    <div class="event-form-field-group edit-inline-label-annual-range" style="display:${annDisplay}">
                        <div class="event-form-field">
                            <input type="date" class="edit-inline-label-annual-start" value="${escapeHtml(annStart)}" placeholder="生效开始日期">
                        </div>
                        <div class="event-form-field">
                            <input type="date" class="edit-inline-label-annual-end" value="${escapeHtml(annEnd)}" placeholder="生效结束日期">
                        </div>
                    </div>
                    <button type="button" class="btn primary edit-inline-label-save">保存</button>
                    <button type="button" class="btn btn-ghost edit-inline-label-cancel">取消</button>
                </div>
            </div>`;
            }
            const displayKey = type === "specific" ? key : "每年 " + key;
            const addTypeIcon = addType === "sync" ? "☁️" : "🏷️";
            const rangeText = type === "annual" && (annualStartDate || annualEndDate)
                ? ` ${annualStartDate || DEFAULT_LABEL_ANNUAL_START} ~ ${annualEndDate || DEFAULT_LABEL_ANNUAL_END}`
                : "";
            const editBtn = addType === "sync" ? "" : `<button type="button" class="btn-ghost" data-action="edit-label" data-type="${type}" data-key="${escapeHtml(key)}" data-index="${index}">编辑</button>`;
            return `
            <div class="event-item" data-type="${type}" data-key="${escapeHtml(key)}" data-index="${index}">
                <span class="event-item-name"><span class="label-type-icon" aria-hidden="true">${addTypeIcon}</span><span class="event-item-name-text">${escapeHtml(displayKey)} ${escapeHtml(name)}${rangeText ? `<span class="label-range-text">${escapeHtml(rangeText)}</span>` : ""}</span></span>
                <div class="event-item-actions">
                    ${editBtn}
                    <button type="button" class="btn-edit-event" data-action="delete-label" data-type="${type}" data-key="${escapeHtml(key)}" data-index="${index}">删除</button>
                </div>
            </div>
        `;
        }).join("");

        initCustomSelects(document.getElementById("event-form-labels"));
        initCustomSelects(listEl);

        listEl.querySelectorAll(".event-item-label-editing").forEach(row => {
            const typeSelect = row.querySelector(".edit-inline-label-type");
            const specFields = row.querySelector(".edit-inline-label-specific");
            const annFields = row.querySelector(".edit-inline-label-annual");
            const annRangeFields = row.querySelector(".edit-inline-label-annual-range");
            const dateIn = row.querySelector(".edit-inline-label-date");
            const monthSelect = row.querySelector(".edit-inline-label-month");
            const daySelect = row.querySelector(".edit-inline-label-day");
            const nameIn = row.querySelector(".edit-inline-label-name");
            const annStartIn = row.querySelector(".edit-inline-label-annual-start");
            const annEndIn = row.querySelector(".edit-inline-label-annual-end");
            const origType = row.dataset.type;
            const origKey = row.dataset.key;
            const origIndex = parseInt(row.dataset.index, 10) || 0;

            function toggleLabelEditFields() {
                const t = typeSelect?.value || "annual";
                if (specFields) specFields.style.display = t === "specific" ? "" : "none";
                if (annFields) annFields.style.display = t === "annual" ? "" : "none";
                if (annRangeFields) annRangeFields.style.display = t === "annual" ? "" : "none";
            }
            typeSelect?.addEventListener("change", toggleLabelEditFields);

            if (origType === "annual" && origKey) {
                const [mm, dd] = origKey.split("-");
                if (mm) monthSelect.value = String(parseInt(mm, 10));
                if (dd) daySelect.value = String(parseInt(dd, 10));
                row.querySelectorAll(".custom-select-wrap").forEach(wrap => {
                    const sel = wrap.querySelector(".custom-select-hidden");
                    const trigger = wrap.querySelector(".custom-select-trigger");
                    const opt = wrap.querySelector(`.custom-select-option[data-value="${sel?.value}"]`);
                    if (trigger && opt) trigger.textContent = opt.textContent;
                });
            }

            row.querySelector(".edit-inline-label-save")?.addEventListener("click", () => {
                const name = (nameIn?.value || "").trim();
                if (!name) { toast("请填写必填项。", "info"); return; }
                const labelType = typeSelect?.value || "annual";
                if (!state.data.dateLabels) state.data.dateLabels = { specific: {}, annual: {} };
                const addType = (() => {
                    const arr = origType === "specific" ? (state.data.dateLabels.specific?.[origKey]) : (state.data.dateLabels.annual?.[origKey]);
                    const item = Array.isArray(arr) ? arr[origIndex] : null;
                    return item?.addType || "custom";
                })();
                const entry = { name, addType };
                if (origType === "specific" && state.data.dateLabels.specific) {
                    const arr = state.data.dateLabels.specific[origKey];
                    if (Array.isArray(arr)) {
                        arr.splice(origIndex, 1);
                        if (arr.length === 0) delete state.data.dateLabels.specific[origKey];
                    } else {
                        delete state.data.dateLabels.specific[origKey];
                    }
                }
                if (origType === "annual" && state.data.dateLabels.annual) {
                    const arr = state.data.dateLabels.annual[origKey];
                    if (Array.isArray(arr)) {
                        arr.splice(origIndex, 1);
                        if (arr.length === 0) delete state.data.dateLabels.annual[origKey];
                    } else {
                        delete state.data.dateLabels.annual[origKey];
                    }
                }
                if (labelType === "specific") {
                    const dateStr = dateIn?.value;
                    if (!dateStr) { toast("请填写必填项。", "info"); return; }
                    if (!state.data.dateLabels.specific) state.data.dateLabels.specific = {};
                    const arr = state.data.dateLabels.specific[dateStr] || [];
                    state.data.dateLabels.specific[dateStr] = [...arr, entry];
                } else {
                    const month = monthSelect?.value;
                    const day = daySelect?.value;
                    if (!month || !day) { toast("请填写必填项。", "info"); return; }
                    const mm = String(parseInt(month, 10)).padStart(2, "0");
                    const dd = String(parseInt(day, 10)).padStart(2, "0");
                    const mmdd = mm + "-" + dd;
                    const annualStart = annStartIn?.value || DEFAULT_LABEL_ANNUAL_START;
                    const annualEnd = annEndIn?.value || DEFAULT_LABEL_ANNUAL_END;
                    const annualEntry = { ...entry, annualStartDate: annualStart, annualEndDate: annualEnd };
                    if (!state.data.dateLabels.annual) state.data.dateLabels.annual = {};
                    const arr = state.data.dateLabels.annual[mmdd] || [];
                    state.data.dateLabels.annual[mmdd] = [...arr, annualEntry];
                }
                state.editingLabelKeys.delete(labelKeyStr(origType, origKey, origIndex));
                saveData(state.data);
                toast("保存成功", "success");
                renderEventList();
                renderCalendar();
            });
            row.querySelector(".edit-inline-label-cancel")?.addEventListener("click", () => {
                state.editingLabelKeys.delete(labelKeyStr(origType, origKey, origIndex));
                renderEventList();
            });
        });
    }

    function addLabel() {
        const labelType = document.getElementById("label-type")?.value || "annual";
        const name = (document.getElementById("label-name")?.value || "").trim();
        if (!name) {
            toast("请填写必填项。", "info");
            return;
        }
        let entry = { name, addType: "custom" };
        if (labelType === "specific") {
            const dateStr = document.getElementById("label-date")?.value;
            if (!dateStr) {
                toast("请填写必填项。", "info");
                return;
            }
            if (!state.data.dateLabels) state.data.dateLabels = { specific: {}, annual: {} };
            if (!state.data.dateLabels.specific) state.data.dateLabels.specific = {};
            const existing = state.data.dateLabels.specific[dateStr];
            const arr = Array.isArray(existing) ? [...existing] : (existing ? [{ name: String(existing), addType: "custom" }] : []);
            arr.push(entry);
            state.data.dateLabels.specific[dateStr] = arr;
        } else {
            const month = document.getElementById("label-month")?.value;
            const day = document.getElementById("label-day")?.value;
            if (!month || !day) {
                toast("请填写必填项。", "info");
                return;
            }
            const mm = String(parseInt(month, 10)).padStart(2, "0");
            const dd = String(parseInt(day, 10)).padStart(2, "0");
            const mmdd = mm + "-" + dd;
            const annualStart = document.getElementById("label-annual-start")?.value || DEFAULT_LABEL_ANNUAL_START;
            const annualEnd = document.getElementById("label-annual-end")?.value || DEFAULT_LABEL_ANNUAL_END;
            entry = { ...entry, annualStartDate: annualStart, annualEndDate: annualEnd };
            if (!state.data.dateLabels) state.data.dateLabels = { specific: {}, annual: {} };
            if (!state.data.dateLabels.annual) state.data.dateLabels.annual = {};
            const existing = state.data.dateLabels.annual[mmdd];
            const arr = Array.isArray(existing) ? [...existing] : (existing ? [{ name: String(existing), addType: "custom" }] : []);
            arr.push(entry);
            state.data.dateLabels.annual[mmdd] = arr;
        }
        saveData(state.data);
        document.getElementById("label-name").value = "";
        document.getElementById("label-date").value = "";
        const lm = document.getElementById("label-month");
        const ld = document.getElementById("label-day");
        if (lm) {
            lm.value = "";
            lm.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (ld) {
            ld.value = "";
            ld.dispatchEvent(new Event("change", { bubbles: true }));
        }
        document.getElementById("label-annual-start").value = "";
        document.getElementById("label-annual-end").value = "";
        requestAnimationFrame(() => {
            if (typeof window.refreshUiSelectComboboxVisibility === "function") {
                window.refreshUiSelectComboboxVisibility();
            }
        });
        toast("添加成功", "success");
        renderEventList();
        renderCalendar();
    }

    function deleteLabel(type, key, index) {
        if (!state.data.dateLabels) return;
        state.editingLabelKeys.clear();
        if (type === "specific" && state.data.dateLabels.specific) {
            const arr = state.data.dateLabels.specific[key];
            if (Array.isArray(arr)) {
                arr.splice(index, 1);
                if (arr.length === 0) delete state.data.dateLabels.specific[key];
            } else {
                delete state.data.dateLabels.specific[key];
            }
        } else if (type === "annual" && state.data.dateLabels.annual) {
            const arr = state.data.dateLabels.annual[key];
            if (Array.isArray(arr)) {
                arr.splice(index, 1);
                if (arr.length === 0) delete state.data.dateLabels.annual[key];
            } else {
                delete state.data.dateLabels.annual[key];
            }
        }
        saveData(state.data);
        toast("已删除", "success");
        renderEventList();
        renderCalendar();
    }

    async function fetchHolidays() {
        const statusEl = document.getElementById("holiday-fetch-status");
        const loadingModal = document.getElementById("holiday-loading-modal");
        if (statusEl) statusEl.textContent = "获取中...";
        if (loadingModal) loadingModal.classList.remove("hidden");
        const years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
        try {
            if (!state.data.dateLabels) state.data.dateLabels = { specific: {}, annual: {} };
            if (!state.data.dateLabels.specific) state.data.dateLabels.specific = {};
            for (const y of years) {
                const res = await fetch(`https://timor.tech/api/holiday/year/${y}`);
                const data = await res.json();
                if (data.code === 0 && data.holiday) {
                    for (const [mmdd, info] of Object.entries(data.holiday)) {
                        const dateStr = info.date || `${y}-${mmdd}`;
                        const name = info.name || "";
                        state.holidays[dateStr] = name;
                        const existing = state.data.dateLabels.specific[dateStr];
                        const arr = Array.isArray(existing)
                            ? existing.filter(x => x.addType !== "sync")
                            : (existing ? [{ name: String(existing), addType: "custom" }] : []);
                        arr.push({ name, addType: "sync" });
                        state.data.dateLabels.specific[dateStr] = arr;
                    }
                }
            }
            saveData(state.data);
            if (statusEl) statusEl.textContent = "已获取";
            toast("节假日数据已更新", "success");
            renderCalendar();
            renderEventList();
            setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 2000);
        } catch (e) {
            if (statusEl) statusEl.textContent = "获取失败";
            toast("获取节假日失败", "info");
            console.warn("fetchHolidays error", e);
        } finally {
            if (loadingModal) loadingModal.classList.add("hidden");
        }
    }

    function formatReminderDateInfo(evt) {
        if (evt.dateType === "monthly" && evt.dayOfMonth) {
            return ` 每月${evt.dayOfMonth}号`;
        }
        if (evt.dateType === "specific") {
            let s = "";
            if (evt.specificDate) s += evt.specificDate;
            if (evt.hour != null && evt.hour !== "" || evt.minute != null && evt.minute !== "") {
                const h = evt.hour != null ? String(evt.hour).padStart(2, "0") : "00";
                const m = evt.minute != null ? String(evt.minute).padStart(2, "0") : "00";
                s += (s ? " " : "") + h + ":" + m;
            }
            return s ? " " + s : "";
        }
        return "";
    }

    function renderEventList() {
        const listEl = document.getElementById("event-list");
        const titleEl = document.getElementById("event-list-title");
        const filterEl = document.getElementById("reminder-type-filter");
        if (!listEl || !titleEl) return;

        if (state.editingIds.size > 0) {
            syncEditingFormsToState();
        }

        const validityFilterEl = document.getElementById("reminder-validity-filter");
        if (filterEl) {
            filterEl.style.display = (state.eventTypeTab === "reminder" ? "" : "none");
            filterEl.value = state.reminderTypeFilter || "";
        }
        if (validityFilterEl) {
            validityFilterEl.style.display = (state.eventTypeTab === "labels" ? "none" : "");
            validityFilterEl.value = state.eventTypeTab === "checkin"
                ? (state.checkinValidityFilter || "valid")
                : (state.reminderValidityFilter || "valid");
        }
        const dateLabelFilterEl = document.getElementById("date-label-filter");
        if (dateLabelFilterEl) {
            dateLabelFilterEl.style.display = (state.eventTypeTab === "labels" ? "" : "none");
            dateLabelFilterEl.value = state.dateLabelFilter || "custom";
        }

        if (state.eventTypeTab === "labels") {
            renderLabelsList(listEl, titleEl);
            return;
        }

        const filtered = getFilteredEvents();
        titleEl.textContent = state.eventTypeTab === "checkin" ? "打卡列表" : "提醒列表";

        if (filtered.length === 0) {
            listEl.innerHTML = `<p class="empty-state">${state.eventTypeTab === "checkin" ? "暂无打卡事件，请先添加" : "暂无提醒事件，请先添加"}</p>`;
            return;
        }

        listEl.innerHTML = filtered.map((evt, idx) => {
            const isEditing = state.editingIds.has(evt.id);

            if (evt.type === "checkin" && isEditing) {
                const color = escapeHtml(evt.color || "#4CAF50");
                return `<div class="event-item event-item-editing" data-id="${evt.id}">
                    <div class="event-form-checkin-row event-list-edit-row">
                        <div class="event-form-field">
                            <input type="text" class="edit-inline-name" value="${escapeHtml(evt.name)}">
                        </div>
                        <div class="event-form-field event-form-field-color">
                            <div class="event-form-color-inputs">
                                <div class="color-swatch-preview edit-inline-color-preview" style="--swatch-color: ${color}" title="颜色预览"></div>
                                <input type="text" class="edit-inline-color-hex" value="${color}" placeholder="#ffffff">
                            </div>
                        </div>
                        <div class="event-form-field">
                            <input type="date" class="edit-inline-date-start" value="${evt.dateStart || ""}">
                        </div>
                        <div class="event-form-field">
                            <input type="date" class="edit-inline-date-end" value="${evt.dateEnd || ""}">
                        </div>
                        <button type="button" class="btn primary edit-inline-save">保存</button>
                        <button type="button" class="btn btn-ghost edit-inline-cancel">取消</button>
                    </div>
                </div>`;
            }

            if (evt.type === "reminder" && isEditing) {
                const rt = evt.reminderType || "normal";
                const dt = evt.dateType || "specific";
                const specDate = evt.specificDate || "";
                const hour = evt.hour ?? "";
                const minute = evt.minute ?? "";
                const dom = evt.dayOfMonth ?? "";
                const monStart = evt.monthlyStartDate || DEFAULT_MONTHLY_START;
                const monEnd = evt.monthlyEndDate || DEFAULT_MONTHLY_END;
                const icon = getIconForReminderType(rt);
                const typeOpts = REMINDER_TYPES.map(t =>
                    `<option value="${t.value}" ${t.value === rt ? "selected" : ""}>${t.label}</option>`
                ).join("");
                const specDisplay = dt === "specific" ? "" : "none";
                const monDisplay = dt === "monthly" ? "" : "none";
                return `<div class="event-item event-item-editing event-item-reminder-editing" data-id="${evt.id}">
                    <div class="event-form-checkin-row event-form-reminder-row event-list-edit-row">
                        <div class="event-form-field event-form-field-type">
                            <div class="event-form-type-with-icon">
                                <span class="reminder-type-icon edit-inline-type-icon">${icon}</span>
                                <select class="event-form-select edit-inline-reminder-type">
                                    ${typeOpts}
                                </select>
                            </div>
                        </div>
                        <div class="event-form-field">
                            <input type="text" class="edit-inline-reminder-name" value="${escapeHtml(evt.name)}" placeholder="事件名称">
                        </div>
                        <div class="event-form-field">
                            <select class="event-form-select edit-inline-date-type">
                                <option value="specific" ${dt === "specific" ? "selected" : ""}>指定日期</option>
                                <option value="monthly" ${dt === "monthly" ? "selected" : ""}>每月</option>
                            </select>
                        </div>
                        <div class="event-form-field-group edit-inline-specific-fields" style="display:${specDisplay}">
                            <div class="event-form-field">
                                <input type="date" class="edit-inline-specific-date" value="${specDate}">
                            </div>
                            <div class="event-form-field event-form-field-time">
                                <div class="event-form-time-inputs">
                                    <input type="number" class="edit-inline-hour" min="0" max="23" placeholder="时" value="${hour}">
                                    <span>:</span>
                                    <input type="number" class="edit-inline-minute" min="0" max="59" placeholder="分" value="${minute}">
                                </div>
                            </div>
                        </div>
                        <div class="event-form-field-group edit-inline-monthly-fields" style="display:${monDisplay}">
                            <div class="event-form-field event-form-field-day-unit">
                                <input type="number" class="edit-inline-day-of-month" min="1" max="31" placeholder="几号" value="${dom}">
                                <span class="field-unit">号</span>
                            </div>
                            <div class="event-form-field">
                                <input type="date" class="edit-inline-monthly-start" value="${monStart}" placeholder="生效开始日期">
                            </div>
                            <div class="event-form-field">
                                <input type="date" class="edit-inline-monthly-end" value="${monEnd}" placeholder="生效结束日期">
                            </div>
                        </div>
                        <button type="button" class="btn primary edit-inline-save">保存</button>
                        <button type="button" class="btn btn-ghost edit-inline-cancel">取消</button>
                    </div>
                </div>`;
            }

            let extra = "";
            if (evt.type === "checkin" && (evt.dateStart || evt.dateEnd)) {
                extra = `<span class="label-range-text"> ${evt.dateStart || "不限"} ~ ${evt.dateEnd || "不限"}</span>`;
            }
            if (evt.type === "reminder") {
                const mainInfo = formatReminderDateInfo(evt);
                const rangeInfo = evt.dateType === "monthly" ? ` ${evt.monthlyStartDate || DEFAULT_MONTHLY_START} ~ ${evt.monthlyEndDate || DEFAULT_MONTHLY_END}` : "";
                extra = mainInfo + (rangeInfo ? `<span class="label-range-text">${rangeInfo}</span>` : "");
            }
            const dotOrIcon = evt.type === "checkin"
                ? `<span class="dot" style="background:${evt.color}"></span>`
                : `<span class="event-icon">${evt.reminderType ? getIconForReminderType(evt.reminderType) : (evt.icon || "🔔")}</span>`;
            return `<div class="event-item" data-id="${evt.id}">
                ${dotOrIcon}
                <span class="event-item-name">${escapeHtml(evt.name)}${extra}</span>
                <div class="event-item-actions">
                    <button type="button" class="btn-ghost" data-action="edit" data-id="${evt.id}">编辑</button>
                    <button type="button" class="btn-edit-event" data-action="delete" data-id="${evt.id}">删除</button>
                </div>
            </div>`;
        }).join("");

        listEl.querySelectorAll(".event-item-editing").forEach(row => {
            const id = row.dataset.id;
            const nameIn = row.querySelector(".edit-inline-name");
            const colorHexIn = row.querySelector(".edit-inline-color-hex");
            const colorPreview = row.querySelector(".edit-inline-color-preview");
            const dateStartIn = row.querySelector(".edit-inline-date-start");
            const dateEndIn = row.querySelector(".edit-inline-date-end");

            if (colorHexIn && colorPreview) {
                colorHexIn.addEventListener("input", () => {
                    const hex = parseColorToHex(colorHexIn.value);
                    if (hex) colorPreview.style.setProperty("--swatch-color", hex);
                });
            }

            row.querySelector(".edit-inline-save")?.addEventListener("click", () => {
                const evt = state.data.events.find(e => e.id === id);
                if (!evt) return;
                const name = (nameIn?.value || "").trim();
                if (!name) { toast("请输入事件名称", "info"); return; }
                const dateStart = dateStartIn?.value || null;
                const dateEnd = dateEndIn?.value || null;
                if (!dateStart || !dateEnd) { toast("请填写开始日期和结束日期", "info"); return; }
                evt.name = name;
                evt.color = parseColorToHex(colorHexIn?.value) || "#4CAF50";
                evt.dateStart = dateStart;
                evt.dateEnd = dateEnd;
                state.editingIds.delete(id);
                saveData(state.data);
                toast("保存成功", "success");
                renderEventList();
                renderCalendar();
                renderStats();
            });
            row.querySelector(".edit-inline-cancel")?.addEventListener("click", () => {
                state.editingIds.delete(id);
                renderEventList();
            });
        });

        listEl.querySelectorAll(".event-item-reminder-editing").forEach(row => {
            const id = row.dataset.id;
            const evt = state.data.events.find(e => e.id === id);
            if (!evt || evt.type !== "reminder") return;

            const typeSelect = row.querySelector(".edit-inline-reminder-type");
            const typeIcon = row.querySelector(".edit-inline-type-icon");
            const nameIn = row.querySelector(".edit-inline-reminder-name");
            const dateTypeSelect = row.querySelector(".edit-inline-date-type");
            const specFields = row.querySelector(".edit-inline-specific-fields");
            const monFields = row.querySelector(".edit-inline-monthly-fields");
            const specDateIn = row.querySelector(".edit-inline-specific-date");
            const hourIn = row.querySelector(".edit-inline-hour");
            const minuteIn = row.querySelector(".edit-inline-minute");
            const domIn = row.querySelector(".edit-inline-day-of-month");
            const monStartIn = row.querySelector(".edit-inline-monthly-start");
            const monEndIn = row.querySelector(".edit-inline-monthly-end");

            function updateInlineReminderFormByType() {
                const rt = typeSelect?.value || "normal";
                if (typeIcon) typeIcon.textContent = getIconForReminderType(rt);
                const forced = getDateTypeForReminderType(rt);
                if (forced && dateTypeSelect) {
                    dateTypeSelect.value = forced;
                    dateTypeSelect.disabled = true;
                } else if (dateTypeSelect) {
                    dateTypeSelect.disabled = false;
                }
                const dt = dateTypeSelect?.value || "specific";
                if (specFields) specFields.style.display = dt === "specific" ? "" : "none";
                if (monFields) monFields.style.display = dt === "monthly" ? "" : "none";
            }

            typeSelect?.addEventListener("change", updateInlineReminderFormByType);
            dateTypeSelect?.addEventListener("change", () => {
                const dt = dateTypeSelect.value || "specific";
                if (specFields) specFields.style.display = dt === "specific" ? "" : "none";
                if (monFields) monFields.style.display = dt === "monthly" ? "" : "none";
            });
            updateInlineReminderFormByType();

            row.querySelector(".edit-inline-save")?.addEventListener("click", () => {
                const name = (nameIn?.value || "").trim();
                if (!name) { toast("请输入事件名称", "info"); return; }
                const dateType = dateTypeSelect?.value || "specific";
                let specificDate = null, hour = null, minute = null, dayOfMonth = null;
                let monthlyStartDate = null, monthlyEndDate = null;
                if (dateType === "specific") {
                    specificDate = specDateIn?.value || null;
                    const h = hourIn?.value;
                    const m = minuteIn?.value;
                    hour = h != null && h !== "" ? parseInt(h, 10) : null;
                    minute = m != null && m !== "" ? parseInt(m, 10) : null;
                } else {
                    const dom = domIn?.value;
                    dayOfMonth = dom != null && dom !== "" ? parseInt(dom, 10) : null;
                    monthlyStartDate = monStartIn?.value || DEFAULT_MONTHLY_START;
                    monthlyEndDate = monEndIn?.value || DEFAULT_MONTHLY_END;
                }
                evt.name = name;
                evt.reminderType = typeSelect?.value || "normal";
                evt.dateType = dateType;
                evt.specificDate = specificDate;
                evt.hour = hour;
                evt.minute = minute;
                evt.dayOfMonth = dayOfMonth;
                evt.monthlyStartDate = monthlyStartDate;
                evt.monthlyEndDate = monthlyEndDate;
                state.editingIds.delete(id);
                saveData(state.data);
                toast("保存成功", "success");
                renderEventList();
            });
            row.querySelector(".edit-inline-cancel")?.addEventListener("click", () => {
                state.editingIds.delete(id);
                renderEventList();
            });
        });
    }

    function renderStats() {
        const listEl = document.getElementById("stats-event-list");
        const detailEl = document.getElementById("stats-detail");
        if (!listEl || !detailEl) return;

        const events = getCheckinEvents().slice().sort((a, b) => {
            const aEnd = a.dateEnd || "";
            const bEnd = b.dateEnd || "";
            return bEnd.localeCompare(aEnd);
        });

        if (events.length === 0) {
            state.statsSelectedEventId = null;
            listEl.innerHTML = '<p class="empty-state">暂无打卡事件，请先在事件管理中添加</p>';
            detailEl.innerHTML = '<p class="empty-state">请选择左侧打卡事件</p>';
            return;
        }

        if (!events.some(e => e.id === state.statsSelectedEventId)) {
            state.statsSelectedEventId = events[0].id;
        }
        const selected = events.find(e => e.id === state.statsSelectedEventId) || events[0];
        state.statsSelectedEventId = selected.id;

        listEl.innerHTML = events.map((evt) => `
            <button type="button" class="stats-event-item ${evt.id === selected.id ? "active" : ""}" data-event-id="${evt.id}">
                <span class="dot" style="background:${escapeHtml(evt.color || "#4CAF50")}"></span>
                <span class="stats-event-item-name">${escapeHtml(evt.name || "")}</span>
            </button>
        `).join("");

        const start = selected.dateStart || "";
        const end = selected.dateEnd || "";
        const validRange = !!(start && end && start <= end);
        const recordsSet = new Set(
            getCheckinRecords()
                .filter(r => r.eventId === selected.id)
                .map(r => r.date)
        );

        const missingDates = [];
        let totalDays = 0; // 遗漏统计口径：开始日期 ~ min(结束日期, 昨天)
        let fullTotalDays = 0; // 总天数口径：开始日期 ~ 结束日期
        if (validRange) {
            // 1) 完整区间总天数（用于“总天数/完成率”）
            {
                const curAll = new Date(start);
                const endAll = new Date(end);
                while (curAll <= endAll) {
                    fullTotalDays += 1;
                    curAll.setDate(curAll.getDate() + 1);
                }
            }

            // 2) 遗漏日期统计区间（仅到昨天）
            const cur = new Date(start);
            const capEnd = new Date(end);
            const yesterday = new Date();
            yesterday.setHours(0, 0, 0, 0);
            yesterday.setDate(yesterday.getDate() - 1);
            const statEnd = capEnd < yesterday ? capEnd : yesterday;
            while (cur <= statEnd) {
                const d = formatDate(cur);
                totalDays += 1;
                if (!recordsSet.has(d)) missingDates.push(d);
                cur.setDate(cur.getDate() + 1);
            }
        }
        const checkedDays = validRange
            ? Array.from(recordsSet).filter(d => d >= start && d <= end).length
            : 0;
        const pct = fullTotalDays > 0 ? ((checkedDays / fullTotalDays) * 100).toFixed(1) : "0.0";

        const missingCards = missingDates.length
            ? missingDates.map(d => `<div class="stats-miss-item">${d}</div>`).join("")
            : '<p class="empty-state">无遗漏日期</p>';

        detailEl.innerHTML = `
            <div class="stats-range">${validRange ? `${start} ~ ${end}` : "未设置有效日期范围"}</div>
            <div class="stats-metrics">
                <div class="stats-metric-card">
                    <div class="stats-metric-value">${checkedDays}</div>
                    <div class="stats-metric-label">已打卡天数</div>
                </div>
                <div class="stats-metric-card">
                    <div class="stats-metric-value">${fullTotalDays}</div>
                    <div class="stats-metric-label">总天数</div>
                </div>
                <div class="stats-metric-card">
                    <div class="stats-metric-value">${pct}%</div>
                    <div class="stats-metric-label">完成率</div>
                </div>
            </div>
            <div class="stats-miss-title">遗漏日期 <span>+${missingDates.length} 天</span></div>
            <div class="stats-miss-grid">${missingCards}</div>
        `;
    }

    function scheduleStatsMidnightRefresh() {
        const now = new Date();
        const next = new Date(now);
        next.setHours(24, 0, 0, 0);
        const delay = Math.max(1000, next.getTime() - now.getTime() + 50);
        setTimeout(() => {
            if (state.activePage === "stats") renderStats();
            scheduleStatsMidnightRefresh();
        }, delay);
    }

    function getDefaultDateStart() {
        return formatDate(new Date());
    }

    function getDefaultDateEnd() {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return formatDate(d);
    }

    function initCheckinFormDefaults() {
        const startEl = document.getElementById("checkin-date-start");
        const endEl = document.getElementById("checkin-date-end");
        if (startEl && !startEl.value) startEl.value = getDefaultDateStart();
        if (endEl && !endEl.value) endEl.value = getDefaultDateEnd();
    }

    function addEvent() {
        const name = (document.getElementById("checkin-name")?.value || "").trim();
        if (!name) {
            toast("请输入事件名称", "info");
            return;
        }
        const dateStart = document.getElementById("checkin-date-start")?.value || null;
        const dateEnd = document.getElementById("checkin-date-end")?.value || null;
        if (!dateStart || !dateEnd) {
            toast("请填写开始日期和结束日期", "info");
            return;
        }
        const colorHexEl = document.getElementById("checkin-color-hex");
        const color = parseColorToHex(colorHexEl?.value) || "#4CAF50";

        state.data.events.push({
            id: genId(), type: "checkin", name, color,
            dateStart: dateStart,
            dateEnd: dateEnd
        });
        saveData(state.data);

        if (document.getElementById("checkin-name")) document.getElementById("checkin-name").value = "";
        const colorHexEl2 = document.getElementById("checkin-color-hex");
        const colorPreviewEl = document.getElementById("checkin-color-preview");
        if (colorHexEl2) colorHexEl2.value = "#4CAF50";
        if (colorPreviewEl) colorPreviewEl.style.setProperty("--swatch-color", "#4CAF50");
        const startEl = document.getElementById("checkin-date-start");
        const endEl = document.getElementById("checkin-date-end");
        if (startEl) startEl.value = getDefaultDateStart();
        if (endEl) endEl.value = getDefaultDateEnd();

        toast("添加成功", "success");
        renderEventList();
    }

    function addReminder() {
        const name = (document.getElementById("reminder-name")?.value || "").trim();
        if (!name) {
            toast("请输入事件名称", "info");
            return;
        }
        const reminderType = document.getElementById("reminder-type")?.value || "normal";
        const dateType = document.getElementById("reminder-date-type")?.value || "specific";
        let specificDate = null, hour = null, minute = null, dayOfMonth = null;

        let monthlyStartDate = null, monthlyEndDate = null;
        if (dateType === "specific") {
            specificDate = document.getElementById("reminder-specific-date")?.value || null;
            const h = document.getElementById("reminder-hour")?.value;
            const min = document.getElementById("reminder-minute")?.value;
            hour = h != null && h !== "" ? Math.max(0, Math.min(23, parseInt(h, 10))) : null;
            minute = min != null && min !== "" ? Math.max(0, Math.min(59, parseInt(min, 10))) : null;
        } else {
            const dom = document.getElementById("reminder-day-of-month")?.value;
            dayOfMonth = dom != null && dom !== "" ? Math.max(1, Math.min(31, parseInt(dom, 10))) : null;
            monthlyStartDate = document.getElementById("reminder-monthly-start")?.value || DEFAULT_MONTHLY_START;
            monthlyEndDate = document.getElementById("reminder-monthly-end")?.value || DEFAULT_MONTHLY_END;
        }

        state.data.events.push({
            id: genId(), type: "reminder", name, reminderType,
            dateType, specificDate, hour, minute, dayOfMonth,
            monthlyStartDate, monthlyEndDate
        });
        saveData(state.data);

        document.getElementById("reminder-name").value = "";
        document.getElementById("reminder-specific-date").value = "";
        document.getElementById("reminder-hour").value = "";
        document.getElementById("reminder-minute").value = "";
        document.getElementById("reminder-day-of-month").value = "";
        document.getElementById("reminder-monthly-start").value = "";
        document.getElementById("reminder-monthly-end").value = "";

        toast("添加成功", "success");
        renderEventList();
    }

    function syncEditingFormsToState() {
        const listEl = document.getElementById("event-list");
        if (!listEl) return;
        listEl.querySelectorAll(".event-item-editing").forEach(row => {
            const id = row.dataset.id;
            const evt = state.data.events.find(e => e.id === id);
            if (!evt) return;
            if (evt.type === "checkin") {
                const nameIn = row.querySelector(".edit-inline-name");
                const colorHexIn = row.querySelector(".edit-inline-color-hex");
                const dateStartIn = row.querySelector(".edit-inline-date-start");
                const dateEndIn = row.querySelector(".edit-inline-date-end");
                if (nameIn) evt.name = (nameIn.value || "").trim() || evt.name;
                if (colorHexIn) evt.color = parseColorToHex(colorHexIn?.value) || evt.color;
                if (dateStartIn) evt.dateStart = dateStartIn.value || evt.dateStart;
                if (dateEndIn) evt.dateEnd = dateEndIn.value || evt.dateEnd;
            } else if (evt.type === "reminder") {
                const nameIn = row.querySelector(".edit-inline-reminder-name");
                const typeSelect = row.querySelector(".edit-inline-reminder-type");
                const dateTypeSelect = row.querySelector(".edit-inline-date-type");
                const specDateIn = row.querySelector(".edit-inline-specific-date");
                const hourIn = row.querySelector(".edit-inline-hour");
                const minuteIn = row.querySelector(".edit-inline-minute");
                const domIn = row.querySelector(".edit-inline-day-of-month");
                const monStartIn = row.querySelector(".edit-inline-monthly-start");
                const monEndIn = row.querySelector(".edit-inline-monthly-end");
                if (nameIn) evt.name = (nameIn.value || "").trim() || evt.name;
                if (typeSelect) evt.reminderType = typeSelect.value || "normal";
                if (dateTypeSelect) evt.dateType = dateTypeSelect.value || "specific";
                if (specDateIn) evt.specificDate = specDateIn.value || null;
                if (hourIn) evt.hour = hourIn.value !== "" ? parseInt(hourIn.value, 10) : null;
                if (minuteIn) evt.minute = minuteIn.value !== "" ? parseInt(minuteIn.value, 10) : null;
                if (domIn) evt.dayOfMonth = domIn.value !== "" ? parseInt(domIn.value, 10) : null;
                if (monStartIn) evt.monthlyStartDate = monStartIn.value || DEFAULT_MONTHLY_START;
                if (monEndIn) evt.monthlyEndDate = monEndIn.value || DEFAULT_MONTHLY_END;
            }
        });
    }

    function editEvent(evt) {
        state.editingIds.add(evt.id);
        renderEventList();
    }

    function updateEditReminderFormByType() {
        const reminderType = document.getElementById("edit-reminder-type")?.value || "normal";
        const dateTypeEl = document.getElementById("edit-reminder-date-type");
        const iconEl = document.getElementById("edit-reminder-type-icon");

        if (iconEl) iconEl.textContent = getIconForReminderType(reminderType);

        const forcedDateType = getDateTypeForReminderType(reminderType);
        if (forcedDateType && dateTypeEl) {
            dateTypeEl.value = forcedDateType;
            dateTypeEl.disabled = true;
        } else if (dateTypeEl) {
            dateTypeEl.disabled = false;
        }
        toggleEditReminderDateTypeFields();
    }

    function toggleEditReminderDateTypeFields() {
        const type = document.getElementById("edit-reminder-date-type")?.value || "specific";
        const spec = document.getElementById("edit-reminder-specific-fields");
        const mon = document.getElementById("edit-reminder-monthly-fields");
        if (spec) spec.style.display = type === "specific" ? "" : "none";
        if (mon) mon.style.display = type === "monthly" ? "" : "none";
    }

    function editReminder(evt) {
        state.editingId = evt.id;
        const modal = document.getElementById("edit-reminder-modal");
        if (modal) modal.classList.remove("hidden");
    }

    function saveEditEvent() {
        const evt = state.data.events.find(e => e.id === state.editingId);
        if (!evt) return;

        if (evt.type === "reminder") {
            const name = (document.getElementById("edit-reminder-name")?.value || "").trim();
            if (!name) { toast("请输入名称", "info"); return; }
            evt.name = name;
            evt.reminderType = document.getElementById("edit-reminder-type")?.value || "normal";
            evt.dateType = document.getElementById("edit-reminder-date-type")?.value || "specific";
            evt.specificDate = document.getElementById("edit-reminder-specific-date")?.value || null;
            const h = document.getElementById("edit-reminder-hour")?.value;
            const min = document.getElementById("edit-reminder-minute")?.value;
            evt.hour = h != null && h !== "" ? parseInt(h, 10) : null;
            evt.minute = min != null && min !== "" ? parseInt(min, 10) : null;
            const domEl = document.getElementById("edit-reminder-day-of-month");
            evt.dayOfMonth = domEl?.value ? parseInt(domEl.value, 10) : null;
            const monStartEl = document.getElementById("edit-reminder-monthly-start");
            const monEndEl = document.getElementById("edit-reminder-monthly-end");
            evt.monthlyStartDate = monStartEl?.value || DEFAULT_MONTHLY_START;
            evt.monthlyEndDate = monEndEl?.value || DEFAULT_MONTHLY_END;
            document.getElementById("edit-reminder-modal").classList.add("hidden");
        } else {
            const name = (document.getElementById("edit-checkin-name")?.value || "").trim();
            if (!name) { toast("请输入名称", "info"); return; }
            evt.name = name;
            evt.color = parseColorToHex(document.getElementById("edit-checkin-color-hex")?.value) || "#4CAF50";
            evt.dateStart = document.getElementById("edit-checkin-date-start")?.value || null;
            evt.dateEnd = document.getElementById("edit-checkin-date-end")?.value || null;
            document.getElementById("edit-event-modal").classList.add("hidden");
        }

        state.editingId = null;
        saveData(state.data);
        toast("保存成功", "success");
        renderEventList();
        renderCalendar();
        renderStats();
    }

    function deleteEvent(id) {
        const evt = state.data.events.find(e => e.id === id);
        const hasRecords = evt?.type === "checkin" && state.data.records.some(r => r.eventId === id);
        state.deleteEventId = id;
        state.deleteLabelTarget = null;
        document.getElementById("delete-event-msg").textContent = hasRecords
            ? "当前事件已有打卡记录，强制删除会同步清除该事件关联的记录，是否确认删除？"
            : "确定删除该事件？";
        document.getElementById("delete-event-modal").classList.remove("hidden");
    }

    function showDeleteLabelConfirm(type, key, index) {
        const labels = state.data.dateLabels || { specific: {}, annual: {} };
        const arr = type === "specific" ? (labels.specific?.[key]) : (labels.annual?.[key]);
        const item = Array.isArray(arr) ? arr[index] : null;
        const name = item?.name ?? (typeof arr === "string" ? arr : "");
        const displayKey = type === "specific" ? key : "每年 " + key;
        state.deleteEventId = null;
        state.deleteLabelTarget = { type, key, index: parseInt(index, 10) || 0 };
        document.getElementById("delete-event-msg").textContent = `确定删除日期标签「${escapeHtml(displayKey)} ${escapeHtml(name)}」？`;
        document.getElementById("delete-event-modal").classList.remove("hidden");
    }

    function confirmDelete() {
        if (state.deleteLabelTarget) {
            const { type, key, index } = state.deleteLabelTarget;
            deleteLabel(type, key, index);
            state.deleteLabelTarget = null;
        } else {
            const id = state.deleteEventId;
            if (!id) return;
            state.data.events = state.data.events.filter(e => e.id !== id);
            state.data.records = state.data.records.filter(r => r.eventId !== id);
            saveData(state.data);
            toast("已删除", "success");
            renderEventList();
            renderCalendar();
            renderStats();
            showDetailPanel(state.selectedDate);
        }
        document.getElementById("delete-event-modal").classList.add("hidden");
        state.deleteEventId = null;
    }

    function switchPage(page) {
        state.activePage = page;
        document.querySelectorAll(".nav-tab").forEach(t => {
            t.classList.toggle("active", t.dataset.page === page);
        });
        document.querySelectorAll(".page").forEach(p => {
            p.classList.toggle("active", p.id === "page-" + page);
        });
        if (page === "stats") renderStats();
        if (page === "events") {
            initCheckinFormDefaults();
            renderEventList();
        }
        // 待办 Tab 默认隐藏：ui-select 初始化时会把组合框设为 display:none；
        // 切换到本页（或 URL ?page=todos）后必须刷新，否则「分类」「已完成筛选」只见标签不见控件。
        requestAnimationFrame(() => {
            if (typeof window.refreshUiSelectComboboxVisibility === "function") {
                window.refreshUiSelectComboboxVisibility();
            }
        });
    }

    function bindEvents() {
        document.querySelectorAll(".nav-tab").forEach(tab => {
            tab.addEventListener("click", () => switchPage(tab.dataset.page));
        });

        document.getElementById("btn-go-home")?.addEventListener("click", () => {
            window.location.href = "/home";
        });

        document.getElementById("stats-event-list")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".stats-event-item");
            if (!btn) return;
            const id = btn.dataset.eventId;
            if (!id) return;
            state.statsSelectedEventId = id;
            renderStats();
        });

        document.getElementById("event-list")?.addEventListener("click", (e) => {
            const editLabelBtn = e.target.closest("[data-action=edit-label]");
            if (editLabelBtn) {
                e.stopPropagation();
                const type = editLabelBtn.dataset.type || "annual";
                const key = editLabelBtn.dataset.key || "";
                const index = parseInt(editLabelBtn.dataset.index, 10) || 0;
                const targetKeyStr = labelKeyStr(type, key, index);
                if (state.editingLabelKeys.has(targetKeyStr)) return;
                state.editingLabelKeys.add(targetKeyStr);
                renderEventList();
                return;
            }
            const delLabelBtn = e.target.closest("[data-action=delete-label]");
            if (delLabelBtn) {
                e.stopPropagation();
                showDeleteLabelConfirm(delLabelBtn.dataset.type, delLabelBtn.dataset.key, delLabelBtn.dataset.index);
                return;
            }
            const editBtn = e.target.closest("[data-action=edit]");
            if (editBtn) {
                e.stopPropagation();
                const evt = state.data.events.find(x => x.id === editBtn.dataset.id);
                if (evt) editEvent(evt);
                return;
            }
            const delBtn = e.target.closest("[data-action=delete]");
            if (delBtn) {
                e.stopPropagation();
                deleteEvent(delBtn.dataset.id);
            }
        });

        document.getElementById("btn-add-checkin")?.addEventListener("click", addEvent);
        document.getElementById("btn-add-reminder")?.addEventListener("click", addReminder);
        document.getElementById("btn-add-label")?.addEventListener("click", addLabel);
        document.getElementById("btn-fetch-holidays")?.addEventListener("click", fetchHolidays);

        document.getElementById("btn-edit-event-save")?.addEventListener("click", saveEditEvent);
        document.getElementById("btn-edit-event-cancel")?.addEventListener("click", () => {
            document.getElementById("edit-event-modal").classList.add("hidden");
            state.editingId = null;
        });

        document.getElementById("btn-edit-reminder-save")?.addEventListener("click", saveEditEvent);
        document.getElementById("btn-edit-reminder-cancel")?.addEventListener("click", () => {
            document.getElementById("edit-reminder-modal").classList.add("hidden");
            state.editingId = null;
        });

        document.getElementById("edit-reminder-type")?.addEventListener("change", updateEditReminderFormByType);
        document.getElementById("edit-reminder-date-type")?.addEventListener("change", toggleEditReminderDateTypeFields);

        document.getElementById("btn-delete-confirm")?.addEventListener("click", confirmDelete);
        document.getElementById("btn-delete-cancel")?.addEventListener("click", () => {
            document.getElementById("delete-event-modal").classList.add("hidden");
            state.deleteEventId = null;
            state.deleteLabelTarget = null;
        });

        document.getElementById("label-type")?.addEventListener("change", updateLabelDateFields);

        document.addEventListener("click", () => {
            document.querySelectorAll(".custom-select-dropdown.open").forEach(d => d.classList.remove("open"));
        });

        document.querySelectorAll(".event-type-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                state.eventTypeTab = tab.dataset.type;
                document.querySelectorAll(".event-type-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const isCaldav = state.eventTypeTab === "caldav";

                document.getElementById("event-form-checkin").style.display = state.eventTypeTab === "checkin" ? "" : "none";
                document.getElementById("event-form-reminder").style.display = state.eventTypeTab === "reminder" ? "" : "none";
                document.getElementById("event-form-labels").style.display = state.eventTypeTab === "labels" ? "" : "none";
                const eventListCardEl = document.getElementById("event-list-card");
                if (eventListCardEl) eventListCardEl.style.display = isCaldav ? "none" : "";
                const eventSyncPanelEl = document.getElementById("event-sync-panel");
                if (eventSyncPanelEl) eventSyncPanelEl.style.display = isCaldav ? "" : "none";

                if (state.eventTypeTab === "labels") updateLabelDateFields();
                if (!isCaldav) renderEventList();
                requestAnimationFrame(() => {
                    if (typeof window.refreshUiSelectComboboxVisibility === "function") {
                        window.refreshUiSelectComboboxVisibility();
                    }
                });
            });
        });

        document.getElementById("reminder-type-filter")?.addEventListener("change", (e) => {
            state.reminderTypeFilter = (e.target.value || "").trim();
            renderEventList();
        });

        document.getElementById("reminder-validity-filter")?.addEventListener("change", (e) => {
            const val = e.target.value || "valid";
            if (state.eventTypeTab === "checkin") {
                state.checkinValidityFilter = val;
            } else {
                state.reminderValidityFilter = val;
            }
            renderEventList();
        });

        document.getElementById("date-label-filter")?.addEventListener("change", (e) => {
            state.dateLabelFilter = e.target.value || "custom";
            renderEventList();
        });

        document.getElementById("reminder-type")?.addEventListener("change", updateReminderFormByType);
        document.getElementById("reminder-date-type")?.addEventListener("change", updateReminderDateFields);

        updateReminderFormByType();
        updateLabelDateFields();

        // CalDAV sync panel
        (async () => {
            try {
                const res = await fetch("/api/calendar/caldav/config");
                if (!res || !res.ok) return;
                const json = await res.json().catch(() => ({}));
                if (!json || !json.success) return;
                const cfg = json.config || {};
                const elUrl = document.getElementById("caldav-url");
                const elCalUrl = document.getElementById("caldav-calendar-url");
                const elUser = document.getElementById("caldav-username");
                const elPwd = document.getElementById("caldav-password");
                if (elUrl) elUrl.value = cfg.caldav_url || "";
                if (elCalUrl) elCalUrl.value = cfg.calendar_url || "";
                if (elUser) elUser.value = cfg.username || "";
                // Password may be omitted by some clients; keep blank if empty
                if (elPwd && cfg.password) elPwd.value = cfg.password || "";
            } catch (e) {
                console.warn("load caldav config failed", e);
            }
        })();

        async function saveCaldavConfigFromUI() {
            const caldavUrl = (document.getElementById("caldav-url")?.value || "").trim();
            const calendarUrl = (document.getElementById("caldav-calendar-url")?.value || "").trim();
            const username = (document.getElementById("caldav-username")?.value || "").trim();
            const password = (document.getElementById("caldav-password")?.value || "");
            const payload = {
                caldav_url: caldavUrl,
                calendar_url: calendarUrl,
                username,
                password
            };
            const res = await fetch("/api/calendar/caldav/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json || !json.success) {
                const msg = (json && json.message) ? json.message : "保存 CalDAV 配置失败";
                throw new Error(msg);
            }
        }

        async function syncCaldavNow() {
            const modal = document.getElementById("caldav-sync-loading-modal");
            if (modal) modal.classList.remove("hidden");
            try {
                const res = await fetch("/api/calendar/caldav/sync", { method: "POST" });
                const json = await res.json().catch(() => ({}));
                if (!res.ok || !json || !json.success) {
                    toast((json && json.message) ? json.message : "同步失败", "info");
                    return;
                }
                const okMsg = `同步完成：更新 ${json.created_or_updated || 0} / 删除 ${json.deleted || 0}`;
                toast(okMsg, "success");
            } catch (e) {
                console.warn("caldav sync error", e);
                toast("同步失败，请检查控制台日志", "info");
            } finally {
                if (modal) modal.classList.add("hidden");
            }
        }

        document.getElementById("btn-caldav-save-sync")?.addEventListener("click", async () => {
            try {
                await saveCaldavConfigFromUI();
                toast("CalDAV 配置已保存，开始同步…", "success");
                await syncCaldavNow();
            } catch (e) {
                console.warn(e);
                toast(e && e.message ? e.message : "保存失败", "info");
            }
        });

        document.getElementById("btn-caldav-sync-now")?.addEventListener("click", async () => {
            await syncCaldavNow();
        });

        document.getElementById("checkin-color-hex")?.addEventListener("input", (e) => {
            const hex = parseColorToHex(e.target.value);
            const preview = document.getElementById("checkin-color-preview");
            if (hex && preview) preview.style.setProperty("--swatch-color", hex);
        });
        document.getElementById("edit-checkin-color-hex")?.addEventListener("input", (e) => {
            const hex = parseColorToHex(e.target.value);
            const preview = document.getElementById("edit-checkin-color-preview");
            if (hex && preview) preview.style.setProperty("--swatch-color", hex);
        });
    }

    function init() {
        try {
            const t = localStorage.getItem("app_theme");
            if (t && ["light", "yellow-green", "checkin", "dark"].includes(t)) {
                document.documentElement.setAttribute("data-theme", t);
            }
        } catch (e) {}

        bindEvents();
        initCheckinFormDefaults();
        // 支持通过 URL 参数跳转到指定一级 TAB：/static/checkin.html?page=events|stats|todos
        try {
            const p = new URLSearchParams(window.location.search || "").get("page");
            if (p === "calendar") {
                window.location.replace("/calendar");
            } else if (p === "stats" || p === "events" || p === "todos") {
                switchPage(p);
            }
        } catch (e) {}

        renderCalendar();
        showDetailPanel(state.selectedDate);
        renderEventList();
        renderStats();
        scheduleStatsMidnightRefresh();

        // 从服务端同步；优先服务端有效快照；若服务端为空但本机 localStorage 仍有数据则恢复并回写服务端
        (async () => {
            try {
                const res = await fetch("/api/checkin/state");
                let serverData = null;
                if (res && res.ok) {
                    const json = await res.json();
                    if (json && json.success && json.data) serverData = json.data;
                }
                const localSnapshot = loadData();
                if (serverData && hasCheckinDataSnapshot(serverData)) {
                    state.data = serverData;
                    saveData(state.data);
                } else if (hasCheckinDataSnapshot(localSnapshot)) {
                    state.data = localSnapshot;
                    await saveDataToServer(state.data);
                    toast("已从本机缓存恢复打卡数据并同步到服务端", "success");
                } else if (serverData) {
                    state.data = serverData;
                    saveData(state.data);
                } else {
                    state.data = localSnapshot;
                }
                renderCalendar();
                showDetailPanel(state.selectedDate);
                renderEventList();
                renderStats();
            } catch (e) {
                console.warn("sync checkin state from server error", e);
            }
        })();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/static/checkin-sw.js", { scope: "/static/" })
                .then(reg => console.log("SW registered", reg.scope))
                .catch(err => console.warn("SW registration failed", err));
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();

function qs(id) {
  return document.getElementById(id);
}

function showToast(text, type = "info") {
  const container = qs("toast-container");
  if (!container || !text) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      if (toast.parentNode === container) container.removeChild(toast);
    }, 300);
  }, 2500);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function endOfWeekSunday(d) {
  const s = startOfWeekMonday(d);
  const e = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  e.setDate(e.getDate() + 6);
  return e;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

async function apiJson(url, opts) {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.success === false) {
    const msg = (data && data.message) || `请求失败（${resp.status}）`;
    throw new Error(msg);
  }
  return data;
}

const state = {
  tags: { income: [], expense: [] },
  entries: [],
  filteredEntries: [],
  range: { preset: "week", start: "", end: "" },
  entryModal: { mode: "add", editingId: null },
  confirm: { onOk: null },
  pagination: { currentPage: 1, pageSize: 20, totalPages: 1 },
};

function setPreset(preset) {
  const now = new Date();
  let start = now;
  let end = now;
  if (preset === "today") {
    start = now;
    end = now;
  } else if (preset === "week") {
    start = startOfWeekMonday(now);
    end = endOfWeekSunday(now);
  } else if (preset === "month") {
    start = startOfMonth(now);
    end = endOfMonth(now);
  } else if (preset === "range") {
    // keep current start/end if valid, else default to today
    const curS = parseDateStr(qs("ledger-start").value);
    const curE = parseDateStr(qs("ledger-end").value);
    start = curS || now;
    end = curE || now;
  }
  state.range.preset = preset;
  state.range.start = toDateStr(start);
  state.range.end = toDateStr(end);
  qs("ledger-start").value = state.range.start;
  qs("ledger-end").value = state.range.end;
  const editable = preset === "range";
  qs("ledger-start").disabled = !editable;
  qs("ledger-end").disabled = !editable;
}

function renderTotals(totals) {
  qs("ledger-income-total").textContent = (totals?.income_total ?? 0).toFixed(2);
  qs("ledger-expense-total").textContent = (totals?.expense_total ?? 0).toFixed(2);
}

function applyFilterAndSort(entries) {
  const tagFilter = String(qs("ledger-filter-tag")?.value || "");
  const filtered = entries.filter((e) => {
    if (!tagFilter) return true;
    return String(e.tag_id || "") === tagFilter;
  });
  return [...filtered].sort((a, b) => {
    const ta = Number(a.created_at || 0);
    const tb = Number(b.created_at || 0);
    if (tb !== ta) return tb - ta;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function updatePager() {
  const total = state.filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pagination.pageSize));
  state.pagination.totalPages = totalPages;
  if (state.pagination.currentPage > totalPages) state.pagination.currentPage = totalPages;
  if (state.pagination.currentPage < 1) state.pagination.currentPage = 1;

  qs("ledger-count").textContent = `共 ${total} 条`;
  qs("ledger-page-status").textContent = `第 ${state.pagination.currentPage} / ${totalPages} 页`;
  qs("ledger-prev").disabled = state.pagination.currentPage <= 1;
  qs("ledger-next").disabled = state.pagination.currentPage >= totalPages;
  qs("ledger-page-select-trigger").textContent = String(state.pagination.currentPage);

  const dd = qs("ledger-page-select-dropdown");
  dd.innerHTML = "";
  for (let i = 1; i <= totalPages; i += 1) {
    const item = document.createElement("div");
    item.className = `vocab-page-select-option${i === state.pagination.currentPage ? " active" : ""}`;
    item.textContent = String(i);
    item.dataset.page = String(i);
    dd.appendChild(item);
  }
}

function renderEntries(entries) {
  const listEl = qs("ledger-list");
  listEl.innerHTML = "";
  state.filteredEntries = applyFilterAndSort(entries);
  updatePager();
  const startIdx = (state.pagination.currentPage - 1) * state.pagination.pageSize;
  const pageItems = state.filteredEntries.slice(startIdx, startIdx + state.pagination.pageSize);

  function rowHtml(e) {
    const amt = Number(e.amount || 0);
    const isIncome = String(e.kind || "") === "income";
    const typeText = isIncome ? "收入" : "支出";
    const amountText = amt.toFixed(2);
    const desc = String(e.description || "").trim();
    const ann = String(e.annotation || "").trim();
    const tag = String(e.tag_name || "").trim() || "未命名";
    const date = String(e.date || "");
    const descShow = desc || "（无明细）";
    return `
      <div class="ledger-row ledger-table-row" data-entry-id="${e.id}">
        <div class="ledger-cell-date" title="${escapeHtml(date)}">${escapeHtml(date)}</div>
        <div class="ledger-cell-kind">${typeText}</div>
        <div class="ledger-cell-tag" title="${escapeHtml(tag)}">${escapeHtml(tag)}</div>
        <div class="ledger-cell-desc" title="${escapeHtml(descShow)}">${escapeHtml(descShow)}</div>
        <div class="ledger-cell-annotation" title="${escapeHtml(ann)}">${escapeHtml(ann)}</div>
        <div class="ledger-amount ${isIncome ? "ledger-income" : "ledger-expense"}">${escapeHtml(amountText)}</div>
        <div class="ledger-row-actions">
          <button type="button" class="btn vocab-item-edit" data-action="edit">编辑</button>
          <button type="button" class="btn vocab-item-delete" data-action="delete">删除</button>
        </div>
      </div>
    `;
  }

  if (pageItems.length === 0) {
    listEl.innerHTML = `<div class="ledger-empty">暂无记账记录</div>`;
  } else {
    listEl.innerHTML = pageItems.map((e) => rowHtml(e)).join("");
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadTags() {
  const data = await apiJson("/api/ledger/tags", { method: "GET" });
  const tags = Array.isArray(data.items) ? data.items : [];
  state.tags.income = tags.filter((t) => (t.kind || "") === "income");
  state.tags.expense = tags.filter((t) => (t.kind || "") === "expense");
  renderTagFilterOptions();
}

function renderTagFilterOptions() {
  const sel = qs("ledger-filter-tag");
  if (!sel) return;
  const current = sel.value;
  const allTags = [...state.tags.expense, ...state.tags.income];
  sel.innerHTML = `<option value="">全部</option>`;
  for (const t of allTags) {
    const kindText = (t.kind || "") === "income" ? "收入" : "支出";
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = `${kindText} / ${t.name || ""}`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function fillEntryTagSelect(kind, selectedId = null) {
  const sel = qs("ledger-entry-tag");
  const list = kind === "income" ? state.tags.income : state.tags.expense;
  sel.innerHTML = "";
  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "请先在「标签管理」中新增标签";
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
    return;
  }
  for (const t of list) {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.name || "";
    if (selectedId != null && String(selectedId) === String(t.id)) opt.selected = true;
    sel.appendChild(opt);
  }
  if (selectedId == null) sel.selectedIndex = 0;
}

async function queryEntriesAndRender() {
  const start = qs("ledger-start").value;
  const end = qs("ledger-end").value;
  const data = await apiJson(`/api/ledger/entries?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`, {
    method: "GET",
  });
  state.entries = Array.isArray(data.entries) ? data.entries : [];
  state.pagination.currentPage = 1;
  renderTotals(data.totals || { income_total: 0, expense_total: 0 });
  renderEntries(state.entries);
}

function openEntryModal(mode, entry) {
  state.entryModal.mode = mode;
  state.entryModal.editingId = entry ? entry.id : null;
  qs("ledger-entry-modal-title").textContent = mode === "edit" ? "编辑记账" : "新增记账";
  const kind = entry ? String(entry.kind || "expense") : "expense";
  qs("ledger-entry-kind").value = kind;
  qs("ledger-entry-date").value = entry ? String(entry.date || "") : qs("ledger-end").value || toDateStr(new Date());
  qs("ledger-entry-amount").value = entry ? String(Number(entry.amount || 0).toFixed(2)) : "";
  qs("ledger-entry-desc").value = entry ? String(entry.description || "") : "";
  qs("ledger-entry-annotation").value = entry ? String(entry.annotation || "") : "";
  fillEntryTagSelect(kind, entry ? entry.tag_id : null);
  qs("ledger-entry-modal").classList.remove("hidden");
}

function closeEntryModal() {
  qs("ledger-entry-modal").classList.add("hidden");
  state.entryModal.mode = "add";
  state.entryModal.editingId = null;
  qs("ledger-entry-desc").value = "";
  qs("ledger-entry-annotation").value = "";
}

function openTagsModal() {
  const overlay = qs("ledger-tags-drawer-overlay");
  const drawer = qs("ledger-tags-drawer");
  if (!overlay || !drawer) return;
  overlay.hidden = false;
  drawer.hidden = false;
  // ensure transition plays
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    drawer.classList.add("open");
  });
}

function closeTagsModal() {
  const overlay = qs("ledger-tags-drawer-overlay");
  const drawer = qs("ledger-tags-drawer");
  if (!overlay || !drawer) return;
  overlay.classList.remove("open");
  drawer.classList.remove("open");
  // hide after transition to avoid flash on next load
  setTimeout(() => {
    overlay.hidden = true;
    drawer.hidden = true;
  }, 200);
}

function openConfirm(text, onOk) {
  qs("ledger-confirm-text").textContent = text || "";
  state.confirm.onOk = onOk;
  qs("ledger-confirm-modal").classList.remove("hidden");
}

function closeConfirm() {
  qs("ledger-confirm-modal").classList.add("hidden");
  state.confirm.onOk = null;
}

function renderTagsList() {
  const wrap = qs("ledger-tags-list");
  const tags = [...state.tags.expense, ...state.tags.income];
  if (!tags.length) {
    wrap.innerHTML = `<div class="ledger-empty">暂无标签</div>`;
    return;
  }
  const kindText = (k) => (k === "income" ? "收入" : "支出");
  const kindClass = (k) => (k === "income" ? "ledger-income" : "ledger-expense");
  wrap.innerHTML = tags
    .map((t) => {
      const k = String(t.kind || "");
      return `
      <div class="ledger-tag-row" data-tag-id="${t.id}">
        <div class="ledger-tag-left">
          <span class="ledger-tag-kind ${kindClass(k)}">${kindText(k)}</span>
          <span class="ledger-tag-name">${escapeHtml(t.name || "")}</span>
        </div>
        <div class="ledger-tag-actions">
          <button type="button" class="btn vocab-item-edit" data-action="edit">编辑</button>
          <button type="button" class="btn vocab-item-delete" data-action="delete">删除</button>
        </div>
      </div>
    `;
    })
    .join("");
}

function setTagRowEditing(rowEl, tag) {
  rowEl.innerHTML = `
    <div class="ledger-tag-left" style="flex:1; min-width:0;">
      <span class="ledger-tag-kind ${tag.kind === "income" ? "ledger-income" : "ledger-expense"}">${tag.kind === "income" ? "收入" : "支出"}</span>
      <input type="text" class="field-control" value="${escapeHtml(tag.name || "")}" data-role="edit-input" style="height:32px; flex:1; min-width: 180px;" />
    </div>
    <div class="ledger-tag-actions">
      <button type="button" class="btn primary" data-action="save" style="height:32px;">保存</button>
      <button type="button" class="btn btn-ghost" data-action="cancel" style="height:32px;">取消</button>
    </div>
  `;
}

async function initLedger() {
  // initial preset + range inputs
  qs("ledger-preset").value = "week";
  setPreset("week");

  await loadTags();
  await queryEntriesAndRender();

  qs("ledger-preset").addEventListener("change", async () => {
    try {
      setPreset(qs("ledger-preset").value);
      await queryEntriesAndRender();
    } catch (e) {
      showToast(e.message || "查询失败", "error");
    }
  });

  const onRangeInput = async () => {
    if (qs("ledger-preset").value !== "range") return;
    try {
      await queryEntriesAndRender();
    } catch (e) {
      showToast(e.message || "查询失败", "error");
    }
  };
  qs("ledger-start").addEventListener("change", onRangeInput);
  qs("ledger-end").addEventListener("change", onRangeInput);
  qs("ledger-filter-tag").addEventListener("change", () => {
    state.pagination.currentPage = 1;
    renderEntries(state.entries);
  });

  qs("btn-ledger-add").addEventListener("click", async () => {
    try {
      await loadTags();
      openEntryModal("add", null);
    } catch (e) {
      showToast(e.message || "加载标签失败", "error");
    }
  });

  qs("btn-ledger-tags").addEventListener("click", async () => {
    try {
      await loadTags();
      renderTagsList();
      openTagsModal();
    } catch (e) {
      showToast(e.message || "加载标签失败", "error");
    }
  });

  qs("ledger-entry-kind").addEventListener("change", () => {
    fillEntryTagSelect(qs("ledger-entry-kind").value, null);
  });

  qs("ledger-entry-cancel").addEventListener("click", closeEntryModal);
  qs("ledger-entry-modal").addEventListener("click", (ev) => {
    if (ev.target === qs("ledger-entry-modal")) closeEntryModal();
  });

  qs("ledger-entry-save").addEventListener("click", async () => {
    const kind = qs("ledger-entry-kind").value;
    const date = qs("ledger-entry-date").value;
    const tagId = qs("ledger-entry-tag").value;
    const amount = Number(qs("ledger-entry-amount").value);
    const description = String(qs("ledger-entry-desc").value || "").trim();
    const annotation = String(qs("ledger-entry-annotation").value || "").trim();

    if (!date) return showToast("请选择日期", "error");
    if (!tagId) return showToast("请先选择或新增标签", "error");
    if (!Number.isFinite(amount) || amount <= 0) return showToast("金额必须为正数", "error");
    if (!description) return showToast("请填写明细", "error");
    if (description.length > 200) return showToast("明细不能超过200字", "error");
    if (annotation.length > 30) return showToast("批注不能超过30字", "error");

    const payload = {
      date,
      kind,
      tag_id: Number(tagId),
      amount: Number(amount.toFixed(2)),
      description,
      annotation,
    };

    try {
      if (state.entryModal.mode === "edit" && state.entryModal.editingId != null) {
        await apiJson(`/api/ledger/entries/${state.entryModal.editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showToast("已保存", "success");
      } else {
        await apiJson("/api/ledger/entries", { method: "POST", body: JSON.stringify(payload) });
        showToast("已新增", "success");
      }
      closeEntryModal();
      await queryEntriesAndRender();
    } catch (e) {
      showToast(e.message || "保存失败", "error");
    }
  });

  // click rows actions (delegate)
  const onListClick = async (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!btn) return;
    const row = ev.target.closest(".ledger-row");
    const entryId = row?.getAttribute("data-entry-id");
    if (!entryId) return;
    const entry = state.entries.find((x) => String(x.id) === String(entryId));
    if (!entry) return;

    const action = btn.getAttribute("data-action");
    if (action === "edit") {
      try {
        await loadTags();
        openEntryModal("edit", entry);
      } catch (e) {
        showToast(e.message || "加载失败", "error");
      }
    } else if (action === "delete") {
      openConfirm("确认删除这条记账记录？", async () => {
        try {
          await apiJson(`/api/ledger/entries/${entry.id}`, { method: "DELETE" });
          showToast("已删除", "success");
          closeConfirm();
          await queryEntriesAndRender();
        } catch (e) {
          showToast(e.message || "删除失败", "error");
        }
      });
    }
  };
  qs("ledger-list").addEventListener("click", onListClick);

  qs("ledger-prev").addEventListener("click", () => {
    if (state.pagination.currentPage <= 1) return;
    state.pagination.currentPage -= 1;
    renderEntries(state.entries);
  });
  qs("ledger-next").addEventListener("click", () => {
    if (state.pagination.currentPage >= state.pagination.totalPages) return;
    state.pagination.currentPage += 1;
    renderEntries(state.entries);
  });
  qs("ledger-page-select-trigger").addEventListener("click", () => {
    qs("ledger-page-select-dropdown").classList.toggle("open");
  });
  qs("ledger-page-select-dropdown").addEventListener("click", (ev) => {
    const option = ev.target.closest(".vocab-page-select-option");
    if (!option) return;
    const page = Number(option.dataset.page || "1");
    state.pagination.currentPage = Number.isFinite(page) ? page : 1;
    qs("ledger-page-select-dropdown").classList.remove("open");
    renderEntries(state.entries);
  });
  document.addEventListener("click", (ev) => {
    const wrap = qs("ledger-page-select-wrap");
    if (!wrap || wrap.contains(ev.target)) return;
    qs("ledger-page-select-dropdown").classList.remove("open");
  });

  // confirm modal
  qs("ledger-confirm-cancel").addEventListener("click", closeConfirm);
  qs("ledger-confirm-ok").addEventListener("click", async () => {
    const fn = state.confirm.onOk;
    if (!fn) return closeConfirm();
    await fn();
  });
  qs("ledger-confirm-modal").addEventListener("click", (ev) => {
    if (ev.target === qs("ledger-confirm-modal")) closeConfirm();
  });

  // tags drawer actions
  qs("ledger-tags-drawer-close").addEventListener("click", closeTagsModal);
  qs("ledger-tags-drawer-ok").addEventListener("click", closeTagsModal);
  qs("ledger-tags-drawer-overlay").addEventListener("click", closeTagsModal);

  qs("btn-ledger-tag-add").addEventListener("click", async () => {
    const kind = qs("ledger-tag-kind").value;
    const name = String(qs("ledger-tag-name").value || "").trim();
    if (!name) return showToast("请输入标签名称", "error");
    try {
      await apiJson("/api/ledger/tags", { method: "POST", body: JSON.stringify({ kind, name }) });
      qs("ledger-tag-name").value = "";
      showToast("标签已新增", "success");
      await loadTags();
      renderTagsList();
    } catch (e) {
      showToast(e.message || "新增失败", "error");
    }
  });

  qs("ledger-tags-list").addEventListener("click", async (ev) => {
    const row = ev.target.closest(".ledger-tag-row");
    const actionBtn = ev.target.closest("button[data-action]");
    if (!row || !actionBtn) return;
    const tagId = row.getAttribute("data-tag-id");
    const all = [...state.tags.expense, ...state.tags.income];
    const tag = all.find((t) => String(t.id) === String(tagId));
    if (!tag) return;

    const action = actionBtn.getAttribute("data-action");
    if (action === "edit") {
      setTagRowEditing(row, tag);
    } else if (action === "delete") {
      openConfirm("确认删除该标签？（若有关联记账将被拦截）", async () => {
        try {
          await apiJson(`/api/ledger/tags/${tag.id}`, { method: "DELETE" });
          showToast("标签已删除", "success");
          closeConfirm();
          await loadTags();
          renderTagsList();
          await queryEntriesAndRender();
        } catch (e) {
          showToast(e.message || "删除失败", "error");
        }
      });
    } else if (action === "cancel") {
      renderTagsList();
    } else if (action === "save") {
      const input = row.querySelector('input[data-role="edit-input"]');
      const newName = String(input?.value || "").trim();
      if (!newName) return showToast("标签名称不能为空", "error");
      try {
        await apiJson(`/api/ledger/tags/${tag.id}`, { method: "PUT", body: JSON.stringify({ name: newName }) });
        showToast("标签已更新", "success");
        await loadTags();
        renderTagsList();
        await queryEntriesAndRender();
      } catch (e) {
        showToast(e.message || "更新失败", "error");
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLedger().catch((e) => {
    showToast(e.message || "初始化失败", "error");
  });
});


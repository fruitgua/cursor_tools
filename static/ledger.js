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

/** 用于统计区「今日」文案：YYYY-MM-DD → 2026年4月19日 周日 */
function formatZhDateWithWeekday(iso) {
  const d = parseDateStr(String(iso || "").trim());
  if (!d) return "";
  const wk = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wk[d.getDay()]}`;
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

const LEDGER_GAUGE_ARC_LEN = Math.PI * 42;

function ledgerGaugeFxForPct(pct) {
  if (!Number.isFinite(pct) || pct <= 80) return null;
  if (pct <= 100) {
    return { cls: "is-warn", src: "/static/gauge-fx-warning.gif", alt: "预警" };
  }
  if (pct <= 150) {
    return { cls: "is-angry", src: "/static/gauge-fx-angry.gif", alt: "发火" };
  }
  return { cls: "is-bomb", src: "/static/gauge-fx-bomb.gif", alt: "炸弹" };
}

function renderGaugeInto(mount, title, g, opts) {
  if (!mount) return;
  const omitBottomPeriod = opts && opts.omitBottomPeriod;
  const hideSub = opts && opts.hideSub;
  const pct = g && g.budget_ratio_percent != null ? Number(g.budget_ratio_percent) : null;
  const budget = g && g.daily_budget != null ? Number(g.daily_budget) : null;
  const spent = g && g.expense_daily_for_budget != null ? Number(g.expense_daily_for_budget) : 0;
  const periodLabel = (g && g.period_label) || "";
  const L = LEDGER_GAUGE_ARC_LEN;
  const arcFrac = pct == null ? 0 : Math.min(100, Math.max(0, pct)) / 100;
  const dashOff = L * (1 - arcFrac);
  const over = pct != null && pct > 100;
  const pctText = pct != null ? `${pct}%` : "—";
  const sub =
    budget != null ? `日常类 ${spent.toFixed(2)} / 预算 ${budget.toFixed(2)}` : "该周期未设置支出预算";
  const titleHtml =
    title && String(title).trim()
      ? `<div class="ledger-gauge-title">${escapeHtml(String(title))}</div>`
      : "";
  const periodHtml = omitBottomPeriod
    ? ""
    : `<div class="ledger-gauge-period">${escapeHtml(periodLabel)}</div>`;
  const fx = ledgerGaugeFxForPct(pct);
  const fxHtml = fx
    ? `<img class="ledger-gauge-fx ${fx.cls}" src="${fx.src}" alt="${fx.alt}" loading="lazy" onerror="this.style.display='none'" />`
    : "";
  mount.innerHTML = `
    ${titleHtml}
    <div class="ledger-gauge-svgwrap">
      ${fxHtml}
      <svg class="ledger-gauge-svg" viewBox="0 0 120 72" aria-hidden="true">
        <path class="ledger-gauge-track" d="M 18 58 A 42 42 0 0 1 102 58" fill="none" stroke-width="9" stroke-linecap="round"/>
        <path class="ledger-gauge-fill${over ? " is-over" : ""}" d="M 18 58 A 42 42 0 0 1 102 58" fill="none" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${L}" stroke-dashoffset="${dashOff}"/>
      </svg>
    </div>
    <div class="ledger-gauge-pct">${escapeHtml(pctText)}</div>
    ${hideSub ? "" : `<div class="ledger-gauge-sub">${escapeHtml(sub)}</div>`}
    ${periodHtml}
  `;
}

function ledgerStatsGaugePeriodText(g) {
  if (!g || typeof g !== "object") return "";
  const lab = String(g.period_label || "").trim();
  if (lab) return lab;
  const a = String(g.start_date || "").trim();
  const b = String(g.end_date || "").trim();
  if (a && b) return `${a} ~ ${b}`;
  return "";
}

/** 按日期查询结果里「该周」周期文案：仅起止日期，不含「周一」「周日」等前缀。 */
function ledgerStatsQueryWeekPeriodDatesOnly(g) {
  if (!g || typeof g !== "object") return "";
  const a = String(g.start_date || "").trim();
  const b = String(g.end_date || "").trim();
  if (a && b) return `${a} ~ ${b}`;
  return "";
}

function renderTagRatioListMount(mount, payload) {
  if (!mount) return;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    mount.innerHTML = `<div class="muted ledger-tagratio-empty">暂无支出或未打标签</div>`;
    return;
  }
  const rows = items
    .map((it) => {
      const name = escapeHtml(String(it.tag_name || "未命名"));
      const pctNum = Number(it.ratio_percent != null ? it.ratio_percent : Number(it.ratio || 0) * 100);
      const pct = pctNum.toFixed(1);
      const amt = Number(it.amount || 0).toFixed(2);
      const highCls = pctNum > 30 ? " is-high-pct" : "";
      return `<div class="ledger-tagratio-row${highCls}"><span class="ledger-tagratio-name" title="${name}">${name}</span><span class="ledger-tagratio-num">${pct}%</span><span class="ledger-tagratio-amt muted">${amt}</span></div>`;
    })
    .join("");
  mount.innerHTML = rows;
}

function ledgerFmtTriple(obj) {
  const o = obj || {};
  return {
    inc: Number(o.income_total || 0).toFixed(2),
    exp: Number(o.expense_total || 0).toFixed(2),
    dly: Number(o.daily_expense_total || 0).toFixed(2),
  };
}

function ledgerStatsTripleMetricsHtml(m) {
  return `
        <div class="ledger-stats-query-metrics">
          <div class="ledger-stats-query-metric"><span class="lbl">收入</span><span class="val ledger-income">${m.inc}</span></div>
          <div class="ledger-stats-query-metric"><span class="lbl">支出</span><span class="val ledger-expense">${m.exp}</span></div>
          <div class="ledger-stats-query-metric"><span class="lbl">日常支出</span><span class="val ledger-expense">${m.dly}</span></div>
        </div>`;
}

function ledgerMonthChartNiceCeil(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const pow = 10 ** exp;
  const f = x / pow;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * pow;
}

function ledgerMonthChartFmtY(v) {
  if (!Number.isFinite(v)) return "0";
  const av = Math.abs(v);
  if (av >= 100000) return `${(v / 10000).toFixed(1)}万`;
  if (av >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (av >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (av >= 10) return String(Math.round(v));
  return v.toFixed(1);
}

function ledgerMonthChartDayAxisLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!m) return String(iso || "");
  return `${Number(m[2])}/${Number(m[3])}`;
}

function ledgerMoneyTrimZeros(v) {
  if (!Number.isFinite(v)) return "0";
  return Number(v.toFixed(2)).toString();
}

function buildMonthChartTooltipHtml(ds, expense, dailyExpense) {
  const d = escapeHtml(String(ds || "").trim());
  const e = escapeHtml(`￥${ledgerMoneyTrimZeros(expense)}`);
  const de = escapeHtml(`￥${ledgerMoneyTrimZeros(dailyExpense)}`);
  return `
    <div class="ledger-month-chart-tip-line">日期：${d}</div>
    <div class="ledger-month-chart-tip-line">支出：<span class="ledger-month-chart-tip-money">${e}</span></div>
    <div class="ledger-month-chart-tip-line">日常支出：<span class="ledger-month-chart-tip-money">${de}</span></div>
  `;
}

/** 当月每日支出柱状图：横轴日期，悬停/单击显示标注弹层。 */
function renderLedgerMonthDailyBarChart(mountEl, series) {
  if (!mountEl) return;
  const arr = Array.isArray(series) ? series : [];
  if (!arr.length) {
    mountEl.innerHTML = `<div class="muted ledger-month-chart-empty">暂无数据</div>`;
    return;
  }
  const W = 880;
  const H = 260;
  const padL = 52;
  const padR = 12;
  const padT = 14;
  const padB = 42;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = arr.map((x) => Number(x.expense_total || 0));
  const maxY = ledgerMonthChartNiceCeil(Math.max(...vals, 0.01));
  const n = arr.length;
  const slotW = plotW / Math.max(n, 1);
  const barW = Math.max(2, Math.min(slotW * 0.62, 22));
  const ticks = 4;
  let parts = "";
  for (let t = 0; t <= ticks; t += 1) {
    const ratio = t / ticks;
    const yv = maxY * (1 - ratio);
    const y = padT + ratio * plotH;
    const lab = ledgerMonthChartFmtY(yv);
    parts += `<line class="ledger-month-chart-grid" x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke-width="1"/>`;
    parts += `<text class="ledger-month-chart-ytick" x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="10">${escapeHtml(
      lab,
    )}</text>`;
  }
  for (let i = 0; i < n; i += 1) {
    const v = vals[i];
    const dailyV = Number(arr[i].daily_expense_total || 0);
    const h = (v / maxY) * plotH;
    const x = padL + i * slotW + (slotW - barW) / 2;
    const y = padT + plotH - h;
    const bh = Math.max(h, v > 0 ? 1 : 0);
    const ds = String(arr[i].date || "").trim();
    parts += `<rect class="ledger-month-chart-bar" data-date="${escapeHtml(ds)}" data-expense="${v}" data-daily-expense="${dailyV}" x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2"></rect>`;
    const lx = padL + i * slotW + slotW / 2;
    let lab = ledgerMonthChartDayAxisLabel(ds);
    if (n > 22 && i % 2 === 1) lab = "";
    if (n > 30 && i % 3 !== 0) lab = "";
    if (lab) {
      parts += `<text class="ledger-month-chart-xtick" x="${lx}" y="${H - 10}" text-anchor="middle" font-size="9">${escapeHtml(
        lab,
      )}</text>`;
    }
  }
  mountEl.innerHTML = `<div class="ledger-month-chart-wrap"><svg class="ledger-month-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="当月每日支出柱状图">${parts}</svg><div class="ledger-month-chart-tooltip" hidden></div></div>`;
  const tipEl = mountEl.querySelector(".ledger-month-chart-tooltip");
  const svgEl = mountEl.querySelector(".ledger-month-chart-svg");
  const bars = mountEl.querySelectorAll(".ledger-month-chart-bar");
  if (!tipEl || !svgEl || !bars.length) return;
  let pinnedBar = null;
  const hideTooltip = () => {
    if (pinnedBar) return;
    tipEl.hidden = true;
  };
  const positionTooltip = (barEl) => {
    const chartRect = mountEl.getBoundingClientRect();
    const barRect = barEl.getBoundingClientRect();
    const left = barRect.left - chartRect.left + barRect.width / 2;
    const top = Math.max(6, barRect.top - chartRect.top - 8);
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  };
  const showTooltip = (barEl) => {
    const ds = barEl.getAttribute("data-date") || "";
    const exp = Number(barEl.getAttribute("data-expense") || 0);
    const dailyExp = Number(barEl.getAttribute("data-daily-expense") || 0);
    tipEl.innerHTML = buildMonthChartTooltipHtml(ds, exp, dailyExp);
    positionTooltip(barEl);
    tipEl.hidden = false;
  };
  bars.forEach((barEl) => {
    barEl.addEventListener("mouseenter", () => {
      if (pinnedBar && pinnedBar !== barEl) return;
      showTooltip(barEl);
    });
    barEl.addEventListener("mousemove", () => {
      if (pinnedBar && pinnedBar !== barEl) return;
      positionTooltip(barEl);
    });
    barEl.addEventListener("mouseleave", () => {
      if (!pinnedBar) hideTooltip();
    });
    barEl.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (pinnedBar === barEl) {
        pinnedBar = null;
        hideTooltip();
        return;
      }
      pinnedBar = barEl;
      showTooltip(barEl);
    });
  });
  svgEl.addEventListener("mouseleave", () => {
    if (!pinnedBar) hideTooltip();
  });
  mountEl.addEventListener("click", (ev) => {
    const bar = ev.target && ev.target.closest ? ev.target.closest(".ledger-month-chart-bar") : null;
    if (bar) return;
    pinnedBar = null;
    hideTooltip();
  });
}

function attachLedgerSimpleTooltip(mountEl, targetSelector, htmlBuilder) {
  const tipEl = mountEl?.querySelector?.(".ledger-hbar-tooltip");
  if (!tipEl) return;
  const targets = mountEl.querySelectorAll(targetSelector);
  if (!targets.length) return;
  let pinned = null;
  const place = (el) => {
    const mr = mountEl.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    tipEl.style.left = `${tr.right - mr.left + 8}px`;
    tipEl.style.top = `${tr.top - mr.top + tr.height / 2}px`;
  };
  const show = (el) => {
    tipEl.innerHTML = htmlBuilder ? htmlBuilder(el) : "";
    place(el);
    tipEl.hidden = false;
  };
  const hide = () => {
    if (pinned) return;
    tipEl.hidden = true;
  };
  targets.forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (pinned && pinned !== el) return;
      show(el);
    });
    el.addEventListener("mousemove", () => {
      if (pinned && pinned !== el) return;
      place(el);
    });
    el.addEventListener("mouseleave", hide);
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (pinned === el) {
        pinned = null;
        hide();
      } else {
        pinned = el;
        show(el);
      }
    });
  });
  mountEl.addEventListener("click", (ev) => {
    const hit = ev.target?.closest?.(targetSelector);
    if (hit) return;
    pinned = null;
    hide();
  });
}

function renderLedgerWeekDailyHorizontalChart(mountEl, series) {
  if (!mountEl) return;
  const arr = Array.isArray(series) ? series : [];
  if (!arr.length) {
    mountEl.innerHTML = `<div class="muted ledger-month-chart-empty">暂无数据</div>`;
    return;
  }
  const W = Math.max(460, Math.floor((mountEl.clientWidth || 460) * 1.04));
  const padTop = 10;
  const padRight = 10;
  const padBottom = 10;
  const padLeft = 10;
  const yLabelW = 38;
  const chartX = padLeft + yLabelW;
  const rowH = 42;
  const rowGap = 12;
  const H = padTop + arr.length * (rowH + rowGap) + padBottom;
  const plotW = W - chartX - padRight;
  const maxV = Math.max(
    0.01,
    ...arr.map((x) =>
      Math.max(Number(x.income_total || 0), Number(x.daily_expense_total || 0), Number(x.nondaily_expense_total || 0)),
    ),
  );
  const maxX = ledgerMonthChartNiceCeil(maxV);
  let parts = "";
  arr.forEach((r, idx) => {
    const y = padTop + idx * (rowH + rowGap);
    const ds = String(r.date || "");
    const label = ledgerMonthChartDayAxisLabel(ds);
    const iv = Number(r.income_total || 0);
    const dv = Number(r.daily_expense_total || 0);
    const nv = Number(r.nondaily_expense_total || 0);
    const iW = (iv / maxX) * plotW;
    const dW = (dv / maxX) * plotW;
    const nW = (nv / maxX) * plotW;
    const barY = y + 8;
    parts += `<text class="ledger-hbar-ylabel" x="${chartX - 8}" y="${y + 21}" text-anchor="end">${escapeHtml(label)}</text>`;
    parts += `<rect class="ledger-hbar-track" x="${chartX}" y="${barY}" width="${plotW}" height="14" rx="5"></rect>`;
    if (iW > 0) {
      parts += `<rect class="ledger-hbar-income ledger-hbar-item" data-date="${escapeHtml(ds)}" data-series-name="收入" data-amount="${iv}" x="${chartX}" y="${barY}" width="${iW}" height="14" rx="5"></rect>`;
    }
    if (dW > 0) {
      parts += `<rect class="ledger-hbar-daily ledger-hbar-item" data-date="${escapeHtml(ds)}" data-series-name="日常支出" data-amount="${dv}" x="${chartX + iW}" y="${barY}" width="${dW}" height="14" rx="5"></rect>`;
    }
    if (nW > 0) {
      parts += `<rect class="ledger-hbar-nondaily ledger-hbar-item" data-date="${escapeHtml(ds)}" data-series-name="非日常支出" data-amount="${nv}" x="${chartX + iW + dW}" y="${barY}" width="${nW}" height="14" rx="5"></rect>`;
    }
  });
  mountEl.innerHTML = `<div class="ledger-hbar-wrap"><svg class="ledger-hbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="周度每日消费统计图">${parts}</svg><div class="ledger-hbar-tooltip" hidden></div></div>`;
  attachLedgerSimpleTooltip(mountEl, ".ledger-hbar-item", (el) => {
    const ds = String(el.getAttribute("data-date") || "");
    const nm = String(el.getAttribute("data-series-name") || "");
    const amt = Number(el.getAttribute("data-amount") || 0);
    return `<div class="ledger-hbar-tip-line">日期：${escapeHtml(ds)}</div><div class="ledger-hbar-tip-line">${escapeHtml(
      nm,
    )}：<span class="ledger-hbar-tip-money">￥${escapeHtml(ledgerMoneyTrimZeros(amt))}</span></div>`;
  });
}

function renderLedgerMonthWeeklyHorizontalChart(mountEl, series) {
  if (!mountEl) return;
  const arr = Array.isArray(series) ? series : [];
  if (!arr.length) {
    mountEl.innerHTML = `<div class="muted ledger-month-chart-empty">暂无数据</div>`;
    return;
  }
  const W = Math.max(460, Math.floor((mountEl.clientWidth || 460) * 1.04));
  const H = 280;
  const padL = 42;
  const padR = 12;
  const padT = 34;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxY = ledgerMonthChartNiceCeil(Math.max(0.01, ...arr.map((x) => Number(x.expense_total || 0))));
  const n = arr.length;
  const slotW = plotW / Math.max(n, 1);
  const barW = Math.max(16, Math.min(slotW * 0.46, 34));
  const ticks = 4;
  let parts = "";
  for (let t = 0; t <= ticks; t += 1) {
    const ratio = t / ticks;
    const y = padT + ratio * plotH;
    const val = maxY * (1 - ratio);
    parts += `<line class="ledger-month-chart-grid" x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke-width="1"></line>`;
    parts += `<text class="ledger-hbar-ylabel" x="${padL - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(ledgerMonthChartFmtY(
      val,
    ))}</text>`;
  }
  arr.forEach((r, idx) => {
    const label = String(r.label || `${r.week_start || ""}~${r.week_end || ""}`);
    const dv = Number(r.daily_expense_total || 0);
    const nv = Number(r.nondaily_expense_total || 0);
    const dH = (dv / maxY) * plotH;
    const nH = (nv / maxY) * plotH;
    const x = padL + idx * slotW + (slotW - barW) / 2;
    const yBase = padT + plotH;
    const yDaily = yBase - dH;
    const yNonDaily = yDaily - nH;
    const weekText = `第${idx + 1}周`;
    const commonData = `data-label="${escapeHtml(label)}" data-total="${Number(r.expense_total || 0)}" data-daily="${dv}" data-nondaily="${nv}"`;
    if (dH > 0) {
      parts += `<rect class="ledger-hbar-daily ledger-hbar-item" ${commonData} x="${x}" y="${yDaily}" width="${barW}" height="${dH}" rx="4"></rect>`;
    }
    if (nH > 0) {
      parts += `<rect class="ledger-hbar-nondaily ledger-hbar-item" ${commonData} x="${x}" y="${yNonDaily}" width="${barW}" height="${nH}" rx="4"></rect>`;
    }
    parts += `<text class="ledger-hbar-xtick" x="${x + barW / 2}" y="${H - 12}" text-anchor="middle">${escapeHtml(
      weekText,
    )}</text>`;
  });
  mountEl.innerHTML = `<div class="ledger-hbar-wrap"><svg class="ledger-hbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="月度每周消费统计柱状图">${parts}</svg><div class="ledger-hbar-tooltip" hidden></div></div>`;
  attachLedgerSimpleTooltip(mountEl, ".ledger-hbar-item", (el) => {
    const ds = String(el.getAttribute("data-label") || "");
    const t = Number(el.getAttribute("data-total") || 0);
    const dv = Number(el.getAttribute("data-daily") || 0);
    const nv = Number(el.getAttribute("data-nondaily") || 0);
    return `<div class="ledger-hbar-tip-line">周期：${escapeHtml(ds)}</div><div class="ledger-hbar-tip-line">支出：<span class="ledger-hbar-tip-money">￥${escapeHtml(
      ledgerMoneyTrimZeros(t),
    )}</span></div><div class="ledger-hbar-tip-line">日常支出：<span class="ledger-hbar-tip-money">￥${escapeHtml(
      ledgerMoneyTrimZeros(dv),
    )}</span></div><div class="ledger-hbar-tip-line">非日常支出：<span class="ledger-hbar-tip-money">￥${escapeHtml(
      ledgerMoneyTrimZeros(nv),
    )}</span></div>`;
  });
}

function ledgerGaugeSplitMetricsHtml(m, gaugeObj) {
  const budget = gaugeObj && gaugeObj.daily_budget != null ? Number(gaugeObj.daily_budget || 0).toFixed(2) : "—";
  return `<div class="ledger-gauge-split-metrics">
    <div class="ledger-gauge-split-row"><span class="lbl">收入</span><span class="val ledger-gauge-val-income">${m.inc}</span></div>
    <div class="ledger-gauge-split-row"><span class="lbl">总支出</span><span class="val ledger-gauge-val-expense">${m.exp}</span></div>
    <div class="ledger-gauge-split-row"><span class="lbl">日常支出</span><span class="val ledger-gauge-val-expense">${m.dly}</span></div>
    <div class="ledger-gauge-split-row"><span class="lbl">预算</span><span class="val">${escapeHtml(budget)}</span></div>
  </div>`;
}

/** 统计 Tab「当期消费汇总」：与服务器基准日对齐的周/月汇总。 */
function renderLedgerCurrentOverview(data) {
  const cur = data.current || {};
  const g = data.gauges || {};
  const tr = data.tag_ratios || {};
  const serverDate = String(data.server_date || "").trim() || toDateStr(new Date());
  const stripEl = qs("ledger-stats-today-strip");
  if (stripEl) {
    const zh = formatZhDateWithWeekday(serverDate);
    const fd = ledgerFmtTriple(cur.day);
    stripEl.textContent = `${zh} 收入 ￥${fd.inc} 支出 ￥${fd.exp} 日常支出 ￥${fd.dly}`;
  }
  const twg = g.this_week || {};
  const pwg = g.prev_week || {};
  const tmg = g.this_month || {};
  const wp = escapeHtml(ledgerStatsQueryWeekPeriodDatesOnly(twg));
  const pwp = escapeHtml(ledgerStatsQueryWeekPeriodDatesOnly(pwg));
  const mp = escapeHtml(ledgerStatsGaugePeriodText(tmg));
  const w = ledgerFmtTriple(cur.week);
  const pw = ledgerFmtTriple(cur.prev_week || {});
  const m = ledgerFmtTriple(cur.month);
  const weekDaily = Array.isArray(data.week_daily_breakdown) ? data.week_daily_breakdown : [];
  const monthWeekly = Array.isArray(data.month_weekly_expense) ? data.month_weekly_expense : [];
  const mount = qs("ledger-stats-current-stack");
  if (!mount) return;
  mount.innerHTML = `
    <div class="ledger-stats-current-row ledger-stats-current-row--r1">
      <div class="ledger-stats-query-col ledger-gauge-split-card">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">当周</span>
          <span class="ledger-stats-query-col-period ledger-stats-query-col-period--week">${wp || "—"}</span>
        </div>
        <div class="ledger-gauge-split-body">
          <div class="ledger-gauge-split-left"><div class="ledger-gauge-split-mount ledger-gauge" id="ledger-overview-gauge-week"></div></div>
          <div class="ledger-gauge-split-right">${ledgerGaugeSplitMetricsHtml(w, twg)}</div>
        </div>
      </div>
      <div class="ledger-stats-query-col ledger-gauge-split-card">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">前周</span>
          <span class="ledger-stats-query-col-period ledger-stats-query-col-period--week">${pwp || "—"}</span>
        </div>
        <div class="ledger-gauge-split-body">
          <div class="ledger-gauge-split-left"><div class="ledger-gauge-split-mount ledger-gauge" id="ledger-overview-gauge-prev-week"></div></div>
          <div class="ledger-gauge-split-right">${ledgerGaugeSplitMetricsHtml(pw, pwg)}</div>
        </div>
      </div>
      <div class="ledger-stats-query-col ledger-gauge-split-card">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">当月</span>
          <span class="ledger-stats-query-col-period">${mp || "—"}</span>
        </div>
        <div class="ledger-gauge-split-body">
          <div class="ledger-gauge-split-left"><div class="ledger-gauge-split-mount ledger-gauge" id="ledger-overview-gauge-month"></div></div>
          <div class="ledger-gauge-split-right">${ledgerGaugeSplitMetricsHtml(m, tmg)}</div>
        </div>
      </div>
    </div>
    <div class="ledger-stats-current-row ledger-stats-current-row--r2">
      <div class="ledger-stats-query-col">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">周消费占比</span>
          <span class="ledger-stats-query-col-period ledger-stats-query-col-period--week">${wp || "—"}</span>
        </div>
        <div id="ledger-overview-tags-week" class="ledger-stats-tagratio-list ledger-stats-query-taglist"></div>
      </div>
      <div class="ledger-stats-query-col">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">周度每日消费统计</span>
          <span class="ledger-stats-query-col-period ledger-stats-query-col-period--week">${wp || "—"}</span>
        </div>
        <div id="ledger-overview-week-daily-chart" class="ledger-month-chart-mount"></div>
      </div>
      <div class="ledger-stats-query-col">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">月度每周消费统计</span>
          <span class="ledger-stats-query-col-period">${mp || "—"}</span>
        </div>
        <div id="ledger-overview-month-weekly-chart" class="ledger-month-chart-mount"></div>
      </div>
    </div>
    <div class="ledger-stats-current-row ledger-stats-current-row--r3">
      <div class="ledger-stats-query-col">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">月消费占比</span>
          <span class="ledger-stats-query-col-period">${mp || "—"}</span>
        </div>
        <div id="ledger-overview-tags-month" class="ledger-stats-tagratio-list ledger-stats-query-taglist"></div>
      </div>
      <div class="ledger-stats-query-col ledger-stats-month-chart-card">
        <div class="ledger-stats-query-col-head">
          <span class="ledger-stats-query-col-title">月度每日消费柱状图</span>
          <span class="ledger-stats-query-col-period">${mp || "—"}</span>
        </div>
        <div id="ledger-overview-month-chart" class="ledger-month-chart-mount"></div>
      </div>
    </div>
    `;
  renderGaugeInto(qs("ledger-overview-gauge-week"), "", twg, { omitBottomPeriod: true, hideSub: true });
  renderGaugeInto(qs("ledger-overview-gauge-prev-week"), "", pwg, { omitBottomPeriod: true, hideSub: true });
  renderGaugeInto(qs("ledger-overview-gauge-month"), "", tmg, { omitBottomPeriod: true, hideSub: true });
  renderTagRatioListMount(qs("ledger-overview-tags-week"), tr.week || {});
  renderTagRatioListMount(qs("ledger-overview-tags-month"), tr.month || {});
  renderLedgerWeekDailyHorizontalChart(qs("ledger-overview-week-daily-chart"), weekDaily);
  renderLedgerMonthWeeklyHorizontalChart(qs("ledger-overview-month-weekly-chart"), monthWeekly);
  renderLedgerMonthDailyBarChart(qs("ledger-overview-month-chart"), data.month_daily_expense || []);
}

function syncExpenseNatureVisibility() {
  const kind = qs("ledger-entry-kind")?.value || "";
  const sel = qs("ledger-entry-expense-nature");
  if (!sel) return;
  if (kind === "income") {
    sel.disabled = true;
    sel.value = "";
  } else {
    sel.disabled = false;
    if (!sel.value) sel.value = "daily";
  }
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
  budgetWeeks: [],
  budgetMonths: [],
  confirm: { onOk: null },
  pagination: { currentPage: 1, pageSize: 20, totalPages: 1 },
  ledgerRetentionStart: "",
  ledgerServerDate: "",
};

async function loadLedgerMeta() {
  const resp = await fetch("/api/ledger/meta", { headers: { Accept: "application/json" } });
  const data = await resp.json().catch(() => ({}));
  if (!data || data.success === false) return;
  state.ledgerRetentionStart = String(data.retention_start_date || "").trim();
  state.ledgerServerDate = String(data.server_date || "").trim() || toDateStr(new Date());
  applyLedgerRetentionToInputs();
}

function applyLedgerRetentionToInputs() {
  const min = state.ledgerRetentionStart || "";
  const max = state.ledgerServerDate || toDateStr(new Date());
  ["ledger-start", "ledger-end", "ledger-entry-date", "ledger-stats-query-date"].forEach((id) => {
    const el = qs(id);
    if (!el || el.type !== "date") return;
    el.min = min;
    el.max = max;
  });
  const aend = qs("ledger-archive-end");
  if (aend && aend.type === "date") aend.max = max;
}

function clampLedgerToolbarRange() {
  const min = state.ledgerRetentionStart;
  const max = state.ledgerServerDate || toDateStr(new Date());
  if (!min) return;
  const sEl = qs("ledger-start");
  const eEl = qs("ledger-end");
  if (!sEl || !eEl) return;
  let s = String(sEl.value || "").trim();
  let e = String(eEl.value || "").trim();
  if (s && s < min) s = min;
  if (e && e > max) e = max;
  if (s && e && s > e) e = s;
  if (!s) s = min;
  if (!e) e = max;
  if (s < min) s = min;
  if (e > max) e = max;
  if (s > e) e = s;
  sEl.value = s;
  eEl.value = e;
  state.range.start = s;
  state.range.end = e;
}

async function downloadCsvFile(url, fallbackName) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data && data.message) || `导出失败（${resp.status}）`);
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  const name = (m && m[1]) || fallbackName || "export.csv";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

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
  if (state.ledgerRetentionStart) clampLedgerToolbarRange();
}

function renderTotals(totals) {
  qs("ledger-income-total").textContent = (totals?.income_total ?? 0).toFixed(2);
  qs("ledger-expense-total").textContent = (totals?.expense_total ?? 0).toFixed(2);
  const dailyEl = qs("ledger-daily-expense-total");
  if (dailyEl) dailyEl.textContent = (totals?.daily_expense_total ?? 0).toFixed(2);
}

function calcTotalsFromEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let income = 0;
  let expense = 0;
  let dailyExpense = 0;
  list.forEach((e) => {
    const kind = String(e?.kind || "").toLowerCase();
    const amt = Number(e?.amount || 0);
    if (!Number.isFinite(amt)) return;
    if (kind === "income") {
      income += amt;
      return;
    }
    if (kind === "expense") {
      expense += amt;
      const nature = String(e?.expense_nature || "daily").toLowerCase();
      if (nature !== "fixed") dailyExpense += amt;
    }
  });
  return {
    income_total: income,
    expense_total: expense,
    daily_expense_total: dailyExpense,
  };
}

function applyFilterAndSort(entries) {
  const tagFilter = String(qs("ledger-filter-tag")?.value || "");
  const filtered = entries.filter((e) => {
    if (!tagFilter) return true;
    return String(e.tag_id || "") === tagFilter;
  });
  return [...filtered].sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    if (da !== db) return db.localeCompare(da);
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
  renderTotals(calcTotalsFromEntries(state.filteredEntries));
  updatePager();
  const startIdx = (state.pagination.currentPage - 1) * state.pagination.pageSize;
  const pageItems = state.filteredEntries.slice(startIdx, startIdx + state.pagination.pageSize);

  function rowHtml(e) {
    const amt = Number(e.amount || 0);
    const isIncome = String(e.kind || "") === "income";
    const typeText = isIncome ? "收入" : "支出";
    const natureRaw = String(e.expense_nature || "").toLowerCase();
    const natureText = isIncome ? "—" : natureRaw === "fixed" ? "固定" : "日常";
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
        <div class="ledger-cell-nature">${escapeHtml(natureText)}</div>
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
  sel.innerHTML = `<option value="">全部标签</option>`;
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
  renderEntries(state.entries);
}

function openEntryModal(mode, entry) {
  state.entryModal.mode = mode;
  state.entryModal.editingId = entry ? entry.id : null;
  qs("ledger-entry-modal-title").textContent = mode === "edit" ? "编辑记账" : "新增记账";
  const kind = entry ? String(entry.kind || "expense") : "expense";
  qs("ledger-entry-kind").value = kind;
  const maxD = state.ledgerServerDate || toDateStr(new Date());
  const minD = state.ledgerRetentionStart || "";
  let defDate = entry ? String(entry.date || "") : qs("ledger-end").value || maxD;
  if (minD && defDate && defDate < minD) defDate = minD;
  if (defDate > maxD) defDate = maxD;
  qs("ledger-entry-date").value = defDate;
  qs("ledger-entry-amount").value = entry ? String(Number(entry.amount || 0).toFixed(2)) : "";
  qs("ledger-entry-desc").value = entry ? String(entry.description || "") : "";
  qs("ledger-entry-annotation").value = entry ? String(entry.annotation || "") : "";
  const enEl = qs("ledger-entry-expense-nature");
  if (enEl) {
    if (kind === "income") {
      enEl.value = "";
    } else {
      const en = entry ? String(entry.expense_nature || "daily").toLowerCase() : "daily";
      enEl.value = en === "fixed" ? "fixed" : "daily";
    }
  }
  fillEntryTagSelect(kind, entry ? entry.tag_id : null);
  syncExpenseNatureVisibility();
  const kindEl = qs("ledger-entry-kind");
  if (kindEl) kindEl.disabled = mode === "edit";
  qs("ledger-entry-modal").classList.remove("hidden");
}

function closeEntryModal() {
  qs("ledger-entry-modal").classList.add("hidden");
  state.entryModal.mode = "add";
  state.entryModal.editingId = null;
  qs("ledger-entry-desc").value = "";
  qs("ledger-entry-annotation").value = "";
  const enEl = qs("ledger-entry-expense-nature");
  if (enEl) {
    enEl.value = "daily";
    enEl.disabled = false;
  }
  const kindEl = qs("ledger-entry-kind");
  if (kindEl) kindEl.disabled = false;
  syncExpenseNatureVisibility();
}

function switchLedgerTab(tab) {
  const entriesBtn = qs("ledger-tab-btn-entries");
  const statsBtn = qs("ledger-tab-btn-stats");
  const budgetBtn = qs("ledger-tab-btn-budget");
  const entriesPanel = qs("ledger-panel-entries");
  const statsPanel = qs("ledger-panel-stats");
  const budgetPanel = qs("ledger-panel-budget");
  if (!entriesBtn || !statsBtn || !budgetBtn || !entriesPanel || !statsPanel || !budgetPanel) return;
  [entriesBtn, statsBtn, budgetBtn].forEach((b) => b.classList.remove("active"));
  [entriesBtn, statsBtn, budgetBtn].forEach((b) => b.setAttribute("aria-selected", "false"));
  entriesPanel.hidden = true;
  statsPanel.hidden = true;
  budgetPanel.hidden = true;
  if (tab === "stats") {
    statsBtn.classList.add("active");
    statsBtn.setAttribute("aria-selected", "true");
    statsPanel.hidden = false;
    syncLedgerStatsQueryDateAndLoad();
  } else if (tab === "budget") {
    budgetBtn.classList.add("active");
    budgetBtn.setAttribute("aria-selected", "true");
    budgetPanel.hidden = false;
    initBudgetGenerateFormDefaults();
    loadLedgerBudgetCells().catch((e) => showToast(e.message || "加载预算失败", "error"));
  } else {
    entriesBtn.classList.add("active");
    entriesBtn.setAttribute("aria-selected", "true");
    entriesPanel.hidden = false;
  }
}

function defaultBudgetYearRange() {
  const y = new Date().getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

function initBudgetGenerateFormDefaults() {
  const dr = defaultBudgetYearRange();
  const gs = qs("ledger-budget-gen-range-start");
  const ge = qs("ledger-budget-gen-range-end");
  if (gs) gs.value = dr.start;
  if (ge) ge.value = dr.end;
  const amt = qs("ledger-budget-gen-amount");
  if (amt) amt.value = "";
  const gr = qs("ledger-budget-gen-granularity");
  if (gr) gr.value = "week";
}

function renderBudgetCellsColumn(mountId, items) {
  const mount = qs(mountId);
  if (!mount) return;
  if (!items.length) {
    mount.innerHTML = `<div class="ledger-empty" style="padding:16px">暂无数据，可在上方填写区间后生成。</div>`;
    return;
  }
  const head = `<div class="ledger-budget-cell-head" role="row">
    <div>周期</div><div>预算金额</div><div class="ledger-budget-cell-actions">操作</div>
  </div>`;
  const rows = items
    .map((row) => {
      const id = escapeHtml(String(row.id));
      const label = escapeHtml(String(row.period_label || ""));
      const amt = escapeHtml(Number(row.amount || 0).toFixed(2));
      return `<div class="ledger-budget-cell-row" role="row" data-budget-cell-id="${id}">
        <div class="ledger-budget-cell-period" title="${label}">${label}</div>
        <div>￥${amt}</div>
        <div class="ledger-budget-cell-actions">
          <button type="button" class="btn vocab-item-edit" data-budget-cell-action="edit">编辑</button>
        </div>
      </div>`;
    })
    .join("");
  mount.innerHTML = head + rows;
}

async function loadLedgerBudgetCells() {
  const data = await apiJson("/api/ledger/budget/cells", { method: "GET" });
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];
  const months = Array.isArray(data.months) ? data.months : [];
  state.budgetWeeks = weeks;
  state.budgetMonths = months;
  renderBudgetCellsColumn("ledger-budget-weeks-mount", weeks);
  renderBudgetCellsColumn("ledger-budget-months-mount", months);
}

function findBudgetCellById(cellId) {
  const id = String(cellId);
  return (
    state.budgetWeeks.find((x) => String(x.id) === id) || state.budgetMonths.find((x) => String(x.id) === id) || null
  );
}

function openBudgetCellEditModal(row) {
  if (!row || row.id == null) return;
  const hid = qs("ledger-budget-cell-edit-id");
  if (hid) hid.value = String(row.id);
  const p = qs("ledger-budget-cell-edit-period");
  if (p) p.textContent = String(row.period_label || "").trim() || "—";
  const a = qs("ledger-budget-cell-edit-amount");
  if (a) a.value = String(Number(row.amount || 0).toFixed(2));
  qs("ledger-budget-cell-edit-modal")?.classList.remove("hidden");
}

function closeBudgetCellEditModal() {
  qs("ledger-budget-cell-edit-modal")?.classList.add("hidden");
}

async function loadLedgerStatsOverview(ds) {
  const dateStr = String(ds || "").trim();
  const url = dateStr
    ? `/api/ledger/stats/overview?date=${encodeURIComponent(dateStr)}`
    : "/api/ledger/stats/overview";
  const data = await apiJson(url, { method: "GET" });
  renderLedgerCurrentOverview(data);
}

function syncLedgerStatsQueryDateAndLoad() {
  const qd = qs("ledger-stats-query-date");
  const mx = state.ledgerServerDate || toDateStr(new Date());
  const mn = state.ledgerRetentionStart || "";
  if (qd) {
    let v = String(qd.value || "").trim();
    if (!v) v = mx;
    if (mn && v < mn) v = mn;
    if (v > mx) v = mx;
    qd.value = v;
  }
  const ds = String(qd?.value || "").trim();
  loadLedgerStatsOverview(ds).catch((e) => showToast(e.message || "加载统计失败", "error"));
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
  qs("ledger-preset").value = "week";
  await loadLedgerMeta();
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

  qs("btn-ledger-export-csv")?.addEventListener("click", async () => {
    const s = String(qs("ledger-start")?.value || "").trim();
    const e = String(qs("ledger-end")?.value || "").trim();
    if (!s || !e) {
      showToast("请先选择查询起止日期", "error");
      return;
    }
    try {
      const q = `start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`;
      await downloadCsvFile(`/api/ledger/export.csv?${q}`, `ledger_${s}_${e}.csv`);
      showToast("已开始下载", "success");
    } catch (err) {
      showToast(err.message || "导出失败", "error");
    }
  });

  qs("btn-ledger-archive-csv")?.addEventListener("click", async () => {
    const s = String(qs("ledger-archive-start")?.value || "").trim();
    const e = String(qs("ledger-archive-end")?.value || "").trim();
    if (!s || !e) {
      showToast("请填写归档导出的起止日期", "error");
      return;
    }
    try {
      const q = `start_date=${encodeURIComponent(s)}&end_date=${encodeURIComponent(e)}`;
      await downloadCsvFile(`/api/ledger/archive/export.csv?${q}`, `ledger_archive_${s}_${e}.csv`);
      showToast("已开始下载", "success");
    } catch (err) {
      showToast(err.message || "导出失败", "error");
    }
  });

  qs("btn-ledger-budget-generate")?.addEventListener("click", async () => {
    const granularity = String(qs("ledger-budget-gen-granularity")?.value || "").trim();
    const rangeStart = String(qs("ledger-budget-gen-range-start")?.value || "").trim();
    const rangeEnd = String(qs("ledger-budget-gen-range-end")?.value || "").trim();
    const raw = String(qs("ledger-budget-gen-amount")?.value || "").trim();
    const amt = raw === "" ? NaN : Number(raw);
    if (!rangeStart || !rangeEnd) {
      showToast("请填写预算起止日期", "error");
      return;
    }
    if (!Number.isFinite(amt) || amt < 0) {
      showToast("请填写有效的预算金额（非负数）", "error");
      return;
    }
    if (granularity !== "week" && granularity !== "month") {
      showToast("请选择周期类型", "error");
      return;
    }
    try {
      const data = await apiJson("/api/ledger/budget/cells/generate", {
        method: "POST",
        body: JSON.stringify({
          granularity,
          range_start: rangeStart,
          range_end: rangeEnd,
          amount: Number(amt.toFixed(2)),
        }),
      });
      const n = data.count != null ? data.count : 0;
      showToast(`已生成 ${n} 条预算`, "success");
      await loadLedgerBudgetCells();
      if (qs("ledger-panel-stats") && !qs("ledger-panel-stats").hidden) {
        loadLedgerStatsOverview().catch(() => {});
      }
    } catch (e) {
      showToast(e.message || "生成失败", "error");
    }
  });

  qs("ledger-budget-tab-root")?.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-budget-cell-action]");
    if (!btn || btn.getAttribute("data-budget-cell-action") !== "edit") return;
    const row = ev.target.closest("[data-budget-cell-id]");
    const idRaw = row?.getAttribute("data-budget-cell-id");
    if (!idRaw) return;
    const cell = findBudgetCellById(idRaw);
    if (cell) openBudgetCellEditModal(cell);
  });

  qs("ledger-budget-cell-edit-cancel")?.addEventListener("click", closeBudgetCellEditModal);
  qs("ledger-budget-cell-edit-modal")?.addEventListener("click", (ev) => {
    if (ev.target === qs("ledger-budget-cell-edit-modal")) closeBudgetCellEditModal();
  });
  qs("ledger-budget-cell-edit-save")?.addEventListener("click", async () => {
    const idRaw = String(qs("ledger-budget-cell-edit-id")?.value || "").trim();
    const cellId = Number(idRaw);
    const raw = String(qs("ledger-budget-cell-edit-amount")?.value || "").trim();
    const amt = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(cellId) || cellId <= 0) {
      showToast("数据无效", "error");
      return;
    }
    if (!Number.isFinite(amt) || amt < 0) {
      showToast("金额需为非负数", "error");
      return;
    }
    try {
      await apiJson(`/api/ledger/budget/cells/${cellId}`, {
        method: "PUT",
        body: JSON.stringify({ amount: Number(amt.toFixed(2)) }),
      });
      showToast("已保存", "success");
      closeBudgetCellEditModal();
      await loadLedgerBudgetCells();
      if (qs("ledger-panel-stats") && !qs("ledger-panel-stats").hidden) {
        loadLedgerStatsOverview().catch(() => {});
      }
    } catch (e) {
      showToast(e.message || "保存失败", "error");
    }
  });

  qs("ledger-tab-btn-entries")?.addEventListener("click", () => switchLedgerTab("entries"));
  qs("ledger-tab-btn-stats")?.addEventListener("click", () => switchLedgerTab("stats"));
  qs("ledger-tab-btn-budget")?.addEventListener("click", () => switchLedgerTab("budget"));

  qs("ledger-stats-refresh")?.addEventListener("click", () => {
    const ds = String(qs("ledger-stats-query-date")?.value || "").trim();
    loadLedgerStatsOverview(ds).catch((e) => showToast(e.message || "加载统计失败", "error"));
  });

  qs("ledger-stats-query-btn")?.addEventListener("click", () => {
    const ds = String(qs("ledger-stats-query-date")?.value || "").trim();
    if (!ds) {
      showToast("请选择日期", "error");
      return;
    }
    loadLedgerStatsOverview(ds).catch((e) => showToast(e.message || "查询失败", "error"));
  });

  qs("ledger-entry-kind").addEventListener("change", () => {
    fillEntryTagSelect(qs("ledger-entry-kind").value, null);
    syncExpenseNatureVisibility();
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
    if (kind === "expense") {
      payload.expense_nature = String(qs("ledger-entry-expense-nature")?.value || "daily");
    }

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

  const rawTab = String(new URLSearchParams(window.location.search).get("tab") || "").toLowerCase();
  const startTab = rawTab === "entries" || rawTab === "budget" ? rawTab : "stats";
  switchLedgerTab(startTab);
}

document.addEventListener("DOMContentLoaded", () => {
  initLedger().catch((e) => {
    showToast(e.message || "初始化失败", "error");
  });
});


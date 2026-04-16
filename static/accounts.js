/**
 * Common accounts management page logic.
 */

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
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 300);
    }, 2500);
}

function renderAccounts(items) {
    const tbody = document.getElementById("accounts-tbody");
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="5" class="placeholder">暂无数据，请点击上方“添加”录入。</td></tr>';
        return;
    }

    const typeLabel = (t) => (String(t || "system") === "tool" ? "工具" : "系统");
    const safeUrlHref = (u) => {
        const raw = String(u || "").trim();
        if (!raw) return "";
        // 简单保护：仅允许 http(s) 链接，避免 javascript: 等
        if (/^https?:\/\//i.test(raw)) return raw;
        return "https://" + raw;
    };

    tbody.innerHTML = items
        .map(
            (item, index) => `
        <tr data-id="${item.id}" data-index="${index}">
            <td class="cell-type">${escapeHtml(typeLabel(item.account_type))}</td>
            <td class="cell-system">${escapeHtml(item.system)}</td>
            <td class="cell-url"><a href="${escapeHtml(safeUrlHref(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a></td>
            <td class="cell-account-info">${escapeHtml(item.account_info)}</td>
            <td class="cell-actions">
                <div class="actions-wrap">
                    ${index > 0 ? '<button class="btn operation-btn btn-move-up" data-id="' + item.id + '">上移</button>' : ''}
                    <button class="btn operation-btn btn-edit" data-id="${item.id}">编辑</button>
                    <button class="btn operation-btn btn-delete" data-id="${item.id}">删除</button>
                </div>
            </td>
        </tr>
    `
        )
        .join("");
}

function escapeHtml(str) {
    if (str == null) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function switchToEditMode(row) {
    const id = row.getAttribute("data-id");
    const typeCell = row.querySelector(".cell-type");
    const systemCell = row.querySelector(".cell-system");
    const urlCell = row.querySelector(".cell-url");
    const accountInfoCell = row.querySelector(".cell-account-info");
    const opCell = row.querySelector("td:last-child");

    const typeVal = typeCell ? typeCell.textContent : "系统";
    const systemVal = systemCell.textContent;
    const urlVal = (urlCell.querySelector("a")?.textContent || urlCell.textContent || "").trim();
    const accountInfoVal = accountInfoCell.textContent;

    if (typeCell) {
        const selected = typeVal.trim() === "工具" ? "tool" : "system";
        typeCell.innerHTML =
            '<select class="edit-input" data-field="account_type" data-ui-select="single">' +
            '<option value="system"' +
            (selected === "system" ? " selected" : "") +
            ">系统</option>" +
            '<option value="tool"' +
            (selected === "tool" ? " selected" : "") +
            ">工具</option>" +
            "</select>";
    }
    systemCell.innerHTML =
        '<input type="text" class="edit-input" data-field="system" value="' +
        escapeHtml(systemVal) +
        '" />';
    urlCell.innerHTML =
        '<input type="text" class="edit-input" data-field="url" value="' +
        escapeHtml(urlVal) +
        '" />';
    accountInfoCell.innerHTML =
        '<input type="text" class="edit-input" data-field="account_info" value="' +
        escapeHtml(accountInfoVal) +
        '" />';

    opCell.innerHTML = `
        <div class="actions-wrap">
            <button class="btn operation-btn btn-save" data-id="${id}">保存</button>
            <button class="btn operation-btn btn-cancel" data-id="${id}">取消</button>
        </div>
    `;

    // 编辑态下动态插入 select，需要补一次 ui-select 增强
    try {
        if (typeof window.refreshUiSelectComboboxVisibility === "function") {
            window.refreshUiSelectComboboxVisibility();
        }
    } catch (_) {}
}

function loadAccounts(callback) {
    const filterEl = document.getElementById("accounts-filter-type");
    const t = filterEl ? String(filterEl.value || "") : "";
    const qs = t ? ("?type=" + encodeURIComponent(t)) : "";
    fetch("/api/accounts" + qs)
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                renderAccounts(data.items);
                if (typeof callback === "function") callback();
            } else {
                showToast(data.message || "加载失败", "error");
            }
        })
        .catch((err) => {
            showToast("加载失败：" + (err.message || "网络错误"), "error");
        });
}

function addAccount() {
    const accountTypeEl = document.getElementById("add-account-type");
    const account_type = accountTypeEl ? String(accountTypeEl.value || "system") : "system";
    const system = document.getElementById("add-system").value.trim();
    const url = document.getElementById("add-url").value.trim();
    const accountInfo = document.getElementById("add-account-info").value.trim();

    fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_type, system, url, account_info: accountInfo }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                if (accountTypeEl) accountTypeEl.value = "system";
                document.getElementById("add-system").value = "";
                document.getElementById("add-url").value = "";
                document.getElementById("add-account-info").value = "";
                showToast("添加成功");
                loadAccounts(bindRowEvents);
            } else {
                showToast(data.message || "添加失败", "error");
            }
        })
        .catch((err) => {
            showToast("添加失败：" + (err.message || "网络错误"), "error");
        });
}

function updateAccount(id, account_type, system, url, accountInfo) {
    fetch("/api/accounts/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            account_type,
            system,
            url,
            account_info: accountInfo,
        }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("更新成功");
                loadAccounts(bindRowEvents);
            } else {
                showToast(data.message || "更新失败", "error");
            }
        })
        .catch((err) => {
            showToast("更新失败：" + (err.message || "网络错误"), "error");
        });
}

function moveUpAccount(id) {
    fetch("/api/accounts/" + id + "/move-up", { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("上移成功");
                loadAccounts(bindRowEvents);
            } else {
                showToast(data.message || "上移失败", "error");
            }
        })
        .catch((err) => {
            showToast("上移失败：" + (err.message || "网络错误"), "error");
        });
}

let pendingDeleteAccountId = null;

function deleteAccount(id) {
    pendingDeleteAccountId = id;
    const modal = document.getElementById("accounts-confirm-modal");
    if (modal) modal.classList.remove("hidden");
}

function confirmDeleteAccount() {
    const id = pendingDeleteAccountId;
    if (id == null) return;
    pendingDeleteAccountId = null;
    fetch("/api/accounts/" + id, { method: "DELETE" })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                showToast("删除成功");
                loadAccounts(bindRowEvents);
            } else {
                showToast(data.message || "删除失败", "error");
            }
        })
        .catch((err) => {
            showToast("删除失败：" + (err.message || "网络错误"), "error");
        });
}

function bindRowEvents() {
    const tbody = document.getElementById("accounts-tbody");
    if (!tbody) return;

    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            const row = tbody.querySelector('tr[data-id="' + id + '"]');
            if (row) switchToEditMode(row);
            bindRowEvents();
        };
    });

    tbody.querySelectorAll(".btn-move-up").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            moveUpAccount(parseInt(id, 10));
        };
    });

    tbody.querySelectorAll(".btn-delete").forEach((btn) => {
        btn.onclick = () => {
            const id = btn.getAttribute("data-id");
            deleteAccount(parseInt(id, 10));
        };
    });

    tbody.querySelectorAll(".btn-save").forEach((btn) => {
        btn.onclick = () => {
            const id = parseInt(btn.getAttribute("data-id"), 10);
            const row = tbody.querySelector('tr[data-id="' + id + '"]');
            if (!row) return;
            const account_type = row.querySelector('[data-field="account_type"]')?.value || "system";
            const system = row.querySelector('[data-field="system"]')?.value || "";
            const url = row.querySelector('[data-field="url"]')?.value || "";
            const accountInfo = row.querySelector('[data-field="account_info"]')?.value || "";
            updateAccount(id, account_type, system, url, accountInfo);
        };
    });

    tbody.querySelectorAll(".btn-cancel").forEach((btn) => {
        btn.onclick = () => {
            loadAccounts(bindRowEvents);
        };
    });
}

function initAccounts() {
    document.getElementById("btn-go-home").onclick = () => {
        window.location.href = "/home";
    };

    document.getElementById("btn-add").onclick = addAccount;
    const filterEl = document.getElementById("accounts-filter-type");
    if (filterEl) {
        filterEl.onchange = () => loadAccounts(bindRowEvents);
    }

    const confirmModal = document.getElementById("accounts-confirm-modal");
    const btnCancel = document.getElementById("btn-accounts-delete-cancel");
    const btnConfirm = document.getElementById("btn-accounts-delete-confirm");
    if (btnCancel && confirmModal) {
        btnCancel.onclick = () => {
            confirmModal.classList.add("hidden");
            pendingDeleteAccountId = null;
        };
    }
    if (btnConfirm && confirmModal) {
        btnConfirm.onclick = () => {
            confirmModal.classList.add("hidden");
            confirmDeleteAccount();
        };
    }

    loadAccounts(bindRowEvents);

    // 页面初始化后确保 ui-select 可见性同步
    try {
        if (typeof window.refreshUiSelectComboboxVisibility === "function") {
            window.refreshUiSelectComboboxVisibility();
        }
    } catch (_) {}
}

document.addEventListener("DOMContentLoaded", initAccounts);

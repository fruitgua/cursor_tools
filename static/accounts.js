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

    tbody.innerHTML = items
        .map(
            (item, index) => `
        <tr data-id="${item.id}" data-index="${index}">
            <td class="cell-system">${escapeHtml(item.system)}</td>
            <td class="cell-url">${escapeHtml(item.url)}</td>
            <td class="cell-account-info">${escapeHtml(item.account_info)}</td>
            <td class="cell-description">${escapeHtml(item.description || "")}</td>
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
    const systemCell = row.querySelector(".cell-system");
    const urlCell = row.querySelector(".cell-url");
    const accountInfoCell = row.querySelector(".cell-account-info");
    const descCell = row.querySelector(".cell-description");
    const opCell = row.querySelector("td:last-child");

    const systemVal = systemCell.textContent;
    const urlVal = urlCell.textContent;
    const accountInfoVal = accountInfoCell.textContent;
    const descVal = descCell ? (descCell.querySelector(".desc-textarea")?.value ?? descCell.textContent ?? "") : "";

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
    if (descCell) {
        descCell.innerHTML =
            '<textarea class="edit-input desc-textarea" data-field="description" rows="2">' +
            escapeHtml(descVal) +
            "</textarea>";
    }

    opCell.innerHTML = `
        <div class="actions-wrap">
            <button class="btn operation-btn btn-save" data-id="${id}">保存</button>
            <button class="btn operation-btn btn-cancel" data-id="${id}">取消</button>
        </div>
    `;
}

function loadAccounts(callback) {
    fetch("/api/accounts")
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
    const system = document.getElementById("add-system").value.trim();
    const url = document.getElementById("add-url").value.trim();
    const accountInfo = document.getElementById("add-account-info").value.trim();
    const description = document.getElementById("add-description").value;

    fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, url, account_info: accountInfo, description }),
    })
        .then((r) => r.json())
        .then((data) => {
            if (data.success) {
                document.getElementById("add-system").value = "";
                document.getElementById("add-url").value = "";
                document.getElementById("add-account-info").value = "";
                document.getElementById("add-description").value = "";
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

function updateAccount(id, system, url, accountInfo, description) {
    if (description === undefined) description = "";
    fetch("/api/accounts/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system,
            url,
            account_info: accountInfo,
            description,
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

function deleteAccount(id) {
    if (!confirm("确定要删除这条记录吗？")) return;

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
            const system = row.querySelector('[data-field="system"]')?.value || "";
            const url = row.querySelector('[data-field="url"]')?.value || "";
            const accountInfo = row.querySelector('[data-field="account_info"]')?.value || "";
            const descInput = row.querySelector('[data-field="description"]');
            const description = descInput ? descInput.value : "";
            updateAccount(id, system, url, accountInfo, description);
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

    loadAccounts(bindRowEvents);
}

document.addEventListener("DOMContentLoaded", initAccounts);

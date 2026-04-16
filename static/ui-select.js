(function() {
    "use strict";

    function escapeHtml(s) {
        const div = document.createElement("div");
        div.textContent = String(s == null ? "" : s);
        return div.innerHTML;
    }

    function getSelectedOption(selectEl) {
        const idx = selectEl.selectedIndex;
        if (idx >= 0 && selectEl.options && selectEl.options[idx]) return selectEl.options[idx];
        const v = selectEl.value;
        return Array.from(selectEl.options || []).find(o => o.value === v) || null;
    }

    function buildPanelHtml(selectEl, currentValue) {
        const opts = Array.from(selectEl.options || []);
        return opts.map(o => {
            const active = String(o.value) === String(currentValue) ? " active" : "";
            return '<div class="select-option' + active + '" data-value="' + escapeHtml(o.value) + '">' + escapeHtml(o.textContent || "") + "</div>";
        }).join("");
    }

    function enhanceSelect(selectEl) {
        if (!selectEl || selectEl.dataset.uiSelectEnhanced === "1") return;
        selectEl.dataset.uiSelectEnhanced = "1";

        const combobox = document.createElement("div");
        combobox.className = "select-combobox";

        const trigger = document.createElement("div");
        trigger.className = "field-control select-trigger";
        trigger.tabIndex = 0;
        trigger.setAttribute("role", "combobox");
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");

        const text = document.createElement("div");
        text.className = "select-trigger-text";

        const caret = document.createElement("div");
        caret.className = "select-caret";
        caret.setAttribute("aria-hidden", "true");

        const panel = document.createElement("div");
        panel.className = "select-panel hidden";
        panel.setAttribute("role", "listbox");

        trigger.appendChild(text);
        trigger.appendChild(caret);
        combobox.appendChild(trigger);
        combobox.appendChild(panel);

        // Insert combobox before select, hide select
        selectEl.parentNode.insertBefore(combobox, selectEl);
        selectEl.classList.add("select-native-hidden");

        /** 父级 display:none 时，部分浏览器下子元素 getComputedStyle 仍非 none，需沿祖先检查 */
        function isEffectivelyHidden(el) {
            let n = el;
            while (n && n.nodeType === 1) {
                const s = window.getComputedStyle(n);
                if (s.display === "none" || s.visibility === "hidden") return true;
                n = n.parentElement;
            }
            return false;
        }

        /** 使用 fixed 定位，避免被任意祖先 overflow（如 #page-events、表单行 overflow-y）裁切 */
        function clearPanelPosition() {
            panel.style.position = "";
            panel.style.left = "";
            panel.style.top = "";
            panel.style.width = "";
            panel.style.right = "";
            panel.style.bottom = "";
            panel.style.zIndex = "";
            panel.style.maxHeight = "";
        }

        function positionPanel() {
            const rect = trigger.getBoundingClientRect();
            const margin = 6;
            const pad = 12;
            const defaultMax = 240;
            const spaceBelow = window.innerHeight - rect.bottom - margin - pad;
            const maxH = Math.max(80, Math.min(defaultMax, spaceBelow));
            panel.style.position = "fixed";
            panel.style.left = Math.max(8, rect.left) + "px";
            panel.style.width = Math.max(rect.width, 1) + "px";
            panel.style.right = "auto";
            panel.style.top = rect.bottom + margin + "px";
            panel.style.bottom = "auto";
            panel.style.zIndex = "10001";
            panel.style.maxHeight = maxH + "px";
        }

        const syncVisibilityFromSelect = () => {
            const hidden = isEffectivelyHidden(selectEl);
            combobox.style.display = hidden ? "none" : "";
            if (hidden) {
                panel.classList.add("hidden");
                clearPanelPosition();
            }
        };

        const syncFromSelect = () => {
            const opt = getSelectedOption(selectEl);
            text.textContent = opt ? (opt.textContent || "") : "";
            panel.innerHTML = buildPanelHtml(selectEl, selectEl.value);
            panel.querySelectorAll(".select-option").forEach(el => {
                el.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    const v = el.dataset.value || "";
                    selectEl.value = v;
                    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                    hide();
                    syncFromSelect();
                });
            });
        };

        const show = () => {
            syncVisibilityFromSelect();
            if (combobox.style.display === "none") return;
            syncFromSelect();
            panel.classList.remove("hidden");
            trigger.setAttribute("aria-expanded", "true");
            positionPanel();
        };

        const hide = () => {
            panel.classList.add("hidden");
            clearPanelPosition();
            trigger.setAttribute("aria-expanded", "false");
        };

        const toggle = () => {
            if (panel.classList.contains("hidden")) show();
            else hide();
        };

        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            toggle();
        });
        trigger.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
            } else if (e.key === "Escape") {
                hide();
            }
        });

        selectEl.addEventListener("change", syncFromSelect);
        syncFromSelect();
        syncVisibilityFromSelect();

        // Observe select style/class changes to keep visibility in sync (e.g., event management filters)
        try {
            const mo = new MutationObserver(() => syncVisibilityFromSelect());
            mo.observe(selectEl, { attributes: true, attributeFilter: ["style", "class"] });
        } catch (_) {}

        document.addEventListener("click", (e) => {
            if (!combobox.contains(e.target)) hide();
        });

        function repositionIfOpen() {
            if (!panel.classList.contains("hidden")) positionPanel();
        }
        window.addEventListener("scroll", repositionIfOpen, true);
        window.addEventListener("resize", repositionIfOpen);

        /** 供父级从 display:none 切换为显示后调用（如事件管理 tab 切换） */
        selectEl._uiSelectSyncVisibility = syncVisibilityFromSelect;
    }

    function init() {
        document.querySelectorAll('select[data-ui-select="single"]').forEach(enhanceSelect);
    }

    /**
     * 重新计算所有已增强下拉的可见性（父级 display 变化时 native select 的 computed style 会变，
     * 但 MutationObserver 只监听 select 自身属性，不会触发）。
     */
    function refreshUiSelectComboboxVisibility() {
        // 先增强动态插入的新 select（例如编辑态行内下拉）
        init();
        document.querySelectorAll("select[data-ui-select-enhanced=\"1\"]").forEach((sel) => {
            if (typeof sel._uiSelectSyncVisibility === "function") {
                sel._uiSelectSyncVisibility();
            }
        });
    }

    window.refreshUiSelectComboboxVisibility = refreshUiSelectComboboxVisibility;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();


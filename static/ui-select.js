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

        const syncVisibilityFromSelect = () => {
            const cs = window.getComputedStyle(selectEl);
            const hidden = cs.display === "none" || cs.visibility === "hidden";
            combobox.style.display = hidden ? "none" : "";
            if (hidden) panel.classList.add("hidden");
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
            panel.classList.remove("hidden");
            trigger.setAttribute("aria-expanded", "true");
            syncFromSelect();
        };

        const hide = () => {
            panel.classList.add("hidden");
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
    }

    function init() {
        document.querySelectorAll('select[data-ui-select="single"]').forEach(enhanceSelect);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();


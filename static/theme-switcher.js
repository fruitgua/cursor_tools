(function() {
    "use strict";
    const STORAGE_KEY = "app_theme";
    const THEMES = [
        { id: "light", name: "默认" },
        { id: "yellow-green", name: "黄绿渐变" },
        { id: "checkin", name: "蓝紫渐变" },
        { id: "dark", name: "夜晚" },
        { id: "orange", name: "橙意满满" },
        { id: "lavender", name: "轻奢紫" }
    ];

    function getTheme() {
        try {
            const t = localStorage.getItem(STORAGE_KEY);
            return t && THEMES.some(x => x.id === t) ? t : "light";
        } catch (e) { return "light"; }
    }

    function setTheme(id) {
        localStorage.setItem(STORAGE_KEY, id);
        document.documentElement.setAttribute("data-theme", id);
    }

    setTheme(getTheme());

    function render() {
        const container = document.getElementById("theme-switcher-container");
        if (!container) return;

        const current = getTheme();
        setTheme(current);

        container.innerHTML = `
            <div class="theme-switcher">
                <button type="button" class="btn theme-switcher-btn" id="theme-switcher-btn" aria-haspopup="listbox" aria-expanded="false">
                    切换模版 ▾
                </button>
                <div class="theme-switcher-dropdown hidden" id="theme-switcher-dropdown" role="listbox">
                    ${THEMES.map(t => `
                        <div class="theme-switcher-option ${t.id === current ? "active" : ""}" 
                             role="option" data-theme="${t.id}">${t.name}</div>
                    `).join("")}
                </div>
            </div>
        `;

        const btn = document.getElementById("theme-switcher-btn");
        const dropdown = document.getElementById("theme-switcher-dropdown");

        btn.addEventListener("click", function(e) {
            e.stopPropagation();
            dropdown.classList.toggle("hidden");
            btn.setAttribute("aria-expanded", dropdown.classList.contains("hidden") ? "false" : "true");
        });

        dropdown.querySelectorAll(".theme-switcher-option").forEach(opt => {
            opt.addEventListener("click", function(e) {
                e.stopPropagation();
                const id = this.dataset.theme;
                setTheme(id);
                dropdown.querySelectorAll(".theme-switcher-option").forEach(o => o.classList.remove("active"));
                this.classList.add("active");
                dropdown.classList.add("hidden");
                btn.setAttribute("aria-expanded", "false");
            });
        });

        document.addEventListener("click", function() {
            dropdown.classList.add("hidden");
            btn.setAttribute("aria-expanded", "false");
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", render);
    } else {
        render();
    }
})();

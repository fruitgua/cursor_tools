/**
 * Show a simple toast message on the home page.
 * @param {string} text - Toast content.
 */
function showHomeToast(text) {
    const container = document.getElementById("toast-container");
    if (!container || !text) return;

    const toast = document.createElement("div");
    toast.className = "toast toast-info";
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

/**
 * Initialize events on the home page.
 */
function initHome() {
    const cards = document.querySelectorAll(".home-card");
    cards.forEach((card) => {
        card.addEventListener("click", () => {
            const key = card.getAttribute("data-key");
            if (key === "file-manager") {
                window.location.href = "/";
            } else if (key === "checkin") {
                window.location.href = "/static/checkin.html";
            } else if (key === "accounts") {
                window.location.href = "/accounts";
            } else if (key === "notes") {
                window.location.href = "/notes";
            } else if (key === "bookmarks") {
                window.location.href = "/bookmarks";
            } else if (key === "address-helper") {
                window.location.href = "/static/vocabulary.html";
            } else if (key === "todos") {
                window.location.href = "/todos";
            } else {
                showHomeToast("你要努力完善我噢~");
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", initHome);


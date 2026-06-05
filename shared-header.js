const APP_VERSION = "77";

const HEADER_PAGES = [
    { id: "scales", href: "scales.html", label: "Scales" },
    { id: "intervals", href: "scales2.html", label: "Intervals" },
    { id: "phrases", href: "phrases.html", label: "Phrases" },
    { id: "test", href: "test.html", label: "Test" },
    { id: "pitch", href: "pitch-meter.html", label: "Pitch" },
    { id: "music", href: "player.html", label: "Music" },
    { id: "books", href: "ebook.html", label: "Books" },
    { id: "ears", href: "ears.html", label: "Ears" }
];

function renderSharedHeader() {
    const header = document.getElementById("siteHeader");
    if (!header) {
        return;
    }

    const currentPageId = document.body.dataset.page || "";
    const currentPage = HEADER_PAGES.find((page) => page.id === currentPageId);
    const pageTitle = currentPage ? currentPage.label : (document.title.split(" - ")[0] || "Voice-Wei");
    const showSettingsButton = document.body.dataset.settingsButton === "true";

    const navHtml = HEADER_PAGES.map((page) => {
        const activeClass = page.id === currentPageId ? " active" : "";
        return `<a href="${page.href}" class="nav-tab${activeClass}">${page.label}</a>`;
    }).join("");

    const settingsHtml = showSettingsButton
        ? '<div class="header-actions"><button id="settingsBtn" class="settings-btn" aria-label="Settings">&#9881;</button></div>'
        : "";

    header.className = "site-header";
    header.innerHTML = `
        <div class="header-top">
            <div class="header-title-group">
                <a href="scales.html" class="site-name">Voice-Wei</a>
                <h1>${pageTitle}</h1>
                <span class="version-label">v${APP_VERSION}</span>
            </div>
            ${settingsHtml}
        </div>
        <nav class="nav-tabs" aria-label="Primary">
            ${navHtml}
        </nav>
    `;

    const updateHeaderHeight = () => {
        document.documentElement.style.setProperty("--site-header-height", `${header.offsetHeight}px`);
    };

    updateHeaderHeight();
    window.addEventListener("resize", updateHeaderHeight);
}

renderSharedHeader();

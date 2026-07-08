const APP_VERSION = (typeof AppVersion !== 'undefined' && AppVersion.current) ? AppVersion.current : '242';

const HEADER_PAGES = [
    { id: "scales", href: "scales.html", label: "Scales" },
    { id: "intervals", href: "intervals.html", label: "Intervals" },
    { id: "phrases", href: "phrases.html", label: "Phrases" },
    { id: "trace", href: "trace.html", label: "Trace" },
    { id: "pitch", href: "pitch-meter.html", label: "Pitch" },
    { id: "music", href: "player.html", label: "Music" },
    { id: "books", href: "ebook.html", label: "Books" },
    { id: "deploys", href: "deploys.html", label: "Deploys" }
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

    const settingsButtonHtml = '<button id="settingsBtn" class="settings-btn" aria-label="Settings">&#9881;</button>';

    header.className = "site-header";

    if (document.body.dataset.lyricHeading === "true") {
        // Lyric-heading layout (music page): the h1 mirrors the current
        // now-playing lyric line (media-session-core), so it gets its own
        // full-width line, and the settings gear shares the nav-tabs row.
        header.innerHTML = `
            <div class="header-top">
                <div class="header-title-group">
                    <a href="scales.html" class="site-name">Voice-Wei</a>
                    <span class="version-label">v${APP_VERSION}</span>
                </div>
            </div>
            <h1 class="header-lyric-line">${pageTitle}</h1>
            <div class="header-nav-row">
                <nav class="nav-tabs" aria-label="Primary">
                    ${navHtml}
                </nav>
                ${showSettingsButton ? settingsButtonHtml : ""}
            </div>
        `;
    } else {
        header.innerHTML = `
            <div class="header-top">
                <div class="header-title-group">
                    <a href="scales.html" class="site-name">Voice-Wei</a>
                    <h1>${pageTitle}</h1>
                    <span class="version-label">v${APP_VERSION}</span>
                </div>
                ${showSettingsButton ? `<div class="header-actions">${settingsButtonHtml}</div>` : ""}
            </div>
            <nav class="nav-tabs" aria-label="Primary">
                ${navHtml}
            </nav>
        `;
    }

    const updateHeaderHeight = () => {
        document.documentElement.style.setProperty("--site-header-height", `${header.offsetHeight}px`);
    };

    // On phones the nav is one scrollable row; keep the active tab visible
    const activeTab = header.querySelector(".nav-tab.active");
    if (activeTab) {
        activeTab.scrollIntoView({ block: "nearest", inline: "center" });
    }

    updateHeaderHeight();
    window.addEventListener("resize", updateHeaderHeight);
}

renderSharedHeader();

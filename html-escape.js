// @ts-check
//-----------------------------------------------------------------------
// HTML ESCAPE
// The one escape for text placed into HTML markup. Quotes are escaped
// too, so the result is safe in element content and in quoted attribute
// values alike (imported book titles and web-page link text reach both).
//-----------------------------------------------------------------------

const HTML_ESCAPES = Object.freeze({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
});

/** @param {unknown} value @returns {string} */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[/** @type {keyof typeof HTML_ESCAPES} */ (character)]);
}

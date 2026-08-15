// @ts-check
// Articles tab workflow against a stubbed Fuseki API: connect with a stored
// editor prefix, auto-create a draft on the first paragraph, append as new
// paragraphs, start fresh drafts, and parse the new-draft voice command.
const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('articles flow (stubbed API)');
    const browser = await launch();
    const tab = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    collectErrors(tab, 'articles.html', pageErrors);

    await tab.addInitScript(() => {
        localStorage.setItem('voice-wei:articles-settings',
            JSON.stringify({ v: '0', data: { editorBase: '/secret-prefix', currentDraftId: 0 } }));
        const drafts = [];
        let nextId = 1;
        const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
        // @ts-ignore
        window.fetch = async (url, options = {}) => {
            const path = String(url);
            if (!path.startsWith('/secret-prefix/articles/api/voice/')) {
                throw new Error(`Unexpected fetch: ${path}`);
            }
            if (path.includes('/state/')) {
                return jsonResponse({ success: true, csrfToken: 'tok', drafts: [...drafts], current: null });
            }
            const body = JSON.parse(String(options.body || '{}'));
            if (path.includes('/create/')) {
                const draft = {
                    id: nextId++, title: `Voice draft test ${nextId}`,
                    updated: new Date().toISOString(),
                    wordCount: (body.text || '').split(/\s+/).filter(Boolean).length,
                    body: body.text || ''
                };
                drafts.unshift(draft);
                return jsonResponse({ success: true, ...draft });
            }
            if (path.includes('/append/')) {
                const draft = drafts.find(d => d.id === body.id);
                if (!draft) return jsonResponse({ success: false, error: 'Draft not found' });
                draft.body = draft.body ? `${draft.body}\n\n${body.text}` : body.text;
                draft.wordCount = draft.body.split(/\s+/).filter(Boolean).length;
                return jsonResponse({ success: true, ...draft });
            }
            throw new Error(`Unhandled path: ${path}`);
        };
    });

    await tab.goto(`${BASE_URL}/articles.html`, { waitUntil: 'load', timeout: 30000 });
    await tab.waitForTimeout(400);

    const connection = await tab.textContent('#connectionStatus');
    report.check(`auto-connects with stored prefix ("${connection}")`,
        Boolean(connection && connection.startsWith('Connected')));

    // Typed paragraph with no current draft auto-creates one.
    await tab.fill('#typeInput', 'First spoken paragraph.');
    await tab.click('#typeAddBtn');
    await tab.waitForTimeout(300);
    let title = await tab.textContent('#draftTitle');
    let body = await tab.textContent('#draftBody');
    report.check('first paragraph auto-creates a draft',
        Boolean(title && title.startsWith('Voice draft') && body === 'First spoken paragraph.'));

    // Second paragraph appends to the same draft.
    await tab.fill('#typeInput', 'Second paragraph.');
    await tab.click('#typeAddBtn');
    await tab.waitForTimeout(300);
    body = await tab.textContent('#draftBody');
    report.check('second paragraph appends as a new paragraph',
        body === 'First spoken paragraph.\n\nSecond paragraph.');

    // "New draft" button starts a fresh draft; drafts list shows both.
    await tab.click('#newDraftBtn');
    await tab.waitForTimeout(300);
    const draftButtons = await tab.$$eval('.articles-draft-btn', els => els.length);
    const selected = await tab.$$eval('.articles-draft-btn.selected', els => els.length);
    report.check(`new-draft button creates and selects a fresh draft (${draftButtons} listed)`,
        draftButtons === 2 && selected === 1);

    // Voice command parser recognizes the phrasings; dictation does not.
    const parses = await tab.evaluate(() => {
        // @ts-ignore
        const controller = window.articlesController || articlesController;
        const yes = ['create new draft article', 'New article.', 'new blog post', 'start a new draft']
            .every(p => controller.parseNewDraftCommand(p));
        const no = ['today I went to the store', 'the new article about go was great']
            .every(p => !controller.parseNewDraftCommand(p));
        return yes && no;
    });
    report.check('new-draft voice command parses; prose does not', parses);

    pageErrors.forEach(e => report.errors.push(e));
    report.check('no page errors', pageErrors.length === 0);

    await browser.close();
    report.finish();
})();

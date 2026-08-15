// @ts-check
//-----------------------------------------------------------------------
// ARTICLES
// Dictate blog-post drafts straight into the Fuseki editor database.
// The page calls the Fuseki JSON API under the private editor prefix
// (owner-entered, kept in localStorage, never in this repo) using the
// signed-in editor session. This page cannot read the editor's
// path-scoped CSRF cookie, so the state endpoint hands the CSRF token
// over and every POST echoes it back in X-CSRFToken.
//-----------------------------------------------------------------------

const NEW_DRAFT_COMMAND =
    /^(?:please )?(?:create |start |make )?(?:a )?new (?:draft|article|post|blog post)(?: (?:article|post|draft))?$/;

/**
 * @typedef {{ id: number, title: string, updated: string, wordCount: number }} DraftSummary
 * @typedef {DraftSummary & { body: string }} DraftDetail
 */

class ArticlesController {
    constructor() {
        this.settings = {
            editorBase: '',
            currentDraftId: 0
        };
        this.settingKeys = ['editorBase', 'currentDraftId'];
        this.csrfToken = '';
        /** @type {DraftSummary[]} */
        this.drafts = [];
        /** @type {DraftDetail | null} */
        this.current = null;
        /** @type {InstanceType<typeof VoiceCommandCore> | null} */
        this.voiceCore = null;
    }

    init() {
        SettingsStore.load(StorageKeys.ARTICLES_SETTINGS, this.settings, this.settingKeys);
        this.setupUI();
        this.setupVoiceCore();
        if (this.settings.editorBase) {
            this.connect();
        } else {
            this.setConnection('Not configured. Enter the editor prefix to connect.');
        }
    }

    saveSettings() {
        SettingsStore.save(StorageKeys.ARTICLES_SETTINGS, this.settings, this.settingKeys);
    }

    //-------UI-------

    setupUI() {
        const baseInput = /** @type {HTMLInputElement | null} */ (document.getElementById('editorBaseInput'));
        if (baseInput) {
            baseInput.value = this.settings.editorBase;
            baseInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') this.applyEditorBase();
            });
        }
        const connectBtn = document.getElementById('connectBtn');
        if (connectBtn) connectBtn.addEventListener('click', () => this.applyEditorBase());

        const newDraftBtn = document.getElementById('newDraftBtn');
        if (newDraftBtn) {
            newDraftBtn.addEventListener('click', () => {
                this.newDraft('').catch(err => this.reportError(err));
            });
        }

        const typeInput = /** @type {HTMLInputElement | null} */ (document.getElementById('typeInput'));
        const addTyped = () => {
            if (!typeInput || !typeInput.value.trim()) return;
            const text = typeInput.value.trim();
            this.appendText(text).then(() => { typeInput.value = ''; })
                .catch(err => this.reportError(err));
        };
        if (typeInput) {
            typeInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') addTyped();
            });
        }
        const typeAddBtn = document.getElementById('typeAddBtn');
        if (typeAddBtn) typeAddBtn.addEventListener('click', addTyped);

        this.renderCurrent();
        this.renderDrafts();
    }

    applyEditorBase() {
        const baseInput = /** @type {HTMLInputElement | null} */ (document.getElementById('editorBaseInput'));
        this.settings.editorBase = baseInput ? baseInput.value.trim() : '';
        this.saveSettings();
        this.connect();
    }

    /** @param {string} message */
    setStatus(message) {
        const el = document.getElementById('status');
        if (el) el.textContent = message;
    }

    /** @param {string} message */
    setConnection(message) {
        const el = document.getElementById('connectionStatus');
        if (el) el.textContent = message;
    }

    /** @param {boolean} visible */
    showSignIn(visible) {
        const row = document.getElementById('signInRow');
        if (row) row.style.display = visible ? '' : 'none';
        const link = /** @type {HTMLAnchorElement | null} */ (document.getElementById('signInLink'));
        if (link && visible) link.href = `${this.apiBase()}/admin/`;
    }

    /** @param {unknown} err */
    reportError(err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === 'not-signed-in') {
            this.setStatus('Not signed in to the editor.');
            this.setConnection('Not signed in.');
            this.showSignIn(true);
            return;
        }
        this.setStatus(message);
    }

    renderCurrent() {
        const title = document.getElementById('draftTitle');
        const meta = document.getElementById('draftMeta');
        const body = document.getElementById('draftBody');
        if (!title || !meta || !body) return;
        if (this.current) {
            title.textContent = this.current.title;
            meta.textContent = `${this.current.wordCount} words`;
            body.textContent = this.current.body || '(empty — dictate the first paragraph)';
        } else {
            title.textContent = 'No draft yet';
            meta.textContent = '';
            body.textContent = 'Dictation will create a draft automatically.';
        }
    }

    renderDrafts() {
        const list = document.getElementById('draftsList');
        if (!list) return;
        list.innerHTML = '';
        if (!this.drafts.length) {
            const empty = document.createElement('p');
            empty.className = 'articles-help';
            empty.textContent = this.csrfToken
                ? 'No unpublished drafts.'
                : 'Connect to the editor to list drafts.';
            list.appendChild(empty);
            return;
        }
        for (const draft of this.drafts) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'vf-btn articles-draft-btn'
                + (draft.id === this.settings.currentDraftId ? ' selected' : '');
            button.textContent = `${draft.title} — ${draft.wordCount} words`;
            button.addEventListener('click', () => {
                this.selectDraft(draft.id).catch(err => this.reportError(err));
            });
            list.appendChild(button);
        }
    }

    //-------VOICE-------

    setupVoiceCore() {
        if (typeof VoiceCommandCore === 'undefined') {
            this.setStatus('Voice recognition is unavailable in this browser; type paragraphs instead.');
            return;
        }
        this.voiceCore = new VoiceCommandCore({
            settings: { autoSubmitMode: false },
            onError: (/** @type {string} */ msg) => this.setStatus(msg)
        });
        this.voiceCore.registerHandler({
            parse: (/** @type {string} */ transcript) => this.parseNewDraftCommand(transcript),
            execute: async () => {
                await this.newDraft('');
            }
        });
        this.voiceCore.setFallbackHandler(async (/** @type {string} */ transcript) => {
            await this.appendText(transcript);
        });
        this.voiceCore.init();
        if (!this.voiceCore.recognition) {
            // The core already set the unsupported-browser status.
            this.voiceCore = null;
        }
    }

    /**
     * @param {string} transcript
     * @returns {{ newDraft: true } | null}
     */
    parseNewDraftCommand(transcript) {
        const normalized = transcript.toLowerCase()
            .replace(/[.,!?]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return NEW_DRAFT_COMMAND.test(normalized) ? { newDraft: true } : null;
    }

    /** @param {string} text */
    speak(text) {
        if (typeof VoiceOutput !== 'undefined') {
            VoiceOutput.speak(text);
        }
    }

    //-------API-------

    apiBase() {
        let base = this.settings.editorBase.trim();
        if (!base) return '';
        base = base.replace(/\/+$/, '');
        if (!/^https?:\/\//.test(base) && !base.startsWith('/')) base = `/${base}`;
        return base;
    }

    /**
     * @param {Response} response
     * @returns {Promise<any>}
     */
    async readJson(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            // The staff middleware answers unauthenticated requests with a
            // redirect to the HTML login page, which fetch follows.
            throw new Error('not-signed-in');
        }
        return response.json();
    }

    async fetchState() {
        const params = this.settings.currentDraftId
            ? `?draft=${this.settings.currentDraftId}` : '';
        const response = await fetch(
            `${this.apiBase()}/articles/api/voice/state/${params}`,
            { credentials: 'same-origin' }
        );
        const data = await this.readJson(response);
        this.csrfToken = data.csrfToken;
        this.drafts = data.drafts;
        if (data.current) {
            this.current = data.current;
        } else if (this.settings.currentDraftId) {
            // The remembered draft was published or deleted meanwhile.
            this.settings.currentDraftId = 0;
            this.current = null;
            this.saveSettings();
        }
        return data;
    }

    /**
     * @param {string} path
     * @param {Record<string, unknown>} payload
     * @param {boolean} [retried]
     * @returns {Promise<any>}
     */
    async post(path, payload, retried = false) {
        const response = await fetch(`${this.apiBase()}${path}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.csrfToken
            },
            body: JSON.stringify(payload)
        });
        if (response.status === 403 && !retried) {
            // Stale CSRF token (for example after a re-login): refresh once.
            await this.fetchState();
            return this.post(path, payload, true);
        }
        const data = await this.readJson(response);
        if (!response.ok || !data.success) {
            throw new Error(data.error || `Request failed (${response.status})`);
        }
        return data;
    }

    //-------ACTIONS-------

    async connect() {
        if (!this.apiBase()) {
            this.setConnection('Not configured. Enter the editor prefix to connect.');
            return;
        }
        this.setConnection('Connecting...');
        try {
            await this.fetchState();
            this.setConnection('Connected. Drafts save into the Fuseki editor database.');
            this.showSignIn(false);
            this.renderCurrent();
            this.renderDrafts();
        } catch (err) {
            this.csrfToken = '';
            if (err instanceof Error && err.message === 'not-signed-in') {
                this.setConnection('Not signed in.');
                this.showSignIn(true);
            } else {
                const message = err instanceof Error ? err.message : String(err);
                this.setConnection(`Connection failed: ${message}`);
            }
            this.renderDrafts();
        }
    }

    requireConnection() {
        if (!this.csrfToken) {
            throw new Error('Not connected to the editor. Set up the connection below.');
        }
    }

    /** @param {string} text */
    async newDraft(text) {
        this.requireConnection();
        const data = await this.post('/articles/api/voice/create/', { text });
        this.current = data;
        this.settings.currentDraftId = data.id;
        this.saveSettings();
        this.drafts.unshift({
            id: data.id, title: data.title, updated: data.updated, wordCount: data.wordCount
        });
        this.renderCurrent();
        this.renderDrafts();
        this.setStatus(`Created ${data.title}`);
        this.speak('New draft created.');
    }

    /** @param {string} text */
    async appendText(text) {
        text = text.trim();
        if (!text) return;
        this.requireConnection();
        if (!this.settings.currentDraftId) {
            await this.newDraft(text);
            return;
        }
        const data = await this.post('/articles/api/voice/append/', {
            id: this.settings.currentDraftId,
            text
        });
        this.current = data;
        const summary = this.drafts.find(draft => draft.id === data.id);
        if (summary) {
            summary.wordCount = data.wordCount;
            summary.updated = data.updated;
        }
        this.renderCurrent();
        this.renderDrafts();
        this.setStatus(`Added. ${data.wordCount} words total.`);
        this.speak('Added.');
    }

    /** @param {number} id */
    async selectDraft(id) {
        this.settings.currentDraftId = id;
        this.saveSettings();
        await this.fetchState();
        this.renderCurrent();
        this.renderDrafts();
        this.setStatus(this.current ? `Selected ${this.current.title}` : 'Draft unavailable.');
    }
}

const articlesController = new ArticlesController();
document.addEventListener('DOMContentLoaded', () => articlesController.init());

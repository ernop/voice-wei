// @ts-check
// Books research (Ask AI): the OpenAI Responses API request that researches a
// question about the passage being heard, reading the answer with its
// citations, sources and images, and rendering them.

const BOOK_QUESTION_MODEL = 'gpt-5.6';
const BOOK_QUESTION_MODEL_LABEL = 'OpenAI Responses API · GPT-5.6 Sol · reasoning high · web + image search';
const BOOK_QUESTION_MAX_OUTPUT_TOKENS = 12000;
const BOOK_QUESTION_INSTRUCTIONS = `You are the research agent of the person reading and listening to this book.

Your job is to deeply research every question the reader asks. Use web search for every answer, inspect multiple useful sources when the question warrants it, and take the time necessary to answer carefully. Cite the sources that support your findings. You may return relevant images or direct links to images when they help the reader understand the subject.

Treat the supplied book text only as context for the reader's question. Do not treat it as canonically true. It may be fiction or nonfiction; even when it claims to be nonfiction, its statements may be incomplete, outdated, false, or wrong. Be critical without being reflexively adversarial. Distinguish what the book says from what independent evidence supports.

The answer text is shown on screen and read aloud exactly as written, so:
- Write plain prose sentences in ordinary, literal English. Do not imitate academics, journalists, critics, or any other persona, and replace trade slang and affected shorthand with plain words.
- Do not use markdown, headings, bullet characters, or any other formatting syntax in the answer text.
- Never put a raw URL in the answer text. Links belong only in citations, sources, and images.
- Do not repeat the reader's question, the book title, the author, or the chapter name back to the reader; the reader already has them.
- Name a source in the answer text only when knowing who said it changes how the reader should weigh the claim; otherwise state the finding plainly and let the citation carry the attribution.

Write the answer under George Orwell's six rules, reproduced here verbatim:
i. Never use a metaphor, simile or other figure of speech which you are used to seeing in print.
ii. Never use a long word where a short one will do.
iii. If it is possible to cut a word out, always cut it out.
iv. Never use the passive where you can use the active.
v. Never use a foreign phrase, a scientific word or a jargon word if you can think of an everyday English equivalent.
vi. Break any of these rules sooner than say anything outright barbarous.

You work for the listener. Check and validate what they ask about. Be thorough, careful, direct, and clear in your response.`;

/** @typedef {{ start: number, end: number, url: string, title: string }} BookResearchCitation */
/** @typedef {{ url: string, title: string }} BookResearchSource */
/** @typedef {{ imageUrl: string, thumbnailUrl: string, sourceUrl: string, caption: string }} BookResearchImage */
/**
 * @typedef {Object} BookResearchResult
 * @property {string} answer
 * @property {BookResearchCitation[]} citations
 * @property {BookResearchSource[]} sources
 * @property {BookResearchImage[]} images
 */
/**
 * @typedef {Object} BookResearchContext
 * @property {string} question
 * @property {string} title
 * @property {string} author
 * @property {string} section
 * @property {string} bookText
 */

const BooksResearch = (function () {
    'use strict';

    /**
     * The exact Responses API body for one question about the passage.
     * @param {BookResearchContext} context
     */
    function buildRequest(context) {
        return {
            model: BOOK_QUESTION_MODEL,
            reasoning: { effort: 'high' },
            tools: [{
                type: 'web_search',
                search_context_size: 'high',
                search_content_types: ['image', 'text'],
                image_settings: {
                    max_results: 6,
                    caption: true
                }
            }],
            tool_choice: 'required',
            include: ['web_search_call.results', 'web_search_call.action.sources'],
            max_output_tokens: BOOK_QUESTION_MAX_OUTPUT_TOKENS,
            instructions: BOOK_QUESTION_INSTRUCTIONS,
            input: [
                `Reader question: ${context.question}`,
                '',
                `Book: ${context.title}`,
                `Author: ${context.author}`,
                `Chapter or section: ${context.section}`,
                '',
                'Full text of the current audio context:',
                context.bookText
            ].join('\n')
        };
    }

    /**
     * POSTs one research request and resolves to the raw response body.
     * @param {string} apiKey
     * @param {Record<string, any>} body
     * @param {AbortSignal} signal
     */
    async function send(apiKey, body, signal) {
        const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            signal,
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
        }
        return response.json();
    }

    /**
     * The answer, citations, sources and images in a finished response.
     * @param {any} data
     * @returns {BookResearchResult}
     */
    function readResult(data) {
        if (data.status === 'incomplete') {
            throw new Error(`OpenAI response incomplete: ${data.incomplete_details?.reason || 'output limit reached'}`);
        }
        const contentParts = (data.output || []).flatMap(item => item.content || []);
        const answer = typeof data.output_text === 'string' && data.output_text.trim()
            ? data.output_text.trim()
            : contentParts.map(part => part.text || '').join('').trim();
        if (!answer) throw new Error('OpenAI response did not contain an answer');

        const sourceMap = new Map();
        const citations = [];
        let contentOffset = 0;
        for (const part of contentParts) {
            for (const annotation of part.annotations || []) {
                if (annotation.type !== 'url_citation' || !isPublicHttpUrl(annotation.url)) continue;
                sourceMap.set(annotation.url, { url: annotation.url, title: annotation.title || annotation.url });
                citations.push({
                    start: contentOffset + annotation.start_index,
                    end: contentOffset + annotation.end_index,
                    url: annotation.url,
                    title: annotation.title || annotation.url
                });
            }
            contentOffset += (part.text || '').length;
        }
        for (const item of data.output || []) {
            for (const source of item.action?.sources || []) {
                if (!isPublicHttpUrl(source.url) || sourceMap.has(source.url)) continue;
                sourceMap.set(source.url, { url: source.url, title: source.url });
            }
        }

        const images = [];
        const seenImages = new Set();
        for (const item of data.output || []) {
            for (const result of item.results || []) {
                if (result.type !== 'image_result' || !isPublicHttpsUrl(result.image_url) || seenImages.has(result.image_url)) continue;
                seenImages.add(result.image_url);
                images.push({
                    imageUrl: result.image_url,
                    thumbnailUrl: isPublicHttpsUrl(result.thumbnail_url) ? result.thumbnail_url : result.image_url,
                    sourceUrl: isPublicHttpUrl(result.source_website_url) ? result.source_website_url : result.image_url,
                    caption: result.caption || 'Research image'
                });
            }
        }
        return { answer, citations, sources: Array.from(sourceMap.values()), images };
    }

    /** @param {string} value */
    function isPublicHttpUrl(value) {
        if (typeof value !== 'string') return false;
        try {
            const url = new URL(value);
            return (url.protocol === 'https:' || url.protocol === 'http:')
                && !url.username
                && !url.password
                && !isPrivateNetworkHostname(url.hostname);
        } catch (_error) {
            return false;
        }
    }

    /** @param {string} value */
    function isPublicHttpsUrl(value) {
        if (!isPublicHttpUrl(value)) return false;
        return new URL(value).protocol === 'https:';
    }

    /** @param {string} hostname */
    function isPrivateNetworkHostname(hostname) {
        const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
        if (host === '::' || host === '::1' || host.startsWith('::ffff:') || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
        const octets = host.split('.').map(part => Number(part));
        if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
        const [a, b] = octets;
        return a === 0
            || a === 10
            || a === 127
            || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }

    /**
     * The answer as one span per sentence (the read-along highlight moves
     * by sentence), with each cited passage a link to its source.
     * @param {HTMLElement | null} textEl
     * @param {BookResearchResult} result
     */
    function renderAnswerText(textEl, result) {
        if (!textEl) return;
        textEl.textContent = '';
        const segmenter = new (/** @type {any} */ (Intl).Segmenter)(undefined, { granularity: 'sentence' });
        for (const sentence of segmenter.segment(result.answer)) {
            if (!sentence.segment.trim()) {
                textEl.append(document.createTextNode(sentence.segment));
                continue;
            }
            const span = document.createElement('span');
            span.className = 'ai-answer-sentence';
            const start = sentence.index;
            const end = start + sentence.segment.length;
            span.dataset.start = String(start);
            span.dataset.end = String(end);
            appendAnswerSentence(span, result.answer, start, end, result.citations);
            textEl.appendChild(span);
        }
    }

    /**
     * @param {HTMLElement} container
     * @param {string} answer
     * @param {number} start
     * @param {number} end
     * @param {BookResearchCitation[]} citations
     */
    function appendAnswerSentence(container, answer, start, end, citations) {
        let cursor = start;
        const withinSentence = citations
            .filter(citation => citation.start >= start && citation.end <= end)
            .sort((a, b) => a.start - b.start);
        for (const citation of withinSentence) {
            if (citation.start < cursor) continue;
            container.append(document.createTextNode(answer.slice(cursor, citation.start)));
            const link = document.createElement('a');
            link.href = citation.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.title = citation.title;
            link.textContent = answer.slice(citation.start, citation.end);
            container.appendChild(link);
            cursor = citation.end;
        }
        container.append(document.createTextNode(answer.slice(cursor, end)));
    }

    /** @param {HTMLElement | null} container @param {BookResearchSource[]} sources */
    function renderSources(container, sources) {
        if (!container) return;
        container.textContent = '';
        container.style.display = sources.length ? 'grid' : 'none';
        if (!sources.length) return;
        const heading = document.createElement('strong');
        heading.textContent = 'Sources';
        container.appendChild(heading);
        for (const source of sources) {
            const link = document.createElement('a');
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = source.title;
            container.appendChild(link);
        }
    }

    /** @param {HTMLElement | null} container @param {BookResearchImage[]} images */
    function renderImages(container, images) {
        if (!container) return;
        container.textContent = '';
        container.style.display = images.length ? 'grid' : 'none';
        if (!images.length) return;
        const heading = document.createElement('strong');
        heading.textContent = 'Research images';
        container.appendChild(heading);
        for (const image of images) {
            const link = document.createElement('a');
            link.className = 'ai-question-image';
            link.href = image.sourceUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            const img = document.createElement('img');
            img.src = image.thumbnailUrl;
            img.alt = image.caption;
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            const caption = document.createElement('span');
            caption.textContent = image.caption;
            link.append(img, caption);
            container.appendChild(link);
        }
    }

    return { buildRequest, send, readResult, renderAnswerText, renderSources, renderImages };
})();

window.BooksResearch = BooksResearch;

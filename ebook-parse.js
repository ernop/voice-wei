// @ts-check
// Books parsing: an imported file (EPUB, PDF, HTML, plain text) or a set of
// web pages becomes reader sections plus the audio parts each section is
// narrated in. Owns pdf.js and JSZip.

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// One audio part is one speech request, and the speech endpoint takes at most
// 4096 characters; parts end at a sentence or clause break before this.
const TTS_CHUNK_SIZE = 3800;
const ESTIMATED_WORDS_PER_MINUTE = 155;
// Saved books whose plan has an older version rebuild their audio parts.
const AUDIO_PLAN_VERSION = 2;

/** @typedef {{ title: string, text: string, html?: string }} RawBookSection */

const BooksParse = (function () {
    'use strict';

    /**
     * @param {File} file
     * @param {string} bookId
     * @param {{ speed: number, onProgress: (message: string) => void }} options
     */
    async function parseFile(file, bookId, { speed, onProgress }) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'txt';
        let title = file.name.replace(/\.[^.]+$/, '');
        let author = '';
        /** @type {RawBookSection[]} */
        let rawSections = [];
        if (extension === 'epub') {
            const epub = await parseEpub(file);
            title = epub.title || title;
            author = epub.author || '';
            rawSections = epub.sections;
        } else if (extension === 'pdf') {
            rawSections = await parsePdf(file, onProgress);
        } else if (extension === 'html' || extension === 'htm') {
            rawSections = await parseHtml(file);
        } else if (extension === 'txt') {
            rawSections = sectionsFromText(await readTextFile(file));
        } else {
            throw new Error(`Unsupported file format: ${extension}`);
        }
        rawSections = rawSections
            .map((section, index) => ({
                title: section.title || `Section ${index + 1}`,
                text: cleanText(section.text || ''),
                html: section.html ? sanitizeReaderHtml(section.html) : ''
            }))
            .filter(section => section.text.length > 0);
        if (rawSections.length === 0) throw new Error('No readable text found');

        const { sections, segments, totalWords, charCount } = assembleSectionsAndSegments(bookId, rawSections, speed);
        const now = new Date().toISOString();
        const book = {
            id: bookId,
            schemaVersion: 3,
            audioPlanVersion: AUDIO_PLAN_VERSION,
            title,
            author,
            format: extension,
            fileName: file.name,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size,
            rawFile: file,
            sectionCount: sections.length,
            segmentCount: segments.length,
            generatedSegmentCount: 0,
            wordCount: totalWords,
            charCount,
            estimatedDurationSec: estimateDuration(totalWords, speed),
            generatedDurationSec: 0,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now,
            archivedAt: '',
            readingSectionId: sections[0]?.id || '',
            readingCharOffset: 0,
            listeningSegmentId: segments[0]?.id || '',
            listeningOffsetSec: 0,
            legacyAudioBlob: null,
            legacyAudioSize: 0
        };
        return { book, sections, segments };
    }

    /**
     * Turn normalized raw sections into persistent BookSection + AudioSegment
     * arrays. Shared by file imports and web (URL) imports.
     * @param {string} bookId
     * @param {RawBookSection[]} rawSections
     * @param {number} speed narration speed, for the estimated durations
     */
    function assembleSectionsAndSegments(bookId, rawSections, speed) {
        /** @type {BookSection[]} */
        const sections = [];
        /** @type {AudioSegment[]} */
        const segments = [];
        let charCursor = 0;
        let segmentIndex = 0;
        let totalWords = 0;
        for (let i = 0; i < rawSections.length; i++) {
            const raw = rawSections[i];
            const sectionId = `sec-${i}`;
            const wordCount = countWords(raw.text);
            const section = {
                key: sectionKey(bookId, sectionId),
                bookId,
                id: sectionId,
                spineIndex: i,
                title: raw.title,
                text: raw.text,
                html: raw.html || '',
                charStart: charCursor,
                charEnd: charCursor + raw.text.length,
                wordCount
            };
            sections.push(section);
            totalWords += wordCount;
            const pieces = splitIntoSegmentPieces(raw.text);
            for (let j = 0; j < pieces.length; j++) {
                const piece = pieces[j];
                const segmentId = `seg-${segmentIndex}`;
                const segmentWords = countWords(piece.text);
                segments.push({
                    key: segmentKey(bookId, segmentId),
                    bookId,
                    id: segmentId,
                    sectionId,
                    segmentIndex,
                    sectionSegmentIndex: j,
                    charStart: section.charStart + piece.start,
                    charEnd: section.charStart + piece.end,
                    text: piece.text,
                    wordCount: segmentWords,
                    estimatedDurationSec: estimateDuration(segmentWords, speed),
                    status: 'pending',
                    blob: null,
                    audioSize: 0,
                    durationSec: 0,
                    generatedAt: '',
                    audioSettings: null,
                    error: ''
                });
                segmentIndex++;
            }
            charCursor = section.charEnd + 2;
        }
        return { sections, segments, totalWords, charCount: charCursor };
    }

    /** @param {File} file */
    async function parseEpub(file) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');
        const zip = await JSZip.loadAsync(file);
        const containerXml = await zip.file('META-INF/container.xml')?.async('text');
        if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
        if (!rootfilePath) throw new Error('Invalid EPUB: cannot find content.opf');
        const opfContent = await zip.file(rootfilePath)?.async('text');
        if (!opfContent) throw new Error('Invalid EPUB: cannot read content.opf');
        const opfDoc = parser.parseFromString(opfContent, 'text/xml');
        const title = opfDoc.querySelector('metadata title, dc\\:title')?.textContent?.trim() || '';
        const author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent?.trim() || '';
        const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
        const manifest = new Map();
        const manifestItems = new Map();
        const mediaTypes = new Map();
        opfDoc.querySelectorAll('manifest item').forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type') || '';
            if (id && href) {
                const path = normalizePath(basePath + href);
                const properties = item.getAttribute('properties') || '';
                manifest.set(id, href);
                manifestItems.set(id, { href, path, mediaType, properties });
                mediaTypes.set(path, mediaType);
            }
        });
        const tocTitles = await parseEpubToc(zip, opfDoc, manifestItems);
        /** @type {RawBookSection[]} */
        const sections = [];
        const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref'));
        for (let i = 0; i < spineItems.length; i++) {
            const idref = spineItems[i].getAttribute('idref');
            const href = idref ? manifest.get(idref) : '';
            if (!href) continue;
            const content = await zip.file(basePath + href)?.async('text');
            if (!content) continue;
            const doc = parser.parseFromString(content, 'text/html');
            doc.querySelectorAll('script, style, nav, footer').forEach(el => el.remove());
            const filePath = normalizePath(basePath + href);
            const fileDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
            const images = Array.from(doc.querySelectorAll('img, image'));
            for (const img of images) {
                const rawSrc = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                if (!rawSrc || rawSrc.startsWith('data:')) continue;
                const resolved = normalizePath(rawSrc.startsWith('/') ? rawSrc.substring(1) : fileDir + rawSrc);
                const imgFile = zip.file(resolved);
                if (!imgFile) continue;
                const blob = await imgFile.async('blob');
                const typedBlob = new Blob([blob], { type: mediaTypes.get(resolved) || getMimeTypeFromFilename(resolved) });
                const dataUrl = await blobToDataUrl(typedBlob);
                img.setAttribute('src', dataUrl);
                img.removeAttribute('xlink:href');
            }
            const heading = doc.querySelector('h1, h2, h3')?.textContent?.trim();
            const text = doc.body?.textContent || '';
            sections.push({ title: tocTitles.get(filePath) || heading || `Chapter ${sections.length + 1}`, text, html: doc.body?.innerHTML || '' });
        }
        return { title, author, sections };
    }

    /**
     * @param {any} zip
     * @param {Document} opfDoc
     * @param {Map<string, { href: string, path: string, mediaType: string, properties: string }>} manifestItems
     */
    async function parseEpubToc(zip, opfDoc, manifestItems) {
        const titles = new Map();
        const navItem = Array.from(manifestItems.values())
            .find(item => item.properties.split(/\s+/).includes('nav'));
        if (navItem) {
            const navContent = await zip.file(navItem.path)?.async('text');
            if (navContent) addEpubNavTitles(titles, navContent, navItem.path);
        }
        const ncxId = opfDoc.querySelector('spine')?.getAttribute('toc') || '';
        const ncxItem = ncxId ? manifestItems.get(ncxId) : null;
        if (ncxItem && titles.size === 0) {
            const ncxContent = await zip.file(ncxItem.path)?.async('text');
            if (ncxContent) addEpubNcxTitles(titles, ncxContent, ncxItem.path);
        }
        return titles;
    }

    /**
     * @param {Map<string, string>} titles
     * @param {string} navContent
     * @param {string} navPath
     */
    function addEpubNavTitles(titles, navContent, navPath) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(navContent, 'text/html');
        const navs = Array.from(doc.querySelectorAll('nav'));
        const tocNav = navs.find(nav => /\btoc\b/i.test(nav.getAttribute('epub:type') || nav.getAttribute('type') || nav.getAttribute('role') || '')) || navs[0];
        if (!tocNav) return;
        const navDir = navPath.substring(0, navPath.lastIndexOf('/') + 1);
        for (const link of Array.from(tocNav.querySelectorAll('a[href]'))) {
            const label = cleanText(link.textContent || '');
            const href = link.getAttribute('href') || '';
            if (!label || !href) continue;
            const path = resolveEpubHref(navDir, href);
            if (!path) continue;
            if (!titles.has(path)) titles.set(path, label);
        }
    }

    /**
     * @param {Map<string, string>} titles
     * @param {string} ncxContent
     * @param {string} ncxPath
     */
    function addEpubNcxTitles(titles, ncxContent, ncxPath) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(ncxContent, 'text/xml');
        const ncxDir = ncxPath.substring(0, ncxPath.lastIndexOf('/') + 1);
        for (const navPoint of Array.from(doc.querySelectorAll('navPoint'))) {
            const label = cleanText(navPoint.querySelector('navLabel text')?.textContent || '');
            const src = navPoint.querySelector('content')?.getAttribute('src') || '';
            if (!label || !src) continue;
            const path = resolveEpubHref(ncxDir, src);
            if (!path) continue;
            if (!titles.has(path)) titles.set(path, label);
        }
    }

    /** @param {string} directory @param {string} href */
    function resolveEpubHref(directory, href) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return '';
        const withoutFragment = href.split('#')[0];
        return normalizePath(withoutFragment.startsWith('/') ? withoutFragment.substring(1) : directory + withoutFragment);
    }

    /** @param {File} file @param {(message: string) => void} onProgress */
    async function parsePdf(file, onProgress) {
        if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js library not loaded');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        /** @type {string[]} */
        const pageTexts = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map((/** @type {any} */ item) => item.str).join(' ');
            pageTexts.push(text);
            if (pdf.numPages > 20 && i % 10 === 0) onProgress(`Reading PDF ${Math.round(i / pdf.numPages * 100)}%`);
        }
        const outline = await pdf.getOutline();
        const outlineSections = outline ? await sectionsFromPdfOutline(pdf, outline, pageTexts) : [];
        if (outlineSections.length > 0) return outlineSections;
        return pageTexts.map((text, index) => ({ title: `Page ${index + 1}`, text }));
    }

    /**
     * @param {any} pdf
     * @param {any[]} outline
     * @param {string[]} pageTexts
     */
    async function sectionsFromPdfOutline(pdf, outline, pageTexts) {
        const flat = flattenPdfOutline(outline);
        /** @type {{ title: string, page: number }[]} */
        const entries = [];
        for (const item of flat) {
            const page = await resolvePdfOutlinePage(pdf, item.dest);
            if (page >= 1 && page <= pageTexts.length) entries.push({ title: item.title, page });
        }
        const unique = entries
            .filter((entry, index, list) => list.findIndex(item => item.page === entry.page) === index)
            .sort((a, b) => a.page - b.page);
        if (unique.length === 0) return [];
        return unique.map((entry, index) => {
            const nextPage = unique[index + 1]?.page || pageTexts.length + 1;
            return {
                title: entry.title || `Page ${entry.page}`,
                text: pageTexts.slice(entry.page - 1, nextPage - 1).join('\n\n')
            };
        }).filter(section => section.text.trim().length > 0);
    }

    /** @param {any[]} items */
    function flattenPdfOutline(items) {
        /** @type {{ title: string, dest: any }[]} */
        const flat = [];
        for (const item of items) {
            flat.push({ title: cleanText(item.title || ''), dest: item.dest });
            if (item.items?.length) flat.push(...flattenPdfOutline(item.items));
        }
        return flat;
    }

    /** @param {any} pdf @param {any} dest */
    async function resolvePdfOutlinePage(pdf, dest) {
        if (!dest) return -1;
        try {
            const explicitDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
            const ref = Array.isArray(explicitDest) ? explicitDest[0] : null;
            if (!ref) return -1;
            return await pdf.getPageIndex(ref) + 1;
        } catch (error) {
            return -1;
        }
    }

    /** @param {File} file */
    async function parseHtml(file) {
        const html = await readTextFile(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, nav, footer').forEach(el => el.remove());
        const headings = Array.from(doc.body?.querySelectorAll('h1, h2') || []);
        if (headings.length === 0) {
            return [{ title: doc.querySelector('title')?.textContent?.trim() || 'HTML document', text: doc.body?.textContent || '', html: doc.body?.innerHTML || '' }];
        }
        /** @type {RawBookSection[]} */
        const sections = [];
        for (let i = 0; i < headings.length; i++) {
            const heading = headings[i];
            let text = heading.textContent || '';
            let html = heading.outerHTML;
            let node = heading.nextSibling;
            while (node && node !== headings[i + 1]) {
                text += `\n${node.textContent || ''}`;
                if (node instanceof Element) html += node.outerHTML;
                else html += escapeHtml(node.textContent || '');
                node = node.nextSibling;
            }
            sections.push({ title: heading.textContent?.trim() || `Section ${i + 1}`, text, html });
        }
        return sections;
    }

    /** @param {string} text */
    function sectionsFromText(text) {
        const clean = cleanText(text);
        const chapters = sectionsFromTextChapterHeadings(clean);
        if (chapters.length > 1) return chapters;
        const maxSectionChars = 12000;
        /** @type {RawBookSection[]} */
        const sections = [];
        let cursor = 0;
        while (cursor < clean.length) {
            let end = Math.min(clean.length, cursor + maxSectionChars);
            if (end < clean.length) {
                const breakAt = Math.max(clean.lastIndexOf('\n\n', end), clean.lastIndexOf('. ', end));
                if (breakAt > cursor + 2000) end = breakAt + 1;
            }
            const sectionText = clean.slice(cursor, end).trim();
            if (sectionText) sections.push({ title: `Part ${sections.length + 1}`, text: sectionText });
            cursor = end;
        }
        return sections;
    }

    /** @param {string} text */
    function sectionsFromTextChapterHeadings(text) {
        const headingPattern = /^[ \t]*(chapter\s+(?:\d+|[ivxlcdm]+)\.?(?:[ \t]+[^\n]+)?)[ \t]*$/gim;
        const matches = Array.from(text.matchAll(headingPattern)).map(match => ({
            title: match[1].trim(),
            start: match.index || 0,
            normalized: match[1].replace(/\s+/g, ' ').trim().toLowerCase()
        }));
        if (matches.length < 2) return [];

        const occurrences = new Map();
        for (const match of matches) {
            const grouped = occurrences.get(match.normalized) || [];
            grouped.push(match);
            occurrences.set(match.normalized, grouped);
        }
        const hasContentsDuplicates = Array.from(occurrences.values()).some(group => group.length > 1);
        const headings = hasContentsDuplicates
            ? Array.from(occurrences.values()).map(group => group[group.length - 1]).sort((a, b) => a.start - b.start)
            : matches;
        if (headings.length < 2) return [];

        const sections = [];
        const frontMatter = text.slice(0, headings[0].start).trim();
        if (frontMatter.length > 200) sections.push({ title: 'Front matter', text: frontMatter });
        for (let i = 0; i < headings.length; i++) {
            const chapterText = text.slice(headings[i].start, headings[i + 1]?.start || text.length).trim();
            if (chapterText) sections.push({ title: headings[i].title, text: chapterText });
        }
        return sections;
    }

    /** @param {File} file */
    async function readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(/** @type {string} */ (e.target?.result) || '');
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /** @param {string} text */
    function splitIntoSegmentPieces(text) {
        /** @type {{ text: string, start: number, end: number }[]} */
        const pieces = [];
        let cursor = 0;
        while (cursor < text.length) {
            while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
            if (cursor >= text.length) break;
            let end = Math.min(text.length, cursor + TTS_CHUNK_SIZE);
            if (end < text.length) {
                end = findSegmentBreak(text, cursor, end);
            }
            let pieceEnd = end;
            while (pieceEnd > cursor && /\s/.test(text[pieceEnd - 1])) pieceEnd--;
            const pieceText = text.slice(cursor, pieceEnd);
            if (pieceText) pieces.push({ text: pieceText, start: cursor, end: pieceEnd });
            cursor = end;
        }
        return pieces;
    }

    /** @param {string} text @param {number} cursor @param {number} hardEnd */
    function findSegmentBreak(text, cursor, hardEnd) {
        const candidate = text.slice(cursor, hardEnd);
        let sentenceEnd = -1;
        const sentenceBoundary = /[.!?](?:["'”’)\]]+)?(?=\s|$)|\n{2,}/g;
        for (const match of candidate.matchAll(sentenceBoundary)) {
            const end = cursor + (match.index || 0) + match[0].length;
            sentenceEnd = end;
        }
        if (sentenceEnd !== -1) return sentenceEnd;

        let clauseEnd = -1;
        const clauseBoundary = /[;:](?=\s)/g;
        for (const match of candidate.matchAll(clauseBoundary)) {
            const end = cursor + (match.index || 0) + 1;
            if (end > cursor + 500) clauseEnd = end;
        }
        if (clauseEnd !== -1) return clauseEnd;

        for (let end = hardEnd; end > cursor + 500; end--) {
            if (/\s/.test(text[end - 1])) return end - 1;
        }
        return hardEnd;
    }

    /** @param {number} words @param {number} speed */
    function estimateDuration(words, speed) {
        return Math.max(1, Math.round(words / ESTIMATED_WORDS_PER_MINUTE * 60 / Math.max(0.25, speed || 1)));
    }

    /** @param {string} bookId @param {string} sectionId */
    function sectionKey(bookId, sectionId) {
        return `${bookId}:${sectionId}`;
    }

    /** @param {string} bookId @param {string} segmentId */
    function segmentKey(bookId, segmentId) {
        return `${bookId}:${segmentId}`;
    }

    /** @param {string} text */
    function cleanText(text) {
        return text
            .replace(/[\t\f\v]+/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/ {2,}/g, ' ')
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    /** @param {string} html */
    function sanitizeReaderHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        const allowedTags = new Set([
            'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CITE', 'CODE', 'DIV', 'EM',
            'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR',
            'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'SMALL', 'SPAN',
            'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD',
            'TR', 'U', 'UL'
        ]);
        const allowedAttrs = new Set(['alt', 'colspan', 'href', 'rowspan', 'src', 'title']);
        const elements = Array.from(template.content.querySelectorAll('*'));
        for (const el of elements) {
            if (!allowedTags.has(el.tagName)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                continue;
            }
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const value = attr.value || '';
                const allowed = allowedAttrs.has(name) || name.startsWith('aria-');
                const safeUrl = !['href', 'src'].includes(name) || value.startsWith('data:') || value.startsWith('#') || value.startsWith('http://') || value.startsWith('https://');
                if (!allowed || !safeUrl) el.removeAttribute(attr.name);
            }
            if (el.tagName === 'A') {
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener');
            }
        }
        return template.innerHTML;
    }

    /** @param {string} path */
    function normalizePath(path) {
        const parts = path.split('/').filter(part => part && part !== '.');
        /** @type {string[]} */
        const result = [];
        for (const part of parts) {
            if (part === '..') result.pop();
            else result.push(part);
        }
        return result.join('/');
    }

    /** @param {string} filename */
    function getMimeTypeFromFilename(filename) {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeTypes = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            webp: 'image/webp'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    /** @param {Blob} blob */
    async function blobToDataUrl(blob) {
        return /** @type {Promise<string>} */ (new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Could not read EPUB image'));
            reader.readAsDataURL(blob);
        }));
    }

    /** @param {string} text */
    function countWords(text) {
        return text.split(/\s+/).filter(Boolean).length;
    }

    return { parseFile, parsePdf, assembleSectionsAndSegments, cleanText, estimateDuration };
})();

window.BooksParse = BooksParse;

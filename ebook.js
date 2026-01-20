// @ts-check
// Ebook to Audiobook Converter using OpenAI TTS

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// OpenAI TTS limits: 4096 characters per request
const TTS_CHUNK_SIZE = 4000;

// Timing constants
const PROGRESS_UPDATE_INTERVAL_MS = 100;

// Voice descriptions for UI
const VOICE_DESCRIPTIONS = {
    alloy: 'Neutral and balanced, good for most content.',
    echo: 'Male voice, clear and articulate. Good for non-fiction.',
    fable: 'British accent, warm and expressive. Great for fiction.',
    onyx: 'Deep male voice, authoritative. Good for dramatic content.',
    nova: 'Female voice, warm and conversational. Good for stories.',
    shimmer: 'Soft female voice, gentle and calm. Good for relaxing content.'
};

// Sample text for voice preview
const VOICE_PREVIEW_TEXT = 'Welcome to your audiobook. This is a preview of how the narration will sound.';

/**
 * @typedef {Object} ImageAsset
 * @property {string} id - Unique identifier
 * @property {string} src - Object URL for the image blob
 * @property {string} alt - Alt text or caption
 * @property {string} filename - Original filename
 * @property {string} mimeType - Image MIME type
 * @property {number} afterChunk - Text chunk index this image appears after (-1 if unknown)
 */

/**
 * @typedef {Object} BookData
 * @property {string} title
 * @property {string} author
 * @property {string} text
 * @property {string[]} chapters
 * @property {string} format
 * @property {ImageAsset[]} images - Extracted images from the book
 */

/**
 * @typedef {Object} Settings
 * @property {string} voice
 * @property {string} model
 * @property {number} speed
 */

class EbookController {
    constructor() {
        /** @type {string | null} */
        this.apiKey = null;
        /** @type {BookData | null} */
        this.bookData = null;
        /** @type {Settings} */
        this.settings = {
            voice: 'alloy',
            model: 'tts-1',
            speed: 1.0
        };
        /** @type {Blob | null} */
        this.audioBlob = null;
        /** @type {boolean} */
        this.isConverting = false;
        /** @type {AbortController | null} */
        this.abortController = null;

        this.init();
    }

    async init() {
        this.loadApiKey();
        this.loadSettings();
        this.setupUI();
        this.setupDragAndDrop();
    }

    // API Key Management
    loadApiKey() {
        const storedKey = localStorage.getItem('openaiApiKey');
        if (storedKey && storedKey.length > 10) {
            this.apiKey = storedKey;
            const keyPreview = storedKey.substring(0, 10) + '...';
            this.log('info', `OpenAI API Key loaded (${keyPreview})`);
            this.updateApiKeyUI(true);
        } else {
            this.log('warn', 'OpenAI API Key not configured');
            this.showApiKeyOverlay();
            this.updateApiKeyUI(false);
        }
    }

    /** @param {string} apiKey */
    saveApiKey(apiKey) {
        if (!apiKey || apiKey.length < 10) {
            this.updateStatus('Invalid API key');
            return false;
        }

        localStorage.setItem('openaiApiKey', apiKey);
        this.apiKey = apiKey;

        const keyPreview = apiKey.substring(0, 10) + '...';
        this.log('info', `API Key saved (${keyPreview})`);
        this.updateStatus('API key saved');
        this.hideApiKeyOverlay();
        this.updateApiKeyUI(true);

        // Clear inputs
        const settingsInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        if (settingsInput) settingsInput.value = '';
        if (overlayInput) overlayInput.value = '';

        // Enable convert button if book is loaded
        this.updateConvertButton();

        return true;
    }

    removeApiKey() {
        localStorage.removeItem('openaiApiKey');
        this.apiKey = null;
        this.log('info', 'API Key removed');
        this.updateStatus('API key removed');
        this.updateApiKeyUI(false);
        this.showApiKeyOverlay();
        this.updateConvertButton();
    }

    showApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    hideApiKeyOverlay() {
        const overlay = document.getElementById('apiKeyOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    /** @param {boolean} hasKey */
    updateApiKeyUI(hasKey) {
        const statusEl = document.getElementById('apiKeyStatus');
        const inputRow = document.getElementById('apiKeyInputRow');
        const actionsRow = document.getElementById('apiKeyActions');

        if (!statusEl || !inputRow || !actionsRow) return;

        if (hasKey) {
            const storedKey = localStorage.getItem('openaiApiKey') || '';
            const preview = storedKey.substring(0, 10) + '...' + storedKey.substring(storedKey.length - 4);
            statusEl.textContent = `Configured: ${preview}`;
            statusEl.className = 'api-key-status configured';
            inputRow.style.display = 'none';
            actionsRow.style.display = 'flex';
        } else {
            statusEl.textContent = 'Not configured';
            statusEl.className = 'api-key-status not-configured';
            inputRow.style.display = 'flex';
            actionsRow.style.display = 'none';
        }
    }

    // Settings Management
    loadSettings() {
        const saved = localStorage.getItem('ebookSettings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }

        // Update UI
        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');

        if (voiceEl) voiceEl.value = this.settings.voice;
        if (modelEl) modelEl.value = this.settings.model;
        if (speedEl) speedEl.value = String(this.settings.speed);
        if (speedValueEl) speedValueEl.textContent = `${this.settings.speed}x`;
    }

    saveSettings() {
        localStorage.setItem('ebookSettings', JSON.stringify(this.settings));
    }

    updateVoiceDescription() {
        const descEl = document.getElementById('voiceDescription');
        if (descEl) {
            descEl.textContent = VOICE_DESCRIPTIONS[this.settings.voice] || '';
        }
    }

    /** @type {HTMLAudioElement | null} */
    previewAudio = null;

    async previewVoice() {
        if (!this.apiKey) {
            this.updateStatus('API key required for voice preview');
            return;
        }

        const previewBtn = document.getElementById('previewVoiceBtn');
        if (!previewBtn) return;

        // If already playing, stop
        if (this.previewAudio && !this.previewAudio.paused) {
            this.previewAudio.pause();
            this.previewAudio = null;
            previewBtn.classList.remove('playing');
            previewBtn.innerHTML = '&#9654;';
            return;
        }

        previewBtn.disabled = true;
        previewBtn.innerHTML = '...';
        this.log('info', `Previewing voice: ${this.settings.voice}`);

        try {
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    input: VOICE_PREVIEW_TEXT,
                    voice: this.settings.voice,
                    speed: this.settings.speed,
                    response_format: 'mp3'
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            this.previewAudio = new Audio(audioUrl);
            this.previewAudio.addEventListener('ended', () => {
                previewBtn.classList.remove('playing');
                previewBtn.innerHTML = '&#9654;';
                URL.revokeObjectURL(audioUrl);
            });

            previewBtn.classList.add('playing');
            previewBtn.innerHTML = '&#9632;';
            previewBtn.disabled = false;
            await this.previewAudio.play();

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Voice preview failed: ${message}`);
            this.updateStatus('Preview failed');
            previewBtn.innerHTML = '&#9654;';
            previewBtn.disabled = false;
        }
    }

    setupUI() {
        // Settings panel
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsPanel = document.getElementById('settingsPanel');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');

        if (settingsBtn && settingsPanel) {
            settingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
            });
        }

        if (closeSettingsBtn && settingsPanel) {
            closeSettingsBtn.addEventListener('click', () => {
                settingsPanel.style.display = 'none';
            });
        }

        // API key management
        this.setupApiKeyUI();

        // Settings controls
        const voiceEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsVoice'));
        const modelEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('ttsModel'));
        const speedEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ttsSpeed'));
        const speedValueEl = document.getElementById('ttsSpeedValue');

        if (voiceEl) {
            voiceEl.addEventListener('change', () => {
                this.settings.voice = voiceEl.value;
                this.saveSettings();
                this.updateVoiceDescription();
            });
            // Set initial description
            this.updateVoiceDescription();
        }

        // Voice preview button
        const previewBtn = document.getElementById('previewVoiceBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => this.previewVoice());
        }

        if (modelEl) {
            modelEl.addEventListener('change', () => {
                this.settings.model = modelEl.value;
                this.saveSettings();
            });
        }

        if (speedEl && speedValueEl) {
            speedEl.addEventListener('input', () => {
                this.settings.speed = parseFloat(speedEl.value);
                speedValueEl.textContent = `${this.settings.speed}x`;
                this.saveSettings();
            });
        }

        // File upload
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('fileInput'));

        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => {
                const target = /** @type {HTMLInputElement} */ (e.target);
                if (target.files && target.files[0]) {
                    this.handleFile(target.files[0]);
                }
            });
        }

        // Convert button
        const convertBtn = document.getElementById('convertBtn');
        if (convertBtn) {
            convertBtn.addEventListener('click', () => this.convertToAudio());
        }

        // Clear book button
        const clearBookBtn = document.getElementById('clearBookBtn');
        if (clearBookBtn) {
            clearBookBtn.addEventListener('click', () => this.clearBook());
        }

        // Cancel conversion button
        const cancelBtn = document.getElementById('cancelConversionBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelConversion());
        }

        // Download button
        const downloadBtn = document.getElementById('downloadAudioBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadAudio());
        }

        // Text preview actions
        const selectAllBtn = document.getElementById('selectAllTextBtn');
        const copyTextBtn = document.getElementById('copyTextBtn');

        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => this.selectAllText());
        }

        if (copyTextBtn) {
            copyTextBtn.addEventListener('click', () => this.copyText());
        }

        // Log clear button
        const clearLogBtn = document.getElementById('clearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => this.clearLog());
        }

        // Image overlay handlers
        const closeOverlay = document.getElementById('closeImageOverlay');
        const prevImage = document.getElementById('prevImage');
        const nextImage = document.getElementById('nextImage');
        const imageOverlay = document.getElementById('imageOverlay');

        if (closeOverlay) {
            closeOverlay.addEventListener('click', () => this.closeImageFullscreen());
        }
        if (prevImage) {
            prevImage.addEventListener('click', () => this.navigateImage(-1));
        }
        if (nextImage) {
            nextImage.addEventListener('click', () => this.navigateImage(1));
        }
        if (imageOverlay) {
            imageOverlay.addEventListener('click', (e) => {
                if (e.target === imageOverlay) {
                    this.closeImageFullscreen();
                }
            });
            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (imageOverlay.style.display === 'none') return;
                if (e.key === 'Escape') this.closeImageFullscreen();
                if (e.key === 'ArrowLeft') this.navigateImage(-1);
                if (e.key === 'ArrowRight') this.navigateImage(1);
            });
        }
    }

    setupApiKeyUI() {
        // Settings panel API key handlers
        const saveBtn = document.getElementById('saveApiKeyBtn');
        const showBtn = document.getElementById('showApiKeyBtn');
        const changeBtn = document.getElementById('changeApiKeyBtn');
        const removeBtn = document.getElementById('removeApiKeyBtn');
        const inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyInput'));

        if (saveBtn && inputEl) {
            saveBtn.addEventListener('click', () => {
                this.saveApiKey(inputEl.value.trim());
            });
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey(inputEl.value.trim());
                }
            });
        }

        if (showBtn) {
            showBtn.addEventListener('click', () => {
                const storedKey = localStorage.getItem('openaiApiKey') || '';
                if (showBtn.textContent === 'Show') {
                    const statusEl = document.getElementById('apiKeyStatus');
                    if (statusEl) statusEl.textContent = storedKey;
                    showBtn.textContent = 'Hide';
                } else {
                    this.updateApiKeyUI(true);
                    showBtn.textContent = 'Show';
                }
            });
        }

        if (changeBtn) {
            changeBtn.addEventListener('click', () => {
                const inputRow = document.getElementById('apiKeyInputRow');
                const actionsRow = document.getElementById('apiKeyActions');
                if (inputRow) inputRow.style.display = 'flex';
                if (actionsRow) actionsRow.style.display = 'none';
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                if (confirm('Remove your API key from localStorage?')) {
                    this.removeApiKey();
                }
            });
        }

        // Overlay API key handlers
        const overlayInput = /** @type {HTMLInputElement | null} */ (document.getElementById('openaiApiKeyOverlayInput'));
        const overlaySaveBtn = document.getElementById('saveApiKeyOverlayBtn');

        if (overlaySaveBtn && overlayInput) {
            overlaySaveBtn.addEventListener('click', () => {
                this.saveApiKey(overlayInput.value.trim());
            });
            overlayInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.saveApiKey(overlayInput.value.trim());
                }
            });
        }
    }

    setupDragAndDrop() {
        const uploadArea = document.getElementById('uploadArea');
        if (!uploadArea) return;

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files[0]) {
                this.handleFile(e.dataTransfer.files[0]);
            }
        });
    }

    /** @param {File} file */
    async handleFile(file) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        this.log('info', `Processing file: ${file.name} (${this.formatFileSize(file.size)})`);
        this.updateStatus('Processing file...');

        try {
            let text = '';
            let title = file.name.replace(/\.[^.]+$/, '');
            let author = '';
            /** @type {string[]} */
            let chapters = [];
            /** @type {ImageAsset[]} */
            let images = [];

            switch (extension) {
                case 'txt':
                    text = await this.readTextFile(file);
                    break;
                case 'epub':
                    const epubData = await this.parseEpub(file);
                    text = epubData.text;
                    title = epubData.title || title;
                    author = epubData.author || '';
                    chapters = epubData.chapters || [];
                    images = epubData.images || [];
                    break;
                case 'pdf':
                    const pdfData = await this.parsePdf(file);
                    text = pdfData.text;
                    images = pdfData.images || [];
                    break;
                case 'html':
                case 'htm':
                    text = await this.parseHtml(file);
                    break;
                default:
                    throw new Error(`Unsupported file format: ${extension}`);
            }

            if (!text || text.trim().length === 0) {
                throw new Error('No text content found in file');
            }

            // Clean up text
            text = this.cleanText(text);

            this.bookData = {
                title,
                author,
                text,
                chapters,
                format: extension || 'unknown',
                images
            };

            this.displayBook();
            this.updateStatus('Book loaded successfully');
            
            const imageInfo = images.length > 0 ? `, ${images.length} images` : '';
            this.log('info', `Loaded "${title}" - ${this.formatCharCount(text.length)}${imageInfo}`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Failed to process file: ${message}`);
            this.updateStatus('Error processing file');
        }
    }

    /** @param {File} file */
    async readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(/** @type {string} */ (e.target?.result) || '');
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /** @param {File} file */
    async parseEpub(file) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded');
        }

        const zip = await JSZip.loadAsync(file);

        // Find container.xml to locate the content
        const containerXml = await zip.file('META-INF/container.xml')?.async('text');
        if (!containerXml) {
            throw new Error('Invalid EPUB: missing container.xml');
        }

        // Parse container to find content.opf path
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'text/xml');
        const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');

        if (!rootfilePath) {
            throw new Error('Invalid EPUB: cannot find content.opf');
        }

        // Parse content.opf for metadata and spine
        const opfContent = await zip.file(rootfilePath)?.async('text');
        if (!opfContent) {
            throw new Error('Invalid EPUB: cannot read content.opf');
        }

        const opfDoc = parser.parseFromString(opfContent, 'text/xml');

        // Extract metadata
        const title = opfDoc.querySelector('metadata title, dc\\:title')?.textContent || '';
        const author = opfDoc.querySelector('metadata creator, dc\\:creator')?.textContent || '';

        // Get base path for relative references
        const basePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

        // Get spine items (reading order)
        const spineItems = opfDoc.querySelectorAll('spine itemref');
        const manifest = opfDoc.querySelectorAll('manifest item');

        // Build href map and media-type map from manifest
        /** @type {Map<string, string>} */
        const hrefMap = new Map();
        /** @type {Map<string, string>} */
        const mediaTypeMap = new Map();
        manifest.forEach(item => {
            const id = item.getAttribute('id');
            const href = item.getAttribute('href');
            const mediaType = item.getAttribute('media-type');
            if (id && href) {
                hrefMap.set(id, href);
                if (mediaType) {
                    mediaTypeMap.set(href, mediaType);
                }
            }
        });

        // Extract text and track image references from each spine item
        let fullText = '';
        /** @type {string[]} */
        const chapters = [];
        /** @type {ImageAsset[]} */
        const images = [];
        /** @type {Set<string>} */
        const processedImages = new Set();
        let textChunkIndex = 0;

        for (const itemref of spineItems) {
            const idref = itemref.getAttribute('idref');
            if (!idref) continue;

            const href = hrefMap.get(idref);
            if (!href) continue;

            const filePath = basePath + href;
            const fileDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
            const content = await zip.file(filePath)?.async('text');

            if (content) {
                const doc = parser.parseFromString(content, 'text/html');
                const bodyText = doc.body?.textContent || '';

                // Try to extract chapter title
                const h1 = doc.querySelector('h1, h2');
                if (h1?.textContent) {
                    chapters.push(h1.textContent.trim());
                }

                // Extract images from this content
                const imgElements = doc.querySelectorAll('img, image');
                for (const img of imgElements) {
                    const imgSrc = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                    if (!imgSrc) continue;

                    // Resolve relative path
                    const imgPath = imgSrc.startsWith('/') ? imgSrc.substring(1) : fileDir + imgSrc;
                    const normalizedPath = this.normalizePath(imgPath);
                    
                    if (processedImages.has(normalizedPath)) continue;
                    processedImages.add(normalizedPath);

                    try {
                        const imgFile = zip.file(normalizedPath);
                        if (imgFile) {
                            const imgData = await imgFile.async('blob');
                            const mimeType = mediaTypeMap.get(imgSrc) || this.getMimeTypeFromFilename(normalizedPath);
                            const imgBlob = new Blob([imgData], { type: mimeType });
                            const imgUrl = URL.createObjectURL(imgBlob);

                            images.push({
                                id: `img-${images.length}`,
                                src: imgUrl,
                                alt: img.getAttribute('alt') || '',
                                filename: normalizedPath.split('/').pop() || 'image',
                                mimeType,
                                afterChunk: textChunkIndex
                            });
                        }
                    } catch (e) {
                        // Skip images that can't be loaded
                        this.log('warn', `Could not load image: ${normalizedPath}`);
                    }
                }

                fullText += bodyText + '\n\n';
                textChunkIndex++;
            }
        }

        return { text: fullText, title, author, chapters, images };
    }

    /**
     * Normalize a file path (resolve ../ and ./)
     * @param {string} path
     * @returns {string}
     */
    normalizePath(path) {
        const parts = path.split('/').filter(p => p && p !== '.');
        const result = [];
        for (const part of parts) {
            if (part === '..') {
                result.pop();
            } else {
                result.push(part);
            }
        }
        return result.join('/');
    }

    /**
     * Get MIME type from filename
     * @param {string} filename
     * @returns {string}
     */
    getMimeTypeFromFilename(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const mimeTypes = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp'
        };
        return mimeTypes[ext || ''] || 'image/jpeg';
    }

    /** @param {File} file */
    async parsePdf(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library not loaded');
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        const numPages = pdf.numPages;
        /** @type {ImageAsset[]} */
        const images = [];

        this.log('info', `PDF has ${numPages} pages`);

        for (let i = 1; i <= numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((/** @type {any} */ item) => item.str)
                .join(' ');
            fullText += pageText + '\n\n';

            // Extract images from this page (render page to canvas for now)
            // Note: Full PDF image extraction requires more complex operator parsing
            // For now, we'll extract page renders for pages with little text
            if (pageText.trim().length < 100) {
                try {
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (context) {
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        await page.render({ canvasContext: context, viewport }).promise;
                        
                        const blob = await new Promise((resolve) => {
                            canvas.toBlob(resolve, 'image/png');
                        });
                        
                        if (blob) {
                            images.push({
                                id: `pdf-page-${i}`,
                                src: URL.createObjectURL(blob),
                                alt: `Page ${i}`,
                                filename: `page-${i}.png`,
                                mimeType: 'image/png',
                                afterChunk: i - 1
                            });
                        }
                    }
                } catch (e) {
                    // Skip pages that can't be rendered
                }
            }

            // Update progress for large PDFs
            if (numPages > 10 && i % 10 === 0) {
                this.updateStatus(`Reading PDF... ${Math.round(i / numPages * 100)}%`);
            }
        }

        return { text: fullText, images };
    }

    /** @param {File} file */
    async parseHtml(file) {
        const html = await this.readTextFile(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script and style elements
        doc.querySelectorAll('script, style, nav, header, footer').forEach(el => el.remove());

        return doc.body?.textContent || '';
    }

    /** @param {string} text */
    cleanText(text) {
        return text
            // Normalize whitespace
            .replace(/[\t\f\v]+/g, ' ')
            // Replace multiple newlines with double newline
            .replace(/\n{3,}/g, '\n\n')
            // Remove excessive spaces
            .replace(/ {2,}/g, ' ')
            // Trim lines
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim();
    }

    displayBook() {
        if (!this.bookData) return;

        // Show book info section
        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        if (bookInfo) bookInfo.style.display = 'block';
        if (textPreviewSection) textPreviewSection.style.display = 'block';

        // Update book details
        const titleEl = document.getElementById('bookTitle');
        const authorEl = document.getElementById('bookAuthor');
        const statsEl = document.getElementById('bookStats');
        const textPreview = document.getElementById('textPreview');

        if (titleEl) titleEl.textContent = this.bookData.title;
        if (authorEl) authorEl.textContent = this.bookData.author ? `by ${this.bookData.author}` : '';

        const wordCount = this.bookData.text.split(/\s+/).filter(w => w.length > 0).length;
        const charCount = this.bookData.text.length;
        const chunkCount = Math.ceil(charCount / TTS_CHUNK_SIZE);

        if (statsEl) {
            statsEl.textContent = `${this.formatNumber(wordCount)} words | ${this.formatCharCount(charCount)} | ${chunkCount} chunks`;
        }

        // Display text preview
        if (textPreview) {
            textPreview.textContent = this.bookData.text;
        }

        // Show chapters if available
        if (this.bookData.chapters.length > 0) {
            const chapterNav = document.getElementById('chapterNav');
            const chapterList = document.getElementById('chapterList');
            if (chapterNav) chapterNav.style.display = 'block';
            if (chapterList) {
                chapterList.innerHTML = this.bookData.chapters
                    .map((ch, i) => `<div class="chapter-item">${i + 1}. ${this.escapeHtml(ch)}</div>`)
                    .join('');
            }
        }

        // Show images if available
        this.displayImages();

        // Enable convert button
        this.updateConvertButton();
    }

    displayImages() {
        const imageGallery = document.getElementById('imageGallery');
        const imageSection = document.getElementById('imageSection');
        
        if (!imageGallery || !imageSection) return;
        
        if (!this.bookData || !this.bookData.images || this.bookData.images.length === 0) {
            imageSection.style.display = 'none';
            return;
        }

        imageSection.style.display = 'block';
        const imageCountEl = document.getElementById('imageCount');
        if (imageCountEl) {
            imageCountEl.textContent = `${this.bookData.images.length} image${this.bookData.images.length !== 1 ? 's' : ''}`;
        }

        imageGallery.innerHTML = this.bookData.images.map((img, i) => `
            <div class="gallery-item" data-index="${i}">
                <img src="${img.src}" alt="${this.escapeHtml(img.alt || img.filename)}" loading="lazy" />
                <div class="gallery-caption">${this.escapeHtml(img.alt || img.filename)}</div>
            </div>
        `).join('');

        // Add click handlers for fullscreen view
        imageGallery.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.getAttribute('data-index') || '0');
                this.showImageFullscreen(index);
            });
        });
    }

    /** @param {number} index */
    showImageFullscreen(index) {
        if (!this.bookData?.images?.[index]) return;
        
        const img = this.bookData.images[index];
        const overlay = document.getElementById('imageOverlay');
        const fullImg = document.getElementById('fullscreenImage');
        const caption = document.getElementById('fullscreenCaption');
        
        if (overlay && fullImg && caption) {
            fullImg.setAttribute('src', img.src);
            caption.textContent = img.alt || img.filename;
            overlay.style.display = 'flex';
            
            // Store current index for navigation
            overlay.setAttribute('data-current', String(index));
        }
    }

    closeImageFullscreen() {
        const overlay = document.getElementById('imageOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    navigateImage(direction) {
        const overlay = document.getElementById('imageOverlay');
        if (!overlay || !this.bookData?.images) return;
        
        const current = parseInt(overlay.getAttribute('data-current') || '0');
        const newIndex = current + direction;
        
        if (newIndex >= 0 && newIndex < this.bookData.images.length) {
            this.showImageFullscreen(newIndex);
        }
    }

    updateConvertButton() {
        const convertBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('convertBtn'));
        if (convertBtn) {
            convertBtn.disabled = !this.bookData || !this.apiKey;
        }
    }

    clearBook() {
        // Revoke image URLs to free memory
        if (this.bookData?.images) {
            for (const img of this.bookData.images) {
                URL.revokeObjectURL(img.src);
            }
        }
        
        this.bookData = null;
        this.audioBlob = null;

        // Hide sections
        const bookInfo = document.getElementById('bookInfo');
        const textPreviewSection = document.getElementById('textPreviewSection');
        const chapterNav = document.getElementById('chapterNav');
        const audioSection = document.getElementById('audioSection');
        const conversionProgress = document.getElementById('conversionProgress');
        const imageSection = document.getElementById('imageSection');

        if (bookInfo) bookInfo.style.display = 'none';
        if (textPreviewSection) textPreviewSection.style.display = 'none';
        if (chapterNav) chapterNav.style.display = 'none';
        if (audioSection) audioSection.style.display = 'none';
        if (imageSection) imageSection.style.display = 'none';
        if (conversionProgress) conversionProgress.style.display = 'none';

        // Clear text preview
        const textPreview = document.getElementById('textPreview');
        if (textPreview) textPreview.textContent = '';

        // Reset audio player
        const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
        if (audioPlayer) audioPlayer.src = '';

        this.updateStatus('Upload an ebook to get started');
        this.log('info', 'Book cleared');
    }

    async convertToAudio() {
        if (!this.bookData || !this.apiKey) {
            this.updateStatus('Missing book data or API key');
            return;
        }

        if (this.isConverting) {
            return;
        }

        this.isConverting = true;
        this.abortController = new AbortController();

        // Show progress section
        const conversionProgress = document.getElementById('conversionProgress');
        const audioSection = document.getElementById('audioSection');
        if (conversionProgress) conversionProgress.style.display = 'block';
        if (audioSection) audioSection.style.display = 'none';

        // Split text into chunks
        const chunks = this.splitTextIntoChunks(this.bookData.text);
        this.log('info', `Starting conversion: ${chunks.length} chunks`);

        /** @type {ArrayBuffer[]} */
        const audioChunks = [];
        let completedChunks = 0;

        try {
            for (let i = 0; i < chunks.length; i++) {
                if (this.abortController.signal.aborted) {
                    throw new Error('Conversion cancelled');
                }

                this.updateConversionProgress(i + 1, chunks.length, 'Converting...');

                const audioData = await this.textToSpeech(chunks[i]);
                audioChunks.push(audioData);
                completedChunks++;

                this.log('info', `Chunk ${i + 1}/${chunks.length} completed`);
            }

            // Combine audio chunks
            this.updateConversionProgress(chunks.length, chunks.length, 'Combining audio...');
            this.audioBlob = await this.combineAudioChunks(audioChunks);

            // Show audio player
            if (audioSection) audioSection.style.display = 'block';
            if (conversionProgress) conversionProgress.style.display = 'none';

            const audioPlayer = /** @type {HTMLAudioElement | null} */ (document.getElementById('audioPlayer'));
            if (audioPlayer && this.audioBlob) {
                audioPlayer.src = URL.createObjectURL(this.audioBlob);
            }

            this.updateStatus('Conversion complete!');
            this.log('info', `Conversion complete - ${this.formatFileSize(this.audioBlob.size)}`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log('error', `Conversion failed: ${message}`);
            this.updateStatus('Conversion failed');

            if (conversionProgress) conversionProgress.style.display = 'none';
        } finally {
            this.isConverting = false;
            this.abortController = null;
        }
    }

    cancelConversion() {
        if (this.abortController) {
            this.abortController.abort();
            this.log('info', 'Conversion cancelled');
            this.updateStatus('Conversion cancelled');
        }
    }

    /** @param {string} text */
    splitTextIntoChunks(text) {
        /** @type {string[]} */
        const chunks = [];
        const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > TTS_CHUNK_SIZE) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                // Handle sentences longer than chunk size
                if (sentence.length > TTS_CHUNK_SIZE) {
                    const words = sentence.split(/\s+/);
                    let wordChunk = '';
                    for (const word of words) {
                        if ((wordChunk + ' ' + word).length > TTS_CHUNK_SIZE) {
                            chunks.push(wordChunk.trim());
                            wordChunk = word;
                        } else {
                            wordChunk += ' ' + word;
                        }
                    }
                    currentChunk = wordChunk;
                } else {
                    currentChunk = sentence;
                }
            } else {
                currentChunk += sentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /** @param {string} text */
    async textToSpeech(text) {
        if (!this.apiKey) {
            throw new Error('API key not configured');
        }

        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.settings.model,
                input: text,
                voice: this.settings.voice,
                speed: this.settings.speed,
                response_format: 'mp3'
            }),
            signal: this.abortController?.signal
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `API error: ${response.status}`);
        }

        return response.arrayBuffer();
    }

    /** @param {ArrayBuffer[]} chunks */
    async combineAudioChunks(chunks) {
        // Simple concatenation for MP3 chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        const combined = new Uint8Array(totalLength);

        let offset = 0;
        for (const chunk of chunks) {
            combined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }

        return new Blob([combined], { type: 'audio/mpeg' });
    }

    /**
     * @param {number} current
     * @param {number} total
     * @param {string} status
     */
    updateConversionProgress(current, total, status) {
        const statusEl = document.getElementById('conversionStatus');
        const progressFill = document.getElementById('conversionProgressFill');
        const chunksEl = document.getElementById('progressChunks');
        const timeEl = document.getElementById('progressTime');

        if (statusEl) statusEl.textContent = status;
        if (progressFill) progressFill.style.width = `${(current / total) * 100}%`;
        if (chunksEl) chunksEl.textContent = `${current} / ${total} chunks`;

        // Estimate remaining time (rough estimate: ~3 seconds per chunk)
        const remaining = (total - current) * 3;
        if (timeEl) {
            if (remaining > 0) {
                timeEl.textContent = `Estimated: ${this.formatDuration(remaining)}`;
            } else {
                timeEl.textContent = 'Almost done...';
            }
        }
    }

    downloadAudio() {
        if (!this.audioBlob || !this.bookData) {
            return;
        }

        const filename = `${this.bookData.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
        const url = URL.createObjectURL(this.audioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.log('info', `Downloaded: ${filename}`);
    }

    selectAllText() {
        const textPreview = document.getElementById('textPreview');
        if (textPreview) {
            const range = document.createRange();
            range.selectNodeContents(textPreview);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    }

    copyText() {
        const textPreview = document.getElementById('textPreview');
        if (textPreview) {
            navigator.clipboard.writeText(textPreview.textContent || '').then(() => {
                this.updateStatus('Text copied to clipboard');
            }).catch(() => {
                this.selectAllText();
                document.execCommand('copy');
                this.updateStatus('Text copied to clipboard');
            });
        }
    }

    // Logging
    /**
     * @param {'info' | 'warn' | 'error'} type
     * @param {string} message
     */
    log(type, message) {
        const logContent = document.getElementById('logContent');
        if (!logContent) return;

        const timestamp = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const line = document.createElement('div');
        line.className = `log-line log-${type === 'warn' ? 'user' : type === 'error' ? 'error' : 'claude'}`;
        line.textContent = `[${timestamp}] ${message}`;

        logContent.appendChild(line);
        logContent.scrollTop = logContent.scrollHeight;
    }

    clearLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) logContent.innerHTML = '';
    }

    /** @param {string} message */
    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = message;
    }

    // Utility methods
    /** @param {number} bytes */
    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** @param {number} chars */
    formatCharCount(chars) {
        if (chars < 1000) return `${chars} chars`;
        return `${(chars / 1000).toFixed(1)}K chars`;
    }

    /** @param {number} num */
    formatNumber(num) {
        return num.toLocaleString();
    }

    /** @param {number} seconds */
    formatDuration(seconds) {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    }

    /** @param {string} text */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    new EbookController();
});

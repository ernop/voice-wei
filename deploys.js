// @ts-check
// Deploy telemetry chart from GitHub Actions run history.

const DeployTelemetry = (function () {
    'use strict';

    const OWNER = 'ernop';
    const REPO = 'voice-wei';
    const WORKFLOW = 'deploy.yml';
    const RUN_LIMIT = 30;
    const REFRESH_MS = 60000;

    const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}`;
    const rawBase = `https://raw.githubusercontent.com/${OWNER}/${REPO}`;

    function el(id) {
        return document.getElementById(id);
    }

    function secondsBetween(start, end) {
        const started = new Date(start).getTime();
        const ended = new Date(end).getTime();
        if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return 0;
        return Math.round((ended - started) / 1000);
    }

    function formatDuration(seconds) {
        if (!seconds) return '--';
        const minutes = Math.floor(seconds / 60);
        const rest = seconds % 60;
        return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            headers: { Accept: 'application/vnd.github+json' }
        });
        if (!response.ok) {
            throw new Error(`GitHub request failed: HTTP ${response.status}`);
        }
        return response.json();
    }

    async function fetchVersionForRun(run) {
        try {
            const response = await fetch(`${rawBase}/${run.head_sha}/VERSION`, { cache: 'no-store' });
            if (!response.ok) return '';
            return (await response.text()).trim();
        } catch (_error) {
            return '';
        }
    }

    async function loadRuns() {
        const data = await fetchJson(`${apiBase}/actions/workflows/${WORKFLOW}/runs?branch=master&per_page=${RUN_LIMIT}`);
        const runs = data.workflow_runs || [];
        const rows = await Promise.all(runs.map(async run => {
            const version = await fetchVersionForRun(run);
            return {
                id: run.id,
                title: run.display_title || run.name || '',
                status: run.status,
                conclusion: run.conclusion || '',
                version,
                headSha: run.head_sha || '',
                htmlUrl: run.html_url || '',
                createdAt: run.created_at,
                startedAt: run.run_started_at || run.created_at,
                updatedAt: run.updated_at,
                durationSeconds: secondsBetween(run.run_started_at || run.created_at, run.updated_at)
            };
        }));
        return rows
            .filter(row => row.version)
            .sort((a, b) => Number(a.version) - Number(b.version));
    }

    function chartPoint(row, index, count, maxSeconds, width, height, pad) {
        const innerWidth = width - pad.left - pad.right;
        const innerHeight = height - pad.top - pad.bottom;
        const x = count <= 1 ? pad.left + innerWidth / 2 : pad.left + (innerWidth * index / (count - 1));
        const y = pad.top + innerHeight - (innerHeight * row.durationSeconds / maxSeconds);
        return { x, y };
    }

    function renderChart(rows) {
        const svg = /** @type {SVGSVGElement | null} */ (/** @type {unknown} */ (el('deployChart')));
        if (!svg) return;
        svg.textContent = '';
        const width = Math.max(720, svg.clientWidth || 720);
        const height = 320;
        const pad = { left: 52, right: 24, top: 24, bottom: 58 };
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const maxSeconds = Math.max(60, ...rows.map(row => row.durationSeconds || 0));
        const visibleRows = rows.slice(-20);
        const points = visibleRows.map((row, index) =>
            chartPoint(row, index, visibleRows.length, maxSeconds, width, height, pad));

        const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        axis.setAttribute('d', `M${pad.left} ${pad.top} V${height - pad.bottom} H${width - pad.right}`);
        axis.setAttribute('class', 'deploy-chart-axis');
        svg.appendChild(axis);

        [0, 0.25, 0.5, 0.75, 1].forEach(fraction => {
            const y = pad.top + (height - pad.top - pad.bottom) * fraction;
            const seconds = Math.round(maxSeconds * (1 - fraction));
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(pad.left));
            line.setAttribute('x2', String(width - pad.right));
            line.setAttribute('y1', String(y));
            line.setAttribute('y2', String(y));
            line.setAttribute('class', 'deploy-chart-grid');
            svg.appendChild(line);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(pad.left - 8));
            text.setAttribute('y', String(y + 4));
            text.setAttribute('class', 'deploy-chart-label');
            text.setAttribute('text-anchor', 'end');
            text.textContent = formatDuration(seconds);
            svg.appendChild(text);
        });

        const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        linePath.setAttribute('d', points.map((point, index) =>
            `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '));
        linePath.setAttribute('class', 'deploy-chart-line');
        svg.appendChild(linePath);

        visibleRows.forEach((row, index) => {
            const point = points[index];
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', String(point.x));
            dot.setAttribute('cy', String(point.y));
            dot.setAttribute('r', '5');
            dot.setAttribute('class', row.conclusion === 'success' ? 'deploy-chart-dot success' : 'deploy-chart-dot failed');
            dot.innerHTML = `<title>v${row.version}: ${formatDuration(row.durationSeconds)} (${row.conclusion || row.status})</title>`;
            svg.appendChild(dot);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', String(point.x));
            label.setAttribute('y', String(height - 28));
            label.setAttribute('class', 'deploy-chart-label');
            label.setAttribute('text-anchor', 'middle');
            label.textContent = `v${row.version}`;
            svg.appendChild(label);
        });
    }

    function renderTable(rows) {
        const body = el('deployTableBody');
        if (!body) return;
        body.innerHTML = '';
        rows.slice().reverse().forEach(row => {
            const tr = document.createElement('tr');
            tr.className = row.conclusion === 'success' ? 'deploy-row-success' : 'deploy-row-failed';
            tr.innerHTML = `
                <td>v${row.version}</td>
                <td>${formatDuration(row.durationSeconds)}</td>
                <td>${row.conclusion || row.status}</td>
                <td><a href="${row.htmlUrl}" target="_blank" rel="noopener">${row.id}</a></td>
                <td><code>${row.headSha.slice(0, 7)}</code> ${escapeHtml(row.title)}</td>
            `;
            body.appendChild(tr);
        });
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch] || ch));
    }

    function renderSummary(rows) {
        const summary = el('deploySummary');
        if (!summary) return;
        const successful = rows.filter(row => row.conclusion === 'success');
        const average = successful.length
            ? Math.round(successful.reduce((sum, row) => sum + row.durationSeconds, 0) / successful.length)
            : 0;
        const last = rows[rows.length - 1];
        summary.textContent = last
            ? `Latest: v${last.version} ${last.conclusion || last.status}, ${formatDuration(last.durationSeconds)}. Successful average: ${formatDuration(average)}.`
            : 'No deploy runs found.';
    }

    async function refresh() {
        const summary = el('deploySummary');
        if (summary) summary.textContent = 'Loading deploy telemetry...';
        try {
            const rows = await loadRuns();
            renderSummary(rows);
            renderChart(rows);
            renderTable(rows);
        } catch (error) {
            if (summary) summary.textContent = error instanceof Error ? error.message : String(error);
        }
    }

    function init() {
        el('deployRefreshBtn')?.addEventListener('click', () => void refresh());
        if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
            const summary = el('deploySummary');
            if (summary) {
                summary.textContent = 'Deploy telemetry loads on the live site; local smoke tests do not call GitHub Actions.';
            }
            return;
        }
        void refresh();
        setInterval(() => void refresh(), REFRESH_MS);
    }

    return { init, refresh };
})();

DeployTelemetry.init();

// @ts-check
// Generate deploy-telemetry.json for the live Deploys page.

const fs = require('fs');

const [owner, repo] = (process.env.GITHUB_REPOSITORY || 'ernop/voice-wei').split('/');
const workflow = process.env.DEPLOY_WORKFLOW_FILE || 'deploy.yml';
const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
const token = process.env.GITHUB_TOKEN || '';
const maxPages = Number(process.env.DEPLOY_TELEMETRY_PAGES || 5);
const perPage = 100;
const outputPath = process.env.DEPLOY_TELEMETRY_OUTPUT || 'deploy-telemetry.json';
const currentRunId = Number(process.env.GITHUB_RUN_ID || 0);

function headers() {
    return {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) {
        throw new Error(`${url} -> HTTP ${response.status}`);
    }
    return response.json();
}

async function fetchText(url) {
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) return '';
    return (await response.text()).trim();
}

function secondsBetween(start, end) {
    const started = new Date(start).getTime();
    const ended = new Date(end).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return 0;
    return Math.round((ended - started) / 1000);
}

async function listRuns() {
    const runs = [];
    for (let page = 1; page <= maxPages; page++) {
        const url = `${apiBase}/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?branch=master&per_page=${perPage}&page=${page}`;
        const data = await fetchJson(url);
        const pageRuns = data.workflow_runs || [];
        runs.push(...pageRuns);
        if (pageRuns.length < perPage) break;
    }
    return runs;
}

async function versionForRun(run) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${run.head_sha}/VERSION`;
    return fetchText(rawUrl);
}

async function main() {
    const generatedAt = new Date().toISOString();
    const runs = await listRuns();
    const telemetryRuns = await Promise.all(runs.map(async run => {
        const version = await versionForRun(run);
        const isCurrentRun = currentRunId && Number(run.id) === currentRunId;
        const startedAt = run.run_started_at || run.created_at;
        const completedAt = isCurrentRun ? generatedAt : (run.updated_at || generatedAt);
        return {
            id: run.id,
            runNumber: run.run_number,
            title: run.display_title || run.name || '',
            status: isCurrentRun ? 'completed' : run.status,
            conclusion: isCurrentRun ? 'success' : (run.conclusion || ''),
            version,
            headSha: run.head_sha || '',
            htmlUrl: run.html_url || '',
            event: run.event || '',
            createdAt: run.created_at,
            startedAt,
            completedAt,
            durationSeconds: secondsBetween(startedAt, completedAt)
        };
    }));

    const payload = {
        schemaVersion: 1,
        generatedAt,
        repository: `${owner}/${repo}`,
        workflow,
        source: 'github-actions',
        runs: telemetryRuns
            .filter(run => run.version)
            .sort((a, b) => Number(a.version) - Number(b.version))
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Wrote ${outputPath} with ${payload.runs.length} deploy runs`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});

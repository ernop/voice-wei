// @ts-check
// One command for the complete Lyrics-startup verification contract.

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function main() {
    const startedAt = Date.now();

    const startupStatus = await run(process.execPath, [
        path.join(__dirname, 'run-all.js'),
        '--suite',
        'test-player-startup.js'
    ]);
    if (startupStatus !== 0) process.exit(startupStatus);

    const statuses = await Promise.all([
        run(npm, ['run', 'typecheck']),
        run(npm, ['run', 'lint'])
    ]);
    const failedStatus = statuses.find(status => status !== 0);
    if (failedStatus !== undefined) process.exit(failedStatus);

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`Startup verification passed in ${elapsedSeconds}s`);
}

/** @param {string} command @param {string[]} args */
function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: ROOT,
            stdio: 'inherit'
        });
        child.on('close', code => resolve(code === null ? 1 : code));
        child.on('error', reject);
    });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});

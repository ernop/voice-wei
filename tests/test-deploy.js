// @ts-check
// Deploy boundary contracts: every writer to the host passes the target
// guard, the one publish filter ships exactly the product files, the build
// number is consistent, and nothing shipped reaches outside the app's own
// directory on the shared domain. No network: the live checks run in CI
// after each deploy (deploy/verify-live.sh, deploy/smoke-live.sh).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createReporter } = require('./helpers');

const ROOT = path.join(__dirname, '..');

/** @param {string} relative */
function read(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** @param {string} user @param {string} host @param {string} target */
function checkTarget(user, host, target) {
    return spawnSync('bash', [path.join(ROOT, 'deploy/check-target.sh'), user, host, target], {
        encoding: 'utf8'
    }).status;
}

/** @param {string} glob */
function globRegExp(glob) {
    const source = glob.split('*').map(part => part.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*');
    return new RegExp(`^${source}$`);
}

(async () => {
    const report = createReporter('deploy boundary');

    //-------TARGET GUARD-------
    const accepted = [
        ['voicewei', 'fuseki.net', '/srv/voice-wei/site'],
        ['voicewei', '146.190.147.109', '/srv/voice-wei/site/'],
        ['deploy', 'example.org', '/var/www/voice-wei']
    ];
    const refused = [
        ['voicewei', 'fuseki.net', ''],
        ['voicewei', 'fuseki.net', '/'],
        ['voicewei', 'fuseki.net', '/srv'],
        ['voicewei', 'fuseki.net', '/srv/fuseki/site'],
        ['voicewei', 'fuseki.net', '/home/voicewei'],
        ['voicewei', 'fuseki.net', 'srv/voice-wei/site'],
        ['voicewei', 'fuseki.net', '~/voice-wei'],
        ['voicewei', 'fuseki.net', '/srv/voice-wei/../fuseki'],
        ['voicewei', 'fuseki.net', '/srv//voice-wei'],
        ['voicewei', 'fuseki.net', '/srv/voice-wei/site /'],
        ['voicewei', 'fuseki.net', '/srv/voice-wei/site\n/'],
        ['voicewei', 'fuseki.net', '/srv/voice-wei-old/site'],
        ['', 'fuseki.net', '/srv/voice-wei/site'],
        ['root', 'fuseki.net', '/srv/voice-wei/site'],
        ['voicewei', '', '/srv/voice-wei/site'],
        ['voicewei', '-oProxyCommand=x', '/srv/voice-wei/site']
    ];
    const wronglyRefused = accepted.filter(args => checkTarget(args[0], args[1], args[2]) !== 0);
    const wronglyAccepted = refused.filter(args => checkTarget(args[0], args[1], args[2]) !== 1);
    report.check('target guard accepts absolute paths inside a voice-wei directory', wronglyRefused.length === 0);
    report.check('target guard refuses empty, root, sibling, relative, dotted, and malformed targets',
        wronglyAccepted.length === 0);
    [...wronglyRefused, ...wronglyAccepted].forEach(args => report.errors.push(`check-target.sh misjudged ${JSON.stringify(args)}`));

    //-------WRITERS-------
    // Callers never run rsync themselves; every host write goes through the
    // deploy/ scripts, and each script guards its target before any rsync.
    const callers = {
        '.github/workflows/deploy.yml': read('.github/workflows/deploy.yml'),
        '.github/workflows/deploy-telemetry.yml': read('.github/workflows/deploy-telemetry.yml'),
        'deploy.sh': read('deploy.sh')
    };
    const rsyncCommand = /(?:^\s*|\$\()(?:"\$\{publish\[@\]\}"|rsync)\s/m;
    for (const [file, text] of Object.entries(callers)) {
        const code = text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
        report.check(`${file}: reaches the host only through deploy/ scripts`, !/\brsync\s+-/.test(code));
        const secretLines = text.split('\n').filter(line => line.includes('secrets.'));
        const secretsAsData = secretLines.every(line => /^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/.test(line));
        report.check(`${file}: secrets reach scripts only through env mappings`, secretsAsData);
    }
    const scripts = fs.readdirSync(path.join(ROOT, 'deploy')).filter(name => name.endsWith('.sh')).sort()
        .map(name => ({ file: `deploy/${name}`, text: read(`deploy/${name}`) }));
    for (const { file, text } of scripts.filter(script => rsyncCommand.test(script.text))) {
        const guardAt = text.search(/(?:^\s*|"\$\(dirname "\$0"\)\/)(?:deploy\/)?check-target\.sh"? "\$(?:1|user)"/m);
        report.check(`${file}: guards its target before its first rsync`,
            guardAt !== -1 && guardAt < text.search(rsyncCommand));
        const writesBase = text.includes('$base/');
        report.check(`${file}: guards the directory beside the target before writing there`,
            !writesBase || /check-target\.sh "\$user" "\$host" "\$base"/.test(text));
    }
    const publisher = read('deploy/publish-site.sh');
    report.check('publish-site.sh publishes the committed tree (git archive HEAD), never a working tree',
        publisher.includes('git archive HEAD | tar -x -C "$work/tree"')
        && !/"\$\{publish\[@\]\}"[^\n]* \.\/ /.test(publisher)
        && [...publisher.matchAll(/^\s*"\$\{publish\[@\]\}".*$/gm)].every(line => line[0].includes('"$work/tree/"')));
    report.check('publish-site.sh publishes through the one filter file, with --delete in place',
        publisher.includes("--filter='merge deploy/rsync-filter'") && /--delete --delete-excluded/.test(publisher));
    report.check('no deploy path carries its own exclude list',
        [...Object.values(callers), ...scripts.map(script => script.text)].every(text => !text.includes('--exclude')));

    const workflow = callers['.github/workflows/deploy.yml'];
    const deployJob = workflow.slice(workflow.indexOf('\n  deploy:'), workflow.indexOf('\n  validate:'));
    report.check('Verify deployment checks the shipped commit, not only VERSION',
        /deploy\/verify-live\.sh "\$APP_URL" "\$\(tr -d '\[:space:\]' < VERSION\)" "\$GITHUB_SHA"/.test(deployJob));

    //-------PUBLISH FILTER-------
    const rules = read('deploy/rsync-filter').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    const unsupported = rules.filter(rule => !/^[-P] [A-Za-z0-9_.*-]+$/.test(rule) || rule.includes('**'));
    report.check('publish filter uses only plain exclude/protect rules this suite can evaluate', unsupported.length === 0);
    unsupported.forEach(rule => report.errors.push(`deploy/rsync-filter rule outside the evaluated subset: ${rule}`));
    const excludes = rules.filter(rule => rule.startsWith('- ')).map(rule => globRegExp(rule.slice(2)));
    const protectedNames = rules.filter(rule => rule.startsWith('P ')).map(rule => rule.slice(2));
    /** @param {string} relative */
    const isExcluded = relative => relative.split('/').some(part => excludes.some(pattern => pattern.test(part)));

    report.check('deploy-telemetry.json stays host-owned: the publish protects the host copy',
        protectedNames.includes('deploy-telemetry.json'));

    // The committed tree is the only source, yet the filter still names every
    // local artifact (credentials, private deploy key, build output), so no
    // future caller can publish one. Host-owned files are protected instead.
    const ignoredSamples = read('.gitignore').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !protectedNames.includes(line))
        .map(entry => entry.endsWith('/') ? `${entry}sample` : entry);
    const ignoredButShipped = ignoredSamples.filter(sample => !isExcluded(sample));
    report.check('every local-only (.gitignore) artifact is excluded from the publish', ignoredButShipped.length === 0);
    ignoredButShipped.forEach(sample => report.errors.push(`gitignored path is not excluded: ${sample}`));

    const listing = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
    const shipped = listing.stdout.split('\n').filter(Boolean).filter(relative => !isExcluded(relative)).sort();
    const shippedSet = new Set(shipped);
    const PRODUCT_FILE = /^(VERSION|[A-Za-z0-9_.-]+\.(html|js|css|json|jsonl|svg|php))$/;
    const nonProduct = shipped.filter(relative => !PRODUCT_FILE.test(relative));
    report.check(`publish ships only top-level product files (${shipped.length})`,
        listing.status === 0 && shipped.length > 0 && nonProduct.length === 0);
    nonProduct.forEach(relative => report.errors.push(`publish would ship a non-product file: ${relative}`));

    const pages = shipped.filter(relative => relative.endsWith('.html'));
    const missing = new Set();
    for (const page of pages) {
        for (const match of read(page).matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
            const ref = match[1];
            if (/^([a-z]+:|\/\/)/.test(ref)) continue;
            const file = ref.split(/[?#]/)[0];
            if (file && !shippedSet.has(file)) missing.add(`${page} -> ${ref}`);
        }
    }
    for (const script of shipped.filter(relative => relative.endsWith('.js'))) {
        for (const match of read(script).matchAll(/fetch(?:Json)?\(\s*[`'"]([A-Za-z0-9_.-]+\.(?:json|jsonl|php|js|css|svg|html))/g)) {
            if (!shippedSet.has(match[1]) && !protectedNames.includes(match[1])) missing.add(`${script} -> ${match[1]}`);
        }
    }
    report.check('every file a page loads or fetches is published', missing.size === 0);
    missing.forEach(entry => report.errors.push(`referenced but not published: ${entry}`));

    //-------BUILD NUMBER-------
    const version = read('VERSION').trim();
    const appVersion = (read('app-version.js').match(/current: '([0-9]+)'/) || [])[1];
    const headerFallback = (read('shared-header.js').match(/: '([0-9]+)';/) || [])[1];
    const staleCacheBusters = [];
    for (const page of fs.readdirSync(ROOT).filter(name => name.endsWith('.html'))) {
        for (const match of read(page).matchAll(/\?v=([0-9]+)/g)) {
            if (match[1] !== version) staleCacheBusters.push(`${page}: ?v=${match[1]}`);
        }
    }
    report.check(`VERSION ${version} matches app-version.js, the header fallback, and every ?v=`,
        /^[0-9]+$/.test(version) && appVersion === version && headerFallback === version
        && staleCacheBusters.length === 0);
    if (appVersion !== version) report.errors.push(`app-version.js carries ${appVersion}, VERSION is ${version}`);
    if (headerFallback !== version) report.errors.push(`shared-header.js fallback is ${headerFallback}, VERSION is ${version}`);
    staleCacheBusters.forEach(entry => report.errors.push(`stale cache buster ${entry}; run ./bump-version.sh`));

    //-------TENANT SCOPE-------
    const phpFiles = shipped.filter(relative => relative.endsWith('.php'));
    const serverConfig = shipped.filter(relative => /^(\.htaccess|\.user\.ini|web\.config|php\.ini)$/.test(path.basename(relative)));
    report.check('proxy.php is the only server-side code published, with no server config files',
        phpFiles.length === 1 && phpFiles[0] === 'proxy.php' && serverConfig.length === 0);
    const rootRelative = [];
    for (const page of pages) {
        for (const match of read(page).matchAll(/(?:src|href)\s*=\s*["'](\/[^/"'][^"']*)["']/g)) {
            rootRelative.push(`${page} -> ${match[1]}`);
        }
    }
    report.check('published pages reference only relative URLs (never the domain root)', rootRelative.length === 0);
    rootRelative.forEach(entry => report.errors.push(`root-relative reference: ${entry}`));
    const originWide = shipped
        .filter(relative => /\.(js|html|php)$/.test(relative))
        .filter(relative => /document\.cookie|setcookie\s*\(|Set-Cookie|(?:local|session)Storage\.clear\s*\(/.test(read(relative)));
    report.check('published code sets no cookies and never clears origin-wide storage', originWide.length === 0);
    originWide.forEach(relative => report.errors.push(`origin-wide state change in ${relative}`));

    report.finish();
})();

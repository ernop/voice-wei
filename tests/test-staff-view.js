// @ts-check
// Staff view renders the right staff system for the phrase's register:
// one clef when the phrase fits a single staff, a grand staff (treble +
// bass, brace-connected) when the line spans both registers.

const { BASE_URL, launch, collectErrors, createReporter } = require('./helpers');

(async () => {
    const report = createReporter('staff view');
    const browser = await launch();
    const tab = await browser.newPage();
    collectErrors(tab, 'phrases', report.errors);

    await tab.goto(`${BASE_URL}/phrases.html`, { waitUntil: 'networkidle' });
    await tab.waitForTimeout(1000);

    // Pure register decision: grand only when the phrase reaches beyond
    // A3 below AND beyond E4 above; otherwise the single-clef choice.
    const systemChecks = await tab.evaluate(() => {
        const S = NotationSpelling;
        return S.staffSystemForPhrase(55, [52, 55, 60, 67]) === 'grand'
            && S.staffSystemForPhrase(60, [60, 64, 67, 72]) === 'treble'
            && S.staffSystemForPhrase(49, [49, 60, 61, 60, 58, 49]) === 'bass'
            // Boundary: A3 (57) and E4 (64) themselves do not force grand
            && S.staffSystemForPhrase(57, [57, 60, 64]) === 'bass'
            && S.clefForNote(59) === 'bass'
            && S.clefForNote(60) === 'treble';
    });
    report.check('staff system decision (grand / treble / bass)', systemChecks);

    // Key the page to G3 with silent output, then load phrases through
    // the same typed-series path the user drives.
    await tab.evaluate(() => {
        SettingsStore.save(
            StorageKeys.PHRASES_SETTINGS,
            { root: 'G', octave: 3, hearTones: false, hearSpeech: false, singNumbers: false, showStaff: true },
            ['root', 'octave', 'hearTones', 'hearSpeech', 'singNumbers', 'showStaff']
        );
    });
    await tab.reload({ waitUntil: 'networkidle' });
    await tab.waitForTimeout(1000);

    /** @param {string} series */
    async function setSeries(series) {
        await tab.fill('#seriesInput', series);
        await tab.click('#seriesSetBtn');
        await tab.waitForTimeout(400);
        return tab.evaluate(() => {
            const svg = document.querySelector('#phraseStaff svg');
            if (!svg) return null;
            const notes = [...document.querySelectorAll('#phraseStaff svg .vf-stavenote')];
            const ys = notes.map(el => /** @type {SVGGElement} */(el).getBBox().y);
            return {
                height: Number(svg.getAttribute('height')),
                viewBoxX: Number((svg.getAttribute('viewBox') || '0 0 0 0').split(' ')[0]),
                drawn: notes.length,
                ySpread: Math.max(...ys) - Math.min(...ys),
                planLength: window.phrasesDebug.takePlan().length
            };
        });
    }

    // E3..G4 spans both registers: 11 notes -> 12 beats over two staves.
    const grand = await setSeries('1 1 1 1 1 6v 7bv 7v 2 3 8');
    report.check(`grand staff renders across both staves for register-spanning series (h=${grand && grand.height}, spread=${grand && Math.round(grand.ySpread)})`,
        Boolean(grand) && grand.height > 120 && grand.ySpread > 60);
    report.check(`grand staff keeps one sounding tickable per beat (${grand && grand.drawn} drawn)`,
        Boolean(grand) && grand.drawn === 12 && grand.planLength === 11);
    report.check('grand staff crop keeps the brace in view',
        Boolean(grand) && grand.viewBoxX >= 0);

    // A narrow low phrase keeps the single-staff rendering.
    const single = await setSeries('1 2 3 4 5');
    report.check(`single staff kept for narrow series (h=${single && single.height})`,
        Boolean(single) && single.height < 120);
    report.check(`single staff pads to whole measures (${single && single.drawn} drawn)`,
        Boolean(single) && single.drawn === 8 && single.planLength === 5);

    await browser.close();
    report.finish();
})();

// Parcours réel : tuiles refusées, coupées ou sans réponse pendant un export.
// node tools/test_tile_retry_browser.mjs <module-playwright>
//
// Un serveur saturé (le WMTS de l'IGN surtout) refuse une partie des tuiles d'un
// export, en coupe d'autres, en laisse sans réponse. Chargées une seule fois, ces
// tuiles laissaient des carrés blancs dans l'image. Elles sont désormais
// retentées (fetchExportTile, utilities.js) : l'image sort complète. Une tuile
// perdue pour de bon est signalée ; une tuile absente (404, hors couverture)
// n'est pas retentée et ne l'est pas non plus. Le serveur du parcours joue ces
// rôles ; aucune requête ne sort. Une tuile perdue à plus de 5 km des côtes
// (altitudes Terrarium simulées) est abandonnée d'office, sans question.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url);
const { chromium } = process.argv[2] ? require(path.resolve(process.argv[2])) : await import('playwright');
const server = http.createServer((req, res) => {
    try {
        const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (path.relative(root, file).startsWith('..')) { res.writeHead(403); res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CADO_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });

// Tuile PNG verte opaque de 256 px.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
};
const VERT = (() => {
    const raw = Buffer.alloc(256 * (1 + 256 * 3));
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) raw.set([32, 160, 64], y * (1 + 256 * 3) + 1 + x * 3);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();

// Rôles du serveur. Par défaut, une tuile sur deux est d'abord refusée (503),
// une sur trois ensuite coupée, une sur cinq reste d'abord sans réponse ; toutes
// finissent par venir. `perdues` : toujours refusées ; `absentes` : 404.
const essais = new Map();
let perdues = new Set(), absentes = new Set();
// `calme` : plus de refus en série, seulement `unRefus` (refusées une fois).
let calme = false, unRefus = new Set();

// Altitudes Terrarium (isOffshore) : terre (+50 m) à l'ouest de `cote.ouest` et à
// l'est de `cote.est`, mer (−60 m) entre les deux. Par défaut, la côte longe la
// zone du parcours à l'ouest : toutes ses tuiles sont « près des côtes ».
const PRES = { ouest: -4.50, est: 999 };
let cote = PRES;
const demandesAltitude = [];
function terrarium(z, x, y) {
    const raw = Buffer.alloc(256 * (1 + 256 * 3));
    for (let px = 0; px < 256; px++) {
        const lon = (x + (px + 0.5) / 256) / 2 ** z * 360 - 180;
        const v = (lon < cote.ouest || lon > cote.est ? 50 : -60) + 32768;
        for (let py = 0; py < 256; py++) raw.set([v >> 8, v & 255, 0], py * (1 + 256 * 3) + 1 + px * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const role = (key, n) => {
    if (absentes.has(key)) return 'absente';
    if (perdues.has(key)) return 'refus';
    if (calme) return unRefus.has(key) && n === 1 ? 'refus' : 'tuile';
    const [, x, y] = key.split('/').map(Number);
    if (n === 1 && (x + y) % 2 === 0) return 'refus';
    if (n <= 2 && (x + 2 * y) % 3 === 0) return 'coupure';
    if (n === 1 && (x * 3 + y) % 5 === 0) return 'silence';
    return 'tuile';
};

try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const dem = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
        if (dem) {
            demandesAltitude.push(dem.slice(1).join('/'));
            return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: terrarium(...dem.slice(1).map(Number)) });
        }
        const m = /^https:\/\/tuiles\.test\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
        if (!m) return route.abort();
        const key = m.slice(1).join('/'), n = (essais.get(key) || 0) + 1;
        essais.set(key, n);
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' };
        switch (role(key, n)) {
            case 'absente': return route.fulfill({ status: 404, headers, body: '' });
            case 'refus': return route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Service Unavailable' });
            case 'coupure': return route.abort('connectionreset');
            case 'silence': await new Promise(r => setTimeout(r, 1500)); return route.fulfill({ status: 200, headers, body: VERT }).catch(() => {});
            default: return route.fulfill({ status: 200, headers, body: VERT });
        }
    });
    await page.exposeFunction('reparerServeur', () => { perdues = new Set(); });
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('button[data-mode="zone"]').click();
    await page.waitForFunction(() => window.zoneMap && typeof generateZonePNG === 'function' && typeof fetchExportTile === 'function');
    // Source d'essai ; pauses et délai raccourcis pour le parcours.
    await page.evaluate(() => {
        MAP_LAYERS.push({ id: 'essai', kind: 'sat', name: 'Essai', maxZoom: 19, layers: [{ url: 'https://tuiles.test/{z}/{x}/{y}.png', type: 'xyz' }] });
        fondsSet({ base: 'essai', overlays: [] });
        exportTileTiming.pauses = [20, 40, 60, 80, 100];
        exportTileTiming.timeout = 600;
    });

    // Assemblage du carroyage rapide (imagetoprint.js) et fond de l'export de zone
    // (zoneDownloader.js), appelés tels que l'application les appelle. Rend le
    // bilan des tuiles et le nombre de pixels restés vides.
    const BBOX = { north: 48.41, south: 48.38, west: -4.49, east: -4.44 };
    // `reponse` : ce que l'utilisateur choisit devant des tuiles perdues
    // (askLostTiles) — 'continue', 'cancel', ou 'retry' après réparation du serveur.
    const assembler = (quoi, reponse = null) => page.evaluate(async ({ quoi, b, reponse }) => {
        const questions = [];
        askLostTiles.answer = reponse && (async (count, info) => {
            questions.push({ count, layerName: info.layerName });
            if (reponse === 'retry') { await window.reparerServeur(); return { choice: 'retry' }; }
            return { choice: reponse };
        });
        _offshoreDem.clear();   // la côte simulée change d'un scénario à l'autre
        beginExportTileStats();
        let canvas;
        try {
            if (quoi === 'rapide') {
                canvas = (await createFinalCanvasWithLayers(b, 15, fondsConfig(), () => {})).canvas;
            } else {
                const nw = zdLatLonToWorldPixels(b.north, b.west, 15), se = zdLatLonToWorldPixels(b.south, b.east, 15);
                canvas = document.createElement('canvas');
                canvas.width = Math.ceil(se.x - nw.x); canvas.height = Math.ceil(se.y - nw.y);
                await zdPaintTiles(canvas.getContext('2d'), nw, se, 15, fondsConfig(), 't=1');
            }
        } catch (e) {
            endExportTileStats();
            return { annule: e.name, questions };
        } finally {
            askLostTiles.answer = null;
        }
        const stats = endExportTileStats();
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let vides = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] === 0) vides++;
        return { stats, vides, total: canvas.width * canvas.height, questions };
    }, { quoi, b: BBOX, reponse });

    for (const quoi of ['rapide', 'zone']) {
        essais.clear();
        const r = await assembler(quoi);
        assert.equal(r.vides, 0, `${quoi} : ${r.vides} pixels vides sur ${r.total} (tuiles manquantes)`);
        assert.equal(r.stats.failed, 0, `${quoi} : ${JSON.stringify(r.stats)}`);
        assert.ok(r.stats.retried >= r.stats.requested / 2, `${quoi} : reprises ${JSON.stringify(r.stats)}`);
        assert.ok([...essais.values()].some(n => n >= 3), `${quoi} : aucune tuile retentée deux fois`);
    }

    // Tuile hors couverture (404) : pas de reprise, pas d'alerte, rien de dessiné.
    essais.clear();
    absentes = new Set(['15/15977/11336']);
    const absente = await assembler('rapide');
    assert.equal(essais.get('15/15977/11336'), 1, 'tuile absente retentée');
    assert.equal(absente.stats.failed, 0);
    assert.ok(absente.vides >= 200 * 200 && absente.vides <= 256 * 256, `tuile absente : ${absente.vides} pixels vides`);
    absentes = new Set();


    // Tuile perdue pour de bon : tous les essais, puis la question. Sans perte
    // (plus haut), aucune question n'a été posée.
    const T = '15/15977/11336';

    // Au large (côte à 16 km) : une reprise, puis abandon d'office, sans question ni alerte.
    cote = { ouest: -4.70, est: 999 }; calme = true;
    for (const quoi of ['rapide', 'zone']) {
        essais.clear(); perdues = new Set([T]);
        const large = await assembler(quoi, 'cancel');   // une question annulerait l'export
        assert.equal(large.annule, undefined, `${quoi} : tuile au large soumise à l'utilisateur`);
        assert.deepEqual(large.questions, []);
        assert.equal(essais.get(T), 2, `${quoi} : au large, un essai et une seule reprise`);
        assert.equal(large.stats.offshore, 1);
        assert.equal(large.stats.failed, 0);
    }
    assert.ok(demandesAltitude.every(k => k.startsWith('10/')), `altitudes : ${demandesAltitude}`);
    // Au large, une tuile qui ne refuse qu'une fois arrive à la reprise : rien ne manque.
    essais.clear(); perdues = new Set(); calme = true; unRefus = new Set([T]);
    const passager = await assembler('rapide', 'cancel');
    assert.equal(essais.get(T), 2);
    assert.equal(passager.vides, 0, `au large, refus passager : ${passager.vides} pixels vides`);
    assert.equal(passager.stats.offshore, 0);
    calme = false; unRefus = new Set();
    cote = PRES;
    // « Continuer sans elles » : case vide, bilan sans perte (choix de l'utilisateur).
    essais.clear(); perdues = new Set([T]);
    const continuer = await assembler('zone', 'continue');
    assert.equal(essais.get(T), 6, 'une tuile refusée a droit à six essais');
    assert.deepEqual(continuer.questions, [{ count: 1, layerName: 'Essai' }], 'près des côtes, la question est posée');
    assert.equal(continuer.stats.offshore, 0);
    assert.equal(continuer.stats.failed, 0);
    assert.equal(continuer.stats.accepted, 1);
    assert.ok(continuer.vides >= 200 * 200, `case laissée vide : ${continuer.vides} pixels`);
    // « Réessayer » une fois le serveur revenu : la tuile est là.
    essais.clear(); perdues = new Set([T]);
    const reessayer = await assembler('rapide', 'retry');
    assert.equal(reessayer.questions.length, 1);
    assert.equal(essais.get(T), 7, 'six essais, la question, puis le septième réussit');
    assert.equal(reessayer.vides, 0);
    assert.equal(reessayer.stats.failed, 0);
    // « Annuler » : l'export s'arrête.
    essais.clear(); perdues = new Set([T]);
    const annuler = await assembler('zone', 'cancel');
    assert.equal(annuler.annule, 'ExportCancelledError');

    // Export de zone complet, fenêtre réelle : elle dit combien de tuiles et de quel fond.
    await page.evaluate(() => {
        zoneMap.invalidateSize();
        zoneMap.setView([48.395, -4.465], 15, { animate: false });
        document.getElementById('zone-enable-upscale').checked = false;
        document.querySelector('input[name="zone-grid-choice"][value="none"]').checked = true;
        document.querySelector('input[name="image-format-zone"][value="png"]').checked = true;
        zoneMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle([[48.38, -4.49], [48.41, -4.44]]), layerType: 'rectangle' });
    });
    const fenetre = page.locator('.lost-tiles-dialog');
    // Annuler : aucune image, l'export le dit.
    essais.clear(); perdues = new Set([T]);
    const enCours = page.evaluate(() => generateZonePNG());
    await fenetre.waitFor({ timeout: 60000 });
    assert.match(await fenetre.locator('.lost-tiles-count').textContent(), /^1 tuile du fond « Essai » \(sur \d+\) n'a pas pu être téléchargée malgré 6 tentatives espacées\.$/);
    assert.match(await fenetre.textContent(), /en pleine mer/);
    await fenetre.locator('[data-choice="cancel"]').click();
    await enCours;
    assert.equal(await fenetre.count(), 0);
    assert.match(await page.locator('#error-message').textContent(), /Export annulé/);
    // Continuer : l'image sort, sans alerte (l'utilisateur a choisi).
    essais.clear();
    const telechargement = page.waitForEvent('download', { timeout: 60000 });
    const enCours2 = page.evaluate(() => generateZonePNG());
    await fenetre.waitFor({ timeout: 60000 });
    await fenetre.locator('[data-choice="continue"]').click();
    assert.ok(await (await telechargement).path());
    await enCours2;
    assert.equal(await page.locator('#error-message').isVisible(), false, 'alerte après « continuer »');
    perdues = new Set();

    // Sans perte, ni question ni alerte.
    essais.clear();
    const [download2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => generateZonePNG())]);
    assert.ok(await download2.path());
    assert.equal(await page.locator('#error-message').isVisible(), false, 'alerte sans tuile perdue');

    // ---- Créer MBTiles : la question dans la carte du travail ----
    await page.locator('button[data-mode="creator"]').click();
    await page.waitForFunction(() => typeof MbtilesJob === 'function' && typeof creatorMap !== 'undefined' && creatorMap && typeof window.initSqlJs === 'function');
    const travail = async () => {
        await page.evaluate(() => {
            window.showSaveFilePicker = undefined;
            const job = new MbtilesJob(window.__jobId = (window.__jobId || 900) + 1, L.latLngBounds([48.38, -4.49], [48.41, -4.44]), [15], fondsConfig(), 'essai-tuiles', false, null, 'origine', null);
            activeJobs.push(job); window.__job = job; job.start();
        });
        return page.locator('#job-' + await page.evaluate(() => window.__job.id));
    };
    const lireMbtiles = async (dl) => page.evaluate(async b64 => {
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        const n = db.exec('SELECT COUNT(*) FROM tiles')[0].values[0][0];
        db.close();
        return n;
    }, readFileSync(await dl.path()).toString('base64'));
    // Réessayer une fois le serveur revenu : le fichier est complet.
    essais.clear(); perdues = new Set([T]);
    let carte = await travail();
    await carte.locator('.job-lost-tiles').waitFor({ timeout: 60000 });
    assert.match(await carte.locator('.job-lost-text').textContent(), /^1 tuile sur 25 n'a pas pu être téléchargée/);
    assert.equal(await page.locator(`#job-status-${await page.evaluate(() => window.__job.id)}`).textContent(), 'TUILES MANQUANTES');
    perdues = new Set();
    let dl = page.waitForEvent('download', { timeout: 60000 });
    await carte.locator('[data-choice="retry"]').click();
    assert.equal(await lireMbtiles(await dl), 25);
    // Continuer sans elle : 24 tuiles, et la carte le rappelle.
    essais.clear(); perdues = new Set([T]);
    carte = await travail();
    await carte.locator('.job-lost-tiles').waitFor({ timeout: 60000 });
    dl = page.waitForEvent('download', { timeout: 60000 });
    await carte.locator('[data-choice="continue"]').click();
    assert.equal(await lireMbtiles(await dl), 24);
    assert.match(await carte.textContent(), /1 tuile laissée de côté à votre demande/);
    // Annuler : pas de fichier.
    essais.clear();
    carte = await travail();
    await carte.locator('.job-lost-tiles').waitFor({ timeout: 60000 });
    await carte.locator('[data-choice="cancel"]').click();
    assert.equal(await page.evaluate(() => window.__job.status), 'cancelled');
    perdues = new Set();

    // Au large : pas de question, le fichier sort sans elle et la carte le dit.
    essais.clear(); perdues = new Set([T]); cote = { ouest: -4.70, est: 999 }; calme = true;
    await page.evaluate(() => _offshoreDem.clear());
    dl = page.waitForEvent('download', { timeout: 60000 });
    carte = await travail();
    assert.equal(await lireMbtiles(await dl), 24);
    assert.equal(await carte.locator('.job-lost-tiles').count(), 0);
    assert.match(await carte.textContent(), /1 tuile en mer, à plus de 5 km des côtes, non servie/);
    perdues = new Set(); cote = PRES; calme = false;

    assert.deepEqual(errors, []);
    console.log('Tuiles refusées, coupées ou sans réponse : retentées ; au large, abandonnées d\'office ; près des côtes : réessayer, continuer ou annuler, en image comme en MBTiles.');
} finally {
    await browser.close();
    server.close();
}

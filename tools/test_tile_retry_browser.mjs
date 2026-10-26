// Parcours réel : tuiles refusées, coupées ou sans réponse pendant un export.
// node tools/test_tile_retry_browser.mjs <module-playwright>
//
// Un serveur saturé (le WMTS de l'IGN surtout) refuse une partie des tuiles d'un
// export, en coupe d'autres, en laisse sans réponse. Chargées une seule fois, ces
// tuiles laissaient des carrés blancs dans l'image. Elles sont désormais
// retentées (fetchExportTile, utilities.js) : l'image sort complète. Une tuile
// perdue pour de bon est signalée ; une tuile absente (404, hors couverture)
// n'est pas retentée et ne l'est pas non plus. Le serveur du parcours joue ces
// rôles ; aucune requête ne sort.
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
const role = (key, n) => {
    if (absentes.has(key)) return 'absente';
    if (perdues.has(key)) return 'refus';
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
    const assembler = (quoi) => page.evaluate(async ({ quoi, b }) => {
        beginExportTileStats();
        let canvas;
        if (quoi === 'rapide') {
            canvas = (await createFinalCanvasWithLayers(b, 15, fondsConfig(), () => {})).canvas;
        } else {
            const nw = zdLatLonToWorldPixels(b.north, b.west, 15), se = zdLatLonToWorldPixels(b.south, b.east, 15);
            canvas = document.createElement('canvas');
            canvas.width = Math.ceil(se.x - nw.x); canvas.height = Math.ceil(se.y - nw.y);
            await zdPaintTiles(canvas.getContext('2d'), nw, se, 15, fondsConfig(), 't=1');
        }
        const stats = endExportTileStats();
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let vides = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] === 0) vides++;
        return { stats, vides, total: canvas.width * canvas.height };
    }, { quoi, b: BBOX });

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

    // Tuile perdue pour de bon : tous les essais, puis le bilan la compte.
    essais.clear();
    perdues = new Set(['15/15977/11336']);
    const perdue = await assembler('zone');
    assert.equal(essais.get('15/15977/11336'), 6, 'une tuile refusée a droit à six essais');
    assert.equal(perdue.stats.failed, 1);

    // Export de zone complet : l'image sort, et l'alerte dit ce qui manque.
    await page.evaluate(() => {
        zoneMap.invalidateSize();
        zoneMap.setView([48.395, -4.465], 15, { animate: false });
        document.getElementById('zone-enable-upscale').checked = false;
        document.querySelector('input[name="zone-grid-choice"][value="none"]').checked = true;
        document.querySelector('input[name="image-format-zone"][value="png"]').checked = true;
        zoneMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle([[48.38, -4.49], [48.41, -4.44]]), layerType: 'rectangle' });
    });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => generateZonePNG())]);
    assert.ok(await download.path());
    const alerte = await page.locator('#error-message').textContent();
    assert.equal(await page.locator('#error-message').isVisible(), true, 'aucune alerte');
    assert.match(alerte, /1 tuile du fond de carte \(sur \d+\) n'a pas pu être téléchargée malgré 5 nouvelles tentatives/);
    perdues = new Set();

    // Sans perte, aucune alerte.
    essais.clear();
    const [download2] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => generateZonePNG())]);
    assert.ok(await download2.path());
    assert.equal(await page.locator('#error-message').isVisible(), false, 'alerte sans tuile perdue');

    // Créer MBTiles : le travail tient son propre bilan.
    const mbtiles = await page.evaluate(async () => {
        const stats = newExportTileStats();
        const blobs = await Promise.all(['15/15975/11334', '15/15976/11335', '15/15977/11336'].map(k => fetchExportTile(`https://tuiles.test/${k}.png`, { stats })));
        return { ok: blobs.every(b => b && b.size > 0), ...exportTileCounts(stats) };
    });
    assert.deepEqual({ ok: mbtiles.ok, failed: mbtiles.failed, requested: mbtiles.requested }, { ok: true, failed: 0, requested: 3 });

    assert.deepEqual(errors, []);
    console.log('Tuiles refusées, coupées ou sans réponse : retentées, image complète ; tuile perdue signalée.');
} finally {
    await browser.close();
    server.close();
}

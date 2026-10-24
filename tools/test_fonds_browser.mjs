// Parcours réel : fonds de carte et surcouches (fonds.js), comme dans CadoTour.
// node tools/test_fonds_browser.mjs <module-playwright>
//
// Le menu de la carte propose un fond (satellite ou plan) et des surcouches
// cumulables ; le choix vaut pour toutes les cartes et survit au rechargement ;
// l'image exportée empile le fond et les surcouches cochées, et seulement elles.
// Tuiles servies par le parcours (fond vert, surcouche : un carré rouge au milieu
// d'une tuile transparente) : aucune requête ne sort.
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

// PNG RVBA 256 × 256 dont chaque pixel vaut pixel(x, y).
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
};
function png(pixel) {
    const raw = Buffer.alloc(256 * (1 + 256 * 4));
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) raw.set(pixel(x, y), y * (1 + 256 * 4) + 1 + x * 4);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FOND = png(() => [32, 160, 64, 255]);
const ROUTES = png((x, y) => (x >= 96 && x < 160 && y >= 96 && y < 160) ? [255, 0, 0, 255] : [0, 0, 0, 0]);
const VIDE = png(() => [0, 0, 0, 0]);

try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [], demandes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' };
        if (/ORTHOIMAGERY|lyrs=s/.test(url)) { demandes.push('fond'); return route.fulfill({ status: 200, headers, body: FOND }); }
        if (/TRANSPORTNETWORKS\.ROADS/.test(url)) { demandes.push('routes IGN'); return route.fulfill({ status: 200, headers, body: ROUTES }); }
        if (/lyrs=h/.test(url)) { demandes.push(/apistyle/.test(url) ? 'routes Google' : 'routes Google POI'); return route.fulfill({ status: 200, headers, body: VIDE }); }
        if (/\.(png|jpe?g)|wmts|tiles/i.test(url)) return route.fulfill({ status: 200, headers, body: VIDE });
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.cadoMap && typeof fondsAttach === 'function');
    await page.evaluate(() => cadoMap.setView([48.39, -4.45], 15, { animate: false }));
    await page.waitForTimeout(800);

    // ---- Départ : l'ancien fond par défaut, Ortho IGN sous les routes Google ----
    const menu = page.locator('#map-viewport .map-base-control');
    assert.equal((await menu.locator('.map-base-select').textContent()).trim(), 'Ortho IGN');
    assert.equal((await page.locator('[data-fonds-label="cado"]').textContent()).trim(), 'Ortho IGN + Routes Google');
    assert.ok(demandes.includes('fond') && demandes.includes('routes Google'), `tuiles demandées : ${[...new Set(demandes)]}`);

    // ---- Menu : fond en deux familles, surcouches cumulables, groupe exclusif ----
    await page.locator('[data-fonds-label="cado"]').click();   // le rappel du panneau ouvre le menu
    await menu.locator('.map-base-panel:not(.hidden)').waitFor();
    assert.deepEqual(await menu.locator('.map-base-family h4').allTextContents(), ['Satellite', 'Cartes']);
    await menu.locator('input[data-overlay="ign_routes"]').check();
    await menu.locator('input[data-overlay="google_routes_poi"]').check();
    assert.equal(await menu.locator('input[data-overlay="google_routes"]').isChecked(), false, 'deux variantes des routes Google à la fois');
    await menu.locator('input[data-base="google_satellite"]').check();
    assert.deepEqual(await page.evaluate(() => fondsState()), { base: 'google_satellite', overlays: ['ign_routes', 'google_routes_poi'] });
    await page.keyboard.press('Escape');
    assert.equal(await menu.locator('.map-base-panel').isHidden(), true);
    assert.equal((await menu.locator('.map-base-select').textContent()).trim(), 'Google Satellite');

    // ---- Le choix vaut pour l'export de zone, et survit au rechargement ----
    await page.locator('button[data-mode="zone"]').click();
    await page.waitForFunction(() => window.zoneMap && typeof generateZonePNG === 'function');
    const zone = page.locator('#zone-interactive-map .map-base-control');
    assert.equal((await zone.locator('.map-base-select').textContent()).trim(), 'Google Satellite');
    assert.equal(await page.locator('#zone-info-layer').textContent(), 'Google Satellite + Routes IGN + Routes Google + POI');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof fondsState === 'function');
    assert.deepEqual(await page.evaluate(() => fondsState()), { base: 'google_satellite', overlays: ['ign_routes', 'google_routes_poi'] });

    // ---- Export de zone : fond et surcouches cochées, empilés ----
    await page.locator('button[data-mode="zone"]').click();
    await page.waitForFunction(() => window.zoneMap && typeof generateZonePNG === 'function');
    const exporter = async () => {
        await page.evaluate(() => {
            zoneMap.invalidateSize();
            zoneMap.setView([48.39, -4.45], 16, { animate: false });
            document.getElementById('zone-enable-upscale').checked = false;
            document.querySelector('input[name="zone-grid-choice"][value="none"]').checked = true;
            document.querySelector('input[name="image-format-zone"][value="png"]').checked = true;
            const size = zoneMap.getSize();
            const bounds = L.latLngBounds(zoneMap.containerPointToLatLng([size.x * 0.2, size.y * 0.2]), zoneMap.containerPointToLatLng([size.x * 0.8, size.y * 0.8]));
            zoneMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle(bounds), layerType: 'rectangle' });
        });
        demandes.length = 0;
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.evaluate(() => generateZonePNG())]);
        const b64 = readFileSync(await download.path()).toString('base64');
        return page.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const x = c.getContext('2d'); x.drawImage(img, 0, 0);
            const d = x.getImageData(0, 0, c.width, c.height).data;
            let vert = 0, rouge = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i] === 32 && d[i + 1] === 160 && d[i + 2] === 64) vert++;
                if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0) rouge++;
            }
            return { vert, rouge, total: c.width * c.height, file: document.getElementById('zone-info-layer').textContent };
        }, b64);
    };
    const avec = await exporter();
    assert.ok(avec.vert > avec.total * 0.3, `fond absent de l'image (${avec.vert} px verts)`);
    assert.ok(avec.rouge > avec.total * 0.02, `routes IGN absentes de l'image (${avec.rouge} px rouges)`);
    assert.ok(demandes.includes('routes Google POI'), 'routes Google + POI non téléchargées');

    // Surcouche décochée : elle ne part plus à l'export.
    await page.evaluate(() => fondsSet({ overlays: ['google_routes_poi'] }));
    const sans = await exporter();
    assert.ok(sans.vert > sans.total * 0.3);
    // Seule la pointe rouge de la rose des vents reste.
    assert.ok(sans.rouge < 50, `routes IGN décochées mais exportées (${sans.rouge} px rouges)`);
    assert.ok(!demandes.includes('routes IGN'));

    // ---- Créer MBTiles : même choix, niveaux bornés au plus bas des étages ----
    await page.evaluate(() => fondsSet({ base: 'google_satellite', overlays: ['ign_routes'] }));
    await page.locator('button[data-mode="creator"]').click();
    await page.waitForFunction(() => typeof creatorMap !== 'undefined' && creatorMap && document.querySelector('.zoom-checkbox-label'));
    assert.equal((await page.locator('[data-fonds-label="creator"]').textContent()).trim(), 'Google Satellite + Routes IGN (Max Z19)');
    assert.equal(await page.evaluate(() => Math.max(...[...document.querySelectorAll('.zoom-checkbox-label')].map(e => Number(e.dataset.zoom)))), 19);
    await page.evaluate(() => fondsSet({ overlays: [] }));
    assert.equal(await page.evaluate(() => Math.max(...[...document.querySelectorAll('.zoom-checkbox-label')].map(e => Number(e.dataset.zoom)))), 21);

    assert.deepEqual(errors, []);
    console.log('Fonds et surcouches : menu, choix partagé et retenu, export empilé.');
} finally {
    await browser.close();
    server.close();
}

// Parcours réel : repères posés hors ligne sur un fond .mbtiles (« Générer
// depuis un fichier »).
// node tools/test_file_mbtiles_base_browser.mjs [module-playwright]
// Navigateur : CADO_TEST_BROWSER (sinon Edge sous Windows).
//
// Aucune requête ne sort de la page. Hors ligne, la carte de repérage le dit et
// invite à charger un fond .mbtiles ; on charge un fond de la zone (tuiles
// vertes unies, zooms 12 à 14, écrit par node:sqlite) depuis la fenêtre même.
// On vérifie :
//   - avertissement hors ligne affiché, puis retiré une fois le fond chargé ;
//   - le fond est lu dans le fichier (tuiles vertes à l'écran), la carte s'y cadre ;
//   - il figure au sélecteur de fonds de la carte ;
//   - un repère se pose d'un clic sur ce fond, à la position cliquée ;
//   - ✕ rend les fonds en ligne, et le repère reste.
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
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
const dir = mkdtempSync(path.join(tmpdir(), 'ftm-mbtiles-'));

const BOUNDS = { w: 2.30, s: 48.88, e: 2.32, n: 48.90 }, ZOOMS = [12, 13, 14];
const tx = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const ty = (lat, z) => Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** z);

try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1500, height: 1100 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-mode="creator"]').click();

    // Hors ligne (le réseau est de toute façon coupé par la route ci-dessus).
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); });
    await page.evaluate(async () => { await ensureFileToMbtilesModule(); await openFileToMbtiles(); });
    assert.equal(await page.locator('#ftm-offline').isVisible(), true, 'avertissement hors ligne');

    // Le fond .mbtiles de la zone : une tuile PNG verte, répétée.
    const png = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const ctx = c.getContext('2d'); ctx.fillStyle = 'rgb(40,160,60)'; ctx.fillRect(0, 0, 256, 256);
        return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const file = path.join(dir, 'zone-egouts.mbtiles');
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
        CREATE UNIQUE INDEX tile_index on tiles (zoom_level, tile_column, tile_row);
        CREATE TABLE metadata (name text, value text);`);
    const add = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
    for (const z of ZOOMS) for (let x = tx(BOUNDS.w, z); x <= tx(BOUNDS.e, z); x++)
        for (let y = ty(BOUNDS.n, z); y <= ty(BOUNDS.s, z); y++) add.run(z, x, 2 ** z - 1 - y, png);
    const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    for (const kv of [['name', 'Zone égouts'], ['format', 'png'], ['minzoom', '12'], ['maxzoom', '14'], ['bounds', `${BOUNDS.w},${BOUNDS.s},${BOUNDS.e},${BOUNDS.n}`]]) meta.run(...kv);
    db.close();

    await page.locator('#ftm-mbtiles').setInputFiles(file);
    await page.waitForFunction(() => !!ftmState.mbtilesBase);
    assert.equal(await page.locator('#ftm-offline').isHidden(), true, 'avertissement retiré');
    assert.match(await page.locator('#ftm-mbtiles-name').textContent(), /Zone égouts/);
    assert.equal(await page.locator('#ftm-mbtiles-clear').isVisible(), true);
    const view = await page.evaluate(() => { const c = ftmState.map.getCenter(); return { lat: c.lat, lng: c.lng, z: ftmState.map.getZoom() }; });
    assert.ok(view.lat > BOUNDS.s && view.lat < BOUNDS.n && view.lng > BOUNDS.w && view.lng < BOUNDS.e, 'carte cadrée sur le fond');
    assert.ok(view.z >= 12, `zoom ${view.z}`);
    const labels = await page.evaluate(() => Object.values(ftmState.layerControl._layers).map(e => e.name));
    assert.ok(labels.includes('📦 Zone égouts'), 'fond au sélecteur');

    // Les tuiles du fichier sont à l'écran : centre de la carte vert.
    await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll('#ftm-map .leaflet-tile-loaded')];
        return imgs.length > 0;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const box = await page.locator('#ftm-map').boundingBox();
    const shot = await page.screenshot({ clip: { x: box.x + box.width / 2 - 2, y: box.y + box.height / 2 + 30, width: 4, height: 4 } });
    const rgb = await page.evaluate(async b64 => {
        const img = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        return [...ctx.getImageData(1, 1, 1, 1).data].slice(0, 3);
    }, shot.toString('base64'));
    assert.ok(Math.abs(rgb[0] - 40) < 8 && Math.abs(rgb[1] - 160) < 8 && Math.abs(rgb[2] - 60) < 8, `fond vert attendu, lu ${rgb}`);

    // Un plan, et un repère posé d'un clic sur le fond.
    const plan = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 400; c.height = 300;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 300); ctx.fillStyle = '#000'; ctx.fillRect(190, 140, 20, 20);
        return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.locator('#ftm-file').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: plan });
    await page.waitForFunction(() => ftmState.sheets.length === 1 && !ftmState.opening && !!ftmState.source);
    assert.ok(await page.evaluate(() => !!ftmState.mbtilesBase && ftmState.map.hasLayer(ftmState.mbtilesBase)), 'fond conservé à l\'ouverture du plan');
    await page.locator('[data-act="add-point"]').click();
    const vbox = await page.locator('#ftm-viewer').boundingBox();
    await page.mouse.click(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
    await page.waitForFunction(() => ftmState.awaiting === 'map');
    const mbox = await page.locator('#ftm-map').boundingBox();
    const target = { x: mbox.x + mbox.width / 2 + 40, y: mbox.y + mbox.height / 2 - 30 };
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(() => Number.isFinite(ftmState.points[0]?.lat));
    // Le repère est sous le pointeur (à un pixel près) : sa position sur la carte
    // est bien celle du fond cliqué.
    const at = await page.evaluate(() => {
        const p = ftmState.points[0], r = ftmState.map.getContainer().getBoundingClientRect();
        const c = ftmState.map.latLngToContainerPoint([p.lat, p.lon]);
        return { x: r.left + c.x, y: r.top + c.y };
    });
    assert.ok(Math.hypot(at.x - target.x, at.y - target.y) < 1.5, `repère à ${at.x},${at.y}, clic à ${target.x},${target.y}`);

    // ✕ : retour aux fonds en ligne, le repère reste.
    await page.locator('#ftm-mbtiles-clear').click();
    await page.waitForFunction(() => !ftmState.mbtilesBase);
    assert.equal(await page.evaluate(() => ftmState.map.hasLayer(ftmState.firstBase)), true, 'fond en ligne rétabli');
    assert.equal(await page.locator('#ftm-offline').isVisible(), true, 'toujours hors ligne : avertissement revenu');
    assert.equal(await page.evaluate(() => ftmState.points.filter(p => Number.isFinite(p.lat)).length), 1);
    assert.deepEqual(errors, []);
    console.log('OK — repères posés hors ligne sur un fond .mbtiles');
} finally {
    await browser.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
}

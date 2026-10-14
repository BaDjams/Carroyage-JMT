// Parcours réel : mosaïque JP2/J2W, polygone éditable, noir pur et MNT dans SQLite.
// node tools/test_file_import_browser.mjs <module-playwright>
import http from 'node:http';
import { readFileSync } from 'node:fs';
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
try {
    const page = await browser.newPage({ hasTouch: true, serviceWorkers: 'block', viewport: { width: 1500, height: 1100 } });
    const errors = [], uploads = [], terrainRequests = [];
    let terrainPng, terrainFailure = false, holdTerrain = false, releaseTerrain;
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() !== 'GET') uploads.push(r.url()); });
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', async route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (url.startsWith('https://elevation-tiles-prod.s3.amazonaws.com/terrarium/')) {
            terrainRequests.push(url);
            if (holdTerrain) await new Promise(resolve => { releaseTerrain = resolve; });
            return route.fulfill({ status: terrainFailure ? 503 : 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: terrainFailure ? 'Unavailable' : terrainPng });
        }
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-mode="creator"]').click();
    await page.evaluate(async () => { await ensureFileToMbtilesModule(); await openFileToMbtiles(); });
    terrainPng = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const ctx = c.getContext('2d'); ctx.fillStyle = 'rgb(128,0,0)'; ctx.fillRect(0, 0, 256, 256);
        return c.toDataURL().split(',')[1];
    }), 'base64');
    const jp2 = readFileSync(path.join(root, 'tools/fixtures/jpeg2000/rgb-nir.jp2'));
    const file = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer: typeof buffer === 'string' ? Buffer.from(buffer) : buffer });
    const inputs = [file('part-a.jp2', jp2), file('part-b.JP2', jp2), file('part-a.j2w', '1\n0\n0\n-1\n0.5\n223.5'),
        file('part-b.J2W', '1\n0\n0\n-1\n320.5\n223.5'),
        file('DIM.xml', '<Dimap_Document><PROJECTED_CRS_CODE>EPSG:3857</PROJECTED_CRS_CODE><DATA_FILE_PATH href="part-a.jp2"/><DATA_FILE_PATH href="part-b.JP2"/></Dimap_Document>')];
    await page.locator('#ftm-file').setInputFiles(inputs);
    await page.waitForFunction(() => ftmState.source?.sources?.length === 2 && !ftmState.opening);
    assert.match(await page.locator('#ftm-file-info').textContent(), /2 JP2 assemblés.*jointives/);
    assert.deepEqual(await page.evaluate(() => [ftmState.source.width, ftmState.source.height]), [640, 224]);
    const samples = () => page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 224;
        const ctx = c.getContext('2d'); await ftmState.source.render(ctx, [1, 0, 0, 1, 0, 0], 640, 224);
        return [[23, 21], [343, 21], [0, 0], [320, 0], [321, 0]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    });
    assert.deepEqual(await samples(), [[23, 21, 44, 255], [23, 21, 44, 255], [0, 0, 0, 0], [0, 0, 0, 0], [1, 0, 1, 255]]);
    await page.locator('#ftm-black').uncheck();
    await page.waitForFunction(() => !ftmState.opening);
    assert.deepEqual((await samples())[2], [0, 0, 0, 255]);
    await page.locator('#ftm-black').check();
    await page.waitForFunction(() => !ftmState.opening);
    // XML non associé, ambigu, et JP2 éloigné : rejet sans remplacer la source courante.
    await page.evaluate(async () => {
        const bytes = await (await fetch('tools/fixtures/jpeg2000/rgb-nir.jp2')).arrayBuffer();
        const image = name => new File([bytes], name);
        const world = (name, x) => new File([`1\n0\n0\n-1\n${x}\n223.5`], name);
        const xml = (name, href) => new File([`<Dimap_Document><DATA_FILE_PATH href="${href}"/><PROJECTED_CRS_CODE>EPSG:3857</PROJECTED_CRS_CODE></Dimap_Document>`], name);
        for (const files of [
            [image('a.jp2'), xml('x.xml', 'other.jp2')],
            [image('a.jp2'), xml('x.xml', 'a.jp2'), xml('y.xml', 'a.jp2')],
            [image('a.jp2'), image('b.jp2'), world('a.j2w', 0.5), world('b.j2w', 1000.5)],
        ]) {
            let rejected = false;
            try { const src = await ftmOpenJp2Mosaic(ftmGroupInputFiles(files), { excludeBlack: true }); src.retire(); }
            catch { rejected = true; }
            if (!rejected) throw new Error('Jeu de fichiers incompatible accepté');
        }
    });
    const screen = p => page.evaluate(p => {
        const v = ftmState.viewer, r = v.canvas.getBoundingClientRect();
        return [r.left + (p[0] * v.view.s + v.view.ox) / v.dpr, r.top + (p[1] * v.view.s + v.view.oy) / v.dpr];
    }, p);
    const click = async (p, options) => page.mouse.click(...await screen(p), options);
    const drag = async (a, b) => { await page.mouse.move(...await screen(a)); await page.mouse.down(); await page.mouse.move(...await screen(b), { steps: 8 }); await page.mouse.up(); };
    const poly = () => page.evaluate(() => ftmState.viewer.polys[ftmState.viewer.selectedPoly]);
    await page.locator('[data-tool="polygon"]').click();
    for (const p of [[40, 40], [200, 40], [200, 180], [40, 180]]) await click(p);
    assert.equal(await page.locator('#ftm-generate').isDisabled(), true);
    await page.locator('#ftm-finish').click();
    assert.equal((await poly()).length, 4);
    await drag([120, 40], [120, 20]); // insérer et déplacer le milieu du côté
    assert.equal((await poly()).length, 5);
    assert.ok(Math.abs((await poly())[1][1] - 20) < 0.1);
    await drag([40, 40], [50, 45]);
    assert.ok(Math.abs((await poly())[0][0] - 50) < 0.1);
    await click([120, 20], { button: 'right' });
    assert.equal((await poly()).length, 4);
    await click([50, 45], { clickCount: 2 });
    assert.equal((await poly()).length, 3);
    await click([200, 40], { button: 'right' });
    assert.equal((await poly()).length, 3); // minimum de trois sommets
    await page.locator('#ftm-undo').click(); // restituer le quatrième
    await click([100, 100]); // sélectionner à nouveau après annulation
    const before = await poly();
    await drag([130, 110], [140, 120]);
    assert.ok(Math.abs((await poly())[0][0] - before[0][0] - 10) < 0.1);
    await page.locator('#ftm-undo').click();
    await click([100, 100]);
    // Appui long tactile : suppression et arrêt du glissé.
    const touchPoint = await screen((await poly())[0]);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint[0], y: touchPoint[1] }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal((await poly()).length, 3);
    // Nouveau polygone : terminer au double-clic sans sommet doublonné.
    await page.locator('[data-tool="polygon"]').click();
    for (const p of [[300, 20], [500, 20], [500, 200]]) await click(p);
    await click([300, 200], { clickCount: 2 });
    assert.equal((await poly()).length, 4);
    if (process.env.CADO_TEST_SCREENSHOT) await page.screenshot({ path: process.env.CADO_TEST_SCREENSHOT });
    await page.locator('[data-tool="polygon"]').click(); await click([10, 10]);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => ftmState.viewer.drawing), null);
    await page.locator('[data-act="clear-zones"]').click();
    await page.locator('#ftm-mnt').check();
    await page.locator('#ftm-zmin').selectOption('16'); await page.locator('#ftm-zmax').selectOption('18');
    await page.locator('#ftm-format').selectOption('png');
    await page.evaluate(() => {
        ftmSaveBytes = async data => { window.__output = data; };
        const run = FtmJob.prototype.run;
        FtmJob.prototype.run = function () { window.__job = this; return window.__jobDone = run.call(this); };
    });
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__output || document.querySelector('.ftm-job-status')?.textContent === 'ERREUR', null, { timeout: 120000 });
    assert.equal(await page.locator('.ftm-job-status').first().textContent(), 'TERMINÉ', await page.locator('.ftm-job-message').first().textContent());
    const data = await page.evaluate(() => Array.from(window.__output));
    const SQL = await require(path.join(root, 'sql-wasm.js'))({ locateFile: f => path.join(root, f) });
    const db = new SQL.Database(new Uint8Array(data));
    const meta = Object.fromEntries(db.exec('SELECT name,value FROM metadata')[0].values);
    assert.equal(meta.mnt_storage, 'terrain_tiles'); assert.equal(meta.mnt_encoding, 'terrarium'); assert.equal(meta.mnt_zoom, undefined);
    assert.equal(meta.mnt_minzoom, '0'); assert.equal(meta.mnt_maxzoom, '12');
    const terrain = db.exec('SELECT zoom_level,tile_column,tile_row,tile_data FROM terrain_tiles')[0].values;
    assert.equal(new Set(terrain.map(t => t[0])).size, 13);
    for (const [z, x, row, bytes] of terrain) {
        assert.deepEqual(Buffer.from(bytes), terrainPng); // octets d'altitude inchangés
        assert.ok(terrainRequests.some(url => url.endsWith(`/${z}/${x}/${(1 << z) - 1 - row}.png`)));
    }
    assert.equal(db.exec('SELECT COUNT(*) FROM tiles WHERE zoom_level=18')[0].values[0][0] > 6, true);
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    db.close();
    assert.deepEqual(errors, []); assert.deepEqual(uploads, []);
    // Indisponibilité MNT : pas de téléchargement déclaré complet ni de fichier partiel.
    terrainFailure = true;
    await page.evaluate(async () => { await window.__jobDone; window.__output = null; await openFileToMbtiles(); });
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__job?.ui.querySelector('.ftm-job-status').textContent === 'ERREUR');
    assert.match(await page.locator('.ftm-job-message').first().textContent(), /MNT indisponible/);
    assert.equal(await page.evaluate(() => window.__output), null);
    await page.evaluate(async () => { await window.__jobDone; });
    terrainFailure = false; holdTerrain = true;
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__job?._fetchController != null);
    await page.locator('.ftm-job-actions button').first().click();
    await page.evaluate(async () => { await window.__jobDone; });
    releaseTerrain?.();
    assert.equal(await page.locator('.ftm-job-status').first().textContent(), 'ANNULÉ');
    assert.equal(await page.evaluate(() => window.__output), null);
    assert.equal(await page.evaluate(() => window.__job.terrainStore.dir), null);
    holdTerrain = false;
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-file').setInputFiles(path.join(root, 'tools/fixtures/jpeg2000-black/black-border.jp2'));
    await page.waitForFunction(() => ftmState.source?.width === 768 && !ftmState.opening);
    await page.locator('#ftm-mnt').uncheck();
    await page.locator('#ftm-zmin').selectOption('18'); await page.locator('#ftm-zmax').selectOption('18');
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__output);
    const blackDb = new SQL.Database(new Uint8Array(await page.evaluate(() => Array.from(window.__output))));
    assert.equal(blackDb.exec('SELECT COUNT(*) FROM tiles')[0].values[0][0], 2, 'tuile noire omise, tuile presque noire conservée');
    assert.equal(blackDb.exec('SELECT MIN(tile_column),MAX(tile_column) FROM tiles')[0].values[0][0], 131073);
    blackDb.close();
    await page.evaluate(async () => {
        await window.__jobDone; window.__output = null; await openFileToMbtiles();
        const ring = [[256, 0], [512, 0], [512, 256], [256, 256]];
        ftmState.viewer.polys = [ring, ring.slice().reverse()]; ftmRefresh();
    });
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__output || window.__job.ui.querySelector('.ftm-job-status').textContent === 'ERREUR');
    assert.equal(await page.locator('.ftm-job-status').first().textContent(), 'TERMINÉ');
    const selectionDb = new SQL.Database(new Uint8Array(await page.evaluate(() => Array.from(window.__output))));
    assert.equal(selectionDb.exec('SELECT COUNT(*) FROM tiles')[0].values[0][0], 1, 'union de polygones tracés dans les deux sens');
    selectionDb.close();
    assert.deepEqual(errors, []); assert.deepEqual(uploads, []);
    console.log({ status: 'Mosaïque, noir exact, édition souris/tactile et MNT validés', bytes: data.length, terrainTiles: terrain.length });
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

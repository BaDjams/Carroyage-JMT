// Parcours réel : image ordinaire (PNG) déformée, recalée par des points d'appui
// en mode « Déformable », puis exportée en GeoTIFF et en MBTiles.
// node tools/test_file_image_warp_browser.mjs [module-playwright]
// Navigateur : CADO_TEST_BROWSER (sinon Edge sous Windows).
//
// L'image de test est « gondolée » : sa vraie position sur la carte suit une
// affine plus une bosse au centre (≈ 20 m). Seize points d'appui sur une grille
// 4 × 4 portent chacun un carré de couleur ; un disque magenta, au centre, n'est
// PAS un point d'appui. Dans le fichier produit, chaque carré doit tomber à sa
// vraie position, et le disque aussi : la spline a redressé la bosse, ce que
// l'affine ne sait pas faire (elle le manque de plus de 25 px).
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
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1500, height: 1100 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-mode="creator"]').click();
    await page.evaluate(async () => {
        await ensureFileToMbtilesModule(); await openFileToMbtiles();
        // Fichiers produits retenus ici au lieu d'être enregistrés.
        window.ftmSaveBytes = async (data, fname) => { window.__saved = { data, fname }; };
    });

    // Image 800 × 600 et sa vraie position (affine + bosse au centre).
    const W = 800, H = 600;
    const truth = `(x, y) => {
        const bump = Math.sin(Math.PI * x / ${W}) * Math.sin(Math.PI * y / ${H});
        return [2.30 + x * 1e-5 + 1.2e-4 * bump * bump, 48.90 - y * 0.7e-5 - 1.5e-4 * bump * bump];
    }`;
    const controls = [];
    for (const x of [40, 280, 520, 760]) for (const y of [40, 220, 400, 560]) controls.push([x, y]);
    const colors = controls.map((_, i) => [40 + (i % 4) * 60, 30 + Math.floor(i / 4) * 60, 220 - i * 10]);
    const png = Buffer.from(await page.evaluate(({ W, H, controls, colors }) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = 'rgb(200,200,200)'; ctx.fillRect(0, 0, W, H);
        controls.forEach(([x, y], i) => { ctx.fillStyle = `rgb(${colors[i].join(',')})`; ctx.fillRect(x - 12, y - 12, 24, 24); });
        ctx.fillStyle = 'rgb(255,0,255)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 25, 0, Math.PI * 2); ctx.fill();
        return c.toDataURL('image/png').split(',')[1];
    }, { W, H, controls, colors }), 'base64');
    await page.locator('#ftm-file').setInputFiles([{ name: 'assemblage-ice.png', mimeType: 'image/png', buffer: png }]);
    await page.waitForFunction(() => ftmState.source?.kind === 'image' && !ftmState.opening);
    assert.match(await page.locator('#ftm-file-info').textContent(), /Image PNG — 800 × 600 px/);
    assert.equal(await page.locator('#ftm-points-step').isHidden(), false);

    // Points d'appui posés, transformation déformable.
    await page.evaluate(({ controls, truth }) => {
        const f = eval(truth);
        ftmImportPoints(controls.map(([x, y]) => { const [lon, lat] = f(x, y); return { x, y, lon, lat, enabled: true }; }));
        ftmState.$('ftm-kind').value = 'tps';
        ftmState.$('ftm-kind').dispatchEvent(new Event('change'));
    }, { controls, truth });
    await page.waitForFunction(() => ftmState.warp && !ftmState.$('ftm-generate').disabled);
    assert.match(await page.locator('#ftm-fit').textContent(), /Déformable · Pixel ≈ .* au sol en moyenne .*écart de contrôle moyen/);
    assert.equal(await page.locator('#ftm-tps-note').isHidden(), false);
    assert.equal(await page.locator('#ftm-points .ftm-res').count(), 16);
    // Aperçu redressé sur la carte, emprise courbée par la spline.
    assert.ok(await page.evaluate(() => ftmState._warpPreview?.out.canvas.width === 2048 || ftmState._warpPreview?.out.canvas.height === 2048));
    assert.ok(await page.evaluate(() => ftmState.footprint.getLayers()[0].getLatLngs()[0].length >= 96));

    // Position attendue, dans un raster Mercator d'origine (X0, Y0) et de pas res, d'un point de l'image.
    const where = ([x, y], X0, Y0, res) => page.evaluate(({ x, y, X0, Y0, res, truth }) => {
        const [X, Y] = ftmLonLatToMerc(...eval(truth)(x, y));
        return [Math.floor((X - X0) / res), Math.floor((Y0 - Y) / res)];
    }, { x, y, X0, Y0, res, truth });
    const close = (a, b, tol, msg) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${msg} : ${a} ≠ ${b}`);

    // ----- GeoTIFF sans compression, pixel du zoom 18 -----
    await page.selectOption('#ftm-output', 'geotiff');
    assert.equal(await page.locator('#ftm-generate').textContent(), 'Générer le GeoTIFF');
    assert.equal(await page.locator('#ftm-mnt-wrap').isHidden(), true);
    await page.selectOption('#ftm-zmax', '18');
    await page.selectOption('#ftm-format', 'geotiff');
    assert.match(await page.locator('#ftm-estimate').textContent(), /\d × [\d\s\u202f]+ px, pixel de [\d,]+ m au sol/);
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__saved || document.querySelector('.ftm-job-message:not([hidden])'), null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => document.querySelector('.ftm-job-message:not([hidden])')?.textContent || null), null);
    const tif = await page.evaluate(async () => {
        await loadScriptOnce('vendor/geotiff/geotiff.js');
        const { data, fname } = window.__saved; window.__saved = null;
        const image = await (await GeoTIFF.fromBlob(data)).getImage();
        const [X0, Y0] = image.getOrigin(), [res] = image.getResolution();
        const rgb = await image.readRGB({ interleave: true });
        return { fname, X0, Y0, res, w: image.getWidth(), h: image.getHeight(), epsg: image.getGeoKeys().ProjectedCSTypeGeoKey, rgb: Array.from(rgb) };
    });
    assert.equal(tif.fname, 'assemblage-ice.tif');
    assert.equal(tif.epsg, 3857);
    const tpx = ([u, v]) => tif.rgb.slice((v * tif.w + u) * 3, (v * tif.w + u) * 3 + 3);
    for (const [i, p] of controls.entries()) close(tpx(await where(p, tif.X0, tif.Y0, tif.res)), colors[i], 3, `GeoTIFF, point ${i + 1}`);
    close(tpx(await where([W / 2, H / 2], tif.X0, tif.Y0, tif.res)), [255, 0, 255], 3, 'GeoTIFF, disque central redressé');
    close(tpx(await where([W / 2 + 18, H / 2], tif.X0, tif.Y0, tif.res)), [255, 0, 255], 3, 'GeoTIFF, bord du disque central');
    close(tpx(await where([150, 130], tif.X0, tif.Y0, tif.res)), [200, 200, 200], 3, 'GeoTIFF, fond de l’image');
    close(tpx([0, 0]), [255, 255, 255], 0, 'GeoTIFF, coin hors de l’image : blanc');
    // L'affine des moindres carrés, elle, manque le disque central.
    const affineMiss = await page.evaluate(({ W, H, truth }) => {
        const T = ftmFitTransform(ftmState.points, 'affine'), [X, Y] = ftmApply(T, W / 2, H / 2);
        const [MX, MY] = ftmLonLatToMerc(...eval(truth)(W / 2, H / 2));
        return Math.hypot(X - MX, Y - MY) / ftmMercResolution(18);
    }, { W, H, truth });
    assert.ok(affineMiss > 25, `l'affine manque le disque de ${affineMiss} px`);

    // ----- GeoTIFF compressé JPEG : lisible, mêmes dimensions -----
    await page.evaluate(() => openFileToMbtiles());
    await page.selectOption('#ftm-format', 'geotiff-jpeg');
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__saved || document.querySelector('.ftm-job-message:not([hidden])'), null, { timeout: 120000 });
    const jpegTif = await page.evaluate(async () => {
        const { data } = window.__saved; window.__saved = null;
        const image = await (await GeoTIFF.fromBlob(data)).getImage();
        return { w: image.getWidth(), h: image.getHeight(), compression: image.fileDirectory.Compression ?? image.fileDirectory.getValue?.('Compression') };
    });
    assert.deepEqual([jpegTif.w, jpegTif.h, jpegTif.compression], [tif.w, tif.h, 7]);

    // ----- MBTiles PNG, zoom 18 seul -----
    await page.evaluate(() => openFileToMbtiles());
    await page.selectOption('#ftm-output', 'mbtiles');
    assert.equal(await page.locator('#ftm-zmin-wrap').isHidden(), false);
    await page.selectOption('#ftm-format', 'png');
    await page.selectOption('#ftm-zmin', '18');
    await page.selectOption('#ftm-zmax', '18');
    await page.locator('#ftm-generate').click();
    await page.waitForFunction(() => window.__saved || [...document.querySelectorAll('.ftm-job-message')].some(m => !m.hidden), null, { timeout: 120000 });
    const mb = await page.evaluate(async ({ W, H, controls, truth }) => {
        const { data, fname } = window.__saved; window.__saved = null;
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database(data);
        const meta = Object.fromEntries(db.exec('SELECT name, value FROM metadata')[0].values);
        const sample = async ([x, y]) => {
            const [X, Y] = ftmLonLatToMerc(...eval(truth)(x, y)), r = ftmMercResolution(18);
            const px = Math.floor((X + FTM_HALF) / r), py = Math.floor((FTM_HALF - Y) / r);
            const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
            const row = db.exec('SELECT tile_data FROM tiles WHERE zoom_level = 18 AND tile_column = ? AND tile_row = ?', [tx, (1 << 18) - 1 - ty]);
            const bmp = await createImageBitmap(new Blob([row[0].values[0][0]]));
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
            return [...ctx.getImageData(px - tx * 256, py - ty * 256, 1, 1).data];
        };
        const out = { fname, meta, controls: [], center: await sample([W / 2, H / 2]) };
        for (const p of controls) out.controls.push(await sample(p));
        db.close();
        return out;
    }, { W, H, controls, truth });
    assert.equal(mb.fname, 'assemblage-ice.mbtiles');
    assert.match(mb.meta.description, /recalé par 16 points d'appui \(déformable\)/);
    mb.controls.forEach((c, i) => close(c, [...colors[i], 255], 3, `MBTiles, point ${i + 1}`));
    close(mb.center, [255, 0, 255, 255], 3, 'MBTiles, disque central redressé');

    assert.deepEqual(errors, []);
    console.log('ok - image PNG, mode déformable, GeoTIFF (brut et JPEG) et MBTiles');
} finally {
    await browser.close();
    server.close();
}

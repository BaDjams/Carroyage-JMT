// Test complet du parcours navigateur et du MBTiles produit.
// Dépendance de développement seulement : playwright + navigateur Chromium.
// node tools/test_jpeg2000_browser.mjs <chemin-module-playwright> [dossier-JP2]
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = process.argv[2] ? require(path.resolve(process.argv[2])) : await import('playwright');
const folder = path.resolve(process.argv[3] || path.join(root, 'tools/fixtures/jpeg2000'));
const server = http.createServer((req, res) => {
    try {
        const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
        if (path.relative(root, file).startsWith('..')) { res.writeHead(403); res.end(); return; }
        const mime = file.endsWith('.wasm') ? 'application/wasm' : /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        res.setHeader('Content-Type', mime); res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CADO_TEST_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
try {
    const page = await browser.newPage({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    page.on('request', req => { if (req.method() !== 'GET') requests.push(req.method() + ' ' + req.url()); });
    page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => { await ensureFileToMbtilesModule(); await openFileToMbtiles(); });
    const files = readdirSync(folder).filter(n => /\.(jp2|j2w|xml)$/i.test(n)).map(n => path.join(folder, n));
    await page.locator('#ftm-file').setInputFiles(files);
    await page.waitForFunction(() => ftmState.source?.kind === 'jp2' && ftmState.viewer.base && !document.getElementById('ftm-generate').disabled, null, { timeout: 120000 });
    console.log(await page.locator('#ftm-file-info').textContent());
    assert.deepEqual(errors, []);
    const info = await page.evaluate(async () => {
        const src = ftmState.source;
        const center = ftmMercToLonLat(...src.toMerc(src.width / 2, src.height / 2));
        const point = src.toMerc(20.5, 10.5), back = src.mercToSource(...point);
        if (src.width === 320) {
            const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 224;
            await src.render(canvas.getContext('2d'), [1, 0, 0, 1, 0, 0], 320, 224);
            const px = canvas.getContext('2d').getImageData(23, 21, 1, 1).data;
            if (JSON.stringify([...px]) !== '[23,21,44,255]') throw new Error('Bandes RVB/alpha incorrectes : ' + [...px]);
        }
        const projected = ftmJp2Xml('<Dimap_Document><PROJECTED_CRS_CODE>EPSG:2154</PROJECTED_CRS_CODE><GEODETIC_CRS_CODE>EPSG:4171</GEODETIC_CRS_CODE></Dimap_Document>', src.name);
        if (projected.epsg !== 2154) throw new Error('Le CRS projeté doit être prioritaire.');
        for (const text of ['<Dimap_Document><', '<!DOCTYPE x><x/>', '<Dimap_Document><DATA_FILE_PATH href="autre.jp2"/></Dimap_Document>']) {
            let rejected = false;
            try { ftmJp2Xml(text, src.name); } catch { rejected = true; }
            if (!rejected) throw new Error('XML invalide ou décrivant une autre image accepté.');
        }
        return { center, back, epsg: src.epsg, width: src.width, height: src.height };
    });
    assert.ok(Math.abs(info.back[0] - 20.5) < 1e-5 && Math.abs(info.back[1] - 10.5) < 1e-5);
    if (info.width > 320) {
        assert.equal(info.epsg, 4326);
        assert.ok(info.center[0] < -76.2 && info.center[0] > -76.4 && info.center[1] > 2.9 && info.center[1] < 3.1);
    }
    await page.evaluate(native => {
        window.showSaveFilePicker = undefined;
        ftmSaveBytes = async data => { window.__jp2Output = data; };
        const small = ftmState.source.width === 320;
        if (native && !small) ftmState.viewer.polys = [[[1900, 1900], [2500, 1900], [2500, 2500], [1900, 2500]]];
        document.getElementById('ftm-zmin').value = small ? 16 : native ? 17 : 12;
        document.getElementById('ftm-zmax').value = small ? 18 : native ? 19 : 14;
        document.getElementById('ftm-format').value = 'png';
        ftmStartJob();
    }, process.argv.includes('--native'));
    await page.waitForFunction(() => window.__jp2Output, null, { timeout: 120000 });
    const bytes = await page.evaluate(() => Array.from(window.__jp2Output));
    const init = require(path.join(root, 'sql-wasm.js'));
    const SQL = await init({ locateFile: f => path.join(root, f) });
    const db = new SQL.Database(new Uint8Array(bytes));
    const meta = Object.fromEntries(db.exec('SELECT name,value FROM metadata')[0].values);
    const levels = db.exec('SELECT zoom_level,COUNT(*) FROM tiles GROUP BY zoom_level')[0].values;
    const tile = db.exec('SELECT tile_data FROM tiles LIMIT 1')[0].values[0][0];
    assert.equal(meta.format, 'png'); assert.ok(meta.description.includes('JP2'));
    assert.equal(levels.length, 3); assert.ok(levels.every(([, n]) => n > 0));
    assert.deepEqual([...tile.slice(0, 4)], [137, 80, 78, 71]);
    assert.equal(db.exec('PRAGMA integrity_check')[0].values[0][0], 'ok');
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log({ info, bytes: bytes.length, levels, bounds: meta.bounds, status: 'MBTiles relu, aucune image envoyée' });
    db.close();
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}

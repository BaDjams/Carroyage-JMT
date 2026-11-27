// Parcours réel : une surcouche cochée figure sur l'image exportée, même au-delà
// de son dernier niveau (paintExportLayer, utilities.js).
// node tools/test_overlay_overzoom_browser.mjs <module-playwright>
//
// Image au zoom 19 sur Google Satellite (jusqu'au 21) :
//   • Routes Yandex, annoncées jusqu'au 18 : demandées au 18, agrandies ;
//   • Routes IGN, annoncées jusqu'au 19 mais servies jusqu'au 18 seulement (404
//     au-delà) : chaque tuile absente cède la place à sa parente, agrandie.
// Carroyage Cado (createFinalCanvasWithLayers) et export de zone (zdPaintTiles).
// Le zoom automatique suit le fond, plus la surcouche. Tuiles servies par le
// parcours (fond vert, routes : un carré rouge au milieu d'une tuile
// transparente) : aucune requête ne sort.
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
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage();
    const errors = [], zooms = { fond: [], yandex: [], ign: [] };
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' };
        // Le cache-bust peut suivre le zoom sans « & » (« z=19?t=… ») : lu au chiffre près.
        const param = name => Number(new RegExp(`[?&]${name}=(\\d+)`).exec(url)?.[1]);
        if (/lyrs=s/.test(url)) { zooms.fond.push(param('z')); return route.fulfill({ status: 200, headers, body: FOND }); }
        // Les services s'arrêtent au 18 : au-delà, 404, comme en vrai.
        if (/core-renderer-tiles\.maps\.yandex/.test(url)) {
            const z = param('z'); zooms.yandex.push(z);
            return z > 18 ? route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }) : route.fulfill({ status: 200, headers, body: ROUTES });
        }
        if (/TRANSPORTNETWORKS\.ROADS/.test(url)) {
            const z = param('TileMatrix'); zooms.ign.push(z);
            return z > 18 ? route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }) : route.fulfill({ status: 200, headers, body: ROUTES });
        }
        if (/GEOGRAPHICALNAMES/.test(url)) return route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
        if (/\.(png|jpe?g)|wmts|tiles|lyrs=/i.test(url)) return route.fulfill({ status: 200, headers, body: VIDE });
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof createFinalCanvasWithLayers === 'function' && typeof zdPaintTiles === 'function' && typeof fondsConfig === 'function');

    // Pixels verts (fond) et rouges (routes) d'un canevas, et part des routes.
    const exporter = (overlays, chemin) => page.evaluate(async ({ overlays, chemin }) => {
        const cfg = fondsConfig({ base: 'google_satellite', overlays });
        const bbox = { north: 48.3915, south: 48.3885, west: -4.4535, east: -4.4485 };
        beginExportTileStats();
        let canvas;
        if (chemin === 'cado') {
            ({ canvas } = await createFinalCanvasWithLayers(bbox, 19, cfg, null));
        } else {
            const nw = zdLatLonToWorldPixels(bbox.north, bbox.west, 19), se = zdLatLonToWorldPixels(bbox.south, bbox.east, 19);
            const o = { x: Math.round(nw.x), y: Math.round(nw.y) }, f = { x: Math.round(se.x), y: Math.round(se.y) };
            canvas = document.createElement('canvas');
            canvas.width = f.x - o.x; canvas.height = f.y - o.y;
            await zdPaintTiles(canvas.getContext('2d'), o, f, 19, cfg);
        }
        const bilan = endExportTileStats();
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let vert = 0, rouge = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (d[i] === 32 && d[i + 1] === 160 && d[i + 2] === 64) vert++;
            if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) rouge++;
        }
        return { vert, rouge, total: canvas.width * canvas.height, bilan, maxZoom: cfg.maxZoom };
    }, { overlays, chemin });
    const vide = () => { for (const k in zooms) zooms[k].length = 0; };

    for (const chemin of ['cado', 'zone']) {
        // ---- Routes Yandex, dernier niveau 18 : demandées au 18, agrandies au 19 ----
        vide();
        const y = await exporter(['yandex_routes'], chemin);
        assert.equal(y.maxZoom, 21, 'le zoom de l’image suit le fond, pas la surcouche');
        assert.ok(zooms.fond.length && zooms.fond.every(z => z === 19), `${chemin} : fond demandé aux zooms ${[...new Set(zooms.fond)]}`);
        assert.ok(zooms.yandex.length && zooms.yandex.every(z => z === 18), `${chemin} : routes Yandex demandées aux zooms ${[...new Set(zooms.yandex)]}`);
        assert.ok(y.rouge > y.total * 0.02, `${chemin} : routes Yandex absentes de l'image au zoom 19 (${y.rouge} px rouges sur ${y.total})`);
        assert.ok(y.vert > y.total * 0.5, `${chemin} : fond absent (${y.vert} px verts)`);
        assert.equal(y.bilan.failed, 0);

        // ---- Routes IGN servies jusqu'au 18 seulement : parente agrandie ----
        vide();
        const ign = await exporter(['ign_routes'], chemin);
        assert.ok(zooms.ign.includes(19) && zooms.ign.includes(18), `${chemin} : routes IGN demandées aux zooms ${[...new Set(zooms.ign)]}`);
        assert.ok(!zooms.ign.some(z => z < 18), `${chemin} : repli plus bas que nécessaire`);
        assert.ok(ign.rouge > ign.total * 0.02, `${chemin} : routes IGN absentes de l'image au zoom 19 (${ign.rouge} px rouges sur ${ign.total})`);
        assert.equal(ign.bilan.failed, 0, 'une tuile absente n’est pas une tuile perdue');
        // Une parente n'est demandée qu'une fois pour ses quatre enfants.
        const parentes = zooms.ign.filter(z => z === 18).length, enfants = zooms.ign.filter(z => z === 19).length;
        assert.ok(parentes < enfants, `${parentes} demandes au 18 pour ${enfants} au 19`);
    }

    // ---- Zoom automatique : celui du fond, plus celui de la surcouche ----
    const auto = await page.evaluate(() => calculateOptimalZoom({ north: 48.3901, south: 48.3899, west: -4.4501, east: -4.4499 },
        fondsConfig({ base: 'google_satellite', overlays: ['yandex_routes'] })));
    assert.equal(auto, 21);
    // Zoom forcé au 19 avec Routes Yandex : accepté.
    assert.equal(await page.evaluate(() => checkForcedZoom(19, { north: 48.3915, south: 48.3885, west: -4.4535, east: -4.4485 },
        fondsConfig({ base: 'google_satellite', overlays: ['yandex_routes'] }), false)), 19);

    assert.deepEqual(errors, []);
    console.log('Surcouches au-delà de leur dernier niveau : agrandies sur l’image exportée (Cado et zone).');
} finally {
    await browser.close();
    server.close();
}

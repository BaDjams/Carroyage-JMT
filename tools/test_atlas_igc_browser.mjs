// Parcours réel : la couche « Carrières souterraines de Paris (atlas IGC) », type
// « arcgis-cache » (cache ArcGIS en Lambert 93, reprojeté dans le navigateur).
// node tools/test_atlas_igc_browser.mjs <module-playwright>
//
// Le cache du MapServer est simulé : chaque tuile demandée (…/tile/niveau/ligne/
// colonne) est peinte d'après les coordonnées Lambert 93 de ses pixels — une zone
// bleue, un repère rouge de 3 m en un point connu, transparent ailleurs ; une
// tuile entièrement hors de la zone répond 404. Les tuiles OSM du dessous sont
// vertes. On vérifie l'affichage, puis un MBTiles produit par « Créer MBTiles »
// aux zooms 17 et 18 : niveau du cache lu, repère retrouvé à sa place exacte en
// Web Mercator, zone bleue posée sur OSM, OSM seul hors de la zone, tuiles du
// cache absentes sans effet. Aucune requête ne sort.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url);
const { chromium } = process.argv[2] ? require(path.resolve(process.argv[2])) : await import('playwright');
const proj4 = require(path.join(root, 'vendor/proj4/proj4.js'));
const L93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
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

// ---- Cache simulé ----
const CACHE = 'https://capgeo2.paris.fr/public/rest/services/IGC/IGC_Atlas/MapServer/tile/';
const ORIGIN = [-35597500, 48953100], RES0 = 305.7480111760223;
const ZONE = [650700, 6859400, 651100, 6859800];        // place Denfert-Rochereau, Lambert 93
const MARK = [650900.3, 6859580.7];                      // repère rouge, 3 m de côté

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgba, w, h) {
    const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Tuile (niveau, ligne, colonne) du cache, ou null si elle ne touche pas la zone.
function cacheTile(level, row, col) {
    const res = RES0 / 2 ** level, X0 = ORIGIN[0] + col * 256 * res, Y0 = ORIGIN[1] - row * 256 * res;
    if (X0 > ZONE[2] || X0 + 256 * res < ZONE[0] || Y0 < ZONE[1] || Y0 - 256 * res > ZONE[3]) return null;
    const rgba = Buffer.alloc(256 * 256 * 4);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
        const X = X0 + (i + 0.5) * res, Y = Y0 - (j + 0.5) * res, k = (j * 256 + i) * 4;
        if (Math.abs(X - MARK[0]) <= 1.5 && Math.abs(Y - MARK[1]) <= 1.5) rgba.set([220, 0, 0, 255], k);
        else if (X >= ZONE[0] && X <= ZONE[2] && Y >= ZONE[1] && Y <= ZONE[3]) rgba.set([0, 0, 200, 255], k);
    }
    return png(rgba, 256, 256);
}
// Pixel « monde » Web Mercator d'un point Lambert 93 au zoom z.
function worldPixel([X, Y], z) {
    const [lon, lat] = proj4(L93, 'WGS84', [X, Y]), n = 256 * 2 ** z;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * n];
}

try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
    const errors = [], cacheRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    let osmPng = null;
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        if (/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(url) && osmPng)
            return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: osmPng });
        const m = url.startsWith(CACHE) && /tile\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
        if (m) {
            const [level, row, col] = m.slice(1).map(Number);
            cacheRequests.push(level);
            const body = cacheTile(level, row, col);
            return body
                ? route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': base, 'Content-Type': 'image/png' }, body })
                : route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': base }, body: '' });
        }
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-mode="creator"]').click();
    await page.waitForFunction(() => typeof MbtilesJob === 'function' && typeof agcDrawTile === 'function' && typeof creatorMap !== 'undefined' && creatorMap);
    const green = [32, 160, 64];
    osmPng = (() => { const b = Buffer.alloc(256 * 256 * 4); for (let k = 0; k < b.length; k += 4) b.set([...green, 255], k); return png(b, 256, 256); })();

    // ---- Catalogue ----
    const cfg = await page.evaluate(() => MAP_LAYERS.find(l => l.id === 'igc_carrieres'));
    assert.equal(cfg.name, 'Carrières souterraines de Paris (atlas IGC)');
    assert.deepEqual(cfg.layers.map(l => l.type), ['xyz', 'arcgis-cache']);
    assert.match(cfg.attribution, /IGC/);

    // ---- Affichage : la carte du créateur lit le cache, niveau 9 au zoom 17 ----
    const [lon, lat] = proj4(L93, 'WGS84', MARK);
    await page.evaluate(([lat, lon]) => {
        const s = document.getElementById('creator-layer-select');
        s.value = 'igc_carrieres'; s.dispatchEvent(new Event('change'));
        creatorMap.setView([lat, lon], 17, { animate: false });
    }, [lat, lon]);
    await page.waitForFunction(() => document.querySelectorAll('#creator-interactive-map canvas.leaflet-tile-loaded').length >= 4, null, { timeout: 30000 });
    // (Niveau 0 aussi : la vue de départ, toute la France, avant le recentrage.)
    assert.ok(cacheRequests.includes(9) && cacheRequests.every(l => l === 9 || l === 0), `niveaux lus : ${[...new Set(cacheRequests)]}`);

    // ---- Créer MBTiles : zooms 17 et 18, PNG ----
    cacheRequests.length = 0;
    const [w, s] = proj4(L93, 'WGS84', [ZONE[0] - 60, ZONE[1] - 60]), [e, n] = proj4(L93, 'WGS84', [ZONE[2] + 60, ZONE[3] + 60]);
    await page.evaluate(([s, w, n, e]) => {
        document.getElementById('creator-tile-format').value = 'png';
        document.querySelectorAll('.zoom-checkbox-label').forEach(el => el.classList.toggle('checked', ['17', '18'].includes(el.dataset.zoom)));
        creatorMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle([[s, w], [n, e]]), layerType: 'rectangle' });
        window.showSaveFilePicker = undefined;
    }, [s, w, n, e]);
    const download = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#creator-start-btn').click();
    const file = await (await download).path();
    assert.deepEqual([...new Set(cacheRequests)].sort(), [10, 9]);

    // Pour chaque zoom : la tuile du repère, celle d'un point de la zone, celle d'un point hors zone.
    const probes = [];
    for (const z of [17, 18]) {
        for (const [kind, pt] of [['repère', MARK], ['zone', [ZONE[0] + 40, ZONE[3] - 40]], ['hors zone', [ZONE[0] - 30, ZONE[1] - 30]]]) {
            const [px, py] = worldPixel(pt, z);
            probes.push({ z, kind, x: Math.floor(px / 256), y: Math.floor(py / 256), u: px % 256, v: py % 256 });
        }
    }
    const found = await page.evaluate(async ([b64, probes]) => {
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        const meta = Object.fromEntries(db.exec('SELECT name, value FROM metadata')[0].values);
        const out = [];
        for (const p of probes) {
            const r = db.exec('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?', [p.z, p.x, (1 << p.z) - 1 - p.y]);
            if (!r.length) { out.push({ ...p, missing: true }); continue; }
            const bmp = await createImageBitmap(new Blob([r[0].values[0][0]]));
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
            const data = ctx.getImageData(0, 0, 256, 256).data;
            let sx = 0, sy = 0, cnt = 0;
            for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
                const k = (j * 256 + i) * 4;
                if (data[k] > 150 && data[k + 1] < 90 && data[k + 2] < 90) { sx += i + 0.5; sy += j + 0.5; cnt++; }
            }
            const k = (Math.floor(p.v) * 256 + Math.floor(p.u)) * 4;
            out.push({ ...p, pixel: Array.from(data.slice(k, k + 4)), red: cnt ? [sx / cnt, sy / cnt, cnt] : null });
        }
        db.close();
        return { meta, out };
    }, [readFileSync(file).toString('base64'), probes]);
    assert.equal(found.meta.format, 'png');
    for (const p of found.out) {
        assert.ok(!p.missing, `z${p.z} ${p.kind} : tuile absente`);
        if (p.kind === 'repère') {
            assert.ok(p.red, `z${p.z} : repère introuvable`);
            const gap = Math.hypot(p.red[0] - p.u, p.red[1] - p.v);
            assert.ok(gap < 0.75, `z${p.z} : repère à ${gap.toFixed(2)} px de sa place`);
            console.log(`z${p.z} : repère retrouvé à ${gap.toFixed(2)} px de sa place exacte (${p.red[2]} px rouges)`);
        } else if (p.kind === 'zone') assert.deepEqual(p.pixel, [0, 0, 200, 255], `z${p.z} zone`);
        else assert.deepEqual(p.pixel, [...green, 255], `z${p.z} hors zone`);
    }

    // ---- Impression et export de zone : même repère, même place ----
    // createFinalCanvasWithLayers (imagetoprint.js) et zdPaintTiles (zoneDownloader.js),
    // appelés tels que l'application les appelle ; origine fractionnaire pour la zone.
    const [mx, my] = worldPixel(MARK, 18);
    const exports = await page.evaluate(async ([s, w, n, e, mx, my]) => {
        const cfg = MAP_LAYERS.find(l => l.id === 'igc_carrieres');
        const redCentroid = canvas => {
            const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let sx = 0, sy = 0, cnt = 0;
            for (let j = 0; j < canvas.height; j++) for (let i = 0; i < canvas.width; i++) {
                const k = (j * canvas.width + i) * 4;
                if (d[k] > 150 && d[k + 1] < 90 && d[k + 2] < 90) { sx += i + 0.5; sy += j + 0.5; cnt++; }
            }
            return cnt ? [sx / cnt, sy / cnt] : null;
        };
        const print = await createFinalCanvasWithLayers({ north: n, south: s, west: w, east: e }, 18, cfg, () => {});
        const nw = { x: mx - 300.4, y: my - 200.7 }, se = { x: mx + 250.2, y: my + 180.9 };
        const patch = document.createElement('canvas');
        patch.width = Math.ceil(se.x - nw.x); patch.height = Math.ceil(se.y - nw.y);
        await zdPaintTiles(patch.getContext('2d'), nw, se, 18, cfg, 't=1');
        return {
            print: { red: redCentroid(print.canvas), at: [mx - print.originX, my - print.originY] },
            zone: { red: redCentroid(patch) },
            nw,
        };
    }, [s, w, n, e, mx, my]);
    assert.ok(exports.print.red, 'impression : repère introuvable');
    const gapPrint = Math.hypot(exports.print.red[0] - exports.print.at[0], exports.print.red[1] - exports.print.at[1]);
    assert.ok(gapPrint < 0.75, `impression : repère à ${gapPrint.toFixed(2)} px`);
    // Export de zone : chaque tuile est posée à floor(x·256 − nw.x), comme les autres couches.
    assert.ok(exports.zone.red, 'export de zone : repère introuvable');
    const zx = mx - exports.nw.x, zy = my - exports.nw.y;
    const gapZone = Math.hypot(exports.zone.red[0] - zx, exports.zone.red[1] - zy);
    assert.ok(gapZone < 1.25, `export de zone : repère à ${gapZone.toFixed(2)} px`);
    console.log(`impression : repère à ${gapPrint.toFixed(2)} px ; export de zone : ${gapZone.toFixed(2)} px (tuiles posées au pixel entier)`);

    assert.deepEqual(errors, []);
    console.log('Atlas IGC : cache Lambert 93 lu aux niveaux 9 et 10, reprojeté à sa place, posé sur OSM.');
} finally {
    await browser.close();
    server.close();
}

// Parcours réel : un MBTiles écrit comme MOBAC 2.4 (Mobile Atlas Creator) — tuiles
// de 512 px, zooms sautés (10 et 13 seulement, minzoom/maxzoom annoncent 10 à 13).
// node tools/test_mbtiles_mobac_browser.mjs <module-playwright>
//
// Vérifie que l'impression (createFinalCanvasWithLayers) et l'export de zone
// (zdPaintTiles) posent chaque tuile de 512 px à sa place, sur 256 px, au lieu de
// la laisser déborder sur ses voisines ; que les niveaux absents sont écartés ; et
// que la carte affiche le niveau inférieur, agrandi, à un zoom absent du fichier.
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url);
const { chromium } = process.argv[2] ? require(path.resolve(process.argv[2])) : await import('playwright');

// PNG de `size` px, moitié gauche noire, moitié droite de couleur [r, g, b] —
// sans dépendance. Une tuile unie ne montrerait pas le défaut : posée à 512 px,
// chacune déborde sur ses voisines, mais la suivante recouvre le débordement.
function pngDemi(size, [r, g, b]) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = buf => { let c = 0xFFFFFFFF; for (const x of buf) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const chunk = (type, data) => {
        const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
        len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data])));
        return Buffer.concat([len, t, data, sum]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, (_, x) => x < size / 2 ? [0, 0, 0] : [r, g, b]).flat())]);
    const raw = Buffer.concat(Array.from({ length: size }, () => row));
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Atlas MOBAC : 2 × 2 tuiles de couleurs différentes au zoom 10, une au zoom 13.
const COULEURS = { '520/368': [255, 0, 0], '521/368': [0, 255, 0], '520/369': [0, 0, 255], '521/369': [255, 255, 0] };
const dossier = mkdtempSync(path.join(tmpdir(), 'mobac-'));
const fichier = path.join(dossier, 'atlas-mobac.mbtiles');
{
    const db = new DatabaseSync(fichier);
    db.exec(`CREATE TABLE IF NOT EXISTS tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
        CREATE UNIQUE INDEX IF NOT EXISTS tiles_idx on tiles (zoom_level, tile_column, tile_row);
        CREATE TABLE IF NOT EXISTS metadata (name text, value text);
        CREATE UNIQUE INDEX IF NOT EXISTS metadata_idx  ON metadata (name);`);
    const tuile = db.prepare('INSERT or REPLACE INTO tiles (tile_column,tile_row,zoom_level,tile_data) VALUES (?,?,?,?)');
    for (const [cle, couleur] of Object.entries(COULEURS)) {
        const [x, y] = cle.split('/').map(Number);
        tuile.run(x, 1023 - y, 10, pngDemi(512, couleur));
    }
    tuile.run(4170, 8191 - 2950, 13, pngDemi(512, [128, 128, 128]));
    const meta = db.prepare('INSERT INTO metadata (name,value) VALUES (?,?);');
    for (const [k, v] of [['name', 'Atlas MOBAC'], ['format', 'png'], ['bounds', '3.252,51.536,3.296,51.563'],
        ['maxzoom', '13'], ['minzoom', '10'], ['type', 'baselayer'], ['version', '1.3']]) meta.run(k, v);
    db.close();
}

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
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#cado-mbtiles-input').setInputFiles(fichier);
    await page.waitForFunction(() => window.tileSourceIsActive?.() && window.tileSourceGetZooms().length > 0, null, { timeout: 30000 });

    // Niveaux réellement présents : 11 et 12 sont écartés, et une impression ou un
    // export demandé au zoom 12 se fait au zoom 10.
    assert.deepEqual(await page.evaluate(() => tileSourceGetZooms()), [10, 13]);
    assert.equal(await page.evaluate(() => tileSourceGetBestZoom(12)), 10);

    // Couleur aux trois quarts de la largeur de chacune des 4 tuiles du zoom 10
    // (256 px chacune) : dans sa moitié droite si la tuile de 512 px est ramenée à
    // 256, dans sa moitié gauche, noire, si elle est posée à sa taille.
    const centres = canvasExpr => page.evaluate(async expr => {
        const c = await (0, eval)(expr);
        const ctx = c.getContext('2d');
        const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
        return { taille: [c.width, c.height], '520/368': at(192, 128), '521/368': at(448, 128), '520/369': at(192, 384), '521/369': at(448, 384) };
    }, canvasExpr);
    const attendu = { taille: [512, 512], ...COULEURS };

    // Export de zone par bandes (zoneDownloader.js).
    assert.deepEqual(await centres(`(async () => {
        const c = document.createElement('canvas'); c.width = c.height = 512;
        await zdPaintTiles(c.getContext('2d'), { x: 520 * 256, y: 368 * 256 }, { x: 522 * 256 - 1, y: 370 * 256 - 1 }, 10, null);
        return c;
    })()`), attendu);

    // Impression (imagetoprint.js) : emprise exacte des 4 tuiles.
    assert.deepEqual(await centres(`(async () => {
        const lon = x => x / 1024 * 360 - 180;
        const lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 1024))) * 180 / Math.PI;
        const r = await createFinalCanvasWithLayers({ north: lat(368), south: lat(370), west: lon(520), east: lon(522) }, 10, null, null);
        return r.canvas;
    })()`), attendu);

    // Carte : au zoom 12, absent du fichier, la couche MBTiles demande le zoom 10.
    const niveaux = await page.evaluate(() => {
        const couche = Object.values(window.cadoMap?._layers || {}).find(l => typeof l._clampZoom === 'function' && l.options?.maxNativeZoom === 13);
        return couche ? [11, 12, 13, 15].map(z => couche._clampZoom(z)) : null;
    });
    assert.deepEqual(niveaux, [10, 10, 13, 13]);

    assert.deepEqual(errors, []);
    console.log('MBTiles MOBAC (512 px, zooms sautés) : impression, export de zone et carte corrects.');
} finally {
    await browser.close();
    server.close();
    rmSync(dossier, { recursive: true, force: true });
}

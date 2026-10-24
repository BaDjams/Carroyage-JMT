// Parcours réel : « Créer MBTiles » le long d'une trace GPX, et dans un polygone.
// node tools/test_mbtiles_zone_browser.mjs <module-playwright>
//
// La trace chargée donne un couloir de la largeur choisie ; le compte affiché et
// le fichier produit ne portent que les tuiles qu'il recoupe — moins que le
// rectangle qui l'englobe —, et changer la largeur refait la zone. Un KMZ
// exporté par CadoTour (flèches, traces) se lit de même ; un polygone tracé aussi. Tuiles servies par le parcours : aucune requête ne sort.
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

// Trace en coude au nord de Brest, deux segments de trace.
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="essai"><trk><name>Côte</name>
<trkseg><trkpt lat="48.380" lon="-4.500"/><trkpt lat="48.400" lon="-4.420"/></trkseg>
<trkseg><trkpt lat="48.400" lon="-4.420"/><trkpt lat="48.460" lon="-4.400"/></trkseg>
</trk></gpx>`;

try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1500, height: 1100 }, acceptDownloads: true });
    const errors = [], tuilesDemandees = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    let png = null;
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const m = /^https:\/\/tuiles\.test\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
        if (m && png) { tuilesDemandees.push(m.slice(1).join('/')); return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' }, body: png }); }
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('button[data-mode="creator"]').click();
    await page.waitForFunction(() => typeof MbtilesJob === 'function' && typeof ftmTilesForZone === 'function' && creatorMap);
    png = Buffer.from(await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d'); x.fillStyle = '#4a7'; x.fillRect(0, 0, 256, 256);
        return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    // Source de tuiles du parcours ; zoom 15 seul, format d'origine.
    await page.evaluate(() => {
        MAP_LAYERS.push({ id: 'essai', name: 'Essai', maxZoom: 19, layers: [{ url: 'https://tuiles.test/{z}/{x}/{y}.png', type: 'xyz' }] });
        fondsSet({ base: 'essai', overlays: [] });
        document.getElementById('creator-tile-format').value = 'origine';
        document.querySelectorAll('.zoom-checkbox-label').forEach(el => el.classList.toggle('checked', el.dataset.zoom === '15'));
    });
    const totalAffiche = () => page.evaluate(() => Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')));

    // ---- Trace GPX, couloir de 500 m ----
    await page.locator('#creator-track-file').setInputFiles({ name: 'cote.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(GPX) });
    await page.waitForFunction(() => /cote\.gpx/.test(document.getElementById('creator-track-info').textContent));
    assert.match(await page.locator('#creator-track-info').textContent(), /2 trace\(s\), 500 m de part et d'autre/);
    const zone500 = await page.evaluate(() => ({
        tuiles: ftmTilesForZone(currentCreatorZone.polys, 15).map(t => `15/${t.x}/${t.y}`).sort(),
        rectangle: (r => (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1))(getTileRange(currentCreatorBounds, 15)),
    }));
    assert.equal(await totalAffiche(), zone500.tuiles.length);
    assert.ok(zone500.tuiles.length > 20 && zone500.tuiles.length < zone500.rectangle * 0.7,
        `couloir ${zone500.tuiles.length} tuiles, rectangle englobant ${zone500.rectangle}`);

    // Couloir élargi : la zone est refaite, plus grande.
    await page.locator('#creator-track-width').fill('1500');
    await page.waitForFunction(n => Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')) > n, zone500.tuiles.length);
    await page.locator('#creator-track-width').fill('500');
    await page.waitForFunction(n => Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')) === n, zone500.tuiles.length);

    // ---- Téléchargement : exactement les tuiles du couloir ----
    // Fini, le travail enregistre le fichier de lui-même (lien de téléchargement,
    // sans le sélecteur de fichiers natif).
    await page.evaluate(() => { window.showSaveFilePicker = undefined; });
    const telechargement = page.waitForEvent('download', { timeout: 120000 });
    await page.locator('#creator-start-btn').click();
    const fichier = await (await telechargement).path();
    // Niveau 15 seul : la carte affiche aussi la source d'essai, à son propre zoom.
    assert.deepEqual([...new Set(tuilesDemandees)].filter(t => t.startsWith('15/')).sort(), zone500.tuiles);
    const contenu = await page.evaluate(async b64 => {
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        const tuiles = db.exec('SELECT zoom_level, tile_column, tile_row FROM tiles')[0].values.map(([z, x, y]) => `${z}/${x}/${(1 << z) - 1 - y}`).sort();
        const meta = Object.fromEntries(db.exec('SELECT name, value FROM metadata')[0].values);
        db.close();
        return { tuiles, meta };
    }, readFileSync(fichier).toString('base64'));
    assert.deepEqual(contenu.tuiles, zone500.tuiles);
    assert.equal(contenu.meta.minzoom, '15');
    const [o, s, e, n] = contenu.meta.bounds.split(',').map(Number);
    assert.ok(o < -4.5 && e > -4.4 && s < 48.38 && n > 48.46, contenu.meta.bounds);

    // ---- KMZ exporté par CadoTour : flèches, polyligne, trace enregistrée, itinéraire ----
    await page.locator('#creator-track-file').setInputFiles(path.join(root, 'tools/fixtures/cadotour/traces-cadotour.kmz'));
    await page.waitForFunction(() => /traces-cadotour\.kmz/.test(document.getElementById('creator-track-info').textContent));
    // Cinq traits, et aucune surface : les trois pointes de flèche ont rejoint leur trait.
    assert.equal(await page.locator('#creator-track-info').textContent(), "traces-cadotour.kmz : 5 trace(s), 500 m de part et d'autre");
    const kmz = await page.evaluate(() => {
        // Le sommet de la flèche « Axe nord » (-4.44, 48.40) est dans la zone,
        // au-delà de son trait exporté, qui s'arrête à la base de la pointe.
        const n = 2 ** 15, x = Math.floor((-4.44 + 180) / 360 * n);
        const y = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + 48.40 * Math.PI / 360)) / Math.PI) / 2 * n);
        return { sommet: creatorZoneTiles(currentCreatorZone, 15).some(t => t.x === x && t.y === y),
            affiche: Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')),
            attendu: creatorZoneTiles(currentCreatorZone, 15).length };
    });
    assert.equal(kmz.sommet, true);
    assert.equal(kmz.affiche, kmz.attendu);

    // ---- Polygone tracé : la trace s'efface, la zone est le polygone ----
    const poly = await page.evaluate(() => {
        const ring = [[48.39, -4.49], [48.43, -4.47], [48.41, -4.43]];
        creatorMap.fire(L.Draw.Event.CREATED, { layer: L.polygon(ring), layerType: 'polygon' });
        const merc = [ring.map(([la, lo]) => ftmLonLatToMerc(lo, la))];
        return {
            info: document.getElementById('creator-track-info').textContent,
            attendu: ftmTilesForZone(merc, 15).length,
            rectangle: (r => (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1))(getTileRange(currentCreatorBounds, 15)),
            affiche: Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')),
        };
    });
    assert.equal(poly.info, '');
    assert.equal(poly.affiche, poly.attendu);
    assert.ok(poly.attendu < poly.rectangle, JSON.stringify(poly));
    // Un rectangle redevient un rectangle entier.
    const rect = await page.evaluate(() => {
        creatorMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle([[48.39, -4.49], [48.41, -4.46]]), layerType: 'rectangle' });
        return { zone: currentCreatorZone, affiche: Number(document.getElementById('creator-total-tiles').textContent.replace(/\D/g, '')),
            rectangle: (r => (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1))(getTileRange(currentCreatorBounds, 15)) };
    });
    assert.equal(rect.zone, null);
    assert.equal(rect.affiche, rect.rectangle);

    assert.deepEqual(errors, []);
    console.log(`Zone le long d'une trace : ${zone500.tuiles.length} tuiles au lieu de ${zone500.rectangle} pour le rectangle englobant ; polygone ${poly.attendu} au lieu de ${poly.rectangle}.`);
} finally {
    await browser.close();
    server.close();
}

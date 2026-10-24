// Parcours réel : export de zone avec une rotation du fond de carte.
// node tools/test_zone_rotation_browser.mjs <module-playwright>
//
// L'aperçu de la carte de zone fait tourner le fond, en CSS, autour du centre de la
// carte ; le rectangle reste horizontal à l'écran. L'image exportée doit montrer le
// terrain que l'aperçu montre dans le rectangle — y compris quand celui-ci n'est pas
// au centre de la carte — et un point d'intérêt posé d'un clic doit y tomber là où
// on a cliqué. Les tuiles du parcours codent leur position dans leur couleur
// (rouge : colonne du pixel, vert : ligne, bleu : tuile) : chaque pixel, à l'écran
// comme dans l'image, dit quel endroit du terrain il montre. Aucune requête ne sort.
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

// PNG RVB 256 × 256 : rouge = colonne, vert = ligne, bleu = tuile (4 bits x, 4 bits y).
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
};
function tilePng(tx, ty) {
    const raw = Buffer.alloc(256 * (1 + 256 * 3));
    for (let y = 0; y < 256; y++) {
        const row = y * (1 + 256 * 3);
        for (let x = 0; x < 256; x++) raw.set([x, y, ((tx & 15) << 4) + (ty & 15)], row + 1 + x * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Image transparente de 1 px (RVBA), pour les surcouches.
const vide = (() => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))]);
})();

// Pixel monde (au zoom de la carte) que montre la couleur `rgb`, la tuile étant
// retrouvée près de `near` (le bleu n'en garde que 4 bits par axe).
function worldOf([r, g, b], near) {
    const pick = (approx, low) => { const t0 = Math.floor(approx / 256); for (let d = -7; d <= 8; d++) if (((t0 + d) & 15) === low) return t0 + d; return NaN; };
    return { x: pick(near.x, b >> 4) * 256 + r, y: pick(near.y, b & 15) * 256 + g };
}

try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/png' };
        // Fond « Ortho IGN » : les tuiles codées ; toute autre image (routes…) : transparente.
        const m = /ORTHOIMAGERY\.ORTHOPHOTOS.*TileMatrix=(\d+)&TileCol=(\d+)&TileRow=(\d+)/.exec(url);
        if (m) return route.fulfill({ status: 200, headers, body: tilePng(Number(m[2]), Number(m[3])) });
        if (/\.(png|jpe?g)|lyrs=|wmts|tiles/i.test(url)) return route.fulfill({ status: 200, headers, body: vide });
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'load' });
    await page.locator('button[data-mode="zone"]').click();
    await page.waitForFunction(() => window.zoneMap && typeof generateZonePNG === 'function');
    await page.evaluate(() => {
        zoneMap.setView([48.39, -4.45], 16, { animate: false });
        document.getElementById('zone-enable-upscale').checked = false;
        document.querySelector('input[name="zone-grid-choice"][value="none"]').checked = true;
        document.querySelector('input[name="image-format-zone"][value="png"]').checked = true;
    });
    await page.waitForTimeout(800);

    // Rectangle tracé loin du centre de la carte, en haut à gauche.
    const rect = await page.evaluate(() => {
        const size = zoneMap.getSize();
        const a = L.point(size.x * 0.12, size.y * 0.15), b = L.point(size.x * 0.42, size.y * 0.45);
        const bounds = L.latLngBounds(zoneMap.containerPointToLatLng(a), zoneMap.containerPointToLatLng(b));
        zoneMap.fire(L.Draw.Event.CREATED, { layer: L.rectangle(bounds, { fill: false, weight: 1 }), layerType: 'rectangle' });
        const nw = zoneMap.latLngToContainerPoint(bounds.getNorthWest()), se = zoneMap.latLngToContainerPoint(bounds.getSouthEast());
        const box = zoneMap.getContainer().getBoundingClientRect();
        return { x0: nw.x, y0: nw.y, x1: se.x, y1: se.y, left: box.left, top: box.top,
            zoom: zoneMap.getZoom(), centre: zoneMap.project(zoneMap.getCenter(), zoneMap.getZoom()) };
    });

    // Rotation de 30°, puis un point d'intérêt posé d'un clic dans le rectangle.
    await page.evaluate(() => {
        const dev = document.getElementById('zone-deviation');
        dev.value = 30; dev.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(1500);
    const clic = { x: Math.round(rect.x0 + (rect.x1 - rect.x0) * 0.7), y: Math.round(rect.y0 + (rect.y1 - rect.y0) * 0.75) };
    await page.evaluate(() => toggleAddPointMode());
    await page.mouse.click(rect.left + clic.x, rect.top + clic.y);
    assert.equal(await page.evaluate(() => userPOIs.length), 1, 'point d\'intérêt posé');
    // Icône introuvable : l'export dessine à la place un disque rouge, facile à retrouver.
    await page.evaluate(() => { userPOIs[0].url = 'https://absent.test/icone'; userPOIs[0].name = ''; });
    // Le marqueur reste là où l'on a cliqué : il suit son terrain sous l'aperçu tourné.
    const marqueur = await page.evaluate(() => {
        const m = poiMarkersLayer.getLayers()[0];
        return zoneMap.latLngToContainerPoint(m.getLatLng());
    });
    assert.ok(Math.hypot(marqueur.x - clic.x, marqueur.y - clic.y) < 2, `marqueur à ${JSON.stringify(marqueur)}, clic à ${JSON.stringify(clic)}`);
    // Le marqueur masquerait le terrain de la capture : retiré de l'écran le temps de la lire.
    await page.evaluate(() => poiMarkersLayer.remove());

    // Terrain que montre l'aperçu en quelques points du rectangle (écran). Le haut de
    // l'image porte cartouche et rose des vents, le bas à gauche la barre d'échelle.
    const relatifs = [[0.5, 0.55], [0.35, 0.75], [0.85, 0.55], [0.6, 0.9], [0.95, 0.4]];
    const capture = await page.screenshot({ clip: { x: rect.left + rect.x0, y: rect.top + rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 } });
    const lirePixels = (b64, pts) => page.evaluate(async ({ b64, pts }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let rouge = [0, 0, 0];
        for (let i = d.length / 2; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0) { const p = i / 4; rouge = [rouge[0] + p % c.width, rouge[1] + Math.floor(p / c.width), rouge[2] + 1]; }
        return { w: c.width, h: c.height, rouge: rouge[2] ? { x: rouge[0] / rouge[2], y: rouge[1] / rouge[2], n: rouge[2] } : null,
            px: pts.map(([u, v]) => { const i = (Math.round(v * (c.height - 1)) * c.width + Math.round(u * (c.width - 1))) * 4; return [d[i], d[i + 1], d[i + 2]]; }) };
    }, { b64, pts });
    const ecran = await lirePixels(capture.toString('base64'), relatifs);
    await page.evaluate(() => updatePOIMarkers());

    // Export.
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.evaluate(() => generateZonePNG()),
    ]);
    const image = await lirePixels(readFileSync(await download.path()).toString('base64'), relatifs);
    assert.deepEqual(errors, []);
    assert.ok(Math.abs(image.w - (rect.x1 - rect.x0)) <= 2 && Math.abs(image.h - (rect.y1 - rect.y0)) <= 2,
        `image ${image.w} × ${image.h}, rectangle ${rect.x1 - rect.x0} × ${rect.y1 - rect.y0}`);

    // Même terrain, à quelques pixels près (lissage de la rotation, arrondis).
    const near = rect.centre;
    relatifs.forEach(([u, v], i) => {
        const a = worldOf(ecran.px[i], near), b = worldOf(image.px[i], near);
        const ecart = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(ecart < 4, `point (${u}, ${v}) : aperçu ${JSON.stringify(a)}, image ${JSON.stringify(b)}, écart ${ecart.toFixed(1)} px`);
    });
    // Le point d'intérêt tombe dans l'image là où l'on a cliqué dans le rectangle.
    assert.ok(image.rouge, 'point d\'intérêt dessiné');
    const attendu = { x: (clic.x - rect.x0) * image.w / (rect.x1 - rect.x0), y: (clic.y - rect.y0) * image.h / (rect.y1 - rect.y0) };
    assert.ok(Math.hypot(image.rouge.x - attendu.x, image.rouge.y - attendu.y) < 3,
        `point d'intérêt à ${JSON.stringify(image.rouge)}, attendu ${JSON.stringify(attendu)}`);
    console.log('Export de zone tourné : l\'image montre le terrain de l\'aperçu, point d\'intérêt compris.');
} finally {
    await browser.close();
    server.close();
}

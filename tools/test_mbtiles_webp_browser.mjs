// Parcours réel : WebP dans tous les MBTiles produits par l'application.
// node tools/test_mbtiles_webp_browser.mjs <module-playwright>
//
// - Calque de carroyage (.mbtiles « overlay ») : en WebP, les mêmes pixels qu'en
//   PNG (sans perte), et `format=webp` dans les métadonnées. Le poids n'est pas
//   vérifié : sur ce carroyage UTM épars, le WebP est plus lourd (cf. utilities.js).
// - Créer MBTiles : selon le format choisi, une tuile déjà au bon format est
//   gardée octet pour octet, une tuile PNG passe en WebP sans perte, une photo
//   en WebP avec perte ; « format d'origine » ne touche à rien, et une couche
//   composée y est rangée en WebP.
// Tuiles servies par le parcours : aucune requête ne sort.
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
    // Tuiles du serveur fictif : une carte (PNG, traits et texte), une photo
    // (JPEG), une tuile déjà en WebP ; fabriquées dans la page.
    let tuiles = {};
    await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(base)) return route.continue();
        const m = /^https:\/\/tuiles\.test\/(\w+)\//.exec(url);
        if (m && tuiles[m[1]]) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': tuiles[m[1]].type }, body: tuiles[m[1]].body });
        return route.abort();
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof canEncodeWebp === 'function' && typeof ensureSqlJs === 'function');
    assert.equal(await page.evaluate(() => canEncodeWebp()), true, 'ce navigateur doit savoir écrire le WebP');

    // ---- Calque de carroyage : PNG puis WebP, même grille UTM ----
    const overlay = await page.evaluate(async () => {
        await ensureSqlJs(); await ensureMbtilesOverlayModule();
        const bbox = { north: 48.395, south: 48.385, west: -4.495, east: -4.48 };
        const lire = async blob => {
            const SQL = await window.initSqlJs({ locateFile: f => f });
            const db = new SQL.Database(new Uint8Array(await blob.arrayBuffer()));
            const meta = Object.fromEntries(db.exec('SELECT name, value FROM metadata')[0].values);
            const tuiles = db.exec('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles ORDER BY 1, 2, 3')[0].values;
            db.close();
            return { meta, tuiles };
        };
        const pixels = async data => {
            const bmp = await createImageBitmap(new Blob([data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
            const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
            const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height).data;
        };
        const png = await lire(await generateMbtilesProcess('essai', true, false, false, bbox, 15, [], null, 'utm', false, {}, 'png'));
        const webp = await lire(await generateMbtilesProcess('essai', true, false, false, bbox, 15, [], null, 'utm', false, {}, 'webp'));
        let ecart = 0, octetsPng = 0, octetsWebp = 0, signaturesWebp = 0;
        for (let i = 0; i < png.tuiles.length; i++) {
            const a = await pixels(png.tuiles[i][3]), b = await pixels(webp.tuiles[i][3]);
            for (let k = 0; k < a.length; k += 4) {
                if (a[k + 3] === 0 && b[k + 3] === 0) continue;   // transparent : couleur indifférente
                for (let j = 0; j < 4; j++) ecart = Math.max(ecart, Math.abs(a[k + j] - b[k + j]));
            }
            octetsPng += png.tuiles[i][3].length; octetsWebp += webp.tuiles[i][3].length;
            const t = webp.tuiles[i][3];
            if (String.fromCharCode(t[0], t[1], t[2], t[3], t[8], t[9], t[10], t[11]) === 'RIFFWEBP') signaturesWebp++;
        }
        return { formats: [png.meta.format, webp.meta.format], n: [png.tuiles.length, webp.tuiles.length],
            memesTuiles: JSON.stringify(png.tuiles.map(t => t.slice(0, 3))) === JSON.stringify(webp.tuiles.map(t => t.slice(0, 3))),
            ecart, octetsPng, octetsWebp, signaturesWebp };
    });
    assert.deepEqual(overlay.formats, ['png', 'webp']);
    assert.ok(overlay.n[0] > 0 && overlay.memesTuiles, JSON.stringify(overlay));
    assert.equal(overlay.signaturesWebp, overlay.n[1]);
    assert.equal(overlay.ecart, 0, 'WebP sans perte : les mêmes pixels que le PNG');

    // ---- Choix du format, visible pour MBTiles seulement ----
    const choisir = (nom, valeur, rangee) => page.evaluate(([n, v, r]) => {
        const radio = document.querySelector(`input[name="${n}"][value="${v}"]`);
        radio.checked = true; radio.dispatchEvent(new Event('change'));
        return document.getElementById(r).classList.contains('hidden');
    }, [nom, valeur, rangee]);
    for (const [nom, rangee] of [['file-format', 'cado-mbtiles-format-row'], ['zone-file-format', 'zone-mbtiles-format-row']]) {
        assert.equal(await choisir(nom, 'MBTILES', rangee), false, rangee);
        assert.equal(await choisir(nom, 'KMZ', rangee), true, rangee);
    }

    // ---- Créer MBTiles ----
    await page.locator('button[data-mode="creator"]').click();
    await page.waitForFunction(() => typeof MbtilesJob === 'function' && document.getElementById('creator-tile-format')?.options.length === 4);
    assert.deepEqual(await page.evaluate(() => [...document.getElementById('creator-tile-format').options].map(o => o.value)),
        ['webp', 'origine', 'jpg', 'png']);
    const corps = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d');
        x.fillStyle = '#f4f1e8'; x.fillRect(0, 0, 256, 256);
        x.strokeStyle = '#c03'; x.lineWidth = 2; for (let i = 0; i < 256; i += 37) { x.beginPath(); x.moveTo(i, 0); x.lineTo(255 - i, 255); x.stroke(); }
        x.font = 'bold 14px Arial'; x.fillStyle = '#024'; x.fillText('Kerlouan 48°38', 20, 120);
        const b64 = async (mime, q) => {
            const blob = await new Promise(r => c.toBlob(r, mime, q));
            return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
        };
        return { carte: await b64('image/png'), photo: await b64('image/jpeg', 0.8), deja: await b64('image/webp', 0.8) };
    });
    tuiles = {
        carte: { type: 'image/png', body: Buffer.from(corps.carte, 'base64') },
        photo: { type: 'image/jpeg', body: Buffer.from(corps.photo, 'base64') },
        deja: { type: 'image/webp', body: Buffer.from(corps.deja, 'base64') },
    };
    const essais = await page.evaluate(async () => {
        const couche = (...noms) => ({ id: 'essai', name: 'Essai', layers: noms.map(n => ({ url: `https://tuiles.test/${n}/{z}/{x}/{y}` })) });
        const bornes = L.latLngBounds([48.38, -4.5], [48.39, -4.49]);
        const tuile = { z: 15, x: 15973, y: 11270 };
        const sig = async blob => {
            const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
            return b[0] === 0xFF ? 'jpg' : b[0] === 0x89 ? 'png' : String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP' ? 'webp' : '?';
        };
        const pixels = async blob => {
            const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
            return ctx.getImageData(0, 0, 256, 256).data;
        };
        const ecart = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e = Math.max(e, Math.abs(a[i] - b[i])); return e; };
        const source = async n => (await fetch(`https://tuiles.test/${n}/15/0/0`)).blob();
        const out = {};
        for (const [cle, noms, format] of [
            ['webp/carte', ['carte'], 'webp'], ['webp/photo', ['photo'], 'webp'], ['webp/deja', ['deja'], 'webp'],
            ['origine/carte', ['carte'], 'origine'], ['origine/composee', ['photo', 'carte'], 'origine'],
            ['jpg/carte', ['carte'], 'jpg'], ['png/photo', ['photo'], 'png'],
        ]) {
            const job = new MbtilesJob(900 + Object.keys(out).length, bornes, [15], couche(...noms), 'essai', false, null, format);
            const blob = await job._processTile(tuile);
            const src = await source(noms[0]);
            const memesOctets = noms.length === 1
                && btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))) === btoa(String.fromCharCode(...new Uint8Array(await src.arrayBuffer())));
            out[cle] = { format: await sig(blob), meta: job.tileFormat, memesOctets, ecart: ecart(await pixels(blob), await pixels(src)) };
            job.cancel?.();
        }
        return out;
    });
    // Format imposé WebP : la carte passe SANS perte, la photo avec perte, la tuile
    // déjà en WebP reste octet pour octet.
    assert.deepEqual([essais['webp/carte'].format, essais['webp/carte'].meta, essais['webp/carte'].ecart], ['webp', 'webp', 0]);
    assert.deepEqual([essais['webp/photo'].format, essais['webp/photo'].memesOctets], ['webp', false]);
    assert.ok(essais['webp/photo'].ecart > 0 && essais['webp/photo'].ecart < 64, JSON.stringify(essais['webp/photo']));
    assert.deepEqual([essais['webp/deja'].format, essais['webp/deja'].memesOctets], ['webp', true]);
    // Format d'origine : rien n'est touché ; une couche composée est rangée en WebP.
    assert.deepEqual([essais['origine/carte'].format, essais['origine/carte'].memesOctets, essais['origine/carte'].meta], ['png', true, 'png']);
    assert.deepEqual([essais['origine/composee'].format, essais['origine/composee'].meta], ['webp', 'webp']);
    // JPEG et PNG imposés.
    assert.deepEqual([essais['jpg/carte'].format, essais['jpg/carte'].meta], ['jpg', 'jpg']);
    assert.deepEqual([essais['png/photo'].format, essais['png/photo'].meta, essais['png/photo'].ecart], ['png', 'png', 0]);

    assert.deepEqual(errors, []);
    console.log(`WebP : carroyage à pixels identiques (PNG ${overlay.octetsPng} octets, WebP ${overlay.octetsWebp}) ; Créer MBTiles conforme au format choisi.`);
} finally {
    await browser.close();
    server.close();
}

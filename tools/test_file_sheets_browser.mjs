// Parcours réel : un plan en plusieurs feuilles (« Générer depuis un fichier »),
// chacune recalée par ses points et découpée, assemblées en un seul fichier.
// node tools/test_file_sheets_browser.mjs [module-playwright]
// Navigateur : CADO_TEST_BROWSER (sinon Edge sous Windows).
//
// Deux feuilles PNG, ouest (A) et est (B, tournée de 4°), se recouvrent sur
// 300 m. Chacune a son cadre noir et sa légende jaune hors de la zone utile.
// Un repère n'est que sur A (vert), un autre que sur B (violet) ; le repère
// commun, dans le recouvrement, est rouge sur A et bleu sur B : la couleur
// produite dit quelle feuille passe devant. On vérifie :
//   - deux fichiers choisis ensemble → deux feuilles, liste, feuille active ;
//   - génération bloquée tant qu'une feuille affichée n'est pas calée ;
//   - points et zones propres à chaque feuille, retrouvés en changeant de feuille ;
//   - repère d'une autre feuille repris sur la carte d'un clic ;
//   - aperçus des deux feuilles sur la carte, découpés (légende transparente) ;
//   - MBTiles : repères à leur place, cadre et légende absents, feuille du haut
//     devant ; ordre inversé → l'autre devant ; feuille masquée → absente ;
//   - GeoTIFF de l'assemblage ;
//   - PDF de deux pages : « autre page en nouvelle feuille », retrait ;
//   - « Choisir les fichiers… » repart d'un document neuf.
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

// ---- Le plan et ses feuilles ----
// Feuille : image 600 × 450, zone utile (40, 40)–(560, 380), légende dessous.
// Pixel ↔ lon/lat : rotation θ autour du centre de la zone utile, puis pas dlon, dlat.
const W = 600, H = 450, AREA = [40, 40, 560, 380];
const SHEETS = {
    A: { lonc: 2.306, latc: 48.895, theta: 0 },
    B: { lonc: 2.314, latc: 48.895, theta: 4 * Math.PI / 180 },
};
// Plan à l'échelle : même pas au sol en largeur et en hauteur (≈ 1,7 m par pixel).
const DLON = 0.012 / 520, DLAT = DLON * Math.cos(48.895 * Math.PI / 180), CX = 300, CY = 210;
const FEATURES = [
    { id: 'A seul', lon: 2.302, lat: 48.897, A: [0, 160, 0] },
    { id: 'B seul', lon: 2.318, lat: 48.893, B: [128, 0, 160] },
    { id: 'commun', lon: 2.310, lat: 48.895, A: [220, 0, 0], B: [0, 0, 220] },
];
const fwd = (s, x, y) => {                           // pixel → [lon, lat]
    const u = x - CX, v = y - CY, c = Math.cos(-s.theta), n = Math.sin(-s.theta);
    return [s.lonc + (u * c - v * n) * DLON, s.latc - (u * n + v * c) * DLAT];
};
const inv = (s, lon, lat) => {                       // [lon, lat] → pixel
    const u0 = (lon - s.lonc) / DLON, v0 = -(lat - s.latc) / DLAT, c = Math.cos(s.theta), n = Math.sin(s.theta);
    return [CX + u0 * c - v0 * n, CY + u0 * n + v0 * c];
};
const corners = [[AREA[0], AREA[1]], [AREA[2], AREA[1]], [AREA[2], AREA[3]], [AREA[0], AREA[3]], [CX, CY]];
const pointsOf = key => corners.map(([x, y]) => { const [lon, lat] = fwd(SHEETS[key], x, y); return { x, y, lon, lat, enabled: true }; });
const zoneOf = () => [[[AREA[0], AREA[1]], [AREA[2], AREA[1]], [AREA[2], AREA[3]], [AREA[0], AREA[3]]]];

// Deux pages de PDF, unies : rouge puis bleue (PDF écrit à la main, xref exacte).
function twoPagePdf() {
    const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R >>',
    ];
    for (const color of ['1 0 0', '0 0 1']) { const s = `${color} rg 20 20 260 160 re f`; objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`); }
    let out = '%PDF-1.4\n';
    const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

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
        window.ftmSaveBytes = async (data, fname) => { window.__saved = { data, fname }; };
    });

    // Les deux feuilles, dessinées dans la page.
    const pngs = await page.evaluate(({ W, H, AREA, SHEETS, FEATURES, DLON, DLAT, CX, CY }) => {
        const inv = (s, lon, lat) => {
            const u0 = (lon - s.lonc) / DLON, v0 = -(lat - s.latc) / DLAT, c = Math.cos(s.theta), n = Math.sin(s.theta);
            return [CX + u0 * c - v0 * n, CY + u0 * n + v0 * c];
        };
        const out = {};
        for (const key of ['A', 'B']) {
            const c = document.createElement('canvas'); c.width = W; c.height = H;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgb(210,210,210)'; ctx.fillRect(AREA[0], AREA[1], AREA[2] - AREA[0], AREA[3] - AREA[1]);
            ctx.save(); ctx.beginPath(); ctx.rect(AREA[0], AREA[1], AREA[2] - AREA[0], AREA[3] - AREA[1]); ctx.clip();
            for (const f of FEATURES) {
                if (!f[key]) continue;
                const [x, y] = inv(SHEETS[key], f.lon, f.lat);
                ctx.fillStyle = `rgb(${f[key].join(',')})`; ctx.fillRect(x - 8, y - 8, 16, 16);
            }
            ctx.restore();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(AREA[0] - 3, AREA[1] - 3, AREA[2] - AREA[0] + 6, AREA[3] - AREA[1] + 6);
            ctx.fillStyle = 'rgb(250,220,0)'; ctx.fillRect(40, 392, 520, 48);          // légende
            out[key] = c.toDataURL('image/png').split(',')[1];
        }
        return out;
    }, { W, H, AREA, SHEETS, FEATURES, DLON, DLAT, CX, CY });
    const file = key => ({ name: `egouts-${key === 'A' ? 'ouest' : 'est'}.png`, mimeType: 'image/png', buffer: Buffer.from(pngs[key], 'base64') });

    // ---- Deux fichiers ensemble : deux feuilles ----
    await page.locator('#ftm-file').setInputFiles([file('A'), file('B')]);
    await page.waitForFunction(() => ftmState.sheets.length === 2 && !ftmState.opening);
    assert.equal(await page.locator('#ftm-sheets-wrap').isHidden(), false);
    assert.equal(await page.locator('#ftm-add-row').isHidden(), false);
    assert.equal(await page.locator('#ftm-sheets .ftm-sheet').count(), 2);
    assert.equal(await page.evaluate(() => ftmState.active), 1);
    assert.equal(await page.inputValue('#ftm-name'), 'Assemblage');
    assert.equal(await page.locator('#ftm-generate').isDisabled(), true);
    assert.match(await page.locator('#ftm-zoom-why').textContent(), /À caler avant d'assembler : feuille 1 \(egouts-ouest\.png\), feuille 2 \(egouts-est\.png\)/);

    // ---- Feuille 2 (B, active) : points et zone ----
    await page.evaluate(({ pts, zone }) => {
        ftmImportPoints(pts);
        ftmState.viewer.polys = zone; ftmRefresh();
    }, { pts: pointsOf('B'), zone: zoneOf() });
    assert.match(await page.locator('#ftm-sheets [data-sheet="1"] .ftm-sheet-state').textContent(), /calée, 5 points · 1 zone/);
    assert.match(await page.locator('#ftm-zoom-why').textContent(), /À caler avant d'assembler : feuille 1 \(egouts-ouest\.png\)\. Ou la masquer\./);

    // ---- Feuille 1 (A) : la sélection de B est rangée avec B ----
    await page.locator('#ftm-sheets [data-sheet="0"] .ftm-sheet-name').click();
    await page.waitForFunction(() => ftmState.active === 0 && !ftmState.opening);
    assert.deepEqual(await page.evaluate(() => [ftmState.points.length, ftmState.viewer.polys.length, ftmState.source.name]), [0, 0, 'egouts-ouest.png']);
    // Repères de B en gris sur la carte ; un clic reprend la position exacte.
    const reuse = await page.evaluate(() => {
        const others = ftmState.markers.getLayers().filter(l => l.options.className === 'ftm-other-point');
        ftmAddPoint(); ftmPlaceOnPlan(300, 210);
        const hint = ftmState.$('ftm-hint').textContent;
        others[4].fire('click');
        const p = ftmState.points.at(-1), q = ftmState.sheets[1].points[4];
        const out = { n: others.length, hint, same: p.lat === q.lat && p.lon === q.lon, awaiting: ftmState.awaiting };
        ftmState.points.splice(-1, 1); ftmRefresh();
        return out;
    });
    assert.equal(reuse.n, 5);
    assert.match(reuse.hint, /cliquer son rond gris reprend sa position exacte/);
    assert.deepEqual([reuse.same, reuse.awaiting], [true, null]);
    await page.evaluate(({ pts, zone }) => { ftmImportPoints(pts); ftmState.viewer.polys = zone; ftmRefresh(); }, { pts: pointsOf('A'), zone: zoneOf() });
    await page.waitForFunction(() => !ftmState.$('ftm-generate').disabled);
    assert.match(await page.locator('#ftm-zoom-why').textContent(), /2 feuilles, la plus fine fixe le zoom maximal/);
    // Retour sur B : ses points et sa zone l'attendent.
    await page.locator('#ftm-sheets [data-sheet="1"] .ftm-sheet-name').click();
    await page.waitForFunction(() => ftmState.active === 1 && !ftmState.opening);
    assert.deepEqual(await page.evaluate(() => [ftmState.points.length, ftmState.viewer.polys.length, !!ftmState.T]), [5, 1, true]);

    // ---- Aperçus des deux feuilles sur la carte, découpés ----
    const previews = await page.evaluate(() => ftmState.sheets.map(s => {
        const img = s.layer._img, M = ftmSheetPreview(s).base.M;
        const at = (x, y) => { const [u, v] = ftmApply(M, x, y); return img.getContext('2d').getImageData(Math.floor(u), Math.floor(v), 1, 1).data[3]; };
        return { shown: img.style.display !== 'none', legend: at(300, 415), map: at(300, 100), frame: at(37, 200) };
    }));
    for (const p of previews) assert.deepEqual(p, { shown: true, legend: 0, map: 255, frame: 0 });

    // ---- Génération : MBTiles PNG, zoom 17 ----
    const generate = async (output = 'mbtiles') => {
        await page.evaluate(() => openFileToMbtiles());
        await page.selectOption('#ftm-output', output);
        if (output === 'mbtiles') { await page.selectOption('#ftm-format', 'png'); await page.selectOption('#ftm-zmin', '17'); }
        await page.selectOption('#ftm-zmax', '17');
        await page.locator('#ftm-generate').click();
        await page.waitForFunction(() => window.__saved || [...document.querySelectorAll('.ftm-job-message')].some(m => !m.hidden), null, { timeout: 120000 });
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.ftm-job-message')].find(m => !m.hidden)?.textContent || null), null);
    };
    // Couleur (RVBA) au point lon/lat dans le MBTiles enregistré, [0,0,0,0] hors tuile.
    const readMbtiles = probes => page.evaluate(async probes => {
        const { data, fname } = window.__saved; window.__saved = null;
        const SQL = await window.initSqlJs({ locateFile: f => f });
        const db = new SQL.Database(data);
        const meta = Object.fromEntries(db.exec('SELECT name, value FROM metadata')[0].values);
        const out = { fname, meta, px: {} };
        for (const [id, lon, lat] of probes) {
            const [X, Y] = ftmLonLatToMerc(lon, lat), r = ftmMercResolution(17);
            const px = Math.floor((X + FTM_HALF) / r), py = Math.floor((FTM_HALF - Y) / r), tx = Math.floor(px / 256), ty = Math.floor(py / 256);
            const row = db.exec('SELECT tile_data FROM tiles WHERE zoom_level = 17 AND tile_column = ? AND tile_row = ?', [tx, (1 << 17) - 1 - ty]);
            if (!row.length) { out.px[id] = [0, 0, 0, 0]; continue; }
            const bmp = await createImageBitmap(new Blob([row[0].values[0][0]]));
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
            out.px[id] = [...ctx.getImageData(px - tx * 256, py - ty * 256, 1, 1).data];
        }
        db.close();
        return out;
    }, probes);
    const close = (a, b, tol, msg) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${msg} : ${a} ≠ ${b}`);
    const [legLon, legLat] = fwd(SHEETS.A, 300, 415), [frLon, frLat] = fwd(SHEETS.A, 37, 200), [bgLon, bgLat] = fwd(SHEETS.A, 120, 330);
    const probes = [...FEATURES.map(f => [f.id, f.lon, f.lat]), ['légende A', legLon, legLat], ['cadre A', frLon, frLat], ['fond A', bgLon, bgLat]];

    await generate();
    let mb = await readMbtiles(probes);
    assert.equal(mb.fname, 'Assemblage.mbtiles');
    assert.match(mb.meta.description, /^Assemblage — 2 feuilles assemblées : egouts-ouest\.png \(recalé par 5 points d'appui\) ; egouts-est\.png \(recalé par 5 points d'appui\)/);
    close(mb.px['A seul'], [0, 160, 0, 255], 3, 'repère de A');
    close(mb.px['B seul'], [128, 0, 160, 255], 3, 'repère de B');
    close(mb.px.commun, [220, 0, 0, 255], 3, 'recouvrement : A (en haut de la liste) devant');
    close(mb.px['fond A'], [210, 210, 210, 255], 3, 'fond de A');
    assert.equal(mb.px['légende A'][3], 0, 'légende découpée');
    assert.equal(mb.px['cadre A'][3], 0, 'cadre découpé');

    // ---- Ordre inversé : B monte, passe devant ----
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-sheets [data-sheet="1"] [data-sheet-act="up"]').click();
    assert.deepEqual(await page.evaluate(() => [ftmState.sheets.map(s => s.source.name), ftmState.active]), [['egouts-est.png', 'egouts-ouest.png'], 0]);
    await generate();
    mb = await readMbtiles(probes);
    close(mb.px.commun, [0, 0, 220, 255], 3, 'recouvrement : B (monté) devant');
    close(mb.px['A seul'], [0, 160, 0, 255], 3, 'repère de A, ordre inversé');

    // ---- Feuille masquée : absente du fichier ----
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-sheets [data-sheet="1"] input[type=checkbox]').uncheck();
    assert.equal(await page.evaluate(() => ftmState.sheets[1].layer._img.style.display), 'none');
    await generate();
    mb = await readMbtiles(probes);
    assert.equal(mb.px['A seul'][3], 0, 'A masquée : son repère absent');
    close(mb.px['B seul'], [128, 0, 160, 255], 3, 'B seule');
    close(mb.px.commun, [0, 0, 220, 255], 3, 'B seule dans le recouvrement');
    assert.match(mb.meta.description, /^egouts-est\.png — recalé par 5 points d'appui/);
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-sheets [data-sheet="1"] input[type=checkbox]').check();
    await page.locator('#ftm-sheets [data-sheet="0"] input[type=checkbox]').uncheck();
    await page.locator('#ftm-sheets [data-sheet="1"] input[type=checkbox]').uncheck();
    assert.match(await page.locator('#ftm-zoom-why').textContent(), /Toutes les feuilles sont masquées/);
    await page.locator('#ftm-sheets [data-sheet="0"] input[type=checkbox]').check();
    await page.locator('#ftm-sheets [data-sheet="1"] input[type=checkbox]').check();

    // ---- GeoTIFF de l'assemblage ----
    await generate('geotiff');
    const tif = await page.evaluate(async ([lon, lat]) => {
        await loadScriptOnce('vendor/geotiff/geotiff.js');
        const { data, fname } = window.__saved; window.__saved = null;
        const image = await (await GeoTIFF.fromBlob(data)).getImage();
        const [X0, Y0] = image.getOrigin(), [res] = image.getResolution();
        const [X, Y] = ftmLonLatToMerc(lon, lat);
        const u = Math.floor((X - X0) / res), v = Math.floor((Y0 - Y) / res);
        const rgb = await image.readRGB({ window: [u, v, u + 1, v + 1], interleave: true });
        return { fname, px: [...rgb] };
    }, [FEATURES[2].lon, FEATURES[2].lat]);
    assert.equal(tif.fname, 'Assemblage.tif');
    close(tif.px, [0, 0, 220], 3, 'GeoTIFF : B devant');

    // ---- PDF de deux pages : autre page en nouvelle feuille ----
    await page.evaluate(() => openFileToMbtiles());
    await page.locator('#ftm-add-file').setInputFiles([{ name: 'plan-2pages.pdf', mimeType: 'application/pdf', buffer: twoPagePdf() }]);
    await page.waitForFunction(() => ftmState.sheets.length === 3 && !ftmState.opening);
    assert.equal(await page.locator('#ftm-page-row').isHidden(), false);
    await page.locator('#ftm-page-sheet').click();
    await page.waitForFunction(() => ftmState.sheets.length === 4 && !ftmState.opening);
    assert.deepEqual(await page.evaluate(() => [ftmState.active, ftmState.source.pageNo, ftmSheetLabel(ftmState.sheets[2]), ftmSheetLabel(ftmState.sheets[3])]),
        [3, 2, 'plan-2pages.pdf, page 1', 'plan-2pages.pdf, page 2']);
    // Les deux feuilles PDF ne sont pas calées : génération bloquée, puis retirées.
    assert.match(await page.locator('#ftm-zoom-why').textContent(), /feuille 3 \(plan-2pages\.pdf, page 1\), feuille 4 \(plan-2pages\.pdf, page 2\)/);
    await page.locator('#ftm-sheets [data-sheet="3"] [data-sheet-act="remove"]').click();
    await page.waitForFunction(() => ftmState.sheets.length === 3 && !ftmState.opening);
    await page.locator('#ftm-sheets [data-sheet="2"] [data-sheet-act="remove"]').click();
    await page.waitForFunction(() => ftmState.sheets.length === 2 && !ftmState.opening && ftmState.active === 1);
    assert.equal(await page.locator('#ftm-generate').isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => [ftmState.source.name, ftmState.viewer.polys.length, ftmState.points.length]), ['egouts-ouest.png', 1, 5]);

    // ---- « Choisir les fichiers… » : document neuf ----
    await page.locator('#ftm-file').setInputFiles([file('A')]);
    await page.waitForFunction(() => ftmState.sheets.length === 1 && !ftmState.opening);
    assert.equal(await page.locator('#ftm-sheets-wrap').isHidden(), true);
    assert.deepEqual(await page.evaluate(() => [ftmState.points.length, ftmState.viewer.polys.length, ftmState.$('ftm-name').value]), [0, 0, 'egouts-ouest']);
    // Les aperçus des feuilles retirées ont quitté la carte : seul reste celui de
    // la nouvelle feuille, caché tant qu'elle n'est pas calée.
    assert.deepEqual(await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('#ftm-map .ftm-preview-overlay')];
        return [imgs.length, imgs[0] === ftmState.sheets[0].layer._img, imgs[0].style.display];
    }), [1, true, 'none']);

    assert.deepEqual(errors, []);
    console.log('ok - plan en deux feuilles : calage, découpe, ordre, masquage, MBTiles et GeoTIFF ; PDF de deux pages');
} finally {
    await browser.close();
    server.close();
}

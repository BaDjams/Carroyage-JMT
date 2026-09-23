// Tests de isobathes.js, sans réseau ni navigateur : node tools/test_isobathes.mjs
//
// Le module est chargé tel que le navigateur le charge (script classique), dans
// un contexte où `fetch` est remplacé par un faux service IGN. Ce faux service
// répond comme la Géoplateforme : BIL 32 bits petit-boutiste, -99999 hors
// donnée, exception XML en cas de refus.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = readFileSync(`${ROOT}isobathes.js`, 'utf8');

function loadModule(fetchImpl) {
    const context = {
        console, URLSearchParams, TextDecoder, DataView, Float32Array, Float64Array, Uint8Array,
        ArrayBuffer, Map, Set, Math, Number, String, Array, Promise, Error, Object,
        setTimeout: (fn) => setTimeout(fn, 0),          // pas d'attente réelle entre les essais
        fetch: fetchImpl || (() => { throw new Error('réseau interdit dans ce test'); }),
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(SOURCE, context, { filename: 'isobathes.js' });
    return context;
}

// Les objets créés dans le contexte du module ont leurs propres prototypes :
// on les ramène à des valeurs simples avant de les comparer.
const plain = (x) => JSON.parse(JSON.stringify(x));

const R = 6378137, HALF = Math.PI * R;
const lonOf = (x) => x / R * 180 / Math.PI;
const latOf = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
const yOf = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

// Fond marin synthétique en coordonnées géographiques, près de Marseille :
// côte nord-sud à 5,30° E, fond qui descend de 10 m par kilomètre vers l'ouest,
// terre qui monte à l'est. Défini partout sauf au large (> 4 km) : là, -99999,
// comme hors de l'emprise du lidar.
const COAST_LON = 5.30, LAT0 = 43.28;
const M_PER_DEG_LON = 111319.49 * Math.cos(LAT0 * Math.PI / 180);
function seabed(lon, lat) {
    const east = (lon - COAST_LON) * M_PER_DEG_LON;     // mètres, positif à terre
    if (east < -4000) return -99999;
    return east * 0.01 + 0.002 * (lat - LAT0) * 111320;  // légère pente nord-sud
}

function bil(values) {
    const buf = new ArrayBuffer(values.length * 4);
    const dv = new DataView(buf);
    values.forEach((v, i) => dv.setFloat32(i * 4, v, true));
    return buf;
}

function response(status, body, type) {
    return {
        ok: status >= 200 && status < 300, status,
        headers: { get: (h) => h.toLowerCase() === 'content-type' ? type : null },
        arrayBuffer: async () => body,
    };
}

// Faux service IGN. `wms` : 'ok' | 'xml' | 'cors' ; `wmts` : 'ok' | 'cors'.
function fakeIgn({ wms = 'ok', wmts = 'ok', log = [] } = {}) {
    return async (url) => {
        const u = new URL(url);
        const p = Object.fromEntries(u.searchParams);
        log.push({ path: u.pathname, p });
        if (u.pathname === '/wms-r/wms') {
            if (wms === 'cors') throw new TypeError('Failed to fetch');
            if (wms === 'xml') return response(200, new TextEncoder().encode('<ServiceExceptionReport>LayerNotDefined</ServiceExceptionReport>').buffer, 'text/xml');
            const [w, s, e, n] = p.BBOX.split(',').map(Number);
            const nx = +p.WIDTH, ny = +p.HEIGHT;
            const vals = [];
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    const x = w + (i + 0.5) * (e - w) / nx, y = n - (j + 0.5) * (n - s) / ny;
                    vals.push(seabed(lonOf(x), latOf(y)));
                }
            }
            return response(200, bil(vals), 'image/x-bil;bits=32');
        }
        if (u.pathname === '/wmts') {
            if (wmts === 'cors') throw new TypeError('Failed to fetch');
            const L = +p.TILEMATRIX, col = +p.TILECOL, row = +p.TILEROW;
            const rl = 0.703125 / Math.pow(2, L);
            const vals = [];
            for (let j = 0; j < 256; j++) {
                for (let i = 0; i < 256; i++) {
                    const lon = -180 + (col * 256 + i + 0.5) * rl, lat = 90 - (row * 256 + j + 0.5) * rl;
                    vals.push(seabed(lon, lat));
                }
            }
            return response(200, bil(vals), 'image/x-bil;bits=32');
        }
        return response(404, new ArrayBuffer(0), 'text/plain');
    };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- Niveaux et équidistances -------------------------------------------------

test('niveaux sous le zéro NGF', () => {
    const m = loadModule();
    const lv = plain(m.isobathLevels(-7.3, 12, 1, 0));
    assert.deepEqual(lv.map(l => l.depth), [7, 6, 5, 4, 3, 2, 1, 0]);
    assert.deepEqual(lv.map(l => l.alt), [-7, -6, -5, -4, -3, -2, -1, 0]);
    assert.deepEqual(plain(m.isobathLevels(2, 30, 1, 0)), [], 'tout au-dessus du zéro : rien');
    assert.deepEqual(plain(m.isobathLevels(-12, -3.5, 2.5, 0)).map(l => l.depth), [10, 7.5, 5], 'zéro non atteint');
});

test('niveaux ramenés au zéro hydrographique', () => {
    const m = loadModule();
    const datum = m.isobathDatum({ chartDatumBelowNgf: 6.29 });
    assert.equal(datum, -6.29);
    assert.equal(m.isobathDatum({ chartDatumBelowNgf: -6.29 }), -6.29, 'le signe saisi est indifférent');
    assert.equal(m.isobathDatum({ chartDatumBelowNgf: null }), 0);
    const lv = plain(m.isobathLevels(-9.4, 3, 1, datum));
    assert.deepEqual(lv.map(l => l.depth), [3, 2, 1, 0]);
    assert.ok(Math.abs(lv[0].alt - (-9.29)) < 1e-9 && Math.abs(lv[3].alt - (-6.29)) < 1e-9);
});

test('équidistance lisible et maîtresses', () => {
    const m = loadModule();
    const at47 = (z) => 2 * HALF / 256 / Math.pow(2, z) * Math.cos(47 * Math.PI / 180);
    assert.deepEqual([17, 16, 15, 14, 13, 12, 11].map(z => m.isobathLegibleStep(at47(z))), [1, 1, 2.5, 5, 10, 25, 50]);
    // Même correspondance zoom → équidistance du nord au sud de la métropole.
    for (const lat of [41.3, 43.3, 51.1]) {
        const at = (z) => 2 * HALF / 256 / Math.pow(2, z) * Math.cos(lat * Math.PI / 180);
        assert.deepEqual([16, 15, 14, 13, 12, 11].map(z => m.isobathLegibleStep(at(z))), [1, 2.5, 5, 10, 25, 50], `latitude ${lat}`);
    }
    assert.equal(m.isobathStep({ finestStep: 5 }, at47(17)), 5, 'le choix de l\'utilisateur est un plancher');
    assert.equal(m.isobathStep({ finestStep: 1 }, at47(13)), 10, 'élargie quand elle serait illisible');
    assert.deepEqual([1, 2.5, 5, 10, 25, 50].map(m.isobathMasterStep), [5, 10, 20, 50, 100, 200]);
    assert.deepEqual([5, 2.5, 0, 12].map(m.isobathDepthText), ['5', '2,5', '0', '12']);
});

// --- Courbes de niveau --------------------------------------------------------

function field(nx, ny, f) {
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(i, j);
    return v;
}

test('plan : une seule ligne droite, à sa place', () => {
    const m = loadModule();
    const [lines] = m.isobathContours(field(40, 30, (i) => i - 10.3), 40, 30, [0]);
    assert.equal(lines.length, 1);
    const { pts, closed } = lines[0];
    assert.equal(closed, false);
    assert.equal(pts.length / 2, 30, 'un point par rangée');
    for (let q = 0; q < pts.length; q += 2) assert.ok(Math.abs(pts[q] - 10.3) < 1e-5);
});

test('cône : une boucle fermée sur le cercle', () => {
    const m = loadModule();
    const cx = 25.4, cy = 24.7, r = 12.5;
    const [lines] = m.isobathContours(field(50, 50, (i, j) => Math.hypot(i - cx, j - cy) - r), 50, 50, [0]);
    assert.equal(lines.length, 1);
    const { pts, closed } = lines[0];
    assert.ok(closed);
    assert.equal(pts[0], pts[pts.length - 2]);
    assert.equal(pts[1], pts[pts.length - 1]);
    for (let q = 0; q < pts.length; q += 2) {
        const d = Math.hypot(pts[q] - cx, pts[q + 1] - cy);
        assert.ok(Math.abs(d - r) < 0.05, `point à ${d} du centre`);
    }
});

test('trou de données : la ligne s\'arrête au bord, sans le longer', () => {
    const m = loadModule();
    const v = field(40, 30, (i, j) => (i > 20 && j > 10 && j < 20) ? NaN : i - 25.5);
    const [lines] = m.isobathContours(v, 40, 30, [0]);
    assert.equal(lines.length, 2, 'la ligne est coupée en deux par le trou');
    for (const { pts, closed } of lines) {
        assert.equal(closed, false);
        for (let q = 0; q < pts.length; q += 2) assert.ok(Math.abs(pts[q] - 25.5) < 1e-5);
    }
});

test('col : deux segments séparés selon la moyenne', () => {
    const m = loadModule();
    // a=1 (haut gauche), b=0, c=1 (bas droit), d=0 ; moyenne 0,5 >= 0,5 : a et c communiquent.
    const [lines] = plain(m.isobathContours(new Float32Array([1, 0, 0, 1]), 2, 2, [0.5]));
    assert.equal(lines.length, 2);
    // Chaque segment, extrémités triées : l'ordre de parcours est indifférent.
    const ends = lines.map(l => [`${l.pts[0]} ${l.pts[1]}`, `${l.pts[2]} ${l.pts[3]}`].sort().join(' | ')).sort();
    // Coins isolés : b (en haut à droite) et d (en bas à gauche).
    assert.deepEqual(ends, ['0 0.5 | 0.5 1', '0.5 0 | 1 0.5']);
});

test('champ réaliste : lignes recollées sans doublon ni coupure', () => {
    const m = loadModule();
    const nx = 120, ny = 90;
    const f = (i, j) => 8 * Math.sin(i / 9) + 6 * Math.cos(j / 7) + 0.1 * i - 4;
    const levels = [-10, -8, -6, -4, -2, 0, 2, 4, 6];
    const all = m.isobathContours(field(nx, ny, f), nx, ny, levels);
    all.forEach((lines, k) => {
        const seen = new Set();
        for (const { pts, closed } of lines) {
            const n = pts.length / 2;
            assert.ok(n >= 2);
            for (let q = 0; q < (closed ? n - 1 : n); q++) {
                const key = `${pts[2 * q].toFixed(6)},${pts[2 * q + 1].toFixed(6)}`;
                assert.ok(!seen.has(key), `point en double au niveau ${levels[k]}`);
                seen.add(key);
                // Chaque sommet est sur une arête de la grille, à la bonne valeur
                // selon l'interpolation linéaire le long de l'arête.
                const x = pts[2 * q], y = pts[2 * q + 1];
                const onV = Math.abs(x - Math.round(x)) < 1e-9, onH = Math.abs(y - Math.round(y)) < 1e-9;
                assert.ok(onV || onH);
                const val = onH
                    ? f(Math.floor(x), y) + (f(Math.floor(x) + 1, y) - f(Math.floor(x), y)) * (x - Math.floor(x))
                    : f(x, Math.floor(y)) + (f(x, Math.floor(y) + 1) - f(x, Math.floor(y))) * (y - Math.floor(y));
                assert.ok(Math.abs(val - levels[k]) < 1e-3, `sommet à ${val} au lieu de ${levels[k]}`);
            }
            if (!closed) {
                // Une ligne ouverte finit au bord de la grille.
                for (const q of [0, n - 1]) {
                    const x = pts[2 * q], y = pts[2 * q + 1];
                    assert.ok(x <= 1e-9 || y <= 1e-9 || x >= nx - 1 - 1e-9 || y >= ny - 1 - 1e-9, `extrémité intérieure (${x}, ${y})`);
                }
            }
        }
    });
});

// --- Lecture des altitudes -----------------------------------------------------

test('BIL : petit-boutiste, -99999 hors donnée, taille contrôlée', () => {
    const m = loadModule();
    const v = m.decodeIsobathBil(bil([1.5, -99999, -3.25, 4808]), 2, 2);
    assert.equal(v[0], 1.5);
    assert.ok(Number.isNaN(v[1]));
    assert.equal(v[2], -3.25);
    assert.equal(v[3], 4808);
    assert.throws(() => m.decodeIsobathBil(bil([1, 2, 3]), 2, 2), /octets/);
    // Même grille écrite en gros-boutiste : reconnue.
    const buf = new ArrayBuffer(16), dv = new DataView(buf);
    [12.5, -7.75, 3, -99999].forEach((x, i) => dv.setFloat32(i * 4, x, false));
    const be = m.decodeIsobathBil(buf, 2, 2);
    assert.deepEqual([be[0], be[1], be[2]], [12.5, -7.75, 3]);
});

function tileAround(lon, lat, z) {
    const n = Math.pow(2, z);
    return { z, x: Math.floor((lon + 180) / 360 * n), y: Math.floor((HALF - yOf(lat)) / (2 * HALF) * n) };
}

test('WMS : requête conforme et altitudes aux centres des pixels', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ log }));
    const state = m.createIsobathState();
    const t = tileAround(5.29, 43.28, 15);
    const b = m.isobathTileBounds(t.z, t.x, t.y);
    const g = await m.fetchIsobathGrid(b, 64, 64, state);
    assert.equal(log.length, 1);
    const p = log[0].p;
    assert.equal(p.LAYERS, 'RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WMS');
    assert.equal(p.CRS, 'EPSG:3857');
    assert.equal(p.FORMAT, 'image/x-bil;bits=32');
    assert.equal(p.VERSION, '1.3.0');
    assert.deepEqual([p.WIDTH, p.HEIGHT], ['64', '64']);
    const x = b[0] + 10.5 * (b[2] - b[0]) / 64, y = b[3] - 20.5 * (b[3] - b[1]) / 64;
    assert.ok(Math.abs(g.values[20 * 64 + 10] - seabed(lonOf(x), latOf(y))) < 1e-3);
    assert.deepEqual(plain([...state.stats.sources]), ['wms']);
});

test('hors territoire IGN : aucune requête', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ log }));
    const t = tileAround(-9.14, 38.7, 14);                  // Lisbonne
    const g = await m.fetchIsobathGrid(m.isobathTileBounds(t.z, t.x, t.y), 32, 32, m.createIsobathState());
    assert.deepEqual(plain(g), { outside: true });
    assert.equal(log.length, 0);
});

test('WMS en refus : bascule sur le WMTS WGS84G, valeurs cohérentes', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ wms: 'xml', log }));
    const state = m.createIsobathState();
    const t = tileAround(5.29, 43.28, 14);
    const b = m.isobathTileBounds(t.z, t.x, t.y);
    for (let k = 0; k < 4; k++) await m.fetchIsobathGrid(b, 48, 48, state);
    assert.ok(state.wms.disabled, 'WMS abandonné après trois refus');
    assert.equal(log.filter(l => l.path === '/wms-r/wms').length, 3, 'le WMS n\'est plus sollicité ensuite');
    const w = log.find(l => l.path === '/wmts').p;
    assert.equal(w.LAYER, 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES');
    assert.equal(w.TILEMATRIXSET, 'WGS84G');
    assert.equal(w.FORMAT, 'image/x-bil;bits=32');
    // Tuile WGS84G qui contient le point : niveau L, 180/2^L degrés par tuile.
    const L = +w.TILEMATRIX, span = 180 / Math.pow(2, L);
    const rows = log.filter(l => l.path === '/wmts').map(l => +l.p.TILEROW);
    const cols = log.filter(l => l.path === '/wmts').map(l => +l.p.TILECOL);
    assert.ok(Math.min(...cols) <= Math.floor((5.29 + 180) / span) && Math.max(...cols) >= Math.floor((5.29 + 180) / span));
    assert.ok(Math.min(...rows) <= Math.floor((90 - 43.28) / span) && Math.max(...rows) >= Math.floor((90 - 43.28) / span));
    const g = await m.fetchIsobathGrid(b, 48, 48, state);
    let worst = 0;
    for (let j = 0; j < 48; j += 7) {
        for (let i = 0; i < 48; i += 7) {
            const x = b[0] + (i + 0.5) * (b[2] - b[0]) / 48, y = b[3] - (j + 0.5) * (b[3] - b[1]) / 48;
            const want = seabed(lonOf(x), latOf(y));
            if (want > -9000) worst = Math.max(worst, Math.abs(g.values[j * 48 + i] - want));
        }
    }
    assert.ok(worst < 0.05, `écart bilinéaire ${worst} m`);
    assert.ok(state.stats.sources.has('wmts'));
});

test('WMS et WMTS injoignables : erreur claire, pas de boucle', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ wms: 'cors', wmts: 'cors', log }));
    const state = m.createIsobathState();
    const t = tileAround(5.29, 43.28, 15);
    for (let k = 0; k < 6; k++) {
        await assert.rejects(m.fetchIsobathGrid(m.isobathTileBounds(t.z, t.x, t.y), 16, 16, state));
    }
    assert.ok(state.wms.disabled && state.wmts.disabled);
    assert.ok(log.length < 40, `${log.length} requêtes`);
    assert.match(m.isobathReport(state), /injoignable/);
});

// --- Tuile complète -----------------------------------------------------------

function recordingContext() {
    const calls = [];
    const handler = { get: (t, k) => k in t ? t[k] : (...a) => { calls.push([k, ...a]); return { width: 8 * (a[0] || '').length }; } };
    const ctx = new Proxy({ calls }, handler);
    return ctx;
}

test('tuile côtière : lignes tracées, puis élagage des tuiles hors couverture', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ log }));
    const state = m.createIsobathState();
    const settings = { finestStep: 1, chartDatumBelowNgf: null };
    const t = tileAround(5.291, 43.28, 16);
    const draw = await m.isobathTile(t.z, t.x, t.y, settings, state);
    assert.equal(typeof draw, 'function');
    const ctx = recordingContext();
    draw(ctx);
    assert.ok(ctx.calls.filter(c => c[0] === 'lineTo').length > 50);
    assert.ok(ctx.calls.some(c => c[0] === 'fillText'), 'au moins une cote');
    assert.equal(state.classes.get(`${t.z}/${t.x}/${t.y}`), 'water');

    // Tuile de zoom 16 à 10 km au large : hors de l'emprise du lidar (-99999).
    const far = tileAround(5.17, 43.28, 16);
    assert.equal(await m.isobathTile(far.z, far.x, far.y, settings, state), null);
    assert.equal(state.classes.get(`${far.z}/${far.x}/${far.y}`), 'empty');
    const before = log.length;
    assert.equal(await m.isobathTile(17, far.x * 2, far.y * 2 + 1, settings, state), null);
    assert.equal(log.length, before, 'sous-tuile d\'une tuile vide : pas de requête');
    assert.equal(state.stats.skipped, 1);
});

test('zoom 18 : grille du zoom 16 réemployée, requête plus petite', async () => {
    const log = [];
    const m = loadModule(fakeIgn({ log }));
    const t = tileAround(5.2995, 43.28, 18);
    await m.isobathTile(t.z, t.x, t.y, { finestStep: 1 }, m.createIsobathState());
    const p = log[0].p;
    // 256 px au zoom 18 = 64 px au zoom 16, plus 2 × 8 px de marge.
    assert.deepEqual([p.WIDTH, p.HEIGHT], ['80', '80']);
    const [w, , e] = p.BBOX.split(',').map(Number);
    assert.ok((e - w) / 80 >= 1.02, 'jamais plus fin que 1 m par pixel Mercator (limite d\'échelle du WMS)');
});

let failed = 0;
for (const { name, fn } of tests) {
    try {
        await fn();
        console.log(`ok   ${name}`);
    } catch (e) {
        failed++;
        console.log(`ÉCHEC ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e}`);
    }
}
console.log(`\n${tests.length - failed}/${tests.length} tests réussis`);
process.exit(failed ? 1 : 0);

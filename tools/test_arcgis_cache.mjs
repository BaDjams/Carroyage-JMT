// Tests d'arcgisCache.js (couches « arcgis-cache », cache ArcGIS en Lambert 93
// reprojeté dans le navigateur), sans navigateur : node tools/test_arcgis_cache.mjs
//
// - Lambert 93 : agcLambert93 confronté à proj4 (vendor/proj4), au millimètre ;
// - plan d'une tuile XYZ : niveau du cache choisi, tuiles lues, et écart de
//   l'approximation affine sur toute la tuile : sous le demi-pixel à tous les
//   zooms, sous le centimètre au sol dès le zoom 17.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const proj4 = createRequire(import.meta.url)(`${ROOT}vendor/proj4/proj4.js`);
const L93 = '+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const context = { Math, Error, Array, Object, Number, String, Map, Promise, console };
vm.createContext(context);
vm.runInContext(readFileSync(`${ROOT}arcgisCache.js`, 'utf8') + ';Object.assign(globalThis, { agcLambert93, agcTilePlan, agcWorldPixelToLonLat, layerNeedsCanvas });', context, { filename: 'arcgisCache.js' });
const C = context;

// Couche de l'atlas IGC, lue dans map-layers.js lui-même.
const catalogue = { window: {}, Math, Number, String, Object, Array, URLSearchParams };
vm.createContext(catalogue);
vm.runInContext(readFileSync(`${ROOT}map-layers.js`, 'utf8') + ';globalThis.MAP_OVERLAYS = MAP_OVERLAYS;', catalogue, { filename: 'map-layers.js' });
const ATLAS = catalogue.MAP_OVERLAYS.find(l => l.id === 'igc_atlas').layers.find(l => l.type === 'arcgis-cache');
assert.ok(ATLAS && ATLAS.extent, 'couche arcgis-cache de l\'atlas IGC absente de map-layers.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('Lambert 93 identique à proj4, au millimètre, sur la France', () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
        const lon = -5 + rand() * 14, lat = 41.5 + rand() * 9.5;
        const [x, y] = C.agcLambert93(lon, lat), [px, py] = proj4('WGS84', L93, [lon, lat]);
        worst = Math.max(worst, Math.hypot(x - px, y - py));
    }
    assert.ok(worst < 1e-3, `écart ${worst} m`);
    // Point de référence : origine de la projection.
    const [x0, y0] = C.agcLambert93(3, 46.5);
    assert.ok(Math.abs(x0 - 700000) < 1e-6 && Math.abs(y0 - 6600000) < 1e-6);
});

// Écart en mètres, au sol, entre la tuile posée par la matrice du plan et la
// position exacte de chaque pixel (grille de 17 × 17 points sur la tuile).
function planError(layer, z, x, y) {
    const plan = C.agcTilePlan(layer, z, x, y);
    const [a, b, c, d, e, f] = plan.matrix;
    const det = a * d - b * c;
    const { res } = plan;
    const span = 256 * res;
    const tile0 = plan.tiles[0];
    // Retrouver X0, Y0 depuis la première tuile lue.
    const m = /\/tile\/(\d+)\/(\d+)\/(\d+)$/.exec(tile0.url);
    const row0 = Number(m[2]) - tile0.dy / 256, col0 = Number(m[3]) - tile0.dx / 256;
    const X0 = layer.origin[0] + col0 * span, Y0 = layer.origin[1] - row0 * span;
    const lat = C.agcWorldPixelToLonLat(x * 256 + 128, y * 256 + 128, z)[1];
    const ground = 2 * 20037508.342789244 / (256 * 2 ** z) * Math.cos(lat * Math.PI / 180);
    let worst = 0, inside = true;
    for (let u = 0; u <= 256; u += 16) for (let v = 0; v <= 256; v += 16) {
        const [X, Y] = C.agcLambert93(...C.agcWorldPixelToLonLat(x * 256 + u, y * 256 + v, z));
        const i = (X - X0) / res, j = (Y0 - Y) / res;
        if (i < 0 || j < 0 || i > plan.width || j > plan.height) inside = false;
        const uu = a * i + c * j + e, vv = b * i + d * j + f;
        worst = Math.max(worst, Math.hypot(uu - u, vv - v) * ground);
    }
    return { plan, worst, inside, ground, det };
}

test('plan d\'une tuile : niveau, tuiles lues, écart sous le demi-pixel, sous le centimètre dès z17 (Paris, z12 à z19)', () => {
    const lonlat = [[2.332, 48.834], [2.29, 48.86], [2.40, 48.83], [2.21, 48.89], [2.47, 48.85]];
    for (const [lon, lat] of lonlat) for (let z = 12; z <= 19; z++) {
        const N = 2 ** z, x = Math.floor((lon + 180) / 360 * N);
        const y = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * N);
        const { plan, worst, inside, ground } = planError(ATLAS, z, x, y);
        assert.ok(inside, `z${z} : la tuile déborde du canevas intermédiaire`);
        // L'écart croît comme le carré de la taille de la tuile : sous le
        // demi-pixel partout, sous le centimètre au sol dès le zoom 17.
        assert.ok(worst < 0.5 * ground, `z${z} : écart ${(worst / ground).toFixed(3)} px`);
        if (z >= 17) assert.ok(worst < 0.01, `z${z} : écart ${worst.toFixed(4)} m`);
        // Le pixel du cache est plus fin que celui de la tuile, mais pas deux fois plus.
        assert.ok(plan.res <= ground * 1.0001 && plan.res * 2 > ground, `z${z} : pixel du cache ${plan.res} m, de la tuile ${ground} m`);
        assert.ok(plan.tiles.length >= 1 && plan.tiles.length <= 9, `${plan.tiles.length} tuiles`);
        assert.ok(plan.tiles.every(t => t.url.startsWith(`https://capgeo2.paris.fr/public/rest/services/IGC/IGC_Atlas/MapServer/tile/${plan.level}/`)));
    }
    // Au zoom 19 (≈ 0,2 m), le niveau 11 du cache (0,149 m) ; au zoom 18, le niveau 10.
    assert.equal(C.agcTilePlan(ATLAS, 19, 265537, 180419).level, 11);
    assert.equal(C.agcTilePlan(ATLAS, 18, 132768, 90209).level, 10);
});

test('hors de l\'emprise du cache : aucune tuile demandée', () => {
    assert.equal(C.agcTilePlan(ATLAS, 15, 15927, 11272).tiles.length, 0);    // Finistère
    let n = 0;
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) n += C.agcTilePlan(ATLAS, 5, x, y).tiles.length;
    // L'emprise (33 × 25 km) chevauche au plus 2 × 2 tuiles du niveau 0 (78 km).
    assert.ok(n >= 1 && n <= 4, `${n} tuiles du cache pour le monde entier au zoom 5`);
    assert.ok(C.agcTilePlan(ATLAS, 15, 16596, 11277).tiles.length > 0);       // Denfert-Rochereau
});

test('niveau borné aux niveaux du cache', () => {
    assert.equal(C.agcTilePlan(ATLAS, 22, 2124302, 1443355).level, 12);
    assert.equal(C.agcTilePlan(ATLAS, 3, 4, 2).level, 0);
});

test('système non pris en charge : message clair', () => {
    assert.throws(() => C.agcTilePlan({ ...ATLAS, crs: 27572 }, 15, 16595, 11274), /EPSG:27572 non pris en charge/);
});

test('reprojetées par canvas : Yandex et arcgis-cache, pas les autres', () => {
    assert.equal(C.layerNeedsCanvas({ type: 'arcgis-cache' }), true);
    assert.equal(C.layerNeedsCanvas({ type: 'yandex' }), true);
    assert.equal(C.layerNeedsCanvas({ type: 'xyz' }), false);
    assert.equal(C.layerNeedsCanvas({ type: 'wms' }), false);
});

console.log(`${n} tests verts`);

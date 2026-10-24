// Fonds de carte et surcouches (fonds.js, map-layers.js) : mêmes règles que
// CadoTour (fondsModel.js). node tools/test_fonds.mjs
//
// Catalogue scindé en fonds (une image, satellite ou plan) et surcouches
// cumulables ; deux surcouches d'un même groupe s'excluent ; les anciens fonds
// composites se retrouvent ; la source des exports empile le fond puis les
// surcouches, au zoom du plus bas des étages.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

// Contexte d'une page sans clé personnelle (config.private.js absent), avec un
// stockage local en mémoire.
function page(keys = {}) {
    const store = new Map();
    const ctx = {
        Math, Number, String, Object, Array, Map, Set, JSON, URLSearchParams, console,
        localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
        ...keys,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const file of ['map-layers.js', 'fonds.js']) vm.runInContext(readFileSync(`${ROOT}${file}`, 'utf8'), ctx, { filename: file });
    vm.runInContext('Object.assign(globalThis, { MAP_LAYERS, MAP_OVERLAYS })', ctx);
    return { ctx, store };
}

// Valeurs nées dans le contexte de la page : comparées en données pures.
const plain = v => JSON.parse(JSON.stringify(v));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('catalogue : des fonds d\'une seule image, rangés en satellite et cartes', () => {
    const { ctx } = page();
    for (const b of ctx.MAP_LAYERS) {
        assert.ok(['sat', 'carto'].includes(b.kind), `${b.id} sans famille`);
        assert.equal(b.layers.length, 1, `${b.id} : un fond est UNE image`);
    }
    const ids = [...ctx.MAP_LAYERS, ...ctx.MAP_OVERLAYS].map(c => c.id);
    assert.equal(new Set(ids).size, ids.length, 'identifiants en double');
    assert.ok(ctx.MAP_OVERLAYS.every(o => !o.kind), 'une surcouche n\'a pas de famille');
});

test('choix de départ : l\'ancien fond par défaut, Ortho IGN sous les routes Google', () => {
    const { ctx } = page();
    assert.deepEqual(plain(ctx.fondsState()), { base: 'ign_ortho', overlays: ['google_routes'] });
    assert.equal(ctx.fondsName(), 'Ortho IGN + Routes Google');
});

test('surcouches d\'un même groupe exclusives, ordre du catalogue', () => {
    const { ctx } = page();
    const cat = ctx.MAP_OVERLAYS;
    let s = ctx.fondsToggleOverlay([], 'google_routes', true, cat);
    s = ctx.fondsToggleOverlay(s, 'ign_routes', true, cat);
    assert.deepEqual(plain(s), ['ign_routes', 'google_routes']);
    s = ctx.fondsToggleOverlay(s, 'google_routes_poi', true, cat);
    assert.deepEqual(plain(s), ['ign_routes', 'google_routes_poi']);
    s = ctx.fondsToggleOverlay(s, 'ign_routes', false, cat);
    assert.deepEqual(plain(s), ['google_routes_poi']);
    assert.deepEqual(plain(ctx.fondsToggleOverlay(s, 'inconnue', true, cat)), ['google_routes_poi']);
});

test('anciens fonds composites : le fond et ses surcouches', () => {
    const { ctx } = page();
    const cases = {
        ign_ign_hybrid: ['ign_ortho', ['ign_routes']],
        ign_google_hybrid: ['ign_ortho', ['google_routes']],
        google_hybrid: ['google_satellite', ['google_routes_poi']],
        google_hybrid_NOPOI: ['google_satellite', ['google_routes']],
        yandex_hybrid: ['yandex_satellite', ['yandex_routes']],
        emodnet_bathy: ['osm_standard', ['emodnet_contours']],
        igc_carrieres: ['osm_standard', ['igc_atlas']],
        inland_waters: ['ign_public_hybrid', ['openseamap']],   // sans licence i-Boating
    };
    for (const [old, [base, overlays]] of Object.entries(cases)) {
        ctx.fondsSet({ base: old });
        assert.deepEqual(plain(ctx.fondsState()), { base, overlays }, old);
    }
});

test('choix retenu : relu, ramené au catalogue, « aucune surcouche » compris', () => {
    const { ctx, store } = page();
    ctx.fondsSet({ base: 'google_satellite', overlays: ['ign_routes', 'google_routes', 'google_routes_poi', 'absente'] });
    assert.deepEqual(JSON.parse(store.get('cjmt.fonds')), { base: 'google_satellite', overlays: ['ign_routes', 'google_routes_poi'] });
    // Changer de fond garde les surcouches.
    ctx.fondsSet({ base: 'osm_standard' });
    assert.deepEqual(plain(ctx.fondsState().overlays), ['ign_routes', 'google_routes_poi']);
    const n = ctx.fondsNormalizeState({ base: 'disparu', overlays: [] }, { bases: ['ign_ortho'], overlays: ctx.MAP_OVERLAYS, fallback: 'ign_ortho', defaults: ['google_routes'] });
    assert.deepEqual(plain(n), { base: 'ign_ortho', overlays: [] });
});

test('source des exports : le fond puis les surcouches, au zoom du plus bas', () => {
    const { ctx } = page();
    const cfg = ctx.fondsConfig({ base: 'google_satellite', overlays: ['ign_routes', 'google_routes'] });
    const sat = ctx.MAP_LAYERS.find(l => l.id === 'google_satellite');
    const ign = ctx.MAP_OVERLAYS.find(l => l.id === 'ign_routes');
    const ggl = ctx.MAP_OVERLAYS.find(l => l.id === 'google_routes');
    assert.deepEqual(plain(cfg.layers), plain([...sat.layers, ...ign.layers, ...ggl.layers]));
    assert.equal(cfg.maxZoom, 19, 'Google 21, routes IGN 19 : 19');
    assert.equal(cfg.name, 'Google Satellite + Routes IGN + Routes Google');
    assert.equal(cfg.shortName, 'Google Sat + IGN + Google');
    // L'ancien « Ortho IGN + Routes Google » : mêmes tuiles, même nom court au cartouche.
    const def = ctx.fondsConfig({ base: 'ign_ortho', overlays: ['google_routes'] });
    assert.equal(def.shortName, 'Ortho IGN + Google');
    assert.equal(def.maxZoom, 19);
    assert.match(def.layers[0].url, /ORTHOIMAGERY\.ORTHOPHOTOS/);
    assert.match(def.layers[1].url, /lyrs=h/);
    assert.equal(ctx.fondsConfig({ base: 'absent', overlays: [] }), null);
});

test('clés personnelles : une entrée sans sa clé n\'est pas proposée', () => {
    const sans = page().ctx, avec = page({ IGN_PRIVATE_API_KEY: 'k', IBOATING_WMTS_URL: 'http://127.0.0.1:8080/{z}/{x}/{y}.png' }).ctx;
    const ids = c => c.fondsCatalogue().bases.map(b => b.id);
    assert.ok(!ids(sans).includes('ign_scan_composite') && ids(avec).includes('ign_scan_composite'));
    // Avec licence, « Eaux intérieures » est un fond à part entière.
    assert.ok(!ids(sans).includes('inland_waters') && ids(avec).includes('inland_waters'));
    avec.fondsSet({ base: 'inland_waters' });
    assert.equal(avec.fondsState().base, 'inland_waters');
});

console.log(`${n} tests réussis`);

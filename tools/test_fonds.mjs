// Fonds de carte et surcouches (fonds.js, map-layers.js) : mêmes règles que
// CadoTour (fondsModel.js). node tools/test_fonds.mjs
//
// Catalogue scindé en fonds (une image, satellite ou plan) et surcouches
// cumulables ; deux surcouches d'un même groupe s'excluent ; une seule surcouche
// de routes, qui suit le fond (règle des routes de CadoTour 1.53.404 et 1.53.438) ;
// les anciens fonds composites se retrouvent ; la source des exports empile le
// fond puis les surcouches, au zoom du plus bas des étages.
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

test('premier lancement : Google Satellite et, d\'office, Routes Google + POI', () => {
    const { ctx } = page();
    assert.deepEqual(plain(ctx.fondsState()), { base: 'google_satellite', overlays: ['google_routes_poi'], roads: null });
    assert.equal(ctx.fondsName(), 'Google Satellite + Routes Google + POI');
    ctx.fondsSet({ base: 'yandex_satellite' });
    assert.deepEqual(plain(ctx.fondsState()), { base: 'yandex_satellite', overlays: ['yandex_routes'], roads: null });
    ctx.fondsSet({ base: 'ign_ortho' });
    assert.deepEqual(plain(ctx.fondsState().overlays), ['ign_routes']);
});

test('surcouches d\'un même groupe exclusives, une seule de routes, ordre du catalogue', () => {
    const { ctx } = page();
    const cat = ctx.MAP_OVERLAYS;
    let s = ctx.fondsToggleOverlay([], 'openseamap', true, cat);
    s = ctx.fondsToggleOverlay(s, 'google_routes', true, cat);
    assert.deepEqual(plain(s), ['google_routes', 'openseamap']);
    s = ctx.fondsToggleOverlay(s, 'google_routes_poi', true, cat);
    assert.deepEqual(plain(s), ['google_routes_poi', 'openseamap'], 'même groupe');
    s = ctx.fondsToggleOverlay(s, 'ign_routes', true, cat);
    assert.deepEqual(plain(s), ['ign_routes', 'openseamap'], 'une seule surcouche de routes');
    s = ctx.fondsToggleOverlay(s, 'ign_routes', false, cat);
    assert.deepEqual(plain(s), ['openseamap']);
    assert.deepEqual(plain(ctx.fondsToggleOverlay(s, 'inconnue', true, cat)), ['openseamap']);
});

test('chaque fond satellite dit sa surcouche de routes, qui existe ; les cartes aucune', () => {
    const { ctx } = page();
    const routes = new Set(ctx.MAP_OVERLAYS.filter(o => o.roads).map(o => o.id));
    assert.deepEqual([...routes], ['ign_routes', 'google_routes', 'google_routes_poi', 'yandex_routes']);
    for (const cfg of ctx.MAP_LAYERS.filter(c => c.kind === 'sat')) {
        assert.ok('roads' in cfg, `${cfg.id} : sa surcouche de routes, ou null`);
        if (cfg.roads !== null) assert.ok(routes.has(cfg.roads), `${cfg.id} → ${cfg.roads}`);
    }
    const fond = id => ctx.MAP_LAYERS.find(c => c.id === id);
    assert.equal(fond('ign_ortho').roads, 'ign_routes');
    assert.equal(fond('google_satellite').roads, 'google_routes_poi');
    assert.equal(fond('yandex_satellite').roads, 'yandex_routes');
    assert.equal(fond('bing_hybrid').roads, null, 'Bing hybride : routes déjà dans l\'image');
    for (const cfg of ctx.MAP_LAYERS.filter(c => c.kind === 'carto')) assert.ok(!cfg.roads, cfg.id);
});

test('règle des routes : d\'office sur un satellite, le choix manuel le suit, rien sur une carte', () => {
    const { ctx } = page();
    const fond = id => ctx.MAP_LAYERS.find(c => c.id === id);
    const sur = (base, roads, courant = []) => plain(ctx.fondsWithRoadRule(courant, fond(base), roads, ctx.MAP_OVERLAYS));
    assert.deepEqual(sur('ign_ortho', null), ['ign_routes']);
    assert.deepEqual(sur('google_satellite', null, ['ign_routes', 'openseamap']), ['google_routes_poi', 'openseamap'], 'l\'autre route part, les amers restent');
    assert.deepEqual(sur('bing_hybrid', null, ['ign_routes']), []);
    assert.deepEqual(sur('google_satellite', 'ign_routes'), ['ign_routes']);
    assert.deepEqual(sur('yandex_satellite', ''), []);
    assert.deepEqual(sur('osm_standard', 'ign_routes', ['ign_routes', 'emodnet_contours']), ['emodnet_contours']);
    assert.deepEqual(sur('ign_public_hybrid', null, ['google_routes_poi']), []);
    assert.equal(ctx.fondsRoadOverlayFor(fond('osm_standard'), 'ign_routes', ctx.MAP_OVERLAYS), null);
    assert.equal(ctx.fondsRoadOverlayFor(fond('ign_ortho'), 'disparue', ctx.MAP_OVERLAYS), 'ign_routes', 'choix inconnu : automatique');
});

test('choisir un fond efface le choix manuel : un satellite reprend sa surcouche, Bing aucune', () => {
    const { ctx } = page();
    const fond = id => ctx.MAP_LAYERS.find(c => c.id === id);
    const apres = (base, etat) => plain(ctx.fondsAfterBaseChosen(etat, fond(base), ctx.MAP_OVERLAYS));
    assert.deepEqual(apres('ign_ortho', { overlays: ['google_routes', 'openseamap'], roads: 'google_routes' }),
        { overlays: ['ign_routes', 'openseamap'], roads: null });
    assert.deepEqual(apres('google_satellite', { overlays: [], roads: '' }), { overlays: ['google_routes_poi'], roads: null });
    assert.deepEqual(apres('bing_hybrid', { overlays: ['google_routes'], roads: 'google_routes' }), { overlays: [], roads: null });
    const carte = apres('osm_standard', { overlays: ['google_routes'], roads: 'google_routes' });
    assert.deepEqual(carte, { overlays: [], roads: null });
    assert.deepEqual(apres('yandex_satellite', carte), { overlays: ['yandex_routes'], roads: null });
});

test('menu : une route cochée à la main vaut pour ce fond seulement, retenue', () => {
    const { ctx, store } = page();
    ctx.fondsSet({ base: 'yandex_satellite' });
    ctx.fondsSet({ overlays: ctx.fondsToggleOverlay(ctx.fondsState().overlays, 'google_routes', true, ctx.MAP_OVERLAYS) });
    assert.deepEqual(plain(ctx.fondsState()), { base: 'yandex_satellite', overlays: ['google_routes'], roads: 'google_routes' });
    assert.deepEqual(JSON.parse(store.get('cjmt.fonds')), { base: 'yandex_satellite', overlays: ['google_routes'], roads: 'google_routes' });
    // Une autre surcouche cochée ne touche pas au choix des routes.
    ctx.fondsSet({ overlays: ctx.fondsToggleOverlay(ctx.fondsState().overlays, 'openseamap', true, ctx.MAP_OVERLAYS) });
    assert.equal(ctx.fondsState().roads, 'google_routes');
    // « Aucune route » choisie à la main…
    ctx.fondsSet({ overlays: ctx.fondsToggleOverlay(ctx.fondsState().overlays, 'google_routes', false, ctx.MAP_OVERLAYS) });
    assert.deepEqual(plain(ctx.fondsState()), { base: 'yandex_satellite', overlays: ['openseamap'], roads: '' });
    // … jusqu'au fond suivant : il reprend sa surcouche, les amers restent.
    ctx.fondsSet({ base: 'ign_ortho' });
    assert.deepEqual(plain(ctx.fondsState()), { base: 'ign_ortho', overlays: ['ign_routes', 'openseamap'], roads: null });
    // Une carte : aucune route ; une route cochée à la main y reste jusqu'au fond suivant.
    ctx.fondsSet({ base: 'osm_standard' });
    assert.deepEqual(plain(ctx.fondsState().overlays), ['openseamap']);
    ctx.fondsSet({ overlays: ['google_routes', 'openseamap'] });
    assert.deepEqual(plain(ctx.fondsState().overlays), ['google_routes', 'openseamap']);
    ctx.fondsSet({ base: 'google_satellite' });
    assert.deepEqual(plain(ctx.fondsState()), { base: 'google_satellite', overlays: ['google_routes_poi', 'openseamap'], roads: null });
});

test('choix enregistré avant la règle : rien ne change sur un satellite, la route part d\'une carte', () => {
    const { ctx } = page();
    const { normalize } = ctx.fondsCatalogue();
    assert.deepEqual(plain(normalize({ base: 'ign_ortho', overlays: ['ign_routes'] })), { base: 'ign_ortho', overlays: ['ign_routes'], roads: null });
    assert.deepEqual(plain(normalize({ base: 'ign_ortho', overlays: ['google_routes'] })), { base: 'ign_ortho', overlays: ['google_routes'], roads: 'google_routes' });
    assert.deepEqual(plain(normalize({ base: 'google_satellite', overlays: [] })), { base: 'google_satellite', overlays: [], roads: '' });
    assert.deepEqual(plain(normalize({ base: 'google_satellite', overlays: ['ign_routes', 'google_routes'] })),
        { base: 'google_satellite', overlays: ['google_routes'], roads: 'google_routes' }, 'deux routes : une seule');
    assert.deepEqual(plain(normalize({ base: 'osm_standard', overlays: ['google_routes', 'openseamap'] })), { base: 'osm_standard', overlays: ['openseamap'], roads: null });
    assert.deepEqual(plain(normalize({ base: 'ign_ortho', overlays: [], roads: 'disparue' })), { base: 'ign_ortho', overlays: ['ign_routes'], roads: null }, 'choix inconnu : automatique');
});

test('anciens fonds composites : le fond et ses surcouches', () => {
    const { ctx } = page();
    // `roads` : une autre route que celle du fond est un choix manuel.
    const cases = {
        ign_ign_hybrid: ['ign_ortho', ['ign_routes'], null],
        ign_google_hybrid: ['ign_ortho', ['google_routes'], 'google_routes'],
        google_hybrid: ['google_satellite', ['google_routes_poi'], null],
        google_hybrid_NOPOI: ['google_satellite', ['google_routes'], 'google_routes'],
        yandex_hybrid: ['yandex_satellite', ['yandex_routes'], null],
        emodnet_bathy: ['osm_standard', ['emodnet_contours'], null],
        igc_carrieres: ['osm_standard', ['igc_atlas'], null],
        inland_waters: ['ign_public_hybrid', ['openseamap'], null],   // sans licence i-Boating
    };
    for (const [old, [base, overlays, roads]] of Object.entries(cases)) {
        ctx.fondsSet({ base: old });
        assert.deepEqual(plain(ctx.fondsState()), { base, overlays, roads }, old);
    }
});

test('choix retenu : relu, ramené au catalogue, « aucune surcouche » compris', () => {
    const { ctx, store } = page();
    ctx.fondsSet({ base: 'google_satellite', overlays: ['ign_routes', 'openseamap', 'google_routes', 'google_routes_poi', 'absente'] });
    assert.deepEqual(JSON.parse(store.get('cjmt.fonds')), { base: 'google_satellite', overlays: ['google_routes_poi', 'openseamap'], roads: null });
    // Changer de fond garde les surcouches autres que les routes.
    ctx.fondsSet({ base: 'osm_standard' });
    assert.deepEqual(plain(ctx.fondsState().overlays), ['openseamap']);
    const bases = ctx.MAP_LAYERS.filter(b => b.id === 'ign_ortho');
    const n = ctx.fondsNormalizeState({ base: 'disparu', overlays: [] }, { bases, overlays: ctx.MAP_OVERLAYS, fallback: 'ign_ortho' });
    assert.deepEqual(plain(n), { base: 'ign_ortho', overlays: [], roads: '' });
    for (const raw of [null, 'x', 42, {}, { base: 'disparu', overlays: 'ign_routes' }]) {
        assert.deepEqual(plain(ctx.fondsNormalizeState(raw, { bases, overlays: ctx.MAP_OVERLAYS, fallback: 'ign_ortho' })), { base: 'ign_ortho', overlays: ['ign_routes'], roads: null }, JSON.stringify(raw));
    }
    // Les identifiants seuls restent acceptés (catalogue sans familles).
    const m = ctx.fondsNormalizeState(null, { bases: ['essai'], overlays: ctx.MAP_OVERLAYS, fallback: 'essai' });
    assert.deepEqual(plain(m), { base: 'essai', overlays: [], roads: null });
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

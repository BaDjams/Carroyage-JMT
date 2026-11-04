// fonds.js — fonds de carte et surcouches, comme dans CadoTour
// (github.com/BaDjams/CadoTour : fondsModel.js pour le modèle, baseSelect.js pour
// le menu). Même empilement, mêmes règles, même menu ; ici en script classique.
//
// Du bas vers le haut :
//   1. le FOND — une seule image, satellite ou plan (MAP_LAYERS, map-layers.js) ;
//   2. les SURCOUCHES — routes, noms, amers, lignes de profondeur… — cumulables
//      (MAP_OVERLAYS), dans l'ordre du catalogue.
// Un .mbtiles chargé (tileSource.js) remplace l'un et les autres, à l'écran comme
// à l'export : le menu le dit et garde le choix pour le retour en ligne.
//
// Le choix est UN pour toute l'application : les trois cartes Leaflet — carroyage
// rapide, export de zone, Créer MBTiles — le partagent, règle des routes comprise, et il est retenu d'une visite
// à l'autre. Les exports en tirent leur source de tuiles par fondsConfig().

/** Rang de chaque étage dans le panneau de tuiles (option `zIndex` des couches Leaflet). */
const FONDS_STACK_Z = Object.freeze({ BASE: 1, OFFLINE: 10, OVERLAY: 20 });

/** Familles de fonds, dans l'ordre du menu. */
const FOND_KINDS = Object.freeze([
    { kind: 'sat', label: 'Satellite' },
    { kind: 'carto', label: 'Cartes' },
]);

/**
 * Anciens fonds composites (jusqu'à la v23.50) → le fond et les surcouches qui
 * les redonnent. Sert à relire un choix fait sous l'ancien identifiant.
 */
const FONDS_LEGACY_BASES = Object.freeze({
    ign_ign_hybrid: { base: 'ign_ortho', overlays: ['ign_routes'] },
    ign_google_hybrid: { base: 'ign_ortho', overlays: ['google_routes'] },
    google_hybrid: { base: 'google_satellite', overlays: ['google_routes_poi'] },
    google_hybrid_NOPOI: { base: 'google_satellite', overlays: ['google_routes'] },
    yandex_hybrid: { base: 'yandex_satellite', overlays: ['yandex_routes'] },
    emodnet_bathy: { base: 'osm_standard', overlays: ['emodnet_contours'] },
    igc_carrieres: { base: 'osm_standard', overlays: ['igc_atlas'] },
    // Eaux intérieures sans licence i-Boating : Plan IGN et amers OpenSeaMap.
    ...(INLAND_LICENSED ? {} : { inland_waters: { base: 'ign_public_hybrid', overlays: ['openseamap'] } }),
});

/** Identifiant de fond actuel pour un identifiant peut-être ancien. */
const fondsCurrentBaseId = id => FONDS_LEGACY_BASES[id]?.base || id;

/**
 * Surcouches après avoir coché (`on`) ou décoché une surcouche. Cocher une
 * surcouche décoche celles de son `group` (deux variantes du même dessin), et
 * une surcouche de routes (`roads`) décoche l'autre surcouche de routes.
 * L'ordre rendu est celui du catalogue, quel que soit l'ordre des clics.
 * @param {string[]} current   surcouches cochées
 * @param {string}   id        surcouche visée
 * @param {boolean}  on
 * @param {Array<{id: string, group?: string, roads?: boolean}>} catalogue
 */
function fondsToggleOverlay(current, id, on, catalogue) {
    const entry = catalogue.find(o => o.id === id);
    if (!entry) return [...current];
    let next = current.filter(x => x !== id);
    if (on) {
        if (entry.group) next = next.filter(x => catalogue.find(o => o.id === x)?.group !== entry.group);
        // Une seule surcouche de routes : deux réseaux superposés se brouillent.
        if (entry.roads) next = next.filter(x => !catalogue.find(o => o.id === x)?.roads);
        next.push(id);
    }
    const rank = new Map(catalogue.map((o, i) => [o.id, i]));
    return next.filter(x => rank.has(x)).sort((a, b) => rank.get(a) - rank.get(b));
}

const FONDS_STORAGE_KEY = 'cjmt.fonds';

/**
 * Premier lancement, comme CadoTour : Google Satellite, avec d'office sa
 * surcouche « Routes Google + POI » (règle des routes, plus bas). Un choix
 * retenu — même « aucune surcouche » — l'emporte.
 */
const FONDS_DEFAULT_BASE = 'google_satellite';

// ── Surcouche de routes (comme CadoTour 1.53.404 et 1.53.438) ──────────────
// Deux réseaux de routes superposés (celui d'une carte et celui d'une
// surcouche, ou deux surcouches) se brouillent.
//   • Sur un fond SATELLITE, sa surcouche de routes (`roads` du fond) s'affiche
//     d'office — c'est le mode automatique.
//   • Une surcouche de routes cochée ou décochée À LA MAIN devient le choix,
//     sur ce fond seulement (« aucune » aussi) : il est retenu d'une visite à l'autre.
//   • Choisir un fond — un autre satellite, une carte — efface ce choix : un
//     satellite choisi reprend toujours sa propre surcouche de routes.
//   • Sur une CARTE, qui a déjà ses routes, aucune surcouche de routes.
// Les autres surcouches (sans `roads`) ne sont pas concernées.
// `roads` de l'état : null = automatique ; '' = aucune, choisie ; un identifiant = choisie.

const _fondsRoadIds = overlays => new Set(overlays.filter(o => o.roads).map(o => o.id));

/** Surcouche de routes à afficher sur ce fond, ou null. `base` : { kind, roads }. */
function fondsRoadOverlayFor(base, roads, overlays) {
    if (base?.kind !== 'sat') return null;
    if (roads === '') return null;
    if (roads && _fondsRoadIds(overlays).has(roads)) return roads;
    return base.roads && _fondsRoadIds(overlays).has(base.roads) ? base.roads : null;
}

/** Surcouches une fois la règle des routes appliquée au fond : les autres surcouches restent. */
function fondsWithRoadRule(current, base, roads, overlays) {
    const ids = _fondsRoadIds(overlays);
    const route = fondsRoadOverlayFor(base, roads, overlays);
    const next = current.filter(id => !ids.has(id));
    return route ? fondsToggleOverlay(next, route, true, overlays) : next;
}

/**
 * État après le choix d'un fond : le choix manuel de surcouche de routes est
 * effacé, la surcouche du fond reprend (satellite) ou la route part (carte).
 * Les autres surcouches restent.
 * @param {{ overlays: string[] }} state
 * @param {{ kind?: string, roads?: string|null }} base  le fond choisi
 * @param {Array<{id: string, group?: string, roads?: boolean}>} overlays catalogue
 */
function fondsAfterBaseChosen(state, base, overlays) {
    return { ...state, overlays: fondsWithRoadRule(state.overlays, base, null, overlays), roads: null };
}

/**
 * Choix retenu ramené au catalogue, règle des routes appliquée : un fond qui
 * existe (sinon `fallback`), des surcouches connues, une seule par groupe. Un
 * ancien fond composite redonne son fond et ses surcouches.
 * Choix antérieur à la règle (sans `roads`) : sur un satellite, la surcouche de
 * routes cochée reste — choix manuel si ce n'est pas celle du fond, « aucune »
 * si rien n'était coché ; sur une carte, automatique (elle est retirée).
 * @param {*} raw  { base, overlays, roads } lu du stockage
 * @param {{ bases: Array<string|{id: string, kind?: string, roads?: string|null}>, overlays: Array<{id: string, group?: string, roads?: boolean}>, fallback: string }} catalogue
 */
function fondsNormalizeState(raw, { bases, overlays, fallback }) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const infos = new Map(bases.map(b => (typeof b === 'string' ? [b, { id: b }] : [b.id, b])));
    const legacy = FONDS_LEGACY_BASES[o.base];
    const base = infos.has(fondsCurrentBaseId(o.base)) ? fondsCurrentBaseId(o.base) : fallback;
    const info = infos.get(base) || { id: base };
    let chosen = [];
    const retained = Array.isArray(o.overlays) ? o.overlays : [];
    for (const id of [...retained, ...(legacy?.overlays || [])]) if (typeof id === 'string') chosen = fondsToggleOverlay(chosen, id, true, overlays);
    const ids = _fondsRoadIds(overlays);
    let roads = null;
    if (typeof o.roads === 'string' && (o.roads === '' || ids.has(o.roads))) roads = o.roads;
    else if (!('roads' in o) && info.kind === 'sat' && (Array.isArray(o.overlays) || legacy)) {
        const cochee = chosen.find(id => ids.has(id));
        roads = cochee ? (cochee === info.roads ? null : cochee) : '';
    }
    return { base, overlays: fondsWithRoadRule(chosen, info, roads, overlays), roads };
}

// Catalogue proposé sur ce poste (clés de config.private.js), relu à chaque
// fois : une entrée ajoutée en cours de route (essais) y figure aussitôt.
function fondsCatalogue() {
    const bases = (typeof MAP_LAYERS !== 'undefined' ? MAP_LAYERS : []).filter(mapLayerAvailable);
    const overlays = (typeof MAP_OVERLAYS !== 'undefined' ? MAP_OVERLAYS : []).filter(mapLayerAvailable);
    const ids = bases.map(b => b.id);
    const fallback = ids.includes(FONDS_DEFAULT_BASE) ? FONDS_DEFAULT_BASE : ids[0];
    return { bases, overlays, normalize: raw => fondsNormalizeState(raw, { bases, overlays, fallback }) };
}

let _fondsState = null;
const _fondsListeners = new Set();

/** Fond et surcouches choisis : { base, overlays, roads } (`roads` : règle des routes, plus haut). */
function fondsState() {
    if (!_fondsState) {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(FONDS_STORAGE_KEY) || 'null'); } catch (e) { /* illisible ou indisponible : défauts */ }
        _fondsState = fondsCatalogue().normalize(raw);
    }
    return { base: _fondsState.base, overlays: [..._fondsState.overlays], roads: _fondsState.roads };
}

/**
 * Change le choix ({ base?, overlays? }, le reste est gardé ; un ancien
 * identifiant composite est accepté), le retient et l'applique à toutes les cartes.
 * Règle des routes : un autre fond efface le choix manuel de surcouche de routes
 * et reprend la sienne ; une liste de surcouches dont la route change en fait le
 * choix manuel (« aucune » comprise), comme une case cochée à la main.
 */
function fondsSet(next) {
    const current = fondsState();
    const { bases, overlays, normalize } = fondsCatalogue();
    let wanted;
    if (FONDS_LEGACY_BASES[next.base] && !next.overlays) {
        // Ancien fond composite : son fond et ses surcouches, comme à la relecture.
        wanted = { base: next.base, overlays: [] };
    } else {
        const baseId = fondsCurrentBaseId(next.base ?? current.base);
        wanted = { ...current, base: baseId };
        if (baseId !== current.base) {
            const info = bases.find(b => b.id === baseId) || { id: baseId };
            wanted = { ...fondsAfterBaseChosen(wanted, info, overlays), base: baseId };
        }
        if (next.overlays) {
            let list = [];
            for (const id of next.overlays) list = fondsToggleOverlay(list, id, true, overlays);
            const ids = _fondsRoadIds(overlays);
            const route = list.find(id => ids.has(id)) || '';
            if (route !== (wanted.overlays.find(id => ids.has(id)) || '')) wanted.roads = route;
            wanted.overlays = list;
        }
    }
    _fondsState = normalize(wanted);
    // Une liste donnée (case cochée) s'affiche telle quelle, comme dans CadoTour :
    // une route cochée à la main sur une carte reste jusqu'au fond suivant.
    if (next.overlays) _fondsState.overlays = wanted.overlays;
    try { localStorage.setItem(FONDS_STORAGE_KEY, JSON.stringify(_fondsState)); } catch (e) { /* stockage indisponible */ }
    for (const fn of _fondsListeners) fn(fondsState());
}

/** Suit les changements de choix ; rend de quoi arrêter. */
function fondsSubscribe(fn) {
    _fondsListeners.add(fn);
    return () => _fondsListeners.delete(fn);
}

/**
 * Source de tuiles des exports pour un choix (par défaut, le choix en cours) :
 * une entrée de la même forme que celles du catalogue, dont les `layers` sont
 * ceux du fond puis ceux des surcouches — dans l'ordre où ils se peignent. Zoom
 * maximal : le plus bas des étages, pour qu'aucun ne manque à l'export.
 */
function fondsConfig(state = fondsState()) {
    const { bases, overlays } = fondsCatalogue();
    const base = bases.find(b => b.id === state.base);
    if (!base) return null;
    const over = state.overlays.map(id => overlays.find(o => o.id === id)).filter(Boolean);
    const all = [base, ...over];
    return {
        id: all.map(c => c.id).join('+'),
        name: all.map(c => c.name).join(' + '),
        shortName: all.map(c => c.shortName || c.name).join(' + '),
        attribution: all.map(c => c.attribution).filter(Boolean).join(' &mdash; '),
        maxZoom: Math.min(...all.map(c => c.maxZoom || 19)),
        layers: all.flatMap(c => c.layers),
        base: base.id,
        overlays: over.map(o => o.id),
    };
}

/** Nom de l'entrée du catalogue (fond ou surcouche) à laquelle appartient une couche de `layers`. */
function fondsLayerName(layer) {
    const all = [...(typeof MAP_LAYERS !== 'undefined' ? MAP_LAYERS : []), ...(typeof MAP_OVERLAYS !== 'undefined' ? MAP_OVERLAYS : [])];
    return all.find(c => c.layers.includes(layer))?.name || '';
}

/** Nom du choix en cours, tel que le montre le menu (« Google Satellite + Routes Google + POI »). */
function fondsName(state = fondsState()) {
    return fondsConfig(state)?.name || '';
}

let _fondsControlCount = 0;

/**
 * Menu des fonds posé sur une carte Leaflet : un bouton (le nom du fond affiché)
 * qui ouvre un panneau à deux étages, dans l'ordre où la carte les empile :
 *   • Fond — satellite ou plan : un seul à la fois ;
 *   • Surcouches — routes, noms… : cumulables.
 * Les couches de la carte suivent le choix commun (fondsSet), d'où qu'il vienne.
 * Rend le contrôle Leaflet, déjà ajouté à la carte ; `control.setOffline(nom|null)`
 * dit qu'un .mbtiles remplace fond et surcouches (null : retour en ligne).
 */
function fondsAttach(map, { position = 'topright' } = {}) {
    const uid = ++_fondsControlCount;
    const layers = new Map();   // id → couche Leaflet de CETTE carte, créée au besoin
    const layerOf = (cfg, zIndex) => {
        if (!layers.has(cfg.id)) layers.set(cfg.id, createMapLayer(cfg, { zIndex }));
        return layers.get(cfg.id);
    };
    let offline = null;

    const el = (tag, props = {}, children = []) => {
        const node = Object.assign(document.createElement(tag), props);
        for (const child of children) node.append(child);
        return node;
    };
    const root = el('div', { className: 'map-base-control' });
    const button = el('button', { type: 'button', className: 'map-base-select', title: 'Fonds de carte et surcouches' });
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const panel = el('div', { className: 'map-base-panel hidden' });
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Fonds de carte');
    root.append(button, panel);

    const offlineNote = el('p', { className: 'map-base-note hidden' });
    const baseSection = el('section', { className: 'map-base-section' });
    const overlaySection = el('section', { className: 'map-base-section' });
    panel.append(offlineNote, baseSection, overlaySection);
    const baseInputs = new Map(), overlayInputs = new Map();

    // Le panneau se refait sur le catalogue du moment (une entrée a pu s'y ajouter).
    function build() {
        const { bases, overlays } = fondsCatalogue();
        baseInputs.clear(); overlayInputs.clear();
        baseSection.replaceChildren(el('h3', { textContent: 'Fond' }));
        for (const { kind, label } of FOND_KINDS) {
            const family = bases.filter(b => (b.kind || 'carto') === kind);
            if (!family.length) continue;
            const group = el('div', { className: 'map-base-family' }, [el('h4', { textContent: label })]);
            for (const b of family) {
                const input = el('input', { type: 'radio', name: `map-base-${uid}`, value: b.id });
                input.dataset.base = b.id;
                input.addEventListener('change', () => { if (input.checked) fondsSet({ base: b.id }); });
                baseInputs.set(b.id, input);
                group.append(el('label', { className: 'map-base-row' }, [input, ' ' + b.name]));
            }
            baseSection.append(group);
        }
        overlaySection.replaceChildren(el('h3', { textContent: 'Surcouches' }));
        for (const o of overlays) {
            const input = el('input', { type: 'checkbox', value: o.id });
            input.dataset.overlay = o.id;
            input.addEventListener('change', () => {
                fondsSet({ overlays: fondsToggleOverlay(fondsState().overlays, o.id, input.checked, fondsCatalogue().overlays) });
            });
            overlayInputs.set(o.id, input);
            overlaySection.append(el('label', { className: 'map-base-row' }, [input, ' ' + o.name]));
        }
        overlaySection.classList.toggle('hidden', !overlays.length);
    }

    // Pose sur la carte le fond et les surcouches retenus, retire les autres. Un
    // .mbtiles chargé les retire tous.
    function apply() {
        const state = fondsState();
        const { bases, overlays } = fondsCatalogue();
        for (const b of bases) {
            const wanted = !offline && b.id === state.base;
            const layer = wanted || layers.has(b.id) ? layerOf(b, FONDS_STACK_Z.BASE) : null;
            if (!layer) continue;
            if (wanted && !map.hasLayer(layer)) layer.addTo(map);
            else if (!wanted && map.hasLayer(layer)) map.removeLayer(layer);
        }
        for (const o of overlays) {
            const wanted = !offline && state.overlays.includes(o.id);
            const layer = wanted || layers.has(o.id) ? layerOf(o, FONDS_STACK_Z.OVERLAY) : null;
            if (!layer) continue;
            if (wanted && !map.hasLayer(layer)) layer.addTo(map);
            else if (!wanted && map.hasLayer(layer)) map.removeLayer(layer);
        }
        if (baseInputs.size !== bases.length || overlayInputs.size !== overlays.length) build();
        const name = offline ? `📦 ${offline}` : (bases.find(b => b.id === state.base)?.name || '');
        button.textContent = name;
        root.dataset.fond = name;
        for (const [id, input] of baseInputs) input.checked = id === state.base;
        for (const [id, input] of overlayInputs) input.checked = state.overlays.includes(id);
        offlineNote.textContent = offline
            ? `Fichier carto « ${offline} » affiché : il remplace le fond et les surcouches, à l'écran comme à l'export. Le choix ci-dessous revient à sa fermeture.`
            : '';
        offlineNote.classList.toggle('hidden', !offline);
        map.fire('fondschange', { state, config: fondsConfig(state), offline });
    }

    // Ouverture et fermeture du panneau : clic sur le bouton, à côté, ou Échap.
    const setOpen = open => {
        panel.classList.toggle('hidden', !open);
        button.setAttribute('aria-expanded', String(open));
        if (open) {
            // La carte du carroyage rapide déborde de son cadre (rotation) : le
            // panneau se borne à la partie visible de la carte.
            const frame = map.getContainer().closest('#map-viewport') || map.getContainer();
            const room = frame.getBoundingClientRect().bottom - panel.getBoundingClientRect().top - 8;
            panel.style.maxHeight = room > 120 ? `${Math.min(room, 560)}px` : '';
        }
    };
    button.addEventListener('click', () => setOpen(panel.classList.contains('hidden')));
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) setOpen(false); }, true);
    root.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); button.focus(); } });

    build();
    fondsSubscribe(apply);

    const FondsControl = L.Control.extend({
        options: { position },
        onAdd() {
            L.DomEvent.disableClickPropagation(root);
            L.DomEvent.disableScrollPropagation(root);
            root.classList.add('leaflet-control');
            return root;
        },
    });
    const control = new FondsControl();
    control.addTo(map);
    // Le fond se pose après l'événement load (cf. index.html) : ses tuiles ne
    // retiennent pas la page « en cours de chargement ».
    if (document.readyState === 'complete') apply();
    else window.addEventListener('load', apply, { once: true });

    /** Un .mbtiles remplace fond et surcouches (son nom), ou plus rien (null). */
    control.setOffline = name => { offline = name || null; apply(); };
    /** Couches Leaflet en ligne de cette carte, déjà créées. */
    control.onlineLayers = () => [...layers.values()].filter(Boolean);
    control.open = () => setOpen(true);
    return control;
}

Object.assign(window, {
    FONDS_STACK_Z, FOND_KINDS, FONDS_LEGACY_BASES, FONDS_STORAGE_KEY, FONDS_DEFAULT_BASE,
    fondsCurrentBaseId, fondsToggleOverlay, fondsRoadOverlayFor, fondsWithRoadRule, fondsAfterBaseChosen,
    fondsNormalizeState, fondsCatalogue,
    fondsState, fondsSet, fondsSubscribe, fondsConfig, fondsName, fondsLayerName, fondsAttach,
});

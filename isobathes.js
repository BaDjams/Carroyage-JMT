// isobathes.js — lignes de profondeur (isobathes) calculées dans le navigateur.
//
// L'utilisateur coche « Ajouter les lignes de profondeur aquatiques » dans l'un
// des trois modes. L'application va alors chercher elle-même, pour la zone
// demandée, les altitudes du RGE ALTI® de l'IGN, puis trace les courbes de
// niveau situées sous le zéro choisi.
//
// Pourquoi le RGE ALTI : le long des côtes, ce MNT au pas de 1 m intègre la
// partie marine du lidar bathymétrique Litto3D® (IGN-SHOM). C'est la seule
// source de profondeurs métriques qu'un navigateur puisse interroger lui-même :
// la Géoplateforme sert les altitudes brutes (flottants 32 bits, format BIL).
// Au-delà de l'emprise du lidar, au large, le MNT n'a plus de valeur et aucune
// ligne n'est tracée ; sur un lac, il porte la surface de l'eau, à plat.
//
// Référence verticale : les altitudes IGN partent du zéro NGF-IGN69 en
// métropole, proche du niveau moyen de la mer, et non du zéro hydrographique
// des cartes marines, situé plusieurs mètres plus bas là où la marée est forte.
// Quand l'utilisateur indique de combien le zéro hydrographique local est sous
// le zéro NGF (tables RAM du SHOM), les profondeurs y sont ramenées. Sinon,
// elles restent comptées sous le zéro NGF, et l'interface le dit.
//
// Services employés, relevés dans la configuration officielle du Géoportail
// (dépôt IGNF/geoportal-configuration) :
// - WMS raster https://data.geopf.fr/wms-r/wms, couches
//   RGEALTI-MNT_PYR-ZIP_<territoire>_…_WMS : RGE ALTI natif au pas de 1 m,
//   format image/x-bil;bits=32. Elles refusent les échelles plus fines que
//   1:3571, soit 1 m par pixel ;
// - WMTS https://data.geopf.fr/wmts, couche ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES,
//   même format, grille WGS84G niveaux 6 à 14 (~4,8 m par pixel au niveau 14).
//   C'est la couche d'altitude de la vue 3D iTowns de l'IGN. Elle sert de
//   secours si le WMS ne répond pas.

const ISOBATH_MIN_ZOOM = 11;               // en deçà, l'équidistance lisible dépasse les profondeurs du lidar
const ISOBATH_WMS_URL = 'https://data.geopf.fr/wms-r/wms';
const ISOBATH_WMTS_URL = 'https://data.geopf.fr/wmts';
const ISOBATH_WMTS_LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
// Nom du jeu de matrices : iTowns emploie « WGS84G », la configuration du
// Géoportail annonce « WGS84G_6_14 ». Les deux décrivent la même grille ; le
// second n'est essayé que si le premier est refusé.
const ISOBATH_WMTS_TMS = ['WGS84G', 'WGS84G_6_14'];
const ISOBATH_WMTS_LEVEL_MIN = 6;
const ISOBATH_WMTS_LEVEL_MAX = 14;
const ISOBATH_BIL_FORMAT = 'image/x-bil;bits=32';

// Emprises (degrés) des couches WMS du RGE ALTI natif, une par territoire.
// Celle de la Guadeloupe est corrigée : la configuration IGN en publie une
// fausse (-19° à 131° de longitude). Elle couvre aussi Saint-Martin et
// Saint-Barthélemy, dans le même système UTM 20.
const ISOBATH_TERRITORIES = [
    { code: 'FXX', layer: 'RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WMS', bbox: [-5.33, 41.31, 9.67, 51.13] },
    { code: 'GLP', layer: 'RGEALTI-MNT_PYR-ZIP_GLP_WGS84UTM20_WMS', bbox: [-63.2, 15.8, -60.9, 18.2] },
    { code: 'MTQ', layer: 'RGEALTI-MNT_PYR-ZIP_MTQ_WGS84UTM20_WMS', bbox: [-61.25, 14.37, -60.79, 14.89] },
    { code: 'GUF', layer: 'RGEALTI-MNT_PYR-ZIP_GUF_UTM22RGFG95_WMS', bbox: [-54.65, 2.07, -51.6, 5.79] },
    { code: 'REU', layer: 'RGEALTI-MNT_PYR-ZIP_REU_RGR92UTM40S_WMS', bbox: [55.19, -21.41, 55.85, -20.84] },
    { code: 'MYT', layer: 'RGEALTI-MNT_PYR-ZIP_MYT_RGM04UTM38S_WMS', bbox: [44.97, -13.01, 45.31, -12.62] },
    { code: 'SPM', layer: 'RGEALTI-MNT_PYR-ZIP_SPM_RGSPM06U21_WMS', bbox: [-56.53, 46.74, -56.07, 47.16] },
];

// Plus fine résolution demandée. Au WMS : 1 m par pixel Mercator au plus fin,
// limite d'échelle des couches (2 % de marge). Au sol : 1,2 m, pour ne pas
// suréchantillonner un MNT au pas de 1 m. En métropole, cela revient à
// s'arrêter au zoom 16 (1,6 m au sol) ; les zooms plus forts réemploient cette
// grille.
const ISOBATH_WMS_MIN_RES = 1.02;
const ISOBATH_GROUND_MIN_RES = 1.2;
const ISOBATH_MARGIN = 8;                  // pixels lus autour de la zone : lignes continues d'une tuile à l'autre
const ISOBATH_BLOCK = 480;                 // côté des blocs demandés pour une image
const ISOBATH_LAND_MARGIN = 30;            // tuile à plus de 30 m au-dessus du zéro : ses sous-tuiles ne sont pas demandées
const ISOBATH_NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

// Traits (en pixels, multipliés par l'échelle de trait de l'export) et couleurs,
// les mêmes que tools/bathy_mbtiles.py.
const ISOBATH_STYLES = {
    normal: { color: 'rgba(74, 116, 168, 0.78)', width: 1.0 },
    master: { color: 'rgba(38, 82, 138, 0.92)', width: 1.7 },
    zero: { color: 'rgb(20, 45, 80)', width: 2.2 },
};
const ISOBATH_LABEL_COLOR = 'rgb(30, 62, 110)';
const ISOBATH_HALO_COLOR = 'rgba(255, 255, 255, 0.92)';

const _ISO_R = 6378137;
const _ISO_HALF = Math.PI * _ISO_R;

function _isoTileSpan(z) { return 2 * _ISO_HALF / Math.pow(2, z); }
function _isoLon(x) { return x / _ISO_R * 180 / Math.PI; }
function _isoLat(y) { return (2 * Math.atan(Math.exp(y / _ISO_R)) - Math.PI / 2) * 180 / Math.PI; }
function _isoY(lat) { return _ISO_R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }

// Emprise EPSG:3857 [ouest, sud, est, nord] d'une tuile XYZ.
function isobathTileBounds(z, x, y) {
    const t = _isoTileSpan(z);
    const west = -_ISO_HALF + x * t;
    const north = _ISO_HALF - y * t;
    return [west, north - t, west + t, north];
}

// Résolution (m Mercator par pixel) la plus fine qu'on demande à cette latitude.
function isobathMinResolution(latDeg) {
    return Math.max(ISOBATH_WMS_MIN_RES, ISOBATH_GROUND_MIN_RES / Math.cos(latDeg * Math.PI / 180));
}

// ---------------------------------------------------------------------------
// Équidistance, niveaux, textes
// ---------------------------------------------------------------------------

function _isoMultiple(v, step) {
    const q = v / step;
    return Math.abs(q - Math.round(q)) < 1e-6;
}

// Équidistance lisible selon la taille du pixel au sol : [pixel maximal (m),
// équidistance (m)]. Sur toute la métropole (latitudes 41 à 51°), cela donne
// 1 m au zoom 16, 2,5 m au 15, 5 m au 14, 10 m au 13, 25 m au 12, 50 m au 11.
const ISOBATH_LEGIBLE = [[1.9, 1], [4.5, 2.5], [9, 5], [18, 10], [45, 25], [90, 50]];

function isobathLegibleStep(groundMetersPerPixel) {
    const row = ISOBATH_LEGIBLE.find(([px]) => groundMetersPerPixel <= px);
    return row ? row[1] : 100;
}

// Équidistance effective : celle que l'utilisateur a choisie, élargie si elle
// serait illisible à cette échelle.
function isobathStep(settings, groundMetersPerPixel) {
    return Math.max(settings.finestStep || 1, isobathLegibleStep(groundMetersPerPixel));
}

// Isobathe maîtresse, épaissie et cotée : 5 m pour un pas de 1 m, 10 m pour 2,5 m…
function isobathMasterStep(step) {
    return ISOBATH_NICE.find(p => p >= 4 * step - 1e-9 && _isoMultiple(p, step)) ?? step * 5;
}

// Altitude IGN du zéro des profondeurs : 0 (zéro NGF) ou le zéro hydrographique
// saisi, toujours compté sous le zéro NGF.
function isobathDatum(settings) {
    const below = Number(settings && settings.chartDatumBelowNgf);
    return Number.isFinite(below) && below !== 0 ? -Math.abs(below) : 0;
}

// Niveaux à tracer pour une grille dont les altitudes vont de minAlt à maxAlt :
// le zéro s'il est atteint, puis chaque multiple du pas jusqu'au plus profond.
// Renvoie [{ alt, depth }] par altitude croissante (des plus profonds au zéro).
function isobathLevels(minAlt, maxAlt, step, datum) {
    const maxDepth = datum - minAlt;
    if (!(maxDepth >= 0)) return [];
    const minDepth = Math.max(0, datum - maxAlt);
    const k0 = Math.ceil(minDepth / step - 1e-9);
    const k1 = Math.floor(maxDepth / step + 1e-9);
    const levels = [];
    for (let k = k1; k >= k0; k--) {
        const depth = Math.round(k * step * 1000) / 1000;
        levels.push({ alt: datum - depth, depth });
    }
    return levels;
}

// Profondeur à la française : « 5 », « 2,5 ».
function isobathDepthText(d) {
    if (Math.abs(d - Math.round(d)) < 1e-9) return String(Math.round(d));
    return d.toFixed(1).replace('.', ',');
}

function _isoNumberFr(v) {
    return String(Math.round(v * 100) / 100).replace('.', ',');
}

// Référence des profondeurs, en clair.
function isobathReferenceText(settings) {
    const datum = isobathDatum(settings);
    if (datum === 0) return 'sous le zéro NGF-IGN69 (niveau moyen approché, pas le zéro des cartes marines)';
    return `sous le zéro hydrographique, pris à ${_isoNumberFr(-datum)} m sous le zéro NGF-IGN69`;
}

// Ligne courte pour un cartouche ou une légende.
function isobathShortText(settings, step) {
    const datum = isobathDatum(settings);
    const ref = datum === 0 ? 'sous zéro NGF' : `sous ZH (${_isoNumberFr(-datum)} m sous NGF)`;
    return `Isobathes IGN (m) : ${ref}, équid. ${isobathDepthText(step)} m`;
}

// ---------------------------------------------------------------------------
// Lecture des altitudes
// ---------------------------------------------------------------------------

// État partagé par toutes les demandes d'un même export : santé des services,
// cache WMTS, élagage des tuiles, bilan.
function createIsobathState(signal = null) {
    return {
        signal,
        wms: { failures: 0, disabled: false },
        wmts: { failures: 0, successes: 0, disabled: false, tms: 0 },
        wmtsCache: new Map(),
        classes: new Map(),
        stats: {
            requests: 0, bytes: 0, failed: 0, skipped: 0, withLines: 0, outside: 0,
            sources: new Set(), lastError: '',
        },
    };
}

function _isoValid(v) {
    // -99999 marque l'absence de donnée ; aucune altitude française ne sort de cet intervalle.
    return v > -12000 && v < 9000;
}

function _isoSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class IsobathServiceError extends Error {}

// GET binaire avec deux nouvelles tentatives sur les erreurs passagères
// (429, 5xx, coupure réseau). Une réponse XML ou HTML est une exception de
// service, jamais des altitudes.
async function _isoFetchBinary(url, state) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await _isoSleep(600 * Math.pow(2, attempt - 1));
        let res;
        try {
            res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: state.signal || undefined });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            lastError = new IsobathServiceError(`réseau : ${e && e.message ? e.message : e}`);
            continue;
        }
        state.stats.requests++;
        if (res.status === 429 || res.status >= 500) {
            lastError = new IsobathServiceError(`HTTP ${res.status}`);
            continue;
        }
        const type = res.headers.get('content-type') || '';
        const buf = await res.arrayBuffer();
        state.stats.bytes += buf.byteLength;
        if (!res.ok) {
            const err = new IsobathServiceError(`HTTP ${res.status}`);
            err.status = res.status;
            throw err;
        }
        if (/xml|html|text\//i.test(type)) {
            const texte = new TextDecoder().decode(buf.slice(0, 400)).replace(/\s+/g, ' ').trim();
            throw new IsobathServiceError(`réponse ${type} : ${texte}`);
        }
        return buf;
    }
    throw lastError || new IsobathServiceError('échec');
}

// Décode une réponse BIL 32 bits en altitudes (NaN hors donnée). Le serveur
// écrit en petit-boutiste ; si la grille paraît absurde, l'autre ordre est
// essayé avant de conclure.
function decodeIsobathBil(buf, nx, ny) {
    const n = nx * ny;
    if (buf.byteLength !== n * 4) {
        throw new IsobathServiceError(`BIL de ${buf.byteLength} octets pour une grille ${nx} × ${ny}`);
    }
    const dv = new DataView(buf);
    // Un flottant lu dans le mauvais ordre d'octets donne presque toujours une
    // valeur minuscule (1e-40) ou démesurée : aucune altitude n'y ressemble. Les
    // marqueurs d'absence (-99999, ±3,4e38, NaN) ne comptent pas.
    const decode = (little) => {
        const out = new Float32Array(n);
        let absurd = 0;
        for (let i = 0; i < n; i++) {
            const v = dv.getFloat32(i * 4, little);
            const a = Math.abs(v);
            if ((v !== 0 && a < 1e-6) || (a > 1e5 && a < 1e30)) absurd++;
            out[i] = _isoValid(v) && !(v !== 0 && a < 1e-6) ? v : NaN;
        }
        return { out, absurd };
    };
    const le = decode(true);
    if (le.absurd <= n * 0.25) return le.out;
    const be = decode(false);
    return be.absurd < le.absurd ? be.out : le.out;
}

function _isoTerritories(bounds) {
    const w = _isoLon(bounds[0]), e = _isoLon(bounds[2]);
    const s = _isoLat(bounds[1]), n = _isoLat(bounds[3]);
    return ISOBATH_TERRITORIES.filter(t => w < t.bbox[2] && e > t.bbox[0] && s < t.bbox[3] && n > t.bbox[1]);
}

function _isoFixed(v) { return (Math.round(v * 1000) / 1000).toFixed(3); }

async function _isoWmsGrid(layer, bounds, nx, ny, state) {
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.3.0',
        REQUEST: 'GetMap',
        LAYERS: layer,
        STYLES: '',
        CRS: 'EPSG:3857',
        BBOX: bounds.map(_isoFixed).join(','),
        WIDTH: String(nx),
        HEIGHT: String(ny),
        FORMAT: ISOBATH_BIL_FORMAT,
    });
    const buf = await _isoFetchBinary(`${ISOBATH_WMS_URL}?${params}`, state);
    return decodeIsobathBil(buf, nx, ny);
}

// Tuile WMTS WGS84G (256 × 256 altitudes) ou null si hors de la pyramide.
async function _isoWmtsTile(level, col, row, state) {
    const tms = ISOBATH_WMTS_TMS[state.wmts.tms];
    const key = `${tms}/${level}/${col}/${row}`;
    if (state.wmtsCache.has(key)) {
        const hit = state.wmtsCache.get(key);
        state.wmtsCache.delete(key);          // LRU : remis en fin de file
        state.wmtsCache.set(key, hit);
        return hit;
    }
    const params = new URLSearchParams({
        SERVICE: 'WMTS',
        REQUEST: 'GetTile',
        VERSION: '1.0.0',
        LAYER: ISOBATH_WMTS_LAYER,
        STYLE: 'normal',
        TILEMATRIXSET: tms,
        TILEMATRIX: String(level),
        TILEROW: String(row),
        TILECOL: String(col),
        FORMAT: ISOBATH_BIL_FORMAT,
    });
    let data = null;
    try {
        data = decodeIsobathBil(await _isoFetchBinary(`${ISOBATH_WMTS_URL}?${params}`, state), 256, 256);
        state.wmts.successes++;
    } catch (e) {
        // Hors des limites de la pyramide (au large, hors territoire), le WMTS
        // répond 400 ou 404 : pas d'altitude, sans que le service soit en cause.
        if (!(e instanceof IsobathServiceError) || !(e.status === 400 || e.status === 404)) throw e;
        if (!state.wmts.successes) throw e;
    }
    state.wmtsCache.set(key, data);
    if (state.wmtsCache.size > 64) state.wmtsCache.delete(state.wmtsCache.keys().next().value);
    return data;
}

// Grille demandée au WMTS WGS84G, rééchantillonnée (bilinéaire) aux centres
// des pixels de la grille Mercator voulue.
async function _isoWmtsGrid(bounds, nx, ny, state) {
    const res = (bounds[2] - bounds[0]) / nx;
    const latC = _isoLat((bounds[1] + bounds[3]) / 2);
    const degPerPx = res * Math.cos(latC * Math.PI / 180) / 111319.49;
    let level = Math.ceil(Math.log2(0.703125 / degPerPx));
    level = Math.min(ISOBATH_WMTS_LEVEL_MAX, Math.max(ISOBATH_WMTS_LEVEL_MIN, level));
    const rl = 0.703125 / Math.pow(2, level);           // degrés par pixel WGS84G

    const us = new Float64Array(nx), vs = new Float64Array(ny);
    for (let i = 0; i < nx; i++) us[i] = (_isoLon(bounds[0] + (i + 0.5) * res) + 180) / rl - 0.5;
    for (let j = 0; j < ny; j++) vs[j] = (90 - _isoLat(bounds[3] - (j + 0.5) * res)) / rl - 0.5;
    const c0 = Math.floor(Math.floor(us[0]) / 256), c1 = Math.floor((Math.floor(us[nx - 1]) + 1) / 256);
    const r0 = Math.floor(Math.floor(vs[0]) / 256), r1 = Math.floor((Math.floor(vs[ny - 1]) + 1) / 256);

    const mw = (c1 - c0 + 1) * 256, mh = (r1 - r0 + 1) * 256;
    const mosaic = new Float32Array(mw * mh).fill(NaN);
    let any = false;
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const tile = await _isoWmtsTile(level, c, r, state);
            if (!tile) continue;
            any = true;
            for (let y = 0; y < 256; y++) {
                mosaic.set(tile.subarray(y * 256, y * 256 + 256), ((r - r0) * 256 + y) * mw + (c - c0) * 256);
            }
        }
    }
    const out = new Float32Array(nx * ny).fill(NaN);
    if (!any) return out;
    const u0 = c0 * 256, v0 = r0 * 256;
    const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh) ? NaN : mosaic[y * mw + x];
    for (let j = 0; j < ny; j++) {
        const v = vs[j] - v0, y0 = Math.floor(v), fy = v - y0;
        for (let i = 0; i < nx; i++) {
            const u = us[i] - u0, x0 = Math.floor(u), fx = u - x0;
            const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
            if (a === a && b === b && c === c && d === d) {
                out[j * nx + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
            } else {
                out[j * nx + i] = at(Math.round(u), Math.round(v));
            }
        }
    }
    return out;
}

// Altitudes aux centres d'une grille nx × ny couvrant l'emprise EPSG:3857
// [ouest, sud, est, nord]. Renvoie { values } (NaN hors donnée),
// { outside: true } hors des territoires IGN, ou lève une erreur si aucun
// service n'a répondu.
async function fetchIsobathGrid(bounds, nx, ny, state) {
    const territories = _isoTerritories(bounds);
    if (!territories.length) return { outside: true };

    if (!state.wms.disabled) {
        try {
            let values = null;
            for (const t of territories) {
                const g = await _isoWmsGrid(t.layer, bounds, nx, ny, state);
                if (!values) values = g;
                else for (let i = 0; i < g.length; i++) if (!(values[i] === values[i])) values[i] = g[i];
            }
            state.wms.failures = 0;
            state.stats.sources.add('wms');
            return { values };
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            state.stats.lastError = `WMS : ${e.message}`;
            // Trois échecs de suite : le WMS est tenu pour indisponible (CORS,
            // couche renommée…) et le reste de l'export passe par le WMTS.
            if (++state.wms.failures >= 3) state.wms.disabled = true;
        }
    }
    while (!state.wmts.disabled) {
        try {
            const values = await _isoWmtsGrid(bounds, nx, ny, state);
            state.wmts.failures = 0;
            state.stats.sources.add('wmts');
            return { values };
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            state.stats.lastError = `WMTS : ${e.message}`;
            if (++state.wmts.failures < 3) break;
            // Trois refus sans un seul succès : on essaie l'autre nom de grille,
            // puis on renonce au WMTS.
            state.wmts.failures = 0;
            if (state.wmts.successes || ++state.wmts.tms >= ISOBATH_WMTS_TMS.length) state.wmts.disabled = true;
        }
    }
    throw new IsobathServiceError(state.stats.lastError || 'services IGN indisponibles');
}

// ---------------------------------------------------------------------------
// Courbes de niveau (marching squares)
// ---------------------------------------------------------------------------

function _isoFirstAbove(levels, v) {
    let lo = 0, hi = levels.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (levels[mid] > v) hi = mid; else lo = mid + 1;
    }
    return lo;
}

// Courbes de niveau d'une grille de valeurs aux centres des pixels : le point
// (i, j) est le centre du pixel i de la ligne j. `levels` : altitudes par ordre
// croissant. Une maille dont un coin manque n'est pas traitée, de sorte qu'aucune
// ligne ne longe le bord des données. Renvoie, par niveau, des polylignes
// { pts: [x0, y0, x1, y1, …], closed } en coordonnées de grille.
function isobathContours(values, nx, ny, levels) {
    const nl = levels.length;
    const segs = Array.from({ length: nl }, () => []);
    if (!nl) return segs;
    for (let j = 0; j < ny - 1; j++) {
        const row = j * nx, row2 = row + nx;
        for (let i = 0; i < nx - 1; i++) {
            const a = values[row + i], b = values[row + i + 1];
            const c = values[row2 + i + 1], d = values[row2 + i];
            if (!(a === a && b === b && c === c && d === d)) continue;
            const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
            for (let k = _isoFirstAbove(levels, lo); k < nl && levels[k] <= hi; k++) {
                const L = levels[k];
                const idx = (a >= L ? 1 : 0) | (b >= L ? 2 : 0) | (c >= L ? 4 : 0) | (d >= L ? 8 : 0);
                const s = segs[k];
                const cas = _ISO_CASES[idx];
                if (cas) {
                    _isoEdge(s, cas[0], L, i, j, row, row2, a, b, c, d);
                    _isoEdge(s, cas[1], L, i, j, row, row2, a, b, c, d);
                } else {
                    // Col (5 : a et c hauts ; 10 : b et d hauts) : la moyenne des
                    // quatre coins dit si les coins hauts communiquent par le centre.
                    const order = ((idx === 5) === ((a + b + c + d) / 4 >= L)) ? _ISO_SADDLE_LOW : _ISO_SADDLE_HIGH;
                    for (const e of order) _isoEdge(s, e, L, i, j, row, row2, a, b, c, d);
                }
            }
        }
    }
    return segs.map(_isoJoin);
}

// Arêtes coupées par cas (bit 1 : a, coin haut gauche ; 2 : b, haut droit ;
// 4 : c, bas droit ; 8 : d, bas gauche). Arêtes : 0 haut, 1 droite, 2 bas,
// 3 gauche. Les cols 5 et 10 sont tranchés à part.
const _ISO_CASES = [null, [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [2, 3],
    [2, 3], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0], null];
const _ISO_SADDLE_LOW = [0, 1, 2, 3];     // isole b (haut-droite) et d (bas-gauche)
const _ISO_SADDLE_HIGH = [3, 0, 1, 2];    // isole a (haut-gauche) et c (bas-droite)

// Point de passage du niveau L sur une arête de la maille (i, j), précédé de
// l'identifiant global de l'arête, qui sert à recoller les segments voisins.
function _isoEdge(s, edge, L, i, j, row, row2, a, b, c, d) {
    switch (edge) {
        case 0: s.push((row + i) * 2, i + (L - a) / (b - a), j); break;
        case 1: s.push((row + i + 1) * 2 + 1, i + 1, j + (L - b) / (c - b)); break;
        case 2: s.push((row2 + i) * 2, i + (L - d) / (c - d), j + 1); break;
        default: s.push((row + i) * 2 + 1, i, j + (L - a) / (d - a)); break;
    }
}

// Recolle des segments [arête, x, y, arête, x, y, …] en polylignes.
function _isoJoin(s) {
    const n = s.length / 6;
    const first = new Map(), second = new Map();
    for (let k = 0; k < n; k++) {
        for (const e of [s[k * 6], s[k * 6 + 3]]) {
            if (first.has(e)) second.set(e, k); else first.set(e, k);
        }
    }
    const other = (e, k) => {
        const f = first.get(e);
        if (f !== k) return f;
        const g = second.get(e);
        return g === undefined ? -1 : g;
    };
    // Extrémité opposée à l'arête e dans le segment k : [arête, x, y].
    const far = (k, e) => s[k * 6] === e ? [s[k * 6 + 3], s[k * 6 + 4], s[k * 6 + 5]] : [s[k * 6], s[k * 6 + 1], s[k * 6 + 2]];
    const used = new Uint8Array(n);
    const lines = [];
    for (let k0 = 0; k0 < n; k0++) {
        if (used[k0]) continue;
        used[k0] = 1;
        const fwd = [s[k0 * 6 + 4], s[k0 * 6 + 5]];
        let closed = false;
        let e = s[k0 * 6 + 3], k = k0;
        for (;;) {
            const t = other(e, k);
            if (t < 0) break;
            if (t === k0) { closed = true; break; }
            if (used[t]) break;
            used[t] = 1;
            const [e2, x2, y2] = far(t, e);
            fwd.push(x2, y2);
            e = e2; k = t;
        }
        const bwd = [];
        if (!closed) {
            e = s[k0 * 6]; k = k0;
            for (;;) {
                const t = other(e, k);
                if (t < 0 || used[t]) break;
                used[t] = 1;
                const [e2, x2, y2] = far(t, e);
                bwd.push(y2, x2);
                e = e2; k = t;
            }
        }
        const pts = bwd.reverse();
        pts.push(s[k0 * 6 + 1], s[k0 * 6 + 2]);
        for (let q = 0; q < fwd.length; q++) pts.push(fwd[q]);
        lines.push({ pts, closed });
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

// Lissage de Chaikin, pour les grilles agrandies (un sommet tous les k pixels) :
// il coupe les angles sans déplacer la ligne de plus d'un quart de maille.
function _isoChaikin(pts, closed, passes) {
    let p = pts;
    for (let pass = 0; pass < passes; pass++) {
        const n = p.length / 2;
        if (n < 3) return p;
        const q = [];
        if (!closed) q.push(p[0], p[1]);
        for (let i = 0; i < n - 1; i++) {
            const x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[2 * i + 2], y1 = p[2 * i + 3];
            q.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
        }
        if (closed) q.push(q[0], q[1]);
        else q.push(p[2 * n - 2], p[2 * n - 1]);
        p = q;
    }
    return p;
}

function _isoLength(p) {
    let l = 0;
    for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return l;
}

// Calcule les isobathes d'une grille et les ramène dans le repère du canevas :
// canevas = (ox + gx·k, oy + gy·k). Renvoie les traits par style et les
// maîtresses candidates à une cote.
function _isoBuild(values, nx, ny, xf, step, datum, lineScale, finestStep) {
    let minAlt = Infinity, maxAlt = -Infinity;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v === v) { if (v < minAlt) minAlt = v; if (v > maxAlt) maxAlt = v; }
    }
    if (minAlt === Infinity) return { empty: true };
    const levels = isobathLevels(minAlt, maxAlt, step, datum);
    const result = { empty: false, minAlt, maxAlt, lines: { normal: [], master: [], zero: [] }, masters: [], count: 0 };
    if (!levels.length) return result;
    const master = isobathMasterStep(step);
    const contours = isobathContours(values, nx, ny, levels.map(l => l.alt));
    const passes = xf.k >= 4 ? 2 : (xf.k >= 2 ? 1 : 0);
    // Aux échelles de vue d'ensemble, une boucle fermée de moins de 12 px n'est
    // qu'un point illisible ; au pas le plus fin, on la garde dès 4 px — une tête
    // de roche est ce qu'un bateau doit voir.
    const minLoop = (step > (finestStep || 1) ? 12 : 4) * lineScale;
    levels.forEach((lvl, idx) => {
        const style = lvl.depth === 0 ? 'zero' : (_isoMultiple(lvl.depth, master) ? 'master' : 'normal');
        for (const line of contours[idx]) {
            const p = new Array(line.pts.length);
            for (let q = 0; q < line.pts.length; q += 2) {
                p[q] = xf.ox + line.pts[q] * xf.k;
                p[q + 1] = xf.oy + line.pts[q + 1] * xf.k;
            }
            if (line.closed && _isoLength(p) < minLoop) continue;
            const pts = passes ? _isoChaikin(p, line.closed, passes) : p;
            result.lines[style].push(pts);
            result.count++;
            if (style === 'master') result.masters.push({ depth: lvl.depth, pts });
        }
    });
    return result;
}

function _isoStroke(ctx, built, lineScale) {
    for (const style of ['normal', 'master', 'zero']) {
        const lines = built.lines[style];
        if (!lines.length) continue;
        ctx.beginPath();
        for (const p of lines) {
            ctx.moveTo(p[0], p[1]);
            for (let q = 2; q < p.length; q += 2) ctx.lineTo(p[q], p[q + 1]);
        }
        ctx.strokeStyle = ISOBATH_STYLES[style].color;
        ctx.lineWidth = ISOBATH_STYLES[style].width * lineScale;
        ctx.stroke();
    }
}

function _isoPointAt(p, cum, s) {
    let i = 1;
    while (i < cum.length && cum[i] < s) i++;
    if (i >= cum.length) return [p[p.length - 2], p[p.length - 1]];
    const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t];
}

// Plus long tronçon d'une polyligne dont tous les sommets sont dans le rectangle.
function _isoLongestInside(p, r) {
    let best = null, bestLen = 0, start = -1;
    const n = p.length / 2;
    for (let i = 0; i <= n; i++) {
        const inside = i < n && p[2 * i] >= r.x0 && p[2 * i] <= r.x1 && p[2 * i + 1] >= r.y0 && p[2 * i + 1] <= r.y1;
        if (inside && start < 0) start = i;
        else if (!inside && start >= 0) {
            if (i - start >= 2) {
                const part = p.slice(2 * start, 2 * i);
                const len = _isoLength(part);
                if (len > bestLen) { best = part; bestLen = len; }
            }
            start = -1;
        }
    }
    return best;
}

// Place les cotes des maîtresses dans l'axe de la ligne, sur un halo blanc qui
// interrompt le trait, sans chevauchement (y compris avec les cotes déjà posées,
// `placed`) ni débord de `area`. `anchorArea` limite où la cote peut se poser.
function _isoLabels(ctx, masters, lineScale, area, anchorArea, placed) {
    if (!masters.length) return;
    const fontPx = Math.round(10 * lineScale);
    const gap = 28 * lineScale;
    const inner = 5 * lineScale;
    const zone = { x0: anchorArea.x0 + inner, y0: anchorArea.y0 + inner, x1: anchorArea.x1 - inner, y1: anchorArea.y1 - inner };
    ctx.save();
    ctx.font = `bold ${fontPx}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const sorted = masters.map(m => ({ ...m, len: _isoLength(m.pts) })).sort((a, b) => b.len - a.len);
    for (const m of sorted) {
        const part = _isoLongestInside(m.pts, zone);
        if (!part) continue;
        const text = isobathDepthText(m.depth);
        const tw = ctx.measureText(text).width;
        const cum = [0];
        for (let i = 2; i < part.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(part[i] - part[i - 2], part[i + 1] - part[i - 1]));
        const total = cum[cum.length - 1];
        if (total < Math.max(tw * 2.5, 64 * lineScale)) continue;
        const mid = total / 2;
        const [px, py] = _isoPointAt(part, cum, mid);
        const [ax, ay] = _isoPointAt(part, cum, Math.max(0, mid - tw * 0.6));
        const [bx, by] = _isoPointAt(part, cum, Math.min(total, mid + tw * 0.6));
        let angle = Math.atan2(by - ay, bx - ax);
        if (angle > Math.PI / 2) angle -= Math.PI;
        else if (angle < -Math.PI / 2) angle += Math.PI;
        const w = tw + 4 * lineScale, h = fontPx + 4 * lineScale;
        const hw = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2;
        const hh = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) / 2;
        const box = { x0: px - hw, y0: py - hh, x1: px + hw, y1: py + hh };
        if (box.x0 < area.x0 || box.y0 < area.y0 || box.x1 > area.x1 || box.y1 > area.y1) continue;
        if (placed.some(q => box.x0 < q.x1 + gap && box.x1 + gap > q.x0 && box.y0 < q.y1 + gap && box.y1 + gap > q.y0)) continue;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.strokeStyle = ISOBATH_HALO_COLOR;
        ctx.lineWidth = 3 * lineScale;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = ISOBATH_LABEL_COLOR;
        ctx.fillText(text, 0, 0);
        ctx.restore();
        placed.push(box);
    }
    ctx.restore();
}

function _isoPrepareContext(ctx) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
}

// ---------------------------------------------------------------------------
// Usage 1 : une tuile XYZ de 256 px (mode « Créer MBTiles »)
// ---------------------------------------------------------------------------

// Prépare les isobathes d'une tuile. Renvoie null si elle n'en porte aucune
// (hors couverture, terre ferme, service injoignable…), sinon une fonction qui
// les trace sur un contexte 2D de 256 × 256. Ne lève jamais d'erreur : une
// tuile sans isobathes ne doit pas faire échouer l'export.
async function isobathTile(z, x, y, settings, state) {
    if (z < ISOBATH_MIN_ZOOM) return null;
    const key = `${z}/${x}/${y}`;
    // Élagage : si la tuile parente, demandée, n'avait aucune donnée ou n'était
    // que terre haute, ses quatre sous-tuiles ne sont pas redemandées.
    const parent = state.classes.get(`${z - 1}/${x >> 1}/${y >> 1}`);
    if (parent === 'empty' || parent === 'land') {
        state.classes.set(key, 'skipped');
        state.stats.skipped++;
        return null;
    }
    try {
        const bounds = isobathTileBounds(z, x, y);
        const latC = _isoLat((bounds[1] + bounds[3]) / 2);
        const tileRes = _isoTileSpan(z) / 256;
        // Zoom de lecture : le plus fort dont le pixel reste au-dessus du minimum.
        const zr = Math.min(z, Math.floor(Math.log2(2 * _ISO_HALF / 256 / isobathMinResolution(latC))));
        const n = Math.max(1, 256 >> (z - zr));
        const res = _isoTileSpan(z) / n;
        const M = ISOBATH_MARGIN;
        const N = n + 2 * M;
        const grid = await fetchIsobathGrid(
            [bounds[0] - M * res, bounds[1] - M * res, bounds[2] + M * res, bounds[3] + M * res], N, N, state);
        if (grid.outside) {
            state.classes.set(key, 'empty');
            state.stats.outside++;
            return null;
        }
        const datum = isobathDatum(settings);
        const step = isobathStep(settings, tileRes * Math.cos(latC * Math.PI / 180));
        const k = 256 / n;
        const xf = { ox: (0.5 - M) * k, oy: (0.5 - M) * k, k };
        const built = _isoBuild(grid.values, N, N, xf, step, datum, 1, settings.finestStep);
        if (built.empty) { state.classes.set(key, 'empty'); return null; }
        if (built.minAlt - datum >= ISOBATH_LAND_MARGIN) { state.classes.set(key, 'land'); return null; }
        state.classes.set(key, 'water');
        if (!built.count) return null;
        state.stats.withLines++;
        return (ctx) => {
            _isoPrepareContext(ctx);
            _isoStroke(ctx, built, 1);
            const area = { x0: 0, y0: 0, x1: 256, y1: 256 };
            _isoLabels(ctx, built.masters, 1, area, area, []);
            ctx.restore();
        };
    } catch (e) {
        if (e && e.name === 'AbortError') return null;
        state.stats.failed++;
        state.stats.lastError = e && e.message ? e.message : String(e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Usage 2 : une vue Web Mercator nord en haut (images des modes 1 et 2)
// ---------------------------------------------------------------------------

// Trace les isobathes sur un canevas dont le repère courant est une vue Web
// Mercator nord en haut : le point (0, 0) du repère est le point EPSG:3857
// (view.x0, view.y0), un pixel vaut view.res mètres Mercator, la vue fait
// view.width × view.height pixels. Le repère peut être tourné ou translaté par
// l'appelant, pas mis à l'échelle. La zone est lue par blocs, tracée bloc par
// bloc, puis cotée. Renvoie un bilan ; ne lève d'erreur que sur annulation.
async function drawIsobathsOnView(ctx, view, settings, state, onProgress = null) {
    const summary = { status: 'ok', step: null, lines: 0, blocks: 0, failedBlocks: 0 };
    const bounds = [view.x0, view.y0 - view.height * view.res, view.x0 + view.width * view.res, view.y0];
    if (!_isoTerritories(bounds).length) { summary.status = 'outside'; return summary; }
    const latC = _isoLat((bounds[1] + bounds[3]) / 2);
    const rr = Math.max(view.res, isobathMinResolution(latC));
    const k = rr / view.res;
    const lineScale = view.lineScale || 1;
    const datum = isobathDatum(settings);
    const step = isobathStep(settings, view.res * Math.cos(latC * Math.PI / 180));
    summary.step = step;
    const GW = Math.ceil(view.width / k), GH = Math.ceil(view.height / k);
    const M = ISOBATH_MARGIN, B = ISOBATH_BLOCK;
    const blocks = [];
    for (let r0 = 0; r0 < GH; r0 += B) {
        for (let c0 = 0; c0 < GW; c0 += B) blocks.push({ c0, r0, c1: Math.min(GW, c0 + B), r1: Math.min(GH, r0 + B) });
    }
    summary.blocks = blocks.length;
    const masters = [];
    let done = 0, next = 0;
    const worker = async () => {
        while (next < blocks.length) {
            const b = blocks[next++];
            const nx = b.c1 - b.c0 + 2 * M, ny = b.r1 - b.r0 + 2 * M;
            const west = view.x0 + (b.c0 - M) * rr, north = view.y0 - (b.r0 - M) * rr;
            let grid;
            try {
                grid = await fetchIsobathGrid([west, north - ny * rr, west + nx * rr, north], nx, ny, state);
            } catch (e) {
                if (e && e.name === 'AbortError') throw e;
                summary.failedBlocks++;
                state.stats.failed++;
                grid = null;
            }
            if (grid && grid.values) {
                const xf = { ox: (b.c0 - M + 0.5) * k, oy: (b.r0 - M + 0.5) * k, k };
                const built = _isoBuild(grid.values, nx, ny, xf, step, datum, lineScale, settings.finestStep);
                if (!built.empty && built.count) {
                    // Chaque bloc ne peint que son cœur, bords arrondis au pixel :
                    // deux blocs voisins ne repassent jamais sur les mêmes pixels.
                    const clip = {
                        x0: Math.round(b.c0 * k), y0: Math.round(b.r0 * k),
                        x1: Math.min(view.width, Math.round(b.c1 * k)), y1: Math.min(view.height, Math.round(b.r1 * k)),
                    };
                    _isoPrepareContext(ctx);
                    ctx.beginPath();
                    ctx.rect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0);
                    ctx.clip();
                    _isoStroke(ctx, built, lineScale);
                    ctx.restore();
                    summary.lines += built.count;
                    state.stats.withLines++;
                    for (const m of built.masters) masters.push({ ...m, anchor: clip });
                }
            }
            done++;
            if (onProgress) onProgress(done / blocks.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, blocks.length) }, worker));
    // Cotes en dernier, par-dessus tous les traits.
    const area = { x0: 0, y0: 0, x1: view.width, y1: view.height };
    const placed = [];
    const byBlock = new Map();
    for (const m of masters) {
        if (!byBlock.has(m.anchor)) byBlock.set(m.anchor, []);
        byBlock.get(m.anchor).push(m);
    }
    // Cotes un peu plus grandes que sur une tuile : l'image est faite pour être
    // imprimée (≈ 2,3 mm de haut en A3).
    for (const [anchor, list] of byBlock) _isoLabels(ctx, list, lineScale * 1.3, area, anchor, placed);
    if (summary.failedBlocks === blocks.length) summary.status = 'failed';
    else if (!summary.lines) summary.status = 'nolines';
    return summary;
}

// Échelle des traits et des cotes d'une image : trait fin d'environ 0,18 mm
// une fois l'image imprimée en A3 (grand côté 420 mm), jamais moins d'un pixel.
function isobathLineScale(width, height) {
    return Math.max(1, Math.max(width, height) / 2333);
}

// Vue d'un canevas dont le pixel (0, 0) est le pixel « monde » Web Mercator
// `origin` au zoom `zoom`, agrandi `scale` fois (cf. drawIsobathsOnView).
function isobathViewFromWorldPixels(origin, zoom, scale, width, height) {
    const world = 256 * Math.pow(2, zoom);
    const span = 2 * _ISO_HALF;
    return {
        x0: (origin.x / world - 0.5) * span,
        y0: (0.5 - origin.y / world) * span,
        res: span / world / scale,
        width, height,
        lineScale: isobathLineScale(width, height),
    };
}

// Trace les isobathes d'une image et joint au bilan le texte de rapport et la
// ligne de cartouche. Point d'entrée des modes 1 et 2.
async function drawIsobathsForImage(ctx, view, settings, onProgress = null) {
    const state = createIsobathState();
    const summary = await drawIsobathsOnView(ctx, view, settings, state, onProgress);
    summary.report = summary.status === 'outside'
        ? 'Isobathes : la zone est hors de la couverture du RGE ALTI (France et outre-mer).'
        : isobathReport(state);
    summary.cartouche = summary.lines ? isobathShortText(settings, summary.step) : null;
    return summary;
}

// Volume maximal de données d'altitude qu'un export MBTiles téléchargera :
// les tuiles hors territoire IGN ou élaguées n'en coûtent pas.
function estimateIsobathBytes(bounds4326, zooms) {
    const latC = (bounds4326.south + bounds4326.north) / 2;
    const zrMax = Math.floor(Math.log2(2 * _ISO_HALF / 256 / isobathMinResolution(latC)));
    const x0 = bounds4326.west / 180 * _ISO_HALF;
    const x1 = bounds4326.east / 180 * _ISO_HALF;
    const y0 = _isoY(bounds4326.south), y1 = _isoY(bounds4326.north);
    let total = 0;
    for (const z of zooms) {
        if (z < ISOBATH_MIN_ZOOM) continue;
        const t = _isoTileSpan(z);
        const tiles = (Math.floor((x1 + _ISO_HALF) / t) - Math.floor((x0 + _ISO_HALF) / t) + 1)
            * (Math.floor((_ISO_HALF - y0) / t) - Math.floor((_ISO_HALF - y1) / t) + 1);
        const n = Math.max(1, 256 >> Math.max(0, z - zrMax)) + 2 * ISOBATH_MARGIN;
        total += tiles * n * n * 4;
    }
    return total;
}

// Phrase de bilan pour l'utilisateur.
function isobathReport(state) {
    const s = state.stats;
    const src = [...s.sources].map(v => v === 'wms' ? 'RGE ALTI 1 m (WMS IGN)' : 'RGE ALTI ~5 m (WMTS IGN, secours)').join(' + ');
    const mo = (s.bytes / 1048576).toFixed(s.bytes < 10485760 ? 1 : 0).replace('.', ',');
    if (!s.sources.size) {
        if (s.failed || s.lastError) return `Isobathes : service IGN injoignable (${s.lastError || 'erreur'}).`;
        if (s.outside) return 'Isobathes : la zone est hors de la couverture du RGE ALTI (France et outre-mer).';
        return `Isobathes : aucune tuile au zoom ${ISOBATH_MIN_ZOOM} ou plus, rien à tracer.`;
    }
    const partiel = s.failed ? ` ; ${s.failed} demande(s) en échec (${s.lastError})` : '';
    const lignes = s.withLines ? '' : ' ; aucune profondeur dans la zone (terre, large hors lidar ou lac)';
    return `Isobathes : ${src}, ${mo} Mo lus${lignes}${partiel}.`;
}

Object.assign(window, {
    ISOBATH_MIN_ZOOM,
    createIsobathState, fetchIsobathGrid, decodeIsobathBil, isobathContours, isobathLevels,
    isobathLegibleStep, isobathStep, isobathMasterStep, isobathDatum, isobathDepthText,
    isobathReferenceText, isobathShortText, isobathTile, drawIsobathsOnView,
    estimateIsobathBytes, isobathReport, isobathTileBounds, isobathLineScale,
    isobathViewFromWorldPixels, drawIsobathsForImage,
});

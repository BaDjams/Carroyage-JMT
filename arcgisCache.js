// arcgisCache.js — couches de type « arcgis-cache » : le cache de tuiles d'un
// MapServer ArcGIS tenu dans un autre système que le Web Mercator (Lambert 93),
// reprojeté dans le navigateur, tuile XYZ par tuile XYZ.
//
// Pourquoi pas l'export REST du MapServer (…/export?bbox=…&imageSR=3857) : sur le
// service de l'atlas IGC, la même requête rend une image vide une fois sur deux
// (mesuré le 2026-10-20), alors que le cache répond toujours. Le cache est servi
// tel quel ; seule la reprojection change de côté.
//
// Pour une tuile XYZ (z, x, y) : ses quatre coins passent en Lambert 93 ; le
// niveau du cache est le plus grossier dont le pixel reste plus fin que celui de
// la tuile ; les tuiles du cache qui la recouvrent sont posées côte à côte sur un
// canevas intermédiaire (aucune couture), lequel est dessiné d'un seul tenant
// par une transformation affine. Sur l'emprise d'une tuile, l'écart de cette
// approximation reste sous le demi-pixel (0,3 px au zoom 12) et sous le
// centimètre au sol dès le zoom 17 (vérifié par tools/test_arcgis_cache.mjs).
//
// Une entrée de map-layers.js :
//   { type: "arcgis-cache", url: "https://…/MapServer", crs: 2154,
//     origin: [x, y], resolution0: <m par pixel au niveau 0>, levels: <nombre>,
//     extent: [xmin, ymin, xmax, ymax] }   // emprise du cache, facultative
// Le cache est lu en …/MapServer/tile/{niveau}/{ligne}/{colonne}, tuiles de 256 px.

const AGC_WORLD = 20037508.342789244;   // demi-tour de la Terre en mètres Web Mercator
const AGC_TILE = 256;

// Lambert 93 (EPSG:2154) : conique conforme sécante, ellipsoïde GRS80, parallèles
// 44° et 49°, origine 46,5° N / 3° E, (700 000 ; 6 600 000). RGF93 assimilé au
// WGS84, comme proj4 (towgs84 nul).
const agcLambert93 = (() => {
    const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(f * (2 - f));
    const rad = d => d * Math.PI / 180;
    const m = p => Math.cos(p) / Math.sqrt(1 - (e * Math.sin(p)) ** 2);
    const t = p => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
    const p1 = rad(44), p2 = rad(49), p0 = rad(46.5), lam0 = rad(3);
    const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
    const F = m(p1) / (n * t(p1) ** n), rho0 = a * F * t(p0) ** n;
    return (lon, lat) => {
        const rho = a * F * t(rad(lat)) ** n, th = n * (rad(lon) - lam0);
        return [700000 + rho * Math.sin(th), 6600000 + rho0 - rho * Math.cos(th)];
    };
})();

const AGC_PROJECTIONS = { 2154: agcLambert93 };

// Pixel « monde » d'une tuile XYZ au zoom z → longitude, latitude.
function agcWorldPixelToLonLat(px, py, z) {
    const s = 2 * AGC_WORLD / (AGC_TILE * 2 ** z);
    const X = -AGC_WORLD + px * s, Y = AGC_WORLD - py * s;
    return [X / AGC_WORLD * 180, (2 * Math.atan(Math.exp(Y / AGC_WORLD * Math.PI)) - Math.PI / 2) * 180 / Math.PI];
}

// Plan de dessin de la tuile XYZ (z, x, y) : niveau et tuiles du cache à lire,
// taille du canevas intermédiaire, et matrice canevas [a, b, c, d, e, f] qui
// envoie un pixel du canevas intermédiaire sur la tuile de 256 px.
function agcTilePlan(layer, z, x, y) {
    const project = AGC_PROJECTIONS[layer.crs];
    if (!project) throw new Error(`Cache ArcGIS en EPSG:${layer.crs} non pris en charge (seul le Lambert 93, EPSG:2154, l'est).`);
    const corner = (u, v) => project(...agcWorldPixelToLonLat(x * AGC_TILE + u, y * AGC_TILE + v, z));
    const P0 = corner(0, 0), P1 = corner(AGC_TILE, 0), P2 = corner(0, AGC_TILE), P3 = corner(AGC_TILE, AGC_TILE);
    // Tuile → projection : X = P0 + (P1 − P0)·u/256 + (P2 − P0)·v/256 ; on l'inverse.
    const ax = (P1[0] - P0[0]) / AGC_TILE, bx = (P2[0] - P0[0]) / AGC_TILE;
    const ay = (P1[1] - P0[1]) / AGC_TILE, by = (P2[1] - P0[1]) / AGC_TILE;
    const det = ax * by - bx * ay;
    // Niveau : le plus grossier dont le pixel ne dépasse pas celui de la tuile.
    const need = Math.sqrt(Math.abs(det));
    const level = Math.max(0, Math.min(layer.levels - 1, Math.ceil(Math.log2(layer.resolution0 / need) - 1e-9)));
    const res = layer.resolution0 / 2 ** level, span = AGC_TILE * res;
    const [ox, oy] = layer.origin;
    const xs = [P0, P1, P2, P3].map(p => p[0]), ys = [P0, P1, P2, P3].map(p => p[1]);
    const c0 = Math.floor((Math.min(...xs) - ox) / span - 0.5 / AGC_TILE), c1 = Math.floor((Math.max(...xs) - ox) / span + 0.5 / AGC_TILE);
    const r0 = Math.floor((oy - Math.max(...ys)) / span - 0.5 / AGC_TILE), r1 = Math.floor((oy - Math.min(...ys)) / span + 0.5 / AGC_TILE);
    // Emprise du cache (extent, [xmin, ymin, xmax, ymax]) : rien n'est demandé
    // au-dehors — le serveur n'y répondrait que 404, par milliers à petite échelle.
    const ext = layer.extent;
    const colOk = col => !ext || (ox + (col + 1) * span > ext[0] && ox + col * span < ext[2]);
    const rowOk = row => !ext || (oy - row * span > ext[1] && oy - (row + 1) * span < ext[3]);
    const base = layer.url.replace(/\/+$/, '');
    const tiles = [];
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        if (row < 0 || col < 0 || !rowOk(row) || !colOk(col)) continue;
        tiles.push({ url: `${base}/tile/${level}/${row}/${col}`, dx: (col - c0) * AGC_TILE, dy: (row - r0) * AGC_TILE });
    }
    // Pixel (i, j) du canevas intermédiaire → projection : X = X0 + i·res, Y = Y0 − j·res.
    const X0 = ox + c0 * span, Y0 = oy - r0 * span;
    // Projection → tuile : (u, v) = Inv · (X − P0x, Y − P0y).
    const ia = by / det, ib = -bx / det, ic = -ay / det, id = ax / det;
    // Composition intermédiaire → tuile.
    const matrix = [
        ia * res, ic * res,            // ∂u/∂i, ∂v/∂i
        -ib * res, -id * res,          // ∂u/∂j, ∂v/∂j
        ia * (X0 - P0[0]) + ib * (Y0 - P0[1]),
        ic * (X0 - P0[0]) + id * (Y0 - P0[1]),
    ];
    return { level, res, tiles, width: (c1 - c0 + 1) * AGC_TILE, height: (r1 - r0 + 1) * AGC_TILE, matrix };
}

// Chargement des tuiles du cache : image décodée, ou null (absente, refusée,
// hors couverture). Dans l'application, les reprises des exports
// (loadExportTile, utilities.js) ; seule, une seconde tentative avant de renoncer.
function agcLoadImage(url) {
    if (typeof loadExportTile === 'function') return loadExportTile(url);
    const once = () => new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
    return once().then(img => img || once());
}

// Cache des tuiles source entre tuiles voisines (une tuile du cache sert à
// plusieurs tuiles XYZ) : promesses gardées, les plus anciennes oubliées.
function agcImageCache(max = 128) {
    const map = new Map();
    return url => {
        let p = map.get(url);
        if (p) { map.delete(url); map.set(url, p); return p; }
        p = agcLoadImage(url);
        map.set(url, p);
        while (map.size > max) map.delete(map.keys().next().value);
        return p;
    };
}

// Dessine la tuile XYZ (z, x, y) sur ctx, son coin haut gauche en (dx, dy).
// Renvoie true si au moins une tuile du cache a été lue.
async function agcDrawTile(layer, ctx, z, x, y, dx = 0, dy = 0, load = agcLoadImage) {
    const plan = agcTilePlan(layer, z, x, y);
    if (!plan.tiles.length) return false;
    const images = await Promise.all(plan.tiles.map(t => load(t.url)));
    if (!images.some(Boolean)) return false;
    const inter = document.createElement('canvas');
    inter.width = plan.width; inter.height = plan.height;
    const ictx = inter.getContext('2d');
    images.forEach((img, i) => { if (img) ictx.drawImage(img, plan.tiles[i].dx, plan.tiles[i].dy, AGC_TILE, AGC_TILE); });
    ctx.save();
    ctx.translate(dx, dy);
    ctx.beginPath(); ctx.rect(0, 0, AGC_TILE, AGC_TILE); ctx.clip();
    ctx.transform(...plan.matrix);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(inter, 0, 0);
    ctx.restore();
    return true;
}

// Dessine les tuiles XYZ x0..x1 × y0..y1 du zoom z sur ctx, chacune à
// (floor(x·256 − originX), floor(y·256 − originY)) — impression et export de zone.
// onTile(fait, total) suit l'avancement.
async function agcDrawTiles(layer, ctx, z, x0, y0, x1, y1, originX, originY, onTile) {
    const load = agcImageCache(512), jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
    let done = 0;
    // Quatre tuiles à la fois : chacune lit 2 à 9 tuiles du cache, partagées avec ses voisines.
    const worker = async () => {
        while (jobs.length) {
            const [x, y] = jobs.shift();
            try { await agcDrawTile(layer, ctx, z, x, y, Math.floor(x * AGC_TILE - originX), Math.floor(y * AGC_TILE - originY), load); }
            catch (e) { console.warn('arcgis-cache', e); }
            onTile?.(++done, (x1 - x0 + 1) * (y1 - y0 + 1));
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
}

// Couche Leaflet : chaque tuile est un canevas dessiné par agcDrawTile.
function agcLeafletLayer(layer, options) {
    const load = agcImageCache(256);
    const Layer = L.GridLayer.extend({
        createTile(coords, done) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = AGC_TILE;
            agcDrawTile(layer, canvas.getContext('2d'), coords.z, coords.x, coords.y, 0, 0, load)
                .then(() => done(null, canvas), e => done(e, canvas));
            return canvas;
        },
    });
    return new Layer(options);
}

// Couche à reprojeter dans le navigateur, jamais servie octet pour octet.
function layerNeedsCanvas(layer) {
    return layer.type === 'yandex' || layer.type === 'arcgis-cache';
}

if (typeof window !== 'undefined') {
    Object.assign(window, { agcLambert93, agcTilePlan, agcDrawTile, agcDrawTiles, agcLeafletLayer, agcImageCache, layerNeedsCanvas });
}

// fileToMbtilesCore.js — calculs PURS de « Générer un MBTiles depuis un fichier »
// (fileToMbtiles.js) : ni DOM, ni Leaflet, ni pdf.js. Testé sous Node :
// node tools/test_file_to_mbtiles.mjs
//
// Un fichier (PDF, GeoTIFF) a ses propres coordonnées « source » : points PDF
// d'une page vue à l'échelle 1 (origine en haut à gauche, y vers le bas), ou
// pixels d'une image. Tout le reste se fait en Web Mercator (EPSG:3857, mètres),
// le repère des tuiles : la transformation source → Mercator, les zones, les
// tuiles, les blocs rendus d'un seul tenant.

const FTM_R = 6378137;
const FTM_HALF = Math.PI * FTM_R;          // demi-tour de la Terre en mètres Mercator
const FTM_TILE = 256;

// ===== Coordonnées =====

function ftmLonLatToMerc(lon, lat) {
    const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
    return [FTM_R * lon * Math.PI / 180, FTM_R * Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360))];
}

function ftmMercToLonLat(X, Y) {
    return [X / FTM_R * 180 / Math.PI, (2 * Math.atan(Math.exp(Y / FTM_R)) - Math.PI / 2) * 180 / Math.PI];
}

// Taille d'un pixel de tuile en mètres Mercator, puis au sol à la latitude lat.
function ftmMercResolution(z) { return 2 * FTM_HALF / (FTM_TILE * 2 ** z); }
function ftmGroundResolution(z, lat) { return ftmMercResolution(z) * Math.cos(lat * Math.PI / 180); }

// ===== Fichier .points (points d'appui du Géoréférenceur QGIS, export CadoTour) =====
//
// mapX = longitude, mapY = latitude (EPSG:4326) ; sourceX/sourceY = position sur
// le fichier, au format QGIS : sourceY NÉGATIF (axe vers le haut). Un point dont
// la source vaut (0, 0) n'est pas encore placé sur le fichier — c'est ainsi que
// CadoTour les exporte.

function ftmParsePoints(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const crs = lines.find(l => l.startsWith('#CRS:'));
    if (crs && !/EPSG:?\s*4326|WGS\s*84|"4326"/i.test(crs)) {
        throw new Error('Points en ' + crs.slice(5).trim().slice(0, 40) + ' : seules des longitudes et latitudes WGS84 (EPSG:4326) sont prises en charge.');
    }
    const rows = lines.filter(l => !l.startsWith('#'));
    if (!rows.length) return [];
    let header = rows[0].split(',').map(s => s.trim());
    let body = rows.slice(1);
    if (!header.includes('mapX')) { header = ['mapX', 'mapY', 'sourceX', 'sourceY', 'enable']; body = rows; }
    const col = name => header.indexOf(name);
    const points = [];
    for (const row of body) {
        const f = row.split(',');
        const lon = Number(f[col('mapX')]), lat = Number(f[col('mapY')]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
        const sx = Number(f[col('sourceX')]), sy = Number(f[col('sourceY')]);
        const placed = Number.isFinite(sx) && Number.isFinite(sy) && (sx !== 0 || sy !== 0);
        const en = col('enable') >= 0 ? f[col('enable')] : '1';
        points.push({ lon, lat, x: placed ? sx : null, y: placed ? -sy : null, enabled: String(en).trim() !== '0' });
    }
    return points;
}

function ftmWritePoints(points) {
    const n = v => String(Math.round(v * 1e9) / 1e9);
    const rows = points.filter(p => Number.isFinite(p.lon) && Number.isFinite(p.lat)).map(p => {
        const placed = Number.isFinite(p.x) && Number.isFinite(p.y);
        return `${n(p.lon)},${n(p.lat)},${placed ? n(p.x) : 0},${placed ? n(-p.y) : 0},${p.enabled === false ? 0 : 1},0,0,0`;
    });
    return ['#CRS: EPSG:4326', 'mapX,mapY,sourceX,sourceY,enable,dX,dY,residual', ...rows].join('\n') + '\n';
}

// ===== Transformation source → Mercator =====
//
// Matrice au format canevas [a, b, c, d, e, f] : X = a·x + c·y + e ; Y = b·x + d·y + f.
// « similarity » : échelle, rotation, translation — un plan à l'échelle, 2 points
// suffisent. La source a son axe y vers le bas, Mercator vers le haut : la
// similitude porte ce retournement (d = −a). « affine » : échelles différentes
// selon les axes et cisaillement tolérés, 3 points au moins.

function ftmUsablePoints(points) {
    return points.filter(p => p.enabled !== false && Number.isFinite(p.x) && Number.isFinite(p.y)
        && Number.isFinite(p.lon) && Number.isFinite(p.lat));
}

function ftmMinPoints(kind) { return kind === 'affine' ? 3 : 2; }

function ftmFitTransform(points, kind = 'similarity') {
    const pts = ftmUsablePoints(points);
    if (pts.length < ftmMinPoints(kind)) return null;
    const M = pts.map(p => ftmLonLatToMerc(p.lon, p.lat));
    // Centrage : conditionnement numérique des moindres carrés.
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const cX = M.reduce((s, m) => s + m[0], 0) / M.length, cY = M.reduce((s, m) => s + m[1], 0) / M.length;
    let a, b, c, d;
    if (kind === 'affine') {
        // X − cX = a·u + c·v ; Y − cY = b·u + d·v (u, v centrés).
        let suu = 0, suv = 0, svv = 0, sXu = 0, sXv = 0, sYu = 0, sYv = 0;
        pts.forEach((p, i) => {
            const u = p.x - cx, v = p.y - cy, X = M[i][0] - cX, Y = M[i][1] - cY;
            suu += u * u; suv += u * v; svv += v * v; sXu += X * u; sXv += X * v; sYu += Y * u; sYv += Y * v;
        });
        const det = suu * svv - suv * suv;
        if (Math.abs(det) < 1e-12 * Math.max(1, suu * svv)) return null;   // points alignés
        a = (sXu * svv - sXv * suv) / det; c = (sXv * suu - sXu * suv) / det;
        b = (sYu * svv - sYv * suv) / det; d = (sYv * suu - sYu * suv) / det;
    } else {
        // (u, −v) → (X, Y) par similitude directe : X = p·u + q·v ; Y = q·u − p·v.
        let num1 = 0, num2 = 0, den = 0;
        pts.forEach((p, i) => {
            const u = p.x - cx, v = p.y - cy, X = M[i][0] - cX, Y = M[i][1] - cY;
            num1 += X * u - Y * v; num2 += X * v + Y * u; den += u * u + v * v;
        });
        if (den === 0) return null;
        const p = num1 / den, q = num2 / den;
        a = p; c = q; b = q; d = -p;
    }
    return [a, b, c, d, cX - a * cx - c * cy, cY - b * cx - d * cy];
}

function ftmApply(T, x, y) { return [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]; }

function ftmInvert(T) {
    const [a, b, c, d, e, f] = T, det = a * d - b * c;
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function ftmMultiply(A, B) {   // A ∘ B : applique B puis A
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3],
        A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}

// Écart au sol (m) de chaque point utilisé, et moyenne quadratique.
function ftmResiduals(points, T) {
    const out = [];
    let s2 = 0, n = 0;
    for (const p of points) {
        if (!T || p.enabled === false || !Number.isFinite(p.x) || !Number.isFinite(p.y)
            || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) { out.push(null); continue; }
        const [X, Y] = ftmApply(T, p.x, p.y), [MX, MY] = ftmLonLatToMerc(p.lon, p.lat);
        const r = Math.hypot(X - MX, Y - MY) * Math.cos(p.lat * Math.PI / 180);
        out.push(r); s2 += r * r; n++;
    }
    return { each: out, rms: n ? Math.sqrt(s2 / n) : null };
}

// Échelle (mètres au sol par unité source, moyenne des deux axes) et rotation
// (degrés, sens horaire, 0 = nord en haut) d'une transformation, à la latitude lat.
function ftmDescribe(T, lat) {
    const k = Math.cos(lat * Math.PI / 180);
    const sx = Math.hypot(T[0], T[1]), sy = Math.hypot(T[2], T[3]);
    const rot = Math.atan2(T[1], T[0]) * 180 / Math.PI;
    return { metersPerUnit: (sx + sy) / 2 * k, rotation: -rot, anisotropy: sx / sy };
}

// ===== Niveaux de zoom =====
//
// Le zoom maximal est celui dont le pixel est au moins aussi fin que :
//   • un pixel d'image du fichier (fond scanné, photo, GeoTIFF) ;
//   • pour le dessin vectoriel, ce qu'il faut pour que le texte se lise : le
//     plus petit texte courant (10e centile, pondéré par le nombre de
//     caractères) doit faire FTM_TEXT_PX pixels de haut.
// Le zoom minimal : celui où la zone retenue fait encore FTM_MIN_SPAN_PX pixels
// de large ; en deçà, une tuile ou deux ne montrent plus rien d'utile.

const FTM_TEXT_PX = 8;
const FTM_MIN_SPAN_PX = 512;
const FTM_ZOOM_CEIL = 22;

// Plus petit zoom dont le pixel au sol est ≤ res (m) à la latitude lat.
function ftmZoomForResolution(res, lat) {
    if (!(res > 0)) return null;
    const z = Math.ceil(Math.log2(ftmGroundResolution(0, lat) / res) - 1e-9);
    return Math.max(0, Math.min(FTM_ZOOM_CEIL, z));
}

// sizes : [{ size, weight }] — hauteurs de texte en unités source.
function ftmTextPercentile(sizes, q = 0.1) {
    const s = sizes.filter(t => t.size > 0 && t.weight > 0).sort((a, b) => a.size - b.size);
    const total = s.reduce((n, t) => n + t.weight, 0);
    if (!total) return null;
    let acc = 0;
    for (const t of s) { acc += t.weight; if (acc >= q * total) return t.size; }
    return s[s.length - 1].size;
}

/**
 * @param {object} o
 * @param {number} o.metersPerUnit   mètres au sol par unité source
 * @param {number} o.lat             latitude de la zone
 * @param {number} [o.rasterPxPerUnit]  densité la plus fine des images du fichier
 * @param {Array}  [o.textSizes]     hauteurs de texte [{ size, weight }]
 * @param {number} o.spanMeters      plus grande dimension de la zone retenue, au sol
 */
function ftmSuggestZooms({ metersPerUnit, lat, rasterPxPerUnit, textSizes, spanMeters }) {
    const reasons = [];
    let zmax = null;
    if (rasterPxPerUnit > 0) {
        const z = ftmZoomForResolution(metersPerUnit / rasterPxPerUnit, lat);
        reasons.push({ kind: 'raster', zoom: z, res: metersPerUnit / rasterPxPerUnit });
        zmax = z;
    }
    const t = textSizes?.length ? ftmTextPercentile(textSizes) : null;
    if (t) {
        const z = ftmZoomForResolution(metersPerUnit * t / FTM_TEXT_PX, lat);
        reasons.push({ kind: 'text', zoom: z, textSize: t, res: metersPerUnit * t / FTM_TEXT_PX });
        zmax = zmax == null ? z : Math.max(zmax, z);
    }
    if (zmax == null) {
        // Ni image ni texte : un point PDF (0,35 mm) sur 2 pixels.
        const z = ftmZoomForResolution(metersPerUnit / 2, lat);
        reasons.push({ kind: 'default', zoom: z, res: metersPerUnit / 2 });
        zmax = z;
    }
    let zmin = zmax;
    while (zmin > 0 && spanMeters / ftmGroundResolution(zmin - 1, lat) >= FTM_MIN_SPAN_PX) zmin--;
    return { zmin: Math.min(zmin, zmax), zmax, reasons };
}

// ===== Géométrie des zones =====

// Sutherland–Hodgman : partie du polygone dans le rectangle [x0, x1] × [y0, y1].
function ftmClipPolygonToRect(poly, x0, y0, x1, y1) {
    let out = poly;
    const edges = [
        [p => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
        [p => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
        [p => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; }],
        [p => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; }],
    ];
    for (const [inside, cut] of edges) {
        const src = out; out = [];
        for (let i = 0; i < src.length; i++) {
            const cur = src[i], prev = src[(i + src.length - 1) % src.length];
            if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
            else if (inside(prev)) out.push(cut(prev, cur));
        }
        if (!out.length) break;
    }
    return out;
}

function ftmPolygonArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return Math.abs(s) / 2;
}

function ftmPolygonBounds(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
}

// Tuiles (x, y en XYZ) du zoom z qui recoupent au moins un des polygones
// (coordonnées Mercator). Un simple contact de bord ne compte pas.
function ftmTilesForPolygons(polys, z) {
    const r = ftmMercResolution(z) * FTM_TILE, n = 2 ** z;
    const b = ftmPolygonBounds(polys);
    const tx0 = Math.max(0, Math.floor((b.x0 + FTM_HALF) / r)), tx1 = Math.min(n - 1, Math.floor((b.x1 + FTM_HALF) / r));
    const ty0 = Math.max(0, Math.floor((FTM_HALF - b.y1) / r)), ty1 = Math.min(n - 1, Math.floor((FTM_HALF - b.y0) / r));
    const tiles = [];
    const minArea = r * r * 1e-6;
    for (let x = tx0; x <= tx1; x++) {
        for (let y = ty0; y <= ty1; y++) {
            const X0 = -FTM_HALF + x * r, X1 = X0 + r, Y1 = FTM_HALF - y * r, Y0 = Y1 - r;
            if (polys.some(p => ftmPolygonArea(ftmClipPolygonToRect(p, X0, Y0, X1, Y1)) > minArea)) tiles.push({ x, y });
        }
    }
    return tiles;
}

// Regroupe des tuiles du zoom z en blocs de side × side tuiles, rendus d'un
// seul tenant (un rendu de PDF coûte surtout un temps fixe : peu de grands
// blocs plutôt que beaucoup de tuiles).
function ftmGroupBlocks(tiles, side) {
    const blocks = new Map();
    for (const t of tiles) {
        const bx = Math.floor(t.x / side), by = Math.floor(t.y / side), key = `${bx}/${by}`;
        if (!blocks.has(key)) blocks.set(key, { bx, by, x0: bx * side, y0: by * side, side, tiles: [] });
        blocks.get(key).tiles.push(t);
    }
    return [...blocks.values()].sort((a, b) => a.by - b.by || a.bx - b.bx);
}

// Matrice canevas Mercator → pixels d'un bloc dont la tuile haut-gauche est (x0, y0).
function ftmMercToBlockMatrix(z, x0, y0) {
    const r = ftmMercResolution(z);
    const X0 = -FTM_HALF + x0 * FTM_TILE * r, Y0 = FTM_HALF - y0 * FTM_TILE * r;
    return [1 / r, 0, 0, -1 / r, -X0 / r, Y0 / r];
}

// Tuiles parentes (zoom z − 1) d'un ensemble de tuiles du zoom z.
function ftmParentTiles(tiles) {
    const seen = new Map();
    for (const t of tiles) { const k = `${t.x >> 1}/${t.y >> 1}`; if (!seen.has(k)) seen.set(k, { x: t.x >> 1, y: t.y >> 1 }); }
    return [...seen.values()];
}

function ftmPyramidCounts(tilesAtMax, zmin, zmax) {
    const counts = {};
    let level = tilesAtMax;
    for (let z = zmax; z >= zmin; z--) { counts[z] = level.length; if (z > zmin) level = ftmParentTiles(level); }
    return counts;
}

// Approximation affine (moindres carrés) d'une fonction f : source → Mercator
// sur un rectangle, à partir d'une grille de n × n points — pour une source
// projetée (GeoTIFF en Lambert 93…), sur l'étendue d'un bloc. Rend aussi
// l'écart maximal (m Mercator) entre f et son approximation.
function ftmLocalAffine(f, x0, y0, x1, y1, n = 3) {
    const pts = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = x0 + (x1 - x0) * i / (n - 1), y = y0 + (y1 - y0) * j / (n - 1);
        const [X, Y] = f(x, y);
        pts.push({ x, y, X, Y });
    }
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const cX = pts.reduce((s, p) => s + p.X, 0) / pts.length, cY = pts.reduce((s, p) => s + p.Y, 0) / pts.length;
    let suu = 0, suv = 0, svv = 0, sXu = 0, sXv = 0, sYu = 0, sYv = 0;
    for (const p of pts) {
        const u = p.x - cx, v = p.y - cy, X = p.X - cX, Y = p.Y - cY;
        suu += u * u; suv += u * v; svv += v * v; sXu += X * u; sXv += X * v; sYu += Y * u; sYv += Y * v;
    }
    const det = suu * svv - suv * suv;
    const a = (sXu * svv - sXv * suv) / det, c = (sXv * suu - sXu * suv) / det;
    const b = (sYu * svv - sYv * suv) / det, d = (sYv * suu - sYu * suv) / det;
    const T = [a, b, c, d, cX - a * cx - c * cy, cY - b * cx - d * cy];
    let err = 0;
    for (const p of pts) { const [X, Y] = ftmApply(T, p.x, p.y); err = Math.max(err, Math.hypot(X - p.X, Y - p.Y)); }
    return { T, err };
}

// ===== GeoTIFF : géoréférencement lu dans les étiquettes =====
//
// Pixel (colonne, ligne) → coordonnées du système du fichier, d'après
// ModelTransformation ou ModelTiepoint + ModelPixelScale. Les coordonnées de
// pixel désignent le COIN haut-gauche du pixel (0, 0 = coin de l'image) ; une
// image « PixelIsPoint » (RasterTypeGeoKey = 2) est décalée d'un demi-pixel.
function ftmGeoTiffPixelTransform(tags, geoKeys = {}) {
    let T;
    if (tags.ModelTransformation?.length >= 8) {
        const m = tags.ModelTransformation;
        T = [m[0], m[4], m[1], m[5], m[3], m[7]];
    } else if (tags.ModelTiepoint?.length >= 6 && tags.ModelPixelScale?.length >= 2) {
        const [i, j, , X, Y] = tags.ModelTiepoint, [sx, sy] = tags.ModelPixelScale;
        T = [sx, 0, 0, -sy, X - i * sx, Y + j * sy];
    } else {
        return null;
    }
    if (geoKeys.GTRasterTypeGeoKey === 2) T = ftmMultiply(T, [1, 0, 0, 1, -0.5, -0.5]);
    return T;
}

// Code EPSG du système d'un GeoTIFF (projeté d'abord, géographique sinon).
function ftmGeoTiffEpsg(geoKeys = {}) {
    const p = geoKeys.ProjectedCSTypeGeoKey, g = geoKeys.GeographicTypeGeoKey;
    if (p && p !== 32767) return p;
    if (geoKeys.GTModelTypeGeoKey === 2 && g && g !== 32767) return g;
    if (g && g !== 32767 && !p) return g;
    return null;
}

// Définitions proj4 des systèmes reconnus (les plus courants en France, et les
// UTM du monde entier). Tout autre code est refusé avec un message clair.
function ftmProjDefinition(epsg) {
    const fixed = {
        4326: '+proj=longlat +datum=WGS84 +no_defs',
        4171: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs',
        4258: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs',
        3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
        3395: '+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
        2154: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
        27572: '+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs',
        2975: '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
        5490: '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
        2972: '+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
    };
    if (fixed[epsg]) return fixed[epsg];
    if (epsg >= 3942 && epsg <= 3950) {   // Lambert 93 coniques conformes CC42 … CC50
        const k = epsg - 3900, lat0 = k;
        return `+proj=lcc +lat_0=${lat0} +lon_0=3 +lat_1=${lat0 - 0.75} +lat_2=${lat0 + 0.75} +x_0=1700000 +y_0=${(k - 41) * 1000000 + 200000} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    }
    if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
    if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
    if (epsg >= 25828 && epsg <= 25838) return `+proj=utm +zone=${epsg - 25800} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    return null;
}

// ===== Divers =====

function ftmSniffImage(b) {
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
}

// « 1/2 500 » : échelle d'impression d'un PDF (1 pt = 0,352 8 mm) dont l'unité
// vaut metersPerUnit mètres au sol.
function ftmPrintScale(metersPerUnit) {
    return metersPerUnit / (25.4 / 72 / 1000);
}

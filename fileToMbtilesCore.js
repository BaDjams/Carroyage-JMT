// fileToMbtilesCore.js — calculs PURS de « Générer un MBTiles depuis un fichier »
// (fileToMbtiles.js) : ni DOM, ni Leaflet, ni pdf.js. Testé sous Node :
// node tools/test_file_to_mbtiles.mjs
//
// Un fichier (PDF, GeoTIFF, JP2) a ses propres coordonnées « source » : points PDF
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
    if (poly.length < 3) return 0;
    const [x, y] = poly[0]; // éviter la perte de précision sur de petites zones en Mercator
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y); }
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
function ftmTilesForPolygons(polys, z, limit = Infinity) {
    const r = ftmMercResolution(z) * FTM_TILE, n = 2 ** z;
    const b = ftmPolygonBounds(polys);
    const tx0 = Math.max(0, Math.floor((b.x0 + FTM_HALF) / r)), tx1 = Math.min(n - 1, Math.floor((b.x1 + FTM_HALF) / r));
    const ty0 = Math.max(0, Math.floor((FTM_HALF - b.y1) / r)), ty1 = Math.min(n - 1, Math.floor((FTM_HALF - b.y0) / r));
    const tiles = [];
    const minArea = polys.reduce((a, p) => Math.min(a, ftmPolygonArea(p) || a), r * r) * 1e-6;
    for (let x = tx0; x <= tx1; x++) {
        for (let y = ty0; y <= ty1; y++) {
            const X0 = -FTM_HALF + x * r, X1 = X0 + r, Y1 = FTM_HALF - y * r, Y0 = Y1 - r;
            if (polys.some(p => ftmPolygonArea(ftmClipPolygonToRect(p, X0, Y0, X1, Y1)) > minArea)) {
                if (tiles.length >= limit) throw new Error('Trop de tuiles : réduire la zone ou le zoom maximal.');
                tiles.push({ x, y });
            }
        }
    }
    return tiles;
}

// ===== Zone le long d'une trace (« Créer MBTiles ») =====

// Traces et surfaces d'un fichier GPX, KML ou GeoJSON, en [lon, lat] :
// { lines: [[[lon, lat], …], …], polygons: [[[lon, lat], …], …] }. GPX : chaque
// segment de trace (trkseg) et chaque route ; KML : LineString, gx:Track (traces
// enregistrées de Google Earth et des traceurs GPS) et contour extérieur des
// Polygon ; GeoJSON : LineString, MultiLineString, Polygon, MultiPolygon. Les
// pointes de flèche exportées par CadoTour rejoignent leur trait
// (ftmJoinArrowHeads). Lecture par le texte, sans DOM : testable sous Node. Un
// KMZ est ouvert par l'appelant, qui passe ici chacun de ses .kml.
function ftmParseTrackText(text) {
    return ftmJoinArrowHeads(ftmReadTrackText(text));
}

function ftmReadTrackText(text) {
    const lines = [], polygons = [];
    const src = String(text || '').replace(/^﻿/, '');
    const num = v => (v == null || v === '' ? NaN : Number(v));
    const ok = p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180;
    const keep = (list, pts, min) => { const clean = pts.filter(ok); if (clean.length >= min) list.push(clean); };
    if (/^\s*[{[]/.test(src)) {
        let gj;
        try { gj = JSON.parse(src); } catch (e) { throw new Error('GeoJSON illisible.'); }
        const pt = c => [num(c?.[0]), num(c?.[1])];
        const visit = g => {
            if (!g) return;
            if (g.type === 'FeatureCollection') return (g.features || []).forEach(visit);
            if (g.type === 'Feature') return visit(g.geometry);
            if (g.type === 'GeometryCollection') return (g.geometries || []).forEach(visit);
            if (g.type === 'LineString') keep(lines, (g.coordinates || []).map(pt), 1);
            if (g.type === 'MultiLineString') (g.coordinates || []).forEach(l => keep(lines, l.map(pt), 1));
            if (g.type === 'Polygon') keep(polygons, (g.coordinates?.[0] || []).map(pt), 3);
            if (g.type === 'MultiPolygon') (g.coordinates || []).forEach(p => keep(polygons, (p?.[0] || []).map(pt), 3));
        };
        visit(gj);
        return { lines, polygons };
    }
    const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag); return m ? num(m[1]) : NaN; };
    const points = (block, tag) => [...block.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>`, 'g'))]
        .map(m => [attr(m[0], 'lon'), attr(m[0], 'lat')]);
    if (/<(?:\w+:)?gpx\b/.test(src)) {
        for (const m of src.matchAll(/<(?:\w+:)?trkseg\b[^>]*>([\s\S]*?)<\/(?:\w+:)?trkseg>/g)) keep(lines, points(m[1], 'trkpt'), 1);
        for (const m of src.matchAll(/<(?:\w+:)?rte\b[^>]*>([\s\S]*?)<\/(?:\w+:)?rte>/g)) keep(lines, points(m[1], 'rtept'), 1);
        return { lines, polygons };
    }
    if (/<(?:\w+:)?kml\b/.test(src) || /<(?:\w+:)?coordinates\b/.test(src)) {
        const coords = block => {
            const m = /<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/.exec(block);
            return m ? m[1].trim().split(/\s+/).filter(Boolean).map(t => t.split(',').map(num)) : [];
        };
        for (const m of src.matchAll(/<(?:\w+:)?LineString\b[^>]*>([\s\S]*?)<\/(?:\w+:)?LineString>/g)) keep(lines, coords(m[1]), 1);
        // gx:Track : un point par <gx:coord>lon lat alt</gx:coord> (séparés par des espaces).
        for (const m of src.matchAll(/<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/g)) {
            keep(lines, [...m[1].matchAll(/<gx:coord>([^<]*)<\/gx:coord>/g)].map(c => c[1].trim().split(/\s+/).map(num)), 1);
        }
        for (const m of src.matchAll(/<(?:\w+:)?outerBoundaryIs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?outerBoundaryIs>/g)) keep(polygons, coords(m[1]), 3);
        return { lines, polygons };
    }
    throw new Error('Format non reconnu : GPX, KML ou GeoJSON attendu.');
}

// Flèches de CadoTour (« Fichier › Exporter en KMZ… », kmzExport.js) : un KML ne
// connaît pas la flèche, elle y part en DEUX objets — le trait, qui s'arrête à la
// base de la pointe, et la pointe, un triangle plein [sommet, gauche, droite]
// dont le milieu de la base est le bout du trait. Pour une zone le long de la
// flèche, la pointe rejoint son trait : le trait est prolongé jusqu'au sommet, et
// le triangle n'est plus une surface à part. Une flèche à deux pointes en a une à
// chaque bout. Un triangle qui ne touche aucun bout de trait reste une surface.
function ftmJoinArrowHeads({ lines, polygons }) {
    lines = lines.map(l => l.slice());
    const kept = [];
    const near = (a, b, tol) => Math.hypot(a[0] - b[0], (a[1] - b[1])) <= tol;
    for (const poly of polygons) {
        const ring = near(poly[0], poly[poly.length - 1], 0) ? poly.slice(0, -1) : poly;
        let joined = false;
        if (ring.length === 3) {
            const [tip, l, r] = ring;
            const base = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
            // Tolérance : 2 % de la hauteur de la pointe (arrondis du KML).
            const tol = Math.hypot(tip[0] - base[0], tip[1] - base[1]) * 0.02;
            for (const line of lines) {
                if (near(line[line.length - 1], base, tol)) { line.push(tip); joined = true; break; }
                if (near(line[0], base, tol)) { line.unshift(tip); joined = true; break; }
            }
        }
        if (!joined) kept.push(poly);
    }
    return { lines, polygons: kept };
}

// Couloir de `distM` mètres AU SOL de part et d'autre d'une trace [[lon, lat], …],
// en polygones Mercator : un quadrilatère par segment, un disque par sommet (leur
// réunion est le couloir, extrémités arrondies). En Mercator, une longueur au sol
// vaut longueur / cos(latitude) : chaque extrémité prend l'échelle de sa latitude.
// Disque à `sides` côtés, CIRCONSCRIT au cercle : il le contient, rien ne manque.
// Tous les polygones tournent dans le même sens (trigonométrique) : affichés en
// un seul tracé « nonzero », leurs recouvrements ne font pas de trous.
function ftmCorridorPolygons(track, distM, sides = 16) {
    const polys = [];
    if (!(distM > 0) || !track?.length) return polys;
    const pts = track.map(([lon, lat]) => ({ m: ftmLonLatToMerc(lon, lat), w: distM / Math.cos(lat * Math.PI / 180) }));
    const ccw = poly => (ftmSignedArea(poly) < 0 ? poly.reverse() : poly);
    const k = 1 / Math.cos(Math.PI / sides);
    for (const { m: [x, y], w } of pts) {
        const disc = [];
        for (let i = 0; i < sides; i++) { const a = 2 * Math.PI * i / sides; disc.push([x + w * k * Math.cos(a), y + w * k * Math.sin(a)]); }
        polys.push(disc);
    }
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.m[0] - a.m[0], dy = b.m[1] - a.m[1], len = Math.hypot(dx, dy);
        if (!len) continue;
        const nx = -dy / len, ny = dx / len;
        polys.push(ccw([[a.m[0] + nx * a.w, a.m[1] + ny * a.w], [a.m[0] - nx * a.w, a.m[1] - ny * a.w],
            [b.m[0] - nx * b.w, b.m[1] - ny * b.w], [b.m[0] + nx * b.w, b.m[1] + ny * b.w]]));
    }
    return polys;
}

function ftmSignedArea(poly) {
    const [x, y] = poly[0];
    let s = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y); }
    return s / 2;
}

// Tuiles (x, y en XYZ) du zoom z que recoupe une zone faite de nombreux petits
// polygones (couloir d'une trace) : chacun n'examine que les tuiles de sa propre
// emprise, au lieu de tester tous les polygones sur toute l'emprise de la zone.
function ftmTilesForZone(polys, z, limit = Infinity) {
    const seen = new Set(), tiles = [], n = 2 ** z;
    for (const poly of polys) {
        for (const t of ftmTilesForPolygons([poly], z)) {
            const key = t.y * n + t.x;
            if (seen.has(key)) continue;
            if (tiles.length >= limit) throw new Error('Trop de tuiles : réduire la zone ou le zoom maximal.');
            seen.add(key); tiles.push(t);
        }
    }
    return tiles;
}

// Regroupe des tuiles du zoom z en blocs de side × side tuiles, rendus d'un
// seul tenant (un rendu de PDF coûte surtout un temps fixe : peu de grands
// blocs plutôt que beaucoup de tuiles). Ordre : bandes verticales de `strip`
// blocs, parcourues de haut en bas. Les blocs consécutifs reprennent ainsi les
// mêmes tuiles du fichier source, encore dans le cache du décodeur JP2 ; par
// lignes entières, ce cache aurait été vidé avant de revenir sur une tuile.
function ftmGroupBlocks(tiles, side, strip = 1) {
    const blocks = new Map();
    for (const t of tiles) {
        const bx = Math.floor(t.x / side), by = Math.floor(t.y / side), key = `${bx}/${by}`;
        if (!blocks.has(key)) blocks.set(key, { bx, by, x0: bx * side, y0: by * side, side, tiles: [] });
        blocks.get(key).tiles.push(t);
    }
    const band = b => Math.floor(b.bx / strip);
    return [...blocks.values()].sort((a, b) => band(a) - band(b) || a.by - b.by || a.bx - b.bx);
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

// J2W : A,D,B,E,C,F, coordonnées du CENTRE du pixel haut-gauche.
function ftmParseWorldFile(text) {
    const values = String(text).replace(/^\uFEFF/, '').trim().split(/\s+/);
    if (values.length !== 6 || values.some(v => !Number.isFinite(Number(v)))) throw new Error('Le J2W doit contenir exactement six nombres valides.');
    const [a, b, c, d, e, f] = values.map(Number);
    if (a * d === b * c) throw new Error('La transformation du J2W est non inversible.');
    return [a, b, c, d, e - (a + c) / 2, f - (b + d) / 2];
}

function ftmEpsgFromText(text) {
    const s = String(text || '').trim();
    const direct = s.match(/EPSG(?::|\/)+(?:0\/)?(\d+)\s*$/i);
    if (direct) return Number(direct[1]);
    const wkt = [...s.matchAll(/(?:AUTHORITY|ID)\s*\[\s*["']EPSG["']\s*,\s*["']?(\d+)["']?\s*\]/gi)];
    return wkt.length ? Number(wkt[wkt.length - 1][1]) : null;
}

// Un world file ne contient aucun nom d'image : association par nom commun.
// Le navigateur doit recevoir explicitement les fichiers sélectionnés ensemble.
function ftmGroupInputFiles(files) {
    const list = Array.from(files);
    const images = list.filter(f => /\.(pdf|tiff?|jp2)$/i.test(f.name) || ['application/pdf', 'image/tiff'].includes(f.type));
    if (!images.length) throw new Error('Sélectionner le JP2 avec son J2W : le J2W seul ne contient pas l’image.');
    const file = images[0], jp2 = /\.jp2$/i.test(file.name);
    const worlds = list.filter(f => /\.(j2w|jp2w|wld)$/i.test(f.name));
    const xmls = list.filter(f => /\.xml$/i.test(f.name));
    if (images.length > 1 && images.some(f => !/\.jp2$/i.test(f.name))) throw new Error('La mosaïque accepte plusieurs JP2 ; ouvrir un PDF ou un GeoTIFF seul.');
    if (!jp2 && list.length > 1) throw new Error('Ouvrir un PDF ou un GeoTIFF seul. Les J2W et XML accompagnent les JP2.');
    if (images.length > 16) throw new Error('Sélectionner au plus 16 images JP2 par mosaïque.');
    const stem = f => f.name.replace(/\.(jp2|j2w|jp2w|wld)$/i, '').toLowerCase();
    const names = new Set();
    const groups = images.map(image => {
        const name = stem(image);
        if (names.has(name)) throw new Error('Deux images portent le même nom : ' + image.name);
        names.add(name);
        const matches = worlds.filter(w => stem(w) === name);
        if (matches.length > 1) throw new Error('Plusieurs J2W correspondent à ' + image.name);
        return { file: image, world: matches[0] || null, xml: null };
    });
    if (worlds.some(w => !names.has(stem(w)))) throw new Error('Chaque JP2 et son J2W doivent porter le même nom avant leur extension.');
    if (list.length !== images.length + worlds.length + xmls.length) throw new Error('Fichier non reconnu : choisir les JP2, leurs J2W et éventuellement leurs XML.');
    if (images.length === 1 && xmls.length === 1) groups[0].xml = xmls[0];
    return { ...groups[0], images: groups, xmls };
}

// Assemblage sans rééchantillonnage intermédiaire : même CRS, mêmes axes et
// résolution, origines sur la même grille à 0,05 pixel près. Les emprises
// doivent former un ensemble connecté par un bord ou un recouvrement.
function ftmMosaicLayout(sources) {
    const first = sources[0], inverse = ftmInvert(first.P), tolerance = 0.05;
    const rects = sources.map(src => {
        if (src.epsg !== first.epsg) throw new Error(`Projections différentes : ${src.name} (EPSG:${src.epsg}). Reprojeter les images dans le même système avant assemblage.`);
        const T = ftmMultiply(inverse, src.P);
        if (Math.max(Math.abs(T[0] - 1), Math.abs(T[1]), Math.abs(T[2]), Math.abs(T[3] - 1)) > 1e-7) {
            throw new Error(`Résolution ou orientation incompatible : ${src.name}. Les JP2 doivent utiliser la même grille de pixels.`);
        }
        const x = Math.round(T[4]), y = Math.round(T[5]);
        if (Math.abs(x - T[4]) > tolerance || Math.abs(y - T[5]) > tolerance) throw new Error(`Grilles de pixels décalées : ${src.name}. Recaler les images avant assemblage.`);
        return { x, y, w: src.width, h: src.height };
    });
    const connected = new Set([0]); let overlap = false;
    const touches = (a, b) => {
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (dx > 0 && dy > 0) overlap = true;
        return (dx >= 0 && dy > 0) || (dy >= 0 && dx > 0);
    };
    for (let pass = 0; pass < rects.length; pass++) {
        for (let i = 0; i < rects.length; i++) for (const j of connected) {
            if (i !== j && touches(rects[i], rects[j])) connected.add(i);
        }
    }
    if (connected.size !== sources.length) throw new Error('Images non jointives : ' + sources.filter((s, i) => !connected.has(i)).map(s => s.name).join(', ') + '. Vérifier les J2W et la projection ; un contact par un seul coin ne suffit pas.');
    const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
    return { x0, y0, width: Math.max(...rects.map(r => r.x + r.w)) - x0,
        height: Math.max(...rects.map(r => r.y + r.h)) - y0,
        offsets: rects.map(r => [r.x - x0, r.y - y0]), overlap };
}

function ftmPointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
}

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

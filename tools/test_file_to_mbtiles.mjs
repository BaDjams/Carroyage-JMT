// Tests de fileToMbtilesCore.js (« Générer un MBTiles depuis un fichier »),
// sans navigateur : node tools/test_file_to_mbtiles.mjs
//
// Lecture/écriture des .points de CadoTour, transformation source → Mercator
// (similitude et affine) et ses écarts, niveaux de zoom proposés, tuiles
// couvrant une zone, blocs, géoréférencement d'un GeoTIFF ; traces GPX/KML/GeoJSON
// et couloir autour d'une trace (« Créer MBTiles »).

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const context = { Math, Error, Array, Object, Number, String, Map, Set, Infinity, JSON };
vm.createContext(context);
vm.runInContext(readFileSync(`${ROOT}fileToMbtilesCore.js`, 'utf8') + `
;Object.assign(globalThis, { ftmLonLatToMerc, ftmMercToLonLat, ftmGroundResolution, ftmMercResolution,
  ftmParsePoints, ftmWritePoints, ftmFitTransform, ftmApply, ftmInvert, ftmMultiply, ftmResiduals,
  ftmDescribe, ftmZoomForResolution, ftmTextPercentile, ftmSuggestZooms, ftmClipPolygonToRect,
  ftmPolygonArea, ftmTilesForPolygons, ftmGroupBlocks, ftmMercToBlockMatrix, ftmParentTiles,
  ftmPyramidCounts, ftmLocalAffine, ftmGeoTiffPixelTransform, ftmGeoTiffEpsg, ftmProjDefinition,
  ftmSniffImage, ftmPrintScale, ftmGroupInputFiles, ftmParseWorldFile, ftmEpsgFromText,
  ftmParseTrackText, ftmCorridorPolygons, ftmTilesForZone, ftmJoinArrowHeads });`, context, { filename: 'fileToMbtilesCore.js' });
const C = context;
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Mercator : aller-retour, et résolution au sol', () => {
    const [X, Y] = C.ftmLonLatToMerc(2.3522, 48.8566);
    near(X, 261845.7, 0.1); near(Y, 6250564.3, 0.1);
    const [lon, lat] = C.ftmMercToLonLat(X, Y);
    near(lon, 2.3522, 1e-9); near(lat, 48.8566, 1e-9);
    near(C.ftmGroundResolution(20, 48.835), 0.0983, 1e-4);
});

test('.points de CadoTour : points non placés (source 0,0), retournement de sourceY', () => {
    const text = '#CRS: EPSG:4326\nmapX,mapY,sourceX,sourceY,enable,dX,dY,residual\n'
        + '2.30159819,48.84790926,0,0,1,0,0,0\n2.3116,48.8472,3141.5,-1053.5,1,0,0,0\n2.31,48.83,10,-20,0,0,0,0\n';
    const pts = plain(C.ftmParsePoints(text));
    assert.equal(pts.length, 3);
    assert.deepEqual(pts[0], { lon: 2.30159819, lat: 48.84790926, x: null, y: null, enabled: true });
    assert.deepEqual(pts[1], { lon: 2.3116, lat: 48.8472, x: 3141.5, y: 1053.5, enabled: true });
    assert.equal(pts[2].enabled, false);
    // Relecture de ce qu'on écrit : identique.
    assert.deepEqual(plain(C.ftmParsePoints(C.ftmWritePoints(pts))), pts);
    // Fichier sans en-tête de colonnes, fins de ligne Windows, BOM.
    assert.equal(C.ftmParsePoints('﻿2.1,48.1,1,-2,1\r\n2.2,48.2,0,0,1\r\n').length, 2);
});

test('.points dans un autre système : refusé avec un message clair', () => {
    assert.throws(() => C.ftmParsePoints('#CRS: EPSG:2154\nmapX,mapY,sourceX,sourceY,enable\n700000,6600000,1,-1,1\n'), /EPSG:4326/);
});

function pointsFrom(T, src) {
    return src.map(([x, y]) => { const [X, Y] = C.ftmApply(T, x, y); const [lon, lat] = C.ftmMercToLonLat(X, Y); return { x, y, lon, lat, enabled: true }; });
}

test('similitude : 2 points suffisent, écarts nuls, échelle et rotation retrouvées', () => {
    // Construction explicite d'une similitude avec retournement : X = p·x + q·y, Y = q·x − p·y.
    const lat0 = 48.84, s = 0.5 / Math.cos(lat0 * Math.PI / 180), t = 12 * Math.PI / 180;
    const [X0, Y0] = C.ftmLonLatToMerc(2.32, lat0);
    const T = [s * Math.cos(t), s * Math.sin(t), s * Math.sin(t), -s * Math.cos(t), X0, Y0];
    const pts = pointsFrom(T, [[100, 200], [3000, 2500]]);
    const F = C.ftmFitTransform(pts, 'similarity');
    for (let i = 0; i < 6; i++) near(F[i], T[i], Math.abs(T[i]) * 1e-6 + 1e-6, `coef ${i}`);
    const r = C.ftmResiduals(pts, F);
    assert.ok(r.rms < 1e-6);
    const d = C.ftmDescribe(F, lat0);
    near(d.metersPerUnit, 0.5, 1e-3);
    near(Math.abs(d.rotation), 12, 1e-6);
    // Un seul point placé : pas de transformation.
    assert.equal(C.ftmFitTransform([pts[0], { ...pts[1], x: null }], 'similarity'), null);
});

test('affine : 3 points non alignés, échelles différentes selon les axes', () => {
    const [X0, Y0] = C.ftmLonLatToMerc(2.32, 48.84);
    const T = [0.8, 0.05, 0.03, -0.6, X0, Y0];
    const pts = pointsFrom(T, [[0, 0], [1000, 100], [200, 900], [800, 800]]);
    const F = C.ftmFitTransform(pts, 'affine');
    for (let i = 0; i < 6; i++) near(F[i], T[i], 1e-5, `coef ${i}`);
    assert.equal(C.ftmFitTransform(pts.slice(0, 2), 'affine'), null);
    // Points alignés : refus.
    assert.equal(C.ftmFitTransform(pointsFrom(T, [[0, 0], [1, 1], [2, 2]]), 'affine'), null);
    // La similitude, elle, laisse un écart sur ce plan déformé, signalé en mètres.
    const S = C.ftmFitTransform(pts, 'similarity');
    assert.ok(C.ftmResiduals(pts, S).rms > 1);
    // Un point désactivé n'entre ni dans l'ajustement ni dans la moyenne.
    const res = C.ftmResiduals([...pts, { ...pts[0], enabled: false }], F);
    assert.equal(res.each.length, 5); assert.equal(res.each[4], null);
});

test('inverse et composition de matrices', () => {
    const T = [0.8, 0.05, 0.03, -0.6, 10, 20];
    const I = C.ftmMultiply(C.ftmInvert(T), T);
    [1, 0, 0, 1, 0, 0].forEach((v, i) => near(I[i], v, 1e-12));
});

test('zoom maximal : plus fin pixel d’image, ou texte lisible ; zoom minimal : zone de 512 px au moins', () => {
    // Le plan des carrières : 0,435 m par point, texte au 10e centile de 2 pt → zoom 20.
    const sizes = [{ size: 1.1, weight: 5 }, { size: 2, weight: 10 }, { size: 6.2, weight: 30 }, { size: 8.1, weight: 55 }];
    near(C.ftmTextPercentile(sizes), 2, 0);
    const z = C.ftmSuggestZooms({ metersPerUnit: 0.435, lat: 48.835, textSizes: sizes, spanMeters: 3900 });
    assert.equal(z.zmax, 20);
    assert.equal(z.reasons[0].kind, 'text');
    // Zone de 3,9 km : 620 px au zoom 14 (6,3 m/px), 310 px seulement au zoom 13.
    assert.equal(z.zmin, 14);
    // Image scannée à 300 ppp d'un plan au 1/1000 : 1 pt = 0,353 m, 4,17 px par pt → 8,5 cm/px → zoom 21.
    const r = C.ftmSuggestZooms({ metersPerUnit: 0.3528, lat: 45, rasterPxPerUnit: 300 / 72, spanMeters: 800 });
    assert.equal(r.zmax, ftmCeilZoom(0.3528 / (300 / 72), 45));
    // Ni texte ni image : 2 px par unité.
    assert.equal(C.ftmSuggestZooms({ metersPerUnit: 1, lat: 0, spanMeters: 100 }).reasons[0].kind, 'default');
});
function ftmCeilZoom(res, lat) { return Math.ceil(Math.log2(C.ftmGroundResolution(0, lat) / res)); }

test('découpe d’un polygone par un rectangle, et tuiles couvertes', () => {
    const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
    near(C.ftmPolygonArea(C.ftmClipPolygonToRect(sq, 5, 5, 20, 20)), 25, 1e-9);
    assert.equal(C.ftmClipPolygonToRect(sq, 20, 20, 30, 30).length, 0);
    assert.equal(C.ftmTilesForPolygons([sq], 0).length, 1, 'une petite zone doit aussi avoir son MNT au zoom 0');
    near(C.ftmPolygonArea(sq.map(([x, y]) => [x + 1e7, y + 1e7])), 100, 1e-9);
    // Triangle en Mercator au zoom 16 : seules les tuiles qu'il recoupe.
    const z = 16, r = C.ftmMercResolution(z) * 256;
    const X0 = -Math.PI * 6378137 + 1000 * r, Y0 = Math.PI * 6378137 - 1000 * r;
    const tri = [[X0 + 0.1 * r, Y0 - 0.1 * r], [X0 + 2.9 * r, Y0 - 0.1 * r], [X0 + 0.1 * r, Y0 - 2.9 * r]];
    const tiles = plain(C.ftmTilesForPolygons([tri], z)).map(t => `${t.x - 1000},${t.y - 1000}`).sort();
    assert.deepEqual(tiles, ['0,0', '0,1', '0,2', '1,0', '1,1', '2,0'].sort());
});

test('blocs, matrice Mercator → bloc, pyramide', () => {
    const tiles = [{ x: 0, y: 0 }, { x: 7, y: 7 }, { x: 8, y: 0 }, { x: 9, y: 9 }];
    const blocks = plain(C.ftmGroupBlocks(tiles, 8));
    assert.deepEqual(blocks.map(b => [b.bx, b.by, b.tiles.length]), [[0, 0, 2], [1, 0, 1], [1, 1, 1]]);
    // Bandes verticales de deux blocs, chacune parcourue de haut en bas.
    const grid = [];
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 4; bx++) grid.push({ x: bx * 8, y: by * 8 });
    assert.deepEqual(plain(C.ftmGroupBlocks(grid, 8, 2)).map(b => `${b.bx},${b.by}`),
        ['0,0', '1,0', '0,1', '1,1', '2,0', '3,0', '2,1', '3,1']);
    // Le coin haut-gauche de la tuile (x0, y0) tombe au pixel (0, 0) du bloc.
    const z = 18, M = C.ftmMercToBlockMatrix(z, 1234, 5678), r = C.ftmMercResolution(z) * 256;
    const [u, v] = C.ftmApply(M, -Math.PI * 6378137 + 1234 * r, Math.PI * 6378137 - 5678 * r);
    near(u, 0, 1e-6); near(v, 0, 1e-6);
    const [u2, v2] = C.ftmApply(M, -Math.PI * 6378137 + 1235 * r, Math.PI * 6378137 - 5679 * r);
    near(u2, 256, 1e-6); near(v2, 256, 1e-6);
    assert.deepEqual(plain(C.ftmPyramidCounts([{ x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 4 }], 2, 3)), { 2: 2, 3: 3 });
});

test('approximation affine locale d’une projection : écart mesuré', () => {
    const f = (x, y) => [x + 1e-6 * x * x, y];
    const { T, err } = C.ftmLocalAffine(f, 0, 0, 1000, 1000);
    assert.ok(err > 0 && err < 0.2, `écart ${err}`);
    near(T[0], 1.001, 1e-3);
});

test('GeoTIFF : tiepoint + taille de pixel, ModelTransformation, PixelIsPoint, EPSG', () => {
    const T = C.ftmGeoTiffPixelTransform({ ModelTiepoint: [0, 0, 0, 650000, 6860000, 0], ModelPixelScale: [0.5, 0.5, 0] });
    assert.deepEqual(plain(C.ftmApply(T, 10, 20)), [650005, 6859990]);
    const M = C.ftmGeoTiffPixelTransform({ ModelTransformation: [0.5, 0, 0, 650000, 0, -0.5, 0, 6860000, 0, 0, 0, 0, 0, 0, 0, 1] });
    assert.deepEqual(plain(M), plain(T));
    const P = C.ftmGeoTiffPixelTransform({ ModelTiepoint: [0, 0, 0, 650000, 6860000, 0], ModelPixelScale: [1, 1, 0] }, { GTRasterTypeGeoKey: 2 });
    assert.deepEqual(plain(C.ftmApply(P, 0, 0)), [649999.5, 6860000.5]);
    assert.equal(C.ftmGeoTiffPixelTransform({}), null);
    assert.equal(C.ftmGeoTiffEpsg({ ProjectedCSTypeGeoKey: 2154, GeographicTypeGeoKey: 4171 }), 2154);
    assert.equal(C.ftmGeoTiffEpsg({ GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 4326 }), 4326);
    assert.match(C.ftmProjDefinition(2154), /lcc/);
    assert.match(C.ftmProjDefinition(32631), /zone=31 /);
    assert.match(C.ftmProjDefinition(32731), /south/);
    assert.match(C.ftmProjDefinition(3948), /lat_0=48 .*y_0=7200000/);
    assert.equal(C.ftmProjDefinition(9999), null);
});

test('JP2 : association explicite des fichiers, casse et noms communs', () => {
    const jp2 = { name: 'IMAGE.JP2' }, world = { name: 'image.J2W' }, xml = { name: 'DIM_IMAGE.XML' };
    const grouped = C.ftmGroupInputFiles([xml, world, jp2]);
    assert.equal(grouped.file, jp2); assert.equal(grouped.world, world); assert.equal(grouped.xml, xml);
    assert.equal(C.ftmGroupInputFiles([jp2]).world, null);
    assert.equal(C.ftmGroupInputFiles([{ name: 'plan.pdf' }]).file.name, 'plan.pdf');
    assert.throws(() => C.ftmGroupInputFiles([world]), /J2W seul/);
    assert.throws(() => C.ftmGroupInputFiles([jp2, { name: 'autre.j2w' }]), /même nom/);
    const second = { name: 'autre.jp2' }, secondWorld = { name: 'autre.j2w' };
    const multiple = C.ftmGroupInputFiles([jp2, xml, world, secondWorld, second]);
    assert.equal(multiple.images.length, 2);
    assert.equal(multiple.images[1].world, secondWorld);
    assert.equal(multiple.xmls[0], xml);
    assert.throws(() => C.ftmGroupInputFiles([jp2, { name: 'image.jp2' }]), /même nom/);
    assert.throws(() => C.ftmGroupInputFiles([jp2, world, { name: 'IMAGE.wld' }]), /Plusieurs J2W/);
    assert.throws(() => C.ftmGroupInputFiles([jp2, { name: 'plan.pdf' }]), /PDF.*seul/);
});

test('mosaïque : raccord, recouvrement, chaîne, rotation et erreurs de grille', () => {
    const src = (name, x, y, extra = {}) => ({ name, width: 100, height: 80, epsg: 3857, P: [2, 0, 0, -2, x, y], ...extra });
    const a = src('a', 1000, 2000), b = src('b', 1200, 2000), c = src('c', 1400, 2000);
    const layout = C.ftmMosaicLayout([a, c, b]);
    assert.equal(layout.width, 300); assert.equal(layout.height, 80); assert.equal(layout.overlap, false);
    assert.deepEqual(plain(layout.offsets), [[0, 0], [200, 0], [100, 0]]);
    assert.equal(C.ftmMosaicLayout([a, src('b', 1190, 2000)]).overlap, true);
    assert.deepEqual(plain(C.ftmMosaicLayout([b, a]).offsets), [[100, 0], [0, 0]]);
    const rotated = [2, 1, 1, -2, 1000, 2000];
    assert.equal(C.ftmMosaicLayout([src('a', 0, 0, { P: rotated }), src('b', 0, 0, { P: C.ftmMultiply(rotated, [1, 0, 0, 1, 100, 0]) })]).width, 200);
    assert.throws(() => C.ftmMosaicLayout([a, c]), /non jointives/);
    assert.throws(() => C.ftmMosaicLayout([a, src('b', 1200, 1840)]), /seul coin/);
    assert.throws(() => C.ftmMosaicLayout([a, { ...b, epsg: 4326 }]), /Projections différentes/);
    assert.throws(() => C.ftmMosaicLayout([a, src('b', 1200.5, 2000)]), /décalées/);
    assert.throws(() => C.ftmMosaicLayout([a, { ...b, P: [1, 0, 0, -1, 1200, 2000] }]), /Résolution ou orientation/);
});

test('sélection de polygone : intérieur et extérieur', () => {
    const concave = [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]];
    assert.equal(C.ftmPointInPolygon([5, 2], concave), true);
    assert.equal(C.ftmPointInPolygon([5, 9], concave), false);
    assert.equal(C.ftmPointInPolygon([11, 2], concave), false);
});

test('J2W : centre du pixel, rotation, validation et projection explicite', () => {
    assert.deepEqual(plain(C.ftmParseWorldFile('\uFEFF2\r\n0\r\n0\r\n-3\r\n100\r\n200')), [2, 0, 0, -3, 99, 201.5]);
    const rotated = C.ftmParseWorldFile('2\n1\n3\n-4\n100\n200');
    assert.deepEqual(plain(C.ftmApply(rotated, 0.5, 0.5)), [100, 200]);
    assert.throws(() => C.ftmParseWorldFile('1 2 3 4 5'), /six nombres/);
    assert.throws(() => C.ftmParseWorldFile('1 0 0 0 0 0'), /non inversible/);
    assert.throws(() => C.ftmParseWorldFile('1 0 0 -1 Infinity 0'), /valides/);
    assert.equal(C.ftmEpsgFromText('urn:ogc:def:crs:EPSG::4326'), 4326);
    assert.equal(C.ftmEpsgFromText('http://www.opengis.net/def/crs/EPSG/0/2154'), 2154);
    assert.equal(C.ftmEpsgFromText('PROJCS["Lambert",GEOGCS["RGF93",AUTHORITY["EPSG","4171"]],AUTHORITY["EPSG","2154"]]'), 2154);
    assert.equal(C.ftmEpsgFromText('une page de présentation'), null);
});

test('format d’image et échelle d’impression', () => {
    assert.equal(C.ftmSniffImage([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]), 'png');
    assert.equal(C.ftmSniffImage([0xFF, 0xD8, 0xFF]), 'jpg');
    assert.equal(C.ftmSniffImage([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'webp');
    near(C.ftmPrintScale(0.3528), 1000, 0.1);
});

test('traces : GPX (segments, routes), KML (lignes, surfaces), GeoJSON', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><name>a</name>
        <trkseg><trkpt lat="48.1" lon="-4.5"><ele>3</ele></trkpt><trkpt lon="-4.4" lat="48.2"/></trkseg>
        <trkseg><trkpt lat='48.3' lon='-4.3'/></trkseg></trk>
        <rte><rtept lat="47" lon="2"/><rtept lat="47.1" lon="2.1"/></rte><wpt lat="1" lon="1"/></gpx>`;
    assert.deepEqual(plain(C.ftmParseTrackText(gpx)), { lines: [[[-4.5, 48.1], [-4.4, 48.2]], [[-4.3, 48.3]], [[2, 47], [2.1, 47.1]]], polygons: [] });
    const kml = `<kml><Document><Placemark><LineString><coordinates> 2,45,0 2.1,45.1,0
        2.2,45.2 </coordinates></LineString></Placemark><Placemark><Polygon><outerBoundaryIs><LinearRing>
        <coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    assert.deepEqual(plain(C.ftmParseTrackText(kml)), { lines: [[[2, 45, 0], [2.1, 45.1, 0], [2.2, 45.2]]], polygons: [[[1, 1], [2, 1], [2, 2], [1, 1]]] });
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]] } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] } }] });
    assert.deepEqual(plain(C.ftmParseTrackText(gj)), { lines: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]], polygons: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    assert.throws(() => C.ftmParseTrackText('lat;lon\n1;2'), /non reconnu/);
    assert.throws(() => C.ftmParseTrackText('{ pas du json'), /GeoJSON illisible/);
});

// Fichiers .kml d'un KMZ (ZIP), lus par le répertoire central — de quoi ouvrir
// la fixture sans dépendance.
function kmlDuKmz(buffer) {
    const b = Buffer.from(buffer), textes = [];
    let eocd = b.length - 22;
    while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    let p = b.readUInt32LE(eocd + 16);
    for (let i = 0; i < b.readUInt16LE(eocd + 10); i++) {
        const methode = b.readUInt16LE(p + 10), taille = b.readUInt32LE(p + 20);
        const nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
        const nom = b.toString('utf8', p + 46, p + 46 + nl);
        const debut = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
        const data = b.subarray(debut, debut + taille);
        if (/\.kml$/i.test(nom)) textes.push((methode === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
        p += 46 + nl + el + cl;
    }
    return textes;
}

test('KMZ exporté par CadoTour : flèches, polyligne, trace enregistrée, itinéraire', () => {
    // tools/fixtures/cadotour/traces-cadotour.kmz, écrit par le code d'export de CadoTour.
    const [kml] = kmlDuKmz(readFileSync(`${ROOT}tools/fixtures/cadotour/traces-cadotour.kmz`));
    const { lines, polygons } = plain(C.ftmParseTrackText(kml));
    // Les trois pointes ont rejoint leur trait : plus aucune surface.
    assert.equal(polygons.length, 0);
    assert.equal(lines.length, 5);
    const bouts = lines.map(l => [l[0].slice(0, 2), l[l.length - 1].slice(0, 2)]);
    // Flèche « Axe nord » : le trait va désormais jusqu'au sommet, le dernier point dessiné.
    assert.deepEqual(bouts[0], [[-4.5, 48.38], [-4.44, 48.4]]);
    // Polyligne, intacte.
    assert.deepEqual(lines[1].map(p => p.slice(0, 2)), [[-4.44, 48.4], [-4.43, 48.42], [-4.425, 48.44]]);
    // Flèche à deux pointes, sans nom : prolongée à ses deux bouts.
    assert.deepEqual(bouts[2], [[-4.52, 48.36], [-4.505, 48.365]]);
    // Trace enregistrée et itinéraire.
    assert.deepEqual(bouts[3], [[-4.425, 48.44], [-4.4, 48.46]]);
    assert.deepEqual(bouts[4], [[-4.4, 48.46], [-4.39, 48.47]]);
});

test('gx:Track (traces enregistrées de Google Earth), triangle sans trait gardé', () => {
    const kml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><gx:MultiTrack><gx:Track>
        <when>2026-10-20T08:00:00Z</when><when>2026-10-20T08:01:00Z</when>
        <gx:coord>-4.5 48.3 12</gx:coord><gx:coord>-4.49 48.31 15</gx:coord></gx:Track></gx:MultiTrack></Placemark>
        <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 0.5,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
        </Document></kml>`;
    const r = plain(C.ftmParseTrackText(kml));
    assert.deepEqual(r.lines, [[[-4.5, 48.3, 12], [-4.49, 48.31, 15]]]);
    assert.equal(r.polygons.length, 1);
});

// Distance AU SOL (mètres, approchée localement) entre une tuile et un segment.
function distanceTuileSegment(z, x, y, a, b) {
    const n = 2 ** z, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
    const lat0 = (a[1] + b[1]) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    const P = ([lo, la]) => [lo * kx, la * ky];
    const r = { x0: lon(x) * kx, x1: lon(x + 1) * kx, y0: lat(y + 1) * ky, y1: lat(y) * ky };
    const [A, B] = [P(a), P(b)];
    const dPointRect = ([px, py]) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.y0 - py, 0, py - r.y1));
    const dPointSeg = ([px, py]) => {
        const dx = B[0] - A[0], dy = B[1] - A[1], t = Math.max(0, Math.min(1, ((px - A[0]) * dx + (py - A[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(px - A[0] - t * dx, py - A[1] - t * dy);
    };
    // Le segment traverse-t-il la tuile ? Échantillonnage fin : assez pour ce test.
    for (let i = 0; i <= 200; i++) { const t = i / 200; if (dPointRect([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]) === 0) return 0; }
    return Math.min(dPointRect(A), dPointRect(B), ...[[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y0], [r.x1, r.y1]].map(dPointSeg));
}

test('couloir autour d’une trace : toutes les tuiles à portée, aucune au-delà', () => {
    // Trace en coude, en Bretagne, couloir de 500 m de part et d'autre, zoom 15.
    const trace = [[-4.50, 48.38], [-4.42, 48.40], [-4.40, 48.46]];
    const z = 15, d = 500;
    const tuiles = plain(C.ftmTilesForZone(C.ftmCorridorPolygons(trace, d), z));
    const cles = new Set(tuiles.map(t => `${t.x},${t.y}`));
    assert.equal(cles.size, tuiles.length, 'chaque tuile une seule fois');
    const n = 2 ** z, col = lon => Math.floor((lon + 180) / 360 * n);
    const rang = lat => Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * n);
    let dedans = 0;
    for (let x = col(-4.53); x <= col(-4.37); x++) {
        for (let y = rang(48.49); y <= rang(48.35); y++) {
            const dist = Math.min(...trace.slice(1).map((b, i) => distanceTuileSegment(z, x, y, trace[i], b)));
            if (dist <= d * 0.98) { assert.ok(cles.has(`${x},${y}`), `tuile ${x},${y} à ${dist.toFixed(0)} m omise`); dedans++; }
            if (dist >= d * 1.05) assert.ok(!cles.has(`${x},${y}`), `tuile ${x},${y} à ${dist.toFixed(0)} m retenue`);
        }
    }
    assert.ok(dedans > 30, `assez de tuiles examinées (${dedans})`);
    // Un point seul : un disque ; aucune distance : rien.
    assert.ok(C.ftmTilesForZone(C.ftmCorridorPolygons([[-4.5, 48.4]], 300), 16).length >= 4);
    assert.equal(C.ftmCorridorPolygons(trace, 0).length, 0);
    assert.throws(() => C.ftmTilesForZone(C.ftmCorridorPolygons(trace, d), z, 10), /Trop de tuiles/);
});

let failed = 0;
for (const t of tests) {
    try { await t.fn(); console.log(`ok - ${t.name}`); }
    catch (e) { failed++; console.log(`ÉCHEC - ${t.name}\n${e.stack}`); }
}
console.log(failed ? `${failed} échec(s) sur ${tests.length}` : `${tests.length} tests réussis`);
process.exit(failed ? 1 : 0);

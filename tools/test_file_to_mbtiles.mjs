// Tests de fileToMbtilesCore.js (« Générer un MBTiles depuis un fichier »),
// sans navigateur : node tools/test_file_to_mbtiles.mjs
//
// Lecture/écriture des .points de CadoTour, transformation source → Mercator
// (similitude et affine) et ses écarts, niveaux de zoom proposés, tuiles
// couvrant une zone, blocs, géoréférencement d'un GeoTIFF.

import { readFileSync } from 'node:fs';
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
  ftmSniffImage, ftmPrintScale });`, context, { filename: 'fileToMbtilesCore.js' });
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

test('format d’image et échelle d’impression', () => {
    assert.equal(C.ftmSniffImage([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]), 'png');
    assert.equal(C.ftmSniffImage([0xFF, 0xD8, 0xFF]), 'jpg');
    assert.equal(C.ftmSniffImage([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'webp');
    near(C.ftmPrintScale(0.3528), 1000, 0.1);
});

let failed = 0;
for (const t of tests) {
    try { await t.fn(); console.log(`ok - ${t.name}`); }
    catch (e) { failed++; console.log(`ÉCHEC - ${t.name}\n${e.stack}`); }
}
console.log(failed ? `${failed} échec(s) sur ${tests.length}` : `${tests.length} tests réussis`);
process.exit(failed ? 1 : 0);

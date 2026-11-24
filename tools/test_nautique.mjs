// Tests du carroyage nautique (carroyageNautique.js), sans navigateur :
// node tools/test_nautique.mjs
//
// Identifiants et calage vérifiés sur des mailles OFFICIELLES (CNIG-GIMeL, Manche).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const context = { Math, Error, Number, String, Array, Object, JSON };
vm.createContext(context);
vm.runInContext(readFileSync(`${ROOT}carroyageNautique.js`, 'utf8') + '\nglobalThis.NAUTIC_UTILS = NAUTIC_UTILS;', context, { filename: 'carroyageNautique.js' });
const U = context.NAUTIC_UTILS;
const official = JSON.parse(readFileSync(`${ROOT}tools/fixtures/nautique-official-cells.json`, 'utf8')).cells;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('mailles officielles : identifiant et bornes retrouvés depuis le centre', () => {
    for (const c of official) {
        const lat = (c.south + c.north) / 2, lon = (c.west + c.east) / 2;
        const l = U.lattice({ south: lat, north: lat, west: lon, east: lon }, c.step);
        assert.equal(l.numRows * l.numCols, 1);
        const b = U.cellBounds(c.step, l.rowMin, l.colMin);
        // 1' : nom officiel (coin sud-ouest). 3' : nom cohérent INSPIRE (coin sud-ouest),
        // le nom officiel (coin nord-ouest) restant disponible.
        if (c.step === 1) assert.equal(U.cellId(1, l.rowMin, l.colMin), c.id);
        else assert.equal(U.officialId3(l.rowMin, l.colMin), c.id);
        for (const k of ['south', 'north', 'west', 'east']) near(b[k], c[k]);
    }
});

test('treillis : une bbox calée sur les minutes ne déborde pas d\'une maille', () => {
    const l = U.lattice({ south: 49, north: 49.05, west: 0, east: 0.05 }, 3);
    assert.equal(l.numRows, 1); assert.equal(l.numCols, 1);
    const l1 = U.lattice({ south: 49, north: 49.05, west: 0, east: 0.05 }, 1);
    assert.equal(l1.numRows, 3); assert.equal(l1.numCols, 3);
});

test('identifiants : méridien de Greenwich et hémisphère ouest', () => {
    assert.equal(U.cellId(1, 49 * 60 + 21, 0), '1_4921_N_0000');
    assert.equal(U.cellId(3, 49 * 20 + 6, -10), '3_4918_N_0030_W');
    assert.equal(U.officialId3(49 * 20 + 6, -10), '3_04935_N_00050_W');
});

test('cohérence INSPIRE : même coin sud-ouest = même suffixe en 1\' et en 3\'', () => {
    for (const [row3, col3] of [[986, -10], [987, 0], [1000, 40]]) {
        const id3 = U.cellId(3, row3, col3);
        const id1 = U.cellId(1, row3 * 3, col3 * 3);
        assert.equal(id3.slice(1), id1.slice(1));
    }
});

test('lignes : un sommet par méridien sur chaque parallèle, majeures toutes les 10 mailles', () => {
    const l = U.lattice({ south: 49, north: 49.5, west: 0, east: 0.5 }, 1);
    const lines = U.lines(l);
    const par = lines.filter(x => x.type === 'parallel');
    assert.equal(par.length, l.numRows + 1);
    assert.equal(par[0].coordinates.length, l.numCols + 1);
    assert.ok(lines.filter(x => x.major).every(x => x.minutes % 10 === 0));
});

test('libellés : « 49°18\'N », Greenwich sans suffixe', () => {
    assert.equal(U.formatLat(49 * 60 + 18), "49°18'N");
    assert.equal(U.formatLon(0), "0°00'");
    assert.equal(U.formatLon(-4), "0°04'W");
});

test('limites : trop de mailles est refusé, libellés coupés au-delà de 3000', () => {
    assert.throws(() => U.lattice({ south: 40, north: 50, west: 0, east: 10 }, 1), /dépasse/);
    assert.equal(U.labelsAllowed(U.lattice({ south: 49, north: 51, west: 0, east: 2 }, 1)), false);
});

test('GeoJSON et KML : une maille = un polygone / un libellé', () => {
    const bbox = { south: 49.3, north: 49.4, west: 0.1, east: 0.2 };
    const l = U.lattice(bbox, 1);
    assert.equal(JSON.parse(U.geoJSON(bbox, 1)).features.length, l.numRows * l.numCols);
    const kml = U.kmlFolder(bbox, 1);
    assert.equal((kml.match(/#commonLabelStyle/g) || []).length, l.numRows * l.numCols);
    // Chaque libellé est masqué de loin : Region/Lod avant la géométrie, après le style.
    assert.equal((kml.match(/<minLodPixels>160<\/minLodPixels>/g) || []).length, l.numRows * l.numCols);
    assert.ok(/<styleUrl>#commonLabelStyle<\/styleUrl><Region>.*?<\/Region><Point>/.test(kml));
});

let failed = 0;
for (const t of tests) {
    try { t.fn(); console.log('ok   ' + t.name); } catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + e.message); }
}
console.log(failed ? `${failed} échec(s)` : `${tests.length} tests passés`);
process.exit(failed ? 1 : 0);

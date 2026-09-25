// Tests de zoneBands.js (export de zone par bandes), sans navigateur :
// node tools/test_zone_bands.mjs
//
// Découpage en bandes, taille annoncée et format d'impression (mêmes règles que
// CadoTour, exportFraming.js), et contexte enregistreur : ce qu'il rejoue sur un
// bloc doit être exactement ce qu'on lui a fait dessiner.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const context = { Math, Error, Array, Object, Number, String, Set, Proxy, TextEncoder, Blob, CompressionStream,
    Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, Float64Array, DataView, Promise,
    DOMMatrix: class { constructor(m = [1, 0, 0, 1, 0, 0]) { this.m = m; } multiply(o) {
        const [a, b, c, d, e, f] = this.m, [A, B, C, D, E, F] = o.m;
        return new context.DOMMatrix([a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]);
    } static fromMatrix(m) { return m; } } };
context.window = context;
vm.createContext(context);
for (const f of ['imageStream.js', 'zoneBands.js']) vm.runInContext(readFileSync(`${ROOT}${f}`, 'utf8'), context, { filename: f });
const { zoneExportBands, createRecordingContext, printSuggestion, describeZoneImage } = context;
const plain = (x) => JSON.parse(JSON.stringify(x));
const nbsp = t => t.replace(/[  ]/g, ' ');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('bandes : hauteur multiple de 16 sous le budget mémoire, blocs bornés, restes au bout', () => {
    const bands = plain(zoneExportBands(10000, 5000, { unit: 2, blockSide: 4096, bandBytes: 64 * 1024 * 1024 }));
    assert.deepEqual(bands.map(b => [b.y, b.h]), [[0, 1664], [1664, 1664], [3328, 1664], [4992, 8]]);
    assert.deepEqual(bands[0].blocks, [{ x: 0, w: 4096 }, { x: 4096, w: 4096 }, { x: 8192, w: 1808 }]);
    // Upscale ×3 : blocs et bandes multiples de 3 (un nombre entier de pixels natifs).
    for (const b of zoneExportBands(9000, 9000, { unit: 3 })) {
        assert.equal(b.y % 3, 0);
        for (const k of b.blocks) assert.equal(k.x % 3, 0);
    }
    assert.deepEqual(plain(zoneExportBands(4000000, 40)).map(b => b.h), [16, 16, 8]);
    assert.deepEqual(plain(zoneExportBands(300, 200)), [{ y: 0, h: 200, blocks: [{ x: 0, w: 300 }] }]);
});

test('impression conseillée : mêmes seuils que CadoTour', () => {
    assert.equal(printSuggestion(4961, 3508), 'Impression nette jusqu’au A3 (300 ppp), correcte jusqu’au A2 (212 ppp).');
    assert.equal(printSuggestion(14100, 9975), 'Impression nette jusqu’au A0 (301 ppp).');
    assert.equal(printSuggestion(1500, 1060), 'Impression correcte jusqu’au A5 (181 ppp).');
    assert.equal(printSuggestion(800, 560), 'Impression : moins de 150 ppp, même en A5 — augmentez le zoom.');
});

test('annonce : taille, impression, grande taille, par bandes, limites des formats', () => {
    const ok = describeZoneImage(3840, 2160, 'jpeg');
    assert.deepEqual([ok.level, nbsp(ok.size), ok.banded], ['ok', 'Image : 3 840 × 2 160 px.', false]);
    assert.match(ok.print, /^Impression nette/);
    const grande = describeZoneImage(9000, 8000, 'png');
    assert.deepEqual([grande.level, grande.banded], ['large', true]);
    assert.equal(grande.note, 'Fichier de grande taille : sa génération peut ralentir l’ordinateur.');
    assert.equal(describeZoneImage(16385, 100, 'png').banded, true);
    // JPEG : 65 535 px de côté ; GeoTIFF UTM : d'un seul tenant seulement.
    assert.equal(describeZoneImage(70000, 100, 'jpeg').level, 'error');
    assert.equal(describeZoneImage(70000, 100, 'png').level, 'ok');
    assert.equal(describeZoneImage(70000, 100, 'geotiff').level, 'ok');
    const utm = describeZoneImage(20000, 100, 'geotiff-utm');
    assert.equal(utm.level, 'error');
    assert.match(nbsp(utm.note), /GeoTIFF UTM.*16 384 px/);
    assert.equal(describeZoneImage(8000, 8000, 'geotiff-utm').level, 'large');   // 64 Mpx : d'un seul tenant, grande
});

// Contexte factice : consigne tout ce qu'on lui fait.
function fakeContext() {
    const log = [], state = { font: '10px sans-serif', lineWidth: 1 };
    return new Proxy(state, {
        get(t, p) {
            if (p === 'log') return log;
            if (p in t) return t[p];
            if (p === 'measureText') return (s) => ({ width: s.length * parseInt(t.font, 10) / 2 });
            if (p === 'createLinearGradient') return () => ({ gradient: true, addColorStop() {} });
            return (...args) => { log.push([p, ...args]); };
        },
        set(t, p, v) { t[p] = v; log.push(['=', p, v]); return true; },
    });
}

test('enregistreur : taille de l’image entière, carte de luminance, mesures justes', () => {
    const mirror = fakeContext();
    const lum = { cols: 2, rows: 2 };
    const rec = createRecordingContext(20000, 15000, { luminanceMap: lum, mirror });
    assert.deepEqual([rec.ctx.canvas.width, rec.ctx.canvas.height], [20000, 15000]);
    assert.equal(rec.ctx.luminanceMap, lum);
    rec.ctx.font = '20px sans-serif';
    assert.equal(rec.ctx.measureText('abcd').width, 40);            // mesure au corps courant
    assert.equal(rec.ctx.font, '20px sans-serif');                   // état relu
    assert.throws(() => rec.ctx.getImageData(0, 0, 1, 1), /enregistrement/);
    assert.equal(mirror.log.filter(e => e[0] === 'stroke').length, 0, 'le miroir ne dessine rien');
});

test('enregistreur : rejoue à l’identique, setTransform composé avec le décalage du bloc', () => {
    const rec = createRecordingContext(100, 100, { mirror: fakeContext() });
    const g = rec.ctx.createLinearGradient(0, 0, 10, 0);
    rec.ctx.save();
    rec.ctx.strokeStyle = g;
    rec.ctx.lineWidth = 3;
    rec.ctx.beginPath(); rec.ctx.moveTo(1, 2); rec.ctx.lineTo(30, 40); rec.ctx.stroke();
    rec.ctx.setTransform(1, 0, 0, 1, 5, 6);
    rec.ctx.fillText('A1', 10, 20);
    rec.ctx.resetTransform();
    rec.ctx.restore();
    assert.equal(rec.size, 11);   // créer un dégradé est une lecture, pas un ordre de dessin
    const target = fakeContext();
    const base = new context.DOMMatrix([1, 0, 0, 1, -50, -60]);    // bloc (50, 60)
    rec.replay(target, base);
    assert.deepEqual(plain(target.log.map(e => e[0])), ['save', '=', '=', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setTransform', 'fillText', 'setTransform', 'restore']);
    assert.equal(target.log[1][2], g);                                // le même dégradé
    assert.deepEqual(plain(target.log.find(e => e[0] === 'setTransform')[1].m), [1, 0, 0, 1, -45, -54]);
    assert.deepEqual(plain(target.log.filter(e => e[0] === 'setTransform')[1][1].m), [1, 0, 0, 1, -50, -60]);
    // Sans base : rejeu littéral.
    const raw = fakeContext();
    rec.replay(raw);
    assert.deepEqual(plain(raw.log.find(e => e[0] === 'setTransform')).slice(1), [1, 0, 0, 1, 5, 6]);
});

let failed = 0;
for (const { name, fn } of tests) {
    try {
        await fn();
        console.log(`ok   ${name}`);
    } catch (e) {
        failed++;
        console.log(`ÉCHEC ${name}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e}`);
    }
}
console.log(`\n${tests.length - failed}/${tests.length} tests réussis`);
process.exit(failed ? 1 : 0);

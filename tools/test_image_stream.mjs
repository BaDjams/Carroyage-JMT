// Tests de imageStream.js (encodeurs PNG et JPEG par bandes), sans navigateur :
// node tools/test_image_stream.mjs
//
// Le module est chargé tel que le navigateur le charge (script classique). Les
// fichiers écrits sont DÉCODÉS : une erreur d'encodage ne se verrait sinon qu'à
// l'ouverture du fichier, chez celui qui l'a reçu. Si le dépôt CadoTour est voisin
// (../VirtualTour), la copie conforme est vérifiée octet pour octet.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = readFileSync(`${ROOT}imageStream.js`, 'utf8');

const context = {
    TextEncoder, Blob, CompressionStream, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array,
    Float64Array, DataView, Math, Error, Array, Promise, Object, Number, String,
};
context.window = context;
vm.createContext(context);
vm.runInContext(SOURCE, context, { filename: 'imageStream.js' });
const { createPngStream, createJpegStream, crc32, JPEG_MAX_SIDE, jpegQuantTable } = context;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function testImage(width, height, { noise = false } = {}) {
    const px = new Uint8ClampedArray(width * height * 4);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            px[i] = (x * 255) / width;
            px[i + 1] = (y * 255) / height;
            px[i + 2] = noise ? rnd() * 255 : 128 + 60 * Math.sin(x / 7);
            px[i + 3] = 255;
        }
    }
    return px;
}

async function encode(stream, px, width, height, bands = [7, 1, 16, 23]) {
    for (let y = 0, b = 0; y < height; b++) {
        const rows = Math.min(bands[b % bands.length], height - y);
        await stream.write(px.subarray(y * width * 4, (y + rows) * width * 4), rows);
        y += rows;
    }
    return new Uint8Array(await (await stream.finish()).arrayBuffer());
}

function decodePng(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const chunks = [];
    for (let o = 8; o < bytes.length;) {
        const len = dv.getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
        assert.equal(dv.getUint32(o + 8 + len), (crc32(bytes.subarray(o + 4, o + 8 + len)) ^ 0xffffffff) >>> 0, `CRC ${type}`);
        chunks.push({ type, data: bytes.subarray(o + 8, o + 8 + len) });
        o += 12 + len;
    }
    const ih = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    const width = ih.getUint32(0), height = ih.getUint32(4), channels = chunks[0].data[9] === 6 ? 4 : 3;
    const rowBytes = width * channels;
    const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
    const out = new Uint8Array(height * rowBytes);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (rowBytes + 1)], src = y * (rowBytes + 1) + 1;
        for (let i = 0; i < rowBytes; i++) {
            const left = i >= channels ? out[y * rowBytes + i - channels] : 0, up = y ? out[(y - 1) * rowBytes + i] : 0;
            out[y * rowBytes + i] = (raw[src + i] + (f === 1 ? left : f === 2 ? up : 0)) & 0xff;
        }
    }
    return { width, height, channels, pixels: out, chunks };
}

test('PNG : pixels restitués à l’identique, bandes irrégulières', async () => {
    const w = 97, h = 53, px = testImage(w, h, { noise: true });
    const png = decodePng(await encode(createPngStream({ width: w, height: h, alpha: false }), px, w, h));
    assert.deepEqual([png.width, png.height, png.channels], [w, h, 3]);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
        assert.deepEqual([...png.pixels.subarray(j, j + 3)], [...px.subarray(i * 4, i * 4 + 3)]);
    }
});

test('PNG : code de recréation au même endroit que blobWithRecreationCode', async () => {
    const png = decodePng(await encode(createPngStream({ width: 8, height: 8, alpha: false, comment: 'CADO-code=ABC ' }), testImage(8, 8), 8, 8));
    assert.deepEqual(png.chunks.slice(0, 2).map(c => c.type), ['IHDR', 'tEXt']);
    assert.equal(Buffer.from(png.chunks[1].data).toString('latin1'), 'Comment\0CADO-code=ABC ');
});

test('JPEG : structure, commentaire après SOI, même fichier quel que soit le découpage', async () => {
    const w = 45, h = 29, px = testImage(w, h, { noise: true });
    const one = await encode(createJpegStream({ width: w, height: h, comment: 'CADO-code=XYZ' }), px, w, h, [h]);
    const many = await encode(createJpegStream({ width: w, height: h, comment: 'CADO-code=XYZ' }), px, w, h, [3, 8, 1, 11]);
    assert.deepEqual(many, one);
    assert.deepEqual([...one.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xfe]);
    assert.deepEqual([...one.subarray(-2)], [0xff, 0xd9]);
    assert.equal(JPEG_MAX_SIDE, 65535);
    assert.deepEqual(jpegQuantTable([16, 99, 255], 0.5), [16, 99, 255]);
});

test('image incomplète ou lignes en trop : refusées', async () => {
    for (const make of [() => createPngStream({ width: 4, height: 4 }), () => createJpegStream({ width: 4, height: 4 })]) {
        const s = make();
        await s.write(new Uint8ClampedArray(4 * 4 * 2), 2);
        await assert.rejects(s.finish(), /incomplète/);
        await assert.rejects(make().write(new Uint8ClampedArray(4 * 4 * 5), 5), /plus de lignes/);
    }
});

test('copie conforme de CadoTour (si le dépôt est voisin)', () => {
    const cado = `${ROOT}../VirtualTour/imageStream.js`;
    if (!existsSync(cado)) { console.log('     (CadoTour absent : vérification sautée)'); return; }
    const body = s => s.replace(/\r\n/g, '\n').slice(s.replace(/\r\n/g, '\n').indexOf('// ── CRC-32 (PNG)'));
    const ours = body(SOURCE).split('\n').map(l => l.replace(/^ {4}/, '')).join('\n')
        .replace(/\n\n(    )?global\.[\s\S]*$/, '').replace(/^(function|const) /gm, m => m).trimEnd();
    const theirs = body(readFileSync(cado, 'utf8')).replace(/^export (function|const) /gm, '$1 ').trimEnd();
    assert.equal(ours, theirs);
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

// Tests de l'écriture GeoTIFF par bandes (geotiffExport.js, createGeoTiffStream),
// sans navigateur : node tools/test_geotiff_stream.mjs
//
// Chaque fichier est relu : par un lecteur TIFF minimal ici (en-tête, répertoire,
// balises, bandes), puis — si Python et Pillow sont installés — par libtiff, le
// lecteur de GDAL et de QGIS, pour une validation indépendante.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const context = {
    TextEncoder, Blob, CompressionStream, Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array,
    Float64Array, ArrayBuffer, DataView, BigInt, Math, Error, Array, Promise, Object, Number, String, console,
};
context.window = context;
vm.createContext(context);
for (const f of ['imageStream.js', 'geotiffExport.js']) vm.runInContext(readFileSync(`${ROOT}${f}`, 'utf8'), context, { filename: f });
const { createGeoTiffStream } = context;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const GEO = { originX: 250000, originY: 6250000, pixelScaleX: 0.5, pixelScaleY: 0.5, epsg: 3857, tiePointI: 3, tiePointJ: 3, description: 'CADO-code=ABC' };

function image(w, h) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = (x * 7) & 255; px[i + 1] = (y * 5) & 255; px[i + 2] = (x * y) & 255; px[i + 3] = 255;
    }
    return px;
}

async function writeTiff(opts, px, bands = [13, 40, 7]) {
    const tif = createGeoTiffStream({ ...GEO, ...opts });
    for (let y = 0, b = 0; y < opts.height; b++) {
        const rows = Math.min(bands[b % bands.length], opts.height - y);
        await tif.write(px.subarray(y * opts.width * 4, (y + rows) * opts.width * 4), rows);
        y += rows;
    }
    return new Uint8Array(await (await tif.finish()).arrayBuffer());
}

// Lecteur TIFF / BigTIFF minimal : balises → valeurs.
function readTiff(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'II');
    const magic = dv.getUint16(2, true), big = magic === 43;
    assert.ok(magic === 42 || big);
    const ifd = big ? Number(dv.getBigUint64(8, true)) : dv.getUint32(4, true);
    assert.equal(ifd % 2, 0, 'IFD sur une frontière de mot');
    const n = big ? Number(dv.getBigUint64(ifd, true)) : dv.getUint16(ifd, true);
    const size = { 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8 };
    const tags = {};
    for (let i = 0; i < n; i++) {
        const e = ifd + (big ? 8 : 2) + i * (big ? 20 : 12);
        const tag = dv.getUint16(e, true), type = dv.getUint16(e + 2, true);
        const count = big ? Number(dv.getBigUint64(e + 4, true)) : dv.getUint32(e + 4, true);
        const valPos = e + (big ? 12 : 8), inline = size[type] * count <= (big ? 8 : 4);
        let at = inline ? valPos : (big ? Number(dv.getBigUint64(valPos, true)) : dv.getUint32(valPos, true));
        const vals = [];
        for (let k = 0; k < count; k++, at += size[type]) {
            vals.push(type === 3 ? dv.getUint16(at, true) : type === 4 ? dv.getUint32(at, true)
                : type === 12 ? dv.getFloat64(at, true) : type === 16 ? Number(dv.getBigUint64(at, true))
                    : type === 5 ? dv.getUint32(at, true) / dv.getUint32(at + 4, true) : bytes[at]);
        }
        tags[tag] = type === 2 ? String.fromCharCode(...vals.slice(0, -1)) : vals;
    }
    const strips = tags[273].map((o, k) => bytes.subarray(o, o + tags[279][k]));
    return { big, tags, strips };
}

test('RGB non compressé : balises de géoréférencement, pixels relus à l’identique', async () => {
    const w = 70, h = 75, px = image(w, h);
    const { big, tags, strips } = readTiff(await writeTiff({ width: w, height: h }, px));
    assert.equal(big, false);
    assert.deepEqual([tags[256][0], tags[257][0], tags[259][0], tags[262][0], tags[278][0]], [w, h, 1, 2, 32]);
    assert.equal(strips.length, 3);                                  // 32 + 32 + 11 lignes
    assert.deepEqual(tags[33550], [0.5, 0.5, 0]);
    assert.deepEqual(tags[33922], [3, 3, 0, 250000, 6250000, 0]);
    assert.equal(tags[270], 'CADO-code=ABC');
    assert.deepEqual(tags[34735], [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857]);
    const rgb = Buffer.concat(strips.map(s => Buffer.from(s)));
    for (let i = 0; i < w * h; i++) assert.deepEqual([...rgb.subarray(i * 3, i * 3 + 3)], [...px.subarray(i * 4, i * 4 + 3)]);
});

test('BigTIFF : même image, offsets sur 8 octets', async () => {
    const w = 40, h = 70, px = image(w, h);
    const a = readTiff(await writeTiff({ width: w, height: h }, px));
    const b = readTiff(await writeTiff({ width: w, height: h, bigTiff: true }, px));
    assert.equal(b.big, true);
    assert.deepEqual(b.tags[273].length, a.tags[273].length);
    assert.deepEqual(Buffer.concat(b.strips.map(s => Buffer.from(s))), Buffer.concat(a.strips.map(s => Buffer.from(s))));
});

test('JPEG : une bande de 64 lignes = un flux JPEG complet, 4:4:4 déclaré', async () => {
    const w = 50, h = 150, px = image(w, h);
    const { tags, strips } = readTiff(await writeTiff({ width: w, height: h, jpeg: true, quality: 0.9 }, px));
    assert.deepEqual([tags[259][0], tags[262][0], tags[278][0]], [7, 6, 64]);
    assert.deepEqual(tags[530], [1, 1]);
    assert.equal(strips.length, 3);
    for (const s of strips) {
        assert.deepEqual([...s.subarray(0, 2)], [0xff, 0xd8]);
        assert.deepEqual([...s.subarray(-2)], [0xff, 0xd9]);
    }
});

test('image incomplète ou lignes en trop : refusées', async () => {
    const tif = createGeoTiffStream({ ...GEO, width: 4, height: 4 });
    await tif.write(new Uint8ClampedArray(4 * 4 * 2), 2);
    await assert.rejects(tif.finish(), /incomplète/);
    await assert.rejects(createGeoTiffStream({ ...GEO, width: 4, height: 4 }).write(new Uint8ClampedArray(4 * 4 * 5), 5), /plus de lignes/);
});

test('relu par libtiff (Pillow), si installé : RGB exact, JPEG fidèle, BigTIFF', async () => {
    const py = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8' });
    if (py.status !== 0) { console.log('     (Python/Pillow absent : vérification sautée)'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'geotiff-'));
    const w = 70, h = 130, px = image(w, h);
    writeFileSync(join(dir, 'raw.tif'), await writeTiff({ width: w, height: h }, px));
    writeFileSync(join(dir, 'big.tif'), await writeTiff({ width: w, height: h, bigTiff: true }, px));
    writeFileSync(join(dir, 'jpeg.tif'), await writeTiff({ width: w, height: h, jpeg: true, quality: 0.95 }, px));
    writeFileSync(join(dir, 'ref.rgb'), Buffer.from(px.filter((_, i) => i % 4 !== 3)));
    const script = `
import sys, math
from PIL import Image
d = sys.argv[1]; ref = open(d + '/ref.rgb', 'rb').read()
for name in ['raw', 'big', 'jpeg']:
    im = Image.open(d + '/' + name + '.tif'); im.load(); data = im.convert('RGB').tobytes()
    assert im.size == (${w}, ${h}), (name, im.size)
    se = sum((a - b) ** 2 for a, b in zip(data, ref)) / len(ref)
    psnr = 99 if se == 0 else 10 * math.log10(255 ** 2 / se)
    print(name, im.size, round(psnr, 1))
`;
    const r = spawnSync('python', ['-c', script, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const psnr = Object.fromEntries(r.stdout.trim().split('\n').map(l => [l.split(' ')[0], Number(l.split(' ').at(-1))]));
    console.log('     libtiff :', JSON.stringify(psnr));
    assert.equal(psnr.raw, 99);
    assert.equal(psnr.big, 99);
    assert.ok(psnr.jpeg > 30);
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

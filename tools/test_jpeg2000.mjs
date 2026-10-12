// Décodeur navigateur et index JP2 testés sous Node avec les mêmes modules WASM.
import { readFileSync, readdirSync, openAsBlob } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JpxImage } from '../vendor/jpeg2000/pdf.image_decoders.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const context = vm.createContext({ Uint8Array, DataView, TextDecoder, Error, Number, Math, Array });
vm.runInContext(readFileSync(root + 'jpeg2000Core.js', 'utf8') + ';globalThis.index = jp2Index; globalThis.stream = jp2TileStream;', context);
JpxImage.setOptions({ useWasm: true, useWorkerFetch: false, wasmUrl: '', handler: {
    sendWithPromise: async () => new Uint8Array(readFileSync(root + 'vendor/jpeg2000/openjpeg.wasm')),
} });
const folder = process.argv[2] || root + 'tools/fixtures/jpeg2000';
const name = readdirSync(folder).find(n => /\.jp2$/i.test(n));
if (!name) throw new Error('Indiquer un dossier contenant une image JP2.');
const index = await context.index(await openAsBlob(folder + '/' + name));
console.log({ width: index.width, height: index.height, components: index.siz.components, tiles: index.tiles.length });
for (const n of new Set([0, Math.min(11, index.tiles.length - 1), index.tiles.length - 1])) {
    const tile = index.tiles[n];
    const stream = await context.stream(index, tile);
    for (const reducePower of new Set([Math.min(index.levels, 3), 0])) {
        const start = performance.now();
        const data = await JpxImage.decode(stream, { numComponents: index.siz.components, reducePower });
        const divisor = 2 ** reducePower;
        const width = Math.ceil(tile.x1 / divisor) - Math.ceil(tile.x0 / divisor);
        const height = Math.ceil(tile.y1 / divisor) - Math.ceil(tile.y0 / divisor);
        assert.equal(data.length, width * height * index.siz.components);
        if (process.argv.includes('--gdal') && reducePower === 0) {
            const expected = execFileSync('python', ['-c',
                'import rasterio,hashlib,sys; from rasterio.windows import Window; s=rasterio.open(sys.argv[1]); x,y,w,h=map(int,sys.argv[2:]); a=s.read(window=Window(x,y,w,h)).transpose(1,2,0); print(hashlib.sha256(a.tobytes()).hexdigest())',
                folder + '/' + name, String(tile.x0 - index.siz.x0), String(tile.y0 - index.siz.y0), String(width), String(height)], { encoding: 'utf8' }).trim();
            assert.equal(createHash('sha256').update(data).digest('hex'), expected, 'Pixels identiques à GDAL');
        }
        if (name === 'rgb-nir.jp2' && reducePower === 0) {
            for (const [x, y] of [[0, 0], [width - 1, height - 1], [Math.floor(width / 2), Math.floor(height / 2)]]) {
                const sx = tile.x0 + x, sy = tile.y0 + y, p = (y * width + x) * 4;
                assert.deepEqual([...data.slice(p, p + 4)], [sx % 251, sy % 251, (sx + sy) % 251, 170]);
            }
        }
        console.log({ tile: n, reducePower, width, height, bytes: data.length, ms: Math.round(performance.now() - start), first: [...data.slice(0, 12)] });
    }
}
await assert.rejects(() => context.index(new Blob([new Uint8Array(8)])), /invalide|codestream/);
const truncated = await openAsBlob(folder + '/' + name);
await assert.rejects(() => context.index(truncated.slice(0, truncated.size - 10)), /tronqué|invalide/);
console.log('Décodage JP2 réussi.');

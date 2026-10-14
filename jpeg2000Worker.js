// Décodage JPEG 2000 isolé de l'interface. Les octets des images restent locaux.
importScripts('jpeg2000Core.js');

if (!Promise.withResolvers) Promise.withResolvers = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

let index = null, library = null, chain = Promise.resolve();
const cancelled = new Set(), cache = new Map();
let cacheSize = 0;
// Au moins CACHE_TILES blocs décodés (une bande de rendu en croise jusqu'à 8),
// entre 32 et 256 Mo : 160 Mo pour des blocs Pléiades de 2 048 px.
const CACHE_TILES = 10, CACHE_MIN = 32 * 1024 * 1024, CACHE_MAX = 256 * 1024 * 1024;

async function jp2DecodeTile(tile, reducePower, bands, alpha, nodata, excludeBlack) {
    const key = `${tile.index}/${reducePower}/${bands}/${alpha}/${nodata}/${excludeBlack}`;
    if (cache.has(key)) {
        const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
    }
    const divisor = 2 ** reducePower;
    const width = Math.ceil(tile.x1 / divisor) - Math.ceil(tile.x0 / divisor);
    const height = Math.ceil(tile.y1 / divisor) - Math.ceil(tile.y0 / divisor);
    if (width * height > 16 * 1024 * 1024) throw new Error('Un bloc JP2 dépasse 16 millions de pixels à cette résolution. Réduire le zoom maximal.');
    if (!library) {
        library = await import('./vendor/jpeg2000/pdf.image_decoders.mjs');
        library.JpxImage.setOptions({ useWasm: true, useWorkerFetch: true, wasmUrl: new URL('./vendor/jpeg2000/', self.location.href).href });
    }
    const bytes = await jp2TileStream(index, tile);
    const count = index.siz.components;
    const raw = await library.JpxImage.decode(bytes, { numComponents: count, reducePower });
    if (raw.length !== width * height * count) throw new Error('Dimensions décodées JP2 incohérentes.');
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < width * height; i++, j += count) {
        const k = i * 4;
        rgba[k] = raw[j + bands[0]];
        rgba[k + 1] = raw[j + (bands[1] ?? bands[0])];
        rgba[k + 2] = raw[j + (bands[2] ?? bands[0])];
        rgba[k + 3] = alpha == null ? 255 : raw[j + alpha];
        if (nodata != null && bands.every(b => raw[j + b] === nodata)) rgba[k + 3] = 0;
        if (excludeBlack && rgba[k] === 0 && rgba[k + 1] === 0 && rgba[k + 2] === 0) rgba[k + 3] = 0;
    }
    const value = { rgba, width, height,
        x: Math.ceil(tile.x0 / divisor) * divisor - index.siz.x0,
        y: Math.ceil(tile.y0 / divisor) * divisor - index.siz.y0, divisor };
    // Budget fixe pour un fichier, d'après le bloc nominal à pleine résolution : un
    // bloc de bord ou un aperçu réduit, plus petits, ne vident pas le cache.
    const nominal = index.siz.tw * index.siz.th * 4;
    const budget = Math.min(CACHE_MAX, Math.max(CACHE_MIN, CACHE_TILES * nominal));
    if (rgba.byteLength <= budget) {
        while (cacheSize + rgba.byteLength > budget && cache.size) {
            const oldest = cache.keys().next().value;
            cacheSize -= cache.get(oldest).rgba.byteLength; cache.delete(oldest);
        }
        cache.set(key, value); cacheSize += rgba.byteLength;
    }
    return value;
}

async function jp2Handle(data) {
    const { id } = data;
    try {
        if (data.type === 'open') {
            index = await jp2Index(data.file);
            self.postMessage({ id, type: 'opened', width: index.width, height: index.height,
                components: index.siz.components, levels: index.levels, xml: index.xml,
                geotiffs: index.geotiffs, channels: index.channels, tiles: index.tiles.length });
        } else if (data.type === 'render') {
            const [x0, y0, x1, y1] = data.window;
            const candidates = index.tiles.filter(t => t.x0 - index.siz.x0 < x1 && t.x1 - index.siz.x0 > x0
                && t.y0 - index.siz.y0 < y1 && t.y1 - index.siz.y0 > y0);
            let done = 0;
            for (const tile of candidates) {
                if (cancelled.has(id)) break;
                const image = await jp2DecodeTile(tile, data.reducePower, data.bands, data.alpha, data.nodata, data.excludeBlack);
                if (cancelled.has(id)) break;
                const rgba = image.rgba.slice(); // le cache garde sa copie
                self.postMessage({ id, type: 'tile', ...image, rgba, done: ++done, total: candidates.length }, [rgba.buffer]);
                // Laisser arriver les demandes d'annulation entre les blocs.
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            self.postMessage({ id, type: 'done' });
        }
    } catch (error) {
        self.postMessage({ id, type: 'error', message: error.message || String(error) });
    } finally { cancelled.delete(id); }
}

self.onmessage = ({ data }) => {
    if (data.type === 'cancel') { cancelled.add(data.id); return; }
    chain = chain.then(() => jp2Handle(data));
};

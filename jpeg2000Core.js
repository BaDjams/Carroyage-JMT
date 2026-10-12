// JPEG 2000 tuilé : index par petites lectures du Blob, sans charger le JP2
// entier. Une tuile est présentée au décodeur comme un codestream indépendant,
// en conservant ses coordonnées dans la grille de référence (phase des ondelettes).
// Utilisé dans jpeg2000Worker.js et testé sous Node.

async function jp2Read(file, start, size) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || start + size > file.size) {
        throw new Error('JP2 tronqué ou longueur de bloc invalide.');
    }
    const bytes = new Uint8Array(await file.slice(start, start + size).arrayBuffer());
    if (bytes.length !== size) throw new Error('Lecture JP2 incomplète.');
    return bytes;
}

async function jp2Index(file) {
    const xml = [], geotiffs = [], channels = [];
    let colorSpace = null;
    let stream = null;
    const decoder = new TextDecoder();
    async function boxes(start, end, depth = 0) {
        if (depth > 8) throw new Error('Trop de niveaux de boîtes JP2.');
        while (start < end) {
            const head = await jp2Read(file, start, 8);
            const view = new DataView(head.buffer);
            let length = view.getUint32(0), skip = 8;
            const type = String.fromCharCode(...head.subarray(4));
            if (length === 1) {
                const ext = new DataView((await jp2Read(file, start + 8, 8)).buffer);
                length = ext.getUint32(0) * 2 ** 32 + ext.getUint32(4); skip = 16;
            } else if (!length) length = end - start;
            if (!Number.isSafeInteger(length) || length < skip || start + length > end) throw new Error('Boîte JP2 invalide.');
            const body = start + skip, size = length - skip;
            if (type === 'jp2c') {
                if (stream) throw new Error('Les JP2 à plusieurs codestreams ne sont pas pris en charge.');
                stream = { start: body, end: start + length };
            } else if (type === 'asoc' || type === 'jp2h') await boxes(body, start + length, depth + 1);
            else if (type === 'xml ' && size <= 4 * 1024 * 1024) xml.push(decoder.decode(await jp2Read(file, body, size)));
            else if (type === 'colr' && size >= 7) {
                const bytes = await jp2Read(file, body, Math.min(size, 7));
                if (bytes[0] === 1) colorSpace = new DataView(bytes.buffer).getUint32(3);
            } else if (type === 'cdef' && size <= 1024) {
                const v = new DataView((await jp2Read(file, body, size)).buffer);
                const count = v.getUint16(0);
                if (size !== 2 + 6 * count) throw new Error('Définition de canaux JP2 invalide.');
                for (let i = 0; i < count; i++) channels.push({ index: v.getUint16(2 + 6 * i), type: v.getUint16(4 + 6 * i), association: v.getUint16(6 + 6 * i) });
            }
            else if (type === 'uuid' && size > 16 && size <= 4 * 1024 * 1024) {
                const bytes = await jp2Read(file, body, size);
                const uuid = [...bytes.subarray(0, 16)].map(v => v.toString(16).padStart(2, '0')).join('');
                if (uuid === 'b14bf8bd083d4b43a5ae8cd7d5a6ce03') geotiffs.push(bytes.slice(16));
            }
            start += length;
        }
    }
    await boxes(0, file.size);
    if (!stream) throw new Error('Le fichier ne contient pas de codestream JPEG 2000.');
    const head = await jp2Read(file, stream.start, Math.min(1024 * 1024, stream.end - stream.start));
    const dv = new DataView(head.buffer);
    if (dv.getUint16(0) !== 0xff4f) throw new Error('Signature JPEG 2000 invalide.');
    let p = 2, siz = null, levels = 0;
    const segments = [head.slice(0, 2)];
    while (p + 4 <= head.length && dv.getUint16(p) !== 0xff90) {
        const marker = dv.getUint16(p), len = dv.getUint16(p + 2), end = p + 2 + len;
        if (len < 2 || end > head.length) throw new Error('En-tête JPEG 2000 trop long ou invalide.');
        if (marker === 0xff51) {
            if (len < 38) throw new Error('Dimensions JPEG 2000 invalides.');
            siz = {
                x1: dv.getUint32(p + 6), y1: dv.getUint32(p + 10),
                x0: dv.getUint32(p + 14), y0: dv.getUint32(p + 18),
                tw: dv.getUint32(p + 22), th: dv.getUint32(p + 26),
                tx: dv.getUint32(p + 30), ty: dv.getUint32(p + 34),
                components: dv.getUint16(p + 38), componentInfo: [],
            };
            if (len !== 38 + 3 * siz.components) throw new Error('Composantes JPEG 2000 invalides.');
            for (let c = 0; c < siz.components; c++) {
                const q = p + 40 + 3 * c;
                siz.componentInfo.push({ bits: (head[q] & 127) + 1, signed: !!(head[q] & 128), dx: head[q + 1], dy: head[q + 2] });
            }
        }
        if (marker === 0xff52) levels = head[p + 9];
        if (marker === 0xff60 || marker === 0xff57) throw new Error('Ce JP2 utilise des paquets globaux PPM/PLM non pris en charge.');
        // TLM contient les anciens numéros de tuiles ; l'index SOT le remplace.
        if (marker !== 0xff55) segments.push(head.slice(p, end));
        p = end;
    }
    if (!siz || p + 12 > head.length || dv.getUint16(p) !== 0xff90) throw new Error('En-tête JP2 incomplet.');
    if (!(siz.tw && siz.th && siz.x1 > siz.x0 && siz.y1 > siz.y0) || siz.tx > siz.x0 || siz.ty > siz.y0) throw new Error('Grille JP2 invalide.');
    if (![1, 3, 4].includes(siz.components) || siz.componentInfo.some(c => c.dx !== 1 || c.dy !== 1 || c.bits > 8 || c.signed)) {
        throw new Error('JP2 pris en charge : une, trois ou quatre bandes non signées de 1 à 8 bits, sans sous-échantillonnage.');
    }
    const nx = Math.ceil((siz.x1 - siz.tx) / siz.tw), ny = Math.ceil((siz.y1 - siz.ty) / siz.th);
    if (nx * ny > 65535) throw new Error('Nombre de tuiles JPEG 2000 invalide.');
    const tiles = Array.from({ length: nx * ny }, (_, i) => {
        const x = i % nx, y = Math.floor(i / nx);
        return { index: i, x0: Math.max(siz.x0, siz.tx + x * siz.tw), y0: Math.max(siz.y0, siz.ty + y * siz.th),
            x1: Math.min(siz.x1, siz.tx + (x + 1) * siz.tw), y1: Math.min(siz.y1, siz.ty + (y + 1) * siz.th), parts: [] };
    });
    let offset = stream.start + p;
    while (offset + 2 <= stream.end) {
        const marker = new DataView((await jp2Read(file, offset, 2)).buffer).getUint16(0);
        if (marker === 0xffd9) break;
        if (marker !== 0xff90) throw new Error('Début de tuile JP2 invalide.');
        const part = new DataView((await jp2Read(file, offset, 12)).buffer);
        const tile = tiles[part.getUint16(4)];
        let size = part.getUint32(6);
        if (!size) size = stream.end - offset - 2; // dernière partie, jusqu'à EOC
        if (part.getUint16(2) !== 10 || !tile || size < 14 || offset + size > stream.end - 2) throw new Error('Partie de tuile JP2 invalide.');
        tile.parts.push({ offset, size });
        offset += size;
    }
    if (offset + 2 !== stream.end || tiles.some(t => !t.parts.length)) throw new Error('JP2 tronqué : tuiles manquantes ou fin invalide.');
    if (colorSpace != null && colorSpace !== 16 && colorSpace !== 17) throw new Error('Ce JP2 utilise un espace couleur autre que RVB ou niveaux de gris.');
    return { file, siz, levels, segments, tiles, xml, geotiffs, channels, width: siz.x1 - siz.x0, height: siz.y1 - siz.y0 };
}

async function jp2TileStream(index, tile) {
    const encodedSize = index.segments.reduce((sum, s) => sum + s.length, 2) + tile.parts.reduce((sum, p) => sum + p.size, 0);
    if (encodedSize > 128 * 1024 * 1024) throw new Error('Une tuile JP2 compressée dépasse 128 Mo.');
    const segments = index.segments.map(s => s.slice());
    const siz = segments.find(s => s[0] === 0xff && s[1] === 0x51);
    const v = new DataView(siz.buffer);
    v.setUint32(6, tile.x1); v.setUint32(10, tile.y1);
    v.setUint32(14, tile.x0); v.setUint32(18, tile.y0);
    // Garder l'origine de la tuile complète même si l'image la coupe.
    const nx = Math.ceil((index.siz.x1 - index.siz.tx) / index.siz.tw);
    v.setUint32(30, index.siz.tx + tile.index % nx * index.siz.tw);
    v.setUint32(34, index.siz.ty + Math.floor(tile.index / nx) * index.siz.th);
    for (const part of tile.parts) {
        const bytes = await jp2Read(index.file, part.offset, part.size);
        bytes[4] = bytes[5] = 0; // Isot : une seule tuile dans ce codestream
        // Psot=0 devient une longueur explicite, notamment pour plusieurs parties.
        new DataView(bytes.buffer).setUint32(6, part.size);
        segments.push(bytes);
    }
    const size = segments.reduce((sum, s) => sum + s.length, 2);
    const out = new Uint8Array(size);
    let p = 0;
    for (const bytes of segments) { out.set(bytes, p); p += bytes.length; }
    out.set([0xff, 0xd9], p);
    return out;
}

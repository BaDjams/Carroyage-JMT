// seedManager.js
// CODE DE RECRÉATION
// Un code court, inscrit dans le cartouche, le nom de fichier et la description du
// point d'origine A1, qui décrit la zone d'intérêt d'un export pour la refaire à
// l'identique, en carroyage rapide comme en export de zone. Le carroyage n'y est pas
// figé : saisi en export de zone, le code redessine l'emprise, et l'on choisit
// ensuite CFSI, DFCI, UTM, MGRS ou CADO. Fond, couleur, épaisseur et format restent
// libres.
//
// Deux sortes de codes :
//   - zone : coin nord-ouest et étendue du rectangle, au millionième de degré, la
//     précision des champs de l'export de zone : le rectangle revient à l'identique ;
//   - CADO : point de référence (milieu ou A1), échelle et bornes de la grille.
//     L'étendue s'en déduit, d'où un code plus court.
// Communs : déviation au dixième de degré, comme CadoTour, et zoom de l'export
// (0 = non précisé, exports vectoriels).
//
// Disposition des bits (version 3), poids fort en tête :
//   version 2 | sorte 1 | lat 28 | lon 29 (µ°) | (déviation + 180) × 10 : 12 | zoom 5
//   zone : Δlat 22 | Δlon 23 (µ°)
//   CADO : échelle 16 (m) | demi-mètre 1 | grille 3 | [bornes] | ascendant 1 | milieu 1 | axes inversés 1 | double entrée 1
//     grille 0 à 4 : Q12, Z18, Q9, Z14, Z26
//            5     : de A1 à N colonnes × M lignes (8 + 8)
//            6     : bornes libres, colonnes puis lignes de début et de fin (4 × 8, signées)
// Suit un caractère de contrôle : somme des caractères pondérés par les puissances
// successives d'un générateur de GF(32) (GF(64) en base64). Toute faute sur un
// caractère et toute inversion de deux caractères voisins sont repérées, tant que le
// code compte moins de 31 caractères (63 en base64) : il en fait 28 au plus.
//
// Versions précédentes, encore lues :
//   - version 1 (v23.28 et v23.29) : déviation au degré sur 9 bits, échelle en mètres
//     entiers sur 17 bits ;
//   - version 2 (v23.30) : déviation au dixième, échelle en mètres entiers sur 16 bits
//     (65 535 m au plus), sans le bit du demi-mètre.
// La version 3 ajoute ce bit : l'échelle se règle au demi-mètre (12,5 m), comme dans
// CadoTour. C'est la dernière valeur libre du champ de version (0 exclu).
//
// Inversion des axes et double entrée se lisent sur l'image, mais ne coûtent rien :
// en base32 un code CADO de grille prédéfinie fait 101 bits, soit 21 caractères
// (22 avec le contrôle).
// Le sens des lettres, lui, est indispensable : il place les lignes au nord ou au
// sud de A1.
//
// Deux alphabets, au choix dans la fenêtre « Gestion ⚙️ » :
//   - base32 de Crockford (défaut) : ni I, L, O ni U, casse indifférente, groupé par
//     4, pour être relu sur une carte imprimée et retapé sur le terrain ;
//   - base64url : plus court, pour le copier-coller. Sans « / » ni « + », il tient
//     dans un nom de fichier.
// Le décodage reconnaît les deux.

const RC_VERSION = 3;
const RC_ALPHABETS = {
    base32: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
    base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
};
const RC_BITS_PER_CHAR = { base32: 5, base64: 6 };
const RC_STORAGE_KEY = 'recreationCodeAlphabet';
const RC_MICRO = 1e6;

// Grilles prédéfinies du carroyage rapide, dans l'ordre de leur index (cf.
// getGridConfiguration). Colonnes en nombres : A = 1, Q = 17, Z = 26.
const RC_PRESETS = [
    { name: 'Q12', startCol: 1, endCol: 17, startRow: 1, endRow: 12 },
    { name: 'Z18', startCol: 1, endCol: 26, startRow: 1, endRow: 18 },
    { name: 'Q9',  startCol: 1, endCol: 17, startRow: 1, endRow: 9 },
    { name: 'Z14', startCol: 1, endCol: 26, startRow: 1, endRow: 14 },
    { name: 'Z26', startCol: 1, endCol: 26, startRow: 1, endRow: 26 },
];
const RC_SPEC_FROM_A1 = 5;
const RC_SPEC_FREE = 6;

// Échelle d'une case, en mètres : de 0,5 à 65 535 m, au demi-mètre — les 16 bits
// de mètres et le bit du demi-mètre du code (version 3). Hors de là, une grille
// n'aurait pas de code et ne pourrait pas être refaite à l'identique, ici comme dans
// CadoTour, qui applique les mêmes règles (MAX_SCALE, roundScale, carroyage.js).
const RC_MAX_SCALE = 65535;
const RC_SCALE_TOO_HIGH = "L'échelle est limitée à 65 535 m par case : au-delà, la grille n'aurait pas de code de recréation et ne pourrait pas être refaite à l'identique dans CadoTour.";
const RC_SCALE_TOO_LOW = "L'échelle doit être d'au moins 0,5 m par case.";

// Échelle saisie, arrondie au demi-mètre (12,3 → 12,5). Même calcul dans CadoTour.
function roundGridScale(value) {
    return Math.round(parseFloat(value) * 2) / 2;
}

// Message si l'échelle, une fois arrondie, sort des limites ; sinon null. Un champ
// vide ou illisible n'a pas de message ici : chaque mode le signale déjà.
function gridScaleProblem(value) {
    const scale = roundGridScale(value);
    if (!Number.isFinite(scale)) return null;
    if (scale < 0.5) return RC_SCALE_TOO_LOW;
    return scale > RC_MAX_SCALE ? RC_SCALE_TOO_HIGH : null;
}

// ----------------------------------------------------------------
// Préférence d'alphabet
// ----------------------------------------------------------------
function getRecreationCodeAlphabet() {
    try {
        return localStorage.getItem(RC_STORAGE_KEY) === 'base64' ? 'base64' : 'base32';
    } catch (e) {
        return 'base32';
    }
}

function setRecreationCodeAlphabet(alphabet) {
    try { localStorage.setItem(RC_STORAGE_KEY, alphabet === 'base64' ? 'base64' : 'base32'); } catch (e) {}
}

// ----------------------------------------------------------------
// Bits
// ----------------------------------------------------------------
function rcPush(bits, value, width) {
    for (let i = width - 1; i >= 0; i--) bits.push(Math.floor(value / 2 ** i) % 2);
}

function rcReader(bits) {
    let pos = 0;
    return {
        read(width) {
            // RangeError : le code s'arrête avant la fin de ses champs.
            if (pos + width > bits.length) throw new RangeError('incomplet');
            let value = 0;
            for (let i = 0; i < width; i++) value = value * 2 + bits[pos++];
            return value;
        },
        get pos() { return pos; },
    };
}

// Polynômes primitifs de GF(2^5) et GF(2^6) : x est générateur, ses puissances
// x^1..x^30 (x^1..x^62) sont distinctes et différentes de 1, poids du contrôle.
const RC_GF_POLY = { 5: 0x25, 6: 0x43 };

function rcGfMul(a, b, k) {
    let r = 0;
    while (b) {
        if (b & 1) r ^= a;
        b >>= 1;
        a <<= 1;
        if (a & (1 << k)) a ^= RC_GF_POLY[k];
    }
    return r;
}

function rcCheck(values, k) {
    let check = 0, weight = 1;
    for (const v of values) {
        weight = rcGfMul(weight, 2, k);
        check ^= rcGfMul(weight, v, k);
    }
    return check;
}

const rcMicro = (deg) => Math.round(deg * RC_MICRO);
const rcNormLon = (lon) => ((lon + 180) % 360 + 360) % 360 - 180;

// ----------------------------------------------------------------
// Encodage
// ----------------------------------------------------------------
// Grille d'un code CADO : index de grille prédéfinie, ou bornes. null si les bornes
// ne tiennent pas dans le code (au-delà de ±127 cases, ou une borne nulle).
function rcGridSpec(p) {
    const b = [p.startCol, p.endCol, p.startRow, p.endRow];
    if (!b.every(Number.isInteger) || b.includes(0)) return null;
    const preset = RC_PRESETS.findIndex(g =>
        g.startCol === p.startCol && g.endCol === p.endCol && g.startRow === p.startRow && g.endRow === p.endRow);
    if (preset >= 0) return { spec: preset };
    if (p.startCol === 1 && p.startRow === 1 && p.endCol >= 1 && p.endCol <= 255 && p.endRow >= 1 && p.endRow <= 255) {
        return { spec: RC_SPEC_FROM_A1 };
    }
    if (b.every(v => v >= -128 && v <= 127)) return { spec: RC_SPEC_FREE };
    return null;
}

// Bits du code, ou null si les paramètres ne s'y prêtent pas (échelle non entière,
// zone traversant l'antiméridien...). L'export se fait alors sans code.
function rcPayloadBits(p) {
    const cado = p.kind === 'cado';
    const lat = Number(cado ? p.lat : p.north);
    const lon = rcNormLon(Number(cado ? p.lon : p.west));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
    const devTenths = Math.round((Number(p.deviation) || 0) * 10);
    if (devTenths < -1800 || devTenths > 1800) return null;
    const zoom = (Number.isInteger(p.zoom) && p.zoom > 0 && p.zoom < 32) ? p.zoom : 0;

    const bits = [];
    rcPush(bits, RC_VERSION, 2);
    rcPush(bits, cado ? 1 : 0, 1);
    rcPush(bits, rcMicro(lat + 90), 28);
    rcPush(bits, rcMicro(lon + 180), 29);
    rcPush(bits, devTenths + 1800, 12);
    rcPush(bits, zoom, 5);

    if (cado) {
        const scale = Number(p.scale);
        // Échelle au demi-mètre : mètres entiers sur 16 bits, puis le bit du demi-mètre.
        if (!Number.isInteger(scale * 2) || scale < 0.5 || scale > RC_MAX_SCALE) return null;
        const grid = rcGridSpec(p);
        if (!grid) return null;
        rcPush(bits, Math.floor(scale), 16);
        rcPush(bits, scale * 2 % 2, 1);
        rcPush(bits, grid.spec, 3);
        if (grid.spec === RC_SPEC_FROM_A1) {
            rcPush(bits, p.endCol, 8);
            rcPush(bits, p.endRow, 8);
        } else if (grid.spec === RC_SPEC_FREE) {
            [p.startCol, p.endCol, p.startRow, p.endRow].forEach(v => rcPush(bits, v + 128, 8));
        }
        rcPush(bits, p.direction === 'descending' ? 0 : 1, 1);
        rcPush(bits, p.pivot === 'origin' ? 0 : 1, 1);
        rcPush(bits, p.swapAxes ? 1 : 0, 1);
        rcPush(bits, p.doubleEntry ? 1 : 0, 1);
    } else {
        // Étendue calculée sur les coordonnées déjà arrondies au µ° : le décodage
        // retrouve exactement les quatre bords saisis à 6 décimales.
        const dLat = rcMicro(Number(p.north)) - rcMicro(Number(p.south));
        const dLon = rcMicro(Number(p.east)) - rcMicro(Number(p.west));
        if (!(dLat > 0 && dLat < 2 ** 22 && dLon > 0 && dLon < 2 ** 23)) return null;
        rcPush(bits, dLat, 22);
        rcPush(bits, dLon, 23);
    }
    return bits;
}

// Paramètres :
//   { kind: 'zone', north, west, south, east, deviation, zoom }
//   { kind: 'cado', lat, lon, pivot: 'center'|'origin', scale, startCol, endCol,
//     startRow, endRow (nombres, A = 1), direction, swapAxes, doubleEntry, deviation, zoom }
// Renvoie le code, ou null.
function encodeRecreationCode(p, alphabet = getRecreationCodeAlphabet()) {
    const bits = rcPayloadBits(p);
    if (!bits) return null;
    const k = RC_BITS_PER_CHAR[alphabet];
    const chars = RC_ALPHABETS[alphabet];
    const padded = bits.concat(new Array((k - bits.length % k) % k).fill(0));
    const values = [];
    for (let i = 0; i < padded.length; i += k) {
        let v = 0;
        for (let j = 0; j < k; j++) v = v * 2 + padded[i + j];
        values.push(v);
    }
    values.push(rcCheck(values, k));
    const out = values.map(v => chars[v]).join('');
    return alphabet === 'base32' ? out.match(/.{1,4}/g).join('-') : out;
}

// ----------------------------------------------------------------
// Décodage
// ----------------------------------------------------------------
const RC_ERR_TYPO = "Code de recréation erroné : un caractère a sans doute été mal recopié.";

function rcParse(bits) {
    const r = rcReader(bits);
    const version = r.read(2);
    if (version < 1) {
        throw new Error("Code de recréation non reconnu : faute de frappe, ou code produit par une version plus récente de l'application.");
    }
    const cado = r.read(1) === 1;
    const latInt = r.read(28);
    const lonInt = r.read(29);
    const deviation = version === 1 ? r.read(9) - 180 : (r.read(12) - 1800) / 10;
    const zoom = r.read(5) || null;
    const lat = latInt / RC_MICRO - 90;
    const lon = lonInt / RC_MICRO - 180;

    let p;
    if (cado) {
        const scale = version === 1 ? r.read(17)
            : version === 2 ? r.read(16)
            : r.read(16) + r.read(1) / 2;
        const spec = r.read(3);
        let bounds;
        if (spec < RC_PRESETS.length) {
            const { startCol, endCol, startRow, endRow } = RC_PRESETS[spec];
            bounds = { startCol, endCol, startRow, endRow };
        } else if (spec === RC_SPEC_FROM_A1) {
            bounds = { startCol: 1, endCol: r.read(8), startRow: 1, endRow: r.read(8) };
        } else if (spec === RC_SPEC_FREE) {
            const [startCol, endCol, startRow, endRow] = [0, 0, 0, 0].map(() => r.read(8) - 128);
            bounds = { startCol, endCol, startRow, endRow };
        } else {
            bounds = null;
        }
        const direction = r.read(1) ? 'ascending' : 'descending';
        const pivot = r.read(1) ? 'center' : 'origin';
        const swapAxes = r.read(1) === 1;
        const doubleEntry = r.read(1) === 1;
        p = { kind: 'cado', lat, lon, pivot, scale, ...bounds, direction, swapAxes, doubleEntry, deviation, zoom, _valid: !!bounds };
    } else {
        const dLat = r.read(22);
        const dLon = r.read(23);
        p = {
            kind: 'zone', north: lat, west: lon,
            south: (latInt - dLat) / RC_MICRO - 90,
            east: (lonInt + dLon) / RC_MICRO - 180,
            deviation, zoom, _valid: dLat > 0 && dLon > 0 && lonInt + dLon <= 360 * RC_MICRO,
        };
    }
    p._valid = p._valid && latInt <= 180 * RC_MICRO && lonInt <= 360 * RC_MICRO && Math.abs(deviation) <= 180;
    if (cado) {
        p._valid = p._valid && p.scale > 0 && [p.startCol, p.endCol, p.startRow, p.endRow].every(v => v !== 0);
    }
    return { p, used: r.pos };
}

function rcDecodeWith(text, alphabet) {
    const chars = RC_ALPHABETS[alphabet];
    const k = RC_BITS_PER_CHAR[alphabet];
    const values = [...text].map(c => chars.indexOf(c));
    const bad = values.indexOf(-1);
    if (bad >= 0) throw new Error(`Code de recréation illisible : caractère « ${text[bad]} » inconnu.`);
    if (values.length < 2) throw new Error("Code de recréation incomplet : un ou plusieurs caractères manquent.");

    const check = values.pop();
    const bits = [];
    values.forEach(v => rcPush(bits, v, k));

    let parsed;
    try {
        parsed = rcParse(bits);
    } catch (e) {
        if (e instanceof RangeError) throw new Error("Code de recréation incomplet : un ou plusieurs caractères manquent.");
        throw e;
    }
    const { p, used } = parsed;
    if (Math.ceil(used / k) !== values.length) {
        throw new Error("Code de recréation trop long : un caractère a sans doute été ajouté ou collé en trop.");
    }
    if (rcCheck(values, k) !== check || bits.slice(used).some(Boolean)) throw new Error(RC_ERR_TYPO);
    if (!p._valid) throw new Error(RC_ERR_TYPO);
    delete p._valid;
    return p;
}

// Accepte un code seul, ou un nom de fichier entier : on prend ce qui suit « code= ».
// Lève une erreur au message lisible si le code est faux.
function decodeRecreationCode(input) {
    let s = String(input ?? '').trim();
    const at = s.toLowerCase().lastIndexOf('code=');
    if (at >= 0) s = s.slice(at + 5).replace(/\.[a-z0-9]{2,5}$/i, '');
    s = s.replace(/\s+/g, '');
    if (!s) throw new Error("Saisissez d'abord un code de recréation.");

    // base32 : casse indifférente, tirets de groupement ignorés, O lu 0, I et L lus 1.
    const asBase32 = s.toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    const tries = /[a-z_]/.test(s)
        ? [['base64', s], ['base32', asBase32]]
        : [['base32', asBase32], ['base64', s]];
    let firstError = null;
    for (const [alphabet, text] of tries) {
        try { return rcDecodeWith(text, alphabet); }
        catch (e) { firstError = firstError || e; }
    }
    throw firstError;
}

// ----------------------------------------------------------------
// Codes des exports
// ----------------------------------------------------------------
// Carroyage CADO, d'après sa configuration : getGridConfiguration en carroyage
// rapide, getZoneCadoConfigAndBounds en export de zone (pivot au centre du rectangle,
// « no_cross » valant « milieu »). La déviation est passée à part : les images la
// retirent de config pour la porter elles-mêmes.
function cadoRecreationCode(config, { deviation = 0, zoom = null } = {}) {
    return encodeRecreationCode({
        kind: 'cado',
        lat: config.latitude, lon: config.longitude,
        pivot: config.referencePointChoice === 'origin' ? 'origin' : 'center',
        scale: Number(config.scale),
        startCol: letterToNumber(String(config.startCol)), endCol: letterToNumber(String(config.endCol)),
        startRow: Number(config.startRow), endRow: Number(config.endRow),
        direction: config.letteringDirection,
        swapAxes: !!config.swapAxes, doubleEntry: !!config.doubleEntry,
        deviation, zoom,
    });
}

// Rectangle de l'export de zone, tel que saisi (6 décimales).
function zoneRecreationCode({ north, west, south, east }, { deviation = 0, zoom = null } = {}) {
    return encodeRecreationCode({ kind: 'zone', north, west, south, east, deviation, zoom });
}

const recreationCodeFilePart = (code) => code ? `_code=${code}` : '';
const recreationCodeDescription = (code) => code ? `Code de recréation : ${code}` : '';

// ----------------------------------------------------------------
// Métadonnées des images : le code voyage dans le fichier, même renommé
// ----------------------------------------------------------------
// Même texte dans tous les formats, près du début du fichier : chunk tEXt
// « Comment » en PNG, segment COM en JPEG, tag ImageDescription en GeoTIFF (cf.
// geotiffExport.js, option description).
const RC_META_PREFIX = 'CADO-code=';
const recreationCodeMetadata = (code) => code ? RC_META_PREFIX + code : null;

const RC_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function rcCrc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = RC_CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// Image PNG ou JPEG avec le code dans ses métadonnées ; les autres blobs, ou un code
// absent, passent tels quels.
async function blobWithRecreationCode(blob, code) {
    if (!blob || !code) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextEncoder().encode(recreationCodeMetadata(code));

    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        // PNG : chunk tEXt juste après IHDR (signature 8 + IHDR 25 octets). Le texte y
        // est suivi, sans séparateur, des 4 octets du CRC : une espace finale l'en
        // sépare, sans quoi un octet de CRC pris pour un caractère du code le
        // rallongerait (cf. RC_TRAILING_BYTES).
        const data = new Uint8Array([...new TextEncoder().encode('Comment'), 0, ...text, 0x20]);
        const chunk = new Uint8Array(12 + data.length);
        const dv = new DataView(chunk.buffer);
        dv.setUint32(0, data.length);
        chunk.set([0x74, 0x45, 0x58, 0x74], 4);                    // « tEXt »
        chunk.set(data, 8);
        dv.setUint32(8 + data.length, rcCrc32(chunk.subarray(4, 8 + data.length)));
        return new Blob([bytes.subarray(0, 33), chunk, bytes.subarray(33)], { type: blob.type });
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        // JPEG : segment COM juste après SOI
        const seg = new Uint8Array(4 + text.length);
        seg.set([0xFF, 0xFE, (text.length + 2) >> 8, (text.length + 2) & 0xFF]);
        seg.set(text, 4);
        return new Blob([bytes.subarray(0, 2), seg, bytes.subarray(2)], { type: blob.type });
    }
    return blob;
}

// Premier code valide d'un texte. Un PNG écrit avant la v23.30 n'a pas d'espace
// après le code : les 4 octets du CRC suivent, et chacun a une chance sur quatre
// d'être un caractère du code, que l'expression avale alors (« …-GP » + « l ») —
// une image sur quatre environ. On retente donc sans ces octets ; le caractère de
// contrôle et la longueur exacte écartent toute lecture de travers. Même règle
// dans CadoTour (gridRecreation.js).
const RC_TRAILING_BYTES = 4;

function findRecreationCodeIn(text, re) {
    const valid = (code) => { try { decodeRecreationCode(code); return true; } catch (e) { return false; } };
    for (const m of text.matchAll(re)) {
        for (let cut = 0; cut <= RC_TRAILING_BYTES && cut < m[1].length; cut++) {
            const candidate = m[1].slice(0, m[1].length - cut);
            if (valid(candidate)) return candidate;
        }
    }
    return null;
}

// Code d'un fichier exporté : métadonnées d'image, puis description du point A1 des
// fichiers vectoriels (KML, KMZ, GeoJSON, GPX, CSV), puis nom du fichier. Lève une
// erreur lisible si aucun code n'y figure.
async function readRecreationCodeFromFile(file) {
    const valid = (code) => { try { decodeRecreationCode(code); return true; } catch (e) { return false; } };
    const find = findRecreationCodeIn;
    const META_RE = /CADO-code=([0-9A-Za-z_-]+)/g;
    const DESC_RE = /Code de recréation : ([0-9A-Za-z_-]+)/g;

    // Métadonnées d'image, près du début ; en entier au besoin, par tranches.
    const CHUNK = 4 * 1024 * 1024;
    for (let start = 0; start < file.size; start += CHUNK - 64) {
        const bytes = new Uint8Array(await file.slice(start, start + CHUNK).arrayBuffer());
        const found = find(new TextDecoder('latin1').decode(bytes), META_RE);
        if (found) return found;
        if (start === 0 && !/\.(tiff?|png|jpe?g)$/i.test(file.name)) break;
    }

    // Fichiers vectoriels
    if (/\.kmz$/i.test(file.name) && typeof ensureJSZip === 'function') {
        await ensureJSZip();
        const zip = await JSZip.loadAsync(file);
        for (const entry of Object.values(zip.files)) {
            if (!/\.kml$/i.test(entry.name)) continue;
            const found = find(await entry.async('string'), DESC_RE);
            if (found) return found;
        }
    } else if (/\.(kml|geojson|json|gpx|csv)$/i.test(file.name)) {
        const found = find(await file.text(), DESC_RE);
        if (found) return found;
    }

    // Nom du fichier (…_code=XXXX.ext)
    const m = /code=([0-9A-Za-z_-]+)\.[a-z0-9]{2,7}$/i.exec(file.name);
    if (m && valid(m[1])) return m[1];
    throw new Error(`Aucun code de recréation trouvé dans « ${file.name} ».`);
}

// ----------------------------------------------------------------
// Restauration
// ----------------------------------------------------------------
// Configuration à la manière de getGridConfiguration, pour calculateGridData.
function rcGridConfig(p, deviation) {
    return {
        latitude: p.lat, longitude: p.lon, scale: p.scale,
        referencePointChoice: p.pivot === 'origin' ? 'origin' : 'center',
        letteringDirection: p.direction,
        startCol: numberToLetter(p.startCol), endCol: numberToLetter(p.endCol),
        startRow: p.startRow, endRow: p.endRow,
        deviation, swapAxes: p.swapAxes,
    };
}

// Emprise d'une grille CADO (bords extrêmes de ses lignes).
function rcGridBounds(p, deviation) {
    const gridData = calculateGridData(rcGridConfig(p, deviation));
    let north = -90, south = 90, east = -180, west = 180;
    [...gridData.horizontalLines, ...gridData.verticalLines].forEach(line => line.points.forEach(([lon, lat]) => {
        north = Math.max(north, lat); south = Math.min(south, lat);
        east = Math.max(east, lon); west = Math.min(west, lon);
    }));
    return { north, south, east, west };
}

// Carroyage rapide : grille CADO à appliquer. Un code de zone y devient une grille
// CADO « milieu » qui la couvre, de 26 colonnes environ comme le propose l'export de
// zone ; le sens des lettres et les axes restent ceux de l'écran.
function quickGridFromCode(p) {
    if (p.kind === 'cado') return { ...p, fromZone: false };
    const lat = (p.north + p.south) / 2;
    const lon = (p.west + p.east) / 2;
    const width = (typeof haversineDistance === 'function')
        ? haversineDistance({ lat: p.north, lon: p.west }, { lat: p.north, lon: p.east })
        : (p.east - p.west) * 111320 * Math.cos(lat * Math.PI / 180);
    const height = (p.north - p.south) * 111320;
    const scale = Math.max(1, Math.round(width / 26));
    return {
        kind: 'cado', lat, lon, pivot: 'center', scale,
        startCol: 1, endCol: Math.max(1, Math.ceil(width / scale)),
        startRow: 1, endRow: Math.max(1, Math.ceil(height / scale)),
        direction: null, swapAxes: null, doubleEntry: null,
        deviation: p.deviation, zoom: p.zoom, fromZone: true,
    };
}

// Remplit les champs du carroyage rapide. Les valeurs null laissent le champ tel quel.
function applyQuickGridSettings(g) {
    const setRadio = (name, value) => {
        const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (el) el.checked = true;
        return el;
    };
    const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    const setChecked = (id, value) => { const el = document.getElementById(id); if (el && value !== null) el.checked = !!value; };

    setValue('scale', g.scale);

    const preset = RC_PRESETS.find(r =>
        r.startCol === g.startCol && r.endCol === g.endCol && r.startRow === g.startRow && r.endRow === g.endRow);
    if (preset) {
        setRadio('grid-type', preset.name);
    } else {
        setRadio('grid-type', 'custom');
        setValue('start-col', numberToLetter(g.startCol));
        setValue('end-col', numberToLetter(g.endCol));
        setValue('start-row', g.startRow);
        setValue('end-row', g.endRow);
    }
    document.getElementById('custom-grid-options')?.classList.toggle('hidden', !!preset);
    // Les bornes libres se règlent dans les options avancées : on les ouvre pour qu'elles se voient.
    if (!preset) document.getElementById('advanced-grid-config')?.classList.remove('hidden');

    setRadio('reference-point', g.pivot === 'origin' ? 'origin' : 'center');
    if (g.direction) setRadio('lettering-direction', g.direction);
    setChecked('swap-axes', g.swapAxes);
    setChecked('double-entry', g.doubleEntry);

    const dev = document.getElementById('deviation');
    if (dev) {
        dev.value = g.deviation;
        dev.dispatchEvent(new Event('input'));
    }

    const zoomSelect = document.getElementById('cado-forced-zoom');
    if (zoomSelect) {
        const wanted = g.zoom ? String(g.zoom) : 'auto';
        zoomSelect.value = [...zoomSelect.options].some(o => o.value === wanted) ? wanted : 'auto';
        zoomSelect.dispatchEvent(new Event('change'));
    }

    if (typeof updateDynamicGridName === 'function') updateDynamicGridName();
}

// Résumé affiché sous le champ après application.
function describeQuickGrid(g) {
    const bounds = `${numberToLetter(g.startCol)}${g.startRow} à ${numberToLetter(g.endCol)}${g.endRow}`;
    const parts = [
        `${g.scale} m`, bounds,
        g.pivot === 'origin' ? 'origine A1' : 'milieu',
        g.deviation ? `déviation ${g.deviation}°` : null,
        g.zoom ? `zoom ${g.zoom} forcé` : null,
    ].filter(Boolean);
    return g.fromZone
        ? `Zone appliquée, couverte par une grille CADO : ${parts.join(', ')}. Ajustez l'échelle si besoin.`
        : `Carroyage appliqué : ${parts.join(', ')}.`;
}

// Export de zone : rectangle à tracer et, pour un code CADO, grille à reprendre telle
// quelle (cf. getZoneCadoConfigAndBounds) plutôt que recalculée d'après le rectangle.
// Le rectangle d'une grille CADO l'encadre sans rotation : c'est ainsi que l'export
// de zone la définit, la carte pivotant dessous.
function zoneFrameFromCode(p) {
    if (p.kind === 'zone') {
        return { north: p.north, west: p.west, south: p.south, east: p.east, deviation: p.deviation, zoom: p.zoom, cado: null };
    }
    const box = rcGridBounds(p, 0);
    return {
        ...box, deviation: p.deviation, zoom: p.zoom,
        cado: {
            lat: p.lat, lon: p.lon, pivot: p.pivot, scale: p.scale,
            startCol: numberToLetter(p.startCol), endCol: numberToLetter(p.endCol),
            startRow: p.startRow, endRow: p.endRow,
            direction: p.direction, swapAxes: p.swapAxes, doubleEntry: p.doubleEntry,
        },
    };
}

function describeZoneFrame(z) {
    const extra = [
        z.deviation ? `rotation ${z.deviation}°` : null,
        z.zoom ? `zoom ${z.zoom}` : null,
    ].filter(Boolean).join(', ');
    const head = z.cado
        ? `Zone et carroyage CADO appliqués (${z.cado.scale} m, ${z.cado.startCol}${z.cado.startRow} à ${z.cado.endCol}${z.cado.endRow}).`
        : 'Zone appliquée : choisissez le carroyage.';
    return extra ? `${head} ${extra[0].toUpperCase()}${extra.slice(1)}.` : head;
}

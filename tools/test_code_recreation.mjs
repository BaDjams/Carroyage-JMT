// Tests du code de recréation (seedManager.js), sans navigateur :
//   node tools/test_code_recreation.mjs
// Aller-retour des deux sortes de codes dans les deux alphabets, détection des fautes
// de frappe et des inversions, lecture d'un nom de fichier entier.
import fs from 'node:fs';
import vm from 'node:vm';

// Blob, File et TextDecoder : lecture des métadonnées d'image (readRecreationCodeFromFile).
const ctx = { console, Math, TextEncoder, TextDecoder, Blob, File };
vm.createContext(ctx);
// Le codec n'a besoin, d'utilities.js, que des conversions lettres/nombres.
const util = fs.readFileSync('utilities.js', 'utf8');
vm.runInContext(util.slice(util.indexOf('function letterToNumber'), util.indexOf('// --- LOGIQUE DE GRILLE PARTAGÉE')), ctx);
vm.runInContext(fs.readFileSync('seedManager.js', 'utf8'), ctx);
const { encodeRecreationCode: encode, decodeRecreationCode: decode, RC_ALPHABETS,
    blobWithRecreationCode, readRecreationCodeFromFile, gridScaleProblem, roundGridScale, RC_MAX_SCALE } = vm.runInContext(
    '({ encodeRecreationCode, decodeRecreationCode, RC_ALPHABETS, blobWithRecreationCode, readRecreationCodeFromFile, gridScaleProblem, roundGridScale, RC_MAX_SCALE })', ctx);

let passed = 0, failed = 0;
function test(name, cond, detail = '') {
    if (cond) { passed++; console.log(`ok   ${name}`); }
    else { failed++; console.log(`ÉCHEC ${name} ${detail}`); }
}
const throws = (text) => { try { decode(text); return false; } catch (e) { return true; } };

const CASES = [
    { kind: 'cado', lat: 48.856614, lon: 2.352222, pivot: 'center', scale: 100, startCol: 1, endCol: 26, startRow: 1, endRow: 26,
      direction: 'ascending', swapAxes: false, doubleEntry: false, deviation: 0, zoom: 17 },
    { kind: 'cado', lat: -21.115141, lon: 55.536384, pivot: 'origin', scale: 1000, startCol: 1, endCol: 15, startRow: 1, endRow: 26,
      direction: 'descending', swapAxes: true, doubleEntry: true, deviation: -37.4, zoom: null },
    { kind: 'cado', lat: 45.1, lon: -1.25, pivot: 'center', scale: 25, startCol: -4, endCol: 7, startRow: -13, endRow: 34,
      direction: 'ascending', swapAxes: false, doubleEntry: true, deviation: 180, zoom: 19 },
    { kind: 'zone', north: 43.300123, west: 5.360456, south: 43.250001, east: 5.44, deviation: 12.5, zoom: 16 },
    { kind: 'zone', north: -12.5, west: -179.9, south: -16.4, east: -172.0, deviation: 0, zoom: null },
    // Grille « centre » complétée d'un seul côté dans CadoTour : centre décalé (spec 7).
    { kind: 'cado', lat: 48.85837, lon: 2.294481, pivot: 'center', scale: 1000, startCol: -4, endCol: 26, startRow: 1, endRow: 30,
      direction: 'ascending', swapAxes: false, doubleEntry: true, deviation: 44.1, zoom: null, centerShift: { cols: -8, rows: -4 } },
];
// Version 3 : le bit du demi-mètre allonge d'un caractère le code base32 d'une grille
// prédéfinie (21 → 22) et le code base64 à bornes libres (23 → 24). Centre décalé
// (spec 7) : 16 bits de plus, 31 caractères en base32 — toute faute d'un caractère
// y reste repérée (poids α¹ à α³⁰ distincts dans GF(32)).
const LENGTHS = { base32: [22, 25, 28, 26, 26, 31], base64: [18, 21, 24, 22, 22, 26] };

for (const alphabet of ['base32', 'base64']) {
    CASES.forEach((c, i) => {
        const code = encode(c, alphabet);
        const flat = alphabet === 'base32' ? code.replace(/-/g, '') : code;
        const d = decode(code);
        const same = Object.keys(c).every(k => typeof c[k] === 'number' ? Math.abs(c[k] - d[k]) < 5e-7
            : c[k] && typeof c[k] === 'object' ? JSON.stringify(c[k]) === JSON.stringify(d[k]) : c[k] === d[k]);
        test(`${alphabet} ${c.kind} n°${i + 1} : aller-retour (${code})`, same, JSON.stringify(d));
        test(`${alphabet} ${c.kind} n°${i + 1} : ${LENGTHS[alphabet][i]} caractères`, flat.length === LENGTHS[alphabet][i], String(flat.length));
        if (c.kind === 'zone') {
            test(`${alphabet} zone n°${i + 1} : bords identiques à 6 décimales`,
                ['north', 'west', 'south', 'east'].every(k => d[k].toFixed(6) === c[k].toFixed(6)));
        }
        let missed = 0;
        for (let j = 0; j < flat.length; j++) {
            for (const ch of RC_ALPHABETS[alphabet]) {
                if (ch !== flat[j] && !throws(flat.slice(0, j) + ch + flat.slice(j + 1))) missed++;
            }
            if (j + 1 < flat.length && flat[j] !== flat[j + 1]
                && !throws(flat.slice(0, j) + flat[j + 1] + flat[j] + flat.slice(j + 2))) missed++;
        }
        test(`${alphabet} ${c.kind} n°${i + 1} : toute faute ou inversion de voisins détectée`, missed === 0, `${missed} manquées`);
        test(`${alphabet} ${c.kind} n°${i + 1} : caractère manquant détecté`, throws(flat.slice(0, 5) + flat.slice(6)));
    });
}

const b32 = encode(CASES[0], 'base32');
test('base32 en minuscules, O pour 0', decode(b32.toLowerCase().replace(/0/g, 'o')).scale === 100);
test('nom de fichier entier', decode(`Carte_100m_center_Z26_black_code=${b32}.jpg`).endRow === 26);
test('nom de fichier base64', Math.abs(decode(`Carte_code=${encode(CASES[0], 'base64')}.png`).lat - 48.856614) < 1e-9);
// Version 3 : échelle au demi-mètre (bit du demi-mètre après les 16 bits de mètres).
test('échelle au demi-mètre : 0,5 à 65 535 m relus tels quels',
    [0.5, 1, 12.5, 100, 999.5, 65534.5, 65535].every(scale => decode(encode({ ...CASES[0], scale }, 'base32')).scale === scale
        && decode(encode({ ...CASES[0], scale }, 'base64')).scale === scale));
test('échelle hors du demi-mètre : pas de code', [12.3, 12.25, 0.25].every(scale => encode({ ...CASES[0], scale }, 'base32') === null));
test('échelle nulle : pas de code', encode({ ...CASES[0], scale: 0 }, 'base32') === null);
test('saisie arrondie au demi-mètre', [['12.3', 12.5], ['12.2', 12], ['12.25', 12.5], ['12.75', 13], [7, 7], ['0.3', 0.5]]
    .every(([v, r]) => roundGridScale(v) === r));
test('saisie sous 0,5 m : message', gridScaleProblem('0.2') === "L'échelle doit être d'au moins 0,5 m par case." && gridScaleProblem(0) !== null);
test('bornes hors du code : pas de code', encode({ ...CASES[0], startCol: -200 }, 'base32') === null);
test('code vide refusé', throws(''));
test('déviation au dixième : -179,9 à 180', [-179.9, -0.1, 0.1, 32.5, 180].every(dev => decode(encode({ ...CASES[0], deviation: dev }, 'base32')).deviation === dev));
test('déviation arrondie au dixième', decode(encode({ ...CASES[0], deviation: 32.46 }, 'base32')).deviation === 32.5);
test('échelle au-delà de 65 535 m : pas de code', encode({ ...CASES[0], scale: 70000 }, 'base32') === null);
// Limite de saisie commune avec CadoTour (MAX_SCALE, carroyage.js) : 65 535 m.
test('échelle 65 535 m : code, et relue telle quelle', RC_MAX_SCALE === 65535
    && decode(encode({ ...CASES[0], scale: 65535 }, 'base32')).scale === 65535);
test('échelle 65 536 m : pas de code', encode({ ...CASES[0], scale: 65536 }, 'base32') === null);
test('saisie jusqu\'à 65 535 m acceptée sans message', [1, 10, 65535, '65535', ''].every(v => gridScaleProblem(v) === null));
test('saisie au-delà de 65 535 m : message qui nomme la limite et CadoTour',
    [65536, 100000, '70000'].every(v => /65 535 m .*CadoTour/.test(gridScaleProblem(v))));

// Codes de la version 1 (v23.28 et v23.29, déviation au degré) : toujours lus.
// Relevés sur deux cartes exportées du terrain : carroyage rapide et export de zone.
const V1 = decode('E1BQ-9Y5E-05VJ-D980-051G-H');
test('code v1 relu (carte du terrain)', Math.abs(V1.lat - 47.08352) < 5e-6 && Math.abs(V1.lon - 2.45823) < 5e-6
    && V1.scale === 10 && V1.deviation === 32 && V1.zoom === 20 && V1.endCol === 17 && V1.endRow === 12, JSON.stringify(V1));
const V1b = decode('E26S-Y15D-V5YH-B960-0A1G-7');
test('code v1 relu (image de test v23.28)', V1b.scale === 20 && V1b.deviation === 0 && V1b.endRow === 12, JSON.stringify(V1b));

// Codes de la version 2 (v23.30, échelle en mètres entiers sur 16 bits) : toujours lus.
for (const code of ['P26S-2K5D-WYAY-BGWR-0Z85-B', 'sI2RTK3nleXDmAfQUY']) {
    const V2 = decode(code);
    test(`code v2 relu (v23.30, ${code})`, V2.scale === 250 && V2.deviation === -32.5 && V2.zoom === 19
        && V2.direction === 'descending' && V2.doubleEntry === true && V2.endCol === 17 && V2.endRow === 12, JSON.stringify(V2));
}
test('code v2 réécrit en version 3', encode(decode('P26S-2K5D-WYAY-BGWR-0Z85-B'), 'base32') !== 'P26S-2K5D-WYAY-BGWR-0Z85-B'
    && decode(encode(decode('P26S-2K5D-WYAY-BGWR-0Z85-B'), 'base32')).scale === 250);

// PNG : le texte du chunk tEXt est suivi, sans séparateur, des 4 octets du CRC.
// Avant la v23.30, un octet de CRC qui tombait dans l'alphabet du code s'y collait
// (une image sur quatre environ) et le code n'était plus lu.
const PNG_1PX = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const readBytes = (bytes, name) => readRecreationCodeFromFile(new File([bytes], name));
{
    const code = encode(CASES[1], 'base32');
    const png = new Uint8Array(await (await blobWithRecreationCode(new Blob([PNG_1PX], { type: 'image/png' }), code)).arrayBuffer());
    test('PNG : une espace sépare le code du CRC', Buffer.from(png).toString('latin1').includes(`CADO-code=${code} `));
    test('PNG écrit : code relu, même renommé', (await readBytes(png, 'renomme.png')) === code);
    // PNG d'avant la v23.30 : code suivi directement d'octets du CRC qui ressemblent au code.
    for (const tail of ['l', 'l7', 'Ab_-', 'zz9Q']) {
        const legacy = Buffer.from(`PNG tEXtComment CADO-code=${code}${tail}\u0001\u0002`, 'latin1');
        test(`PNG ancien : code relu malgré le CRC « ${tail} » collé`, (await readBytes(legacy, 'ancien.png')) === code);
    }
    const b64 = encode(CASES[0], 'base64');
    test('PNG ancien : code base64 relu malgré un CRC collé',
        (await readBytes(Buffer.from(`CADO-code=${b64}Q\u0000`, 'latin1'), 'ancien.png')) === b64);
}

// Centre décalé : seulement pour une grille « centre », jamais nul, dans les bornes du code.
{
    const shifted = CASES[5];
    test('centre décalé : grille « coin A1 » → décalage ignoré',
        !decode(encode({ ...shifted, pivot: 'origin' }, 'base32')).centerShift);
    const plain = encode({ ...shifted, centerShift: { cols: 0, rows: 0 } }, 'base32');
    test('centre décalé nul : code ordinaire à bornes libres (28 caractères)',
        !decode(plain).centerShift && plain.replace(/-/g, '').length === 28);
    test('centre décalé au-delà de ±128 demi-cases : pas de code',
        encode({ ...shifted, centerShift: { cols: 200, rows: 0 } }, 'base32') === null);
    test('centre décalé, bornes hors des bornes libres : pas de code',
        encode({ ...shifted, startCol: 1, endCol: 200 }, 'base32') === null);
}

console.log(`\n${passed}/${passed + failed} tests réussis`);
process.exit(failed ? 1 : 0);

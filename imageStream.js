// imageStream.js — Encodage d'image PAR BANDES : PNG et JPEG écrits au fil de l'eau.
//
// Le navigateur n'encode une image qu'entière (canvas.toBlob), et un canvas ne
// dépasse pas 32 767 px de côté ni 268 Mpx — deux canevas de cette taille ne
// tiennent d'ailleurs pas en mémoire. Ces encodeurs reçoivent l'image bande après
// bande (quelques centaines de lignes RGBA à la fois) et produisent le fichier
// sans jamais la tenir entière (cf. zoneBands.js, export de zone).
//
//   const png = createPngStream({ width, height, alpha: false, comment });
//   await png.write(rgba, rows);   // rows lignes de width pixels RGBA
//   const blob = await png.finish();
//
// COPIE CONFORME de imageStream.js de CadoTour (module ES là-bas, script classique
// ici) : même corps, octet pour octet — seul cet emballage diffère. Toute
// évolution se fait des deux côtés ; tools/test_image_stream.mjs le vérifie.
//
// `comment` : texte inscrit dans le fichier, là où blobWithRecreationCode
// (seedManager.js) place le code de recréation — bloc tEXt « Comment » juste
// après l'en-tête PNG, segment COM juste après le début du JPEG.
//
// API exposée sur window : crc32, createPngStream, JPEG_MAX_SIDE, jpegQuantTable, createJpegStream.

(function (global) {
    'use strict';

    // ── CRC-32 (PNG) ─────────────────────────────────────────────────────────────
    const CRC_TABLE = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();

    function crc32(bytes, crc = 0xffffffff) {
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      return crc;
    }

    const ascii = s => Uint8Array.from(s, ch => ch.charCodeAt(0));

    function pngChunk(type, data) {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      out.set(ascii(type), 4);
      out.set(data, 8);
      dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
      return out;
    }

    // Vérifie une bande reçue : dimensions et contenu.
    function checkRows(rgba, rows, width, done, height) {
      if (!(rows > 0) || rgba.length < rows * width * 4) throw new Error('bande incomplète');
      if (done + rows > height) throw new Error('plus de lignes que l’image n’en compte');
    }

    // ── PNG ──────────────────────────────────────────────────────────────────────
    /**
     * PNG écrit par bandes. `alpha` : RGBA (calque transparent) ou RGB (image opaque,
     * un quart plus légère). Chaque ligne prend le filtre qui la compresse le mieux
     * parmi « aucun », « Sub » et « Up » (heuristique de libpng : plus petite somme
     * des écarts) ; la compression est celle du navigateur (CompressionStream).
     */
    function createPngStream({ width, height, alpha = true, comment = null }) {
      const channels = alpha ? 4 : 3, rowBytes = width * channels;
      const header = new Uint8Array(13);
      const hv = new DataView(header.buffer);
      hv.setUint32(0, width); hv.setUint32(4, height);
      header.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
      const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), pngChunk('IHDR', header)];
      if (comment != null) parts.push(pngChunk('tEXt', new Uint8Array([...ascii('Comment'), 0, ...new TextEncoder().encode(comment)])));

      const zlib = new CompressionStream('deflate');
      const writer = zlib.writable.getWriter();
      const reader = zlib.readable.getReader();
      const pumping = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          parts.push(pngChunk('IDAT', value));
        }
      })();

      let prev = new Uint8Array(rowBytes), cur = new Uint8Array(rowBytes), done = 0;
      const cost = v => (v < 128 ? v : 256 - v);

      async function write(rgba, rows) {
        checkRows(rgba, rows, width, done, height);
        const out = new Uint8Array(rows * (rowBytes + 1));
        for (let r = 0; r < rows; r++) {
          const src = r * width * 4;
          if (alpha) cur.set(rgba.subarray(src, src + rowBytes));
          else for (let x = 0, i = src, j = 0; x < width; x++, i += 4) { cur[j++] = rgba[i]; cur[j++] = rgba[i + 1]; cur[j++] = rgba[i + 2]; }
          let none = 0, sub = 0, up = 0;
          for (let i = 0; i < rowBytes; i++) {
            const v = cur[i];
            none += cost(v);
            sub += cost((v - (i >= channels ? cur[i - channels] : 0)) & 0xff);
            up += cost((v - prev[i]) & 0xff);
          }
          const o = r * (rowBytes + 1);
          if (sub < none && sub <= up) {
            out[o] = 1;
            for (let i = 0; i < rowBytes; i++) out[o + 1 + i] = cur[i] - (i >= channels ? cur[i - channels] : 0);
          } else if (up < none) {
            out[o] = 2;
            for (let i = 0; i < rowBytes; i++) out[o + 1 + i] = cur[i] - prev[i];
          } else {
            out[o] = 0;
            out.set(cur, o + 1);
          }
          [prev, cur] = [cur, prev];
        }
        done += rows;
        await writer.write(out);
      }

      async function finish() {
        if (done !== height) throw new Error(`image incomplète : ${done} lignes sur ${height}`);
        await writer.close();
        await pumping;
        parts.push(pngChunk('IEND', new Uint8Array(0)));
        return new Blob(parts, { type: 'image/png' });
      }

      return { write, finish };
    }

    // ── JPEG ─────────────────────────────────────────────────────────────────────
    // Encodeur JPEG de base (ISO 10918-1), 4:4:4 : sans sous-échantillonnage des
    // couleurs, un texte rouge ou bleu de la carte reste net, sans bavure de couleur.
    // Tables de quantification et de Huffman de l'annexe K de la norme, qualité mise
    // à l'échelle comme la bibliothèque de l'IJG (celle des navigateurs).

    const JPEG_MAX_SIDE = 65535;   // la norme code chaque dimension sur 16 bits

    const ZIGZAG = [
      0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
      12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
      35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
      58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
    ];
    const Q_LUMA = [
      16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
      14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
      18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
      49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
    ];
    const Q_CHROMA = [
      17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
      24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
      ...new Array(32).fill(99),
    ];
    const DC_LUMA = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
    const DC_CHROMA = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
    const AC_LUMA = {
      bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
      vals: [
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
        0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
        0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
        0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
        0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
        0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
        0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
        0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
        0xf9, 0xfa,
      ],
    };
    const AC_CHROMA = {
      bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
      vals: [
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
        0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
        0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
        0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
        0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
        0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
        0xf9, 0xfa,
      ],
    };

    // Codes canoniques d'une table de Huffman : { valeur → [code, longueur] }.
    function huffmanCodes({ bits, vals }) {
      const codes = new Array(256);
      let code = 0, k = 0;
      for (let len = 1; len <= 16; len++) {
        for (let i = 0; i < bits[len - 1]; i++) codes[vals[k++]] = [code++, len];
        code <<= 1;
      }
      return codes;
    }

    // Table de quantification (ordre naturel) à la qualité q ∈ ]0, 1], comme l'IJG.
    function jpegQuantTable(base, quality) {
      const q = Math.min(100, Math.max(1, Math.round(quality * 100)));
      const scale = q < 50 ? 5000 / q : 200 - 2 * q;
      return base.map(v => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
    }

    // Facteurs d'échelle de la DCT flottante AAN (jfdctflt.c de l'IJG).
    const AAN = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];
    const divisors = q => Float64Array.from(q, (v, n) => 1 / (v * AAN[n >> 3] * AAN[n & 7] * 8));

    // DCT 8 × 8 en place (lignes puis colonnes), algorithme AAN.
    function fdct(d) {
      for (let pass = 0; pass < 2; pass++) {
        const step = pass ? 8 : 1, stride = pass ? 1 : 8;
        for (let i = 0; i < 8; i++) {
          const o = i * stride;
          const d0 = d[o], d1 = d[o + step], d2 = d[o + 2 * step], d3 = d[o + 3 * step];
          const d4 = d[o + 4 * step], d5 = d[o + 5 * step], d6 = d[o + 6 * step], d7 = d[o + 7 * step];
          const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6;
          const t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
          let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
          d[o] = t10 + t11; d[o + 4 * step] = t10 - t11;
          const z1 = (t12 + t13) * 0.707106781;
          d[o + 2 * step] = t13 + z1; d[o + 6 * step] = t13 - z1;
          t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
          const z5 = (t10 - t12) * 0.382683433;
          const z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
          const z11 = t7 + z3, z13 = t7 - z3;
          d[o + 5 * step] = z13 + z2; d[o + 3 * step] = z13 - z2;
          d[o + step] = z11 + z4; d[o + 7 * step] = z11 - z4;
        }
      }
    }

    /**
     * JPEG écrit par bandes : chaque bande de 8 lignes est encodée dès qu'elle est
     * complète ; la dernière est complétée en répétant sa dernière ligne. `quality`
     * se lit comme celle de canvas.toBlob (0,92 par défaut). La transparence est
     * ignorée : le JPEG n'en a pas.
     */
    function createJpegStream({ width, height, quality = 0.92, comment = null }) {
      if (width > JPEG_MAX_SIDE || height > JPEG_MAX_SIDE) throw new Error(`le JPEG est limité à ${JPEG_MAX_SIDE} px de côté`);
      const qY = jpegQuantTable(Q_LUMA, quality), qC = jpegQuantTable(Q_CHROMA, quality);
      const divY = divisors(qY), divC = divisors(qC);
      const dcY = huffmanCodes(DC_LUMA), acY = huffmanCodes(AC_LUMA), dcC = huffmanCodes(DC_CHROMA), acC = huffmanCodes(AC_CHROMA);

      // En-têtes : SOI, commentaire, JFIF, tables, trame et balayage.
      const head = [0xff, 0xd8];
      const segment = (marker, bytes) => head.push(0xff, marker, (bytes.length + 2) >> 8, (bytes.length + 2) & 0xff, ...bytes);
      if (comment != null) segment(0xfe, [...new TextEncoder().encode(comment)]);
      segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
      segment(0xdb, [0, ...ZIGZAG.map(n => qY[n]), 1, ...ZIGZAG.map(n => qC[n])]);
      segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
      segment(0xc4, [0x00, ...DC_LUMA.bits, ...DC_LUMA.vals, 0x10, ...AC_LUMA.bits, ...AC_LUMA.vals,
        0x01, ...DC_CHROMA.bits, ...DC_CHROMA.vals, 0x11, ...AC_CHROMA.bits, ...AC_CHROMA.vals]);
      segment(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
      const parts = [Uint8Array.from(head)];

      // Écriture des bits, avec l'octet de bourrage après chaque 0xFF.
      let buf = new Uint8Array(1 << 20), pos = 0, bitBuf = 0, bitCnt = 0;
      const putByte = b => {
        if (pos === buf.length) { parts.push(buf); buf = new Uint8Array(1 << 20); pos = 0; }
        buf[pos++] = b;
      };
      const putBits = (code, len) => {
        bitBuf = (bitBuf << len) | code; bitCnt += len;
        while (bitCnt >= 8) {
          const b = (bitBuf >>> (bitCnt - 8)) & 0xff;
          putByte(b);
          if (b === 0xff) putByte(0);
          bitCnt -= 8;
        }
        bitBuf &= (1 << bitCnt) - 1;
      };
      const category = v => 32 - Math.clz32(v < 0 ? -v : v);

      const block = new Float64Array(64), zz = new Int32Array(64);
      const prevDC = [0, 0, 0];
      function encodeBlock(comp, div, dc, ac) {
        fdct(block);
        for (let i = 0; i < 64; i++) zz[i] = Math.round(block[ZIGZAG[i]] * div[ZIGZAG[i]]);
        const diff = zz[0] - prevDC[comp]; prevDC[comp] = zz[0];
        const c0 = category(diff);
        putBits(...dc[c0]);
        if (c0) putBits((diff < 0 ? diff - 1 : diff) & ((1 << c0) - 1), c0);
        let end = 63;
        while (end > 0 && zz[end] === 0) end--;
        for (let i = 1, run = 0; i <= end; i++) {
          const v = zz[i];
          if (v === 0) { run++; continue; }
          while (run > 15) { putBits(...ac[0xf0]); run -= 16; }
          const c = category(v);
          putBits(...ac[(run << 4) | c]);
          putBits((v < 0 ? v - 1 : v) & ((1 << c) - 1), c);
          run = 0;
        }
        if (end < 63) putBits(...ac[0x00]);
      }

      // Bande de 8 lignes RGBA en attente d'encodage.
      const band = new Uint8ClampedArray(width * 8 * 4);
      let bandRows = 0, done = 0;

      function encodeBand() {
        for (let r = bandRows; r < 8; r++) band.copyWithin(r * width * 4, (bandRows - 1) * width * 4, bandRows * width * 4);
        for (let bx = 0; bx < width; bx += 8) {
          for (let comp = 0; comp < 3; comp++) {
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const i = (y * width + Math.min(bx + x, width - 1)) * 4;
                const R = band[i], G = band[i + 1], B = band[i + 2];
                block[y * 8 + x] = comp === 0 ? 0.299 * R + 0.587 * G + 0.114 * B - 128
                  : comp === 1 ? -0.168736 * R - 0.331264 * G + 0.5 * B
                    : 0.5 * R - 0.418688 * G - 0.081312 * B;
              }
            }
            if (comp === 0) encodeBlock(0, divY, dcY, acY);
            else encodeBlock(comp, divC, dcC, acC);
          }
        }
        bandRows = 0;
      }

      async function write(rgba, rows) {
        checkRows(rgba, rows, width, done, height);
        for (let r = 0; r < rows; r++) {
          band.set(rgba.subarray(r * width * 4, (r + 1) * width * 4), bandRows * width * 4);
          if (++bandRows === 8) encodeBand();
        }
        done += rows;
      }

      async function finish() {
        if (done !== height) throw new Error(`image incomplète : ${done} lignes sur ${height}`);
        if (bandRows) encodeBand();
        if (bitCnt) putBits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);   // bourrage final à 1
        putByte(0xff); putByte(0xd9);
        parts.push(buf.subarray(0, pos));
        return new Blob(parts, { type: 'image/jpeg' });
      }

      return { write, finish };
    }

    global.crc32 = crc32;
    global.createPngStream = createPngStream;
    global.JPEG_MAX_SIDE = JPEG_MAX_SIDE;
    global.jpegQuantTable = jpegQuantTable;
    global.createJpegStream = createJpegStream;
})(typeof window !== 'undefined' ? window : globalThis);

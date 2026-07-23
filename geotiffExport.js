// geotiffExport.js
// Encodeur GeoTIFF « maison », sans dépendance (même esprit que l'écriture MBTiles
// du projet). Convertit un <canvas> en fichier .tif RGB géoréférencé.
//
// Le canvas exporté est un raster Web Mercator (EPSG:3857) nord-haut : on attache
// les tags GeoTIFF (ModelPixelScale + ModelTiepoint + GeoKeyDirectory) pour qu'un
// SIG (QGIS, ArcGIS…) le cale exactement sur le fond de carte.
//
// Deux variantes de sortie, toutes deux mono-fichier .tif :
//   • RGB non compressé (sans perte, mais volumineux) ;
//   • compressé JPEG in-TIFF (Compression=7) — même image qu'un JPEG, donc bien
//     plus léger, sans aucune dépendance (le flux JPEG sort de canvas.toBlob et
//     est simplement encapsulé dans le conteneur TIFF).
//
// API exposée sur window :
//   geoAnchorFromWorldPixels(worldPxX, worldPxY, zoom) -> { originX, originY, metersPerPixel }
//   canvasToGeoTIFF(canvas, opts) -> Blob             (RGB non compressé)
//   canvasToGeoTIFFJpeg(canvas, opts) -> Promise<Blob> (compressé JPEG, + opts.quality)
//     opts communs : originX, originY, pixelScaleX, pixelScaleY, epsg=3857,
//                    tiePointI=0, tiePointJ=0
//   canvasToGeoTIFFUTM(canvas, opts) -> Promise<Blob|null> (reprojeté UTM, compressé JPEG)
//     opts : latLonToPx(lat,lon)->{x,y} (pixels du canvas source), bounds={north,south,east,west},
//            metersPerPixel (résolution cible), maxDim=4096 (borne la taille de sortie), quality=0.92
//     Nécessite WGS84_to_UTM (carroyageUTM.js) chargé avant l'appel.
//
// Limite v1 : géoréférencement axis-aligned (nord-haut) → valable uniquement quand
// le rendu n'est PAS pivoté. La rotation (ModelTransformation affine) est une
// extension future.

(function () {
    'use strict';

    // Demi-circonférence terrestre en Web Mercator (m) : limite de la projection.
    const WEBMERC_HALF = 20037508.342789244;

    /**
     * Convertit des « world pixels » Web Mercator (origine coin haut-gauche du
     * monde, 256·2^zoom px de côté) en coordonnées EPSG:3857 (mètres) du coin
     * haut-gauche, + la taille d'un pixel en mètres à ce niveau de zoom.
     */
    function geoAnchorFromWorldPixels(worldPxX, worldPxY, zoom) {
        const worldSizePx = 256 * Math.pow(2, zoom);
        const metersPerPixel = (2 * WEBMERC_HALF) / worldSizePx;
        return {
            originX: -WEBMERC_HALF + worldPxX * metersPerPixel,
            originY:  WEBMERC_HALF - worldPxY * metersPerPixel,
            metersPerPixel
        };
    }

    // ----- Tags TIFF -----
    const T = {
        ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
        Photometric: 262, StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278,
        StripByteCounts: 279, PlanarConfig: 284,
        YCbCrSubSampling: 530, YCbCrPositioning: 531, ReferenceBlackWhite: 532,
        ModelPixelScale: 33550, ModelTiepoint: 33922, GeoKeyDirectory: 34735,
    };
    // Types TIFF
    const TYPE = { SHORT: 3, LONG: 4, RATIONAL: 5, DOUBLE: 12 };
    const TYPE_SIZE = { 3: 2, 4: 4, 5: 8, 12: 8 };

    // GeoKeyDirectory : 3 clés (toutes inline).
    //  1024 GTModelTypeGeoKey    = 1 (ModelTypeProjected)
    //  1025 GTRasterTypeGeoKey   = 1 (RasterPixelIsArea : tie point = coin du pixel)
    //  3072 ProjectedCSTypeGeoKey = code EPSG (3857)
    function buildGeoKeys(epsg) {
        return [
            1, 1, 0, 3,          // version, revision, minor, nombre de clés
            1024, 0, 1, 1,
            1025, 0, 1, 1,
            3072, 0, 1, epsg,
        ];
    }

    /**
     * Assemble un fichier TIFF little-endian à 1 strip à partir d'une liste
     * d'entrées IFD (triées par tag croissant, dont une marquée isStripOffset) et
     * du bloc d'octets pixel (RGB brut ou flux JPEG). Retourne un ArrayBuffer.
     */
    function assembleTiff(entries, pixelBytes) {
        const bytesPerStrip = pixelBytes.length;

        // --- Calcul des offsets (en-tête 8, IFD, blocs externes, puis pixels) ---
        const ifdStart = 8;
        const ifdSize = 2 + entries.length * 12 + 4;
        let extPos = align2(ifdStart + ifdSize);

        // Réserve l'espace des valeurs externes (> 4 octets) ; conserve l'offset.
        for (const e of entries) {
            const sizeBytes = TYPE_SIZE[e.type] * e.count;
            if (sizeBytes > 4) { e.extOffset = extPos; extPos = align2(extPos + sizeBytes); }
        }
        const pixelOffset = align2(extPos);
        const totalSize = pixelOffset + bytesPerStrip;

        const buf = new ArrayBuffer(totalSize);
        const dv = new DataView(buf);

        // En-tête TIFF (little-endian)
        dv.setUint8(0, 0x49); dv.setUint8(1, 0x49);  // « II »
        dv.setUint16(2, 42, true);
        dv.setUint32(4, ifdStart, true);

        // IFD
        dv.setUint16(ifdStart, entries.length, true);
        let p = ifdStart + 2;
        for (const e of entries) {
            dv.setUint16(p, e.tag, true);
            dv.setUint16(p + 2, e.type, true);
            dv.setUint32(p + 4, e.count, true);
            const sizeBytes = TYPE_SIZE[e.type] * e.count;
            const valPos = p + 8;
            if (e.isStripOffset) {
                dv.setUint32(valPos, pixelOffset, true);           // résolu après calcul
            } else if (sizeBytes <= 4) {
                writeValues(dv, valPos, e.type, e.values, true);    // inline
            } else {
                dv.setUint32(valPos, e.extOffset, true);            // offset externe
                writeValues(dv, e.extOffset, e.type, e.values, false);
            }
            p += 12;
        }
        dv.setUint32(p, 0, true); // pas d'IFD suivant

        // Données pixel (RGB brut ou flux JPEG complet)
        new Uint8Array(buf, pixelOffset, bytesPerStrip).set(pixelBytes);
        return buf;
    }

    /**
     * Encode un canvas RGBA en GeoTIFF baseline RGB 8 bits (little-endian, 1 strip,
     * non compressé). L'alpha est aplati sur fond blanc.
     */
    function canvasToGeoTIFF(canvas, opts) {
        const W = canvas.width, H = canvas.height;
        const epsg = (opts && opts.epsg) || 3857;
        const sx = opts.pixelScaleX, sy = opts.pixelScaleY;
        const tieI = opts.tiePointI || 0, tieJ = opts.tiePointJ || 0;
        const originX = opts.originX, originY = opts.originY;

        // Pixels source (RGBA, haut→bas — orientation TIFF par défaut) → RGB aplati.
        const ctx = canvas.getContext('2d');
        const rgba = ctx.getImageData(0, 0, W, H).data;
        const pixels = new Uint8Array(W * H * 3);
        let o = 0;
        for (let i = 0; i < W * H; i++) {
            const a = rgba[i * 4 + 3];
            if (a === 255) {
                pixels[o++] = rgba[i * 4];
                pixels[o++] = rgba[i * 4 + 1];
                pixels[o++] = rgba[i * 4 + 2];
            } else {
                const af = a / 255, inv = 255 * (1 - af);
                pixels[o++] = Math.round(rgba[i * 4]     * af + inv);
                pixels[o++] = Math.round(rgba[i * 4 + 1] * af + inv);
                pixels[o++] = Math.round(rgba[i * 4 + 2] * af + inv);
            }
        }

        const geoKeys = buildGeoKeys(epsg);
        // Entrées IFD (triées par tag croissant).
        const entries = [
            { tag: T.ImageWidth,      type: TYPE.LONG,   count: 1, values: [W] },
            { tag: T.ImageLength,     type: TYPE.LONG,   count: 1, values: [H] },
            { tag: T.BitsPerSample,   type: TYPE.SHORT,  count: 3, values: [8, 8, 8] },
            { tag: T.Compression,     type: TYPE.SHORT,  count: 1, values: [1] },     // 1 = non compressé
            { tag: T.Photometric,     type: TYPE.SHORT,  count: 1, values: [2] },     // 2 = RGB
            { tag: T.StripOffsets,    type: TYPE.LONG,   count: 1, values: [0], isStripOffset: true },
            { tag: T.SamplesPerPixel, type: TYPE.SHORT,  count: 1, values: [3] },
            { tag: T.RowsPerStrip,    type: TYPE.LONG,   count: 1, values: [H] },
            { tag: T.StripByteCounts, type: TYPE.LONG,   count: 1, values: [pixels.length] },
            { tag: T.PlanarConfig,    type: TYPE.SHORT,  count: 1, values: [1] },
            { tag: T.ModelPixelScale, type: TYPE.DOUBLE, count: 3, values: [sx, sy, 0] },
            { tag: T.ModelTiepoint,   type: TYPE.DOUBLE, count: 6, values: [tieI, tieJ, 0, originX, originY, 0] },
            { tag: T.GeoKeyDirectory, type: TYPE.SHORT,  count: geoKeys.length, values: geoKeys },
        ];

        return new Blob([assembleTiff(entries, pixels)], { type: 'image/tiff' });
    }

    // =========================================================================
    //  GeoTIFF compressé JPEG (Compression=7, « new-style JPEG ») — mono-fichier
    // =========================================================================

    // Récupère le flux JPEG (JFIF complet, tables incluses) produit par le canvas.
    function canvasToJpegBytes(canvas, quality) {
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) { resolve(null); return; }
                blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
            }, 'image/jpeg', quality);
        });
    }

    /**
     * Lit les facteurs d'échantillonnage du composant de luminance (Y) dans le
     * marqueur SOF du flux JPEG → [H, V], base de YCbCrSubSampling (4:2:0 = [2,2]).
     * Renvoie null si aucun SOF n'est trouvé.
     */
    function parseJpegSampling(bytes) {
        let p = 2; // saute SOI (FF D8)
        const n = bytes.length;
        while (p + 4 <= n) {
            if (bytes[p] !== 0xFF) { p++; continue; }
            const marker = bytes[p + 1];
            // Marqueurs autonomes (sans segment de longueur).
            if (marker === 0x01 || marker === 0xD8 || marker === 0xD9 ||
                (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
            const len = (bytes[p + 2] << 8) | bytes[p + 3];
            // SOF0..SOF15 hors DHT(C4)/JPG(C8)/DAC(CC) → cadres porteurs de l'échantillonnage.
            const isSOF = marker >= 0xC0 && marker <= 0xCF &&
                          marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
            if (isSOF) {
                // segment : len(2) precision(1) height(2) width(2) Nf(1) puis composants.
                // 1er composant : id(1) sampling(1) qt(1) → sampling à p+11.
                const samp = bytes[p + 11];
                return [(samp >> 4) & 0x0F, samp & 0x0F];
            }
            p += 2 + len;
        }
        return null;
    }

    /**
     * Encode un canvas en GeoTIFF compressé JPEG (mono-fichier .tif). Le raster est
     * un unique strip contenant le flux JPEG complet ; les tags YCbCr décrivent le
     * sous-échantillonnage réel du flux (lu dans son marqueur SOF) pour que libtiff/
     * GDAL (QGIS, ArcGIS…) le décodent correctement. Retourne un Blob, ou null si
     * l'encodage JPEG échoue. opts identiques à canvasToGeoTIFF + quality (0–1).
     */
    async function canvasToGeoTIFFJpeg(canvas, opts) {
        const W = canvas.width, H = canvas.height;
        const epsg = (opts && opts.epsg) || 3857;
        const sx = opts.pixelScaleX, sy = opts.pixelScaleY;
        const tieI = opts.tiePointI || 0, tieJ = opts.tiePointJ || 0;
        const originX = opts.originX, originY = opts.originY;
        const quality = (opts.quality != null) ? opts.quality : 0.92;

        const jpeg = await canvasToJpegBytes(canvas, quality);
        if (!jpeg) return null;
        const samp = parseJpegSampling(jpeg) || [2, 2]; // défaut 4:2:0 (encodeurs navigateurs)
        const Hy = samp[0], Vy = samp[1];

        const geoKeys = buildGeoKeys(epsg);
        // Entrées IFD (triées par tag croissant).
        const entries = [
            { tag: T.ImageWidth,          type: TYPE.LONG,     count: 1, values: [W] },
            { tag: T.ImageLength,         type: TYPE.LONG,     count: 1, values: [H] },
            { tag: T.BitsPerSample,       type: TYPE.SHORT,    count: 3, values: [8, 8, 8] },
            { tag: T.Compression,         type: TYPE.SHORT,    count: 1, values: [7] },   // 7 = JPEG (new-style)
            { tag: T.Photometric,         type: TYPE.SHORT,    count: 1, values: [6] },   // 6 = YCbCr
            { tag: T.StripOffsets,        type: TYPE.LONG,     count: 1, values: [0], isStripOffset: true },
            { tag: T.SamplesPerPixel,     type: TYPE.SHORT,    count: 1, values: [3] },
            { tag: T.RowsPerStrip,        type: TYPE.LONG,     count: 1, values: [H] },
            { tag: T.StripByteCounts,     type: TYPE.LONG,     count: 1, values: [jpeg.length] },
            { tag: T.PlanarConfig,        type: TYPE.SHORT,    count: 1, values: [1] },
            { tag: T.YCbCrSubSampling,    type: TYPE.SHORT,    count: 2, values: [Hy, Vy] },
            { tag: T.YCbCrPositioning,    type: TYPE.SHORT,    count: 1, values: [1] },   // 1 = centered
            { tag: T.ReferenceBlackWhite, type: TYPE.RATIONAL, count: 6, values: [0, 255, 128, 255, 128, 255] },
            { tag: T.ModelPixelScale,     type: TYPE.DOUBLE,   count: 3, values: [sx, sy, 0] },
            { tag: T.ModelTiepoint,       type: TYPE.DOUBLE,   count: 6, values: [tieI, tieJ, 0, originX, originY, 0] },
            { tag: T.GeoKeyDirectory,     type: TYPE.SHORT,    count: geoKeys.length, values: geoKeys },
        ];

        return new Blob([assembleTiff(entries, jpeg)], { type: 'image/tiff' });
    }

    // =========================================================================
    //  GeoTIFF reprojeté UTM (zone unique choisie au centre de la zone exportée)
    // =========================================================================

    function utmEpsgCode(zoneNumber, isNorth) {
        return (isNorth ? 32600 : 32700) + zoneNumber;
    }

    /**
     * Reprojette un canvas Web Mercator vers une grille UTM (zone unique, choisie
     * au centre de la zone — approximation standard pour une emprise qui ne
     * déborde pas trop d'une zone de 6°) puis encode le résultat en GeoTIFF
     * compressé JPEG (mono-fichier .tif, plus léger qu'un GeoTIFF RGB brut).
     * Échantillonnage plus-proche-voisin (v1).
     */
    async function canvasToGeoTIFFUTM(canvas, opts) {
        if (typeof WGS84_to_UTM === 'undefined') {
            console.error('canvasToGeoTIFFUTM : WGS84_to_UTM (carroyageUTM.js) est requis.');
            return null;
        }
        const { latLonToPx, bounds } = opts;
        const limit = opts.maxDim || 4096;

        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLon = (bounds.east + bounds.west) / 2;
        const zoneNumber = WGS84_to_UTM.fromLatLon(centerLat, centerLon).zoneNumber;
        const zoneLetter = WGS84_to_UTM.getUTMZoneLetter(centerLat);
        const isNorth = centerLat >= 0;
        const epsg = utmEpsgCode(zoneNumber, isNorth);

        const corners = [
            WGS84_to_UTM.fromLatLon(bounds.north, bounds.west, zoneNumber),
            WGS84_to_UTM.fromLatLon(bounds.north, bounds.east, zoneNumber),
            WGS84_to_UTM.fromLatLon(bounds.south, bounds.west, zoneNumber),
            WGS84_to_UTM.fromLatLon(bounds.south, bounds.east, zoneNumber),
        ];
        const minE = Math.min(...corners.map(c => c.easting));
        const maxE = Math.max(...corners.map(c => c.easting));
        const minN = Math.min(...corners.map(c => c.northing));
        const maxN = Math.max(...corners.map(c => c.northing));

        let res = (opts.metersPerPixel > 0) ? opts.metersPerPixel : 1;
        let outW = Math.max(1, Math.round((maxE - minE) / res));
        let outH = Math.max(1, Math.round((maxN - minN) / res));
        if (outW > limit || outH > limit) {
            const factor = Math.max(outW / limit, outH / limit);
            res *= factor;
            outW = Math.max(1, Math.round((maxE - minE) / res));
            outH = Math.max(1, Math.round((maxN - minN) / res));
        }

        const srcW = canvas.width, srcH = canvas.height;
        const srcData = canvas.getContext('2d').getImageData(0, 0, srcW, srcH).data;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = outW;
        outCanvas.height = outH;
        const outCtx = outCanvas.getContext('2d');
        const outImg = outCtx.createImageData(outW, outH);
        const outData = outImg.data;

        for (let j = 0; j < outH; j++) {
            const northing = maxN - (j + 0.5) * res;
            for (let i = 0; i < outW; i++) {
                const easting = minE + (i + 0.5) * res;
                const ll = WGS84_to_UTM.toLatLon(easting, northing, zoneNumber, zoneLetter);
                const px = latLonToPx(ll.latitude, ll.longitude);
                const sx = Math.round(px.x), sy = Math.round(px.y);
                const o = (j * outW + i) * 4;
                if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
                    const si = (sy * srcW + sx) * 4;
                    outData[o] = srcData[si];
                    outData[o + 1] = srcData[si + 1];
                    outData[o + 2] = srcData[si + 2];
                    outData[o + 3] = 255;
                } else {
                    outData[o] = 255; outData[o + 1] = 255; outData[o + 2] = 255; outData[o + 3] = 255;
                }
            }
        }
        outCtx.putImageData(outImg, 0, 0);

        return canvasToGeoTIFFJpeg(outCanvas, {
            originX: minE,
            originY: maxN,
            pixelScaleX: res,
            pixelScaleY: res,
            epsg,
            quality: (opts.quality != null) ? opts.quality : 0.92,
        });
    }

    function align2(n) { return n + (n & 1); }

    // Écrit `count` valeurs d'un type donné. inline=true : borné à 4 octets.
    // RATIONAL : chaque valeur = numérateur, dénominateur implicite = 1.
    function writeValues(dv, pos, type, values, inline) {
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (type === TYPE.SHORT) dv.setUint16(pos + i * 2, v & 0xffff, true);
            else if (type === TYPE.LONG) dv.setUint32(pos + i * 4, v >>> 0, true);
            else if (type === TYPE.DOUBLE) dv.setFloat64(pos + i * 8, v, true);
            else if (type === TYPE.RATIONAL) {
                dv.setUint32(pos + i * 8, v >>> 0, true);
                dv.setUint32(pos + i * 8 + 4, 1, true);
            }
        }
        // inline + SHORT count 1 : les 2 octets de poids fort restent à 0 (déjà le cas).
    }

    window.geoAnchorFromWorldPixels = geoAnchorFromWorldPixels;
    window.canvasToGeoTIFF = canvasToGeoTIFF;
    window.canvasToGeoTIFFJpeg = canvasToGeoTIFFJpeg;
    window.canvasToGeoTIFFUTM = canvasToGeoTIFFUTM;
})();

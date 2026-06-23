// geotiffExport.js
// Encodeur GeoTIFF « maison », sans dépendance (même esprit que l'écriture MBTiles
// du projet). Convertit un <canvas> en fichier .tif RGB géoréférencé.
//
// Le canvas exporté est un raster Web Mercator (EPSG:3857) nord-haut : on attache
// les tags GeoTIFF (ModelPixelScale + ModelTiepoint + GeoKeyDirectory) pour qu'un
// SIG (QGIS, ArcGIS…) le cale exactement sur le fond de carte.
//
// API exposée sur window :
//   geoAnchorFromWorldPixels(worldPxX, worldPxY, zoom) -> { originX, originY, metersPerPixel }
//   canvasToGeoTIFF(canvas, opts) -> Blob   (opts : originX, originY, pixelScaleX,
//                                            pixelScaleY, epsg=3857, tiePointI=0, tiePointJ=0)
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
        ModelPixelScale: 33550, ModelTiepoint: 33922, GeoKeyDirectory: 34735,
    };
    // Types TIFF
    const TYPE = { SHORT: 3, LONG: 4, DOUBLE: 12 };
    const TYPE_SIZE = { 3: 2, 4: 4, 12: 8 };

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

        // Pixels source (RGBA, haut→bas — orientation TIFF par défaut).
        const ctx = canvas.getContext('2d');
        const rgba = ctx.getImageData(0, 0, W, H).data;

        // GeoKeyDirectory : 3 clés (toutes inline).
        //  1024 GTModelTypeGeoKey   = 1 (ModelTypeProjected)
        //  1025 GTRasterTypeGeoKey  = 1 (RasterPixelIsArea : tie point = coin du pixel)
        //  3072 ProjectedCSTypeGeoKey = code EPSG (3857)
        const geoKeys = [
            1, 1, 0, 3,          // version, revision, minor, nombre de clés
            1024, 0, 1, 1,
            1025, 0, 1, 1,
            3072, 0, 1, epsg,
        ];

        // Entrées IFD (doivent être triées par tag croissant).
        const bytesPerStrip = W * H * 3;
        const entries = [
            { tag: T.ImageWidth,      type: TYPE.LONG,   count: 1, values: [W] },
            { tag: T.ImageLength,     type: TYPE.LONG,   count: 1, values: [H] },
            { tag: T.BitsPerSample,   type: TYPE.SHORT,  count: 3, values: [8, 8, 8] },
            { tag: T.Compression,     type: TYPE.SHORT,  count: 1, values: [1] },     // 1 = non compressé
            { tag: T.Photometric,     type: TYPE.SHORT,  count: 1, values: [2] },     // 2 = RGB
            { tag: T.StripOffsets,    type: TYPE.LONG,   count: 1, values: [0], isStripOffset: true },
            { tag: T.SamplesPerPixel, type: TYPE.SHORT,  count: 1, values: [3] },
            { tag: T.RowsPerStrip,    type: TYPE.LONG,   count: 1, values: [H] },
            { tag: T.StripByteCounts, type: TYPE.LONG,   count: 1, values: [bytesPerStrip] },
            { tag: T.PlanarConfig,    type: TYPE.SHORT,  count: 1, values: [1] },
            { tag: T.ModelPixelScale, type: TYPE.DOUBLE, count: 3, values: [sx, sy, 0] },
            { tag: T.ModelTiepoint,   type: TYPE.DOUBLE, count: 6, values: [tieI, tieJ, 0, originX, originY, 0] },
            { tag: T.GeoKeyDirectory, type: TYPE.SHORT,  count: geoKeys.length, values: geoKeys },
        ];

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
                dv.setUint32(valPos, pixelOffset, true);          // résolu après calcul
            } else if (sizeBytes <= 4) {
                writeValues(dv, valPos, e.type, e.values, true);   // inline
            } else {
                dv.setUint32(valPos, e.extOffset, true);           // offset externe
                writeValues(dv, e.extOffset, e.type, e.values, false);
            }
            p += 12;
        }
        dv.setUint32(p, 0, true); // pas d'IFD suivant

        // Données pixel : RGB, alpha aplati sur blanc
        let o = pixelOffset;
        for (let i = 0; i < W * H; i++) {
            const a = rgba[i * 4 + 3];
            if (a === 255) {
                dv.setUint8(o++, rgba[i * 4]);
                dv.setUint8(o++, rgba[i * 4 + 1]);
                dv.setUint8(o++, rgba[i * 4 + 2]);
            } else {
                const af = a / 255, inv = 255 * (1 - af);
                dv.setUint8(o++, Math.round(rgba[i * 4]     * af + inv));
                dv.setUint8(o++, Math.round(rgba[i * 4 + 1] * af + inv));
                dv.setUint8(o++, Math.round(rgba[i * 4 + 2] * af + inv));
            }
        }

        return new Blob([buf], { type: 'image/tiff' });
    }

    function align2(n) { return n + (n & 1); }

    // Écrit `count` valeurs d'un type donné. inline=true : borné à 4 octets.
    function writeValues(dv, pos, type, values, inline) {
        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (type === TYPE.SHORT) dv.setUint16(pos + i * 2, v & 0xffff, true);
            else if (type === TYPE.LONG) dv.setUint32(pos + i * 4, v >>> 0, true);
            else if (type === TYPE.DOUBLE) dv.setFloat64(pos + i * 8, v, true);
        }
        // inline + SHORT count 1 : les 2 octets de poids fort restent à 0 (déjà le cas).
    }

    window.geoAnchorFromWorldPixels = geoAnchorFromWorldPixels;
    window.canvasToGeoTIFF = canvasToGeoTIFF;
})();

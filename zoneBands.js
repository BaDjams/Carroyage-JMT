// zoneBands.js — Export de zone PAR BANDES : découpage, enregistrement du dessin,
// taille annoncée et format d'impression conseillé.
//
// Au-delà de ce qu'un canevas fabrique d'un seul tenant (16 384 px de côté,
// 64 Mpx), l'image d'export de zone est rendue bloc par bloc : chaque bloc reçoit
// le fond de carte qui le couvre, puis les surcouches (isobathes, carroyages,
// KML, points, cartouche) ; les bandes partent à l'encodeur (imageStream.js,
// geotiffExport.js). L'image n'est jamais entière en mémoire.
//
// Les surcouches ne sont pas redessinées pour chaque bloc : elles sont dessinées
// UNE fois dans un contexte « enregistreur » (createRecordingContext), qui garde
// la liste des ordres de dessin, puis rejouées sur chaque bloc — rien n'est
// retéléchargé (altitudes IGN, icônes) ni recalculé. Les fonctions de dessin
// existantes n'en savent rien : l'enregistreur se présente comme le contexte d'un
// canevas de la taille de l'image entière.
//
// Même découpage et même format d'impression que CadoTour (exportFraming.js).
//
// API exposée sur window : ZONE_SINGLE_CANVAS_SIDE, ZONE_SINGLE_CANVAS_AREA,
// ZONE_LARGE_PIXELS, zoneExportBands, createRecordingContext, printResolutions,
// printSuggestion, describeZoneImage.

(function (global) {
    'use strict';

    // Jusqu'où l'image se fabrique d'un seul tenant (canevas encodé par le
    // navigateur, le chemin le plus simple). Bien en deçà des limites d'un canevas
    // (32 767 px, 268 Mpx) : 64 Mpx RGBA pèsent déjà 256 Mo.
    const ZONE_SINGLE_CANVAS_SIDE = 16384;
    const ZONE_SINGLE_CANVAS_AREA = 64e6;
    // Au-delà, le fichier est annoncé « de grande taille ».
    const ZONE_LARGE_PIXELS = 50e6;

    const gcd = (a, b) => (b ? gcd(b, a % b) : a);

    /**
     * Découpage d'une image fabriquée par bandes : bandes de hauteur multiple de
     * 16 lignes, la bande RGBA tenant dans `bandBytes` ; blocs de `blockSide` px
     * au plus ; tailles multiples de `unit` (le facteur d'agrandissement : un bloc
     * couvre un nombre entier de pixels natifs). Rend [{ y, h, blocks: [{ x, w }] }].
     */
    function zoneExportBands(width, height, { unit = 1, blockSide = 4096, bandBytes = 128 * 1024 * 1024 } = {}) {
        const step = 16 * unit / gcd(16, unit);
        const fit = Math.min(blockSide, Math.floor(bandBytes / (width * 4)));
        const bandHeight = Math.max(step, Math.floor(fit / step) * step);
        const blockWidth = Math.max(unit, Math.floor(blockSide / unit) * unit);
        const bands = [];
        for (let y = 0; y < height; y += bandHeight) {
            const blocks = [];
            for (let x = 0; x < width; x += blockWidth) blocks.push({ x, w: Math.min(blockWidth, width - x) });
            bands.push({ y, h: Math.min(bandHeight, height - y), blocks });
        }
        return bands;
    }

    // Méthodes qui changent l'état du contexte : exécutées aussi sur le contexte
    // miroir, pour que mesures de texte et lectures d'état restent justes.
    const STATE_METHODS = new Set(['save', 'restore', 'translate', 'rotate', 'scale', 'transform',
        'setTransform', 'resetTransform', 'setLineDash']);
    // Méthodes qui rendent une valeur sans rien dessiner : servies par le miroir.
    const READ_METHODS = new Set(['measureText', 'createLinearGradient', 'createRadialGradient',
        'createConicGradient', 'createPattern', 'getTransform', 'getLineDash', 'isPointInPath',
        'isPointInStroke', 'getContextAttributes']);

    /**
     * Contexte 2D qui ENREGISTRE les ordres de dessin au lieu de les exécuter.
     *   const rec = createRecordingContext(W, H, { luminanceMap });
     *   await dessiner(rec.ctx);      // fonctions de dessin inchangées
     *   rec.replay(blockCtx, base);   // sur chaque bloc, base = transformation du bloc
     * `ctx.canvas` annonce la taille de l'image entière (marges, découpes) ;
     * `ctx.luminanceMap` fournit la carte de l'encre adaptative (adaptiveInk.js),
     * calculée sur l'image entière. `mirror` : contexte réel qui porte l'état
     * (par défaut, celui d'un petit canevas).
     */
    function createRecordingContext(width, height, { luminanceMap = null, mirror = null } = {}) {
        const m = mirror || document.createElement('canvas').getContext('2d');
        const ops = [];
        const canvas = { width, height };
        const ctx = new Proxy({}, {
            get(_, prop) {
                if (prop === 'canvas') return canvas;
                if (prop === 'luminanceMap') return luminanceMap;
                const value = m[prop];
                if (typeof value !== 'function') return value;
                if (READ_METHODS.has(prop)) return value.bind(m);
                if (prop === 'getImageData' || prop === 'putImageData') {
                    return () => { throw new Error(`${String(prop)} : indisponible pendant l'enregistrement d'une image par bandes`); };
                }
                return (...args) => {
                    ops.push([prop, args]);
                    if (STATE_METHODS.has(prop)) value.apply(m, args);
                };
            },
            set(_, prop, value) {
                ops.push(['=', prop, value]);
                m[prop] = value;
                return true;
            },
        });
        return {
            ctx,
            get size() { return ops.length; },
            // Rejoue les ordres sur `target`. `base` (DOMMatrix) : transformation
            // posée avant le rejeu ; un setTransform enregistré s'y compose, sans
            // quoi il effacerait le décalage du bloc.
            replay(target, base = null) {
                for (const [prop, a, b] of ops) {
                    if (prop === '=') { target[a] = b; continue; }
                    if (base && prop === 'setTransform') {
                        const mtx = a.length === 1 ? DOMMatrix.fromMatrix(a[0]) : new DOMMatrix(a);
                        target.setTransform(base.multiply(mtx));
                    } else if (base && prop === 'resetTransform') {
                        target.setTransform(base);
                    } else {
                        target[prop](...a);
                    }
                }
            },
        };
    }

    // Formats ISO A, en millimètres (grand côté × petit côté), du plus grand au plus petit.
    const PAPER_A = [['A0', 1189, 841], ['A1', 841, 594], ['A2', 594, 420], ['A3', 420, 297], ['A4', 297, 210], ['A5', 210, 148]];
    const MM_PER_INCH = 25.4;

    // Résolution d'impression (points par pouce) de l'image sur chaque format A,
    // dans l'orientation qui lui ressemble, l'image entière tenant sur la feuille.
    function printResolutions(width, height) {
        const long = Math.max(width, height), short = Math.min(width, height);
        return PAPER_A.map(([name, L, S]) => ({ name, dpi: Math.floor(Math.min(long / (L / MM_PER_INCH), short / (S / MM_PER_INCH))) }));
    }

    // Format de papier conseillé : le plus grand où l'image s'imprime NETTE
    // (300 ppp) et le plus grand où elle reste CORRECTE (150 ppp). Même règle que
    // CadoTour (exportFraming.printSuggestion) ; faute de définition à régler ici,
    // seul le zoom est proposé quand l'image est trop petite.
    function printSuggestion(width, height) {
        const res = printResolutions(width, height);
        const best = min => res.find(r => r.dpi >= min);
        const net = best(300), correct = best(150);
        if (!correct) return `Impression : moins de 150 ppp, même en A5 — augmentez le zoom.`;
        if (!net) return `Impression correcte jusqu’au ${correct.name} (${correct.dpi} ppp).`;
        if (net === correct) return `Impression nette jusqu’au ${net.name} (${net.dpi} ppp).`;
        return `Impression nette jusqu’au ${net.name} (${net.dpi} ppp), correcte jusqu’au ${correct.name} (${correct.dpi} ppp).`;
    }

    /**
     * Ce que le panneau annonce avant la génération : taille de l'image, format
     * d'impression conseillé et l'avertissement qui s'impose. `format` : valeur de
     * image-format-zone. level : 'ok' | 'large' | 'error' (génération à bloquer).
     */
    function describeZoneImage(width, height, format) {
        const n = v => v.toLocaleString('fr-FR');
        const size = `Image : ${n(width)} × ${n(height)} px.`;
        const side = Math.max(width, height);
        const banded = side > ZONE_SINGLE_CANVAS_SIDE || width * height > ZONE_SINGLE_CANVAS_AREA;
        let error = null;
        if (format === 'jpeg' && side > JPEG_MAX_SIDE) {
            error = `Trop grande pour le format JPEG (${n(JPEG_MAX_SIDE)} px de côté au plus) : choisissez le PNG ou le GeoTIFF, ou baissez le zoom.`;
        } else if (format === 'geotiff-utm' && banded) {
            error = `Trop grande pour le GeoTIFF UTM, dont la reprojection demande l’image entière (${n(ZONE_SINGLE_CANVAS_SIDE)} px de côté et ${n(ZONE_SINGLE_CANVAS_AREA / 1e6)} Mpx au plus) : choisissez le GeoTIFF ou le GeoTIFF JPEG, ou baissez le zoom.`;
        }
        if (error) return { level: 'error', size, print: '', note: error, banded };
        const large = width * height > ZONE_LARGE_PIXELS;
        return {
            level: large ? 'large' : 'ok', size, print: printSuggestion(width, height), banded,
            note: large ? 'Fichier de grande taille : sa génération peut ralentir l’ordinateur.' : '',
        };
    }

    Object.assign(global, {
        ZONE_SINGLE_CANVAS_SIDE, ZONE_SINGLE_CANVAS_AREA, ZONE_LARGE_PIXELS,
        zoneExportBands, createRecordingContext, printResolutions, printSuggestion, describeZoneImage,
    });
})(typeof window !== 'undefined' ? window : globalThis);

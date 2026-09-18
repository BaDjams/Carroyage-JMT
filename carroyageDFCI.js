// carroyageDFCI.js
//
// Carroyage DFCI (Défense de la Forêt Contre l'Incendie), référentiel de
// localisation des CODIS et de la sécurité civile. Distinct du CFSI : mêmes
// mailles, mais pas les mêmes alphabets de carrés de 100 km.
//
// Définition (IGN / ol-ext, recoupée avec le fichier officiel data.gouv
// « Carroyage DFCI 2 km », codes ^[A-Z]{2}[02468]{2}[A-HK-L][0-9]$) :
//   - projection Lambert II étendu (EPSG:27572), origine X = 0, Y = 1 500 000 ;
//   - carré de 100 km : deux lettres (X puis Y) prises dans ABCDEFGHKLMN
//     (I et J exclus) ;
//   - carré de 20 km : deux chiffres pairs (0, 2, 4, 6, 8), X puis Y ;
//   - carré de 2 km : une lettre X dans ABCDEFGHKL puis un chiffre Y (0-9) ;
//   - subdivision du carré de 2 km : .5 pour le carré central de 1 km, .1 à .4
//     pour le reste de chaque quart, dans le sens horaire depuis le nord-ouest.
// Exemple : KD42F7.3
//
// La projection WGS84 <-> Lambert II étendu est celle de CFSI_UTILS
// (carroyageCFSI.js), conforme à EPSG:27572.

const DFCI_UTILS = (function() {
    const ORIGIN_X = 0;
    const ORIGIN_Y = 1500000;
    const ALPH_100K = "ABCDEFGHKLMN";
    const ALPH_2K = "ABCDEFGHKL";
    const MAX_X = ORIGIN_X + ALPH_100K.length * 100000;
    const MAX_Y = ORIGIN_Y + ALPH_100K.length * 100000;

    // Position d'étiquette de chaque subdivision, en mètres depuis le coin SO du
    // carré de 2 km : au creux de chaque quart en L, et au centre pour le .5.
    const QUARTER_LABELS = [
        { n: 1, dx: 350,  dy: 1650 },
        { n: 2, dx: 1650, dy: 1650 },
        { n: 3, dx: 1650, dy: 350 },
        { n: 4, dx: 350,  dy: 350 },
        { n: 5, dx: 1000, dy: 1000 }
    ];

    function toL2E(lat, lon) { return CFSI_UTILS.wgs84ToL2E(lat, lon); }
    function toWgs84(x, y) { return CFSI_UTILS.l2EToWgs84(x, y); }

    // Subdivision .1 à .5 d'un point, d'après sa position dans son carré de 2 km.
    function quarterOf(xIn, yIn) {
        const inCenter = xIn >= 500 && xIn < 1500 && yIn >= 500 && yIn < 1500;
        if (inCenter) return 5;
        const west = xIn < 1000, north = yIn >= 1000;
        if (north) return west ? 1 : 2;
        return west ? 4 : 3;
    }

    // Décompose des coordonnées Lambert II étendu en code DFCI.
    // Renvoie null hors de l'emprise du carroyage.
    function codeFromLambert(x, y) {
        const dx = Math.floor(x - ORIGIN_X);
        const dy = Math.floor(y - ORIGIN_Y);
        if (dx < 0 || dy < 0 || x >= MAX_X || y >= MAX_Y) return null;

        const c100 = ALPH_100K[Math.floor(dx / 100000)] + ALPH_100K[Math.floor(dy / 100000)];
        const c20 = "" + (2 * Math.floor((dx % 100000) / 20000)) + (2 * Math.floor((dy % 100000) / 20000));
        const c2k = ALPH_2K[Math.floor((dx % 20000) / 2000)] + Math.floor((dy % 20000) / 2000);
        const quarter = quarterOf(dx % 2000, dy % 2000);

        return {
            c100, c20, c2k, quarter,
            code20k: c100 + c20,
            code2k: c100 + c20 + c2k,
            full: `${c100}${c20}${c2k}.${quarter}`
        };
    }

    function fromLatLon(lat, lon) {
        const p = toL2E(lat, lon);
        const comps = codeFromLambert(p.x, p.y);
        return comps ? comps.full : null;
    }

    // Emprise Lambert II étendu d'une bbox WGS84 : les quatre coins, car la grille
    // est tournée par rapport aux méridiens (convergence du Lambert).
    function lambertExtent(bbox) {
        const corners = [
            toL2E(bbox.north, bbox.west), toL2E(bbox.north, bbox.east),
            toL2E(bbox.south, bbox.west), toL2E(bbox.south, bbox.east)
        ];
        return {
            minX: Math.max(ORIGIN_X, Math.min(...corners.map(c => c.x))),
            maxX: Math.min(MAX_X, Math.max(...corners.map(c => c.x))),
            minY: Math.max(ORIGIN_Y, Math.min(...corners.map(c => c.y))),
            maxY: Math.min(MAX_Y, Math.max(...corners.map(c => c.y)))
        };
    }

    // Rang d'une ligne de grille, pour le choix de son épaisseur.
    function lineRank(v) {
        if (v % 100000 === 0) return '100k';
        if (v % 20000 === 0) return '20k';
        return '2k';
    }

    // Segment Lambert -> polyligne WGS84 [[lon, lat], ...]. Une ligne droite en
    // Lambert se courbe légèrement en Mercator : on la jalonne tous les 2 km.
    function lambertSegment(x1, y1, x2, y2) {
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2000));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const g = toWgs84(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n);
            pts.push([g.lon, g.lat]);
        }
        return pts;
    }

    // Géométrie du carroyage sur une bbox, commune aux exports image, MBTiles et KML.
    // opts.step : 2000 (mailles de 2 km) ou 20000 (mailles de 20 km seulement).
    // opts.quarters : ajoute la subdivision .1 à .5 (exige step = 2000).
    // Renvoie { lines: [{rank, coords}], labels: [{kind, text, lat, lon}] } avec
    // rank = '100k' | '20k' | '2k' | 'quarter' et kind = '20k' | '2k' | 'quarter'.
    function buildGrid(bbox, opts = {}) {
        const step = opts.step === 20000 ? 20000 : 2000;
        const quarters = !!opts.quarters && step === 2000;
        const ext = lambertExtent(bbox);
        const lines = [];
        const labels = [];
        if (ext.minX >= ext.maxX || ext.minY >= ext.maxY) return { lines, labels };

        const gMinX = Math.floor(ext.minX / step) * step;
        const gMaxX = Math.ceil(ext.maxX / step) * step;
        const gMinY = Math.floor(ext.minY / step) * step;
        const gMaxY = Math.ceil(ext.maxY / step) * step;

        for (let x = gMinX; x <= gMaxX; x += step) {
            lines.push({ rank: lineRank(x), coords: lambertSegment(x, gMinY, x, gMaxY) });
        }
        for (let y = gMinY; y <= gMaxY; y += step) {
            lines.push({ rank: lineRank(y), coords: lambertSegment(gMinX, y, gMaxX, y) });
        }

        for (let x = gMinX; x < gMaxX; x += step) {
            for (let y = gMinY; y < gMaxY; y += step) {
                const comps = codeFromLambert(x + step / 2, y + step / 2);
                if (!comps) continue;
                const c = toWgs84(x + step / 2, y + step / 2);
                labels.push({
                    kind: step === 20000 ? '20k' : '2k',
                    text: step === 20000 ? comps.code20k : comps.code2k,
                    lat: c.lat, lon: c.lon
                });

                if (!quarters) continue;
                // Carré central de 1 km, puis les médianes du carré de 2 km hors de ce carré.
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 500, y + 500, x + 1500, y + 500) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 1500, y + 500, x + 1500, y + 1500) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 1500, y + 1500, x + 500, y + 1500) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 500, y + 1500, x + 500, y + 500) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 1000, y, x + 1000, y + 500) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 1000, y + 1500, x + 1000, y + 2000) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x, y + 1000, x + 500, y + 1000) });
                lines.push({ rank: 'quarter', coords: lambertSegment(x + 1500, y + 1000, x + 2000, y + 1000) });
                QUARTER_LABELS.forEach(q => {
                    const g = toWgs84(x + q.dx, y + q.dy);
                    labels.push({ kind: 'quarter', text: `.${q.n}`, code: comps.code2k, lat: g.lat, lon: g.lon });
                });
            }
        }
        return { lines, labels };
    }

    // Nombre approximatif de mailles de 2 km couvrant la bbox (garde-fou de volume).
    function count2kCells(bbox) {
        const ext = lambertExtent(bbox);
        if (ext.minX >= ext.maxX || ext.minY >= ext.maxY) return 0;
        return Math.ceil((ext.maxX - ext.minX) / 2000) * Math.ceil((ext.maxY - ext.minY) / 2000);
    }

    // Taille à l'écran d'une maille de 2 km au centre de la bbox, en pixels.
    function pixelsPer2k(bbox, project) {
        const c = toL2E((bbox.north + bbox.south) / 2, (bbox.west + bbox.east) / 2);
        const a = toWgs84(c.x, c.y);
        const b = toWgs84(c.x + 2000, c.y);
        const pa = project(a.lat, a.lon);
        const pb = project(b.lat, b.lon);
        return Math.hypot(pb.x - pa.x, pb.y - pa.y);
    }

    return { codeFromLambert, fromLatLon, buildGrid, count2kCells, pixelsPer2k };
})();

// Dessin du carroyage DFCI sur un canvas, commun à l'export image et aux MBTiles.
// Le niveau de détail suit la taille à l'écran d'une maille de 2 km :
// subdivision .1-.5 si elle est lisible, sinon mailles de 2 km, sinon de 20 km.
// style : { color, alpha, lineWidth, fontSize, halo, clip: {x, y, w, h} }
function drawDfciGrid(ctx, bbox, project, style) {
    if (typeof DFCI_UTILS === 'undefined' || typeof CFSI_UTILS === 'undefined') return;

    const fontSize = style.fontSize || 14;
    const lw = style.lineWidth || 1;
    const hex = style.color || '#000000';
    const alpha = (style.alpha === undefined) ? 1 : style.alpha;
    // Encre : couleur choisie, ou couleur adaptative lue sur le fond déjà dessiné.
    const ink = createGridInk(ctx, hex, alpha);

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    const px2k = DFCI_UTILS.pixelsPer2k(bbox, project);
    const label2kWidth = ctx.measureText("KD42F7").width;

    const quarters = px2k >= fontSize * 14;
    const step = (px2k >= 8) ? 2000 : 20000;
    const { lines, labels } = DFCI_UTILS.buildGrid(bbox, { step, quarters });

    if (style.clip) {
        ctx.beginPath();
        ctx.rect(style.clip.x, style.clip.y, style.clip.w, style.clip.h);
        ctx.clip();
    }

    const widths = { '100k': lw * 3, '20k': lw * 2.2, '2k': lw * 1.4, 'quarter': lw * 0.8 };
    const alphas = { '100k': alpha, '20k': alpha, '2k': alpha, 'quarter': alpha * 0.6 };
    ['quarter', '2k', '20k', '100k'].forEach(rank => {
        ctx.lineWidth = widths[rank];
        ctx.setLineDash(rank === 'quarter' ? [lw * 6, lw * 4] : []);
        // Une passe par trait : le dégradé de la couleur adaptative suit chaque tracé.
        // En couleur fixe, l'encre rend la même valeur pour tous.
        lines.filter(l => l.rank === rank).forEach(l => {
            const pts = l.coords.map(c => project(c[1], c[0]));
            ctx.strokeStyle = ink.strokeWithAlpha(alphas[rank], pts);
            ctx.beginPath();
            pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
            ctx.stroke();
        });
    });
    ctx.setLineDash([]);

    // Texte de la couleur des traits (ou du fond qu'il recouvre) ; liseré contrasté.
    const drawLabel = (text, x, y, size) => {
        const labelColors = ink.labelColorsAt(x, y);
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (style.halo) {
            ctx.strokeStyle = labelColors.halo;
            ctx.lineWidth = Math.max(2, size * GRID_LABEL_HALO_RATIO);
            ctx.lineJoin = 'round';
            ctx.strokeText(text, x, y);
        }
        ctx.fillStyle = labelColors.fill;
        ctx.fillText(text, x, y);
    };

    // Les codes de 2 km ne s'écrivent que s'ils tiennent dans leur maille ; à défaut
    // ceux de 20 km, qui disposent de dix fois plus de place.
    const show2kLabels = step === 2000 && label2kWidth * 1.15 <= px2k;
    if (step === 2000 && !show2kLabels) {
        DFCI_UTILS.buildGrid(bbox, { step: 20000 }).labels.forEach(l => {
            const p = project(l.lat, l.lon);
            drawLabel(l.text, p.x, p.y, fontSize * 1.3);
        });
    }
    labels.forEach(l => {
        const p = project(l.lat, l.lon);
        if (l.kind === '20k') {
            drawLabel(l.text, p.x, p.y, fontSize * 1.3);
        } else if (l.kind === '2k' && show2kLabels) {
            // Avec la subdivision, le centre porte aussi le .5 : le code remonte d'un cran.
            drawLabel(l.text, p.x, quarters ? p.y - fontSize * 0.7 : p.y, fontSize);
        } else if (l.kind === 'quarter') {
            const y = (l.text === '.5') ? p.y + fontSize * 0.7 : p.y;
            drawLabel(l.text, p.x, y, fontSize * 0.9);
        }
    });

    ctx.restore();
    // Maille reellement etiquetee, reprise par le cartouche. La subdivision ne
    // change pas la maille nommee : EG60H9 designe un carre de 2 km, et .1 a .5 le
    // decoupent. Seul le .5 central mesure 1 km de cote ; .1 a .4 sont des quarts
    // de 1 km ampute chacun du coin de 500 m que leur prend ce carre central.
    return quarters ? "2 km + quarts" : (show2kLabels ? "2 km" : "20 km");
}

// Export image : même signature que drawCfsiGridOnCanvas.
async function drawDfciGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth) {
    const colorEl = document.getElementById('utm-grid-color');
    const trEl = document.getElementById('utm-transparency');
    return drawDfciGrid(ctx, bbox, latLonToPixels, {
        color: colorEl ? colorEl.value : '#000000',
        alpha: trEl ? (100 - parseInt(trEl.value, 10)) / 100 : 0.7,
        lineWidth,
        fontSize,
        halo: true,
        clip: { x: margin, y: margin, w: ctx.canvas.width - 2 * margin, h: ctx.canvas.height - 2 * margin }
    });
}

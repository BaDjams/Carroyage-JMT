// adaptiveInk.js
//
// COULEUR ADAPTATIVE DU CARROYAGE
//
// Sur une vue satellite, aucune couleur fixe n'est lisible partout : un trait
// blanc disparaît sur une place en grès clair, un trait noir se perd sous les
// bois. La couleur adaptative lit le fond déjà dessiné sur le canvas et donne à
// chaque portion de trait, et à chaque étiquette, la couleur qui contraste le
// mieux avec ce qu'elle recouvre.
//
// Principe :
//   1. le fond est réduit en une petite carte de luminance (une case ≈ 1 % du
//      grand côté de l'image), lissée pour qu'un toit isolé ne fasse pas
//      basculer la couleur de tout un trait ;
//   2. chaque trait reçoit un dégradé le long de son tracé, échantillonné à
//      cette même maille : la couleur passe progressivement de l'une à l'autre
//      au lieu de sauter d'un pixel au suivant ;
//   3. les étiquettes prennent la couleur de leur emplacement, avec le liseré
//      opposé (cf. gridLabelColors).
//
// Le calcul repose sur les pixels du canvas : il n'a de sens que pour les
// exports image. Le KML, les MBTiles et l'aperçu Leaflet n'ont pas de fond à
// lire et retombent sur une couleur fixe (cf. resolveStaticGridColor).

// Les paires d'encres proposées dans les palettes. Chacune a une encre claire pour
// les fonds sombres et une encre sombre pour les fonds clairs.
//   adaptive        : neutre, contraste maximal (jusqu'à 1:21 entre les deux encres)
//   adaptive-color  : teintée, pour un carroyage qui se distingue du paysage sans
//                     être pris pour un élément de la carte. Jaune et violet sont
//                     les deux teintes les plus étrangères aux verts et aux bruns
//                     d'une vue aérienne, mais le contraste plafonne plus bas.
// Le noir n'est pas pur : à 6 % de luminance il reste lisible sans faire un trou.
const ADAPTIVE_INKS = {
    'adaptive':       { light: '#FFFFFF', dark: '#0F0F0F' },
    'adaptive-color': { light: '#FFE800', dark: '#5B1478' }
};
const ADAPTIVE_DEFAULT_KEY = 'adaptive';
// Taille d'une case d'échantillonnage, en part du grand côté de l'image.
const ADAPTIVE_SAMPLE_RATIO = 0.01;
const ADAPTIVE_SAMPLE_MIN_PX = 6;
const ADAPTIVE_SAMPLE_MAX_CELLS = 400;

// Clé de paire d'encres si la valeur en désigne une, sinon null.
function adaptiveInkKey(value) {
    const key = String(value || '').toLowerCase();
    return ADAPTIVE_INKS[key] ? key : null;
}

function isAdaptiveGridColor(value) {
    return adaptiveInkKey(value) !== null;
}

// Luminance relative (WCAG 2) d'une couleur hexadécimale.
function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Luminance de fond où les deux encres contrastent autant l'une que l'autre.
// Le seuil n'est pas à 0,5 : le contraste WCAG 2 vaut (L1 + 0,05) / (L2 + 0,05),
// donc les deux encres se valent quand (L + 0,05)² = (Lclair + 0,05)(Lsombre + 0,05).
// Pour la paire neutre cela donne 0,19 : dès le milieu de l'échelle des gris, un
// trait sombre contraste déjà mieux qu'un trait clair.
function adaptiveLuminancePivot(inks) {
    return Math.sqrt((relativeLuminance(inks.light) + 0.05) * (relativeLuminance(inks.dark) + 0.05)) - 0.05;
}

// Couleur utilisable là où la couleur adaptative n'a pas de sens (KML, MBTiles,
// aperçu) : l'encre claire de la paire, celle qui convient au fond sombre d'une
// vue aérienne. Le blanc pour la paire neutre, le jaune pour la paire teintée.
function resolveStaticGridColor(value, fallback) {
    const key = adaptiveInkKey(value);
    if (!key) return value;
    return fallback || ADAPTIVE_INKS[key].light;
}

// Carte de luminance du fond déjà dessiné. La réduction passe par un drawImage
// vers un petit canvas : moyenner ainsi coûte une image réduite, là où un
// getImageData sur une image de 16 000 px demanderait des centaines de Mo.
// width × height : taille de l'image que la carte décrit, si sourceCanvas n'en
// est qu'une vignette (image par bandes, cf. zoneBands.js).
function createLuminanceMap(sourceCanvas, width = sourceCanvas.width, height = sourceCanvas.height) {
    try {
        const w = width, h = height;
        if (!w || !h) return null;
        const block = Math.max(ADAPTIVE_SAMPLE_MIN_PX, Math.round(Math.max(w, h) * ADAPTIVE_SAMPLE_RATIO));
        const cols = Math.max(1, Math.min(ADAPTIVE_SAMPLE_MAX_CELLS, Math.ceil(w / block)));
        const rows = Math.max(1, Math.min(ADAPTIVE_SAMPLE_MAX_CELLS, Math.ceil(h / block)));

        const small = document.createElement('canvas');
        small.width = cols; small.height = rows;
        const sctx = small.getContext('2d', { willReadFrequently: true });
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, cols, rows);
        const data = sctx.getImageData(0, 0, cols, rows).data;

        const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const raw = new Float32Array(cols * rows);
        for (let i = 0; i < cols * rows; i++) {
            raw[i] = 0.2126 * lin(data[i * 4]) + 0.7152 * lin(data[i * 4 + 1]) + 0.0722 * lin(data[i * 4 + 2]);
        }

        // Lissage 3 x 3 : la couleur suit les grandes plages (bois, champ, place)
        // et non le détail d'une toiture.
        const lum = new Float32Array(cols * rows);
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                let sum = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                        sum += raw[ny * cols + nx]; n++;
                    }
                }
                lum[y * cols + x] = sum / n;
            }
        }
        return { cols, rows, width: w, height: h, lum, block: Math.max(w / cols, h / rows) };
    } catch (e) {
        // getImageData échoue si le canvas est « teinté » par une tuile sans CORS.
        console.warn("Couleur adaptative indisponible (fond illisible) :", e);
        return null;
    }
}

// Luminance du fond au pixel (x, y), interpolée entre les cases voisines.
function luminanceAtPixel(map, x, y) {
    const fx = Math.min(map.cols - 1, Math.max(0, (x / map.width) * map.cols - 0.5));
    const fy = Math.min(map.rows - 1, Math.max(0, (y / map.height) * map.rows - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(map.cols - 1, x0 + 1), y1 = Math.min(map.rows - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const at = (cx, cy) => map.lum[cy * map.cols + cx];
    return at(x0, y0) * (1 - tx) * (1 - ty) + at(x1, y0) * tx * (1 - ty)
         + at(x0, y1) * (1 - tx) * ty + at(x1, y1) * tx * ty;
}

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ENCRE DE CARROYAGE
// Interface unique pour les deux cas : couleur fixe choisie par l'utilisateur, ou
// couleur adaptative. `ctx` doit déjà porter le fond de carte, et aucune grille —
// sauf le contexte enregistreur d'une image par bandes, qui fournit lui-même la
// carte de luminance de l'image entière (ctx.luminanceMap).
//   ink.strokeFor(points) -> valeur à mettre dans ctx.strokeStyle (couleur ou dégradé)
//   ink.colorAt(x, y)     -> couleur opaque à cet endroit
//   ink.labelColorsAt(x, y) -> { fill, halo } pour une étiquette
function createGridInk(ctx, colorValue, alpha = 1) {
    const inkKey = adaptiveInkKey(colorValue);
    const map = inkKey ? (ctx.luminanceMap || createLuminanceMap(ctx.canvas)) : null;

    if (!inkKey || !map) {
        const base = resolveStaticGridColor(colorValue);
        const { r, g, b } = hexToRgb(base);
        const stroke = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        return {
            adaptive: false,
            baseColor: base,
            strokeFor: () => stroke,
            strokeWithAlpha: (a) => `rgba(${r}, ${g}, ${b}, ${a})`, // mêmes arguments que la version adaptative, `points` ignoré
            colorAt: () => base,
            labelColorsAt: () => gridLabelColors(base)
        };
    }

    const inks = ADAPTIVE_INKS[inkKey];
    const pivot = adaptiveLuminancePivot(inks);
    const colorAt = (x, y) => (luminanceAtPixel(map, x, y) > pivot) ? inks.dark : inks.light;
    const rgbaAt = (x, y, a) => {
        const { r, g, b } = hexToRgb(colorAt(x, y));
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    };

    // Dégradé le long du tracé, échantillonné à la maille de la carte de
    // luminance : deux couleurs voisines se fondent l'une dans l'autre sur une
    // case, au lieu de se couper net.
    const strokeWithAlpha = (points, a) => {
        if (!points || points.length === 0) return rgbaAt(0, 0, a);
        const first = points[0], last = points[points.length - 1];
        const span = Math.hypot(last.x - first.x, last.y - first.y);
        if (points.length < 2 || span < map.block) {
            return rgbaAt(first.x, first.y, a);
        }
        const gradient = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
        const steps = Math.min(64, Math.max(2, Math.round(span / map.block)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = first.x + (last.x - first.x) * t;
            const y = first.y + (last.y - first.y) * t;
            gradient.addColorStop(t, rgbaAt(x, y, a));
        }
        return gradient;
    };

    return {
        adaptive: true,
        baseColor: inks.light,
        strokeFor: (points) => strokeWithAlpha(points, alpha),
        strokeWithAlpha: (a, points) => strokeWithAlpha(points, a),
        colorAt,
        labelColorsAt: (x, y) => gridLabelColors(colorAt(x, y))
    };
}

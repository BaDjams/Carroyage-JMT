// utilities.js

// --- CONSTANTES PARTAGÉES ---
const TILE_SIZE = 256;
const MAX_ZOOM = 19;
const BAN_LOOKUP_URL = "https://plateforme.adresse.data.gouv.fr/lookup";
const BAN_SEARCH_URL = "https://data.geopf.fr/geocodage/search";

const BAN_STATUS_STYLES = {
    verified: {
        label: "Adresse certifiée",
        fill: "#6a6af4",
        stroke: "#2fc368"
    },
    pending: {
        label: "Adresse en cours de vérification",
        fill: "#6a6af4",
        stroke: "#ADB9C9"
    },
    unverified: {
        label: "Adresse non vérifiée",
        fill: "#E69F00",
        stroke: "#ADB9C9"
    },
    unknown: {
        label: "Statut non disponible",
        fill: "#E69F00",
        stroke: "#ADB9C9"
    }
};

function getBanAddressStatus(lookupData) {
    if (!lookupData) return BAN_STATUS_STYLES.unknown;
    if (lookupData.certifie === true || lookupData.certified === true) {
        return BAN_STATUS_STYLES.verified;
    }

    const sources = Array.isArray(lookupData.sources) ? lookupData.sources : [];
    const hasBalSource = lookupData.sourcePosition === "bal" || sources.includes("bal");
    return hasBalSource ? BAN_STATUS_STYLES.pending : BAN_STATUS_STYLES.unverified;
}

async function enrichBanSuggestion(feature) {
    const properties = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    const item = {
        label: properties.label,
        lat,
        lon,
        banId: properties.id,
        status: BAN_STATUS_STYLES.unknown
    };

    if (!item.banId) return item;

    try {
        const response = await fetch(`${BAN_LOOKUP_URL}/${encodeURIComponent(item.banId)}`);
        if (response.ok) {
            item.status = getBanAddressStatus(await response.json());
        }
    } catch (error) {
        console.warn("Statut BAN non disponible:", error);
    }

    return item;
}

async function fetchBanAddressSuggestions(query, limit = 5) {
    const response = await fetch(`${BAN_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${limit}`);
    const data = await response.json();
    if (!data.features?.length) return [];
    return Promise.all(data.features.map(enrichBanSuggestion));
}

function createAddressSuggestionItem(item, onSelect, className = "") {
    const li = document.createElement("li");
    if (className) li.className = className;

    const label = document.createElement("span");
    label.className = "address-suggestion-label";
    label.textContent = item.label;
    li.appendChild(label);

    if (item.status) {
        const marker = document.createElement("span");
        marker.className = "ban-status-marker";
        marker.style.backgroundColor = item.status.fill;
        marker.style.borderColor = item.status.stroke;
        marker.title = item.status.label;
        marker.setAttribute("aria-label", item.status.label);
        li.appendChild(marker);
    }

    li.addEventListener("click", () => onSelect(item));
    return li;
}
const R = 6378137; // Rayon de la Terre en mètres

// --- FONCTIONS MATHÉMATIQUES ET DE CONVERSION ---
const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

function letterToNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    if (str.startsWith('-')) return -letterToNumber(str.substring(1));
    return str.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

function numberToLetter(num) {
    if (num < 0) return '-' + numberToLetter(-num);
    if (num === 0) return '';
    let letter = '';
    let tempNum = num;
    while (tempNum > 0) {
        const remainder = (tempNum - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        tempNum = Math.floor((tempNum - 1) / 26);
    }
    return letter;
}


// --- LOGIQUE DE GRILLE PARTAGÉE ---
function generateIndices(start, end) {
    const indices = [];
    if (start <= end) {
        for (let i = start; i <= end; i++) { if (i !== 0) indices.push(i); }
    } else {
        for (let i = start; i >= end; i--) { if (i !== 0) indices.push(i); }
    }
    return indices;
}

const getOffsetInCells = (n) => {
    if (n > 0) return n - 1;
    return n;
};

const getNextIndex = (n) => (n === -1 ? 1 : n + 1);

function calculateAndRotatePoint(colNumber, rowNumber, config, a1Lat, a1Lon) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    const xOffsetMeters = (colNumber > 0 ? colNumber - 1 : colNumber) * config.scale;
    const yOffsetMeters = (rowNumber > 0 ? rowNumber - 1 : rowNumber) * config.scale;

    const finalYOffset = config.letteringDirection === 'ascending' ? yOffsetMeters : -yOffsetMeters;

    // Utiliser config.latitude (centre de la grille) comme référence de correction cosinus.
    // a1Lat varie selon le sens (sud en ascendant, nord en descendant), ce qui provoquerait
    // un écart de largeur entre les deux modes si on l'utilisait comme référence.
    const cosRefLat = (config && config.latitude != null) ? config.latitude : a1Lat;
    const unrotatedLon = a1Lon + metersToLonDegrees(xOffsetMeters, cosRefLat);
    const unrotatedLat = a1Lat + metersToLatDegrees(finalYOffset);

    if (config.deviation === 0 || !config.deviation) {
        return [unrotatedLon, unrotatedLat];
    }

    const pivotLon = config.longitude;
    const pivotLat = config.latitude;
    const deviationRad = -toRad(config.deviation);

    const cartesianX = (unrotatedLon - pivotLon) * 111320 * Math.cos(toRad(pivotLat));
    const cartesianY = (unrotatedLat - pivotLat) * 111320;

    const rotatedX = cartesianX * Math.cos(deviationRad) - cartesianY * Math.sin(deviationRad);
    const rotatedY = cartesianX * Math.sin(deviationRad) + cartesianY * Math.cos(deviationRad);

    const finalLon = pivotLon + metersToLonDegrees(rotatedX, pivotLat);
    const finalLat = pivotLat + metersToLatDegrees(rotatedY);

    return [finalLon, finalLat];
}


// --- FONCTIONS D'INTERFACE UTILISATEUR (UI) ---
function downloadFile(blob, fileName) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// --- CHARGEMENT A LA DEMANDE DES MODULES LOURDS ---
const _lazyScriptPromises = {};

function loadScriptOnce(src) {
    if (_lazyScriptPromises[src]) return _lazyScriptPromises[src];
    _lazyScriptPromises[src] = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') return resolve();
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Impossible de charger ${src}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.defer = true;
        script.dataset.loaded = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
        document.head.appendChild(script);
    });
    return _lazyScriptPromises[src];
}

async function ensureSqlJs() {
    if (typeof window.initSqlJs !== 'function') {
        await loadScriptOnce('sql-wasm.js');
    }
    if (typeof window.initSqlJs !== 'function') {
        throw new Error("SQL.js n'a pas pu etre charge.");
    }
}

async function ensureJSZip() {
    if (typeof window.JSZip !== 'function') {
        await loadScriptOnce('jszip.min.js');
    }
    if (typeof window.JSZip !== 'function') {
        throw new Error("JSZip n'a pas pu etre charge.");
    }
}

async function ensureIconsCatalog() {
    if (typeof window.ICON_CATALOG === 'undefined' && typeof ICON_CATALOG === 'undefined') {
        await loadScriptOnce('icons-catalog.js');
    }
}

async function ensureMbtilesOverlayModule() {
    await ensureSqlJs();
    if (typeof window.generateMbtilesProcess !== 'function' && typeof generateMbtilesProcess !== 'function') {
        await loadScriptOnce('carroyageToMbtiles.js');
    }
    if (typeof window.generateMbtilesProcess !== 'function' && typeof generateMbtilesProcess !== 'function') {
        throw new Error("Module MBTiles manquant (carroyageToMbtiles.js).");
    }
}

async function ensureMbtilesCreatorModule() {
    await ensureSqlJs();
    if (typeof window.initCreatorMode !== 'function') {
        await loadScriptOnce('mbtilesCreator.js');
    }
    if (typeof window.initCreatorMode !== 'function') {
        throw new Error("Module createur MBTiles manquant (mbtilesCreator.js).");
    }
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    }));

    return results;
}

function showError(message) {
    const errorDiv = document.getElementById("error-message");
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
}

function hideError() {
    document.getElementById("error-message").classList.add("hidden");
}

// =======================================================================
// --- FONCTIONS DE DESSIN CADO PARTAGÉES ---
// =======================================================================

function drawLabelWithOutline(ctx, text, x, y, config) {
    // Avec une encre (config.ink), l'étiquette prend la couleur de l'endroit qu'elle
    // recouvre et son liseré opposé ; sinon on garde le liseré choisi par nom de couleur.
    const inkColors = config.ink ? config.ink.labelColorsAt(x, y) : null;
    const darkColorsForWhiteOutline = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
    const outlineColor = darkColorsForWhiteOutline.includes(config.colorName) ? 'white' : 'black';
    
    ctx.strokeStyle = inkColors ? inkColors.halo : outlineColor;
    
    // CORRECTION : L'épaisseur de l'outline dépend de l'épaisseur du trait de grille.
    // On s'assure d'un minimum de 3px pour la lisibilité, mais on augmente si la grille est épaisse (upscaling).
    const baseLineWidth = config.lineWidth || 1;
    ctx.lineWidth = Math.max(3, baseLineWidth * 2.5);
    
    ctx.strokeText(text, x, y);
    ctx.fillStyle = inkColors ? inkColors.fill : config.gridColor;
    ctx.fillText(text, x, y);
}

function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);

    // Ligne la plus au sud (visuellement en bas) :
    //   ascendant  → numéro le plus petit (ex : 1)
    //   descendant → numéro le plus grand (ex : 12), car A1 est au nord
    const southRowNum = (config.letteringDirection === 'ascending')
        ? Math.min(config.startRow, config.endRow)
        : Math.max(config.startRow, config.endRow);

    // Bord NORD de la cellule (rowN) et bord SUD (rowS) en termes de numéro de ligne.
    // En ascendant : +1 va vers le nord.
    // En descendant : +1 va vers le sud, donc le bord nord = southRowNum, le bord sud = southRowNum+1.
    const rowN = (config.letteringDirection === 'ascending') ? southRowNum + 1 : southRowNum;
    const rowS = (config.letteringDirection === 'ascending') ? southRowNum     : southRowNum + 1;

    const geo_nw = calculateAndRotatePoint(startColNum,       rowN, config, a1Lat, a1Lon);
    const geo_ne = calculateAndRotatePoint(startColNum + 1,   rowN, config, a1Lat, a1Lon);
    const geo_sw = calculateAndRotatePoint(startColNum,       rowS, config, a1Lat, a1Lon);
    const geo_se = calculateAndRotatePoint(startColNum + 1,   rowS, config, a1Lat, a1Lon);
    const geo_c  = calculateAndRotatePoint(startColNum + 0.5, southRowNum + 0.5, config, a1Lat, a1Lon);

    const px_nw = latLonToPixels(geo_nw[1], geo_nw[0]);
    const px_ne = latLonToPixels(geo_ne[1], geo_ne[0]);
    const px_sw = latLonToPixels(geo_sw[1], geo_sw[0]);
    const px_se = latLonToPixels(geo_se[1], geo_se[0]);
    const px_c  = latLonToPixels(geo_c[1],  geo_c[0]);

    const opacity = '0.7';
    const drawSub = (color, p1, p2, p3, p4) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.fill();
    };
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    // Convention OTAN / Marine française : Jaune = NW, Bleu = NE, Vert = SW, Rouge = SE
    drawSub(`rgba(255,255,0,${opacity})`, px_nw, mid(px_nw,px_ne), px_c, mid(px_nw,px_sw)); // Jaune  NW
    drawSub(`rgba(0,0,255,${opacity})`,   mid(px_nw,px_ne), px_ne, mid(px_ne,px_se), px_c); // Bleu   NE
    drawSub(`rgba(0,128,0,${opacity})`,   mid(px_nw,px_sw), px_c, mid(px_sw,px_se), px_sw); // Vert   SW
    drawSub(`rgba(255,0,0,${opacity})`,   px_c, mid(px_ne,px_se), px_se, mid(px_sw,px_se)); // Rouge  SE

    ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px_nw.x, px_nw.y); ctx.lineTo(px_ne.x, px_ne.y);
    ctx.lineTo(px_se.x, px_se.y); ctx.lineTo(px_sw.x, px_sw.y);
    ctx.closePath(); ctx.stroke();
}

function drawReferenceCross(ctx, latLonToPixels, config, cellWidthInPixels) {
    if (config.referencePointChoice !== 'center') return;
    const refPointCoords = { lat: config.latitude, lon: config.longitude };
    const center = latLonToPixels(refPointCoords.lat, refPointCoords.lon);
    
    // CORRECTION : La taille de la croix dépend de la largeur de la case (1/3).
    // Si la largeur de case n'est pas dispo (cas rare), fallback à 20px * scale (approx).
    const crossSize = cellWidthInPixels ? (cellWidthInPixels / 5) : 20;

    ctx.strokeStyle = '#FF0000';
    // L'épaisseur de la croix est aussi proportionnelle à la grille pour rester visible
    ctx.lineWidth = Math.max(3, (config.lineWidth || 1) * 2);

    ctx.beginPath(); 
    ctx.moveTo(center.x, center.y - crossSize); 
    ctx.lineTo(center.x, center.y + crossSize); 
    ctx.stroke();
    
    ctx.beginPath(); 
    ctx.moveTo(center.x - crossSize, center.y); 
    ctx.lineTo(center.x + crossSize, center.y); 
    ctx.stroke();
}

// ===========================================================================
// CARTOUCHE : CONTENU COMMUN AUX DEUX MODES
// ===========================================================================
// Meme contenu en « Carroyage rapide » et en « Export de zone » :
//   ligne 1  nom de la carte       « Carte du 2026/09/16 a 08:30 » par defaut
//   ligne 2  echelle + fond + zoom « 1 carre = 10m, OSM z16 »
//   ligne 3  point d'origine       « Origine (A1) : 46.22760, 2.21370 »
//   ligne 4  point de reference    seulement s'il differe de l'origine A1
// La taille de l'encadre suit le contenu : hauteur par nombre de lignes, largeur
// par la ligne la plus longue.

// Un nom sans limite etirerait le cartouche jusqu'a l'absurde.
const CARTOUCHE_NAME_MAX = 60;

function defaultCartoucheName(now = new Date()) {
    const d = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
    const h = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `Carte du ${d} à ${h}`;
}

function cartoucheName(raw) {
    const name = String(raw || "").trim() || defaultCartoucheName();
    return name.length > CARTOUCHE_NAME_MAX
        ? name.slice(0, CARTOUCHE_NAME_MAX - 1).trimEnd() + "…"
        : name;
}

// Le nom par defaut contient une date (« Carte du 2026/09/16 a 08:30 ») : ses « / » et
// « : » sont interdits dans un nom de fichier. Meme assainissement pour les deux modes.
function cartoucheFileName(raw) {
    return cartoucheName(raw)
        .replace(/[\\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

// Le nom de la carte est « automatique » tant que l'utilisateur ne l'a pas saisi
// lui-meme : c'est ce que marque dataset.autoName. Une adresse recherchee remplace
// alors le nom par defaut, mais jamais un nom choisi a la main.
function setAutoCartoucheName(inputEl, name) {
    if (!inputEl) return;
    inputEl.value = name;
    // Le listener ci-dessous efface le marqueur sur cet evenement : on le repose apres.
    inputEl.dispatchEvent(new Event('input'));
    inputEl.dataset.autoName = '1';
}

function watchCartoucheNameField(inputEl) {
    if (!inputEl || inputEl.dataset.autoWatched) return;
    inputEl.dataset.autoWatched = '1';
    inputEl.addEventListener('input', () => { delete inputEl.dataset.autoName; });
}

// Une adresse recherchee devient le nom de la carte. Les libelles Nominatim sont
// souvent tres longs : cartoucheName les bride comme n'importe quelle saisie.
function applyAddressAsCartoucheName(inputEl, address) {
    if (!inputEl || !address) return;
    if (inputEl.dataset.autoName !== '1') return;
    setAutoCartoucheName(inputEl, cartoucheName(address));
}

// ÉPAISSEUR DES TRAITS DE CARROYAGE SUR UNE IMAGE EXPORTÉE
// Un trait se juge rapporté à l'image entière (écran ou feuille), pas en pixels
// bruts : 3 px sont épais sur 800 px, invisibles sur 10 000 px. On part donc de la
// norme ISO 128-2 (groupe de traits 0,5 : fin 0,25 mm, moyen 0,5 mm, épais 1 mm,
// rapport 1:2:4), appliquée à une feuille A3 dont l'image occupe toute la longueur.
// L'épaisseur est ainsi une fraction fixe du grand côté de l'image exportée
// (0,06 %, 0,12 %, 0,24 %) : l'image de 3 840 px imprimée en A3 fait 232 dpi, et un
// trait moyen y mesure 4,6 px.
// Sur une petite image la norme donnerait moins d'un pixel : un trait plus fin qu'un
// pixel ne s'amincit pas, il pâlit. On impose donc 1 px au trait fin, puis ×1,5 au
// moins d'un niveau au suivant pour qu'ils restent distincts (1 / 1,5 / 2,25 px).
const GRID_LINE_WIDTH_MM = { 1: 0.25, 2: 0.5, 3: 1.0 };
const GRID_LINE_SHEET_MM = 420; // grand côté d'une feuille A3
const GRID_LINE_MIN_PX = 1;
const GRID_LINE_MIN_STEP = 1.5;

// level : 1 (fin), 2 (moyen) ou 3 (épais), valeur des listes « Épaisseur du trait ».
// width/height : canvas sur lequel on dessine. exportScale : agrandissement appliqué
// à ce canvas APRÈS le dessin (passage en 2160 px de haut), qui épaissit les traits
// d'autant ; le calcul porte donc sur l'image réellement livrée.
// Renvoie l'épaisseur à donner à ctx.lineWidth sur le canvas de dessin.
function gridLineWidthPx(level, width, height, exportScale = 1) {
    const lvl = GRID_LINE_WIDTH_MM[level] ? Number(level) : 1;
    const pxPerMm = Math.max(width, height) * exportScale / GRID_LINE_SHEET_MM;
    let px = 0;
    for (let l = 1; l <= lvl; l++) {
        const floor = (l === 1) ? GRID_LINE_MIN_PX : px * GRID_LINE_MIN_STEP;
        px = Math.max(floor, GRID_LINE_WIDTH_MM[l] * pxPerMm);
    }
    return (Math.round(px * 4) / 4) / exportScale;
}

// Agrandissement appliqué après dessin quand « upscale » est coché (cf. l'étape
// TARGET_EXPORT_HEIGHT des exports image).
function exportUpscaleFactor(height, upscaleEnabled, targetHeight = 2160) {
    return (upscaleEnabled && height < targetHeight) ? targetHeight / height : 1;
}

// COULEURS DES ÉTIQUETTES DE CARROYAGE
// L'étiquette prend la couleur des traits, opaque, avec un liseré noir ou blanc :
// une grille claire choisie pour ressortir sur un fond sombre donne des étiquettes
// claires, qui ressortent aussi. Le liseré est celui des deux qui offre le meilleur
// rapport de contraste WCAG 2 avec la couleur du texte.
function gridLabelColors(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0;
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    const contrastWithBlack = (lum + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (lum + 0.05);
    return {
        fill: m ? `#${m[1]}` : '#000000',
        halo: contrastWithBlack > contrastWithWhite ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.85)'
    };
}

// Épaisseur du liseré d'une étiquette : le trait est centré sur le contour des
// lettres, seule sa moitié dépasse ; 25 % de la taille de police laissent un bord
// visible de 12 %, assez pour détacher le texte d'un fond chargé.
const GRID_LABEL_HALO_RATIO = 0.25;

function cartoucheCoords(lat, lon) {
    return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

// L'echelle n'a de sens que pour le carroyage CADO, dont la maille est metrique.
// Les carroyages UTM/MGRS/CFSI/DFCI se nomment, et un export sans carroyage n'annonce
// que son fond. Le fond et le niveau de zoom, eux, sont TOUJOURS indiques.
function cartoucheScaleLine({ gridKind, gridDetail, scale, layerShort, zoom } = {}) {
    const fond = [layerShort, (zoom !== null && zoom !== undefined) ? `z${zoom}` : null]
        .filter(Boolean).join(" ");
    const tete = (gridKind === "cado" && scale) ? `1 carré = ${scale}m`
        : gridKind === "utm"  ? "Carroyage UTM"
        : gridKind === "mgrs" ? "Carroyage MGRS"
        : gridKind === "cfsi" ? "Carroyage CFSI"
        : gridKind === "dfci" ? "Carroyage DFCI"
        : null;
    // Les carroyages emboites (CFSI, DFCI) annoncent la maille reellement etiquetee,
    // qui depend de la taille de la zone exportee.
    const titre = (tete && gridDetail) ? `${tete} ${gridDetail}` : tete;
    return [titre, fond].filter(Boolean).join(", ");
}

// Renvoie { lines, refIndex } : refIndex repere la ligne du point de reference,
// seule a recevoir la croix rouge au trace.
function buildCartoucheLines(opts = {}) {
    const lines = [cartoucheName(opts.name), cartoucheScaleLine(opts)];
    if (opts.originLat !== null && opts.originLat !== undefined) {
        lines.push(`Origine ${opts.originLabel || "(A1)"} : ${cartoucheCoords(opts.originLat, opts.originLon)}`);
    }
    let refIndex = -1;
    if (opts.refLat !== null && opts.refLat !== undefined) {
        refIndex = lines.length;
        lines.push(`Pt. Réf : ${cartoucheCoords(opts.refLat, opts.refLon)}`);
    }
    return { lines, refIndex };
}

// Trace l'encadre a partir des lignes deja composees. Renvoie ses dimensions, dont
// la boussole de l'export de zone a besoin pour se placer dessous.
function drawCartoucheBox(ctx, lines, x, y, fontSize, refIndex = -1) {
    const padding = fontSize * 0.5;
    const lineSpacing = fontSize * 1.3;
    ctx.font = `${fontSize}px Arial`;
    const width = Math.max(...lines.map((t) => ctx.measureText(t).width)) + padding * 2;
    const height = lineSpacing * lines.length + padding * 2;

    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = "black";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let textY = y + padding + lineSpacing / 2;
    lines.forEach((text, i) => {
        if (i === refIndex) {
            const c = fontSize * 0.4;
            const cx = x + padding + c;
            ctx.strokeStyle = "#FF0000";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - c, textY); ctx.lineTo(cx + c, textY);
            ctx.moveTo(cx, textY - c); ctx.lineTo(cx, textY + c);
            ctx.stroke();
            ctx.fillStyle = "black";
            ctx.fillText(text, cx + c + padding / 2, textY);
        } else {
            ctx.fillText(text, x + padding, textY);
        }
        textY += lineSpacing;
    });
    return { width, height };
}

function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const topRowNum = (config.letteringDirection === 'ascending')
        ? Math.max(config.startRow, config.endRow) + 1
        : Math.min(config.startRow, config.endRow);
    const anchorGeoPoint = calculateAndRotatePoint(startColNum, topRowNum, config, a1Lat, a1Lon);
    const anchorPixels = latLonToPixels(anchorGeoPoint[1], anchorGeoPoint[0]);

    const FONT_SIZE_PX = Math.max(12, cellWidthInPixels * 0.15);
    const padding = FONT_SIZE_PX * 0.5;

    // Le point de reference ne figure que s'il differe de l'origine A1 : « Milieu du
    // carroyage » le deplace, « Origine (A1) » le confond avec la ligne precedente.
    const hasRef = config.referencePointChoice === 'center';
    const { lines, refIndex } = buildCartoucheLines({
        name: config.gridNameBase,
        gridKind: config.cartoucheGridKind || 'cado',
        scale: config.scale,
        layerShort: config.cartoucheLayerShort,
        zoom: config.cartoucheZoom,
        originLat: a1Lat, originLon: a1Lon, originLabel: '(A1)',
        refLat: hasRef ? config.latitude : null,
        refLon: hasRef ? config.longitude : null,
    });

    drawCartoucheBox(ctx, lines, anchorPixels.x + padding, anchorPixels.y + padding, FONT_SIZE_PX, refIndex);
}

// utilities.js

function drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels, forcedRotation = null) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const endColNum = letterToNumber(config.endCol);
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow) 
        : Math.min(config.startRow, config.endRow);
        
    const centerPoint = calculateAndRotatePoint(endColNum + 0.5, topRowNum + 0.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    
    // Taille boussole standardisée
    const radius = cellWidthInPixels * 0.4; 

    ctx.save();
    ctx.translate(center.x, center.y);

    // Calcul de l'angle
    let rotationAngle = 0;
    if (forcedRotation !== null && forcedRotation !== undefined) {
        rotationAngle = -toRad(forcedRotation);
    } else {
        const arrowLengthInMeters = config.scale * 2; 
        const northGeoPoint = { lat: centerPoint[1] + (arrowLengthInMeters / 111320), lon: centerPoint[0] };
        const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);
        const dx = northPixel.x - center.x;
        const dy = northPixel.y - center.y;
        rotationAngle = Math.atan2(dy, dx) + (Math.PI / 2);
    }

    ctx.rotate(rotationAngle);

    // --- DESSIN UNIFORMISÉ ---
    
    // 1. Fond Cercle
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. Aiguille
    const arrowLen = radius * 0.9;
    const arrowWidth = radius * 0.25;

    // Pointe Nord (Rouge)
    ctx.beginPath();
    ctx.moveTo(0, -arrowLen);
    ctx.lineTo(arrowWidth, 0);
    ctx.lineTo(-arrowWidth, 0);
    ctx.closePath();
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pointe Sud (Blanc)
    ctx.beginPath();
    ctx.moveTo(0, arrowLen);
    ctx.lineTo(arrowWidth, 0);
    ctx.lineTo(-arrowWidth, 0);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    /* Trait central aiguille
    ctx.beginPath();
    ctx.moveTo(0, -arrowLen);
    ctx.lineTo(0, arrowLen);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 0;
    ctx.stroke();
    */

    // 3. Lettre N avec Outline Blanc
    // On annule la rotation pour le texte ? Non, la demande précédente validait que le N suive le Nord.
    // On garde donc le contexte tourné.
    
    ctx.font = `bold ${radius * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    // Outline Blanc (Contour)
    ctx.lineWidth = radius * 0.15; // Proportionnel à la taille
    ctx.strokeStyle = 'white';
    ctx.lineJoin = 'round'; // Coins arrondis pour éviter les pics
    ctx.strokeText('N', 0, -arrowLen - (radius * 0.1));
    
    // Remplissage Noir
    ctx.fillStyle = 'black';
    ctx.fillText('N', 0, -arrowLen - (radius * 0.1));

    ctx.restore();

    // Texte Déviation (Optionnel, sous la boussole)
    const devVal = (forcedRotation !== null && forcedRotation !== undefined) ? forcedRotation : config.deviation;
    if (devVal && Math.abs(devVal) > 0) {
        ctx.font = `bold ${radius * 0.4}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'black';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        const sign = devVal > 0 ? '+' : '';
        const text = `${sign}${devVal}°`;
        ctx.strokeText(text, center.x, center.y + radius + 4);
        ctx.fillText(text, center.x, center.y + radius + 4);
    }
}

// `address` a disparu : la ligne 1 du cartouche est desormais le NOM de la carte,
// uniformise avec l'export de zone.
function drawCadoElementsOnCanvas(ctx, config, latLonToPixels, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const colsToDraw = generateIndices(startColNum, endColNum);
    const rowsToDraw = generateIndices(startRowNum, endRowNum);

    if (colsToDraw.length === 0 || rowsToDraw.length === 0) return;

    // Encre du carroyage : couleur choisie, ou couleur adaptative lue sur le fond
    // déjà dessiné. Les étiquettes la reprennent via config.ink.
    const ink = createGridInk(ctx, config.gridColor, 1);
    config.ink = ink;
    ctx.lineWidth = config.lineWidth || 1;
    
    const colsForLines = [...colsToDraw, getNextIndex(colsToDraw[colsToDraw.length - 1])];
    const rowsForLines = [...rowsToDraw, getNextIndex(rowsToDraw[rowsToDraw.length - 1])];

    colsForLines.forEach(colNum => {
        const startPoint = calculateAndRotatePoint(colNum, rowsForLines[0], config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colNum, rowsForLines[rowsForLines.length - 1], config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.strokeStyle = ink.strokeFor([startPixels, endPixels]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    });

    rowsForLines.forEach(rowNum => {
        const startPoint = calculateAndRotatePoint(colsForLines[0], rowNum, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colsForLines[colsForLines.length - 1], rowNum, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.strokeStyle = ink.strokeFor([startPixels, endPixels]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    });
    
    // Calcul taille de case pour les échelles
    const geo_A1_center = calculateAndRotatePoint(startColNum + 0.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const geo_B1_center = calculateAndRotatePoint(startColNum + 1.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const px_A1_center = latLonToPixels(geo_A1_center[1], geo_A1_center[0]);
    const px_B1_center = latLonToPixels(geo_B1_center[1], geo_B1_center[0]);
    const cellWidthInPixels = Math.hypot(px_B1_center.x - px_A1_center.x, px_B1_center.y - px_A1_center.y);
    
    const labelFontSize = cellWidthInPixels * 0.75;
    if (labelFontSize > 5) {
        ctx.font = `bold ${labelFontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Dessin des labels colonnes (Axe Horizontal)
        for (const i of colsToDraw) {
            const labelPoint = calculateAndRotatePoint(i + 0.5, startRowNum - 0.5, config, a1Lat, a1Lon);
            const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
            // Si swapAxes est vrai, on dessine des chiffres en horizontal
            const text = config.swapAxes ? i.toString() : numberToLetter(i);
            drawLabelWithOutline(ctx, text, labelPixels.x, labelPixels.y, config);
        }

        // Dessin des labels lignes (Axe Vertical)
        for (const i of rowsToDraw) {
            const labelPoint = calculateAndRotatePoint(startColNum - 0.5, i + 0.5, config, a1Lat, a1Lon);
            const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
            // Si swapAxes est vrai, on dessine des lettres en vertical
            const text = config.swapAxes ? numberToLetter(i) : i.toString();
            drawLabelWithOutline(ctx, text, labelPixels.x, labelPixels.y, config);
        }

        // Double entrée : labels sur les côtés opposés (haut + droite)
        if (config.doubleEntry) {
            const lastRow = rowsForLines[rowsForLines.length - 1];
            const lastCol = colsForLines[colsForLines.length - 1];
            for (const i of colsToDraw) {
                const labelPoint = calculateAndRotatePoint(i + 0.5, lastRow + 0.5, config, a1Lat, a1Lon);
                const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
                const text = config.swapAxes ? i.toString() : numberToLetter(i);
                drawLabelWithOutline(ctx, text, labelPixels.x, labelPixels.y, config);
            }
            for (const i of rowsToDraw) {
                const labelPoint = calculateAndRotatePoint(lastCol + 0.5, i + 0.5, config, a1Lat, a1Lon);
                const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
                const text = config.swapAxes ? numberToLetter(i) : i.toString();
                drawLabelWithOutline(ctx, text, labelPixels.x, labelPixels.y, config);
            }
        }
    }
        
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels);
    
    // MODIFICATION : Détection si on est en mode "Image Rotatée" ou "Carte Standard"
    // Si la grille est dessinée droite (deviation=0 dans config), mais qu'il y a une deviation réelle dans l'UI
    // Alors on doit forcer la rotation de la boussole.
    // Pour l'instant, on passe la deviation de la config. Si config.deviation == 0, la boussole pointe vers le haut.
    // C'est dans imagetoprint.js qu'on décidera de passer un argument supplémentaire.
    
    // On passe config.realDeviation s'il existe (injecté par imagetoprint), sinon null
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels, config.realDeviation);
    
    drawReferenceCross(ctx, latLonToPixels, config, cellWidthInPixels);
}

// ===========================================================================
// COTES DES ZONES RECTANGULAIRES
// ===========================================================================
// Partage par le createur MBTiles et l'export de zone : les deux modes dessinent
// un rectangle d'emprise, et le meme habillage doit les decrire.
//
// Convention reprise de CadoTour (_measureLabelDescriptors / .map-measure-label de
// drawing.js, CSS repris a l'identique) : une etiquette par cote, posee au milieu de
// l'arete, decalee de 14 px vers l'exterieur et tournee dans le sens du trait.

// Meme ecriture que les cotes de CadoTour (_formatMeters), au seuil pres : ici la
// bascule m/km porte sur la valeur ARRONDIE. Deux cotes de 999,6 m et 1000,2 m
// s'affichaient sinon « 1000 m » et « 1,0 km » sur le meme rectangle.
function formatMapDistance(meters) {
    if (Math.round(meters) >= 1000) {
        return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1).replace(".", ",")} km`;
    }
    return `${meters < 10 ? meters.toFixed(1).replace(".", ",") : Math.round(meters)} m`;
}

// Carre centre sur un point. Les decalages sont calcules sur la sphere terrestre et
// non en degres fixes : 10 000 m valent bien 10 km quelle que soit la latitude.
function boundsAroundPoint(center, radiusMeters) {
    const earthRadius = 6371008.8;
    const latRadians = center.lat * Math.PI / 180;
    const latitudeOffset = radiusMeters / earthRadius * 180 / Math.PI;
    const longitudeOffset = radiusMeters / (earthRadius * Math.cos(latRadians)) * 180 / Math.PI;
    return L.latLngBounds(
        [center.lat - latitudeOffset, center.lng - longitudeOffset],
        [center.lat + latitudeOffset, center.lng + longitudeOffset]
    );
}

// Registre carte Leaflet -> fonction de rendu. Le hook de trace ci-dessous est pose
// sur le PROTOTYPE de Leaflet Draw, donc partage par toutes les cartes : il lui faut
// ce registre pour savoir laquelle est concernee, et ne rien faire pour les autres.
const _edgeMeasureRenderers = new Map();
let _edgeMeasureHookInstalled = false;

// Cotes pendant le TRACE. Leaflet Draw n'emet aucun evenement tant que le rectangle
// n'est pas relache ; _drawShape, lui, est appele a chaque mousemove pour redimensionner
// la forme provisoire. On s'y greffe plutot que de reconstruire l'emprise a la main.
function _installEdgeMeasureDrawHook() {
    if (_edgeMeasureHookInstalled || !window.L?.Draw?.Rectangle) return;
    const original = L.Draw.Rectangle.prototype._drawShape;
    L.Draw.Rectangle.prototype._drawShape = function (latlng) {
        original.call(this, latlng);
        const render = _edgeMeasureRenderers.get(this._map);
        if (render && this._shape) render(this._shape.getBounds());
    };
    _edgeMeasureHookInstalled = true;
}

// Equipe une carte de ses cotes. Renvoie la fonction de rendu : l'appeler avec une
// emprise pour (re)poser les etiquettes, avec null pour les effacer.
function attachEdgeMeasures(map) {
    // Calque SEPARE : le featureGroup d'edition de Leaflet Draw rendrait ces
    // etiquettes selectionnables et supprimables.
    const layer = L.layerGroup().addTo(map);
    let lastBounds = null;

    const render = (bounds) => {
        lastBounds = bounds || null;
        layer.clearLayers();
        if (!lastBounds) return;

        const corners = [lastBounds.getNorthWest(), lastBounds.getNorthEast(),
                         lastBounds.getSouthEast(), lastBounds.getSouthWest()];
        const toPx = (ll) => map.latLngToContainerPoint(ll);
        const centerPx = toPx(lastBounds.getCenter());

        for (let i = 0; i < corners.length; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % corners.length];
            const pa = toPx(a);
            const pb = toPx(b);
            const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };

            // Texte parallele a l'arete, redresse pour ne jamais s'afficher a l'envers.
            let angle = Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180 / Math.PI;
            if (angle > 90) angle -= 180;
            else if (angle < -90) angle += 180;

            // Normale a l'arete, retournee au besoin pour pointer a l'oppose du centre :
            // la cote se pose dehors, sans recouvrir le fond de carte.
            let nx = -(pb.y - pa.y);
            let ny = pb.x - pa.x;
            if ((mid.x - centerPx.x) * nx + (mid.y - centerPx.y) * ny < 0) { nx = -nx; ny = -ny; }
            const norm = Math.hypot(nx, ny) || 1;

            // Chaque cote porte SA longueur geodesique : les aretes nord et sud d'un
            // rectangle lat/lon ne mesurent pas la meme chose (convergence des meridiens).
            const anchor = map.containerPointToLatLng(
                L.point(mid.x + nx / norm * 14, mid.y + ny / norm * 14));
            const transform = `translate(-50%,-50%) rotate(${angle.toFixed(1)}deg)`;
            L.marker(anchor, {
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: "map-measure-label",
                    html: `<div style="transform:${transform}">${formatMapDistance(map.distance(a, b))}</div>`,
                    iconSize: null,
                    iconAnchor: [0, 0],
                }),
            }).addTo(layer);
        }
    };

    _edgeMeasureRenderers.set(map, render);
    _installEdgeMeasureDrawHook();
    // L'ancrage est calcule via un decalage en PIXELS : changer de zoom change la
    // latlng correspondante, il faut reposer les etiquettes.
    map.on("zoomend", () => render(lastBounds));
    // Le trace efface les cotes du rectangle precedent, qui reste affiche jusqu'a la
    // creation du nouveau : mieux vaut aucune cote qu'une cote qui ment.
    map.on(L.Draw.Event.DRAWSTART, () => render(null));
    return render;
}

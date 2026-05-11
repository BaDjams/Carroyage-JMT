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
    const darkColorsForWhiteOutline = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
    const outlineColor = darkColorsForWhiteOutline.includes(config.colorName) ? 'white' : 'black';
    
    ctx.strokeStyle = outlineColor;
    
    // CORRECTION : L'épaisseur de l'outline dépend de l'épaisseur du trait de grille.
    // On s'assure d'un minimum de 3px pour la lisibilité, mais on augmente si la grille est épaisse (upscaling).
    const baseLineWidth = config.lineWidth || 1;
    ctx.lineWidth = Math.max(3, baseLineWidth * 2.5);
    
    ctx.strokeText(text, x, y);
    ctx.fillStyle = config.gridColor;
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

function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels, address) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow) + 1 
        : Math.min(config.startRow, config.endRow);
    const anchorGeoPoint = calculateAndRotatePoint(startColNum, topRowNum, config, a1Lat, a1Lon);
    const anchorPixels = latLonToPixels(anchorGeoPoint[1], anchorGeoPoint[0]);
    
    const FONT_SIZE_RATIO = 0.15;
    const FONT_SIZE_PX = Math.max(12, cellWidthInPixels * FONT_SIZE_RATIO);
    const PADDING_RATIO = 0.5;
    const padding = FONT_SIZE_PX * PADDING_RATIO;
    const lineSpacing = FONT_SIZE_PX * 1.3;
    
    ctx.font = `${FONT_SIZE_PX}px Arial`;
    
    const refText = (config.referencePointChoice === 'center') 
        ? `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}` 
        : '';
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    
    const textsToDraw = [];

    // MODIFICATION : Ajout de l'adresse en première ligne si elle existe
    if (address && address.length > 0) {
        textsToDraw.push(address);
    }

    textsToDraw.push(config.gridNameBase);
    
    if (refText) textsToDraw.push(refText);
    textsToDraw.push(scaleText);
    
    const maxTextWidth = Math.max(...textsToDraw.map(text => ctx.measureText(text).width));
    const cartoucheWidth = maxTextWidth + (padding * 2);
    const cartoucheHeight = (lineSpacing * textsToDraw.length) + (padding * 2);
    
    const cartoucheX = anchorPixels.x + padding;
    const cartoucheY = anchorPixels.y + padding;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    let textY = cartoucheY + padding + (lineSpacing / 2);
    const refTextPattern = /^Pt\. Réf:/;
    
    for (const text of textsToDraw) {
        if (refTextPattern.test(text)) {
            const crossSize = FONT_SIZE_PX * 0.4;
            const crossX = cartoucheX + padding + crossSize;
            ctx.strokeStyle = '#FF0000'; ctx.lineWidth = 2; ctx.beginPath();
            ctx.moveTo(crossX - crossSize, textY); ctx.lineTo(crossX + crossSize, textY);
            ctx.moveTo(crossX, textY - crossSize); ctx.lineTo(crossX, textY + crossSize);
            ctx.stroke();
            ctx.fillStyle = 'black';
            ctx.fillText(text, crossX + crossSize + (padding / 2), textY);
        } else {
            ctx.fillText(text, cartoucheX + padding, textY);
        }
        textY += lineSpacing;
    }
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

function drawCadoElementsOnCanvas(ctx, config, latLonToPixels, a1CornerCoords, address = "") {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const colsToDraw = generateIndices(startColNum, endColNum);
    const rowsToDraw = generateIndices(startRowNum, endRowNum);

    if (colsToDraw.length === 0 || rowsToDraw.length === 0) return;

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = config.lineWidth || 1;
    
    const colsForLines = [...colsToDraw, getNextIndex(colsToDraw[colsToDraw.length - 1])];
    const rowsForLines = [...rowsToDraw, getNextIndex(rowsToDraw[rowsToDraw.length - 1])];

    colsForLines.forEach(colNum => {
        const startPoint = calculateAndRotatePoint(colNum, rowsForLines[0], config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colNum, rowsForLines[rowsForLines.length - 1], config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    });

    rowsForLines.forEach(rowNum => {
        const startPoint = calculateAndRotatePoint(colsForLines[0], rowNum, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(colsForLines[colsForLines.length - 1], rowNum, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
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
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels, address);
    
    // MODIFICATION : Détection si on est en mode "Image Rotatée" ou "Carte Standard"
    // Si la grille est dessinée droite (deviation=0 dans config), mais qu'il y a une deviation réelle dans l'UI
    // Alors on doit forcer la rotation de la boussole.
    // Pour l'instant, on passe la deviation de la config. Si config.deviation == 0, la boussole pointe vers le haut.
    // C'est dans imagetoprint.js qu'on décidera de passer un argument supplémentaire.
    
    // On passe config.realDeviation s'il existe (injecté par imagetoprint), sinon null
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels, config.realDeviation);
    
    drawReferenceCross(ctx, latLonToPixels, config, cellWidthInPixels);
}

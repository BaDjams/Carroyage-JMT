// utilities.js

// --- CONSTANTES PARTAGÉES ---
const TILE_SIZE = 256;
const MAX_ZOOM = 19;
const R = 6378137; // Rayon de la Terre en mètres

// --- FONCTIONS MATHÉMATIQUES ET DE CONVERSION ---
const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

/**
 * Convertit une chaîne de lettres (ex: A, B, Z, AA) en son équivalent numérique.
 * Gère les nombres négatifs (ex: "-C").
 */
function letterToNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    if (str.startsWith('-')) return -letterToNumber(str.substring(1));
    return str.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

/**
 * Convertit un nombre en sa représentation alphabétique (style colonne Excel).
 */
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

/**
 * Génère un tableau d'indices entre start et end, en gérant l'ordre
 * et en excluant la valeur 0.
 */
function generateIndices(start, end) {
    const indices = [];
    if (start <= end) {
        for (let i = start; i <= end; i++) { if (i !== 0) indices.push(i); }
    } else {
        for (let i = start; i >= end; i--) { if (i !== 0) indices.push(i); }
    }
    return indices;
}

/**
 * Convertit un indice de cellule (ex: 1 pour A) en un offset pour les calculs (ex: 0 pour A).
 */
const getOffsetInCells = (n) => {
    if (n > 0) return n - 1;
    return n;
};

/**
 * Calcule l'indice suivant pour la dernière ligne de la grille, en gérant le saut de -1 à 1.
 */
const getNextIndex = (n) => (n === -1 ? 1 : n + 1);

/**
 * Calcule les coordonnées d'un point de la grille en fonction de sa colonne/ligne,
 * de la configuration, et applique la rotation (déviation).
 * C'est la fonction centrale partagée par les deux scripts.
 */
function calculateAndRotatePoint(colNumber, rowNumber, config, a1Lat, a1Lon) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    const xOffsetMeters = (colNumber > 0 ? colNumber - 1 : colNumber) * config.scale;
    const yOffsetMeters = (rowNumber > 0 ? rowNumber - 1 : rowNumber) * config.scale;

    const finalYOffset = config.letteringDirection === 'ascending' ? yOffsetMeters : -yOffsetMeters;

    const unrotatedLon = a1Lon + metersToLonDegrees(xOffsetMeters, a1Lat);
    const unrotatedLat = a1Lat + metersToLatDegrees(finalYOffset, a1Lat);

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
// imagetoprint.js

const TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SIZE = 256;
const MAX_ZOOM = 19; // Plafond pour éviter de demander des tuiles qui n'existent pas.

/**
 * Fonction principale appelée par le bouton "Générer l'image (PNG)".
 */
async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'image pour impression...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const coordsStr = document.getElementById("decimal-coords").value;
        if (!coordsStr) throw new Error("Veuillez d'abord définir des coordonnées de référence.");
        
        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        // La grille de DONNÉES est de 26x18 (A-Z, 1-18)
        config.startCol = 'A';
        config.endCol = 'Z';
        config.startRow = 1;
        config.endRow = 18;
        config.includeGrid = true;
        config.includePoints = false;
        
        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);
        
        console.log(`Zone géographique (Bounding Box): N:${boundingBox.north}, S:${boundingBox.south}, E:${boundingBox.east}, W:${boundingBox.west}`);
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { mapImage, tileInfo } = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Assemblage de l'image finale...";
        const finalCanvas = document.createElement('canvas');
        const ctx = finalCanvas.getContext('2d');
        finalCanvas.width = mapImage.width;
        finalCanvas.height = mapImage.height;
        ctx.drawImage(mapImage, 0, 0);

        drawGridOnCanvasForPrint(ctx, tileInfo, zoomLevel, config, a1CornerCoords);
        
        const fileName = `${config.gridName}_Print_26x18.png`;
        finalCanvas.toBlob((blob) => {
            if (blob) {
                downloadFile(blob, fileName, 'image/png');
            } else {
                showError("Erreur lors de la création du fichier PNG.");
            }
        }, 'image/png');

    } catch (error) {
        console.error("Erreur lors de la génération de l'image :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Calcule la position de l'origine A1 spécifiquement pour la grille d'impression.
 */
function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        // Le centre d'une grille 26x18 se situe entre M et N (13.5) et entre 9 et 10 (9.5)
        const centerColOffset = getOffsetInCells(13) + 0.5; // Entre M (13) et N (14)
        const centerRowOffset = getOffsetInCells(9) + 0.5; // Entre 9 et 10
        
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;
        
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}


/**
 * Calcule la Bounding Box pour inclure la grille 26x18 ET les marges pour les étiquettes.
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const corners = [
        // La zone à couvrir va de la colonne "0" (pour les chiffres) à la 27 (bord droit de Z),
        // et de la ligne "0" (pour les lettres) à la 19 (bord haut de 18).
        { col: 0, row: 0 }, { col: 27, row: 0 },
        { col: 0, row: 19 }, { col: 27, row: 19 }
    ];
    const geoCorners = corners.map(corner => {
        const point = calculateAndRotatePoint(corner.col, corner.row, config, a1Lat, a1Lon);
        return { lon: point[0], lat: point[1] };
    });
    const north = Math.max(...geoCorners.map(c => c.lat));
    const south = Math.min(...geoCorners.map(c => c.lat));
    const east = Math.max(...geoCorners.map(c => c.lon));
    const west = Math.min(...geoCorners.map(c => c.lon));
    return { north, south, east, west };
}


/**
 * Calcule le niveau de zoom OSM optimal.
 * BUG CORRIGÉ : Logique de calcul de résolution revue pour être plus robuste.
 */
function calculateOptimalZoom(boundingBox) {
    const R = 6378137; // Rayon de la Terre
    const lonDiff = boundingBox.east - boundingBox.west;
    const latDiff = boundingBox.north - boundingBox.south;
    
    // Estimation de la "taille" de la bounding box. On prend la plus grande dimension.
    const maxDiff = Math.max(lonDiff, latDiff);
    
    // On estime la taille en pixels que l'on souhaite pour la carte.
    // Pour une grille de 27 cases, on peut viser une image d'environ 1500px de large
    // pour avoir une bonne résolution à l'impression.
    const targetWidthInPixels = 1500;
    
    // La formule du zoom est une approximation, mais efficace.
    const zoomLon = Math.floor(Math.log2(360 * targetWidthInPixels / (lonDiff * 256)));
    const zoomLat = Math.floor(Math.log2(360 * targetWidthInPixels / (latDiff * 256)));
    
    // On prend le zoom le plus petit des deux pour s'assurer que tout rentre.
    let zoom = Math.min(zoomLon, zoomLat);

    // On plafonne au zoom maximum défini.
    return Math.min(zoom, MAX_ZOOM);
}


function latLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRad(lat));
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = TILE_SIZE * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

function latLonToTileNumbers(lat, lon, zoom) {
    const worldPixels = latLonToWorldPixels(lat, lon, zoom);
    return {
        x: Math.floor(worldPixels.x / TILE_SIZE),
        y: Math.floor(worldPixels.y / TILE_SIZE)
    };
}

function tileNumbersToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = toDeg(latRad);
    return { lat, lon };
}


async function fetchAndAssembleTiles(boundingBox, zoom, onProgress) {
    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = (seTile.x - nwTile.x + 1) * TILE_SIZE;
    canvas.height = (seTile.y - nwTile.y + 1) * TILE_SIZE;

    const tilePromises = [];
    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    if (totalTiles === 0 || totalTiles > 400) {
        throw new Error(`Nombre de tuiles à télécharger trop élevé (${totalTiles}). Vérifiez l'échelle ou les coordonnées.`);
    }
    let downloadedCount = 0;

    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            const tileUrl = TILE_PROVIDER_URL.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
            const promise = new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const canvasX = (x - nwTile.x) * TILE_SIZE;
                    const canvasY = (y - nwTile.y) * TILE_SIZE;
                    ctx.drawImage(img, canvasX, canvasY);
                    downloadedCount++;
                    onProgress((downloadedCount / totalTiles) * 100);
                    resolve();
                };
                img.onerror = () => { reject(new Error(`Impossible de charger la tuile: ${tileUrl}`)); };
                img.src = tileUrl;
            });
            tilePromises.push(promise);
        }
    }

    await Promise.all(tilePromises);
    const tileInfo = { minX: nwTile.x, minY: nwTile.y };
    return { mapImage: canvas, tileInfo: tileInfo };
}

/**
 * Dessine la grille et les étiquettes spécifiquement pour le format d'impression.
 */
function drawGridOnCanvasForPrint(ctx, tileInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const originWorldPixels = {
        x: tileInfo.minX * TILE_SIZE,
        y: tileInfo.minY * TILE_SIZE,
    };

    const latLonToPixels = (lat, lon) => {
        const worldPixels = latLonToWorldPixels(lat, lon, zoom);
        return {
            x: worldPixels.x - originWorldPixels.x,
            y: worldPixels.y - originWorldPixels.y
        };
    };

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 2;
    ctx.fillStyle = config.gridColor;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Dessin des lignes de la grille de données (26x18)
    // Lignes verticales (de A=1 à Z+1=27)
    for (let i = 1; i <= 27; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 19, config, a1Lat, a1Lon); // 19 = bord haut de la 18ème
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }
    
    // Lignes horizontales (de 1 à 18+1=19)
    for (let i = 1; i <= 19; i++) {
        const startPoint = calculateAndRotatePoint(1, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(27, i, config, a1Lat, a1Lon); // 27 = bord droit de la 26ème (Z)
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }

    // Dessin des étiquettes dans les marges
    // Lettres (de A=1 à Z=26)
    for (let i = 1; i <= 26; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon); // Dans la "ligne 0"
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Chiffres (de 1 à 18)
    for (let i = 1; i <= 18; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon); // Dans la "colonne 0"
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
}

// imagetoprint.js

// Template de l'URL pour les tuiles OpenStreetMap.
// {z} = zoom, {x} = colonne, {y} = ligne
const TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Taille standard d'une tuile de carte web en pixels.
const TILE_SIZE = 256;

/**
 * Fonction principale appelée par le bouton "Générer l'image (PNG)".
 * Orchestre le processus de création de l'image.
 */
async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'image pour impression...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        // --- 1. Récupération et surcharge de la configuration ---
        const config = getGridConfiguration(
            parseFloat(document.getElementById("decimal-coords").value.split(',')[0]),
            parseFloat(document.getElementById("decimal-coords").value.split(',')[1])
        );
        // On force les paramètres spécifiques à l'impression
        config.startCol = 'A';
        config.endCol = 'AA'; // 27ème lettre
        config.startRow = 1;
        config.endRow = 19;
        config.includeGrid = true;
        config.includePoints = false;
        
        // --- 2. Calcul de la position de l'origine A1 ---
        // Cette étape est cruciale pour savoir où ancrer notre carte.
        const a1CornerCoords = getA1CornerCoords(config);

        // --- 3. Calcul de la Bounding Box (zone géographique à couvrir) ---
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);

        // --- 4. Détermination du niveau de zoom optimal ---
        const zoomLevel = calculateOptimalZoom(boundingBox, config.scale);
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        // --- 5. Récupération et assemblage des tuiles de carte ---
        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { mapImage, tileInfo } = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        // --- 6. Création et dessin sur le canevas final ---
        loadingMessage.textContent = "Assemblage de l'image finale...";
        const finalCanvas = document.createElement('canvas');
        const ctx = finalCanvas.getContext('2d');
        finalCanvas.width = mapImage.width;
        finalCanvas.height = mapImage.height;
        
        // Dessiner l'image de la carte assemblée
        ctx.drawImage(mapImage, 0, 0);

        // Dessiner le carroyage et les étiquettes par-dessus
        drawGridOnCanvas(ctx, tileInfo, zoomLevel, config, a1CornerCoords);
        
        // --- 7. Exportation en PNG ---
        const fileName = `${config.gridName}_Print_27x19.png`;
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
 * Calcule la position de l'origine A1 sans déclencher de boucle.
 */
function getA1CornerCoords(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        // Pour une grille 27x19, le centre est sur la 14ème colonne (N) et la 10ème ligne (10)
        const centerColOffset = getOffsetInCells(14) + 0.5; // 13.5
        const centerRowOffset = getOffsetInCells(10) + 0.5; // 9.5
        
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;

        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}


/**
 * Calcule les coordonnées géographiques des 4 coins de la grille 27x19.
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    // Coin Nord-Ouest: Coin supérieur gauche de la case A19
    const nwPoint = calculateAndRotatePoint(1, 19, config, a1Lat, a1Lon);
    
    // Coin Sud-Est: Coin inférieur droit de la case AA1
    const sePoint = calculateAndRotatePoint(28, 1, config, a1Lat, a1Lon); // 28 pour le bord droit de la 27ème case

    return {
        north: nwPoint[1],
        west: nwPoint[0],
        south: sePoint[1],
        east: sePoint[0]
    };
}


/**
 * Calcule le niveau de zoom OSM qui correspond le mieux à l'échelle demandée.
 */
function calculateOptimalZoom(boundingBox, scaleInMeters) {
    // La résolution (mètres par pixel) que l'on souhaite obtenir sur l'image finale.
    // On la base sur l'échelle d'une case divisée par la taille standard d'une tuile pour une bonne qualité.
    const requiredResolution = scaleInMeters / TILE_SIZE; 

    for (let zoom = 20; zoom >= 1; zoom--) {
        // Formule de la résolution d'une tuile OSM à une latitude donnée
        const metersPerPixel = (Math.cos(toRad(boundingBox.north)) * 2 * Math.PI * 6378137) / (TILE_SIZE * Math.pow(2, zoom));
        if (metersPerPixel <= requiredResolution) {
            return zoom;
        }
    }
    return 1;
}


/**
 * Convertit les coordonnées géographiques (Lat, Lon) en numéros de tuile (X, Y) pour un zoom donné.
 */
function latLonToTileNumbers(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const xtile = Math.floor(n * ((lon + 180) / 360));
    const ytile = Math.floor(n * (1 - (Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI)) / 2);
    return { x: xtile, y: ytile };
}

/**
 * Convertit les numéros de tuile en coordonnées géographiques du coin Nord-Ouest de la tuile.
 */
function tileNumbersToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = toDeg(latRad);
    return { lat: lat, lon: lon };
}


/**
 * Télécharge toutes les tuiles nécessaires et les assemble sur un canevas unique.
 */
async function fetchAndAssembleTiles(boundingBox, zoom, onProgress) {
    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = (seTile.x - nwTile.x + 1) * TILE_SIZE;
    canvas.height = (seTile.y - nwTile.y + 1) * TILE_SIZE;

    const tilePromises = [];
    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    let downloadedCount = 0;

    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            const tileUrl = TILE_PROVIDER_URL.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
            
            const promise = fetch(tileUrl)
                .then(response => {
                    if (!response.ok) throw new Error(`Impossible de charger la tuile: ${tileUrl}`);
                    return response.blob();
                })
                .then(blob => createImageBitmap(blob))
                .then(imageBitmap => {
                    const canvasX = (x - nwTile.x) * TILE_SIZE;
                    const canvasY = (y - nwTile.y) * TILE_SIZE;
                    ctx.drawImage(imageBitmap, canvasX, canvasY);
                    
                    downloadedCount++;
                    onProgress((downloadedCount / totalTiles) * 100);
                });
            tilePromises.push(promise);
        }
    }

    await Promise.all(tilePromises);
    
    const tileInfo = {
        minX: nwTile.x,
        minY: nwTile.y,
        maxX: seTile.x,
        maxY: seTile.y
    };
    
    return { mapImage: canvas, tileInfo: tileInfo };
}


/**
 * Dessine la grille et les étiquettes sur le canevas final.
 */
function drawGridOnCanvas(ctx, tileInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Coordonnées du coin Nord-Ouest de la toute première tuile (0,0) de notre image assemblée
    const mapOrigin = tileNumbersToLatLon(tileInfo.minX, tileInfo.minY, zoom);

    // Fonction pour convertir une coordonnée Lat/Lon en pixels sur notre canevas
    const latLonToPixels = (lat, lon) => {
        const n = Math.pow(2, zoom);
        // Calcul des pixels dans le "monde" entier au zoom donné
        const worldPixelsX = n * ((lon + 180) / 360) * TILE_SIZE;
        const worldPixelsY = n * (1 - (Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI)) / 2 * TILE_SIZE;
        
        // Coordonnées en pixels de notre point d'origine (coin NO de la première tuile)
        const originPixelsX = n * ((mapOrigin.lon + 180) / 360) * TILE_SIZE;
        const originPixelsY = n * (1 - (Math.log(Math.tan(toRad(mapOrigin.lat)) + 1 / Math.cos(toRad(mapOrigin.lat))) / Math.PI)) / 2 * TILE_SIZE;

        // On soustrait pour avoir les coordonnées relatives à notre canevas
        return {
            x: worldPixelsX - originPixelsX,
            y: worldPixelsY - originPixelsY
        };
    };

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 2;
    ctx.fillStyle = config.gridColor;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Dessin des lignes verticales (de 1=A à 28=après AA)
    for (let i = 1; i <= 28; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 20, config, a1Lat, a1Lon); // 20 pour le bord bas de la 19ème case
        
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }
    
    // Dessin des lignes horizontales (de 1 à 20=après 19)
    for (let i = 1; i <= 20; i++) {
        const startPoint = calculateAndRotatePoint(1, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(28, i, config, a1Lat, a1Lon);
        
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }

    // Dessin des étiquettes
    // Lettres (de A=1 à AA=27)
    for (let i = 1; i <= 27; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Chiffres (de 1 à 19)
    for (let i = 1; i <= 19; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
}

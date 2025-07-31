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
    
    // Afficher l'indicateur de chargement avec un message spécifique
    loadingMessage.textContent = "Préparation de l'image pour impression...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        // --- 1. Récupération de la configuration ---
        const config = getGridConfigurationForPrint();

        // --- 2. Calcul des dimensions et des limites de la grille ---
        // On utilise la même logique que le carroyage CADO pour savoir où sont les coins de notre grille 27x19
        const gridData = calculateGridData(config);
        
        // Les 4 coins cardinaux de notre zone à imprimer.
        const boundingBox = getBoundingBoxFromGrid(config, gridData.originPointPlacemark.coordinates);

        // --- 3. Détermination du niveau de zoom optimal ---
        const zoomLevel = calculateOptimalZoom(boundingBox, config.scale);
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        // --- 4. Récupération des tuiles de carte ---
        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const mapImage = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        // --- 5. Création de l'image finale sur un canevas ---
        loadingMessage.textContent = "Assemblage de l'image finale...";
        const finalCanvas = document.createElement('canvas');
        const ctx = finalCanvas.getContext('2d');
        
        // Ajuster la taille du canevas
        const finalWidth = TILE_SIZE * (boundingBox.tileMaxX - boundingBox.tileMinX + 1);
        const finalHeight = TILE_SIZE * (boundingBox.tileMaxY - boundingBox.tileMinY + 1);
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        
        // Dessiner l'image de la carte assemblée
        ctx.drawImage(mapImage, 0, 0);

        // --- 6. Dessin du carroyage et des étiquettes par-dessus ---
        drawGridOnCanvas(ctx, boundingBox, zoomLevel, config);
        
        // --- 7. Exportation en PNG ---
        const fileName = `${config.gridName}_Print.png`;
        finalCanvas.toBlob((blob) => {
            downloadFile(blob, fileName, 'image/png');
        });

    } catch (error) {
        console.error("Erreur lors de la génération de l'image :", error);
        showError(error.message);
    } finally {
        // Cacher l'indicateur de chargement
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Récupère la configuration de base, mais force les dimensions à 27x19.
 */
function getGridConfigurationForPrint() {
    // On récupère la configuration normale pour avoir le point de référence, l'échelle, etc.
    const baseConfig = getGridConfiguration(
        parseFloat(document.getElementById("decimal-coords").value.split(',')[0]),
        parseFloat(document.getElementById("decimal-coords").value.split(',')[1])
    );

    // On surcharge les valeurs pour correspondre au format d'impression
    baseConfig.startCol = 'A';
    baseConfig.endCol = 'AA'; // 27ème lettre
    baseConfig.startRow = 1;
    baseConfig.endRow = 19;
    
    // On s'assure que le contenu inclut bien la grille pour les calculs
    baseConfig.includeGrid = true;
    baseConfig.includePoints = false; // Pas besoin des points centraux

    return baseConfig;
}

/**
 * Calcule les coordonnées géographiques des 4 coins de la grille.
 */
function getBoundingBoxFromGrid(config, a1Corner) {
    const a1Lat = a1Corner[1];
    const a1Lon = a1Corner[0];
    
    // Coin Nord-Ouest (le coin supérieur gauche de la case A19)
    const nwPoint = calculateAndRotatePoint(1, 19, config, a1Lat, a1Lon);
    
    // Coin Sud-Est (le coin inférieur droit de la case AA1)
    const sePoint = calculateAndRotatePoint(28, 1, config, a1Lat, a1Lon); // On prend la 28e colonne pour avoir le bord droit de la 27e

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
    const requiredResolution = scaleInMeters / TILE_SIZE; // Mètres par pixel nécessaires

    // Boucle à travers les niveaux de zoom standards du web mapping
    for (let zoom = 20; zoom >= 1; zoom--) {
        const metersPerPixel = 156543.03 * Math.cos(toRad(boundingBox.north)) / Math.pow(2, zoom);
        if (metersPerPixel <= requiredResolution) {
            return zoom;
        }
    }
    return 1; // Zoom minimum
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
    
    // On stocke les informations de la zone couverte par les tuiles pour le repositionnement plus tard
    boundingBox.tileMinX = nwTile.x;
    boundingBox.tileMinY = nwTile.y;
    boundingBox.tileMaxX = seTile.x;
    boundingBox.tileMaxY = seTile.y;
    
    return canvas;
}


/**
 * Dessine la grille et les étiquettes sur le canevas final.
 */
function drawGridOnCanvas(ctx, boundingBox, zoom, config) {
    // Coordonnées du coin Nord-Ouest de la première tuile
    const mapOrigin = tileNumbersToLatLon(boundingBox.tileMinX, boundingBox.tileMinY, zoom);

    // Fonction pour convertir une coordonnée Lat/Lon en pixels sur notre canevas
    const latLonToPixels = (lat, lon) => {
        const n = Math.pow(2, zoom);
        const worldPixelsX = n * ((lon + 180) / 360) * TILE_SIZE;
        const worldPixelsY = n * (1 - (Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI)) / 2 * TILE_SIZE;
        
        const originPixels = latLonToPixels(mapOrigin.lat, mapOrigin.lon);

        return {
            x: worldPixelsX - originPixels.x,
            y: worldPixelsY - originPixels.y
        };
    };

    // Configuration du style de dessin
    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 2;
    ctx.fillStyle = config.gridColor;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const a1Corner = config.referencePointChoice === 'origin' ? [config.longitude, config.latitude] : calculateGridData(config).originPointPlacemark.coordinates;
    const a1Lat = a1Corner[1];
    const a1Lon = a1Corner[0];

    // Dessin des lignes verticales
    for (let i = 1; i <= 28; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 20, config, a1Lat, a1Lon);
        
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }
    
    // Dessin des lignes horizontales
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

    // Dessin des étiquettes (lettres et chiffres)
    // Lettres en dessous de la ligne 1
    for (let i = 1; i <= 27; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon); // Centré dans la case, sur la ligne "0.5"
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Chiffres à gauche de la colonne A
    for (let i = 1; i <= 19; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon); // Centré dans la case, sur la colonne "0.5"
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
}

// imagetoprint.js

function coordsToQuadKey(x, y, zoom) {
    let quadKey = '';
    for (let i = zoom; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((y & mask) !== 0) { digit += 2; }
        if ((x & mask) !== 0) { digit += 1; }
        quadKey += digit.toString();
    }
    return quadKey;
}

function itpLatLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(lat * Math.PI / 180);
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = 256 * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

// Fonction utilitaire CADO : Compte le nombre de cases en sautant le 0
function getCadoCount(start, end) {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    let count = max - min + 1;
    // Si l'intervalle traverse 0 (ex: -2 à 2), on retire 1 car la ligne/colonne 0 n'existe pas
    if (min < 0 && max > 0) {
        count--;
    }
    return count;
}

async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");

    loadingMessage.textContent = "Calcul de la géométrie...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const coordsStr = document.getElementById("decimal-coords").value;
        if (!coordsStr) throw new Error("Veuillez définir des coordonnées.");

        const [refLat, refLon] = coordsStr.split(',').map(c => parseFloat(c.trim()));
        
        const config = getGridConfiguration(refLat, refLon);
        const gridNameBase = document.getElementById('grid-name-base').value || 'CADO Grid';
        const selectedMapId = document.getElementById('map-tile-provider').value;
        const mapConfig = MAP_LAYERS.find(m => m.id === selectedMapId);
        if (!mapConfig) throw new Error("Carte non trouvée !");
        
        const addressValue = document.getElementById('address-search-input').value.trim();
        config.gridNameBase = gridNameBase;
        config.lineWidth = parseInt(document.getElementById('line-thickness').value, 10) || 1;

        // 1. BUFFER DE SECURITE
        const bufferCases = 3; 
        // On élargit artificiellement la zone demandée pour le téléchargement
        // Note: letterToNumber gère les négatifs si besoin
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        
        const bufferedConfig = { 
            ...config, 
            startCol: numberToLetter(startColNum - bufferCases), // Simplifié, attention si passage de 0
            endCol: numberToLetter(endColNum + bufferCases),
            startRow: config.startRow - bufferCases,
            endRow: config.endRow + bufferCases
        };
        // Pour être sûr de couvrir le passage à zéro dans le buffer, on s'appuie sur la bbox large
        // getRotatedBoundingBox gère déjà calculateAndRotatePoint qui gère les coordonnées

        const realA1Coords = getA1CornerCoordsForPrint(config);
        const downloadBoundingBox = getRotatedBoundingBox(bufferedConfig, realA1Coords);
        
        // 2. ZOOM
        const zoomLevel = calculateOptimalZoom(downloadBoundingBox, mapConfig);

        // 3. TELECHARGEMENT
        loadingMessage.textContent = `Téléchargement de la zone étendue (0%)...`;
        const { finalCanvas: worldCanvas, scaleFactor } = await createFinalCanvasWithLayers(downloadBoundingBox, zoomLevel, mapConfig, (progress) => {
            loadingMessage.textContent = `Téléchargement des tuiles (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Assemblage et découpe finale...";

        // 4. DIMENSIONS & MARGES
        const metersPerPixel = (Math.cos(refLat * Math.PI / 180) * 2 * Math.PI * 6378137) / (256 * Math.pow(2, zoomLevel));
        const pixelsPerMeter = (1 / metersPerPixel) * scaleFactor;
        
        const startColIdx = letterToNumber(config.startCol);
        const endColIdx = letterToNumber(config.endCol);
        const startRowIdx = config.startRow;
        const endRowIdx = config.endRow;

        // CORRECTION: Utilisation de getCadoCount pour ne pas compter le 0
        const colsCount = getCadoCount(startColIdx, endColIdx);
        const rowsCount = getCadoCount(startRowIdx, endRowIdx);
        
        const scalePx = config.scale * pixelsPerMeter;

        // --- NOUVELLES MARGES ---
        // Texte : 1.2
        // Vide : 0.3
        const marginLarge = scalePx * 1.2;
        const marginSmall = scalePx * 0.3;

        const marginLeft = marginLarge;  // Chiffres toujours à gauche
        const marginRight = marginSmall;
        let marginTop, marginBottom;

        if (config.letteringDirection === 'ascending') {
            marginTop = marginSmall;
            marginBottom = marginLarge; // Lettres en bas
        } else {
            marginTop = marginLarge;    // Lettres en haut
            marginBottom = marginSmall;
        }
        
        const gridWidthPx = colsCount * scalePx;
        const gridHeightPx = rowsCount * scalePx;
        
        const finalWidth = Math.ceil(gridWidthPx + marginLeft + marginRight);
        const finalHeight = Math.ceil(gridHeightPx + marginTop + marginBottom);
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        
        finalCtx.fillStyle = 'white';
        finalCtx.fillRect(0, 0, finalWidth, finalHeight);

        // 5. PLACEMENT DU PIVOT
        const pivotGeoLat = (config.referencePointChoice === 'center') ? config.latitude : realA1Coords[1];
        const pivotGeoLon = (config.referencePointChoice === 'center') ? config.longitude : realA1Coords[0];
        
        let pivotFinalX, pivotFinalY;

        if (config.referencePointChoice === 'center') {
            // Pivot au centre de la GRILLE (pas de l'image)
            pivotFinalX = marginLeft + (gridWidthPx / 2);
            pivotFinalY = marginTop + (gridHeightPx / 2);
        } else {
            // Mode Origine : Le pivot est A1 (StartCol, StartRow)
            // Mais attention si StartCol = 3 (C), il y a un décalage par rapport au bord gauche
            // On doit calculer la "position CADO" du début de la grille
            
            // Unité CADO du bord gauche (StartCol)
            // ex: A=1 -> 1. C=3 -> 3. -B=-2 -> -2.
            
            // Pour le dessin, le repère (0,0) est le pivot.
            // Si Pivot=A1, alors StartCol est à 0.
            pivotFinalX = marginLeft; // A1 est aligné avec la marge gauche (par définition du mode Origine A1)
            
            if (config.letteringDirection === 'ascending') {
                pivotFinalY = finalHeight - marginBottom; // A1 en bas
            } else {
                pivotFinalY = marginTop; // A1 en haut
            }
        }
        
        const worldOriginPx = itpLatLonToWorldPixels(downloadBoundingBox.north, downloadBoundingBox.west, zoomLevel);
        const pivotWorldGlobalPx = itpLatLonToWorldPixels(pivotGeoLat, pivotGeoLon, zoomLevel);
        const pivotOnWorldCanvasX = (pivotWorldGlobalPx.x - worldOriginPx.x) * scaleFactor;
        const pivotOnWorldCanvasY = (pivotWorldGlobalPx.y - worldOriginPx.y) * scaleFactor;

        finalCtx.save();
        finalCtx.translate(pivotFinalX, pivotFinalY);
        finalCtx.rotate(-config.deviation * Math.PI / 180);
        finalCtx.drawImage(worldCanvas, -pivotOnWorldCanvasX, -pivotOnWorldCanvasY);
        finalCtx.restore();

        // 6. DESSIN DE LA GRILLE
        const drawConfig = { ...config, deviation: 0, realDeviation: config.deviation };
        drawConfig.lineWidth = drawConfig.lineWidth * scaleFactor;
        const metersToPx = pixelsPerMeter;
        
        // Projection locale
        const localLatLonToPixels = (lat, lon) => {
            const dLat = lat - pivotGeoLat;
            const dLon = lon - pivotGeoLon;
            const dY_meters = dLat * 111320;
            const dX_meters = dLon * 111320 * Math.cos(pivotGeoLat * Math.PI / 180);
            return {
                x: pivotFinalX + (dX_meters * metersToPx),
                y: pivotFinalY - (dY_meters * metersToPx)
            };
        };

        // Calcul A1 Virtuel pour le dessin
        let a1GeoForDrawLat, a1GeoForDrawLon;

        if (config.referencePointChoice === 'origin') {
            a1GeoForDrawLat = pivotGeoLat;
            a1GeoForDrawLon = pivotGeoLon;
        } else {
            // Mode Center : On doit trouver le A1 qui ferait tomber le centre au Pivot
            const mToDegLat = 1 / 111320;
            const mToDegLon = 1 / (111320 * Math.cos(pivotGeoLat * Math.PI / 180));
            
            // Calcul de la "Distance CADO" entre le début et le centre
            // On convertit tout en "unités de cases" par rapport à 0.
            // Ex: Start=-1, End=1. Count=2.
            // UnitStart = -1. UnitEnd = 1.
            // UnitCenter = (UnitStart + UnitEnd) / 2 = 0.
            // Mais attention, il n'y a pas de case 0.
            // On utilise une logique de coordonnées continues "virtuelles" pour la géométrie
            
            // Fonction helper interne pour convertir Numéro CADO -> Offset Relatif
            const getRelativeOffset = (num) => (num > 0 ? num - 1 : num);
            
            const startColUnit = getRelativeOffset(startColIdx);
            const endColUnit = getRelativeOffset(endColIdx);
            // Longueur totale en unités continues
            const totalWidthUnits = endColUnit - startColUnit + 1; // +1 car on inclut les bornes ?
            // Non, c'est une distance. De -1 (fin) à 0 (début de 1).
            // Width = colsCount.
            
            // Le centre est à +colsCount/2 cases du début
            // Donc A1 est à -colsCount/2 cases du centre.
            
            // Position du début de la grille par rapport au centre (en mètres)
            const offsetX = -(colsCount * config.scale) / 2;
            const offsetY = -(rowsCount * config.scale) / 2;

            a1GeoForDrawLon = pivotGeoLon + (offsetX * mToDegLon);
            
            if (config.letteringDirection === 'ascending') {
                a1GeoForDrawLat = pivotGeoLat + (offsetY * mToDegLat);
            } else {
                // En descendant, si on remonte vers A1 (haut), c'est positif en Y canvas ?
                // Non, en Geo: A1 est en haut (Lat +). Pivot (Centre) est en bas (Lat -).
                // Donc A1 Lat > Pivot Lat.
                // Distance = Hauteur / 2.
                a1GeoForDrawLat = pivotGeoLat + ((rowsCount * config.scale / 2) * mToDegLat);
            }
        }

        drawCadoElementsOnCanvas(finalCtx, drawConfig, localLatLonToPixels, [a1GeoForDrawLon, a1GeoForDrawLat], addressValue);

        // 7. EXPORT
        const format = document.querySelector('input[name="image-format-cado"]:checked').value;
        const quality = parseInt(document.getElementById('cado-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';
        
        updateDynamicGridName(); 
        const finalGridName = document.getElementById('grid-name').value;
        const originString = `_origine=${realA1Coords[1].toFixed(6)},${realA1Coords[0].toFixed(6)}`;
        const fileName = `${finalGridName}${originString}${fileExtension}`;

        finalCanvas.toBlob((blob) => {
            if (blob) { downloadFile(blob, fileName); } 
            else { showError("Erreur lors de la création du fichier image."); }
        }, mimeType, quality);

    } catch (error) {
        console.error("Erreur génération image:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

// ... (getRotatedBoundingBox, getA1CornerCoordsForPrint, calculateOptimalZoom, createFinalCanvasWithLayers)
// Ces fonctions restent inchangées, on les garde pour la cohérence du fichier
function getRotatedBoundingBox(config, a1Coords) {
    const [a1Lon, a1Lat] = a1Coords;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const p1 = calculateAndRotatePoint(startColNum, startRowNum, config, a1Lat, a1Lon);
    const p2 = calculateAndRotatePoint(endColNum + 1, startRowNum, config, a1Lat, a1Lon);
    const p3 = calculateAndRotatePoint(startColNum, endRowNum + 1, config, a1Lat, a1Lon);
    const p4 = calculateAndRotatePoint(endColNum + 1, endRowNum + 1, config, a1Lat, a1Lon);

    const lats = [p1[1], p2[1], p3[1], p4[1]];
    const lons = [p1[0], p2[0], p3[0], p4[0]];

    return {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lons),
        west: Math.min(...lons)
    };
}

function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(lat * Math.PI / 180));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else {
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        const startRowNum = config.startRow;
        const endRowNum = config.endRow;

        // Utilisation de la nouvelle logique CADO (sans zéro) pour le décalage
        // Le but est de trouver le centre géométrique
        const totalCols = getCadoCount(startColNum, endColNum);
        const totalRows = getCadoCount(startRowNum, endRowNum);
        
        // On suppose que le point de référence est au milieu exact
        // Donc on recule de Moitié de la largeur/hauteur pour trouver A1
        const xOffsetMeters = (totalCols * config.scale) / 2;
        const yOffsetMeters = (totalRows * config.scale) / 2;

        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        let a1Lat;
        if (config.letteringDirection === 'ascending') {
            a1Lat = refLat - metersToLatDegrees(yOffsetMeters);
        } else {
            a1Lat = refLat + metersToLatDegrees(yOffsetMeters);
        }
        
        return [a1Lon, a1Lat];
    }
}

function calculateOptimalZoom(boundingBox, mapConfig) {
    const lonDiff = Math.abs(boundingBox.east - boundingBox.west);
    const maxLayerZoom = mapConfig.maxZoom || 20;
    if (lonDiff === 0) return maxLayerZoom;
    const targetWidthInPixels = 4000; 
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * 256));
    return Math.min(Math.floor(zoomApproximation), maxLayerZoom);
}

async function createFinalCanvasWithLayers(boundingBox, zoom, mapConfig, onProgress) {
    const nwPixel = itpLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = itpLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    const naturalWidth = Math.abs(sePixel.x - nwPixel.x);
    const naturalHeight = Math.abs(sePixel.y - nwPixel.y);
    const TARGET_PRINT_WIDTH = 4000; 
    let scaleFactor = 1;
    if (Math.max(naturalWidth, naturalHeight) < TARGET_PRINT_WIDTH) {
        scaleFactor = Math.min(TARGET_PRINT_WIDTH / Math.max(naturalWidth, naturalHeight), 4);
    }
    const TILE_SIZE = 256;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = naturalWidth;
    tempCanvas.height = naturalHeight;
    const tempCtx = tempCanvas.getContext('2d');
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.round(naturalWidth * scaleFactor);
    finalCanvas.height = Math.round(naturalHeight * scaleFactor);
    const ctx = finalCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const nwTile = { x: Math.floor(nwPixel.x / TILE_SIZE), y: Math.floor(nwPixel.y / TILE_SIZE) };
    const seTile = { x: Math.floor(sePixel.x / TILE_SIZE), y: Math.floor(sePixel.y / TILE_SIZE) };
    const totalTilesToDownload = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1) * mapConfig.layers.length;
    let downloadedCount = 0;
    
    for (const layer of mapConfig.layers) {
        const tilePromises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                let tileUrl;
                if (layer.type === 'quadkey') {
                    const quadKey = coordsToQuadKey(x, y, zoom);
                    const subdomain = (x + y) % 4;
                    tileUrl = layer.url.replace('{q}', quadKey).replace('{s}', subdomain);
                } else {
                    tileUrl = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }
                const safeUrl = tileUrl + (tileUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        downloadedCount++;
                        if(onProgress) onProgress((downloadedCount / totalTilesToDownload) * 100);
                        resolve({ img, x, y, success: true });
                    };
                    img.onerror = () => {
                        downloadedCount++;
                        if(onProgress) onProgress((downloadedCount / totalTilesToDownload) * 100);
                        resolve({ success: false }); 
                    };
                    img.src = safeUrl;
                });
                tilePromises.push(promise);
            }
        }
        const resolvedTiles = await Promise.all(tilePromises);
        resolvedTiles.forEach(tileResult => {
            if (tileResult.success) {
                const tileX = (tileResult.x * TILE_SIZE) - nwPixel.x;
                const tileY = (tileResult.y * TILE_SIZE) - nwPixel.y;
                tempCtx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
            }
        });
    }
    ctx.drawImage(tempCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
    return { finalCanvas, scaleFactor };
}
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
    // Calcul de distance mathématique en sautant 0
    // Ex: -1 à 1. Indices: -1, 1. (Pas de 0). Distance = 2.
    // Ex: 1 à 3. Indices: 1, 2, 3. Distance = 3.
    let count = max - min + 1;
    if (min < 0 && max > 0) {
        count--; // On retire le 0 qui n'existe pas
    }
    return count;
}

// Fonction pour obtenir la distance en "unités de cases" entre l'origine (0) et une coordonnée
// A (1) -> 0. B (2) -> 1.
// -A (-1) -> -1. -B (-2) -> -2.
function getCellOffsetFromOrigin(n) {
    if (n > 0) return n - 1;
    return n; 
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

        // 1. ZONE DE TÉLÉCHARGEMENT (LARGE BUFFER)
        // On calcule une zone GPS très large pour être sûr qu'après rotation et crop, on ait tout.
        // On ne s'occupe pas ici des marges fines, on prend large (buffer de 5 cases).
        const buffer = 5; 
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        
        const bufferedConfig = { 
            ...config, 
            // On élargit artificiellement les bornes pour le téléchargement
            startCol: numberToLetter(startColNum > 0 ? startColNum - buffer : startColNum - buffer), 
            endCol: numberToLetter(endColNum > 0 ? endColNum + buffer : endColNum + buffer),
            startRow: config.startRow - buffer,
            endRow: config.endRow + buffer
        };

        const realA1Coords = getA1CornerCoordsForPrint(config);
        const downloadBoundingBox = getRotatedBoundingBox(bufferedConfig, realA1Coords);
        
        // 2. ZOOM
        const zoomLevel = calculateOptimalZoom(downloadBoundingBox, mapConfig);

        // 3. TÉLÉCHARGEMENT
        loadingMessage.textContent = `Téléchargement de la zone étendue (0%)...`;
        const { finalCanvas: worldCanvas, scaleFactor } = await createFinalCanvasWithLayers(downloadBoundingBox, zoomLevel, mapConfig, (progress) => {
            loadingMessage.textContent = `Téléchargement des tuiles (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Assemblage et découpe finale...";

        // 4. CALCUL DIMENSIONS FINALES & MARGES
        const metersPerPixel = (Math.cos(refLat * Math.PI / 180) * 2 * Math.PI * 6378137) / (256 * Math.pow(2, zoomLevel));
        const pixelsPerMeter = (1 / metersPerPixel) * scaleFactor;
        
        const startColIdx = letterToNumber(config.startCol);
        const endColIdx = letterToNumber(config.endCol);
        const startRowIdx = config.startRow;
        const endRowIdx = config.endRow;

        const colsCount = getCadoCount(startColIdx, endColIdx);
        const rowsCount = getCadoCount(startRowIdx, endRowIdx);
        
        const scalePx = config.scale * pixelsPerMeter;

        // --- MARGES STRICTES ---
        // 1.2 distance côté coordonnées, 0.3 distance côté vide
        const marginLarge = scalePx * 1.2;
        const marginSmall = scalePx * 0.3;

        const marginLeft = marginLarge;  // Toujours chiffres à gauche
        const marginRight = marginSmall;
        let marginTop, marginBottom;

        if (config.letteringDirection === 'ascending') {
            marginTop = marginSmall;
            marginBottom = marginLarge; // Lettres en bas
        } else {
            marginTop = marginLarge;    // Lettres en haut
            marginBottom = marginSmall;
        }
        
        // Taille exacte de la zone utile (grille)
        const gridWidthPx = colsCount * scalePx;
        const gridHeightPx = rowsCount * scalePx;
        
        // Taille finale du papier
        const finalWidth = Math.ceil(gridWidthPx + marginLeft + marginRight);
        const finalHeight = Math.ceil(gridHeightPx + marginTop + marginBottom);
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        
        finalCtx.fillStyle = 'white';
        finalCtx.fillRect(0, 0, finalWidth, finalHeight);

        // 5. PLACEMENT DU PIVOT SUR LE PAPIER
        // Le pivot est le point qui correspond à (refLat, refLon)
        const pivotGeoLat = (config.referencePointChoice === 'center') ? config.latitude : realA1Coords[1];
        const pivotGeoLon = (config.referencePointChoice === 'center') ? config.longitude : realA1Coords[0];
        
        let pivotFinalX, pivotFinalY;

        if (config.referencePointChoice === 'center') {
            // CORRECTION CRUCIALE : Le pivot (la croix) est au centre de la GRILLE, pas de l'image.
            pivotFinalX = marginLeft + (gridWidthPx / 2);
            pivotFinalY = marginTop + (gridHeightPx / 2);
        } else {
            // Mode Origine (A1)
            // Calcul du décalage de A1 par rapport au début de la grille
            // Le début de la grille est à X = marginLeft
            // Si la grille commence à C (3), A1 est virtuellement 2 cases à gauche.
            
            const startColOffset = getCellOffsetFromOrigin(startColIdx);
            const startRowOffset = getCellOffsetFromOrigin(startRowIdx);
            
            // X : A1 est à gauche du début de grille de 'startColOffset' cases
            pivotFinalX = marginLeft - (startColOffset * scalePx);

            // Y : Dépend du sens
            if (config.letteringDirection === 'ascending') {
                // Ascendant : 0 est en bas. L'image commence à startRow.
                // Le bas de la grille (visuel) est à Y = finalHeight - marginBottom.
                // Ce point correspond à la ligne 'startRow'.
                // A1 (ligne 1/0) est décalé de 'startRowOffset' vers le bas.
                // En canvas Y augmente vers le bas.
                // Y_StartGrid = finalHeight - marginBottom
                // Y_A1 = Y_StartGrid + (startRowOffset * scalePx) ?? Non.
                // Si StartRow=1 (Offset=0), A1 est sur la ligne de base.
                // Si StartRow=3 (Offset=2), la ligne de base est la ligne 3. A1 est plus bas.
                pivotFinalY = (finalHeight - marginBottom) + (startRowOffset * scalePx);
            } else {
                // Descendant : 0 est en haut.
                // Le haut de la grille est à Y = marginTop.
                // Ce point correspond à la ligne 'startRow'.
                // A1 (ligne 1/0) est décalé vers le haut (Y diminue).
                pivotFinalY = marginTop - (startRowOffset * scalePx);
            }
        }
        
        // Coordonnées du pivot sur la carte source
        const worldOriginPx = itpLatLonToWorldPixels(downloadBoundingBox.north, downloadBoundingBox.west, zoomLevel);
        const pivotWorldGlobalPx = itpLatLonToWorldPixels(pivotGeoLat, pivotGeoLon, zoomLevel);
        const pivotOnWorldCanvasX = (pivotWorldGlobalPx.x - worldOriginPx.x) * scaleFactor;
        const pivotOnWorldCanvasY = (pivotWorldGlobalPx.y - worldOriginPx.y) * scaleFactor;

        // --- PROJECTION CARTE ---
        finalCtx.save();
        // 1. On place l'origine du contexte au point pivot sur le papier final
        finalCtx.translate(pivotFinalX, pivotFinalY);
        // 2. On tourne le papier pour aligner le nord de la carte
        finalCtx.rotate(-config.deviation * Math.PI / 180);
        // 3. On dessine la carte en la décalant pour que son pivot coïncide avec l'origine (0,0)
        finalCtx.drawImage(worldCanvas, -pivotOnWorldCanvasX, -pivotOnWorldCanvasY);
        finalCtx.restore();

        // 6. DESSIN DE LA GRILLE (SUR LE PAPIER DROIT)
        const drawConfig = { ...config, deviation: 0, realDeviation: config.deviation };
        drawConfig.lineWidth = drawConfig.lineWidth * scaleFactor;

        // Fonction de projection "Plate" Locale
        // Convertit des lat/lon virtuels en pixels canvas relatifs au pivot
        const localLatLonToPixels = (lat, lon) => {
            const dLat = lat - pivotGeoLat;
            const dLon = lon - pivotGeoLon;
            
            // Conversion Mètres (approx locale)
            const dY_meters = dLat * 111320;
            const dX_meters = dLon * 111320 * Math.cos(pivotGeoLat * Math.PI / 180);
            
            // Projection : Y Canvas inversé par rapport à Lat
            return {
                x: pivotFinalX + (dX_meters * pixelsPerMeter),
                y: pivotFinalY - (dY_meters * pixelsPerMeter)
            };
        };

        // Calcul du A1 Virtuel Géographique pour le moteur de dessin
        // Le moteur de dessin recalcule tout à partir de A1. On doit lui donner un A1 
        // qui fait retomber le dessin exactement sur notre grille pixels.
        
        let a1GeoForDrawLat, a1GeoForDrawLon;

        if (config.referencePointChoice === 'origin') {
            a1GeoForDrawLat = pivotGeoLat;
            a1GeoForDrawLon = pivotGeoLon;
        } else {
            // Mode Center : Le pivot est le centre géométrique.
            // On doit calculer où se trouve A1 par rapport à ce centre.
            
            const mToDegLat = 1 / 111320;
            const mToDegLon = 1 / (111320 * Math.cos(pivotGeoLat * Math.PI / 180));
            
            // On calcule la distance en mètres entre le centre de la grille et l'origine virtuelle (A1/0,0)
            
            // Distance X du Centre par rapport à l'Origine (en mètres) :
            // StartOffsetMeters + (LargeurGrilleMeters / 2)
            const startColOffset = getCellOffsetFromOrigin(startColIdx);
            const gridWidthM = colsCount * config.scale;
            const centerX_M = (startColOffset * config.scale) + (gridWidthM / 2);
            
            // A1 est à l'opposé : CentreX - DistanceX
            a1GeoForDrawLon = pivotGeoLon - (centerX_M * mToDegLon);
            
            // Distance Y
            const startRowOffset = getCellOffsetFromOrigin(startRowIdx);
            const gridHeightM = rowsCount * config.scale;
            const centerY_M = (startRowOffset * config.scale) + (gridHeightM / 2);

            if (config.letteringDirection === 'ascending') {
                // Ascendant : Y monte. Centre est plus haut (Lat+) que A1.
                // A1 = Center - Distance
                a1GeoForDrawLat = pivotGeoLat - (centerY_M * mToDegLat);
            } else {
                // Descendant : Y descend. Centre est plus bas (Lat-) que A1.
                // A1 = Center + Distance
                a1GeoForDrawLat = pivotGeoLat + (centerY_M * mToDegLat);
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

// ... Les fonctions suivantes restent inchangées mais nécessaires ...
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
    return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) };
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
        // Pour le calcul GPS initial, on garde la logique centrée approximative
        const cols = getCadoCount(startColNum, endColNum);
        const rows = getCadoCount(startRowNum, endRowNum);
        const xOffsetMeters = (cols * config.scale) / 2;
        const yOffsetMeters = (rows * config.scale) / 2;
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
    
    // Dimensions natives (basées sur les tuiles disponibles au zoom max)
    const naturalWidth = Math.abs(sePixel.x - nwPixel.x);
    const naturalHeight = Math.abs(sePixel.y - nwPixel.y);

    // --- LOGIQUE UPSCALING CORRIGÉE ---
    const TARGET_RESOLUTION = 3840; // 4K UHD
    let scaleFactor = 1;
    const maxDimension = Math.max(naturalWidth, naturalHeight);

    if (maxDimension < TARGET_RESOLUTION) {
        // On calcule le facteur exact pour atteindre 4K
        scaleFactor = TARGET_RESOLUTION / maxDimension;
        
        // On autorise un agrandissement jusqu'à x16 pour les très petites zones
        // (Ex: une maison seule au zoom 19 fait ~100px. x16 -> 1600px, c'est encore utile)
        scaleFactor = Math.min(scaleFactor, 16); 
    }

    // Debug pour vérifier (F12 > Console)
    console.log(`[CADO] Native: ${Math.round(naturalWidth)}x${Math.round(naturalHeight)}px | Zoom: ${zoom}`);
    console.log(`[CADO] Upscale appliqué: x${scaleFactor.toFixed(3)} -> Final: ${Math.round(naturalWidth * scaleFactor)}x${Math.round(naturalHeight * scaleFactor)}px`);

    const TILE_SIZE = 256;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = naturalWidth;
    tempCanvas.height = naturalHeight;
    const tempCtx = tempCanvas.getContext('2d');

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.round(naturalWidth * scaleFactor);
    finalCanvas.height = Math.round(naturalHeight * scaleFactor);
    const ctx = finalCanvas.getContext('2d');
    
    // Lissage haute qualité obligatoire pour l'upscaling
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
    
    // Transfert agrandi
    ctx.drawImage(tempCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
    return { finalCanvas, scaleFactor };
}
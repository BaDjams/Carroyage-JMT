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
        const gridNameBase = document.getElementById('grid-name-base').value || 'CADO Grid';
        const selectedMapId = document.getElementById('map-tile-provider').value;
        const mapConfig = MAP_LAYERS.find(m => m.id === selectedMapId);
        if (!mapConfig) throw new Error("Configuration de la carte non trouvée !");
        
        config.gridNameBase = gridNameBase;
        config.lineWidth = parseInt(document.getElementById('line-thickness').value, 10) || 1;

        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);

        loadingMessage.textContent = `Téléchargement des fonds de carte (0%)...`;
        const { finalCanvas } = await createFinalCanvasWithLayers(boundingBox, zoomLevel, mapConfig, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Dessin du carroyage...";
        const finalCtx = finalCanvas.getContext('2d');
        
        const originWorldPixels = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoomLevel);
        const latLonToPixels = (lat, lon) => {
            const worldPixels = zdLatLonToWorldPixels(lat, lon, zoomLevel);
            return {
                x: worldPixels.x - originWorldPixels.x,
                y: worldPixels.y - originWorldPixels.y
            };
        };
        
        drawCadoElementsOnCanvas(finalCtx, config, latLonToPixels, a1CornerCoords);

        const format = document.querySelector('input[name="image-format-cado"]:checked').value;
        const quality = parseInt(document.getElementById('cado-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';
        
        updateDynamicGridName(); 
        const finalGridName = document.getElementById('grid-name').value;
        const originString = `_origine=${a1CornerCoords[1].toFixed(6)},${a1CornerCoords[0].toFixed(6)}`;
        const fileName = `${finalGridName}${originString}${fileExtension}`;

        finalCanvas.toBlob((blob) => {
            if (blob) { downloadFile(blob, fileName); } 
            else { showError("Erreur lors de la création du fichier image."); }
        }, mimeType, quality);

    } catch (error) {
        console.error("Erreur lors de la génération de l'image :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else {
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        const startRowNum = config.startRow;
        const endRowNum = config.endRow;

        const calculateCenterOffsetInCells = (start, end) => {
            const indices = generateIndices(start, end);
            const numCells = indices.length;
            const startOffset = getOffsetInCells(indices[0]);

            if (numCells % 2 === 0) {
                return startOffset + (numCells / 2);
            } else {
                return startOffset + Math.floor(numCells / 2) + 0.5;
            }
        };
        
        const centerColOffset = calculateCenterOffsetInCells(startColNum, endColNum);
        const centerRowOffset = calculateCenterOffsetInCells(startRowNum, endRowNum);
        
        const xOffsetMeters = centerColOffset * config.scale;
		const yOffsetMeters = centerRowOffset * config.scale;

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

function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const margeHaute = 0.5, margeBasse = 0.5, margeGauche = 0.5, margeDroite = 0.5;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const contentBounds = {
        minCol: startColNum - 0.5, maxCol: endColNum + 1,
        minRow: startRowNum - 0.5, maxRow: endRowNum + 1
    };

    const contentCorners = [
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.minRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.minRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.maxRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.maxRow, config, a1Lat, a1Lon)
    ].map(p => ({ lon: p[0], lat: p[1] }));

    let minLat = Math.min(...contentCorners.map(c => c.lat));
    let maxLat = Math.max(...contentCorners.map(c => c.lat));
    let minLon = Math.min(...contentCorners.map(c => c.lon));
    let maxLon = Math.max(...contentCorners.map(c => c.lon));

    const metersToLat = (meters) => meters / 111320;
    const metersToLon = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));
    const avgLat = (minLat + maxLat) / 2;

    minLat -= metersToLat(margeBasse * config.scale);
    maxLat += metersToLat(margeHaute * config.scale);
    minLon -= metersToLon(margeGauche * config.scale, avgLat);
    maxLon += metersToLon(margeDroite * config.scale, avgLat);

    return { north: maxLat, south: minLat, east: maxLon, west: minLon };
}

function calculateOptimalZoom(boundingBox) {
    const lonDiff = Math.abs(boundingBox.east - boundingBox.west);
    if (lonDiff === 0) return MAX_ZOOM;
    const targetWidthInPixels = 3500;
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * TILE_SIZE));
    return Math.min(Math.floor(zoomApproximation), MAX_ZOOM);
}

async function createFinalCanvasWithLayers(boundingBox, zoom, mapConfig, onProgress) {
    const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    const canvasWidth = Math.abs(sePixel.x - nwPixel.x);
    const canvasHeight = Math.abs(sePixel.y - nwPixel.y);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvasWidth;
    finalCanvas.height = canvasHeight;
    const ctx = finalCanvas.getContext('2d');

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
                    tileUrl = tileProviderUrl.replace('{q}', quadKey).replace('{s}', subdomain);
                } else {
                    tileUrl = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }

                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        downloadedCount++;
                        onProgress((downloadedCount / totalTilesToDownload) * 100);
                        resolve({ img, x, y, success: true });
                    };
                    img.onerror = () => {
                        console.warn(`Impossible de charger la tuile: ${tileUrl}`);
                        downloadedCount++;
                        onProgress((downloadedCount / totalTilesToDownload) * 100);
                        resolve({ success: false }); 
                    };
                    img.src = tileUrl;
                });
                tilePromises.push(promise);
            }
        }
        
        const resolvedTiles = await Promise.all(tilePromises);
        resolvedTiles.forEach(tileResult => {
            if (tileResult.success) {
                const tileX = (tileResult.x * TILE_SIZE) - nwPixel.x;
                const tileY = (tileResult.y * TILE_SIZE) - nwPixel.y;
                ctx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
            }
        });
    }

    return { finalCanvas };
}
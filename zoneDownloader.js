// zoneDownloader.js

const ZD_TILE_SIZE = 256;
let loadedZoneKmlFeatures = [];
let kmlResources = { images: {} };

function haversineDistance(p1, p2) {
    const R = 6371e3;
    const lat1Rad = toRad(p1.lat);
    const lat2Rad = toRad(p2.lat);
    const deltaLatRad = toRad(p2.lat - p1.lat);
    const deltaLonRad = toRad(p2.lon - p1.lon);
    const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function zdCoordsToQuadKey(x, y, zoom) {
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

function zdLatLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRad(lat));
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = ZD_TILE_SIZE * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

function getZoneCadoConfigAndBounds() {
    const nwCoordsStr = document.getElementById("zone-nw-coords").value;
    const seCoordsStr = document.getElementById("zone-se-coords").value;
    if (!nwCoordsStr || !seCoordsStr) throw new Error("Veuillez d'abord dessiner une zone rectangulaire.");
    
    const [nwLat, nwLon] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
    const [seLat, seLon] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));

    const scale = parseFloat(document.getElementById('cado-overlay-scale').value);
    if (isNaN(scale) || scale <= 0) throw new Error("L'échelle doit être un nombre positif.");

    const widthMeters = haversineDistance({lat: nwLat, lon: nwLon}, {lat: nwLat, lon: seLon});
    const heightMeters = haversineDistance({lat: nwLat, lon: nwLon}, {lat: seLat, lon: nwLon});
    const numCols = Math.ceil(widthMeters / scale);
    const numRows = Math.ceil(heightMeters / scale);

    if (numCols > 100 || numRows > 100) {
        throw new Error(`Le nombre de cases (${numCols}x${numRows}) est trop élevé (>100). Augmentez l'échelle ou réduisez la zone.`);
    }

    const refLat = (nwLat + seLat) / 2;
    const refLon = (nwLon + seLon) / 2;
    
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));
    
    const xOffsetMeters = (numCols / 2) * scale;
    const yOffsetMeters = (numRows / 2) * scale;
    
    const letteringDirection = document.querySelector('input[name="cado-overlay-direction"]:checked').value;
    
    const a1CornerLon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
    let a1CornerLat;
    if (letteringDirection === 'ascending') {
        a1CornerLat = refLat - metersToLatDegrees(yOffsetMeters);
    } else {
        a1CornerLat = refLat + metersToLatDegrees(yOffsetMeters);
    }
    
    const config = {
        latitude: refLat,
        longitude: refLon,
        scale: scale,
        lineWidth: parseInt(document.getElementById('cado-overlay-thickness').value, 10),
        letteringDirection: letteringDirection,
        gridColor: document.getElementById('grid-color').value,
        colorName: document.getElementById('grid-color-name').value,
        colorOpacity: (100 - parseInt(document.getElementById('transparency').value)) / 100,
        gridNameBase: document.getElementById("zone-title").value || "Carroyage CADO de Zone",
        deviation: 0,
        labelSize: parseFloat(document.getElementById('label-size').value),
        iconSize: parseFloat(document.getElementById('icon-size').value || 2),
        // **CORRECTION** : On change la valeur ici pour que la croix ne s'affiche pas
        referencePointChoice: 'zone_center', // Auparavant 'center'
        startRow: 1, endRow: numRows,
        startCol: 'A', endCol: numberToLetter(numCols),
        includeGrid: true, includePoints: true,
        outputFormat: 'KMZ'
    };

    const gridCorners = [
        calculateAndRotatePoint(1, 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(numCols + 1, 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(1, numRows + 1, config, a1CornerLat, a1CornerLon),
        calculateAndRotatePoint(numCols + 1, numRows + 1, config, a1CornerLat, a1CornerLon)
    ].map(p => ({ lon: p[0], lat: p[1] }));

    const gridBounds = {
        minLat: Math.min(...gridCorners.map(c => c.lat)),
        maxLat: Math.max(...gridCorners.map(c => c.lat)),
        minLon: Math.min(...gridCorners.map(c => c.lon)),
        maxLon: Math.max(...gridCorners.map(c => c.lon))
    };

    return { config, gridBounds, a1CornerLat, a1CornerLon };
}

async function generateZonePNG() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'export de la zone...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const isCadoExport = document.getElementById('overlay-cado-grid-checkbox').checked;
        const isUtmExport = document.getElementById('overlay-utm-grid-checkbox').checked;
        let cadoData = null;
        let finalBoundingBox;

        const nwCoordsStr = document.getElementById("zone-nw-coords").value;
        const seCoordsStr = document.getElementById("zone-se-coords").value;
        const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
        const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));
        
        if(isCadoExport) {
            cadoData = getZoneCadoConfigAndBounds();
            const { config, gridBounds } = cadoData;
            const avgLat = (gridBounds.minLat + gridBounds.maxLat) / 2;
            const metersToLat = (meters) => meters / 111320;
            const metersToLon = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

            let margeHaute, margeBasse, margeGauche, margeDroite;
            if (config.letteringDirection === 'descending') {
                margeHaute = 1.0 * config.scale;
                margeBasse = 0.5 * config.scale;
                margeGauche = 1.0 * config.scale;
                margeDroite = 0.5 * config.scale;
            } else { // ascending
                margeHaute = 0.5 * config.scale;
                margeBasse = 1.0 * config.scale;
                margeGauche = 1.0 * config.scale;
                margeDroite = 0.5 * config.scale;
            }

            finalBoundingBox = {
                north: gridBounds.maxLat + metersToLat(margeHaute),
                south: gridBounds.minLat - metersToLat(margeBasse),
                west: gridBounds.minLon - metersToLon(margeGauche, avgLat),
                east: gridBounds.maxLon + metersToLon(margeDroite, avgLat)
            };
        } else {
            finalBoundingBox = { north, west, south, east };
        }

        const zoom = parseInt(document.getElementById("zone-info-zoom").textContent, 10);
        const mapLayerName = document.getElementById("zone-info-layer").textContent;
        const selectedMap = MAP_LAYERS.find(m => m.name === mapLayerName);
        if (!selectedMap) throw new Error("Impossible de trouver la configuration du fond de carte.");
        
        const format = document.querySelector('input[name="image-format-zone"]:checked').value;
        const quality = parseInt(document.getElementById('zone-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';

        loadingMessage.textContent = "Téléchargement et assemblage des fonds de carte...";
        const { finalCanvas, dynamicMargin } = await zdCreateFinalCanvas(finalBoundingBox, zoom, selectedMap, isCadoExport);
        const ctx = finalCanvas.getContext('2d');
        
        const nwPixel = zdLatLonToWorldPixels(finalBoundingBox.north, finalBoundingBox.west, zoom);
        const latLonToCanvasPixels = (lat, lon) => {
            const worldPixels = zdLatLonToWorldPixels(lat, lon, zoom);
            return {
                x: worldPixels.x - nwPixel.x + dynamicMargin,
                y: worldPixels.y - nwPixel.y + dynamicMargin
            };
        };

        if (loadedZoneKmlFeatures.length > 0) {
            loadingMessage.textContent = "Dessin des éléments KML...";
            drawZoneKmlFeatures(ctx, zoom, loadedZoneKmlFeatures, latLonToCanvasPixels);
        }

        if (isUtmExport) {
            loadingMessage.textContent = "Dessin de la grille UTM...";
            const cartoucheFontSize = Math.max(10, Math.min(48, finalCanvas.width * 0.007));
            await drawUtmGridOnCanvas(ctx, finalBoundingBox, latLonToCanvasPixels, dynamicMargin, cartoucheFontSize);
        }
        
        if (isCadoExport && cadoData) {
            loadingMessage.textContent = "Dessin du carroyage CADO...";
            const { config, a1CornerLat, a1CornerLon } = cadoData;
            drawCadoElementsOnCanvas(ctx, config, latLonToCanvasPixels, [a1CornerLon, a1CornerLat]);
        }

        if (!isCadoExport) { 
            loadingMessage.textContent = "Finalisation de l'image...";
            const cartoucheFontSize = Math.max(10, Math.min(48, finalCanvas.width * 0.007));
            const cartoucheMetrics = drawZoneCartouche(ctx, "Export de zone", finalBoundingBox, mapLayerName, zoom, dynamicMargin, cartoucheFontSize);
            drawZoneCompass(ctx, finalCanvas.width, finalCanvas.height, dynamicMargin, cartoucheMetrics);
        }
        
        let fileName;
        if (isCadoExport && cadoData) {
            const { config, a1CornerLat, a1CornerLon } = cadoData;
            const letteringStr = config.letteringDirection === 'descending' ? '_descendant' : '';
            fileName = `${config.gridNameBase}_${config.scale}m_zone${letteringStr}_${config.colorName}_origine=${a1CornerLat.toFixed(6)},${a1CornerLon.toFixed(6)}${fileExtension}`;
        } else {
            const title = document.getElementById("zone-title").value || "Export de zone";
            fileName = `${title.replace(/[^a-z0-9]/gi, '_')}_${mapLayerName}_z${zoom}${fileExtension}`;
        }

        finalCanvas.toBlob((blob) => {
            if (blob) { downloadFile(blob, fileName); } 
            else { showError("Erreur lors de la création du fichier image."); }
        }, mimeType, quality);

    } catch (error) {
        console.error("Erreur lors de la génération de l'image de zone :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

async function generateCadoGridForZone() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Génération du carroyage CADO (KMZ)...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const { config, a1CornerLat, a1CornerLon } = getZoneCadoConfigAndBounds();
        const gridData = calculateGridData(config);
        const kmlContent = generateKML(config, gridData);
        const kmzBlob = await generateKMZ(config, gridData, kmlContent, 'application/vnd.google-earth.kmz');
        
        const letteringStr = config.letteringDirection === 'descending' ? '_descendant' : '';
        const fileName = `${config.gridNameBase}_${config.scale}m_zone${letteringStr}_${config.colorName}_origine=${a1CornerLat.toFixed(6)},${a1CornerLon.toFixed(6)}.kmz`;

        downloadFile(kmzBlob, fileName);

    } catch (error) {
        console.error("Erreur lors de la génération du KMZ CADO:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

async function zdCreateFinalCanvas(boundingBox, zoom, mapConfig, isCadoExport = false) {
    const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    const imageWidth = Math.abs(sePixel.x - nwPixel.x);
    const imageHeight = Math.abs(sePixel.y - nwPixel.y);
    
    let dynamicMargin = 0;
    if (!isCadoExport) {
        const cartoucheFontSize = Math.max(10, Math.min(48, imageWidth * 0.007));
        dynamicMargin = Math.ceil(cartoucheFontSize * 4);
    }

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = imageWidth + dynamicMargin * 2;
    finalCanvas.height = imageHeight + dynamicMargin * 2;
    const ctx = finalCanvas.getContext('2d');

    if (!isCadoExport) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
    }

    const nwTile = { x: Math.floor(nwPixel.x / ZD_TILE_SIZE), y: Math.floor(nwPixel.y / ZD_TILE_SIZE) };
    const seTile = { x: Math.floor(sePixel.x / ZD_TILE_SIZE), y: Math.floor(sePixel.y / ZD_TILE_SIZE) };
    
    for (const layer of mapConfig.layers) {
        const tilePromises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                let tileUrl;
                if (layer.type === 'quadkey') {
                    const quadKey = zdCoordsToQuadKey(x, y, zoom);
                    const subdomain = (x + y) % 4;
                    tileUrl = layer.url.replace('{q}', quadKey).replace('{s}', subdomain);
                } else {
                    tileUrl = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }
                
                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => resolve({ img, x, y, success: true });
                    img.onerror = () => resolve({ success: false });
                    img.src = tileUrl;
                });
                tilePromises.push(promise);
            }
        }
        const resolvedTiles = await Promise.all(tilePromises);
        resolvedTiles.forEach(tileResult => {
            if (tileResult.success) {
                const tileX = (tileResult.x * ZD_TILE_SIZE) - nwPixel.x + dynamicMargin;
                const tileY = (tileResult.y * ZD_TILE_SIZE) - nwPixel.y + dynamicMargin;
                ctx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
            }
        });
    }

    if (!isCadoExport) {
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.strokeRect(dynamicMargin, dynamicMargin, finalCanvas.width - dynamicMargin * 2, finalCanvas.height - dynamicMargin * 2);
    }

    return { finalCanvas, dynamicMargin };
}

function drawZoneCartouche(ctx, title, bbox, layerName, zoom, margin, fontSize) {
    const PADDING = fontSize;
    const lineSpacing = fontSize * 1.3;
    const utmNW = WGS84_to_UTM.fromLatLon(bbox.north, bbox.west);
    const utmSE = WGS84_to_UTM.fromLatLon(bbox.south, bbox.east);
    const utmNW_string = `${utmNW.zoneNumber}${utmNW.zoneLetter} ${Math.round(utmNW.easting)} E ${Math.round(utmNW.northing)} N`;
    const utmSE_string = `${utmSE.zoneNumber}${utmSE.zoneLetter} ${Math.round(utmSE.easting)} E ${Math.round(utmSE.northing)} N`;
    const texts = [ title, `UTM NO: ${utmNW_string}`, `UTM SE: ${utmSE_string}`, `Fond: ${layerName} (Zoom ${zoom})`];
    ctx.font = `${fontSize}px Arial`;
    const cartoucheWidth = Math.max(...texts.map(text => ctx.measureText(text).width)) + (PADDING * 2);
    const cartoucheHeight = (lineSpacing * texts.length) - (lineSpacing - fontSize) + (PADDING * 2);
    const cartoucheX = margin + PADDING;
    const cartoucheY = margin + PADDING;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let textY = cartoucheY + PADDING;
    for (const text of texts) {
        ctx.fillText(text, cartoucheX + PADDING, textY);
        textY += lineSpacing;
    }
    return { fontSize, cartoucheHeight };
}

function drawZoneCompass(ctx, canvasWidth, canvasHeight, margin, cartoucheMetrics) {
    const radius = Math.max(20, (cartoucheMetrics.cartoucheHeight * 0.75) / 2);
    const PADDING = radius * 1.6; 
    const centerX = canvasWidth - margin - PADDING;
    const centerY = margin + PADDING;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
    const arrowLength = radius / 1.2;
    const N_point = { x: centerX, y: centerY - arrowLength };
    const base_point = { x: centerX, y: centerY + (arrowLength * 0.3) };
    ctx.beginPath();
    ctx.moveTo(base_point.x, base_point.y);
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    const arrowHeadSize = radius * 0.25;
    ctx.lineTo(N_point.x - arrowHeadSize, N_point.y + arrowHeadSize);
    ctx.lineTo(N_point.x + arrowHeadSize, N_point.y + arrowHeadSize);
    ctx.closePath();
    ctx.fillStyle = 'red'; ctx.fill();
    const compassNFontSize = radius * 0.6;
    ctx.font = `bold ${compassNFontSize}px Arial`;
    ctx.textAlign = 'center'; 
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'white'; 
    ctx.lineWidth = 3;
    ctx.strokeText('N', N_point.x, N_point.y);
    ctx.fillStyle = 'black';
    ctx.fillText('N', N_point.x, N_point.y);
}

async function handleZoneKmzFile(event) {
    const file = event.target.files[0];
    loadedZoneKmlFeatures = [];
    kmlResources = { images: {} };
    if (!file) return;

    try {
        const loadingMessage = document.getElementById("loading-message");
        loadingMessage.textContent = "Lecture du fichier KML/KMZ...";
        document.getElementById("loading-indicator").classList.remove("hidden");

        const zip = file.name.toLowerCase().endsWith('.kmz') ? await JSZip.loadAsync(file) : null;
        const kmlFile = zip ? zip.file(/(\.kml)$/i)[0] : null;
        
        if (zip && !kmlFile) throw new Error("Aucun fichier KML trouvé dans le KMZ.");
        
        const kmlText = zip ? await kmlFile.async("string") : await file.text();
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, "text/xml");

        const sharedStyles = parseSharedKmlStyles(kmlDoc);
        const placemarksData = parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles);

        if (zip) {
            loadingMessage.textContent = "Chargement des icônes...";
            await loadKmlIcons(placemarksData, zip);
        }

        loadedZoneKmlFeatures = placemarksData;
        alert(`${loadedZoneKmlFeatures.length} élément(s) KML ont été chargé(s) avec succès.`);

    } catch (error) {
        console.error("Erreur lors du chargement du fichier KML/KMZ:", error);
        showError("Impossible de lire le fichier. " + error.message);
        loadedZoneKmlFeatures = [];
        kmlResources = { images: {} };
    } finally {
        document.getElementById("loading-indicator").classList.add("hidden");
    }
}

function parseSharedKmlStyles(kmlDoc) {
    const styles = {};
    const styleElements = kmlDoc.querySelectorAll('Document > Style, Document > StyleMap');

    styleElements.forEach(styleEl => {
        const styleId = '#' + styleEl.getAttribute('id');
        if (styleEl.tagName === 'StyleMap') {
            const normalPair = Array.from(styleEl.querySelectorAll('Pair')).find(
                p => p.querySelector('key')?.textContent === 'normal'
            );
            const styleUrl = normalPair?.querySelector('styleUrl')?.textContent;
            if (styleUrl) {
                 styles[styleId] = { isMap: true, normalUrl: styleUrl };
            }
        } else {
            styles[styleId] = parseStyleElement(styleEl);
        }
    });

    Object.values(styles).forEach(style => {
        if (style.isMap && styles[style.normalUrl]) {
            Object.assign(style, styles[style.normalUrl]);
        }
    });

    return styles;
}

function parseStyleElement(styleEl) {
    const style = {};
    const iconStyle = styleEl.querySelector('IconStyle');
    const labelStyle = styleEl.querySelector('LabelStyle');
    const lineStyle = styleEl.querySelector('LineStyle');
    const polyStyle = styleEl.querySelector('PolyStyle');

    if (iconStyle) {
        style.iconUrl = iconStyle.querySelector('Icon > href')?.textContent || null;
        style.iconScale = parseFloat(iconStyle.querySelector('scale')?.textContent || 1.0);
    }
    if (labelStyle) {
        style.labelColor = kmlColorToCss(labelStyle.querySelector('color')?.textContent || 'ffffffff');
        style.labelScale = parseFloat(labelStyle.querySelector('scale')?.textContent || 1.0);
    }
    if (lineStyle) {
        style.lineColor = kmlColorToCss(lineStyle.querySelector('color')?.textContent || 'ff0000ff');
        style.lineWidth = parseFloat(lineStyle.querySelector('width')?.textContent || 2);
    }
    if (polyStyle) {
        style.polyColor = kmlColorToCss(polyStyle.querySelector('color')?.textContent || 'ff0000ff');
        style.polyFill = polyStyle.querySelector('fill')?.textContent !== '0';
        style.polyOutline = polyStyle.querySelector('outline')?.textContent !== '0';
    }
    return style;
}

function parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles) {
    const features = [];
    kmlDoc.querySelectorAll('Placemark').forEach(placemark => {
        const name = placemark.querySelector('name')?.textContent || '';
        let style = {};

        const styleUrl = placemark.querySelector('styleUrl')?.textContent;
        const inlineStyleEl = placemark.querySelector('Style');

        if (styleUrl && sharedStyles[styleUrl]) {
            style = sharedStyles[styleUrl];
        } else if (inlineStyleEl) {
            style = parseStyleElement(inlineStyleEl);
        }

        const point = placemark.getElementsByTagName('Point')[0];
        const lineString = placemark.getElementsByTagName('LineString')[0];
        const polygon = placemark.getElementsByTagName('Polygon')[0];

        if (point) {
            const coordsStr = point.getElementsByTagName('coordinates')[0]?.textContent.trim();
            if (coordsStr) {
                const [lon, lat] = coordsStr.split(',').map(parseFloat);
                features.push({ type: 'Point', name, style, coordinates: [lon, lat] });
            }
        } else if (lineString) {
            const coordsStr = lineString.getElementsByTagName('coordinates')[0]?.textContent.trim();
            if (coordsStr) {
                const coordinates = coordsStr.split(' ').filter(c => c).map(c => c.split(',').map(parseFloat));
                features.push({ type: 'LineString', name, style, coordinates });
            }
        } else if (polygon) {
            const outerBoundary = polygon.querySelector('outerBoundaryIs > LinearRing > coordinates')?.textContent.trim();
            if (outerBoundary) {
                const coordinates = outerBoundary.split(' ').filter(c => c).map(c => c.split(',').map(parseFloat));
                features.push({ type: 'Polygon', name, style, coordinates });
            }
        }
    });
    return features;
}

async function loadKmlIcons(placemarksData, zip) {
    const iconPromises = [];
    const loadedUrls = new Set();

    placemarksData.forEach(feature => {
        if (feature.type === 'Point' && feature.style?.iconUrl && !loadedUrls.has(feature.style.iconUrl)) {
            const iconUrl = feature.style.iconUrl;
            loadedUrls.add(iconUrl);

            let promise;

            if (iconUrl.startsWith('http')) {
                promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        kmlResources.images[iconUrl] = img;
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn(`Impossible de charger l'icône depuis l'URL: ${iconUrl}`);
                        resolve();
                    };
                    img.src = iconUrl;
                });
            } else if (zip) {
                const iconFile = zip.file(iconUrl);
                if (iconFile) {
                    promise = iconFile.async('base64').then(base64 => {
                        return new Promise((resolve) => {
                            const img = new Image();
                            img.onload = () => {
                                kmlResources.images[iconUrl] = img;
                                resolve();
                            };
                            img.onerror = () => resolve();
                            img.src = 'data:image/png;base64,' + base64;
                        });
                    });
                }
            }

            if (promise) {
                iconPromises.push(promise);
            }
        }
    });
    await Promise.all(iconPromises);
}

function kmlColorToCss(kmlColor) {
    if (!kmlColor || kmlColor.length !== 8) return 'rgba(255,255,255,1)';
    const a = parseInt(kmlColor.substring(0, 2), 16) / 255;
    const b = kmlColor.substring(2, 4);
    const g = kmlColor.substring(4, 6);
    const r = kmlColor.substring(6, 8);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${a})`;
}

function getContrastingOutlineColor(rgbaColor) {
    if (!rgbaColor || !rgbaColor.startsWith('rgba')) return 'black';
    try {
        const [r, g, b] = rgbaColor.match(/\d+/g).map(Number);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        return luminance > 186 ? 'black' : 'white';
    } catch (e) {
        return 'black';
    }
}

function drawZoneKmlFeatures(ctx, zoom, features, latLonToCanvasPixels) {
    features.forEach(feature => {
        const style = feature.style || {};

        if (feature.type === 'Point') {
            const center = latLonToCanvasPixels(feature.coordinates[1], feature.coordinates[0]);
            const iconImg = style.iconUrl ? kmlResources.images[style.iconUrl] : null;

            let iconHeight = 32;

            if (iconImg && iconImg.complete && iconImg.naturalWidth > 0) {
                const scale = style.iconScale || 1.0;
                const w = iconImg.naturalWidth * scale;
                const h = iconImg.naturalHeight * scale;
                iconHeight = h;
                ctx.drawImage(iconImg, center.x - w / 2, center.y - h / 2, w, h);
            } else {
                ctx.beginPath();
                ctx.arc(center.x, center.y, 6, 0, 2 * Math.PI, false);
                ctx.fillStyle = '#f0e100';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'black';
                ctx.stroke();
            }

            if (feature.name) {
                const textYOffset = (iconHeight / 2) + 5;
                const labelColor = style.labelColor || 'rgba(0, 0, 0, 1)'; 
                const outlineColor = getContrastingOutlineColor(labelColor);

                ctx.font = `bold ${16 * (style.labelScale || 1.0)}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                
                ctx.strokeStyle = outlineColor;
                ctx.lineWidth = 3;
                ctx.strokeText(feature.name, center.x, center.y + textYOffset);

                ctx.fillStyle = labelColor;
                ctx.fillText(feature.name, center.x, center.y + textYOffset);
            }
        } 
        else if (feature.type === 'LineString' && feature.coordinates.length > 1) {
            ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)';
            ctx.lineWidth = style.lineWidth || 2;
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y);
                else ctx.lineTo(px.x, px.y);
            });
            ctx.stroke();
        } 
        else if (feature.type === 'Polygon' && feature.coordinates.length > 2) {
            ctx.beginPath();
            feature.coordinates.forEach((coord, index) => {
                const px = latLonToCanvasPixels(coord[1], coord[0]);
                if (index === 0) ctx.moveTo(px.x, px.y);
                else ctx.lineTo(px.x, px.y);
            });
            ctx.closePath();

            if (style.polyFill !== false) {
                ctx.fillStyle = style.polyColor || 'rgba(255, 0, 0, 0.5)';
                ctx.fill();
            }

            if (style.polyOutline !== false) {
                ctx.strokeStyle = style.lineColor || 'rgba(255, 0, 0, 1)';
                ctx.lineWidth = style.lineWidth || 2;
                ctx.stroke();
            }
        }
    });
}

async function drawUtmGridOnCanvas(ctx, boundingBox, latLonToCanvasPixels, margin, cartoucheFontSize) {
    const color = document.getElementById('utm-grid-color').value;
    const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const gridLineColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
    const nwLat = boundingBox.north, nwLon = boundingBox.west, seLat = boundingBox.south, seLon = boundingBox.east;
    const drawingBox = { x: margin, y: margin, width: ctx.canvas.width - margin * 2, height: ctx.canvas.height - margin * 2 };
    const startZone = WGS84_to_UTM.fromLatLon(nwLat, nwLon).zoneNumber;
    const endZone = WGS84_to_UTM.fromLatLon(seLat, seLon).zoneNumber;
    const labelFontSize = cartoucheFontSize * 0.75;
    const labelPadding = 5;
    const labelsToDraw = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height);
    ctx.clip();
    for (let zone = startZone; zone <= endZone; zone++) {
        const zoneBoundaryLeft = (zone - 1) * 6 - 180;
        const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
        const clipLonEnd = Math.min(seLon, zone * 6 - 180);
        if (clipLonStart >= clipLonEnd) continue;
        const latPadding = (nwLat - seLat) * 0.1;
        const gridData = calculateGridForZoneStrip(nwLat + latPadding, clipLonStart, seLat - latPadding, clipLonEnd, zone);
        const allLines = [...gridData.eastingLines, ...gridData.northingLines];
        const utmInfo = WGS84_to_UTM.fromLatLon((nwLat + seLat) / 2, clipLonStart);
        const zoneDesignator = `${zone}${utmInfo.zoneLetter}`;
        for (const line of allLines) {
            ctx.lineWidth = (parseInt(line.name.split(' ')[1], 10) % 5 === 0) ? 2 : 1;
            ctx.strokeStyle = gridLineColor;
            ctx.beginPath();
            let firstCanvasPoint = null, lastCanvasPoint = null;
            for (let i = 0; i < line.coordinates.length; i++) {
                const p = latLonToCanvasPixels(line.coordinates[i][1], line.coordinates[i][0]);
                if (i === 0) { ctx.moveTo(p.x, p.y); firstCanvasPoint = p; } 
                else { ctx.lineTo(p.x, p.y); }
                lastCanvasPoint = p;
            }
            ctx.stroke();
            if (firstCanvasPoint && lastCanvasPoint) {
                const coordValue = line.name.split(' ')[1];
                const labelText = `${zoneDesignator} ${coordValue}`;
                if (line.name.startsWith('E')) {
                    labelsToDraw.push({ type: 'top', anchor: { x: lastCanvasPoint.x, y: drawingBox.y }, text: labelText, zone: zoneDesignator });
                    labelsToDraw.push({ type: 'bottom', anchor: { x: firstCanvasPoint.x, y: drawingBox.y + drawingBox.height }, text: labelText, zone: zoneDesignator });
                } else {
                    labelsToDraw.push({ type: 'left', anchor: { x: drawingBox.x, y: firstCanvasPoint.y }, text: labelText, zone: zoneDesignator });
                    labelsToDraw.push({ type: 'right', anchor: { x: drawingBox.x + drawingBox.width, y: lastCanvasPoint.y }, text: labelText, zone: zoneDesignator });
                }
            }
        }
    }
    ctx.restore();

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, ctx.canvas.width, margin);
    ctx.fillRect(0, ctx.canvas.height - margin, ctx.canvas.width, margin);
    ctx.fillRect(0, 0, margin, ctx.canvas.height);
    ctx.fillRect(ctx.canvas.width - margin, 0, margin, ctx.canvas.height);

    ctx.fillStyle = 'black';
    ctx.font = `bold ${labelFontSize}px Arial`;
    
    // **NOUVEAU** : Logique de filtrage des étiquettes pour les marges
    const startZoneStr = `${startZone}`;
    const endZoneStr = `${endZone}`;

    for (const label of labelsToDraw) {
        let shouldDraw = false;
        if (label.type === 'left' && label.zone.startsWith(startZoneStr)) {
            shouldDraw = true;
        } else if (label.type === 'right' && label.zone.startsWith(endZoneStr)) {
            shouldDraw = true;
        } else if (label.type === 'top' || label.type === 'bottom') {
            shouldDraw = true;
        }

        if (shouldDraw) {
            ctx.save();
            ctx.translate(label.anchor.x, label.anchor.y);
            switch(label.type) {
                case 'top': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label.text, labelPadding, 0); break;
                case 'bottom': ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(label.text, -labelPadding, 0); break;
                case 'left': ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(label.text, -labelPadding, 0); break;
                case 'right': ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label.text, labelPadding, 0); break;
            }
            ctx.restore();
        }
    }
}
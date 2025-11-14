// zoneDownloader.js

const ZD_TILE_SIZE = 256;
let loadedZoneKmlFeatures = []; // Pour stocker les données du KMZ
let kmlResources = { images: {} }; // Pour stocker les icônes chargées depuis le KMZ

/**
 * Calcule la distance en mètres entre deux coordonnées GPS en utilisant la formule de Haversine.
 * @param {{lat: number, lon: number}} p1 Point 1
 * @param {{lat: number, lon: number}} p2 Point 2
 * @returns {number} Distance en mètres
 */
function haversineDistance(p1, p2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const lat1Rad = toRad(p1.lat);
    const lat2Rad = toRad(p2.lat);
    const deltaLatRad = toRad(p2.lat - p1.lat);
    const deltaLonRad = toRad(p2.lon - p1.lon);

    const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}


// --- Fonctions de projection (partagées) ---
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

/**
 * Fonction principale qui orchestre la création de l'image de la zone.
 */
async function generateZonePNG() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'export de la zone...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const nwCoordsStr = document.getElementById("zone-nw-coords").value;
        const seCoordsStr = document.getElementById("zone-se-coords").value;
        if (!nwCoordsStr || !seCoordsStr) throw new Error("Veuillez d'abord dessiner une zone rectangulaire sur la carte.");

        const [north, west] = nwCoordsStr.split(',').map(c => parseFloat(c.trim()));
        const [south, east] = seCoordsStr.split(',').map(c => parseFloat(c.trim()));
        
        const zoom = parseInt(document.getElementById("zone-info-zoom").textContent, 10);
        
        const nwPixelForSize = zdLatLonToWorldPixels(north, west, zoom);
        const sePixelForSize = zdLatLonToWorldPixels(south, east, zoom);
        const imageWidth = Math.abs(sePixelForSize.x - nwPixelForSize.x);
        const cartoucheFontSize = Math.max(10, Math.min(48, imageWidth * 0.007));
        const dynamicMargin = Math.ceil(cartoucheFontSize * 4);

        const title = document.getElementById("zone-title").value || "Export de zone";
        const mapLayerName = document.getElementById("zone-info-layer").textContent;
        
        const selectedMap = MAP_LAYERS.find(m => m.name === mapLayerName);
        if (!selectedMap) throw new Error("Impossible de trouver la configuration du fond de carte.");
        
        const format = document.querySelector('input[name="image-format-zone"]:checked').value;
        const quality = parseInt(document.getElementById('zone-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : '.png';

        const boundingBox = { north, west, south, east };

        loadingMessage.textContent = "Téléchargement et assemblage des fonds de carte...";
        const { finalCanvas } = await zdCreateFinalCanvas(boundingBox, zoom, selectedMap, dynamicMargin);
        const ctx = finalCanvas.getContext('2d');
        
        const scale = 25000;
        const drawingBoxPixelWidth = finalCanvas.width - 2 * dynamicMargin;
        const centralLat = (north + south) / 2;
        const realWidthMeters = haversineDistance({lat: centralLat, lon: west}, {lat: centralLat, lon: east});
        const metersPerPixel = realWidthMeters / drawingBoxPixelWidth;
        const mmPerPixel = (metersPerPixel / scale) * 1000;
        const totalPrintWidthMm = finalCanvas.width * mmPerPixel;
        const totalPrintHeightMm = finalCanvas.height * mmPerPixel;
        const printDimensionsString = `print_${totalPrintWidthMm.toFixed(0)}x${totalPrintHeightMm.toFixed(0)}mm`;
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, finalCanvas.width, dynamicMargin);
        ctx.fillRect(0, finalCanvas.height - dynamicMargin, finalCanvas.width, dynamicMargin);
        ctx.fillRect(0, dynamicMargin, dynamicMargin, finalCanvas.height - 2 * dynamicMargin);
        ctx.fillRect(finalCanvas.width - dynamicMargin, dynamicMargin, dynamicMargin, finalCanvas.height - 2 * dynamicMargin);
        
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.strokeRect(dynamicMargin, dynamicMargin, finalCanvas.width - dynamicMargin * 2, finalCanvas.height - dynamicMargin * 2);
        
        const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
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

        const overlayUtmGrid = document.getElementById('overlay-utm-grid-checkbox').checked;
        const overlayCadoGrid = document.getElementById('overlay-cado-grid-checkbox').checked;

        if (overlayUtmGrid) {
            loadingMessage.textContent = "Dessin de la grille UTM...";
            await drawUtmGridOnCanvas(ctx, boundingBox, zoom, latLonToCanvasPixels, dynamicMargin, cartoucheFontSize);
        }
        
        if (overlayCadoGrid) {
            loadingMessage.textContent = "Dessin du carroyage CADO...";
            await drawCadoGridOnCanvas(ctx, boundingBox, latLonToCanvasPixels);
        }

		loadingMessage.textContent = "Finalisation de l'image...";
		const cartoucheMetrics = drawZoneCartouche(ctx, title, boundingBox, mapLayerName, zoom, dynamicMargin);
        drawZoneCompass(ctx, finalCanvas.width, finalCanvas.height, dynamicMargin, cartoucheMetrics);

        const fileName = `${title.replace(/[^a-z0-9]/gi, '_')}_${mapLayerName}_z${zoom}_${printDimensionsString}${fileExtension}`;
        finalCanvas.toBlob((blob) => {
            if (blob) {
                downloadFile(blob, fileName);
            } else {
                showError("Erreur lors de la création du fichier image.");
            }
        }, mimeType, quality);

    } catch (error) {
        console.error("Erreur lors de la génération de l'image de zone :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Génère un fichier KMZ du carroyage CADO pour la zone définie.
 */
async function generateCadoGridForZone() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Génération du carroyage CADO (KMZ)...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
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

        const config = {
            latitude: nwLat,
            longitude: nwLon,
            scale: scale,
            gridColor: document.getElementById('grid-color').value,
            colorName: document.getElementById('grid-color-name').value,
            colorOpacity: (100 - parseInt(document.getElementById('transparency').value)) / 100,
            gridName: document.getElementById("zone-title").value || "Carroyage CADO de Zone",
            deviation: 0,
            labelSize: parseFloat(document.getElementById('label-size').value),
            iconSize: parseFloat(document.getElementById('icon-size').value || 2),
            referencePointChoice: 'origin',
            letteringDirection: document.querySelector('input[name="cado-overlay-direction"]:checked').value,
            startRow: 1,
            endRow: numRows,
            startCol: 'A',
            endCol: numberToLetter(numCols),
            includeGrid: true,
            includePoints: true,
            outputFormat: 'KMZ'
        };

        const gridData = calculateGridData(config);
        const kmlContent = generateKML(config, gridData);
        const kmzBlob = await generateKMZ(config, gridData, kmlContent, 'application/vnd.google-earth.kmz');
        
        downloadFile(kmzBlob, `${config.gridName}.kmz`);

    } catch (error) {
        console.error("Erreur lors de la génération du KMZ CADO:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}


/**
 * Crée le canevas final avec des marges, et y assemble les tuiles pour la zone sélectionnée.
 */
async function zdCreateFinalCanvas(boundingBox, zoom, mapConfig, margin) {
    const nwPixel = zdLatLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = zdLatLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);

    const imageWidth = Math.abs(sePixel.x - nwPixel.x);
    const imageHeight = Math.abs(sePixel.y - nwPixel.y);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = imageWidth + margin * 2;
    finalCanvas.height = imageHeight + margin * 2;
    const ctx = finalCanvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

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
                const tileX = (tileResult.x * ZD_TILE_SIZE) - nwPixel.x + margin;
                const tileY = (tileResult.y * ZD_TILE_SIZE) - nwPixel.y + margin;
                ctx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
            }
        });
    }

    return { finalCanvas };
}

/**
 * Dessine le cartouche d'information et retourne ses dimensions.
 */
function drawZoneCartouche(ctx, title, bbox, layerName, zoom, margin) {
    const FONT_SIZE = Math.max(10, Math.min(48, ctx.canvas.width * 0.007));
    const PADDING = FONT_SIZE;
    const lineSpacing = FONT_SIZE * 1.3;

    const utmNW = WGS84_to_UTM.fromLatLon(bbox.north, bbox.west);
    const utmSE = WGS84_to_UTM.fromLatLon(bbox.south, bbox.east);

    const utmNW_string = `${utmNW.zoneNumber}${utmNW.zoneLetter} ${Math.round(utmNW.easting)} E ${Math.round(utmNW.northing)} N`;
    const utmSE_string = `${utmSE.zoneNumber}${utmSE.zoneLetter} ${Math.round(utmSE.easting)} E ${Math.round(utmSE.northing)} N`;
    
    const texts = [
        title,
        `UTM NO: ${utmNW_string}`,
        `UTM SE: ${utmSE_string}`,
        `Fond: ${layerName} (Zoom ${zoom})`,
        `Échelle : 1 carré = 1km`
    ];

    ctx.font = `${FONT_SIZE}px Arial`;
    const cartoucheWidth = Math.max(...texts.map(text => ctx.measureText(text).width)) + (PADDING * 2);
    const cartoucheHeight = (lineSpacing * texts.length) - (lineSpacing - FONT_SIZE) + (PADDING * 2);

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
    
    return { FONT_SIZE, cartoucheHeight };
}

/**
 * Dessine une boussole simple sur la carte, avec une taille proportionnelle au cartouche.
 */
function drawZoneCompass(ctx, canvasWidth, canvasHeight, margin, cartoucheMetrics) {
    const maxRadius = (cartoucheMetrics.cartoucheHeight * 0.75) / 2;
    const dynamicRadius = (canvasWidth - margin * 2) * 0.03;
    const radius = Math.max(20, Math.min(maxRadius, dynamicRadius));
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

// =======================================================================
// SECTION 1 : FONCTIONS DE PARSING KML
// =======================================================================

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

// =======================================================================
// SECTION 2 : FONCTIONS DE DESSIN SUR CANVAS
// =======================================================================

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

/**
 * Calcule et dessine une grille UTM.
 */
async function drawUtmGridOnCanvas(ctx, boundingBox, zoom, latLonToCanvasPixels, margin, cartoucheFontSize) {
    const color = document.getElementById('utm-grid-color').value;
    const opacity = (100 - parseInt(document.getElementById('utm-transparency').value)) / 100;
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const gridLineColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;

    const nwLat = boundingBox.north;
    const nwLon = boundingBox.west;
    const seLat = boundingBox.south;
    const seLon = boundingBox.east;

    const drawingBox = {
        x: margin,
        y: margin,
        width: ctx.canvas.width - margin * 2,
        height: ctx.canvas.height - margin * 2
    };

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
        const zoneBoundaryRight = zone * 6 - 180;
        const clipLonStart = Math.max(nwLon, zoneBoundaryLeft);
        const clipLonEnd = Math.min(seLon, zoneBoundaryRight);
        if (clipLonStart >= clipLonEnd) continue;
        
        const latPadding = (nwLat - seLat) * 0.1;
        const gridData = calculateGridForZoneStrip(nwLat + latPadding, clipLonStart, seLat - latPadding, clipLonEnd, zone);
        const allLines = [...gridData.eastingLines, ...gridData.northingLines];
        
        const representativeLat = (nwLat + seLat) / 2;
        const utmInfo = WGS84_to_UTM.fromLatLon(representativeLat, clipLonStart);
        const zoneDesignator = `${zone}${utmInfo.zoneLetter}`;

        for (const line of allLines) {
            ctx.lineWidth = (parseInt(line.name.split(' ')[1], 10) % 5 === 0) ? 3 : 1.5;
            ctx.strokeStyle = gridLineColor;
            ctx.beginPath();
            let firstCanvasPoint = null;
            let lastCanvasPoint = null;
            
            for (let i = 0; i < line.coordinates.length; i++) {
                const p = latLonToCanvasPixels(line.coordinates[i][1], line.coordinates[i][0]);
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                    firstCanvasPoint = p;
                } else {
                    ctx.lineTo(p.x, p.y);
                }
                lastCanvasPoint = p;
            }
            ctx.stroke();

            if (firstCanvasPoint && lastCanvasPoint) {
                const coordValue = line.name.split(' ')[1];
                const labelText = `${zoneDesignator} ${coordValue}`;
                let topAnchor, bottomAnchor, leftAnchor, rightAnchor;

                if (line.name.startsWith('E')) {
                    topAnchor = { x: lastCanvasPoint.x, y: drawingBox.y };
                    bottomAnchor = { x: firstCanvasPoint.x, y: drawingBox.y + drawingBox.height };
                    labelsToDraw.push({ type: 'top', anchor: topAnchor, text: labelText });
                    labelsToDraw.push({ type: 'bottom', anchor: bottomAnchor, text: labelText });
                } else {
                    leftAnchor = { x: drawingBox.x, y: firstCanvasPoint.y };
                    rightAnchor = { x: drawingBox.x + drawingBox.width, y: lastCanvasPoint.y };
                    labelsToDraw.push({ type: 'left', anchor: leftAnchor, text: labelText });
                    labelsToDraw.push({ type: 'right', anchor: rightAnchor, text: labelText });
                }
            }
        }
    }
    ctx.restore();

    ctx.fillStyle = 'black';
    ctx.font = `bold ${labelFontSize}px Arial`;

    for (const label of labelsToDraw) {
        ctx.save();
        ctx.translate(label.anchor.x, label.anchor.y);

        switch(label.type) {
            case 'top':
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.text, labelPadding, 0);
                break;
            case 'bottom':
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.text, -labelPadding, 0);
                break;
            case 'left':
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.text, -labelPadding, 0);
                break;
            case 'right':
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label.text, labelPadding, 0);
                break;
        }
        ctx.restore();
    }
}

/**
 * Dessine un carroyage CADO sur le canvas de la zone.
 */
async function drawCadoGridOnCanvas(ctx, boundingBox, latLonToCanvasPixels) {
    const config = {
        scale: parseFloat(document.getElementById('cado-overlay-scale').value),
        lineWidth: parseInt(document.getElementById('cado-overlay-thickness').value, 10),
        letteringDirection: document.querySelector('input[name="cado-overlay-direction"]:checked').value,
        gridColor: document.getElementById('grid-color').value,
        colorName: document.getElementById('grid-color-name').value,
        deviation: 0
    };

    const a1Lon = boundingBox.west;
    const a1Lat = boundingBox.north;
    const widthMeters = haversineDistance({lat: a1Lat, lon: a1Lon}, {lat: a1Lat, lon: boundingBox.east});
    const heightMeters = haversineDistance({lat: a1Lat, lon: a1Lon}, {lat: boundingBox.south, lon: a1Lon});
    const numCols = Math.ceil(widthMeters / config.scale);
    const numRows = Math.ceil(heightMeters / config.scale);
    
    const startColNum = 1;
    const endColNum = numCols;
    const startRowNum = 1;
    const endRowNum = numRows;

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = config.lineWidth;

    for (let c = startColNum; c <= endColNum + 1; c++) {
        const startPoint = calculateAndRotatePoint(c, startRowNum, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(c, endRowNum + 1, config, a1Lat, a1Lon);
        const startPixels = latLonToCanvasPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToCanvasPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }

    for (let r = startRowNum; r <= endRowNum + 1; r++) {
        const startPoint = calculateAndRotatePoint(startColNum, r, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(endColNum + 1, r, config, a1Lat, a1Lon);
        const startPixels = latLonToCanvasPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToCanvasPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    
    const geo_A1_center = calculateAndRotatePoint(1.5, 1.5, config, a1Lat, a1Lon);
    const geo_B1_center = calculateAndRotatePoint(2.5, 1.5, config, a1Lat, a1Lon);
    const px_A1_center = latLonToCanvasPixels(geo_A1_center[1], geo_A1_center[0]);
    const px_B1_center = latLonToCanvasPixels(geo_B1_center[1], geo_B1_center[0]);
    const cellWidthInPixels = Math.hypot(px_B1_center.x - px_A1_center.x, px_B1_center.y - px_A1_center.y);
    
    const labelFontSize = cellWidthInPixels * 0.4;
    ctx.font = `bold ${labelFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const drawLabelWithOutline = (text, x, y) => {
        const darkColors = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
        ctx.strokeStyle = darkColors.includes(config.colorName) ? 'white' : 'black';
        ctx.lineWidth = 3;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = config.gridColor;
        ctx.fillText(text, x, y);
    };

    for (let c = startColNum; c <= endColNum; c++) {
        const labelPoint = calculateAndRotatePoint(c + 0.5, startRowNum - 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToCanvasPixels(labelPoint[1], labelPoint[0]);
        drawLabelWithOutline(numberToLetter(c), labelPixels.x, labelPixels.y);
    }

    for (let r = startRowNum; r <= endRowNum; r++) {
        const labelPoint = calculateAndRotatePoint(startColNum - 0.5, r + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToCanvasPixels(labelPoint[1], labelPoint[0]);
        drawLabelWithOutline(r.toString(), labelPixels.x, labelPixels.y);
    }
}
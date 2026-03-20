// carroyageCado.js

// --- VARIABLES GLOBALES POUR L'IMPORT CADO ---
let loadedCadoKmlFeatures = [];
let cadoKmlResources = { images: {} };
let cadoKmlLayerGroup = null;

// --- CONVERSIONS DE COORDONNÉES SPÉCIFIQUES ---
function mercatorXToLng(x) { return toDeg(x / R); }
function mercatorYToLat(y) { return toDeg(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2); }
function lngToMercatorX(lng) { return R * toRad(lng); }
function latToMercatorY(lat) {
    if (Math.abs(lat) > 85.0511) throw new Error(`Latitude ${lat}° hors des limites Mercator.`);
    return R * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));
}

function decimalToDMS(decimal, type) {
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const min = Math.floor((abs - deg) * 60);
    const sec = ((abs - deg) * 60 - min) * 60;
    const direction = type === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
    return `${deg}°${min}'${sec.toFixed(1)}"${direction}`;
}

function decimalToDM(decimal, type) {
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    const direction = type === 'lat' ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
    return `${deg}° ${min.toFixed(3)}' ${direction}`;
}

function updateAllFromDecimal(lat, lon) {
    document.getElementById('dms-coords').value = `${decimalToDMS(lat, 'lat')} ${decimalToDMS(lon, 'lng')}`;
    
    const dmField = document.getElementById('dm-coords');
    if (dmField) dmField.value = `${decimalToDM(lat, 'lat')} ${decimalToDM(lon, 'lng')}`;
    
    document.getElementById('mercator-coords').value = `${lngToMercatorX(lon).toFixed(2)}, ${latToMercatorY(lat).toFixed(2)}`;
    if (isPlusCodeLibraryAvailable()) {
        const pcEl = document.getElementById('plus-code');
        if(pcEl) pcEl.value = new OpenLocationCode().encode(lat, lon);
    }
    const utm = WGS84_to_UTM.fromLatLon(lat, lon);
    document.getElementById('utm-coords').value = `${utm.zoneNumber} ${utm.zoneLetter} ${utm.easting.toFixed(0)} ${utm.northing.toFixed(0)}`;
}

function convertFromDM() {
    try {
        const coordsStr = document.getElementById('dm-coords').value.trim();
        if (!coordsStr) return showError("Veuillez entrer des coordonnées DM.");

        const regex = /(\d+)[°\s]+(\d+\.?\d*)['\s]*([NS])[, \t]+(\d+)[°\s]+(\d+\.?\d*)['\s]*([EW])/i;
        const match = coordsStr.match(regex);

        if (!match) throw new Error("Format DM invalide. Format attendu : 48° 51.395' N 2° 21.132' E");

        let lat = parseInt(match[1]) + parseFloat(match[2]) / 60;
        if (match[3].toUpperCase() === 'S') lat = -lat;

        let lon = parseInt(match[4]) + parseFloat(match[5]) / 60;
        if (match[6].toUpperCase() === 'W') lon = -lon;

        document.getElementById('decimal-coords').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        updateAllFromDecimal(lat, lon);
        hideError();
    } catch (err) {
        showError("Erreur de conversion depuis DM: " + err.message);
    }
}

function convertFromDecimal() {
    try {
        const coordsStr = document.getElementById('decimal-coords').value.trim();
        if (!coordsStr) return showError("Veuillez entrer des coordonnées décimales.");
        let [lat, lon] = coordsStr.split(',').map(c => parseFloat(c.trim()));
        if (isNaN(lat) || isNaN(lon)) throw new Error("Format invalide.");
        
        updateAllFromDecimal(lat, lon);
        hideError();
    } catch (err) {
        showError("Erreur de conversion depuis Décimal: " + err.message);
    }
}

function convertFromDMS() {
    try {
        const coordsStr = document.getElementById('dms-coords').value.trim();
        if (!coordsStr) return showError("Veuillez entrer des coordonnées DMS.");
        const match = coordsStr.match(/(\d+)°(\d+)'(\d+(\.\d+)?)"([NS])\s+(\d+)°(\d+)'(\d+(\.\d+)?)"([EW])/);
        if (!match) throw new Error("Format DMS invalide.");
        let lat = parseInt(match[1]) + parseInt(match[2]) / 60 + parseFloat(match[3]) / 3600;
        if (match[5] === 'S') lat = -lat;
        let lon = parseInt(match[6]) + parseInt(match[7]) / 60 + parseFloat(match[8]) / 3600;
        if (match[10] === 'W') lon = -lon;
        
        document.getElementById('decimal-coords').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        updateAllFromDecimal(lat, lon);
        hideError();
    } catch (err) {
        showError("Erreur de conversion depuis DMS: " + err.message);
    }
}

function convertFromMercator() {
    try {
        const coordsStr = document.getElementById('mercator-coords').value.trim();
        if (!coordsStr) return showError("Veuillez entrer des coordonnées MERCATOR.");
        let [x, y] = coordsStr.split(',').map(c => parseFloat(c.trim()));
        if (isNaN(x) || isNaN(y)) throw new Error("Format invalide.");
        const lat = mercatorYToLat(y);
        const lon = mercatorXToLng(x);
        
        document.getElementById('decimal-coords').value = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        updateAllFromDecimal(lat, lon);
        hideError();
    } catch (err) {
        showError("Erreur de conversion depuis MERCATOR: " + err.message);
    }
}

function convertFromUTM() {
    try {
        const utmStr = document.getElementById('utm-coords').value.trim();
        if (!utmStr) return showError("Veuillez entrer des coordonnées UTM.");

        const parts = utmStr.split(/\s+/);
        if (parts.length !== 4) throw new Error("Format UTM invalide. Attendu : Zone Lettre Easting Northing.");

        const zoneNumber = parseInt(parts[0]);
        const zoneLetter = parts[1].toUpperCase();
        const easting = parseFloat(parts[2]);
        const northing = parseFloat(parts[3]);

        if (isNaN(zoneNumber) || isNaN(easting) || isNaN(northing)) throw new Error("Les valeurs UTM (Zone, Easting, Northing) doivent être des nombres.");

        const wgsCoords = WGS84_to_UTM.toLatLon(easting, northing, zoneNumber, zoneLetter);
        
        document.getElementById('decimal-coords').value = `${wgsCoords.latitude.toFixed(6)}, ${wgsCoords.longitude.toFixed(6)}`;
        updateAllFromDecimal(wgsCoords.latitude, wgsCoords.longitude);
        hideError();
    } catch (err) {
        showError("Erreur de conversion depuis UTM: " + err.message);
    }
}

function isPlusCodeLibraryAvailable() { return typeof OpenLocationCode === 'function'; }

function viewOnMaps(type) {
    try {
        let lat, lon;
        
        if (type === 'decimal') {
            const coordsStr = document.getElementById('decimal-coords').value;
            if (!coordsStr) throw new Error("Coordonnées non définies.");
            [lat, lon] = coordsStr.split(',').map(parseFloat);
        } else {
            if (type === 'dms') convertFromDMS();
            else if (type === 'mercator') convertFromMercator();
            else if (type === 'utm') convertFromUTM();
            
            const coordsStr = document.getElementById('decimal-coords').value;
            if (!coordsStr) throw new Error("La conversion a échoué.");
            [lat, lon] = coordsStr.split(',').map(parseFloat);
        }

        if (isNaN(lat) || isNaN(lon)) throw new Error("Coordonnées invalides après conversion.");
        
        window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank');
        hideError();
    } catch (err) {
        showError("Impossible d'afficher sur la carte: " + err.message);
    }
}

// --- GESTION DU CHARGEMENT KML/KMZ POUR CADO ---

async function handleCadoKmzFile(event) {
    const file = event.target.files[0];
    const clearBtn = document.getElementById('cado-clear-kmz-btn');
    
    // Reset des anciennes données
    if (cadoKmlLayerGroup && window.cadoMap) {
        window.cadoMap.removeLayer(cadoKmlLayerGroup);
    }
    loadedCadoKmlFeatures = [];
    cadoKmlResources = { images: {} };
    if (clearBtn) clearBtn.classList.add('hidden');

    if (!file) return;

    try {
        const loadingIndicator = document.getElementById("loading-indicator");
        if(loadingIndicator) loadingIndicator.classList.remove("hidden");

        const zip = file.name.toLowerCase().endsWith('.kmz') ? await JSZip.loadAsync(file) : null;
        const kmlFile = zip ? zip.file(/(\.kml)$/i)[0] : null;
        const kmlText = zip ? await kmlFile.async("string") : await file.text();
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlText, "text/xml");

        // Utilisation des fonctions de parsing de zoneDownloader.js
        if (typeof parseSharedKmlStyles !== 'function' || typeof parseKmlPlacemarksFromDoc !== 'function') {
            throw new Error("Modules de lecture KML manquants (zoneDownloader.js est-il chargé ?).");
        }

        const sharedStyles = parseSharedKmlStyles(kmlDoc);
        const placemarksData = parseKmlPlacemarksFromDoc(kmlDoc, sharedStyles);

        if (zip && typeof loadKmlIcons === 'function') {
            const backupRes = window.kmlResources;
            window.kmlResources = cadoKmlResources; 
            await loadKmlIcons(placemarksData, zip);
            window.kmlResources = backupRes; 
        }

        loadedCadoKmlFeatures = placemarksData;

        // Affichage sur la carte CADO
        const leaflets = loadedCadoKmlFeatures.map(f => {
            if(f.type === 'Point') return L.marker([f.coordinates[1], f.coordinates[0]]);
            else if(f.type === 'LineString') return L.polyline(f.coordinates.map(c => [c[1], c[0]]), {color:'red'});
            else if(f.type === 'Polygon') return L.polygon(f.coordinates.map(c => [c[1], c[0]]), {color:'blue'});
            return null;
        }).filter(l => l !== null);

        if (leaflets.length > 0 && window.cadoMap) {
            cadoKmlLayerGroup = L.featureGroup(leaflets).addTo(window.cadoMap);
        }

        if (clearBtn) {
            clearBtn.classList.remove('hidden');
            clearBtn.onclick = () => {
                document.getElementById('cado-kmz-input').value = "";
                handleCadoKmzFile({target: {files: []}});
            };
        }

        alert(`${loadedCadoKmlFeatures.length} éléments chargés pour le mode CADO.`);

    } catch (error) {
        console.error(error);
        alert("Erreur KML CADO : " + error.message);
    } finally {
        const loadingIndicator = document.getElementById("loading-indicator");
        if(loadingIndicator) loadingIndicator.classList.add("hidden");
    }
}

// --- LOGIQUE DE GÉNÉRATION DE CARROYAGE CADO ---

function updateDynamicGridName() {
    try {
        const baseName = document.getElementById('grid-name-base').value || 'CADO Grid';
        const scale = document.getElementById('scale').value || 20;
        const refPoint = document.querySelector('input[name="reference-point"]:checked').value;
        const lettering = document.querySelector('input[name="lettering-direction"]:checked').value;
        
        let gridTypeStr;
        const gridType = document.querySelector('input[name="grid-type"]:checked').value;

        if (gridType === 'custom') {
            const sr = document.getElementById('start-row').value;
            const er = document.getElementById('end-row').value;
            const sc = document.getElementById('start-col').value;
            const ec = document.getElementById('end-col').value;
            gridTypeStr = `_${sc}${sr}-${ec}${er}`;
        } else {
            gridTypeStr = `_${gridType}`;
        }

        const deviation = parseInt(document.getElementById('deviation').value) || 0;
        let deviationStr = deviation > 0 ? `_+${deviation}°` : (deviation < 0 ? `_${deviation}°` : "");
        const colorName = document.getElementById('grid-color-name').value;
        const letteringStr = lettering === 'descending' ? '_descendant' : '';
        
        const fullName = `${baseName}_${scale}m_${refPoint}${letteringStr}${gridTypeStr}${deviationStr}_${colorName}`;
        
        const disp = document.getElementById('full-grid-name');
        if(disp) disp.textContent = fullName;
        document.getElementById('grid-name').value = fullName;
    } catch (e) {
        console.warn("Update dynamic name error", e);
    }
}

// =========================================================================
// FONCTION GENERATE GRID (MODE 1 - AVEC SUPPORT MBTILES ET CSV)
// =========================================================================

async function generateGrid() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    loadingMessage.textContent = "Génération du carroyage CADO en cours...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const decimalCoords = document.getElementById("decimal-coords").value.trim();
        if (!decimalCoords) throw new Error("Veuillez entrer des coordonnées décimales.");
        const [lat, lon] = decimalCoords.split(",").map(c => parseFloat(c.trim()));
        if (isNaN(lat) || isNaN(lon)) throw new Error("Coordonnées décimales invalides.");

        updateDynamicGridName();
        
        const config = getGridConfiguration(lat, lon);
        const gridData = calculateGridData(config);

        const originCoords = gridData.originPointPlacemark.coordinates;
        const originString = `_origine=${originCoords[1].toFixed(6)},${originCoords[0].toFixed(6)}`;
        config.gridName += originString;
        
        const disp = document.getElementById("full-grid-name");
        if(disp) disp.textContent = config.gridName;

        const fileFormat = config.outputFormat;
        let fileBlob, fileName, mimeType;

        // --- SUPPORT NOUVEAUX FORMATS ---
        
        if (fileFormat === "MBTILES") {
            // 1. Calcul de la Bounding Box de la grille pour l'export
            let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
            const allPoints = [...gridData.horizontalLines.flatMap(l=>l.points), ...gridData.verticalLines.flatMap(l=>l.points)];
            
            allPoints.forEach(p => {
                if(p[1] < minLat) minLat = p[1];
                if(p[1] > maxLat) maxLat = p[1];
                if(p[0] < minLon) minLon = p[0];
                if(p[0] > maxLon) maxLon = p[0];
            });

            // Marge de sécurité pour ne pas couper les labels sur les bords
            const bufferLat = 0.002; 
            const bufferLon = 0.003;
            const bbox = { north: maxLat + bufferLat, south: minLat - bufferLat, east: maxLon + bufferLon, west: minLon - bufferLon };
            
            // Calcul du zoom optimal (approx)
            // Pour du CADO 20m/50m, un zoom 17 est un bon compromis taille/détail
            const baseZoom = 17;

            // Appel au générateur MBTiles (avec données manuelles pour CADO)
            if (typeof generateMbtilesProcess === 'function') {
                const manualCadoData = { config: config, gridData: gridData };
                // Pas d'UTM ni CFSI en Mode 1
                fileBlob = await generateMbtilesProcess(config.gridName, false, false, true, bbox, baseZoom, window.userPOIs, manualCadoData);
                fileName = `${config.gridName}.mbtiles`;
            } else {
                throw new Error("Module MBTiles manquant (carroyageToMbtiles.js).");
            }
        }
        else if (fileFormat === "CSV") {
             if (typeof generateGridCSV === 'function') {
                 const manualCadoData = { config: config, gridData: gridData };
                 // Appel de la fonction du fichier carroyageToCSV.js (avec données manuelles)
                 await generateGridCSV(config.gridName, false, false, true, window.userPOIs, manualCadoData);
                 loadingIndicator.classList.add("hidden");
                 return; // Le fichier est téléchargé dans generateGridCSV
             } else {
                 throw new Error("Module CSV manquant (carroyageToCSV.js).");
             }
        }
        else {
            // --- FORMATS CLASSIQUES (KML, KMZ, GPX, GeoJSON) ---
            switch (fileFormat) {
                case "KML":
                case "KMZ":
                    const kmlContent = generateKML(config, gridData);
                    if (fileFormat === "KMZ") {
                        mimeType = "application/vnd.google-earth.kmz";
                        fileBlob = await generateKMZ(config, gridData, kmlContent, mimeType);
                        fileName = `${config.gridName}.kmz`;
                    } else {
                        mimeType = "application/vnd.google-earth.kml+xml";
                        fileBlob = new Blob([kmlContent], { type: mimeType });
                        fileName = `${config.gridName}.kml`;
                    }
                    break;
                case "GeoJSON":
                    mimeType = "application/geo+json";
                    fileBlob = new Blob([generateGeoJSON(config, gridData)], { type: mimeType });
                    fileName = `${config.gridName}.geojson`;
                    break;
                case "GPX":
                    mimeType = "application/gpx+xml";
                    fileBlob = new Blob([generateGPX(config, gridData)], { type: mimeType });
                    fileName = `${config.gridName}.gpx`;
                    break;
                default:
                    throw new Error("Format de sortie non supporté.");
            }
        }

        if(fileBlob) downloadFile(fileBlob, fileName);

    } catch (error) {
        console.error("Error generating CADO grid:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

function getGridConfiguration(lat, lon) {
    const gridType = document.querySelector('input[name="grid-type"]:checked').value;
    let startRow, endRow, startCol, endCol;

    switch (gridType) {
        case 'Q12': startRow = 1; endRow = 12; startCol = 'A'; endCol = 'Q'; break;
        case 'Z18': startRow = 1; endRow = 18; startCol = 'A'; endCol = 'Z'; break;
        case 'Z14': startRow = 1; endRow = 14; startCol = 'A'; endCol = 'Z'; break;
        case 'Q9':  startRow = 1; endRow = 9;  startCol = 'A'; endCol = 'Q'; break;
        case 'Z26': startRow = 1; endRow = 26; startCol = 'A'; endCol = 'Z'; break;
        case 'custom':
            startRow = parseInt(document.getElementById('start-row').value);
            endRow = parseInt(document.getElementById('end-row').value);
            startCol = document.getElementById('start-col').value.toUpperCase();
            endCol = document.getElementById('end-col').value.toUpperCase();
            break;
        default: 
            startRow = 1; endRow = 12; startCol = 'A'; endCol = 'Q';
    }

    return {
        latitude: lat,
        longitude: lon,
        scale: parseFloat(document.getElementById('scale').value),
        gridColor: document.getElementById('grid-color').value,
        colorName: document.getElementById('grid-color-name').value,
        colorOpacity: (100 - parseInt(document.getElementById('transparency').value)) / 100,
        gridName: document.getElementById('grid-name').value || "CADO Grid",
        deviation: parseInt(document.getElementById('deviation').value),
        labelSize: parseFloat(document.getElementById('label-size').value),
        iconSize: parseFloat(document.getElementById('icon-size').value || 2),
        referencePointChoice: document.querySelector('input[name="reference-point"]:checked').value,
        letteringDirection: document.querySelector('input[name="lettering-direction"]:checked').value,
        startRow, endRow, startCol, endCol,
        includeGrid: ['grid-only', 'grid-points'].includes(document.querySelector('input[name="content-type"]:checked').value),
        includePoints: ['points-only', 'grid-points'].includes(document.querySelector('input[name="content-type"]:checked').value),
        outputFormat: document.querySelector('input[name="file-format"]:checked').value,
        swapAxes: document.getElementById('swap-axes').checked
    };
}

function calculateGridData(config) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    let a1CornerLat, a1CornerLon;
    const refLat = config.latitude;
    const refLon = config.longitude;

    if (config.referencePointChoice === 'origin') {
        a1CornerLat = refLat;
        a1CornerLon = refLon;
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
                const middleIndex = numCells / 2;
                return startOffset + middleIndex;
            } else {
                const middleIndex = Math.floor(numCells / 2);
                return startOffset + middleIndex + 0.5;
            }
        };
        
        const centerColOffset = calculateCenterOffsetInCells(startColNum, endColNum);
        const centerRowOffset = calculateCenterOffsetInCells(startRowNum, endRowNum);
        
        const xOffsetMeters = centerColOffset * config.scale;
		const yOffsetMeters = centerRowOffset * config.scale;

		a1CornerLon = refLon - metersToLonDegrees(xOffsetMeters, refLat);

		if (config.letteringDirection === 'ascending') {
			a1CornerLat = refLat - metersToLatDegrees(yOffsetMeters);
		} else { 
			a1CornerLat = refLat + metersToLatDegrees(yOffsetMeters);
		}
    }
    
    const points = [];
    const horizontalLines = [];
    const verticalLines = [];

    const rowsToDraw = generateIndices(config.startRow, config.endRow);
    const colsToDraw = generateIndices(letterToNumber(config.startCol), letterToNumber(config.endCol));

    const rowsForLines = [...rowsToDraw, getNextIndex(rowsToDraw[rowsToDraw.length - 1])];
    const colsForLines = [...colsToDraw, getNextIndex(colsToDraw[colsToDraw.length - 1])];

    rowsForLines.forEach((rowNum, index) => {
        const isLastRow = index === rowsForLines.length - 1;
        const linePoints = colsForLines.map(colNum => 
            calculateAndRotatePoint(colNum, rowNum, config, a1CornerLat, a1CornerLon)
        );
        horizontalLines.push({ name: isLastRow ? "" : rowNum, points: linePoints });
    });
    
    colsForLines.forEach((colNum, index) => {
        const isLastCol = index === colsForLines.length - 1;
        const linePoints = rowsForLines.map(rowNum => 
            calculateAndRotatePoint(colNum, rowNum, config, a1CornerLat, a1CornerLon)
        );
        verticalLines.push({ name: isLastCol ? "" : numberToLetter(colNum), points: linePoints });
    });

    for (const row of rowsToDraw) {
        for (const col of colsToDraw) {
            const pointCoords = calculateAndRotatePoint(col + 0.5, row + 0.5, config, a1CornerLat, a1CornerLon);
            
            let pointName;
            if (config.swapAxes) {
                pointName = `${numberToLetter(row)}${col}`; 
            } else {
                pointName = `${numberToLetter(col)}${row}`;
            }
            
            points.push({ name: pointName, coordinates: pointCoords });
        }
    }
    
    const originPointCoords = calculateAndRotatePoint(1, 1, config, a1CornerLat, a1CornerLon);
    const originPlacemarkName = `Origine A1: ${originPointCoords[1].toFixed(6)}, ${originPointCoords[0].toFixed(6)}`;
    
    return {
        horizontalLines, verticalLines, points,
        originPointPlacemark: { name: originPlacemarkName, coordinates: originPointCoords },
        referencePointCircle: generateCirclePoints(config.longitude, config.latitude, config.scale / 4, 36)
    };
}

function generateCirclePoints(lon, lat, radiusMeters, segments) {
    const circlePoints = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI;
        const dx = radiusMeters * Math.cos(angle);
        const dy = radiusMeters * Math.sin(angle);
        const pointLon = lon + dx / (111320 * Math.cos(toRad(lat)));
        const pointLat = lat + dy / 111320;
        circlePoints.push([pointLon, pointLat]);
    }
    return circlePoints;
}

function rgbToKmlColor(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16).toString(16).padStart(2, '0');
    const g = parseInt(hex.slice(3, 5), 16).toString(16).padStart(2, '0');
    const b = parseInt(hex.slice(5, 7), 16).toString(16).padStart(2, '0');
    const a = Math.floor(255 * opacity).toString(16).padStart(2, '0');
    return `${a}${b}${g}${r}`;
}

// --- GENERATION KML AVEC SUPPORT IMPORT ---

function generateKML(config, gridData) {
    const isKmz = config.outputFormat === 'KMZ';
    const iconScale = isKmz ? config.iconSize : 0;
    const labelScale = isKmz ? 0 : config.labelSize;
    const labelColor = rgbToKmlColor(config.gridColor, 1);
    const lineColor = rgbToKmlColor(config.gridColor, config.colorOpacity);
    const yellowLineColor = 'a000ffff';

    let kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + config.gridName + '</name>';
    
    // Styles de base
    kml += '<Style id="gridLineStyle"><LineStyle><color>' + lineColor + '</color><width>2</width></LineStyle></Style>';
    kml += '<Style id="referenceCircleStyle"><LineStyle><color>' + yellowLineColor + '</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>';
    kml += '<Style id="originPointStyle"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon><scale>1.1</scale></IconStyle></Style>';
    
    // Style générique pour imports
    kml += '<Style id="importedLineStyle"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle></Style>';
    kml += '<Style id="importedPolyStyle"><LineStyle><color>ff0000ff</color><width>2</width></LineStyle><PolyStyle><color>7f0000ff</color></PolyStyle></Style>';

    if (config.includePoints) {
        gridData.points.forEach(point => {
            kml += '<Style id="point_' + point.name + '_style"><IconStyle>';
            if (isKmz) {
                kml += '<scale>' + iconScale + '</scale><Icon><href>icons/' + point.name + '.png</href></Icon>';
            } else {
                kml += '<scale>0</scale>';
            }
            kml += '</IconStyle><LabelStyle><color>' + labelColor + '</color><scale>' + labelScale + '</scale></LabelStyle></Style>';
        });
    }

    // --- INTEGRATION DU KML IMPORTÉ ---
    if (loadedCadoKmlFeatures && loadedCadoKmlFeatures.length > 0) {
        kml += '<Folder><name>Calque Importé</name>';
        
        loadedCadoKmlFeatures.forEach((f, idx) => {
            let styleUrl = "#importedLineStyle";
            let coordsStr = "";
            let geomTag = "";

            if (f.type === 'Point') {
                styleUrl = "#originPointStyle"; 
                coordsStr = `${f.coordinates[0]},${f.coordinates[1]},0`;
                geomTag = `<Point><coordinates>${coordsStr}</coordinates></Point>`;
            } 
            else if (f.type === 'LineString') {
                coordsStr = f.coordinates.map(c => `${c[0]},${c[1]},0`).join(' ');
                geomTag = `<LineString><coordinates>${coordsStr}</coordinates></LineString>`;
            } 
            else if (f.type === 'Polygon') {
                styleUrl = "#importedPolyStyle";
                coordsStr = f.coordinates.map(c => `${c[0]},${c[1]},0`).join(' ');
                geomTag = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsStr}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
            }

            let inlineStyle = "";
            if (isKmz && f.type === 'Point' && f.style && f.style.iconUrl) {
                const iconFilename = `imported_icon_${idx}.png`;
                inlineStyle = `<Style><IconStyle><Icon><href>files/${iconFilename}</href></Icon></IconStyle></Style>`;
                styleUrl = ""; 
            }

            kml += `<Placemark>
                <name>${f.name || 'Element'}</name>
                ${styleUrl ? `<styleUrl>${styleUrl}</styleUrl>` : inlineStyle}
                ${geomTag}
            </Placemark>`;
        });
        kml += '</Folder>';
    }

    // --- CARROYAGE ---
    kml += '<Folder><name>Carroyage CADO</name>';
    kml += '<Placemark><name>Point de Référence</name><styleUrl>#referenceCircleStyle</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>' + gridData.referencePointCircle.map(p => p.join(",") + ",0").join(" ") + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
    kml += '<Placemark><name>' + gridData.originPointPlacemark.name + '</name><styleUrl>#originPointStyle</styleUrl><Point><coordinates>' + gridData.originPointPlacemark.coordinates.join(",") + ',0</coordinates></Point></Placemark>';
    
    if (config.includeGrid) {
        kml += '<Folder><name>Lignes</name>';
        gridData.horizontalLines.concat(gridData.verticalLines).forEach(line => {
            kml += '<Placemark><name>' + line.name + '</name><styleUrl>#gridLineStyle</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + line.points.map(p => p.join(",") + ",0").join(" ") + '</coordinates></LineString></Placemark>';
        });
        kml += '</Folder>';
    }
    
    if (config.includePoints) {
        kml += '<Folder><name>Points</name>';
        gridData.points.forEach(point => {
            kml += '<Placemark><name>' + point.name + '</name><styleUrl>#point_' + point.name + '_style</styleUrl><Point><coordinates>' + point.coordinates.join(",") + ',0</coordinates></Point></Placemark>';
        });
        kml += '</Folder>';
    }
    
    kml += '</Folder>';
    kml += '</Document></kml>';
    return kml;
}

// --- GENERATION KMZ AVEC ASSETS IMPORTÉS ---

async function generateKMZ(config, gridData, kmlContent, mimeType) {
    const zip = new JSZip();
    zip.file("doc.kml", kmlContent);
    
    // 1. Icônes CADO (Lettres)
    if (config.includePoints) {
        const iconsFolder = zip.folder("icons");
        const canvas = document.createElement("canvas");
        canvas.setAttribute("width", 64);
        canvas.setAttribute("height", 64);
        const ctx = canvas.getContext("2d");
        ctx.font = "bold 24px Arial";
        ctx.fillStyle = config.gridColor;
        ctx.textAlign = "center";
        ctx.textBaseline =  "middle";

        for (const point of gridData.points) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText(point.name, 32, 32);
            if (config.gridColor.toUpperCase() === "#FFFFFF") {
                ctx.strokeText(point.name, 32, 32);
            }
            iconsFolder.file(`${point.name}.png`, canvas.toDataURL("image/png").split(',')[1], { base64: true });
        }
    }

    // 2. Icônes Importées via KMZ/KML Input
    if (loadedCadoKmlFeatures && loadedCadoKmlFeatures.length > 0) {
        const filesFolder = zip.folder("files");
        
        if (window.getIconDataGlobal) {
            for (let i = 0; i < loadedCadoKmlFeatures.length; i++) {
                const f = loadedCadoKmlFeatures[i];
                if (f.type === 'Point' && f.style && f.style.iconUrl) {
                    let imgData = null;
                    
                    // Priorité au cache mémoire si présent
                    if (cadoKmlResources && cadoKmlResources.images && cadoKmlResources.images[f.style.iconUrl]) {
                        const img = cadoKmlResources.images[f.style.iconUrl];
                        const c = document.createElement('canvas');
                        c.width = img.naturalWidth || 32; 
                        c.height = img.naturalHeight || 32;
                        c.getContext('2d').drawImage(img, 0, 0);
                        imgData = c.toDataURL('image/png');
                    } else {
                        // Sinon fetch
                        imgData = await window.getIconDataGlobal(f.style.iconUrl);
                    }

                    if (imgData) {
                        filesFolder.file(`imported_icon_${i}.png`, imgData.split(',')[1], {base64: true});
                    }
                }
            }
        }
    }

    return await zip.generateAsync({ type: "blob", mimeType: mimeType });
}

function generateGeoJSON(config, gridData) {
    const features = [];
    features.push({ type: "Feature", properties: { name: "Point de Référence (cercle)" }, geometry: { type: "Polygon", coordinates: [gridData.referencePointCircle] } });
    features.push({ type: "Feature", properties: { name: gridData.originPointPlacemark.name }, geometry: { type: "Point", coordinates: gridData.originPointPlacemark.coordinates } });
    if (config.includeGrid) {
        gridData.horizontalLines.concat(gridData.verticalLines).forEach(line => {
            if (line.points.length > 1) {
                features.push({ type: "Feature", properties: { name: line.name }, geometry: { type: "LineString", coordinates: line.points } });
            }
        });
    }
    if (config.includePoints) {
        gridData.points.forEach(point => {
            features.push({ type: "Feature", properties: { name: point.name }, geometry: { type: "Point", coordinates: point.coordinates } });
        });
    }
    return JSON.stringify({ type: "FeatureCollection", name: config.gridName, features: features }, null, 2);
}

function generateGPX(config, gridData) {
    let gpx = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="CADO"><metadata><name>' + config.gridName + '</name></metadata>';
    gpx += '<wpt lat="' + gridData.originPointPlacemark.coordinates[1] + '" lon="' + gridData.originPointPlacemark.coordinates[0] + '"><name>' + gridData.originPointPlacemark.name + '</name></wpt>';
    if (config.includePoints) {
        gridData.points.forEach(point => {
            gpx += '<wpt lat="' + point.coordinates[1] + '" lon="' + point.coordinates[0] + '"><name>' + point.name + '</name></wpt>';
        });
    }
    gpx += '<trk><name>Point de Référence (cercle)</name><trkseg>';
    gridData.referencePointCircle.forEach(p => { gpx += '<trkpt lat="' + p[1] + '" lon="' + p[0] + '"></trkpt>'; });
    gpx += '</trkseg></trk>';
    if (config.includeGrid) {
        gridData.horizontalLines.concat(gridData.verticalLines).forEach(line => {
            if (line.points.length > 1) {
                gpx += '<trk><name>' + line.name + '</name><trkseg>';
                line.points.forEach(p => { gpx += '<trkpt lat="' + p[1] + '" lon="' + p[0] + '"></trkpt>'; });
                gpx += '</trkseg></trk>';
            }
        });
    }
    gpx += '</gpx>';
    return gpx;
}
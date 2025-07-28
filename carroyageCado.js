// carroyageCado.js

// --- GESTION DES ICÔNES ---
const iconDictionaries = {};

function initIconDictionaries() {
    const iconDataSources = {
        'FFFFFF': typeof imageBase64DataFFFFFF !== 'undefined' ? imageBase64DataFFFFFF : [],
        '000000': typeof imageBase64Data000000 !== 'undefined' ? imageBase64Data000000 : [],
        'FF0000': typeof imageBase64DataFF0000 !== 'undefined' ? imageBase64DataFF0000 : [],
        'FFA500': typeof imageBase64DataFFA500 !== 'undefined' ? imageBase64DataFFA500 : [],
        'FFFF00': typeof imageBase64DataFFFF00 !== 'undefined' ? imageBase64DataFFFF00 : [],
        '008000': typeof imageBase64Data008000 !== 'undefined' ? imageBase64Data008000 : [],
        '0000FF': typeof imageBase64Data0000FF !== 'undefined' ? imageBase64Data0000FF : [],
        '800080': typeof imageBase64Data800080 !== 'undefined' ? imageBase64Data800080 : [],
        'A52A2A': typeof imageBase64DataA52A2A !== 'undefined' ? imageBase64DataA52A2A : [],
        '808080': typeof imageBase64Data808080 !== 'undefined' ? imageBase64Data808080 : []
    };
    for (const [colorHex, data] of Object.entries(iconDataSources)) {
        if (data && data.length > 0) {
            const dict = {};
            data.forEach(item => { dict[item.name] = item.base64; });
            iconDictionaries[colorHex] = dict;
        } else {
            console.warn(`Données manquantes ou vides pour ${colorHex}`);
        }
    }
}

// --- CONVERSIONS DE COORDONNÉES ---
const R = 6378137;
const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;

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

// Fonction centrale de mise à jour depuis le format Décimal
function updateAllFromDecimal(lat, lon) {
    // Mise à jour DMS
    document.getElementById('dms-coords').value = `${decimalToDMS(lat, 'lat')} ${decimalToDMS(lon, 'lng')}`;
    
    // Mise à jour Mercator
    document.getElementById('mercator-coords').value = `${lngToMercatorX(lon).toFixed(2)}, ${latToMercatorY(lat).toFixed(2)}`;
    
    // Mise à jour Plus Code
    if (isPlusCodeLibraryAvailable()) {
        document.getElementById('plus-code').value = new OpenLocationCode().encode(lat, lon);
    }

    // NOUVEAU : Mise à jour UTM
    const utm = WGS84_to_UTM.fromLatLon(lat, lon);
    document.getElementById('utm-coords').value = `${utm.zoneNumber} ${utm.zoneLetter} ${utm.easting.toFixed(0)} ${utm.northing.toFixed(0)}`;
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

// NOUVELLE FONCTION
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


async function convertFromPlusCode() { /* Stub */ }

function isPlusCodeLibraryAvailable() { return typeof OpenLocationCode === 'function'; }

// Fonction "Voir sur Maps" améliorée pour gérer tous les types
function viewOnMaps(type) {
    try {
        let lat, lon;
        
        // Obtenir les coordonnées Lat/Lon, quel que soit le type d'entrée
        if (type === 'decimal') {
            const coordsStr = document.getElementById('decimal-coords').value;
            if (!coordsStr) throw new Error("Coordonnées non définies.");
            [lat, lon] = coordsStr.split(',').map(parseFloat);
        } else {
            // Pour les autres types, on force la conversion pour obtenir du décimal
            // C'est un moyen simple de ne pas dupliquer la logique de parsing
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

// --- LOGIQUE DE GÉNÉRATION DE CARROYAGE CADO ---

function updateDynamicGridName() {
    const baseName = document.getElementById('grid-name-base').value || 'CADO Grid';
    const scale = document.getElementById('scale').value || 20;
    const refPoint = document.querySelector('input[name="reference-point"]:checked').value;
    const lettering = document.querySelector('input[name="lettering-direction"]:checked').value;
    let gridTypeStr = "";
    const gridOption = document.querySelector('input[name="grid-option"]:checked').value;
    if (gridOption === 'default') {
        gridTypeStr = `_${document.querySelector('input[name="grid-type"]:checked').value}`;
    } else {
        const sr = document.getElementById('start-row').value;
        const er = document.getElementById('end-row').value;
        const sc = document.getElementById('start-col').value;
        const ec = document.getElementById('end-col').value;
        gridTypeStr = `_${sc}${sr}-${ec}${er}`;
    }
    const deviation = parseInt(document.getElementById('deviation').value) || 0;
    let deviationStr = deviation > 0 ? `_+${deviation}°` : (deviation < 0 ? `_${deviation}°` : "");
    const colorName = document.getElementById('grid-color-name').value;
    const letteringStr = lettering === 'descending' ? '_descendant' : '';
    const fullName = `${baseName}_${scale}m_${refPoint}${letteringStr}${gridTypeStr}${deviationStr}_${colorName}`;
    document.getElementById('full-grid-name').textContent = fullName;
    document.getElementById('grid-name').value = fullName;
}

async function generateGrid() {
    const loadingIndicator = document.getElementById("loading-indicator");
    document.getElementById("loading-message").textContent = "Génération du carroyage CADO en cours...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const decimalCoords = document.getElementById("decimal-coords").value.trim();
        if (!decimalCoords) throw new Error("Veuillez entrer des coordonnées décimales.");
        const [lat, lon] = decimalCoords.split(",").map(c => parseFloat(c.trim()));
        if (isNaN(lat) || isNaN(lon)) throw new Error("Coordonnées décimales invalides.");

        const config = getGridConfiguration(lat, lon);
        const gridData = calculateGridData(config);

        document.getElementById("full-grid-name").textContent = config.gridName;
        
        const fileFormat = config.outputFormat;
        let fileBlob, fileName, mimeType;

        switch (fileFormat) {
            case "KML":
            case "KMZ":
                const kmlContent = generateKML(config, gridData);
                if (fileFormat === "KMZ") {
                    fileBlob = await generateKMZ(config, gridData, kmlContent);
                    fileName = `${config.gridName}.kmz`;
                    mimeType = "application/vnd.google-earth.kmz";
                } else {
                    fileBlob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
                    fileName = `${config.gridName}.kml`;
                    mimeType = "application/vnd.google-earth.kml+xml";
                }
                break;
            case "GeoJSON":
                fileBlob = new Blob([generateGeoJSON(config, gridData)], { type: "application/geo+json" });
                fileName = `${config.gridName}.geojson`;
                mimeType = "application/geo+json";
                break;
            case "GPX":
                fileBlob = new Blob([generateGPX(config, gridData)], { type: "application/gpx+xml" });
                fileName = `${config.gridName}.gpx`;
                mimeType = "application/gpx+xml";
                break;
            default:
                throw new Error("Format de sortie non supporté.");
        }
        downloadFile(fileBlob, fileName, mimeType);
    } catch (error) {
        console.error("Error generating CADO grid:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

function getGridConfiguration(lat, lon) {
    const scale = parseFloat(document.getElementById('scale').value);
    const gridColor = document.getElementById('grid-color').value;
    const colorName = document.getElementById('grid-color-name').value;
    const transparency = parseInt(document.getElementById('transparency').value);
    const gridName = document.getElementById('grid-name').value || "CADO Grid";
    const deviation = parseInt(document.getElementById('deviation').value);
    const labelSize = parseFloat(document.getElementById('label-size').value);
    const iconSize = parseFloat(document.getElementById('icon-size').value || 2);
    const gridOption = document.querySelector('input[name="grid-option"]:checked').value;
    let startRow, endRow, startCol, endCol;

    if (gridOption === 'default') {
        const gridType = document.querySelector('input[name="grid-type"]:checked').value;
        switch (gridType) {
            case 'Z26': startRow = 1; endRow = 26; startCol = 'A'; endCol = 'Z'; break;
            case 'Z14': startRow = 1; endRow = 14; startCol = 'A'; endCol = 'Z'; break;
            case 'Q9':  startRow = 1; endRow = 9;  startCol = 'A'; endCol = 'Q'; break;
            default:    startRow = 1; endRow = 14; startCol = 'A'; endCol = 'Z';
        }
    } else {
        startRow = parseInt(document.getElementById('start-row').value);
        endRow = parseInt(document.getElementById('end-row').value);
        startCol = document.getElementById('start-col').value;
        endCol = document.getElementById('end-col').value;
    }

    return {
        latitude: lat, longitude: lon, scale, gridColor, colorName,
        colorOpacity: (100 - transparency) / 100, gridName, deviation,
        labelSize, iconSize, needsDarkOutline: ['white', 'orange', 'yellow'].includes(colorName),
        referencePointChoice: document.querySelector('input[name="reference-point"]:checked').value,
        letteringDirection: document.querySelector('input[name="lettering-direction"]:checked').value,
        startRow, endRow, startCol, endCol,
        includeGrid: ['grid-only', 'grid-points'].includes(document.querySelector('input[name="content-type"]:checked').value),
        includePoints: ['points-only', 'grid-points'].includes(document.querySelector('input[name="content-type"]:checked').value),
        outputFormat: document.querySelector('input[name="file-format"]:checked').value
    };
}


const getOffsetInCells = (n) => (n > 0 ? n - 1 : n);
const getNextIndex = (n) => (n === -1 ? 1 : n + 1);

function calculateGridData(config) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    let a1CornerLat, a1CornerLon;
    const refLat = config.latitude;
    const refLon = config.longitude;

    if (config.referencePointChoice === 'origin') {
        a1CornerLat = refLat;
        a1CornerLon = refLon;
    } else { // 'center'
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        const startRowNum = config.startRow;
        const endRowNum = config.endRow;

        const calculateCenterOffsetInCells = (start, end) => {
            const indices = generateIndices(start, end);
            const numCells = indices.length;
            const startOffset = getOffsetInCells(indices[0]);

            if (numCells % 2 === 0) { // Even number of cells
                const middleIndex = numCells / 2;
                return startOffset + middleIndex;
            } else { // Odd number of cells
                const middleIndex = Math.floor(numCells / 2);
                return startOffset + middleIndex + 0.5;
            }
        };
        
        const centerColOffset = calculateCenterOffsetInCells(startColNum, endColNum);
        const centerRowOffset = calculateCenterOffsetInCells(startRowNum, endRowNum);
        
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;

        a1CornerLon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        a1CornerLat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
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
            points.push({ name: `${numberToLetter(col)}${row}`, coordinates: pointCoords });
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

function calculateAndRotatePoint(colNumber, rowNumber, config, a1CornerLat, a1CornerLon) {
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    const colOffset = getOffsetInCells(colNumber);
    const rowOffset = getOffsetInCells(rowNumber);
    
    const xOffsetMeters = colOffset * config.scale;
    const yOffsetMeters = rowOffset * config.scale;
    const finalYOffset = config.letteringDirection === 'ascending' ? yOffsetMeters : -yOffsetMeters;

    const unrotatedLon = a1CornerLon + metersToLonDegrees(xOffsetMeters, a1CornerLat);
    const unrotatedLat = a1CornerLat + metersToLatDegrees(finalYOffset, a1CornerLat);

    if (config.deviation === 0) {
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

function generateIndices(start, end) {
    const indices = [];
    if (start <= end) {
        for (let i = start; i <= end; i++) { if (i !== 0) indices.push(i); }
    } else {
        for (let i = start; i >= end; i--) { if (i !== 0) indices.push(i); }
    }
    return indices;
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

function letterToNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    if (str.startsWith('-')) return -letterToNumber(str.substring(1));
    return str.toUpperCase().split('').reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0);
}

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

function generateKML(config, gridData) {
    const isKmz = config.outputFormat === 'KMZ';
    const iconScale = isKmz ? config.iconSize : 0;
    const labelScale = isKmz ? 0 : config.labelSize;
    const labelColor = rgbToKmlColor(config.gridColor, 1);
    const lineColor = rgbToKmlColor(config.gridColor, config.colorOpacity);
    const yellowLineColor = 'a000ffff';

    let kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + config.gridName + '</name>';
    
    kml += '<Style id="gridLineStyle"><LineStyle><color>' + lineColor + '</color><width>2</width></LineStyle></Style>';
    kml += '<Style id="referenceCircleStyle"><LineStyle><color>' + yellowLineColor + '</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>';
    kml += '<Style id="originPointStyle"><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon><scale>1.1</scale></IconStyle></Style>';

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
    
    kml += '</Folder>'; // **BUG CORRIGÉ ICI** : Fermeture du dossier principal "Carroyage CADO"
    kml += '</Document></kml>';
    return kml;
}

async function generateKMZ(config, gridData, kmlContent) {
    const zip = new JSZip();
    zip.file("doc.kml", kmlContent);
    if (config.includePoints) {
        const iconsFolder = zip.folder("icons");
        const colorKey = config.gridColor.substring(1).toUpperCase();
        const iconDict = iconDictionaries[colorKey] || {};
        for (const point of gridData.points) {
            if (iconDict[point.name]) {
                iconsFolder.file(`${point.name}.png`, iconDict[point.name].replace(/^data:image\/png;base64,/, ''), { base64: true });
            }
        }
    }
    return await zip.generateAsync({ type: "blob" });
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
    // **BUG CORRIGÉ ICI** : Utilisation de guillemets simples et accès correct aux coordonnées [lon, lat]
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
        
// --- FONCTIONS UTILITAIRES PARTAGÉES ---

function downloadFile(content, fileName, mimeType) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: mimeType });
    saveAs(blob, fileName);
}

function showError(message) {
    const errorDiv = document.getElementById("error-message");
    errorDiv.textContent = message;
    errorDiv.classList.remove("hidden");
}

function hideError() {
    document.getElementById("error-message").classList.add("hidden");
}

function rgbToKmlColor(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16).toString(16).padStart(2, '0');
    const g = parseInt(hex.slice(3, 5), 16).toString(16).padStart(2, '0');
    const b = parseInt(hex.slice(5, 7), 16).toString(16).padStart(2, '0');
    const a = Math.floor(255 * opacity).toString(16).padStart(2, '0');
    return `${a}${b}${g}${r}`; // KML color is aabbggrr
}